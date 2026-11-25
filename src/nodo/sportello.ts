/**
 * Lo sportello del nodo (ADR 0056): un piccolo server su `127.0.0.1`, mai dalla rete, con cui chi
 * sta su questa macchina (Shinka Desktop) lavora ai progetti dell'ambiente quando il centro non si
 * raggiunge. Porta e gettone stanno in `sportello.json` tra i dati del nodo: li legge solo chi è
 * questo utente su questa macchina. Le rotte hanno le forme di quelle del centro per i progetti.
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import { writeFile, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { azioneIntera } from "../centro/storia-leggera.ts";
import { leggiAllegati } from "../protocollo/allegati.ts";
import { FINE_STORIA, leggiRispostaAlleDomande, type EventoArchiviato } from "../protocollo/eventi.ts";
import { IMPEGNI, MODI_PERMESSI, eMotore, type ModificaImpostazioni } from "../protocollo/impostazioni.ts";
import { FILE_SPORTELLO, type IndirizzoDelloSportello, type StatoDelloSportello } from "../protocollo/offline.ts";
import { ProgettoOfflineRifiutato, type LavoroOffline } from "./offline.ts";

/** Quanto può pesare una richiesta: un messaggio con i suoi allegati, come al centro. */
const CORPO_MASSIMO = 16 * 1024 * 1024;
const BATTITO_MS = 20_000;

export interface OpzioniSportello {
  offline: LavoroOffline;
  /** La cartella dei dati del nodo: lì si scrive `sportello.json`. */
  dati: string;
  idAmbiente: string;
  nome: string;
  sistema: string;
  radiceProgetti: string;
  /** La porta su cui ascoltare: 0, il predefinito, ne sceglie una libera. */
  porta?: number;
}

export class Sportello {
  readonly #o: OpzioniSportello;
  readonly #gettone = randomBytes(32).toString("base64url");
  #server: Server | undefined;

  constructor(opzioni: OpzioniSportello) {
    this.#o = opzioni;
  }

