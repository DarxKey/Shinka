/**
 * Gli aggiornamenti di Shinka Desktop, serviti dal centro (ADR 0049). Il centro non costruisce
 * l'app: il progetto Shinka Desktop la costruisce su Windows con electron-builder, e il proprietario
 * la pubblica dalle Impostazioni, prendendo latest.yml, l'installer e il suo .blockmap dalla
 * cartella del progetto. Il centro li controlla, poi li serve così come sono a electron-updater, con
 * il provider generico.
 *
 * Si tiene solo l'ultima versione; della precedente resta il .blockmap, perché electron-updater lo
 * chiede per scaricare solo le parti cambiate.
 */

import { createHash, randomBytes } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { StatoDesktop } from "../protocollo/desktop.ts";

export const MANIFESTO = "latest.yml";
const PUBBLICATA = "pubblicata";
const INFO = "pubblicazione.json";
const BLOCKMAP_PRECEDENTE = "precedente";
const MANIFESTO_MASSIMO = 64 * 1024;
const INSTALLER_MASSIMO = 2 * 1024 * 1024 * 1024;
const BLOCKMAP_MASSIMO = 32 * 1024 * 1024;

/** Ciò che conta di latest.yml, come lo scrive electron-builder. */
export interface Manifesto {
  versione: string;
  /** Il nome dell'installer. */
  percorso: string;
  /** La SHA-512 dell'installer, in base64. */
  sha512: string;
  dimensione: number;
  /** Se il manifesto la dice, la dimensione del .blockmap. */
  dimensioneBlockmap?: number;
  dataDiRilascio?: string;
}

/** Il nome che l'installer deve avere per una versione. */
export function nomeDellInstaller(versione: string): string {
  return `Shinka-Desktop-${versione}-installa.exe`;
}

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

/** Confronta due versioni semantiche: negativo se la prima viene prima. */
export function confrontaVersioni(a: string, b: string): number {
  const [, a1, a2, a3, aPre] = SEMVER.exec(a) ?? [];
  const [, b1, b2, b3, bPre] = SEMVER.exec(b) ?? [];
  for (const [x, y] of [[a1, b1], [a2, b2], [a3, b3]] as const) {
    const differenza = Number(x) - Number(y);
    if (differenza !== 0) return differenza;
  }
  // Una versione senza suffisso viene dopo la stessa con un suffisso: 1.0.0-beta < 1.0.0.
  if (aPre === undefined || bPre === undefined) return aPre === bPre ? 0 : aPre === undefined ? 1 : -1;
  const parti = (pre: string): string[] => pre.split(".");
  const pa = parti(aPre);
  const pb = parti(bPre);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i];
    const y = pb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny && Number(x) !== Number(y)) return Number(x) - Number(y);
    if (nx !== ny) return nx ? -1 : 1;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

function scalare(valore: string): string {
  const pulito = valore.trim();
  if ((pulito.startsWith("'") && pulito.endsWith("'")) || (pulito.startsWith('"') && pulito.endsWith('"'))) return pulito.slice(1, -1);
  return pulito;
}

/**
 * Legge latest.yml: le chiavi in cima e l'elenco `files`, come li scrive electron-builder. Non è un
 * lettore YAML completo: un manifesto fatto diversamente viene rifiutato.
 */
export function leggiManifesto(testo: string): Manifesto | { motivo: string } {
  const cima: Record<string, string> = {};
  const file: Record<string, string>[] = [];
  let inFiles = false;
  for (const riga of testo.replace(/\r\n/g, "\n").split("\n")) {
    if (riga.trim() === "" || riga.trimStart().startsWith("#")) continue;
    const chiaveInCima = /^([A-Za-z][\w]*):\s*(.*)$/.exec(riga);
    if (chiaveInCima !== null) {
      const [, chiave = "", valore = ""] = chiaveInCima;
      inFiles = chiave === "files" && valore.trim() === "";
      if (!inFiles) cima[chiave] = scalare(valore);
      continue;
    }
    const nuovaVoce = /^\s+-\s+([A-Za-z][\w]*):\s*(.*)$/.exec(riga);
    if (inFiles && nuovaVoce !== null) {
      file.push({ [nuovaVoce[1] ?? ""]: scalare(nuovaVoce[2] ?? "") });
      continue;
    }
    const campoDellaVoce = /^\s{2,}([A-Za-z][\w]*):\s*(.*)$/.exec(riga);
    if (inFiles && campoDellaVoce !== null && file.length > 0) {
      (file.at(-1) as Record<string, string>)[campoDellaVoce[1] ?? ""] = scalare(campoDellaVoce[2] ?? "");
      continue;
    }
    return { motivo: `latest.yml ha una riga che non capisco: «${riga.slice(0, 80)}».` };
  }
  const versione = cima.version ?? "";
  if (!SEMVER.test(versione)) return { motivo: "latest.yml non dice una versione valida (come 1.2.3)." };
  const percorso = cima.path ?? file[0]?.url ?? "";
  if (percorso !== nomeDellInstaller(versione)) return { motivo: `L'installer di latest.yml si deve chiamare ${nomeDellInstaller(versione)}, non «${percorso.slice(0, 80)}».` };
  const voce = file.find((una) => una.url === percorso);
  if (voce === undefined) return { motivo: "In latest.yml l'elenco files non contiene l'installer." };
  const sha512 = voce.sha512 ?? cima.sha512 ?? "";
  if (!/^[A-Za-z0-9+/]{86}==$/.test(sha512)) return { motivo: "In latest.yml manca la SHA-512 dell'installer, o non è valida." };
  if (cima.sha512 !== undefined && cima.sha512 !== sha512) return { motivo: "latest.yml dice due SHA-512 diverse per l'installer." };
  const dimensione = Number(voce.size);
  if (!Number.isSafeInteger(dimensione) || dimensione <= 0 || dimensione > INSTALLER_MASSIMO) return { motivo: "In latest.yml manca la dimensione dell'installer, o non è valida." };
  const dimensioneBlockmap = voce.blockMapSize === undefined ? undefined : Number(voce.blockMapSize);
  if (dimensioneBlockmap !== undefined && (!Number.isSafeInteger(dimensioneBlockmap) || dimensioneBlockmap <= 0)) return { motivo: "In latest.yml blockMapSize non è valida." };
  return {
    versione,
    percorso,
    sha512,
    dimensione,
    ...(dimensioneBlockmap === undefined ? {} : { dimensioneBlockmap }),
    ...(cima.releaseDate === undefined ? {} : { dataDiRilascio: cima.releaseDate }),
  };
}

