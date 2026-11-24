/**
 * Gli aggiornamenti dall'originale (ADR 0059). Un'installazione nata come fork della copia pubblica
 * di Shinka sa da dove viene (`SHINKA_ORIGINALE`, di solito https://github.com/DarxKey/Shinka): ogni
 * tanto guarda se lì ci sono versioni che lei non ha. Se ce ne sono, la Home lo dice con la scheda di
 * uno sviluppo di Shinka: con il sì del proprietario il progetto Shinka le fonde con le modifiche
 * fatte qui, rifà le prove e chiede l'installazione come sempre. Nulla entra da solo.
 */

import { execFile } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import type { StatoOriginale } from "../protocollo/originale.ts";

/** Ogni quanto si guarda l'originale. */
const OGNI_MS = 6 * 60 * 60 * 1000;
/** Quanto si aspetta dopo l'avvio, prima di guardare la prima volta. */
const DOPO_L_AVVIO_MS = 2 * 60 * 1000;
/** Il riferimento, nel repository, in cui si tiene la cima dell'originale. */
export const RIFERIMENTO_ORIGINALE = "refs/originale/main";

type Git = (cartella: string, argomenti: string[]) => Promise<{ codice: number; uscita: string }>;

const gitVero: Git = (cartella, argomenti) =>
  new Promise((fatto) => {
    execFile("git", ["-C", cartella, ...argomenti], { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 }, (errore, uscita, errori) => {
      fatto({ codice: errore === null ? 0 : 1, uscita: `${String(uscita)}${errore === null ? "" : String(errori)}`.trim() });
    });
  });

export interface OpzioniOriginale {
  /** Il repository di questa Shinka (`SHINKA_REPOSITORY`). */
  repository: string;
  /** Da dove vengono le versioni: l'indirizzo Git della copia originale. */
  originale: string;
  /** Il file in cui si ricorda fin dove si è già proposto, tra i dati del centro. */
  file: string;
  /** Mostra la scheda di uno sviluppo di Shinka nella Home. */
  proponi(proposta: { titolo: string; richiesta: string }): void;
  git?: Git;
  adesso?: () => number;
  ogniMs?: number;
}

interface Ricordato {
  /** La cima dell'originale già proposta: la stessa non si ripropone. */
  proposta?: string;
  ultimoControllo?: string;
}

export class AggiornamentiDallOriginale {
  readonly #o: OpzioniOriginale;
  readonly #git: Git;
  #stato: StatoOriginale;
  #ricordato: Ricordato;
  #timer: NodeJS.Timeout | undefined;
  #inCorso: Promise<StatoOriginale> | undefined;

  constructor(opzioni: OpzioniOriginale) {
    this.#o = opzioni;
    this.#git = opzioni.git ?? gitVero;
    this.#ricordato = leggi(opzioni.file);
    this.#stato = { originale: opzioni.originale, nuovi: 0, titoli: [], ...(this.#ricordato.ultimoControllo === undefined ? {} : { ultimoControllo: this.#ricordato.ultimoControllo }) };
  }

  stato(): StatoOriginale {
    return this.#stato;
  }

  /** Comincia a guardare l'originale: poco dopo l'avvio, poi ogni sei ore. */
  avvia(): void {
    const giro = (attesa: number): void => {
      this.#timer = setTimeout(() => {
        void this.controlla().finally(() => giro(this.#o.ogniMs ?? OGNI_MS));
      }, attesa);
      this.#timer.unref();
    };
    giro(DOPO_L_AVVIO_MS);
  }

