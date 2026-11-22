/**
 * Le immagini esterne: quelle che una risposta scrive nel testo, in Markdown, con un indirizzo
 * https di un altro sito. Il browser del proprietario non le chiede a quel sito: le chiede al
 * centro, che le scarica e le passa (ADR 0043). Così il sito non vede l'indirizzo del proprietario,
 * il suo browser né i suoi cookie, e il centro fa valere le sue regole:
 *
 * - solo https, sulla porta 443, senza nome utente e password nell'indirizzo;
 * - mai un indirizzo della rete di casa o del server: ogni nome si risolve qui, e un indirizzo
 *   privato, locale o riservato viene rifiutato, anche dopo un reindirizzamento;
 * - solo immagini vere, riconosciute dai loro primi byte (JPEG, PNG, GIF, WebP, AVIF): niente SVG,
 *   che potrebbe portare uno script, e nient'altro che si spacci per un'immagine;
 * - al massimo `DIMENSIONE_MASSIMA` byte, e in poco tempo.
 *
 * Il proprietario ha scelto di caricarle da qualunque sito https: un indirizzo scritto da Claude
 * può portare a quel sito i dati che contiene, e questo rischio è accettato.
 */

import { lookup as risolvi, type LookupAddress } from "node:dns";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";

export const DIMENSIONE_MASSIMA = 8 * 1024 * 1024;
const ATTESA_MS = 15_000;
const REINDIRIZZAMENTI_MASSIMI = 4;
/** Quanto restano in memoria le immagini già scaricate, in byte. */
const MEMORIA_MASSIMA = 64 * 1024 * 1024;
const VALIDITA_MS = 24 * 60 * 60 * 1000;
/** Un indirizzo che non ha dato un'immagine non si richiede per un po'. */
const VALIDITA_RIFIUTO_MS = 10 * 60 * 1000;
/** Un nome generico, che non dice nulla del proprietario. */
const AGENTE = "Shinka/1.0 (immagini nella chat)";

export interface ImmagineEsterna {
  tipo: string;
  dati: Buffer;
}

export type EsitoImmagine = ImmagineEsterna | { motivo: string };

/** Gli indirizzi che non sono di internet: la rete di casa, il server stesso, quelli riservati. */
const NON_PUBBLICI = (() => {
  const elenco = new BlockList();
  for (const [rete, prefisso] of [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.88.99.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
  ] as const) {
    elenco.addSubnet(rete, prefisso, "ipv4");
  }
  for (const [rete, prefisso] of [
    ["::", 128],
    ["::1", 128],
    ["64:ff9b::", 96],
    ["64:ff9b:1::", 48],
    ["100::", 64],
    ["2001::", 23],
    ["2001:db8::", 32],
    ["2002::", 16],
    ["fc00::", 7],
    ["fe80::", 10],
    ["ff00::", 8],
  ] as const) {
    elenco.addSubnet(rete, prefisso, "ipv6");
  }
  return elenco;
})();

/**
 * Gli IPv4 scritti dentro un IPv6 (::ffff:0:0/96), in un elenco a parte: un BlockList confronta
 * anche gli IPv4 con questa regola, e li darebbe tutti per non pubblici.
 */
const MAPPATI = (() => {
  const elenco = new BlockList();
  elenco.addSubnet("::ffff:0:0", 96, "ipv6");
  return elenco;
})();

/** Vero se l'indirizzo IP è di internet. Un IPv4 scritto dentro un IPv6 vale come IPv4. */
export function indirizzoPubblico(ip: string): boolean {
  const famiglia = isIP(ip);
  if (famiglia === 4) return !NON_PUBBLICI.check(ip, "ipv4");
  if (famiglia !== 6) return false;
  const v4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)?.[1];
  if (v4 !== undefined) return indirizzoPubblico(v4);
  // Scritto in esadecimale (::ffff:7f00:1) non si legge come IPv4: non passa.
  if (MAPPATI.check(ip, "ipv6")) return false;
  return !NON_PUBBLICI.check(ip, "ipv6");
}

