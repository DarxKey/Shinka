/**
 * Accesso del proprietario all'interfaccia: una password e le sessioni del browser.
 *
 * La password non viene mai conservata: su disco resta solo il suo derivato scrypt.
 * Dei token di sessione su disco resta solo l'impronta, così chi legge il file non può usarli.
 */

import type { SessioneInVista } from "../protocollo/sicurezza.ts";
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const LUNGHEZZA_MINIMA_PASSWORD = 10;
const DURATA_SESSIONE_MS = 30 * 24 * 60 * 60 * 1000;
const TENTATIVI_MASSIMI = 5;
const FINESTRA_TENTATIVI_MS = 5 * 60 * 1000;
/** Ogni quanto si controlla se la password è stata cambiata da un altro processo. */
const INTERVALLO_CONTROLLO_MS = 1000;
/** Quanti caratteri dell'impronta fanno l'identificativo di una sessione nella pagina degli accessi. */
const ID_SESSIONE = 16;

const PARAMETRI_SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;
const LUNGHEZZA_DERIVATO = 64;

interface FileProprietario {
  versione: 1;
  sale: string;
  derivato: string;
}

export type { SessioneInVista } from "../protocollo/sicurezza.ts";

export type EsitoEntrata =
  | { esito: "ok"; token: string; durataMs: number }
  | { esito: "rifiutato" }
  | { esito: "troppi-tentativi"; riprovaTraMs: number };

/** Da dove arriva una richiesta, e con che cosa: per ricordare chi ha aperto una sessione. */
export interface ChiEntra {
  /** L'indirizzo da cui arriva, con quello per conto di cui dice di arrivare se passa da un proxy. */
  da: string;
  /** Il programma: "iPhone · Safari", "PC Windows · Chrome". */
  programma: string;
}

/** Una sessione del proprietario, e ciò che se ne sa. Le sessioni di prima di questa versione hanno solo la scadenza. */
interface Sessione {
  scade: number;
  aperta?: number;
  da?: string;
  programma?: string;
  /** L'ultima volta che è stata usata, e da dove. */
  vista?: number;
  vistaDa?: string;
}

/** Ogni quanto l'ultimo uso di una sessione finisce sul disco. */
const USO_SALVATO_OGNI_MS = 10 * 60 * 1000;

export class Accesso {
  readonly #cartella: string;
  #proprietario: FileProprietario | undefined;
  /** Impronta del token → la sessione. */
  #sessioni = new Map<string, Sessione>();
  #usoSalvato = 0;
  #tentativiFalliti: number[] = [];
  /** Data di modifica del file della password all'ultima lettura; 0 se non esisteva. */
  #modificaLetta = -1;
  #ultimoControllo = Number.NEGATIVE_INFINITY;

  private constructor(cartella: string) {
    this.#cartella = cartella;
  }

  static async apri(cartella: string): Promise<Accesso> {
    await mkdir(cartella, { recursive: true });
    const accesso = new Accesso(cartella);
    accesso.#sincronizza(Date.now());
    return accesso;
  }

  /** Vero quando il proprietario ha già scelto la sua password. */
  get configurato(): boolean {
    this.#sincronizza(Date.now());
    return this.#proprietario !== undefined;
  }

