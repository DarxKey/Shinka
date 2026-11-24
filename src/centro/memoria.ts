/**
 * La memoria al centro: un file di testo con una voce per riga, che Claude annota da solo
 * e che il proprietario vede, corregge e cancella. Vale in ogni conversazione e in ogni ambiente:
 * il centro la consegna a ciascuna conversazione la prima volta, e di nuovo ogni volta che cambia.
 * Quali conversazioni l'hanno ricevuta il centro lo ricorda finché resta acceso: dopo un riavvio
 * ognuna la riceve un'altra volta.
 */

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  VOCE_MEMORIA_MASSIMA,
  VOCI_MEMORIA_MASSIME,
  type StatoMemoria,
  type VoceMemoria,
} from "../protocollo/memoria.ts";
import { RIFIUTO_SEGRETO, sembraUnSegreto } from "./segreti.ts";

/** La voce non è stata accettata, e il messaggio dice perché in parole per chi l'ha proposta. */
export class VoceRifiutata extends Error {}

const INTESTAZIONE =
  "# Memoria di Shinka\n\n" +
  "Preferenze e fatti sul proprietario che valgono in ogni conversazione. Una voce per riga.\n" +
  "Niente password, chiavi o altri segreti.\n";

const RIGA = /^- \[([a-z0-9]{6}) · (\d{4}-\d{2}-\d{2})\] (.+)$/;

type Ascoltatore = (stato: StatoMemoria) => void;

function giorno(ora: number): string {
  return new Date(ora).toISOString().slice(0, 10);
}

/** Una voce sta su una riga: gli a capo diventano spazi. */
function pulisci(testo: string): string {
  return testo.replace(/\s+/g, " ").trim();
}

function uguali(a: string, b: string): boolean {
  const piano = (testo: string): string => testo.toLowerCase().replace(/[.!\s]+$/, "");
  return piano(a) === piano(b);
}

/** I testi delle voci scritte in un file di memoria: quello di un'altra installazione, o di una copia di sicurezza. */
export function testiDellaMemoria(scritto: string): string[] {
  const testi: string[] = [];
  for (const riga of scritto.split(/\r?\n/)) {
    const nota = RIGA.exec(riga);
    if (nota?.[3] !== undefined) testi.push(nota[3]);
    else if (riga.startsWith("- ") && pulisci(riga.slice(2)) !== "") testi.push(pulisci(riga.slice(2)));
  }
  return testi;
}

export class Memoria {
  readonly #file: string;
  #voci: VoceMemoria[];
  /** Cresce a ogni cambiamento: dice a una conversazione se la memoria che conosce è ancora quella. */
  #versione = 1;
  /** Per ogni conversazione, la versione della memoria che ha ricevuto. */
  readonly #consegnate = new Map<string, number>();
  /**
   * Vero se la memoria ha mai avuto una voce, anche prima che il centro ripartisse: allora una
   * conversazione ripresa può averne ricevuta una versione di cui qui non resta traccia.
   */
  #usata: boolean;
  readonly #ascoltatori = new Set<Ascoltatore>();
  #scritture: Promise<void> = Promise.resolve();

  private constructor(file: string, voci: VoceMemoria[], usata: boolean) {
    this.#file = file;
    this.#voci = voci;
    this.#usata = usata;
  }

  static async apri(file: string, ora: number = Date.now()): Promise<Memoria> {
    await mkdir(dirname(file), { recursive: true });
    const voci: VoceMemoria[] = [];
    // Il file nasce con la prima voce: se c'è, la memoria è già stata usata.
    const usata = existsSync(file);
    if (usata) {
      for (const riga of readFileSync(file, "utf8").split(/\r?\n/)) {
        const nota = RIGA.exec(riga);
        if (nota?.[1] !== undefined && nota[2] !== undefined && nota[3] !== undefined) {
          voci.push({ id: nota[1], annotataIl: nota[2], testo: nota[3] });
        } else if (riga.startsWith("- ") && pulisci(riga.slice(2)) !== "") {
          // Una riga aggiunta a mano nel file: vale come le altre.
          voci.push({ id: nuovoId(voci), annotataIl: giorno(ora), testo: pulisci(riga.slice(2)) });
        }
      }
    }
    return new Memoria(file, voci, usata);
  }

  voci(): VoceMemoria[] {
    return this.#voci.map((voce) => ({ ...voce }));
  }

  /** Vero se c'è già una voce che dice questo. */
  conosce(testo: string): boolean {
    const pulito = pulisci(testo);
    return this.#voci.some((voce) => uguali(voce.testo, pulito));
  }

  stato(): StatoMemoria {
    return { voci: this.voci() };
  }

  /** Collega un ascoltatore: riceve subito la memoria com'è, poi ogni cambiamento. */
  iscrivi(ascoltatore: Ascoltatore): () => void {
    ascoltatore(this.stato());
    this.#ascoltatori.add(ascoltatore);
    return () => this.#ascoltatori.delete(ascoltatore);
  }