interface InfoPubblicata {
  versione: string;
  quando: string;
  installer: string;
  dimensione: number;
  /** Il .blockmap della versione di prima, se c'è. */
  blockmapPrecedente?: string;
}

/** Da dove prendere i file di una versione da pubblicare. */
export interface FonteDesktop {
  manifesto: Buffer;
  /** Il contenuto di un file della stessa cartella, a flusso; o il motivo per cui non c'è. */
  apri(nome: string): Promise<Readable | { motivo: string }>;
}

export class AggiornamentiDesktop {
  readonly #cartella: string;
  #inCorso: Promise<unknown> = Promise.resolve();

  constructor(cartella: string) {
    this.#cartella = cartella;
    mkdirSync(cartella, { recursive: true });
    // Ciò che una pubblicazione interrotta ha lasciato a metà.
    for (const nome of readdirSync(cartella)) {
      if (nome.startsWith("in-arrivo-") || nome.startsWith("vecchia-")) rmSync(join(cartella, nome), { recursive: true, force: true });
    }
  }

  #info(): InfoPubblicata | undefined {
    try {
      return JSON.parse(readFileSync(join(this.#cartella, PUBBLICATA, INFO), "utf8")) as InfoPubblicata;
    } catch {
      return undefined;
    }
  }

  stato(): StatoDesktop {
    const info = this.#info();
    return info === undefined ? {} : { pubblicata: { versione: info.versione, quando: info.quando, dimensione: info.dimensione } };
  }

  /** latest.yml così com'è stato pubblicato, o nulla se non c'è una versione. */
  manifesto(): Buffer | undefined {
    if (this.#info() === undefined) return undefined;
    try {
      return readFileSync(join(this.#cartella, PUBBLICATA, MANIFESTO));
    } catch {
      return undefined;
    }
  }

  /** Dove sta un file che si può scaricare: l'installer, il suo .blockmap, il .blockmap di prima. */
  file(nome: string): { percorso: string; dimensione: number } | undefined {
    const info = this.#info();
    if (info === undefined) return undefined;
    const ammessi = new Map<string, string>([
      [info.installer, join(this.#cartella, PUBBLICATA, info.installer)],
      [`${info.installer}.blockmap`, join(this.#cartella, PUBBLICATA, `${info.installer}.blockmap`)],
    ]);
    if (info.blockmapPrecedente !== undefined) ammessi.set(info.blockmapPrecedente, join(this.#cartella, PUBBLICATA, BLOCKMAP_PRECEDENTE, info.blockmapPrecedente));
    const percorso = ammessi.get(nome);
    if (percorso === undefined || !existsSync(percorso)) return undefined;
    return { percorso, dimensione: statSync(percorso).size };
  }

  /**
   * Pubblica una versione: controlla latest.yml, che la versione venga dopo quella servita, e che
   * l'installer abbia la SHA-512 e la dimensione che dice; solo allora la mette al posto di quella
   * di prima. Una pubblicazione per volta.
   */
  pubblica(fonte: FonteDesktop): Promise<{ versione: string } | { motivo: string }> {
    const fatto = this.#inCorso.then(() => this.#pubblica(fonte));
    this.#inCorso = fatto.catch(() => {});
    return fatto;
  }

  async #pubblica(fonte: FonteDesktop): Promise<{ versione: string } | { motivo: string }> {
    if (fonte.manifesto.length > MANIFESTO_MASSIMO) return { motivo: "latest.yml è troppo grande." };
    const manifesto = leggiManifesto(fonte.manifesto.toString("utf8"));
    if ("motivo" in manifesto) return manifesto;
    const prima = this.#info();
    if (prima !== undefined && confrontaVersioni(manifesto.versione, prima.versione) <= 0) {
      return { motivo: `La versione ${manifesto.versione} non viene dopo quella pubblicata, la ${prima.versione}.` };
    }
    const arrivo = join(this.#cartella, `in-arrivo-${randomBytes(6).toString("hex")}`);
    mkdirSync(arrivo);
    try {
      const installer = await this.#prendi(fonte, manifesto.percorso, join(arrivo, manifesto.percorso), INSTALLER_MASSIMO);
      if ("motivo" in installer) return installer;
      if (installer.dimensione !== manifesto.dimensione) {
        return { motivo: `L'installer è di ${installer.dimensione} byte, latest.yml ne dice ${manifesto.dimensione}.` };
      }
      if (installer.sha512 !== manifesto.sha512) return { motivo: "La SHA-512 dell'installer non è quella di latest.yml: il file non è quello costruito con questo manifesto." };
      const nomeBlockmap = `${manifesto.percorso}.blockmap`;
      const blockmap = await this.#prendi(fonte, nomeBlockmap, join(arrivo, nomeBlockmap), BLOCKMAP_MASSIMO);
      if ("motivo" in blockmap) return blockmap;
      if (!blockmap.gzip) return { motivo: `${nomeBlockmap} non è un .blockmap di electron-builder.` };
      if (manifesto.dimensioneBlockmap !== undefined && blockmap.dimensione !== manifesto.dimensioneBlockmap) {
        return { motivo: `${nomeBlockmap} è di ${blockmap.dimensione} byte, latest.yml ne dice ${manifesto.dimensioneBlockmap}.` };
      }
      writeFileSync(join(arrivo, MANIFESTO), fonte.manifesto);
      // Della versione di prima resta il .blockmap, per scaricare solo le parti cambiate.
      let blockmapPrecedente: string | undefined;
      if (prima !== undefined && existsSync(join(this.#cartella, PUBBLICATA, `${prima.installer}.blockmap`))) {
        blockmapPrecedente = `${prima.installer}.blockmap`;
        mkdirSync(join(arrivo, BLOCKMAP_PRECEDENTE));
        writeFileSync(join(arrivo, BLOCKMAP_PRECEDENTE, blockmapPrecedente), readFileSync(join(this.#cartella, PUBBLICATA, blockmapPrecedente)));
      }
      const info: InfoPubblicata = {
        versione: manifesto.versione,
        quando: new Date().toISOString(),
        installer: manifesto.percorso,
        dimensione: installer.dimensione,
        ...(blockmapPrecedente === undefined ? {} : { blockmapPrecedente }),
      };
      writeFileSync(join(arrivo, INFO), JSON.stringify(info, null, 2));
      // Solo adesso la versione diventa visibile: prima si sposta da parte quella di prima.
      const pubblicata = join(this.#cartella, PUBBLICATA);
      const vecchia = join(this.#cartella, `vecchia-${randomBytes(6).toString("hex")}`);
      if (existsSync(pubblicata)) renameSync(pubblicata, vecchia);
      renameSync(arrivo, pubblicata);
      rmSync(vecchia, { recursive: true, force: true });
      return { versione: manifesto.versione };
    } finally {
      rmSync(arrivo, { recursive: true, force: true });
    }
  }

  /** Copia un file dalla fonte, con la sua SHA-512 e la sua dimensione, senza superare il massimo. */
  async #prendi(fonte: FonteDesktop, nome: string, destinazione: string, massimo: number): Promise<{ sha512: string; dimensione: number; gzip: boolean } | { motivo: string }> {
    const flusso = await fonte.apri(nome);
    if ("motivo" in flusso) return { motivo: `${nome}: ${flusso.motivo}` };
    const impronta = createHash("sha512");
    let dimensione = 0;
    let inizio: Buffer | undefined;
    let troppo = false;
    flusso.on("data", (pezzo: Buffer) => {
      inizio ??= pezzo.subarray(0, 2);
      dimensione += pezzo.length;
      if (dimensione > massimo) {
        troppo = true;
        flusso.destroy(new Error("troppo grande"));
        return;
      }
      impronta.update(pezzo);
    });
    try {
      await pipeline(flusso, createWriteStream(destinazione));
    } catch (errore) {
      if (troppo) return { motivo: `${nome} è più grande di ${Math.round(massimo / 1024 / 1024)} MB.` };
      return { motivo: `${nome} non è arrivato per intero: ${errore instanceof Error ? errore.message : String(errore)}` };
    }
    return { sha512: impronta.digest("base64"), dimensione, gzip: inizio?.[0] === 0x1f && inizio[1] === 0x8b };
  }
}