  /**
   * La password si imposta con un comando a parte, mentre il centro è acceso.
   * Se il suo file è cambiato, password e sessioni vengono rilette dal disco:
   * così la password nuova vale subito e le sessioni vecchie si chiudono.
   */
  #sincronizza(ora: number): void {
    if (ora - this.#ultimoControllo < INTERVALLO_CONTROLLO_MS) return;
    this.#ultimoControllo = ora;
    const modifica = dataDiModifica(join(this.#cartella, "proprietario.json"));
    if (modifica === this.#modificaLetta) return;
    this.#modificaLetta = modifica;
    this.#proprietario = leggiJson<FileProprietario>(join(this.#cartella, "proprietario.json"));
    const sessioni = leggiJson<Record<string, number | Sessione>>(join(this.#cartella, "sessioni.json"));
    // Prima di questa versione di ogni sessione si teneva solo la scadenza.
    this.#sessioni = new Map(Object.entries(sessioni ?? {}).map(([chiave, valore]) => [chiave, typeof valore === "number" ? { scade: valore } : valore]));
  }

  async impostaPassword(password: string): Promise<void> {
    if (password.length < LUNGHEZZA_MINIMA_PASSWORD) {
      throw new Error(`La password deve avere almeno ${LUNGHEZZA_MINIMA_PASSWORD} caratteri.`);
    }
    const sale = randomBytes(16);
    const derivato = await deriva(password, sale);
    this.#proprietario = {
      versione: 1,
      sale: sale.toString("base64"),
      derivato: derivato.toString("base64"),
    };
    // Cambiare password chiude tutte le sessioni aperte. Le sessioni si salvano per prime:
    // chi si accorge della password nuova deve già trovare l'elenco vuoto.
    this.#sessioni.clear();
    await this.#salvaSessioni();
    await scriviJson(join(this.#cartella, "proprietario.json"), this.#proprietario);
    this.#modificaLetta = dataDiModifica(join(this.#cartella, "proprietario.json"));
  }

  /**
   * Cambia la password dalla pagina Impostazioni: serve quella attuale, con lo stesso limite ai
   * tentativi dell'entrata. Le sessioni aperte si chiudono tutte, e chi l'ha cambiata riceve
   * subito una sessione nuova, così resta dentro.
   */
  async cambiaPassword(attuale: string, nuova: string, ora: number = Date.now(), chi?: ChiEntra): Promise<EsitoEntrata> {
    const controllo = await this.#controlla(attuale, ora);
    if (controllo !== undefined) return controllo;
    await this.impostaPassword(nuova);
    return this.#apriSessione(ora, chi);
  }

  /**
   * Dice se la password è quella del proprietario, senza aprire sessioni: per ciò che va confermato
   * una seconda volta, come un ripristino. Ha lo stesso limite ai tentativi dell'entrata.
   */
  async conferma(password: string, ora: number = Date.now()): Promise<"ok" | Exclude<EsitoEntrata, { esito: "ok" }>> {
    return (await this.#controlla(password, ora)) ?? "ok";
  }

  async entra(password: string, ora: number = Date.now(), chi?: ChiEntra): Promise<EsitoEntrata> {
    const controllo = await this.#controlla(password, ora);
    return controllo ?? this.#apriSessione(ora, chi);
  }

  /** Undefined se la password è giusta; altrimenti com'è andata. */
  async #controlla(password: string, ora: number): Promise<Exclude<EsitoEntrata, { esito: "ok" }> | undefined> {
    this.#sincronizza(ora);
    this.#tentativiFalliti = this.#tentativiFalliti.filter((t) => ora - t < FINESTRA_TENTATIVI_MS);
    const piuVecchio = this.#tentativiFalliti[0];
    if (this.#tentativiFalliti.length >= TENTATIVI_MASSIMI && piuVecchio !== undefined) {
      return { esito: "troppi-tentativi", riprovaTraMs: piuVecchio + FINESTRA_TENTATIVI_MS - ora };
    }

    const proprietario = this.#proprietario;
    const corretta =
      proprietario !== undefined &&
      timingSafeEqual(
        await deriva(password, Buffer.from(proprietario.sale, "base64")),
        Buffer.from(proprietario.derivato, "base64"),
      );
    if (!corretta) {
      this.#tentativiFalliti.push(ora);
      return { esito: "rifiutato" };
    }

    this.#tentativiFalliti = [];
    return undefined;
  }

  async #apriSessione(ora: number, chi?: ChiEntra): Promise<EsitoEntrata> {
    const token = randomBytes(32).toString("base64url");
    this.#sessioni.set(impronta(token), {
      scade: ora + DURATA_SESSIONE_MS,
      aperta: ora,
      ...(chi === undefined ? {} : { da: chi.da, programma: chi.programma, vista: ora, vistaDa: chi.da }),
    });
    await this.#salvaSessioni(ora);
    return { esito: "ok", token, durataMs: DURATA_SESSIONE_MS };
  }

  valida(token: string | undefined, ora: number = Date.now()): boolean {
    this.#sincronizza(ora);
    if (token === undefined || token === "") return false;
    const sessione = this.#sessioni.get(impronta(token));
    return sessione !== undefined && sessione.scade > ora;
  }

  /** Una sessione valida è stata usata: si ricorda quando e da dove. Sul disco finisce ogni tanto, non a ogni richiesta. */
  segna(token: string | undefined, chi: ChiEntra, ora: number = Date.now()): void {
    if (token === undefined) return;
    const sessione = this.#sessioni.get(impronta(token));
    if (sessione === undefined) return;
    sessione.vista = ora;
    sessione.vistaDa = chi.da;
    sessione.programma ??= chi.programma;
    if (ora - this.#usoSalvato < USO_SALVATO_OGNI_MS) return;
    this.#usoSalvato = ora;
    void this.#salvaSessioni(ora).catch(() => {});
  }

  /** L'identificativo, per la pagina degli accessi, della sessione di questo token. */
  idDi(token: string | undefined): string | undefined {
    if (token === undefined || token === "") return undefined;
    const propria = impronta(token);
    return this.#sessioni.has(propria) ? propria.slice(0, ID_SESSIONE) : undefined;
  }

  /** Le sessioni aperte, dalla più usata di recente. */
  sessioni(ora: number = Date.now()): SessioneInVista[] {
    this.#sincronizza(ora);
    const quando = (ms: number | undefined): string | undefined => (ms === undefined ? undefined : new Date(ms).toISOString());
    return [...this.#sessioni]
      .filter(([, sessione]) => sessione.scade > ora)
      .sort(([, a], [, b]) => (b.vista ?? b.aperta ?? 0) - (a.vista ?? a.aperta ?? 0))
      .map(([chiave, sessione]) => ({
        id: chiave.slice(0, ID_SESSIONE),
        ...(quando(sessione.aperta) === undefined ? {} : { apertaIl: quando(sessione.aperta) as string }),
        ...(sessione.da === undefined ? {} : { da: sessione.da }),
        ...(sessione.programma === undefined ? {} : { programma: sessione.programma }),
        ...(quando(sessione.vista) === undefined ? {} : { vistaIl: quando(sessione.vista) as string }),
        ...(sessione.vistaDa === undefined ? {} : { vistaDa: sessione.vistaDa }),
        scadeIl: new Date(sessione.scade).toISOString(),
      }));
  }

  /** Chiude una sessione dal suo identificativo: quel browser dovrà rientrare. Falso se non c'è. */
  async chiudiSessione(id: string): Promise<boolean> {
    const chiave = [...this.#sessioni.keys()].find((una) => id.length === ID_SESSIONE && una.startsWith(id));
    if (chiave === undefined) return false;
    this.#sessioni.delete(chiave);
    await this.#salvaSessioni();
    return true;
  }

  /** Chiude tutte le sessioni tranne quella di questo token. Restituisce quante. */
  async chiudiLeAltre(token: string | undefined): Promise<number> {
    const propria = token === undefined ? undefined : impronta(token);
    const adesso = Date.now();
    const altre = [...this.#sessioni].filter(([chiave]) => chiave !== propria);
    for (const [chiave] of altre) this.#sessioni.delete(chiave);
    if (altre.length > 0) await this.#salvaSessioni();
    // Quelle già scadute non erano più aperte: non si contano.
    return altre.filter(([, sessione]) => sessione.scade > adesso).length;
  }

  async esci(token: string | undefined): Promise<void> {
    if (token === undefined) return;
    if (this.#sessioni.delete(impronta(token))) await this.#salvaSessioni();
  }

  async #salvaSessioni(ora: number = Date.now()): Promise<void> {
    for (const [chiave, sessione] of this.#sessioni) {
      if (sessione.scade <= ora) this.#sessioni.delete(chiave);
    }
    await scriviJson(join(this.#cartella, "sessioni.json"), Object.fromEntries(this.#sessioni));
  }
}

function impronta(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function deriva(password: string, sale: Buffer): Promise<Buffer> {
  return new Promise((risolvi, rifiuta) => {
    scrypt(password, sale, LUNGHEZZA_DERIVATO, PARAMETRI_SCRYPT, (errore, derivato) => {
      if (errore) rifiuta(errore);
      else risolvi(derivato);
    });
  });
}

function leggiJson<T>(file: string): T | undefined {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch (errore) {
    if (errore instanceof Error && "code" in errore && errore.code === "ENOENT") return undefined;
    throw errore;
  }
}

/** Data di modifica in millisecondi, oppure 0 se il file non esiste. */
function dataDiModifica(file: string): number {
  try {
    return statSync(file).mtimeMs;
  } catch (errore) {
    if (errore instanceof Error && "code" in errore && errore.code === "ENOENT") return 0;
    throw errore;
  }
}

/** Scrive su un file provvisorio e poi lo rinomina: il file vero non resta mai a metà. */
async function scriviJson(file: string, valore: unknown): Promise<void> {
  const provvisorio = `${file}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(provvisorio, JSON.stringify(valore, null, 2), { mode: 0o600 });
  await rename(provvisorio, file);
}
