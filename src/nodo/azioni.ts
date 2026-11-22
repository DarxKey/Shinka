/**
 * Le azioni che la Home fa fare in questo ambiente senza un progetto: un comando, un file
 * scritto o letto. Lavorano nella cartella dell'argomento, dentro quella dei progetti.
 */

import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, resolve, sep } from "node:path";
import {
  CARTELLA_HOME,
  DURATA_COMANDO_MS,
  DURATA_MASSIMA_COMANDO_MS,
  FILE_ELENCATI_MASSIMO,
  idArgomentoValido,
  type AzioneInAmbiente,
  type DettaglioFile,
  type ElencoFile,
  type EsitoAzione,
} from "../protocollo/azioni.ts";
import { ELABORATO_MASSIMO, percorsoDiElaboratoValido } from "../protocollo/elaborati.ts";

/** Quanto dell'uscita di un comando torna a Claude: l'inizio e la fine, se è più lunga. */
const USCITA_MASSIMA = 30_000;

/** Un file più grande di così non si legge in una volta. */
const FILE_MASSIMO = 400_000;

const diWindows = process.platform === "win32";

/** La shell in cui girano i comandi in questo ambiente, detta in una parola. */
export const SHELL_DI_QUESTO_AMBIENTE = diWindows ? "PowerShell" : "bash";

/** Esegue un'azione nella cartella di un argomento. Non lancia mai: l'esito dice com'è andata. */
export async function eseguiAzione(
  radiceProgetti: string,
  idArgomento: string,
  azione: AzioneInAmbiente,
): Promise<EsitoAzione> {
  if (!idArgomentoValido(idArgomento)) {
    return { riuscita: false, testo: "L'argomento indicato non è valido." };
  }
  const cartella = join(resolve(radiceProgetti), CARTELLA_HOME, idArgomento);
  try {
    if (azione.tipo === "elenca-file") {
      // Guardare non crea nulla: un argomento che qui non ha lavorato non ha una cartella.
      const { percorsi, quanti, dettagli } = await elencaFile(cartella);
      return {
        riuscita: true,
        testo: `${quanti} file`,
        file: percorsi,
        quantiFile: quanti,
        ...(dettagli === undefined ? {} : { dettagli }),
      };
    }
    if (azione.tipo === "leggi-elaborato") {
      // Anche guardare un elaborato non crea la cartella.
      const letto = await leggiElaborato(cartella, azione.percorso);
      if ("problema" in letto) return { riuscita: false, testo: letto.problema };
      return { riuscita: true, testo: letto.dati.toString("base64") };
    }
    await mkdir(cartella, { recursive: true });
    switch (azione.tipo) {
      case "esegui":
        return await esegui(cartella, azione.comando, azione.durataMs ?? DURATA_COMANDO_MS);
      case "scrivi-file":
        return await scrivi(cartella, azione.percorso, azione.contenuto);
      case "leggi-file":
        return await leggi(cartella, azione.percorso);
    }
  } catch (errore) {
    return { riuscita: false, testo: errore instanceof Error ? errore.message : String(errore) };
  }
}

/** Cartelle che non sono lavoro dell'argomento: il repository e le dipendenze scaricate. */
export const CARTELLE_SALTATE: ReadonlySet<string> = new Set([".git", "node_modules"]);

/**
 * I file di una cartella e delle sue sottocartelle, in ordine alfabetico. Una cartella che
 * non esiste non ha file. I percorsi oltre il massimo non vengono riportati, ma contati sì.
 */
export async function elencaFile(cartella: string): Promise<ElencoFile> {
  const percorsi: string[] = [];
  const dettagli: DettaglioFile[] = [];
  let quanti = 0;
  const visita = async (relativa: string): Promise<void> => {
    let voci;
    try {
      voci = await readdir(join(cartella, relativa), { withFileTypes: true });
    } catch {
      return;
    }
    voci.sort((a, b) => a.name.localeCompare(b.name));
    for (const voce of voci) {
      const percorso = relativa === "" ? voce.name : `${relativa}/${voce.name}`;
      if (voce.isDirectory()) {
        if (!CARTELLE_SALTATE.has(voce.name)) await visita(percorso);
      } else if (voce.isFile()) {
        quanti += 1;
        if (percorsi.length < FILE_ELENCATI_MASSIMO) {
          const dati = await stat(join(cartella, percorso)).catch(() => undefined);
          percorsi.push(percorso);
          dettagli.push({ byte: dati?.size ?? 0, modificatoIl: (dati?.mtime ?? new Date(0)).toISOString() });
        }
      }
    }
  };
  await visita("");
  return { percorsi, quanti, dettagli };
}

/**
 * Legge un elaborato della cartella di un argomento, così com'è, per mostrarlo al proprietario.
 * Il percorso è relativo e non esce dalla cartella, nemmeno attraverso un collegamento.
 */
export async function leggiElaborato(
  cartella: string,
  percorso: string,
  massimo: number = ELABORATO_MASSIMO,
): Promise<{ dati: Buffer } | { problema: string }> {
  if (!percorsoDiElaboratoValido(percorso)) return { problema: "Il percorso non indica un file dell'argomento." };
  const base = await realpath(cartella).catch(() => undefined);
  if (base === undefined) return { problema: "Questo argomento qui non ha file." };
  const vero = await realpath(join(base, ...percorso.split("/"))).catch(() => undefined);
  if (vero === undefined) return { problema: `Il file ${percorso} non esiste.` };
  if (vero !== base && !vero.startsWith(base.endsWith(sep) ? base : base + sep)) {
    return { problema: "Il percorso non indica un file dell'argomento." };
  }
  const dati = await stat(vero);
  if (!dati.isFile()) return { problema: `${percorso} non è un file.` };
  if (dati.size > massimo) {
    return { problema: `Il file ${percorso} è troppo grande per essere mostrato (${dati.size} byte).` };
  }
  return { dati: await readFile(vero) };
}

