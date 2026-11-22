/**
 * I terminali di un ambiente: per ogni progetto una shell vera nella sua cartella, che resta
 * accesa anche quando nessuno la guarda. Chi la riapre ritrova l'uscita recente.
 *
 * Un terminale si chiude quando lo chiude il proprietario, quando la shell finisce, dopo molte
 * ore senza attività, oppure quando si ferma il processo che lo tiene: il nodo, o il centro per
 * il suo ambiente.
 */

import { existsSync, statSync } from "node:fs";
import {
  INATTIVITA_MASSIMA_MS,
  TERMINALI_MASSIMI,
  USCITA_DA_PARTE,
  type ComandoTerminale,
  type PortaTerminali,
  type RiferitoTerminale,
} from "../protocollo/terminale.ts";

/** Una shell accesa, per come serve qui. */
export interface ShellAccesa {
  scrivi(dati: string): void;
  misura(colonne: number, righe: number): void;
  spegni(): void;
  allUscita(ascoltatore: (dati: string) => void): void;
  allaFine(ascoltatore: (codice: number) => void): void;
}

/** Accende una shell in una cartella. Nei test se ne mette una finta. */
export type AccendiShell = (cartella: string, colonne: number, righe: number) => Promise<ShellAccesa>;

export interface OpzioniTerminali {
  accendi?: AccendiShell;
  inattivitaMassimaMs?: number;
  /** Ogni quanto si controlla se un terminale è fermo da troppo. Zero: non si controlla da soli. */
  controlloMs?: number;
  /** Per quanto l'uscita si raccoglie prima di mandarla: una shell scrive a pezzetti. */
  raccoltaMs?: number;
}

/** Oltre questa misura l'uscita raccolta parte subito, senza aspettare. */
const RACCOLTA_MASSIMA = 32 * 1024;

interface Acceso {
  shell: ShellAccesa;
  /** L'uscita recente, per chi apre il terminale dopo. */
  finora: string;
  /** L'uscita raccolta e non ancora mandata. */
  daMandare: string;
  invio: NodeJS.Timeout | undefined;
  ultimaAttivita: number;
}

export class Terminali implements PortaTerminali {
  readonly #riferisci: (messaggio: RiferitoTerminale) => void;
  readonly #accendi: AccendiShell;
  readonly #inattivitaMassimaMs: number;
  readonly #raccoltaMs: number;
  readonly #accesi = new Map<string, Acceso>();
  /** I terminali che si stanno accendendo: chi arriva nel frattempo aspetta lo stesso. */
  readonly #accensioni = new Map<string, Promise<void>>();
  readonly #controllo: NodeJS.Timeout | undefined;

  constructor(riferisci: (messaggio: RiferitoTerminale) => void, opzioni: OpzioniTerminali = {}) {
    this.#riferisci = riferisci;
    this.#accendi = opzioni.accendi ?? accendiShellVera;
    this.#inattivitaMassimaMs = opzioni.inattivitaMassimaMs ?? INATTIVITA_MASSIMA_MS;
    this.#raccoltaMs = opzioni.raccoltaMs ?? 15;
    const controlloMs = opzioni.controlloMs ?? 60_000;
    if (controlloMs > 0) {
      this.#controllo = setInterval(() => this.chiudiInattivi(), controlloMs);
      this.#controllo.unref();
    }
  }

  esegui(comando: ComandoTerminale): void {
    switch (comando.tipo) {
      case "terminale-apri":
        void this.#apri(comando);
        return;
      case "terminale-scrivi": {
        const acceso = this.#accesi.get(comando.idTerminale);
        if (acceso === undefined) return;
        acceso.ultimaAttivita = Date.now();
        acceso.shell.scrivi(comando.dati);
        return;
      }
      case "terminale-misura":
        this.#misura(this.#accesi.get(comando.idTerminale), comando.colonne, comando.righe);
        return;
      case "terminale-chiudi":
        this.#chiudi(comando.idTerminale, "Terminale chiuso.");
        return;
    }
  }

