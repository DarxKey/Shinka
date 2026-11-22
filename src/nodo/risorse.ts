/**
 * Le risorse di questa macchina, lette quando il proprietario guarda la pagina dell'ambiente
 * (ADR 0038): processore, memoria, disco dei progetti, i processi che pesano di più e, dove c'è e
 * si lascia leggere, Docker. Il nodo non tiene una storia e non campiona da solo: misura tra una
 * richiesta e la successiva. Legge soltanto: non ferma processi e non tocca container.
 */

import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { readdir, readFile, statfs } from "node:fs/promises";
import { cpus, freemem, hostname, loadavg, release, totalmem, uptime, version } from "node:os";
import { contenitoriDa, PROCESSI_MOSTRATI, type CampioneRisorse, type DockerLetto, type ProcessoAttivo, type RisorseDellAmbiente } from "../protocollo/risorse.ts";

/** Esegue un programma e ne dà l'uscita; nelle prove, uno finto. */
export type EseguiProgramma = (programma: string, argomenti: string[], secondi: number) => Promise<{ codice: number | null; uscita: string; errori: string; assente?: true }>;

const eseguiDavvero: EseguiProgramma = (programma, argomenti, secondi) =>
  new Promise((fatto) => {
    execFile(programma, argomenti, { timeout: secondi * 1000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (errore, uscita, errori) => {
      const assente = errore !== null && (errore as NodeJS.ErrnoException).code === "ENOENT";
      fatto({ codice: errore === null ? 0 : typeof errore.code === "number" ? errore.code : null, uscita: String(uscita), errori: String(errori), ...(assente ? { assente: true as const } : {}) });
    });
  });

export interface OpzioniRisorse {
  /** La cartella dei progetti: se ne dice il disco. */
  radiceProgetti: string;
  esegui?: EseguiProgramma;
  piattaforma?: NodeJS.Platform;
  /** La cartella dei processi su Linux; nelle prove, una finta. */
  proc?: string;
  /** L'etichetta dei container degli stack di prova di Shinka. */
  etichettaDiShinka?: string;
  adesso?: () => number;
}

/** Ogni quanto si rileggono i processi dove costa (Windows) e Docker, che è lento a dire le risorse. */
const PROCESSI_OGNI_MS = 8_000;
const DOCKER_OGNI_MS = 8_000;
/** Quanto si misura la prima volta, quando non c'è un campione di prima con cui fare la differenza. */
const PRIMA_MISURA_MS = 300;
/** Un campione di prima più vecchio di così non serve più: si rimisura. */
const CAMPIONE_VECCHIO_MS = 30_000;
/** Su Linux il tempo dei processi è in centesimi di secondo, e la memoria in pagine da 4 KB. */
const TIC_AL_SECONDO = 100;
const PAGINA = 4096;

interface TempiCpu {
  attivo: number;
  totale: number;
}

function tempiCpu(): TempiCpu {
  let attivo = 0;
  let totale = 0;
  for (const nucleo of cpus()) {
    const somma = nucleo.times.user + nucleo.times.nice + nucleo.times.sys + nucleo.times.irq + nucleo.times.idle;
    totale += somma;
    attivo += somma - nucleo.times.idle;
  }
  return { attivo, totale };
}

const attendi = (ms: number): Promise<void> => new Promise((fatto) => setTimeout(fatto, ms));

/** Un numero letto da un file di una riga; undefined se manca o dice "max". */
function numeroDa(file: string): number | undefined {
  try {
    const letto = Number(readFileSync(file, "utf8").trim().split(/\s+/)[0]);
    return Number.isFinite(letto) ? letto : undefined;
  } catch {
    return undefined;
  }
}

export class CampionatoreRisorse {
  readonly #o: OpzioniRisorse;
  readonly #esegui: EseguiProgramma;
  readonly #piattaforma: NodeJS.Platform;
  readonly #proc: string;
  #cpuPrima: { tempi: TempiCpu; quando: number } | undefined;
  /** Su Linux: i tic di ogni processo all'ultima lettura. */
  #ticPrima: { quando: number; tic: Map<number, number> } | undefined;
  /** Dove i processi si rileggono di rado: gli ultimi letti, e i secondi di processore di ciascuno. */
  #processi: { quando: number; elenco: ProcessoAttivo[]; quanti: number; motivo?: string; secondi?: Map<number, number> } | undefined;
  #docker: { quando: number; letto: DockerLetto } | undefined;
  #dockerInCorso: Promise<DockerLetto> | undefined;

  constructor(opzioni: OpzioniRisorse) {
    this.#o = opzioni;
    this.#esegui = opzioni.esegui ?? eseguiDavvero;
    this.#piattaforma = opzioni.piattaforma ?? process.platform;
    this.#proc = opzioni.proc ?? "/proc";
  }

  #adesso(): number {
    return this.#o.adesso?.() ?? Date.now();
  }

  /** Com'è la macchina adesso. Non lancia mai: ciò che non si legge manca, con il suo motivo. */
  async leggi(): Promise<RisorseDellAmbiente> {
    const linux = this.#piattaforma === "linux";
    // Senza un campione recente non c'è una differenza da fare: se ne prende uno, e si aspetta un momento.
    if (this.#cpuPrima === undefined || this.#adesso() - this.#cpuPrima.quando > CAMPIONE_VECCHIO_MS) {
      this.#cpuPrima = { tempi: tempiCpu(), quando: this.#adesso() };
      if (linux) await this.#processiLinux().catch(() => {});
      await attendi(PRIMA_MISURA_MS);
    }
    const tempi = tempiCpu();
    const prima = this.#cpuPrima.tempi;
    const cpu = tempi.totale > prima.totale ? ((tempi.attivo - prima.attivo) / (tempi.totale - prima.totale)) * 100 : 0;
    this.#cpuPrima = { tempi, quando: this.#adesso() };

    const [processi, docker, disco] = await Promise.all([this.#leggiProcessi(), this.#leggiDocker(), this.#disco()]);
    const contenitore = linux ? this.#contenitore() : undefined;
    const campione: CampioneRisorse = {
      quando: new Date(this.#adesso()).toISOString(),
      cpu: Math.min(Math.max(Math.round(cpu * 10) / 10, 0), 100),
      memoria: this.#memoria(),
      ...(this.#piattaforma === "win32" ? {} : { carico: Math.round((loadavg()[0] ?? 0) * 100) / 100 }),
      ...(disco === undefined ? {} : { disco }),
      ...(contenitore === undefined ? {} : { contenitore }),
    };
    const modello = cpus()[0]?.model.replace(/\s+/g, " ").trim();
    return {
      sistema: {
        nome: nomeDelSistema(this.#piattaforma),
        macchina: hostname(),
        nuclei: Math.max(cpus().length, 1),
        ...(modello === undefined || modello === "" ? {} : { processore: modello }),
        accesoDa: Math.round(uptime()),
      },
      campione,
      processi: processi.elenco,
      quantiProcessi: processi.quanti,
      ...(processi.motivo === undefined ? {} : { motivoProcessi: processi.motivo }),
      ...(linux && existsSync("/.dockerenv") ? { inContenitore: true as const } : {}),
      docker,
    };
  }

  #memoria(): { usata: number; totale: number } {
    if (this.#piattaforma === "linux") {
      try {
        // «Disponibile» conta anche ciò che il sistema tiene in memoria solo finché non serve ad altri.
        const letto = readFileSync(`${this.#proc}/meminfo`, "utf8");
        const kb = (nome: string): number | undefined => {
          const trovato = new RegExp(`^${nome}:\\s+(\\d+) kB`, "m").exec(letto);
          return trovato === null ? undefined : Number(trovato[1]) * 1024;
        };
        const totale = kb("MemTotal");
        const disponibile = kb("MemAvailable");
        if (totale !== undefined && disponibile !== undefined) return { usata: totale - disponibile, totale };
      } catch {
        // Si ripiega su ciò che dice Node.
      }
    }
    return { usata: totalmem() - freemem(), totale: totalmem() };
  }

  /** Se il nodo gira in un container con dei limiti: quanta memoria usa, e i suoi tetti. */
  #contenitore(): CampioneRisorse["contenitore"] {
    const memoria = numeroDa("/sys/fs/cgroup/memory.current");
    const limiteMemoria = numeroDa("/sys/fs/cgroup/memory.max");
    if (memoria === undefined || limiteMemoria === undefined) return undefined;
    let limiteCpu: number | undefined;
    try {
      const [quota, periodo] = readFileSync("/sys/fs/cgroup/cpu.max", "utf8").trim().split(/\s+/).map(Number);
      if (Number.isFinite(quota) && Number.isFinite(periodo) && (periodo ?? 0) > 0) limiteCpu = (quota as number) / (periodo as number);
    } catch {
      // Senza tetto al processore.
    }
    return { memoria, limiteMemoria, ...(limiteCpu === undefined ? {} : { limiteCpu }) };
  }

  async #disco(): Promise<{ usato: number; totale: number } | undefined> {
    try {
      const letto = await statfs(this.#o.radiceProgetti);
      const totale = letto.blocks * letto.bsize;
      return totale > 0 ? { usato: totale - letto.bavail * letto.bsize, totale } : undefined;
    } catch {
      return undefined;
    }
  }

  async #leggiProcessi(): Promise<{ elenco: ProcessoAttivo[]; quanti: number; motivo?: string }> {
    try {
      if (this.#piattaforma === "linux") return await this.#processiLinux();
      // Altrove leggerli costa un programma da lanciare: si rileggono ogni tanto.
      if (this.#processi !== undefined && this.#adesso() - this.#processi.quando < PROCESSI_OGNI_MS) return this.#processi;
      const letti = this.#piattaforma === "win32" ? await this.#processiWindows() : await this.#processiUnix();
      this.#processi = { quando: this.#adesso(), ...letti };
      return letti;
    } catch (errore) {
      return { elenco: [], quanti: 0, motivo: `I processi non si sono potuti leggere: ${errore instanceof Error ? errore.message : String(errore)}` };
    }
  }

  /** Su Linux i processi si leggono da /proc, e il processore di ciascuno è la differenza dall'ultima lettura. */
  async #processiLinux(): Promise<{ elenco: ProcessoAttivo[]; quanti: number }> {
    const adesso = this.#adesso();
    const prima = this.#ticPrima;
    const tic = new Map<number, number>();
    const tutti: ProcessoAttivo[] = [];
    for (const voce of await readdir(this.#proc)) {
      if (!/^\d+$/.test(voce)) continue;
      const pid = Number(voce);
      let stat: string;
      try {
        stat = await readFile(`${this.#proc}/${voce}/stat`, "utf8");
      } catch {
        continue; // Il processo è finito tra l'elenco e la lettura.
      }
      // Il nome sta tra parentesi e può contenere spazi e parentesi: i campi contano dall'ultima chiusa.
      const apre = stat.indexOf("(");
      const chiude = stat.lastIndexOf(")");
      const campi = stat.slice(chiude + 2).split(" ");
      const suoi = Number(campi[11]) + Number(campi[12]);
      if (!Number.isFinite(suoi)) continue;
      tic.set(pid, suoi);
      const secondi = prima === undefined ? 0 : (adesso - prima.quando) / 1000;
      const diPrima = prima?.tic.get(pid);
      const cpu = diPrima === undefined || secondi <= 0 ? 0 : ((suoi - diPrima) / TIC_AL_SECONDO / secondi) * 100;
      tutti.push({ pid, nome: stat.slice(apre + 1, chiude), cpu: Math.max(Math.round(cpu * 10) / 10, 0), memoria: (Number(campi[21]) || 0) * PAGINA });
    }
    this.#ticPrima = { quando: adesso, tic };
    const elenco = piuPesanti(tutti);
    await Promise.all(
      elenco.map(async (processo) => {
        try {
          const comando = (await readFile(`${this.#proc}/${processo.pid}/cmdline`, "utf8")).replace(/\0/g, " ").trim();
          if (comando === "") return;
          processo.comando = comando.slice(0, 240);
          // Node chiama il suo filo principale "MainThread": il nome del programma dice di più.
          if (processo.nome === "MainThread") processo.nome = (comando.split(" ")[0] ?? "").split("/").pop() || processo.nome;
        } catch {
          // Senza riga di comando resta il nome.
        }
      }),
    );
    return { elenco, quanti: tutti.length };
  }

  /** Su Windows li dice PowerShell, con i secondi di processore usati da ciascuno: il carico è la differenza. */
  async #processiWindows(): Promise<{ elenco: ProcessoAttivo[]; quanti: number; motivo?: string; secondi?: Map<number, number> }> {
    const letto = await this.#esegui("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Get-Process | Select-Object Id,ProcessName,CPU,WorkingSet64 | ConvertTo-Json -Compress"], 15);
    if (letto.codice !== 0) return { elenco: [], quanti: 0, motivo: "PowerShell non ha dato l'elenco dei processi." };
    const dati: unknown = JSON.parse(letto.uscita);
    const voci = (Array.isArray(dati) ? dati : [dati]) as { Id?: number; ProcessName?: string; CPU?: number | null; WorkingSet64?: number }[];
    const prima = this.#processi;
    const passati = prima === undefined ? 0 : (this.#adesso() - prima.quando) / 1000;
    const secondi = new Map<number, number>();
    const tutti = voci.flatMap((voce): ProcessoAttivo[] => {
      if (typeof voce.Id !== "number") return [];
      const usati = typeof voce.CPU === "number" ? voce.CPU : 0;
      secondi.set(voce.Id, usati);
      const diPrima = prima?.secondi?.get(voce.Id);
      const cpu = diPrima === undefined || passati <= 0 ? 0 : ((usati - diPrima) / passati) * 100;
      return [{ pid: voce.Id, nome: String(voce.ProcessName ?? ""), cpu: Math.max(Math.round(cpu * 10) / 10, 0), memoria: voce.WorkingSet64 ?? 0 }];
    });
    return { elenco: piuPesanti(tutti), quanti: tutti.length, secondi };
  }

  /** Sugli altri sistemi li dice `ps`, con la sua media del processore. */
  async #processiUnix(): Promise<{ elenco: ProcessoAttivo[]; quanti: number; motivo?: string }> {
    const letto = await this.#esegui("ps", ["-Ao", "pid=,pcpu=,rss=,comm="], 10);
    if (letto.codice !== 0) return { elenco: [], quanti: 0, motivo: "ps non ha dato l'elenco dei processi." };
    const tutti = letto.uscita.split("\n").flatMap((riga): ProcessoAttivo[] => {
      const trovato = /^\s*(\d+)\s+([\d.,]+)\s+(\d+)\s+(.+)$/.exec(riga);
      if (trovato === null) return [];
      const comando = (trovato[4] ?? "").trim();
      return [{ pid: Number(trovato[1]), nome: comando.split("/").pop() ?? comando, cpu: Number((trovato[2] ?? "0").replace(",", ".")) || 0, memoria: Number(trovato[3]) * 1024, comando: comando.slice(0, 240) }];
    });
    return { elenco: piuPesanti(tutti), quanti: tutti.length };
  }

  /** Docker è lento a dire le risorse: si rilegge ogni tanto, e intanto vale l'ultima lettura. */
  async #leggiDocker(): Promise<DockerLetto> {
    const fresco = this.#docker !== undefined && this.#adesso() - this.#docker.quando < DOCKER_OGNI_MS;
    if (!fresco && this.#dockerInCorso === undefined) {
      this.#dockerInCorso = this.#interrogaDocker()
        .then((letto) => {
          this.#docker = { quando: this.#adesso(), letto };
          return letto;
        })
        .finally(() => {
          this.#dockerInCorso = undefined;
        });
    }
    // La prima volta si aspetta; poi chi guarda non aspetta Docker a ogni campione.
    return this.#docker?.letto ?? (this.#dockerInCorso as Promise<DockerLetto>);
  }

  async #interrogaDocker(): Promise<DockerLetto> {
    try {
      const ps = await this.#esegui("docker", ["ps", "-a", "--no-trunc", "--format", "{{json .}}"], 10);
      if (ps.assente === true) return { stato: "assente", contenitori: [] };
      if (ps.codice !== 0) {
        const detto = (ps.errori.trim().split("\n")[0] ?? "").slice(0, 300);
        return { stato: "non-raggiungibile", motivo: detto === "" ? "Docker non ha risposto." : detto, contenitori: [] };
      }
      const stats = await this.#esegui("docker", ["stats", "--no-stream", "--format", "{{json .}}"], 20);
      return { stato: "attivo", contenitori: contenitoriDa(ps.uscita, stats.codice === 0 ? stats.uscita : "", this.#o.etichettaDiShinka) };
    } catch (errore) {
      return { stato: "non-raggiungibile", motivo: errore instanceof Error ? errore.message : String(errore), contenitori: [] };
    }
  }
}

/** I più pesanti: prima chi usa più processore, poi chi usa più memoria. */
function piuPesanti(tutti: ProcessoAttivo[]): ProcessoAttivo[] {
  return [...tutti].sort((a, b) => b.cpu - a.cpu || b.memoria - a.memoria).slice(0, PROCESSI_MOSTRATI);
}

function nomeDelSistema(piattaforma: NodeJS.Platform): string {
  if (piattaforma === "win32") {
    // "Windows 10 Pro" dice anche 11: la versione vera sta nel numero di build.
    const build = Number(release().split(".")[2]);
    return Number.isFinite(build) && build >= 22000 ? "Windows 11" : version().replace(/\s+(Pro|Home|Enterprise|Education).*$/, "");
  }
  if (piattaforma === "darwin") return `macOS (Darwin ${release().split(".")[0]})`;
  return `Linux ${release().split("-")[0]}`;
}