function percorsoCompleto(cartella: string, percorso: string): string {
  return isAbsolute(percorso) ? resolve(percorso) : resolve(cartella, percorso);
}

async function scrivi(cartella: string, percorso: string, contenuto: string): Promise<EsitoAzione> {
  const completo = percorsoCompleto(cartella, percorso);
  await mkdir(dirname(completo), { recursive: true });
  // PowerShell 5 legge come testo locale uno script senza il segno iniziale: le accentate si guasterebbero.
  const conSegno = diWindows && /^\.ps(m|d)?1$/i.test(extname(completo)) && !contenuto.startsWith("\uFEFF");
  await writeFile(completo, conSegno ? `\uFEFF${contenuto}` : contenuto, "utf8");
  return { riuscita: true, testo: `File scritto: ${completo}`, percorso: completo };
}

async function leggi(cartella: string, percorso: string): Promise<EsitoAzione> {
  const completo = percorsoCompleto(cartella, percorso);
  let dimensione: number;
  try {
    const dati = await stat(completo);
    if (!dati.isFile()) return { riuscita: false, testo: `${completo} non è un file.`, percorso: completo };
    dimensione = dati.size;
  } catch {
    return { riuscita: false, testo: `Il file ${completo} non esiste.`, percorso: completo };
  }
  if (dimensione > FILE_MASSIMO) {
    return {
      riuscita: false,
      testo: `Il file ${completo} è troppo grande per essere letto intero (${dimensione} byte).`,
      percorso: completo,
    };
  }
  const contenuto = (await readFile(completo, "utf8")).replace(/^\uFEFF/, "");
  if (contenuto.includes("\u0000")) {
    return { riuscita: false, testo: `Il file ${completo} non è un file di testo.`, percorso: completo };
  }
  return { riuscita: true, testo: contenuto, percorso: completo };
}

/** Esegue un comando nella shell dell'ambiente, da quella cartella, entro quella durata. */
export function esegui(cartella: string, comando: string, durataMs: number): Promise<EsitoAzione> {
  const durata = Math.min(Math.max(durataMs, 1_000), DURATA_MASSIMA_COMANDO_MS);
  const [programma, argomenti] = diWindows
    ? [
        "powershell.exe",
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          // Vale solo per questo processo: senza, uno script appena scritto non partirebbe
          // dove Windows vieta gli script, cioè dove non è stato cambiato nulla.
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          // Senza questo l'uscita arriva nella codifica della console e le accentate si guastano.
          `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ${comando}`,
        ],
      ]
    : ["bash", ["-c", comando]];

  return new Promise((risolvi) => {
    const uscita = new Uscita();
    let scaduto = false;
    const processo = spawn(programma, argomenti, {
      cwd: cartella,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const scadenza = setTimeout(() => {
      scaduto = true;
      ferma(processo.pid);
    }, durata);
    processo.stdout.on("data", (dati: Buffer) => uscita.aggiungi(dati));
    processo.stderr.on("data", (dati: Buffer) => uscita.aggiungi(dati));
    processo.on("error", (errore) => {
      clearTimeout(scadenza);
      risolvi({ riuscita: false, testo: `Il comando non è partito: ${errore.message}` });
    });
    processo.on("close", (codice) => {
      clearTimeout(scadenza);
      const testo = uscita.testo();
      if (scaduto) {
        risolvi({
          riuscita: false,
          testo: `Il comando è stato fermato dopo ${Math.round(durata / 1000)} secondi.\n${testo}`.trim(),
        });
        return;
      }
      risolvi({
        riuscita: codice === 0,
        testo: `Codice di uscita: ${codice ?? "sconosciuto"}\n${testo}`.trim(),
      });
    });
  });
}

/** Ferma un comando e ciò che ha avviato. */
function ferma(pid: number | undefined): void {
  if (pid === undefined) return;
  if (diWindows) {
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }).on(
      "error",
      () => {},
    );
    return;
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Già finito.
  }
}

/** Raccoglie l'uscita di un comando tenendone l'inizio e la fine. */
class Uscita {
  #inizio = "";
  #fine = "";
  #tagliati = 0;

  aggiungi(dati: Buffer): void {
    let testo = dati.toString("utf8");
    const spazio = USCITA_MASSIMA / 2 - this.#inizio.length;
    if (spazio > 0) {
      this.#inizio += testo.slice(0, spazio);
      testo = testo.slice(spazio);
    }
    if (testo === "") return;
    const tutto = this.#fine + testo;
    const eccesso = tutto.length - USCITA_MASSIMA / 2;
    if (eccesso > 0) this.#tagliati += eccesso;
    this.#fine = eccesso > 0 ? tutto.slice(eccesso) : tutto;
  }

  testo(): string {
    if (this.#tagliati === 0) return this.#inizio + this.#fine;
    return `${this.#inizio}\n[… ${this.#tagliati} caratteri omessi …]\n${this.#fine}`;
  }
}