  /** Quanti terminali sono accesi. */
  get accesi(): number {
    return this.#accesi.size;
  }

  /** Chiude i terminali fermi da troppo tempo. */
  chiudiInattivi(ora: number = Date.now()): void {
    for (const [idTerminale, acceso] of this.#accesi) {
      if (ora - acceso.ultimaAttivita <= this.#inattivitaMassimaMs) continue;
      const ore = Math.round(this.#inattivitaMassimaMs / 3_600_000);
      this.#chiudi(
        idTerminale,
        `Terminale chiuso dopo ${ore <= 1 ? "molto tempo" : `${ore} ore`} senza attività.`,
      );
    }
  }

  /** Il processo si ferma: i terminali si spengono con lui. */
  spegniTutti(): void {
    clearInterval(this.#controllo);
    for (const idTerminale of [...this.#accesi.keys()]) this.#chiudi(idTerminale, "L'ambiente si è fermato.");
  }

  async #apri(comando: Extract<ComandoTerminale, { tipo: "terminale-apri" }>): Promise<void> {
    const { idTerminale, cartella, colonne, righe } = comando;
    // Senza un'accensione in corso non si aspetta: chi arriva subito dopo deve trovarla già segnata.
    const inCorso = this.#accensioni.get(idTerminale);
    if (inCorso !== undefined) await inCorso;
    const acceso = this.#accesi.get(idTerminale);
    if (acceso !== undefined) {
      this.#misura(acceso, colonne, righe);
      // Prima parte ciò che era in attesa, per chi già guardava; chi apre adesso lo trova in `finora`.
      this.#manda(idTerminale, acceso);
      this.#riferisci({ tipo: "terminale-aperto", idTerminale, finora: acceso.finora });
      return;
    }
    if (this.#accesi.size >= TERMINALI_MASSIMI) {
      this.#riferisci({
        tipo: "terminale-chiuso",
        idTerminale,
        motivo: `In questo ambiente ci sono già ${TERMINALI_MASSIMI} terminali accesi: chiudine uno.`,
      });
      return;
    }
    if (!eUnaCartella(cartella)) {
      this.#riferisci({
        tipo: "terminale-chiuso",
        idTerminale,
        motivo: `La cartella del progetto non c'è in questo ambiente: ${cartella}`,
      });
      return;
    }
    const accensione = this.#accendiNuovo(idTerminale, cartella, colonne, righe);
    this.#accensioni.set(idTerminale, accensione);
    try {
      await accensione;
    } finally {
      this.#accensioni.delete(idTerminale);
    }
  }

  async #accendiNuovo(idTerminale: string, cartella: string, colonne: number, righe: number): Promise<void> {
    let shell: ShellAccesa;
    try {
      shell = await this.#accendi(cartella, colonne, righe);
    } catch (errore) {
      this.#riferisci({
        tipo: "terminale-chiuso",
        idTerminale,
        motivo: `Il terminale non si è acceso: ${errore instanceof Error ? errore.message : String(errore)}`,
      });
      return;
    }
    const acceso: Acceso = { shell, finora: "", daMandare: "", invio: undefined, ultimaAttivita: Date.now() };
    this.#accesi.set(idTerminale, acceso);
    shell.allUscita((dati) => {
      acceso.ultimaAttivita = Date.now();
      acceso.finora = recente(acceso.finora + dati);
      acceso.daMandare += dati;
      if (acceso.daMandare.length >= RACCOLTA_MASSIMA) this.#manda(idTerminale, acceso);
      else acceso.invio ??= setTimeout(() => this.#manda(idTerminale, acceso), this.#raccoltaMs);
    });
    shell.allaFine((codice) => {
      // Se lo abbiamo chiuso noi non c'è altro da dire.
      if (this.#accesi.get(idTerminale) !== acceso) return;
      this.#manda(idTerminale, acceso);
      this.#accesi.delete(idTerminale);
      this.#riferisci({
        tipo: "terminale-chiuso",
        idTerminale,
        motivo: codice === 0 ? "La shell è terminata." : `La shell è terminata con codice ${codice}.`,
      });
    });
    this.#riferisci({ tipo: "terminale-aperto", idTerminale, finora: "" });
  }

  #misura(acceso: Acceso | undefined, colonne: number, righe: number): void {
    try {
      acceso?.shell.misura(colonne, righe);
    } catch {
      // Una shell che sta finendo non si lascia più misurare: non importa.
    }
  }

  #manda(idTerminale: string, acceso: Acceso): void {
    clearTimeout(acceso.invio);
    acceso.invio = undefined;
    if (acceso.daMandare === "") return;
    const dati = acceso.daMandare;
    acceso.daMandare = "";
    this.#riferisci({ tipo: "terminale-uscita", idTerminale, dati });
  }

  #chiudi(idTerminale: string, motivo: string): void {
    const acceso = this.#accesi.get(idTerminale);
    if (acceso === undefined) return;
    this.#manda(idTerminale, acceso);
    this.#accesi.delete(idTerminale);
    try {
      acceso.shell.spegni();
    } catch {
      // Era già finita.
    }
    this.#riferisci({ tipo: "terminale-chiuso", idTerminale, motivo });
  }
}