  chiudi(): void {
    clearTimeout(this.#timer);
  }

  /** Guarda adesso: prende la cima dell'originale, conta le versioni che qui mancano, e se sono nuove le propone. */
  controlla(): Promise<StatoOriginale> {
    this.#inCorso ??= this.#controlla().finally(() => {
      this.#inCorso = undefined;
    });
    return this.#inCorso;
  }

  async #controlla(): Promise<StatoOriginale> {
    const quando = new Date(this.#o.adesso?.() ?? Date.now()).toISOString();
    const { repository, originale } = this.#o;
    const preso = await this.#git(repository, ["fetch", "--quiet", "--no-tags", originale, `+refs/heads/main:${RIFERIMENTO_ORIGINALE}`]);
    if (preso.codice !== 0) {
      this.#stato = { ...this.#stato, ultimoControllo: quando, motivo: `L'originale non si è potuto leggere: ${ultimaRiga(preso.uscita)}` };
      return this.#stato;
    }
    const intervallo = `main..${RIFERIMENTO_ORIGINALE}`;
    const [conto, titoli, cima] = await Promise.all([
      this.#git(repository, ["rev-list", "--count", "--first-parent", intervallo]),
      this.#git(repository, ["log", "--first-parent", "--format=%s", "-n", "30", intervallo]),
      this.#git(repository, ["rev-parse", RIFERIMENTO_ORIGINALE]),
    ]);
    const nuovi = conto.codice === 0 ? Number(conto.uscita) || 0 : 0;
    this.#stato = {
      originale,
      nuovi,
      titoli: titoli.codice === 0 && titoli.uscita !== "" ? titoli.uscita.split("\n") : [],
      ultimoControllo: quando,
      ...(cima.codice === 0 ? { cima: cima.uscita.slice(0, 12) } : {}),
    };
    this.#ricordato.ultimoControllo = quando;
    if (nuovi > 0 && cima.codice === 0 && this.#ricordato.proposta !== cima.uscita) {
      this.#o.proponi(propostaDegliAggiornamenti(originale, this.#stato));
      this.#ricordato.proposta = cima.uscita;
      this.#stato = { ...this.#stato, proposti: true };
    } else if (nuovi > 0) {
      this.#stato = { ...this.#stato, proposti: true };
    }
    scrivi(this.#o.file, this.#ricordato);
    return this.#stato;
  }
}

/** La scheda per il proprietario e le istruzioni per il progetto Shinka. */
export function propostaDegliAggiornamenti(originale: string, stato: StatoOriginale): { titolo: string; richiesta: string } {
  const quante = stato.nuovi === 1 ? "una versione nuova" : `${stato.nuovi} versioni nuove`;
  const elenco = stato.titoli.map((titolo) => `- ${titolo}`).join("\n");
  return {
    titolo: `Aggiornamenti dall'originale: ${quante}`,
    richiesta:
      `La copia originale di Shinka (${originale}) ha ${quante} rispetto a questa installazione${stato.cima === undefined ? "" : ` (fino a ${stato.cima})`}:\n${elenco}` +
      (stato.nuovi > stato.titoli.length ? `\n- … e altre ${stato.nuovi - stato.titoli.length}` : "") +
      "\n\nPortale qui (ADR 0059):\n" +
      `1. Nella cartella del progetto, sul ramo main: \`git fetch ${originale} main\` e poi \`git merge --no-edit FETCH_HEAD\`.\n` +
      "2. Se ci sono conflitti, risolvili tenendo le modifiche fatte in questa installazione e facendo entrare quelle dell'originale; se una scelta non è ovvia, chiedila al proprietario.\n" +
      "3. Se `package-lock.json` è cambiato, `npm ci`. Poi `npm run typecheck`, `npm run costruisci` e la suite intera (`npm test`): l'aggiornamento tocca parti condivise.\n" +
      "4. Registra la fusione e chiedi l'installazione, con un riassunto per il proprietario di ciò che arriva dall'originale e, se c'erano, di come hai risolto i conflitti.",
  };
}

function ultimaRiga(testo: string): string {
  return (
    testo
      .split("\n")
      .map((riga) => riga.trim())
      .filter((riga) => riga !== "")
      .at(-1) ?? "nessuna risposta"
  ).slice(0, 300);
}

function leggi(file: string): Ricordato {
  try {
    const letto = JSON.parse(readFileSync(file, "utf8")) as Ricordato;
    return typeof letto === "object" && letto !== null ? letto : {};
  } catch {
    return {};
  }
}

function scrivi(file: string, ricordato: Ricordato): void {
  try {
    writeFileSync(file, `${JSON.stringify(ricordato, null, 2)}\n`);
  } catch {
    // Se non si scrive, la stessa cima si riproporrà: non è grave.
  }
}
