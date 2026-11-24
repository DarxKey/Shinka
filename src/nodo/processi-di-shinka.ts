/**
 * I processi che Shinka ha acceso in questo ambiente: tutti quelli che discendono da questo processo
 * (il nodo, o il centro per il suo ambiente). Sono le conversazioni con i loro comandi e i loro
 * server (per esempio CodeGraph), i modelli locali, i terminali e le applicazioni dei progetti. Per
 * ciascuno si dice quanto pesa, e dove si sa la cartella in cui lavora, così la pagina li attribuisce
 * ai progetti. Uno bloccato si può terminare, con ciò che ha avviato: solo se è di quest'albero.
 */

import { execFile } from "node:child_process";
import { readdir, readFile, readlink } from "node:fs/promises";
import type { ProcessoDiShinka } from "../protocollo/risorse.ts";

/** Un processo come lo legge il sistema: con il suo genitore e il tempo di processore usato finora. */
interface Letto {
  pid: number;
  genitore: number;
  nome: string;
  memoria: number;
  /** Secondi di processore usati da quando è nato. */
  secondi: number;
  comando?: string;
  cartella?: string;
}

export type LeggiProcessi = () => Promise<Letto[]>;
/** Termina un processo e i suoi discendenti, dati dal più alto al più basso. */
export type TerminaAlbero = (pid: number, discendenti: readonly number[]) => Promise<void>;

export interface OpzioniProcessiDiShinka {
  /** Il processo da cui discende tutto ciò che è di Shinka: di solito questo. */
  radice?: number;
  leggi?: LeggiProcessi;
  termina?: TerminaAlbero;
  adesso?: () => number;
  piattaforma?: NodeJS.Platform;
}

/** Quanti processi dell'albero si dicono al massimo. */
const PROCESSI_MASSIMI = 200;

function esegui(programma: string, argomenti: string[]): Promise<string> {
  return new Promise((risolvi, rifiuta) => {
    execFile(programma, argomenti, { timeout: 15_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (errore, uscita) => (errore === null ? risolvi(String(uscita)) : rifiuta(errore)));
  });
}

/** Su Linux da /proc: genitore, tempo, memoria, riga di comando e cartella di lavoro. */
async function leggiLinux(proc = "/proc"): Promise<Letto[]> {
  const letti: Letto[] = [];
  for (const voce of await readdir(proc)) {
    if (!/^\d+$/.test(voce)) continue;
    try {
      const stat = await readFile(`${proc}/${voce}/stat`, "utf8");
      const apre = stat.indexOf("(");
      const chiude = stat.lastIndexOf(")");
      const campi = stat.slice(chiude + 2).split(" ");
      letti.push({
        pid: Number(voce),
        genitore: Number(campi[1]),
        nome: stat.slice(apre + 1, chiude),
        secondi: (Number(campi[11]) + Number(campi[12])) / 100,
        memoria: (Number(campi[21]) || 0) * 4096,
      });
    } catch {
      // Finito tra l'elenco e la lettura.
    }
  }
  return letti;
}

/** Su Windows da Win32_Process: il tempo di processore è in centinaia di nanosecondi; la cartella non si sa. */
async function leggiWindows(): Promise<Letto[]> {
  const uscita = await esegui("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine,WorkingSetSize,KernelModeTime,UserModeTime | ConvertTo-Json -Compress",
  ]);
  const dati: unknown = JSON.parse(uscita);
  const voci = (Array.isArray(dati) ? dati : [dati]) as Record<string, unknown>[];
  return voci.flatMap((voce): Letto[] => {
    if (typeof voce.ProcessId !== "number" || typeof voce.ParentProcessId !== "number") return [];
    const tempo = (Number(voce.KernelModeTime) || 0) + (Number(voce.UserModeTime) || 0);
    return [
      {
        pid: voce.ProcessId,
        genitore: voce.ParentProcessId,
        nome: String(voce.Name ?? "").replace(/\.exe$/i, ""),
        secondi: tempo / 10_000_000,
        memoria: Number(voce.WorkingSetSize) || 0,
        ...(typeof voce.CommandLine === "string" ? { comando: voce.CommandLine } : {}),
      },
    ];
  });
}

/** Sugli altri sistemi da ps. */
async function leggiPs(): Promise<Letto[]> {
  const uscita = await esegui("ps", ["-Ao", "pid=,ppid=,time=,rss=,command="]);
  return uscita.split("\n").flatMap((riga): Letto[] => {
    const trovato = /^\s*(\d+)\s+(\d+)\s+(?:(\d+)-)?(\d+):(\d+)(?::(\d+))?(?:\.\d+)?\s+(\d+)\s+(.+)$/.exec(riga);
    if (trovato === null) return [];
    const [, pid, genitore, giorni, a, b, c, rss, comando] = trovato;
    const secondi = (Number(giorni ?? 0) * 86400) + (c === undefined ? Number(a) * 60 + Number(b) : Number(a) * 3600 + Number(b) * 60 + Number(c));
    return [{ pid: Number(pid), genitore: Number(genitore), nome: (comando ?? "").split(" ")[0]?.split("/").pop() ?? "", secondi, memoria: Number(rss) * 1024, comando: comando ?? "" }];
  });
}

