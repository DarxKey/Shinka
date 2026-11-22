/**
 * Il client dell'app-server di Codex: il processo `codex app-server`, con cui si parla in JSON a
 * righe su stdin e stdout. Le richieste hanno un `id` e aspettano la risposta; le notifiche no; il
 * server a sua volta chiede cose (approvazioni, domande, strumenti) e aspetta la risposta di Shinka.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { createInterface } from "node:readline";

/** Il programma di Codex delle dipendenze di Shinka, con la versione fissata. */
export function programmaDiCodex(): string[] {
  const richiedi = createRequire(import.meta.url);
  return [process.execPath, richiedi.resolve("@openai/codex/bin/codex.js")];
}

/** Come Shinka risponde a una richiesta del server: il risultato, oppure un errore. */
export type RispostaAlServer = { risultato: unknown } | { errore: string };

export interface OpzioniCliente {
  /** Il comando che avvia l'app-server: di solito quello delle dipendenze. Nei test, uno finto. */
  comando?: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  alNotificato(metodo: string, parametri: Record<string, unknown>): void;
  /** Il server chiede qualcosa: Shinka risponde quando ha deciso. */
  allaRichiesta(metodo: string, parametri: Record<string, unknown>): Promise<RispostaAlServer>;
  /** Il processo è finito, con il motivo se si sa. */
  allaFine(motivo: string): void;
}

interface InAttesa {
  risolvi(valore: unknown): void;
  rifiuta(errore: Error): void;
  scadenza: NodeJS.Timeout | undefined;
}

/** Un errore dell'app-server, con il messaggio che dà. */
export class ErroreCodex extends Error {}

export class ClienteAppServer {
  readonly #o: OpzioniCliente;
  readonly #processo: ChildProcess;
  readonly #inAttesa = new Map<number, InAttesa>();
  #prossimo = 1;
  #finito = false;
  /** Le ultime righe di errore del processo, per dire perché non è partito. */
  #righeDiErrore: string[] = [];

  private constructor(opzioni: OpzioniCliente) {
    this.#o = opzioni;
    const [programma, ...argomenti] = opzioni.comando ?? programmaDiCodex();
    this.#processo = spawn(programma ?? "codex", [...argomenti, "app-server"], {
      cwd: opzioni.cwd,
      env: opzioni.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    createInterface({ input: this.#processo.stdout! }).on("line", (riga) => this.#ricevi(riga));
    createInterface({ input: this.#processo.stderr! }).on("line", (riga) => {
      this.#righeDiErrore.push(riga.replace(/\x1b\[[0-9;]*m/g, ""));
      if (this.#righeDiErrore.length > 20) this.#righeDiErrore.shift();
    });
    this.#processo.on("error", (errore) => this.#fine(`Codex non è partito: ${errore.message}`));
    this.#processo.on("close", (codice) => this.#fine(codice === 0 || codice === null ? "Codex si è chiuso." : `Codex si è chiuso con il codice ${codice}.`));
  }

  /** Avvia l'app-server e si presenta. */
  static async avvia(opzioni: OpzioniCliente): Promise<ClienteAppServer> {
    const cliente = new ClienteAppServer(opzioni);
    await cliente.richiedi("initialize", {
      clientInfo: { name: "shinka", title: "Shinka", version: "1" },
      capabilities: { experimentalApi: true },
    }, 60_000);
    cliente.notifica("initialized");
    return cliente;
  }

  get aperto(): boolean {
    return !this.#finito;
  }

  richiedi(metodo: string, parametri: Record<string, unknown>, attesaMs = 120_000): Promise<unknown> {
    if (this.#finito) return Promise.reject(new ErroreCodex("Codex non è acceso."));
    const id = this.#prossimo++;
    return new Promise((risolvi, rifiuta) => {
      const scadenza = attesaMs === 0 ? undefined : setTimeout(() => {
        this.#inAttesa.delete(id);
        rifiuta(new ErroreCodex(`Codex non ha risposto a ${metodo}.`));
      }, attesaMs);
      scadenza?.unref();
      this.#inAttesa.set(id, { risolvi, rifiuta, scadenza });
      this.#scrivi({ id, method: metodo, params: parametri });
    });
  }

  notifica(metodo: string, parametri?: Record<string, unknown>): void {
    if (!this.#finito) this.#scrivi({ method: metodo, ...(parametri === undefined ? {} : { params: parametri }) });
  }

  chiudi(): void {
    if (this.#finito) return;
    this.#processo.stdin?.end();
    this.#processo.kill();
    this.#fine("Chiuso da Shinka.");
  }

  #scrivi(messaggio: Record<string, unknown>): void {
    this.#processo.stdin?.write(`${JSON.stringify(messaggio)}\n`);
  }

  #ricevi(riga: string): void {
    let messaggio: Record<string, unknown>;
    try {
      messaggio = JSON.parse(riga) as Record<string, unknown>;
    } catch {
      return;
    }
    const { id, method, params } = messaggio;
    const parametri = (typeof params === "object" && params !== null ? params : {}) as Record<string, unknown>;
    if (typeof method === "string" && id !== undefined) {
      // Una richiesta del server: la risposta torna con lo stesso id.
      void this.#o
        .allaRichiesta(method, parametri)
        .catch((errore: unknown): RispostaAlServer => ({ errore: errore instanceof Error ? errore.message : String(errore) }))
        .then((risposta) =>
          this.#scrivi("risultato" in risposta ? { id, result: risposta.risultato } : { id, error: { code: -32000, message: risposta.errore } }),
        );
      return;
    }
    if (typeof method === "string") {
      this.#o.alNotificato(method, parametri);
      return;
    }
    if (typeof id !== "number") return;
    const inAttesa = this.#inAttesa.get(id);
    if (inAttesa === undefined) return;
    this.#inAttesa.delete(id);
    if (inAttesa.scadenza !== undefined) clearTimeout(inAttesa.scadenza);
    const errore = messaggio.error as { message?: unknown } | undefined;
    if (errore !== undefined) inAttesa.rifiuta(new ErroreCodex(typeof errore.message === "string" ? errore.message : "Errore di Codex."));
    else inAttesa.risolvi(messaggio.result);
  }

  #fine(motivo: string): void {
    if (this.#finito) return;
    this.#finito = true;
    const dettaglio = this.#righeDiErrore.filter((riga) => /error|errore/i.test(riga)).at(-1);
    const completo = dettaglio === undefined ? motivo : `${motivo} ${dettaglio}`;
    for (const inAttesa of this.#inAttesa.values()) {
      if (inAttesa.scadenza !== undefined) clearTimeout(inAttesa.scadenza);
      inAttesa.rifiuta(new ErroreCodex(completo));
    }
    this.#inAttesa.clear();
    this.#o.allaFine(completo);
  }
}