/** L'indirizzo, se è uno che il centro può chiedere; altrimenti il motivo. */
export function indirizzoAmmesso(scritto: string): URL | { motivo: string } {
  let indirizzo: URL;
  try {
    indirizzo = new URL(scritto);
  } catch {
    return { motivo: "Non è un indirizzo." };
  }
  if (indirizzo.protocol !== "https:") return { motivo: "Solo immagini da indirizzi https." };
  if (indirizzo.username !== "" || indirizzo.password !== "") return { motivo: "Un indirizzo con nome utente o password non si chiede." };
  if (indirizzo.port !== "" && indirizzo.port !== "443") return { motivo: "Solo indirizzi sulla porta 443." };
  const nome = indirizzo.hostname.replace(/^\[|\]$/g, "");
  if (isIP(nome) !== 0 && !indirizzoPubblico(nome)) return { motivo: "Un indirizzo della rete di casa o del server non si chiede." };
  if (isIP(nome) === 0 && (!nome.includes(".") || /\.(local|lan|home|internal|localhost)$/i.test(nome) || nome.toLowerCase() === "localhost")) {
    return { motivo: "Un nome della rete di casa non si chiede." };
  }
  return indirizzo;
}

/** Il tipo dell'immagine dai suoi primi byte; undefined se non è una che il centro passa. */
export function tipoDaiByte(dati: Buffer): string | undefined {
  if (dati.length >= 3 && dati[0] === 0xff && dati[1] === 0xd8 && dati[2] === 0xff) return "image/jpeg";
  if (dati.length >= 8 && dati.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (dati.length >= 6 && /^GIF8[79]a$/.test(dati.subarray(0, 6).toString("latin1"))) return "image/gif";
  if (dati.length >= 12 && dati.subarray(0, 4).toString("latin1") === "RIFF" && dati.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (dati.length >= 12 && dati.subarray(4, 8).toString("latin1") === "ftyp" && /^avi[fs]$/.test(dati.subarray(8, 12).toString("latin1"))) return "image/avif";
  return undefined;
}

/** Risolve il nome e lascia passare solo indirizzi di internet: vale per ogni collegamento, anche dopo un reindirizzamento. */
export function risolviSoloPubblici(
  nome: string,
  opzioni: { all?: boolean; family?: number | string } | number | undefined,
  fatto: (errore: NodeJS.ErrnoException | null, indirizzo: string | LookupAddress[], famiglia?: number) => void,
): void {
  const tutti = typeof opzioni === "object" && opzioni.all === true;
  risolvi(nome, { all: true }, (errore, trovati) => {
    if (errore !== null) return fatto(errore, tutti ? [] : "");
    const buoni = trovati.filter((voce) => indirizzoPubblico(voce.address));
    if (buoni.length === 0 || buoni.length !== trovati.length) {
      const rifiuto = Object.assign(new Error(`${nome} porta alla rete di casa o del server.`), { code: "ENOTPUBLIC" });
      return fatto(rifiuto, tutti ? [] : "");
    }
    if (tutti) return fatto(null, buoni);
    fatto(null, buoni[0]!.address, buoni[0]!.family);
  });
}

type Scarica = (indirizzo: URL) => Promise<{ stato: number; dove?: string; dati?: Buffer; troppo?: boolean }>;

const scaricaDavvero: Scarica = (indirizzo) =>
  new Promise((fatto, fallito) => {
    const richiesta = request(
      indirizzo,
      {
        method: "GET",
        headers: { "User-Agent": AGENTE, Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9,*/*;q=0.1" },
        lookup: risolviSoloPubblici as never,
        timeout: ATTESA_MS,
      },
      (risposta) => {
        const stato = risposta.statusCode ?? 0;
        if (stato >= 300 && stato < 400) {
          risposta.resume();
          const dove = risposta.headers.location;
          return fatto({ stato, ...(dove === undefined ? {} : { dove }) });
        }
        if (stato !== 200) {
          risposta.resume();
          return fatto({ stato });
        }
        const dichiarata = Number(risposta.headers["content-length"]);
        if (Number.isFinite(dichiarata) && dichiarata > DIMENSIONE_MASSIMA) {
          risposta.destroy();
          return fatto({ stato, troppo: true });
        }
        const pezzi: Buffer[] = [];
        let letti = 0;
        risposta.on("data", (pezzo: Buffer) => {
          letti += pezzo.length;
          if (letti > DIMENSIONE_MASSIMA) {
            risposta.destroy();
            fatto({ stato, troppo: true });
            return;
          }
          pezzi.push(pezzo);
        });
        risposta.on("end", () => fatto({ stato, dati: Buffer.concat(pezzi) }));
        risposta.on("error", fallito);
      },
    );
    const scadenza = setTimeout(() => richiesta.destroy(new Error("Il sito non ha risposto in tempo.")), ATTESA_MS);
    richiesta.on("close", () => clearTimeout(scadenza));
    richiesta.on("timeout", () => richiesta.destroy(new Error("Il sito non ha risposto in tempo.")));
    richiesta.on("error", fallito);
    richiesta.end();
  });

interface Ricordata {
  esito: EsitoImmagine;
  fino: number;
}

/**
 * Scarica le immagini esterne e le tiene un giorno in memoria: la stessa risposta riletta, sul
 * telefono e su Telegram, non le richiede al sito ogni volta.
 */
export class ImmaginiEsterne {
  readonly #scarica: Scarica;
  readonly #adesso: () => number;
  readonly #ricordate = new Map<string, Ricordata>();
  readonly #inCorso = new Map<string, Promise<EsitoImmagine>>();
  #occupati = 0;

  constructor(opzioni: { scarica?: Scarica; adesso?: () => number } = {}) {
    this.#scarica = opzioni.scarica ?? scaricaDavvero;
    this.#adesso = opzioni.adesso ?? Date.now;
  }

  /** L'immagine a quell'indirizzo, oppure il motivo per cui non c'è. Non lancia mai. */
  async leggi(scritto: string): Promise<EsitoImmagine> {
    const ricordata = this.#ricordate.get(scritto);
    if (ricordata !== undefined && ricordata.fino > this.#adesso()) {
      // L'ultima usata va in fondo: si dimenticano prima le altre.
      this.#ricordate.delete(scritto);
      this.#ricordate.set(scritto, ricordata);
      return ricordata.esito;
    }
    if (ricordata !== undefined) this.#dimentica(scritto);
    const gia = this.#inCorso.get(scritto);
    if (gia !== undefined) return gia;
    const lettura = this.#leggiDalSito(scritto).finally(() => this.#inCorso.delete(scritto));
    this.#inCorso.set(scritto, lettura);
    const esito = await lettura;
    this.#ricorda(scritto, esito);
    return esito;
  }

  async #leggiDalSito(scritto: string): Promise<EsitoImmagine> {
    let indirizzo = indirizzoAmmesso(scritto);
    for (let salti = 0; ; salti += 1) {
      if (!(indirizzo instanceof URL)) return indirizzo;
      let letto: Awaited<ReturnType<Scarica>>;
      try {
        letto = await this.#scarica(indirizzo);
      } catch (errore) {
        return { motivo: errore instanceof Error ? errore.message : String(errore) };
      }
      if (letto.dove !== undefined) {
        if (salti >= REINDIRIZZAMENTI_MASSIMI) return { motivo: "Troppi reindirizzamenti." };
        let prossimo: string;
        try {
          prossimo = new URL(letto.dove, indirizzo).href;
        } catch {
          return { motivo: "Il sito rimanda a un indirizzo che non si legge." };
        }
        indirizzo = indirizzoAmmesso(prossimo);
        continue;
      }
      if (letto.troppo === true) return { motivo: "L'immagine è troppo grande." };
      if (letto.stato !== 200 || letto.dati === undefined) return { motivo: `Il sito ha risposto ${letto.stato}.` };
      const tipo = tipoDaiByte(letto.dati);
      if (tipo === undefined) return { motivo: "Non è un'immagine che Shinka mostra (JPEG, PNG, GIF, WebP o AVIF)." };
      return { tipo, dati: letto.dati };
    }
  }

  #ricorda(scritto: string, esito: EsitoImmagine): void {
    const peso = "dati" in esito ? esito.dati.length : 0;
    if (peso > MEMORIA_MASSIMA / 4) return;
    this.#dimentica(scritto);
    this.#ricordate.set(scritto, { esito, fino: this.#adesso() + ("dati" in esito ? VALIDITA_MS : VALIDITA_RIFIUTO_MS) });
    this.#occupati += peso;
    for (const [vecchio] of this.#ricordate) {
      if (this.#occupati <= MEMORIA_MASSIMA && this.#ricordate.size <= 2000) break;
      this.#dimentica(vecchio);
    }
  }

  #dimentica(scritto: string): void {
    const voce = this.#ricordate.get(scritto);
    if (voce === undefined) return;
    if ("dati" in voce.esito) this.#occupati -= voce.esito.dati.length;
    this.#ricordate.delete(scritto);
  }
}

/** Le immagini scritte in un testo Markdown, nell'ordine: `![testo](https://…)`. */
export function immaginiDelTesto(markdown: string): { testo: string; indirizzo: string }[] {
  const trovate: { testo: string; indirizzo: string }[] = [];
  for (const [, testo, indirizzo] of markdown.matchAll(/!\[([^\]\n]*)\]\(\s*<?(https:\/\/(?:[^\s()<>]|\([^\s()<>]*\))+)>?(?:\s+"[^"\n]*")?\s*\)/g)) {
    if (indirizzo !== undefined && !trovate.some((gia) => gia.indirizzo === indirizzo)) trovate.push({ testo: (testo ?? "").trim(), indirizzo });
  }
  return trovate;
}