async function terminaVero(pid: number, discendenti: readonly number[]): Promise<void> {
  if (process.platform === "win32") {
    await esegui("taskkill", ["/pid", String(pid), "/T", "/F"]);
    return;
  }
  // Prima con garbo, poi, a chi resta, senza.
  const tutti = [pid, ...discendenti];
  const manda = (segnale: NodeJS.Signals): void => {
    for (const uno of tutti) {
      try {
        process.kill(uno, segnale);
      } catch {
        // Già uscito.
      }
    }
  };
  manda("SIGTERM");
  await new Promise((fatto) => setTimeout(fatto, 2000));
  manda("SIGKILL");
}

/** I discendenti di `radice`, lei esclusa, nell'ordine in cui si incontrano scendendo. */
export function discendenti(tutti: readonly { pid: number; genitore: number }[], radice: number): number[] {
  const figli = new Map<number, number[]>();
  for (const uno of tutti) {
    if (uno.pid === uno.genitore) continue;
    figli.set(uno.genitore, [...(figli.get(uno.genitore) ?? []), uno.pid]);
  }
  const visti: number[] = [];
  const daVedere = [...(figli.get(radice) ?? [])];
  while (daVedere.length > 0 && visti.length < 10_000) {
    const pid = daVedere.shift() as number;
    if (visti.includes(pid) || pid === radice) continue;
    visti.push(pid);
    daVedere.push(...(figli.get(pid) ?? []));
  }
  return visti;
}

export class ProcessiDiShinka {
  readonly #o: OpzioniProcessiDiShinka;
  #prima: { quando: number; secondi: Map<number, number> } | undefined;

  constructor(opzioni: OpzioniProcessiDiShinka = {}) {
    this.#o = opzioni;
  }

  get #radice(): number {
    return this.#o.radice ?? process.pid;
  }

  async #tutti(): Promise<Letto[]> {
    if (this.#o.leggi !== undefined) return this.#o.leggi();
    const piattaforma = this.#o.piattaforma ?? process.platform;
    return piattaforma === "linux" ? leggiLinux() : piattaforma === "win32" ? leggiWindows() : leggiPs();
  }

  /** I processi di Shinka adesso, con il processore usato dall'ultima lettura. */
  async leggi(): Promise<ProcessoDiShinka[]> {
    const tutti = await this.#tutti();
    const adesso = this.#o.adesso?.() ?? Date.now();
    const perPid = new Map(tutti.map((uno) => [uno.pid, uno]));
    const suoi = discendenti(tutti, this.#radice).slice(0, PROCESSI_MASSIMI);
    const passati = this.#prima === undefined ? 0 : (adesso - this.#prima.quando) / 1000;
    const secondi = new Map<number, number>();
    const piattaforma = this.#o.piattaforma ?? process.platform;
    const elenco = await Promise.all(
      suoi.map(async (pid): Promise<ProcessoDiShinka | undefined> => {
        const uno = perPid.get(pid);
        if (uno === undefined) return undefined;
        secondi.set(pid, uno.secondi);
        const prima = this.#prima?.secondi.get(pid);
        const cpu = prima === undefined || passati <= 0 ? 0 : ((uno.secondi - prima) / passati) * 100;
        // Su Linux riga di comando e cartella si leggono solo per questi, che sono pochi.
        let { comando, cartella } = uno;
        if (piattaforma === "linux" && this.#o.leggi === undefined) {
          comando ??= (await readFile(`/proc/${pid}/cmdline`, "utf8").catch(() => "")).replace(/\0/g, " ").trim() || undefined;
          cartella ??= await readlink(`/proc/${pid}/cwd`).catch(() => undefined);
        }
        return {
          pid,
          genitore: uno.genitore === this.#radice ? 0 : uno.genitore,
          nome: uno.nome,
          cpu: Math.max(Math.round(cpu * 10) / 10, 0),
          memoria: uno.memoria,
          ...(comando === undefined || comando === "" ? {} : { comando: comando.slice(0, 400) }),
          ...(cartella === undefined ? {} : { cartella }),
        };
      }),
    );
    this.#prima = { quando: adesso, secondi };
    return elenco.filter((uno): uno is ProcessoDiShinka => uno !== undefined);
  }

  /** Termina un processo di Shinka con ciò che ha avviato. Rifiuta quelli che non sono di quest'albero. */
  async termina(pid: number): Promise<{ riuscita: boolean; testo: string }> {
    const tutti = await this.#tutti();
    if (!discendenti(tutti, this.#radice).includes(pid)) {
      return { riuscita: false, testo: `Il processo ${pid} non è tra quelli accesi da Shinka: da qui non si ferma.` };
    }
    try {
      await (this.#o.termina ?? terminaVero)(pid, discendenti(tutti, pid));
      return { riuscita: true, testo: `Il processo ${pid} è stato terminato, con ciò che aveva avviato.` };
    } catch (errore) {
      return { riuscita: false, testo: `Il processo ${pid} non si è potuto terminare: ${errore instanceof Error ? errore.message : String(errore)}` };
    }
  }
}