  /** Apre lo sportello e scrive dove trovarlo. */
  async apri(): Promise<IndirizzoDelloSportello> {
    const server = createServer((richiesta, risposta) => {
      void this.#rispondi(richiesta, risposta).catch((errore: unknown) => {
        if (risposta.headersSent) {
          risposta.end();
          return;
        }
        const stato = errore instanceof ProgettoOfflineRifiutato ? errore.stato : 500;
        manda(risposta, stato, { errore: errore instanceof Error ? errore.message : String(errore) });
      });
    });
    this.#server = server;
    await new Promise<void>((risolvi, rifiuta) => {
      server.once("error", rifiuta);
      server.listen({ host: "127.0.0.1", port: this.#o.porta ?? 0 }, () => risolvi());
    });
    const indirizzo: IndirizzoDelloSportello = {
      porta: (server.address() as AddressInfo).port,
      gettone: this.#gettone,
      idAmbiente: this.#o.idAmbiente,
      nome: this.#o.nome,
    };
    await writeFile(join(this.#o.dati, FILE_SPORTELLO), `${JSON.stringify(indirizzo, null, 2)}\n`, { mode: 0o600 });
    return indirizzo;
  }

  async chiudi(): Promise<void> {
    await rm(join(this.#o.dati, FILE_SPORTELLO), { force: true });
    const server = this.#server;
    this.#server = undefined;
    if (server === undefined) return;
    server.closeAllConnections();
    await new Promise<void>((risolvi) => server.close(() => risolvi()));
  }

  stato(): StatoDelloSportello {
    return {
      idAmbiente: this.#o.idAmbiente,
      nome: this.#o.nome,
      sistema: this.#o.sistema,
      radiceProgetti: this.#o.radiceProgetti,
      collegato: this.#o.offline.eCollegato,
      progetti: this.#o.offline.elenco(),
    };
  }

  #autorizzata(richiesta: IncomingMessage): boolean {
    const intestazione = richiesta.headers.authorization ?? "";
    const dato = /^Bearer (.+)$/.exec(intestazione)?.[1] ?? "";
    const atteso = Buffer.from(this.#gettone);
    const ricevuto = Buffer.from(dato);
    return ricevuto.length === atteso.length && timingSafeEqual(ricevuto, atteso);
  }

  async #rispondi(richiesta: IncomingMessage, risposta: ServerResponse): Promise<void> {
    // Una pagina web non deve poter parlare con lo sportello: niente origine, e solo l'indirizzo di questa macchina.
    const host = richiesta.headers.host ?? "";
    if (richiesta.headers.origin !== undefined || !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) {
      manda(risposta, 403, { errore: "Lo sportello risponde solo ai programmi di questa macchina." });
      return;
    }
    if (!this.#autorizzata(richiesta)) {
      manda(risposta, 401, { errore: "Gettone dello sportello mancante o sbagliato." });
      return;
    }
    const indirizzo = new URL(richiesta.url ?? "/", "http://127.0.0.1");
    const metodo = richiesta.method ?? "GET";
    const percorso = indirizzo.pathname;
    const offline = this.#o.offline;

    if (percorso === "/api/sportello" && metodo === "GET") {
      manda(risposta, 200, this.stato());
      return;
    }
    if (percorso === "/api/progetti" && metodo === "POST") {
      const corpo = await leggiCorpo(richiesta);
      const nome = typeof corpo.nome === "string" ? corpo.nome : "";
      const brief = typeof corpo.brief === "string" ? corpo.brief : "";
      manda(risposta, 201, await offline.creaProgetto(nome, brief));
      return;
    }

    const trovato = /^\/api\/progetti\/([0-9a-f-]{36})(\/.*)?$/.exec(percorso);
    if (trovato === null) {
      manda(risposta, 404, { errore: "Allo sportello questa rotta non c'è." });
      return;
    }
    const id = trovato[1] ?? "";
    const resto = trovato[2] ?? "";

    if (resto === "/eventi" && metodo === "GET") {
      const canale = await offline.canale(id);
      const versione = indirizzo.searchParams.get("versione");
      const dopo = Number(indirizzo.searchParams.get("dopo") ?? "0");
      const da = versione === null ? undefined : { dopo: Number.isInteger(dopo) && dopo >= 0 ? dopo : 0, versione: versione.slice(0, 64) };
      const riprende = da !== undefined && canale.riprendibile(da.dopo, da.versione);
      risposta.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Content-Type-Options": "nosniff",
      });
      risposta.write("retry: 2000\n\n");
      const scrivi = (dato: unknown, nome?: string): void => {
        risposta.write(`${nome === undefined ? "" : `event: ${nome}\n`}data: ${JSON.stringify(dato)}\n\n`);
      };
      if (da !== undefined && !riprende) scrivi({}, "azzera");
      const smetti = canale.iscrivi((archiviato: EventoArchiviato) => scrivi(archiviato), riprende ? da.dopo : 0);
      scrivi(canale.indice, FINE_STORIA);
      const battito = setInterval(() => risposta.write(": battito\n\n"), BATTITO_MS);
      richiesta.on("close", () => {
        clearInterval(battito);
        smetti();
      });
      return;
    }
    if (resto === "/storia" && metodo === "GET") {
      const canale = await offline.canale(id);
      const numero = (nome: string): number | undefined => {
        const valore = indirizzo.searchParams.get(nome);
        return valore !== null && /^\d{1,12}$/.test(valore) ? Number(valore) : undefined;
      };
      const dopo = numero("dopo");
      const limite = numero("limite");
      const versione = indirizzo.searchParams.get("versione");
      manda(risposta, 200, canale.storiaDopo({ ...(dopo === undefined ? {} : { dopo }), ...(limite === undefined ? {} : { limite }), ...(versione === null ? {} : { versione }) }));
      return;
    }
    const azione = /^\/azioni\/([^/]+)$/.exec(resto);
    if (azione !== null && metodo === "GET") {
      const canale = offline.canaleAperto(id);
      const intera = canale === undefined ? undefined : azioneIntera(canale.archiviati, decodeURIComponent(azione[1] ?? ""));
      if (intera === undefined) manda(risposta, 404, { errore: "Azione non trovata." });
      else manda(risposta, 200, intera);
      return;
    }
    if (resto === "/messaggi" && metodo === "POST") {
      const corpo = await leggiCorpo(richiesta);
      const allegati = leggiAllegati(corpo.allegati);
      if (allegati === undefined) {
        manda(risposta, 400, { errore: "Gli allegati sono troppi, troppo pesanti o non leggibili." });
        return;
      }
      const testo = typeof corpo.testo === "string" ? corpo.testo.trim() : "";
      if (testo === "" && allegati.length === 0) {
        manda(risposta, 400, { errore: "Il messaggio è vuoto." });
        return;
      }
      await offline.invia(id, testo, allegati);
      manda(risposta, 202, { accettato: true });
      return;
    }
    if (resto === "/interrompi" && metodo === "POST") {
      await offline.interrompi(id);
      manda(risposta, 200, { interrotto: true });
      return;
    }
    const permesso = /^\/permessi\/([^/]+)$/.exec(resto);
    if (permesso !== null && metodo === "POST") {
      const corpo = await leggiCorpo(richiesta);
      if (corpo.decisione !== "approvato" && corpo.decisione !== "negato") {
        manda(risposta, 400, { errore: "La decisione è approvato oppure negato." });
        return;
      }
      if (!offline.decidiPermesso(id, decodeURIComponent(permesso[1] ?? ""), corpo.decisione, corpo.sempre === true)) {
        manda(risposta, 404, { errore: "Questo permesso non è più in attesa." });
        return;
      }
      manda(risposta, 200, { deciso: true });
      return;
    }
    const domande = /^\/domande\/([^/]+)$/.exec(resto);
    if (domande !== null && metodo === "POST") {
      const corpo = await leggiCorpo(richiesta);
      const letta = leggiRispostaAlleDomande(corpo.risposta);
      if (letta === undefined) {
        manda(risposta, 400, { errore: "Risposta alle domande non valida." });
        return;
      }
      if (!offline.rispondiDomande(id, decodeURIComponent(domande[1] ?? ""), letta)) {
        manda(risposta, 404, { errore: "Queste domande non aspettano più una risposta." });
        return;
      }
      manda(risposta, 200, { risposto: true });
      return;
    }
    if (resto === "/impostazioni" && metodo === "PUT") {
      const modifica = leggiModifica(await leggiCorpo(richiesta));
      if (modifica === undefined) {
        manda(risposta, 400, { errore: "Impostazioni non valide." });
        return;
      }
      manda(risposta, 200, { impostazioni: await offline.cambiaImpostazioni(id, modifica) });
      return;
    }
    manda(risposta, 404, { errore: "Allo sportello questa rotta non c'è." });
  }
}

function manda(risposta: ServerResponse, stato: number, dati: unknown): void {
  const testo = JSON.stringify(dati);
  risposta.writeHead(stato, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Content-Length": Buffer.byteLength(testo) });
  risposta.end(testo);
}

async function leggiCorpo(richiesta: IncomingMessage): Promise<Record<string, unknown>> {
  const pezzi: Buffer[] = [];
  let peso = 0;
  for await (const pezzo of richiesta) {
    const dati = pezzo as Buffer;
    peso += dati.length;
    if (peso > CORPO_MASSIMO) throw new ProgettoOfflineRifiutato(413, "La richiesta è troppo pesante.");
    pezzi.push(dati);
  }
  if (peso === 0) return {};
  try {
    const letto: unknown = JSON.parse(Buffer.concat(pezzi).toString("utf8"));
    if (typeof letto === "object" && letto !== null && !Array.isArray(letto)) return letto as Record<string, unknown>;
  } catch {
    // Sotto.
  }
  throw new ProgettoOfflineRifiutato(400, "Il corpo della richiesta non è JSON.");
}

/** Le impostazioni che offline si possono cambiare: motore, modello, impegno, permessi. Lo stile resta com'è. */
function leggiModifica(corpo: Record<string, unknown>): ModificaImpostazioni | undefined {
  const modifica: ModificaImpostazioni = {};
  for (const [chiave, valore] of Object.entries(corpo)) {
    switch (chiave) {
      case "motore":
        if (valore !== null && !eMotore(valore)) return undefined;
        modifica.motore = valore;
        break;
      case "modello":
        if (valore !== null && (typeof valore !== "string" || valore.length > 200)) return undefined;
        modifica.modello = valore;
        break;
      case "impegno":
        if (valore !== null && !(IMPEGNI as readonly unknown[]).includes(valore)) return undefined;
        modifica.impegno = valore as ModificaImpostazioni["impegno"];
        break;
      case "permessi":
        if (!(MODI_PERMESSI as readonly unknown[]).includes(valore)) return undefined;
        modifica.permessi = valore as ModificaImpostazioni["permessi"];
        break;
      case "tuttoIlPc":
        if (valore !== null && typeof valore !== "boolean") return undefined;
        modifica.tuttoIlPc = valore;
        break;
      case "browserChrome":
        if (valore !== null && typeof valore !== "boolean") return undefined;
        modifica.browserChrome = valore;
        break;
      case "cartelleInPiu":
        if (valore !== null && !Array.isArray(valore)) return undefined;
        modifica.cartelleInPiu = valore as string[] | null;
        break;
      case "stile":
        break;
      default:
        return undefined;
    }
  }
  return modifica;
}