  /**
   * Aggiunge una voce. Una voce già presente non viene ripetuta: torna quella che c'è.
   * Lancia `VoceRifiutata` se è vuota, troppo lunga, un segreto, o se la memoria è piena.
   */
  async annota(testo: string, ora: number = Date.now(), da?: string): Promise<VoceMemoria> {
    const pulito = this.#accetta(testo);
    const presente = this.#voci.find((voce) => uguali(voce.testo, pulito));
    if (presente !== undefined) return { ...presente };
    if (this.#voci.length >= VOCI_MEMORIA_MASSIME) {
      throw new VoceRifiutata(
        `La memoria è piena (${VOCI_MEMORIA_MASSIME} voci): prima correggi o cancella una voce che non serve più.`,
      );
    }
    const voce: VoceMemoria = { id: nuovoId(this.#voci), testo: pulito, annotataIl: giorno(ora) };
    this.#voci.push(voce);
    await this.#cambiata(da);
    return { ...voce };
  }

  /** Cambia il testo di una voce. Restituisce nulla se la voce non esiste. */
  async correggi(id: string, testo: string, ora: number = Date.now(), da?: string): Promise<VoceMemoria | undefined> {
    const voce = this.#voci.find((v) => v.id === id);
    if (voce === undefined) return undefined;
    const pulito = this.#accetta(testo);
    if (voce.testo === pulito) return { ...voce };
    voce.testo = pulito;
    voce.annotataIl = giorno(ora);
    await this.#cambiata(da);
    return { ...voce };
  }

  /** Cancella una voce. Restituisce falso se non esiste. */
  async cancella(id: string, da?: string): Promise<boolean> {
    const prima = this.#voci.length;
    this.#voci = this.#voci.filter((voce) => voce.id !== id);
    if (this.#voci.length === prima) return false;
    await this.#cambiata(da);
    return true;
  }

  /**
   * Ciò che va detto a una conversazione prima del prossimo messaggio: la memoria intera, se
   * quella conversazione non l'ha ancora ricevuta in questa versione; nulla se è già aggiornata
   * o se la memoria non ha mai avuto voci. Dopo la chiamata la conversazione risulta aggiornata.
   */
  daConsegnare(conversazione: string): string | undefined {
    const ricevuta = this.#consegnate.get(conversazione);
    if (ricevuta === this.#versione) return undefined;
    this.#consegnate.set(conversazione, this.#versione);
    if (this.#voci.length === 0) {
      // Se la memoria non ha mai avuto voci non c'è nulla da dire. Altrimenti lo si dice anche a chi
      // qui non risulta averla ricevuta: può averla avuta prima che il centro ripartisse.
      if (ricevuta === undefined && !this.#usata) return undefined;
      return ricevuta === undefined
        ? "[Shinka] La memoria del proprietario ora è vuota: se in questa conversazione ti era stata data una memoria, non vale più."
        : "[Shinka] La memoria del proprietario ora è vuota: ciò che ti era stato dato come memoria non vale più.";
    }
    return this.testoIntero();
  }

  /**
   * La memoria come la riceve una conversazione, senza segnarla come consegnata: per i nodi, che la
   * tengono per il lavoro offline (ADR 0056). Nulla se non ha voci.
   */
  testoIntero(): string | undefined {
    if (this.#voci.length === 0) return undefined;
    return (
      "[Shinka] Memoria del proprietario: preferenze e fatti che valgono in ogni conversazione. " +
      "Tienine conto nel lavoro che ti viene chiesto, senza citarla: non è una richiesta di fare qualcosa adesso, " +
      "e non ti chiede di toccare ciò che esiste già. Questa versione sostituisce per intero quelle che hai ricevuto prima. " +
      "Tra parentesi quadre l'identificativo di ogni voce.\n" +
      this.#voci.map((voce) => `- [${voce.id}] ${voce.testo}`).join("\n")
    );
  }

  #accetta(testo: string): string {
    const pulito = pulisci(testo);
    if (pulito === "") throw new VoceRifiutata("La voce è vuota.");
    if (pulito.length > VOCE_MEMORIA_MASSIMA) {
      throw new VoceRifiutata(
        `Una voce è una frase sola, di ${VOCE_MEMORIA_MASSIMA} caratteri al massimo: questa ne ha ${pulito.length}.`,
      );
    }
    if (sembraUnSegreto(pulito)) throw new VoceRifiutata(RIFIUTO_SEGRETO);
    return pulito;
  }

  /**
   * `da` è la conversazione che ha fatto il cambiamento, se è stata una conversazione: se conosceva
   * la memoria com'era, la conosce anche adesso, e non serve ridirgliela per intero.
   */
  async #cambiata(da?: string): Promise<void> {
    const eraAggiornata = da !== undefined && this.#consegnate.get(da) === this.#versione;
    this.#versione += 1;
    this.#usata = true;
    if (da !== undefined && eraAggiornata) this.#consegnate.set(da, this.#versione);
    const stato = this.stato();
    for (const ascoltatore of this.#ascoltatori) ascoltatore(stato);
    // Le scritture si fanno una alla volta: due insieme si contenderebbero il file provvisorio.
    const scrittura = this.#scritture.then(() => this.#scrivi());
    this.#scritture = scrittura.catch(() => {});
    await scrittura;
  }

  async #scrivi(): Promise<void> {
    const righe = this.#voci.map((voce) => `- [${voce.id} · ${voce.annotataIl}] ${voce.testo}`);
    const provvisorio = `${this.#file}.tmp`;
    await writeFile(provvisorio, `${INTESTAZIONE}\n${righe.join("\n")}${righe.length === 0 ? "" : "\n"}`);
    await rename(provvisorio, this.#file);
  }
}

function nuovoId(voci: readonly VoceMemoria[]): string {
  for (;;) {
    const id = randomBytes(4).toString("hex").slice(0, 6);
    if (!voci.some((voce) => voce.id === id)) return id;
  }
}