/** Tiene la parte finale dell'uscita, cominciando se può dall'inizio di una riga. */
export function recente(uscita: string, massimo: number = USCITA_DA_PARTE): string {
  if (uscita.length <= massimo) return uscita;
  const coda = uscita.slice(uscita.length - massimo);
  const aCapo = coda.indexOf("\n");
  return aCapo >= 0 && aCapo < 4096 ? coda.slice(aCapo + 1) : coda;
}

function eUnaCartella(percorso: string): boolean {
  try {
    return statSync(percorso).isDirectory();
  } catch {
    return false;
  }
}

/** La shell di questa macchina: PowerShell su Windows, altrove quella dell'utente. */
export function shellDiQuestaMacchina(): [programma: string, argomenti: string[]] {
  if (process.platform === "win32") return ["powershell.exe", ["-NoLogo"]];
  const scelta = process.env.SHELL;
  if (scelta !== undefined && scelta !== "" && existsSync(scelta)) return [scelta, []];
  return [existsSync("/bin/bash") ? "/bin/bash" : "/bin/sh", []];
}

/** Le variabili d'ambiente della shell: quelle di questo processo, senza le impostazioni di Shinka. */
export function ambienteDellaShell(daQui: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const ambiente: Record<string, string> = {};
  for (const [nome, valore] of Object.entries(daQui)) {
    if (valore === undefined || nome.toUpperCase().startsWith("SHINKA_")) continue;
    ambiente[nome] = valore;
  }
  return { ...ambiente, TERM: "xterm-256color", COLORTERM: "truecolor" };
}

/** Accende una shell vera con node-pty, caricato solo quando serve: dove manca, il resto funziona lo stesso. */
const accendiShellVera: AccendiShell = async (cartella, colonne, righe) => {
  const modulo = await import("node-pty");
  const [programma, argomenti] = shellDiQuestaMacchina();
  const pty = modulo.spawn(programma, argomenti, {
    name: "xterm-256color",
    cols: colonne,
    rows: righe,
    cwd: cartella,
    env: ambienteDellaShell(),
  });
  return {
    scrivi: (dati) => pty.write(dati),
    misura: (c, r) => pty.resize(c, r),
    spegni: () => pty.kill(),
    allUscita: (ascoltatore) => void pty.onData(ascoltatore),
    allaFine: (ascoltatore) => void pty.onExit(({ exitCode }) => ascoltatore(exitCode)),
  };
};
