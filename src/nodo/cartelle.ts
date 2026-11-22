/** Creazione della cartella di un progetto nuovo, nell'ambiente in cui gira questo codice. */

import { execFile } from "node:child_process";
import { copyFile, mkdir, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { CARTELLE_SALTATE } from "./azioni.ts";

/** La cartella non è stata creata, e il messaggio dice perché in parole per il proprietario. */
export class CartellaNonCreata extends Error {}

/** Nomi che Windows riserva a dispositivi: una cartella non può chiamarsi così. */
const RISERVATI_DA_WINDOWS = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/;

export interface CartellaCreata {
  /** Il percorso completo della cartella. */
  percorso: string;
  /** Quanti file vi sono stati copiati dalla cartella di partenza. */
  filePortati: number;
  /** Per una cartella adottata: vero se è già un repository Git. Una cartella nuova lo è sempre. */
  git?: boolean;
}

/**
 * Prende come cartella di un progetto una cartella che esiste già, così com'è: controlla che ci
 * sia e che sia una cartella, e dice se è un repository Git. Non scrive nulla, non copia nulla e
 * non inizializza nulla. Il percorso dev'essere completo; torna nella forma che ha sul disco.
 */
export async function adottaCartella(percorso: string): Promise<CartellaCreata & { git: boolean }> {
  const indicato = percorso.trim();
  if (indicato === "" || !isAbsolute(indicato)) {
    throw new CartellaNonCreata(`"${percorso}" non è un percorso completo: scrivilo per intero, a partire dalla radice del disco.`);
  }
  let vero: string;
  try {
    vero = await realpath(indicato);
  } catch {
    throw new CartellaNonCreata(`La cartella ${indicato} non esiste in questo ambiente.`);
  }
  if (!(await stat(vero)).isDirectory()) {
    throw new CartellaNonCreata(`${indicato} non è una cartella.`);
  }
  // Un repository ha la sua cartella .git; in un worktree .git è un file.
  const git = await stat(join(vero, ".git")).then(
    () => true,
    () => false,
  );
  return { percorso: vero, filePortati: 0, git };
}

/**
 * Crea `radice/nomeCartella`, ci scrive il brief e ne fa un repository Git.
 * Non riusa mai una cartella esistente: se c'è già, fallisce.
 * Con `daCartella` il progetto nasce con una copia dei file che vi si trovano:
 * gli originali restano dove sono.
 */
export async function creaCartellaProgetto(
  radice: string,
  nomeCartella: string,
  brief: string,
  daCartella?: string,
): Promise<CartellaCreata> {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(nomeCartella) || RISERVATI_DA_WINDOWS.test(nomeCartella)) {
    throw new CartellaNonCreata(`"${nomeCartella}" non è un nome di cartella utilizzabile.`);
  }
  await mkdir(radice, { recursive: true });
  const percorso = join(resolve(radice), nomeCartella);
  try {
    await mkdir(percorso);
  } catch (errore) {
    if (errore instanceof Error && "code" in errore && errore.code === "EEXIST") {
      throw new CartellaNonCreata(`In ${resolve(radice)} esiste già una cartella "${nomeCartella}".`);
    }
    throw errore;
  }
  const filePortati = daCartella === undefined ? 0 : await copiaFile(daCartella, percorso);
  // Il brief si scrive per ultimo: se tra i file portati ce n'era uno con lo stesso nome, vale questo.
  await writeFile(join(percorso, "BRIEF.md"), `# Brief\n\n${brief.trim()}\n`);
  await inizializzaGit(percorso);
  return { percorso, filePortati };
}

/**
 * Copia i file di una cartella e delle sue sottocartelle in un'altra, e dice quanti erano.
 * Il repository Git e le dipendenze scaricate non si copiano: il progetto ha un repository suo,
 * e le dipendenze si riscaricano. Una cartella che non esiste non ha file.
 */
async function copiaFile(da: string, a: string): Promise<number> {
  let voci;
  try {
    voci = await readdir(da, { withFileTypes: true });
  } catch {
    return 0;
  }
  let copiati = 0;
  for (const voce of voci) {
    if (voce.isDirectory()) {
      if (CARTELLE_SALTATE.has(voce.name)) continue;
      await mkdir(join(a, voce.name), { recursive: true });
      copiati += await copiaFile(join(da, voce.name), join(a, voce.name));
    } else if (voce.isFile()) {
      await copyFile(join(da, voce.name), join(a, voce.name));
      copiati += 1;
    }
  }
  return copiati;
}

/** Se Git manca o fallisce il progetto nasce lo stesso: il repository si potrà creare dopo. */
function inizializzaGit(percorso: string): Promise<void> {
  return new Promise((risolvi) => {
    execFile("git", ["init", "--quiet", "--initial-branch=main"], { cwd: percorso }, () => risolvi());
  });
}
