/**
 * La versione dell'archivio di una conversazione (ADR 0046). Sta in un file accanto all'archivio,
 * `<archivio>.versione`, con il numero dell'ultimo evento e la lunghezza dell'archivio quando è
 * stato scritto: così si sa fin dove arriva un archivio senza leggerlo, e se nel frattempo è
 * cambiato. La versione non entra nelle copie di sicurezza: un archivio ripristinato ne prende
 * una nuova, perché chi ne ha una copia può avere eventi che quello ripristinato non ha.
 */

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import type { EventoArchiviato, IndiceArchivio } from "../protocollo/eventi.ts";

export const ESTENSIONE_VERSIONE = ".versione";

/** La versione di un archivio che non esiste ancora: nessuna versione vera la ripete. */
export const VERSIONE_DI_UN_ARCHIVIO_CHE_NON_CE = "vuoto";

/** Ciò che sta nel file della versione. */
export interface IndiceSalvato extends IndiceArchivio {
  /** Quanti byte aveva l'archivio quando il file è stato scritto. */
  byte: number;
}

export function fileDellaVersione(archivio: string): string {
  return `${archivio}${ESTENSIONE_VERSIONE}`;
}

export function nuovaVersione(): string {
  return randomBytes(9).toString("base64url");
}

export function leggiIndiceSalvato(archivio: string): IndiceSalvato | undefined {
  try {
    const letto = JSON.parse(readFileSync(fileDellaVersione(archivio), "utf8")) as Partial<IndiceSalvato>;
    if (typeof letto.versione !== "string" || letto.versione === "" || typeof letto.ultimo !== "number" || typeof letto.byte !== "number") return undefined;
    return { versione: letto.versione, ultimo: letto.ultimo, byte: letto.byte };
  } catch {
    return undefined;
  }
}

export function scriviIndice(archivio: string, indice: IndiceSalvato): void {
  const file = fileDellaVersione(archivio);
  const provvisorio = `${file}.${process.pid}.tmp`;
  writeFileSync(provvisorio, JSON.stringify(indice));
  renameSync(provvisorio, file);
}

/** Ciò che si ricava leggendo un archivio. */
export interface ArchivioLetto {
  archiviati: EventoArchiviato[];
  /** L'ultima riga era a metà: uno spegnimento brusco durante una scrittura. */
  rigaSpezzata: boolean;
  /** Una riga persa o un numero fuori posto: i numeri degli eventi sono stati riassegnati. */
  rinumerati: boolean;
}

export function analizzaArchivio(contenuto: string): ArchivioLetto {
  const archiviati: EventoArchiviato[] = [];
  let rinumerati = false;
  const righe = contenuto.split("\n");
  for (const [posizione, riga] of righe.entries()) {
    if (riga.trim() === "") continue;
    try {
      const letto = JSON.parse(riga) as EventoArchiviato;
      const n = archiviati.length + 1;
      if (letto.n !== n) rinumerati = true;
      // I numeri vengono riassegnati in ordine: una riga persa non lascia buchi.
      archiviati.push({ ...letto, n });
    } catch {
      // Una riga scritta a metà durante uno spegnimento brusco viene ignorata. Se non è l'ultima,
      // gli eventi dopo di lei cambiano numero.
      if (posizione < righe.length - 1) rinumerati = true;
    }
  }
  return { archiviati, rigaSpezzata: contenuto !== "" && !contenuto.endsWith("\n"), rinumerati };
}

export function testoDellArchivio(archiviati: readonly EventoArchiviato[]): string {
  return archiviati.map((archiviato) => `${JSON.stringify(archiviato)}\n`).join("");
}

/**
 * Decide la versione di un archivio appena letto, e lo rimette in ordine se serve: con una riga
 * spezzata o dei numeri riassegnati l'archivio viene riscritto con i numeri giusti, e la versione
 * cambia. La versione di prima resta solo se l'archivio è la continuazione di quello di cui parla.
 */
export function sistemaArchivio(archivio: string, letto: ArchivioLetto): IndiceSalvato {
  let byte: number;
  if (letto.rigaSpezzata || letto.rinumerati) {
    const testo = testoDellArchivio(letto.archiviati);
    const provvisorio = `${archivio}.${process.pid}.tmp`;
    writeFileSync(provvisorio, testo);
    renameSync(provvisorio, archivio);
    byte = Buffer.byteLength(testo);
  } else {
    byte = existsSync(archivio) ? statSync(archivio).size : 0;
  }
  const salvato = leggiIndiceSalvato(archivio);
  const ultimo = letto.archiviati.length;
  const continua = salvato !== undefined && !letto.rigaSpezzata && !letto.rinumerati && salvato.ultimo <= ultimo;
  const indice = { versione: continua ? salvato.versione : nuovaVersione(), ultimo, byte };
  if (salvato?.versione !== indice.versione || salvato.ultimo !== indice.ultimo || salvato.byte !== indice.byte) scriviIndice(archivio, indice);
  return indice;
}

/**
 * Fin dove arriva un archivio che nessuno ha aperto, senza tenerlo in memoria: dal file della
 * versione, se l'archivio ha ancora la lunghezza che quel file dice; altrimenti lo legge e lo sistema.
 * Non va usato per un archivio aperto in un canale: lì vale ciò che sa il canale.
 */
export function indiceSenzaAprire(archivio: string): IndiceArchivio {
  // Un archivio che non c'è non ha eventi: non si scrive nulla, e quando nascerà avrà una versione sua.
  if (!existsSync(archivio)) return { ultimo: 0, versione: VERSIONE_DI_UN_ARCHIVIO_CHE_NON_CE };
  const salvato = leggiIndiceSalvato(archivio);
  const byte = statSync(archivio).size;
  if (salvato !== undefined && salvato.byte === byte) return { ultimo: salvato.ultimo, versione: salvato.versione };
  const contenuto = byte === 0 ? "" : readFileSync(archivio, "utf8");
  const { ultimo, versione } = sistemaArchivio(archivio, analizzaArchivio(contenuto));
  return { ultimo, versione };
}
