/**
 * I file dei progetti di questo ambiente, letti per il pannello File: una cartella, una ricerca
 * per nome, un file per l'anteprima. Solo lettura, e mai fuori dalla cartella del progetto, anche
 * seguendo un collegamento simbolico.
 */

import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import {
  CARTELLE_SALTATE,
  FILE_LETTO_MASSIMO,
  TROVATI_MASSIMI,
  VOCI_GUARDATE_MASSIME,
  type ComandoFile,
  type ElencoCartella,
  type FileLetto,
  type FileTrovati,
  type PortaFile,
  type RiferitoFile,
} from "../protocollo/file-progetto.ts";

/** Quanto può durare una ricerca. */
const DURATA_RICERCA_MS = 5000;

export class FileDeiProgettiQui implements PortaFile {
  readonly #riferisci: (messaggio: RiferitoFile) => void;

  constructor(riferisci: (messaggio: RiferitoFile) => void) {
    this.#riferisci = riferisci;
  }

  esegui(comando: ComandoFile): void {
    const fatto: Promise<unknown> =
      comando.tipo === "file-elenca"
        ? elenca(comando.cartella, comando.percorso)
        : comando.tipo === "file-cerca"
          ? cerca(comando.cartella, comando.testo)
          : leggi(comando.cartella, comando.percorso);
    void fatto
      .catch((errore: unknown) => ({ motivo: inParole(errore) }))
      .then((esito) => this.#riferisci({ tipo: "file-esito", idRichiesta: comando.idRichiesta, esito }));
  }
}

/** Il percorso assoluto di un file del progetto, dopo aver seguito i collegamenti; errore se esce dalla cartella. */
async function dentro(cartella: string, percorso: string): Promise<{ radice: string; assoluto: string }> {
  const radice = await realpath(resolve(cartella));
  const assoluto = await realpath(resolve(radice, percorso));
  if (assoluto !== radice && !assoluto.startsWith(radice + sep)) throw new Error("Questo percorso esce dalla cartella del progetto.");
  return { radice, assoluto };
}

export async function elenca(cartella: string, percorso: string): Promise<ElencoCartella> {
  const { assoluto } = await dentro(cartella, percorso);
  const voci = await readdir(assoluto, { withFileTypes: true });
  const elencate = await Promise.all(
    voci
      .filter((voce) => voce.name !== ".git")
      .map(async (voce) => {
        const completo = join(assoluto, voce.name);
        // Un collegamento conta per ciò a cui punta.
        const info = await stat(completo).catch(() => undefined);
        const eCartella = info?.isDirectory() ?? voce.isDirectory();
        return { nome: voce.name, cartella: eCartella, ...(eCartella || info === undefined ? {} : { dimensione: info.size }) };
      }),
  );
  elencate.sort((a, b) => (a.cartella === b.cartella ? a.nome.localeCompare(b.nome, "it", { sensitivity: "base", numeric: true }) : a.cartella ? -1 : 1));
  return { percorso, voci: elencate };
}

/** I file e le cartelle il cui nome contiene il testo cercato, senza maiuscole, dai più vicini alla cartella. */
export async function cerca(cartella: string, cercato: string): Promise<FileTrovati> {
  const { radice } = await dentro(cartella, "");
  const parole = cercato.toLowerCase().split(/\s+/).filter((parola) => parola !== "");
  const percorsi: string[] = [];
  const scade = Date.now() + DURATA_RICERCA_MS;
  let guardate = 0;
  let incompleta = false;
  const coda = [radice];
  while (coda.length > 0) {
    const qui = coda.shift() ?? radice;
    if (guardate > VOCI_GUARDATE_MASSIME || Date.now() > scade) {
      incompleta = true;
      break;
    }
    const voci = await readdir(qui, { withFileTypes: true }).catch(() => []);
    voci.sort((a, b) => a.name.localeCompare(b.name));
    for (const voce of voci) {
      guardate += 1;
      const completo = join(qui, voce.name);
      const relativo = relative(radice, completo).split(sep).join("/");
      if (voce.isDirectory()) {
        if (CARTELLE_SALTATE.has(voce.name)) continue;
        coda.push(completo);
      }
      const nome = relativo.toLowerCase();
      if (parole.every((parola) => nome.includes(parola)) && parole.some((parola) => voce.name.toLowerCase().includes(parola))) {
        if (percorsi.length >= TROVATI_MASSIMI) {
          incompleta = true;
          return { percorsi, incompleta };
        }
        percorsi.push(voce.isDirectory() ? `${relativo}/` : relativo);
      }
    }
  }
  return { percorsi, incompleta };
}

export async function leggi(cartella: string, percorso: string): Promise<FileLetto | { motivo: string }> {
  const { assoluto } = await dentro(cartella, percorso);
  const info = await stat(assoluto);
  if (info.isDirectory()) return { motivo: "È una cartella." };
  if (info.size > FILE_LETTO_MASSIMO) {
    return { motivo: `Il file è di ${Math.round(info.size / 1024 / 1024)} MB: l'anteprima mostra file fino a ${FILE_LETTO_MASSIMO / 1024 / 1024} MB.` };
  }
  const contenuto = await readFile(assoluto);
  return { percorso, dimensione: info.size, dati: contenuto.toString("base64") };
}

function inParole(errore: unknown): string {
  if (errore instanceof Error && "code" in errore) {
    if (errore.code === "ENOENT") return "Il file non c'è.";
    if (errore.code === "EACCES" || errore.code === "EPERM") return "Non ho il permesso di leggerlo.";
  }
  return errore instanceof Error ? errore.message : String(errore);
}
