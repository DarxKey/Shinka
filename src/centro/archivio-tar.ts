/**
 * Un archivio tar scritto e letto da Shinka, senza programmi esterni: per il pacchetto con cui
 * nasce un'installazione nuova, tutto in memoria, e per la copia di sicurezza dei dati, un pezzo
 * alla volta. Formato ustar, che leggono `tar` su Linux e su Windows; un percorso che non ci sta
 * viaggia in una voce a parte che lo precede, come fa GNU tar.
 */

import { gzipSync } from "node:zlib";

export interface VoceArchivio {
  /** Il percorso dentro l'archivio, con le barre in avanti. */
  percorso: string;
  dati: Buffer;
  /** I permessi del file: 0o644 se non è detto, 0o755 per uno script da lanciare. */
  modo?: number;
}

const BLOCCO = 512;

/** Divide un percorso lungo tra il campo del nome (100 byte) e quello del prefisso (155). */
function nomeEPrefisso(percorso: string): { nome: string; prefisso: string } {
  if (Buffer.byteLength(percorso) <= 100) return { nome: percorso, prefisso: "" };
  for (let i = percorso.lastIndexOf("/"); i > 0; i = percorso.lastIndexOf("/", i - 1)) {
    const prefisso = percorso.slice(0, i);
    const nome = percorso.slice(i + 1);
    if (Buffer.byteLength(prefisso) <= 155 && Buffer.byteLength(nome) <= 100) return { nome, prefisso };
  }
  throw new Error(`Percorso troppo lungo per l'archivio: ${percorso}`);
}

function ottale(valore: number, lunghezza: number): string {
  return `${valore.toString(8).padStart(lunghezza - 1, "0")}\0`;
}

function intestazione(voce: VoceArchivio, momento: number): Buffer {
  const { nome, prefisso } = nomeEPrefisso(voce.percorso);
  return blocco(nome, prefisso, voce.dati.length, momento, voce.modo ?? 0o644, "0");
}

function blocco(nome: string, prefisso: string, lunghezza: number, momento: number, modo: number, tipo: string): Buffer {
  const blocco = Buffer.alloc(BLOCCO, 0);
  blocco.write(nome, 0, 100, "utf8");
  blocco.write(ottale(modo, 8), 100, 8, "ascii");
  blocco.write(ottale(0, 8), 108, 8, "ascii");
  blocco.write(ottale(0, 8), 116, 8, "ascii");
  blocco.write(ottale(lunghezza, 12), 124, 12, "ascii");
  blocco.write(ottale(momento, 12), 136, 12, "ascii");
  blocco.write("        ", 148, 8, "ascii");
  blocco.write(tipo, 156, 1, "ascii");
  blocco.write("ustar\0", 257, 6, "ascii");
  blocco.write("00", 263, 2, "ascii");
  blocco.write(prefisso, 345, 155, "utf8");
  let somma = 0;
  for (const byte of blocco) somma += byte;
  blocco.write(`${somma.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
  return blocco;
}

/** L'archivio intero, già compresso. */
export function archivioTarGz(voci: readonly VoceArchivio[], momento: Date = new Date()): Buffer {
  const secondi = Math.floor(momento.getTime() / 1000);
  const parti: Buffer[] = [];
  for (const voce of voci) {
    parti.push(intestazione(voce, secondi), voce.dati);
    const resto = voce.dati.length % BLOCCO;
    if (resto !== 0) parti.push(Buffer.alloc(BLOCCO - resto, 0));
  }
  parti.push(Buffer.alloc(BLOCCO * 2, 0));
  return gzipSync(Buffer.concat(parti));
}

/** Quanto può essere grande un file dentro un archivio ustar. */
export const FILE_TAR_MASSIMO = 8 * 1024 * 1024 * 1024 - 1;

/** Ciò che chiude un archivio. */
export const FINE_TAR = Buffer.alloc(BLOCCO * 2, 0);

/** Ciò che porta il contenuto di una voce alla fine del suo blocco. */
export function riempimentoTar(lunghezza: number): Buffer {
  const resto = lunghezza % BLOCCO;
  return resto === 0 ? Buffer.alloc(0) : Buffer.alloc(BLOCCO - resto, 0);
}

/**
 * Ciò che precede il contenuto di una voce, per chi scrive l'archivio un pezzo alla volta. Per una
 * cartella non segue alcun contenuto. Un percorso troppo lungo per ustar viaggia prima, per intero.
 */
export function intestazioneTar(percorso: string, lunghezza: number, momento: Date, opzioni: { modo?: number; cartella?: boolean } = {}): Buffer {
  const secondi = Math.floor(momento.getTime() / 1000);
  const cartella = opzioni.cartella === true;
  const scritto = cartella && !percorso.endsWith("/") ? `${percorso}/` : percorso;
  const modo = opzioni.modo ?? (cartella ? 0o755 : 0o644);
  const tipo = cartella ? "5" : "0";
  try {
    const { nome, prefisso } = nomeEPrefisso(scritto);
    return blocco(nome, prefisso, cartella ? 0 : lunghezza, secondi, modo, tipo);
  } catch {
    const intero = Buffer.from(`${scritto}\0`, "utf8");
    // Nel campo del nome resta l'inizio del percorso: chi non conosce la voce lunga trova almeno quello.
    const corto = Buffer.from(scritto, "utf8").subarray(0, 100).toString("latin1");
    const ridotto = blocco("", "", cartella ? 0 : lunghezza, secondi, modo, tipo);
    ridotto.write(corto, 0, 100, "latin1");
    ridotto.write("        ", 148, 8, "ascii");
    let somma = 0;
    for (const byte of ridotto) somma += byte;
    ridotto.write(`${somma.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
    return Buffer.concat([blocco("././@LongLink", "", intero.length, secondi, 0o644, "L"), intero, riempimentoTar(intero.length), ridotto]);
  }
}

/** Una voce incontrata leggendo un archivio. */
export interface VoceLetta {
  percorso: string;
  tipo: "file" | "cartella" | "altro";
  lunghezza: number;
  modo: number;
}

/** Chi riceve ciò che si legge da un archivio: una voce, poi il suo contenuto a pezzi, poi la sua fine. */
export interface AscoltoTar {
  voce(voce: VoceLetta): Promise<void> | void;
  dati(pezzo: Buffer): Promise<void> | void;
  fine(): Promise<void> | void;
}

/** L'archivio non è un tar che Shinka sa leggere. */
export class TarNonValido extends Error {}

/** Legge un archivio tar un pezzo alla volta, senza tenerlo in memoria. */
export async function leggiTar(sorgente: AsyncIterable<Buffer>, ascolto: AscoltoTar): Promise<void> {
  let attesi: Buffer[] = [];
  let quanti = 0;
  const iteratore = sorgente[Symbol.asyncIterator]();
  let finita = false;
  /** Prende esattamente `n` byte, o meno solo se la sorgente finisce. */
  const prendi = async (n: number): Promise<Buffer> => {
    while (quanti < n && !finita) {
      const passo = await iteratore.next();
      if (passo.done === true) finita = true;
      else if (passo.value.length > 0) {
        attesi.push(passo.value);
        quanti += passo.value.length;
      }
    }
    const tutto = attesi.length === 1 ? (attesi[0] as Buffer) : Buffer.concat(attesi);
    const preso = tutto.subarray(0, n);
    const resto = tutto.subarray(preso.length);
    attesi = resto.length === 0 ? [] : [resto];
    quanti = resto.length;
    return preso;
  };
  let nomeLungo: string | undefined;
  for (;;) {
    const testa = await prendi(BLOCCO);
    if (testa.length === 0) return;
    if (testa.length < BLOCCO) throw new TarNonValido("L'archivio finisce a metà di una voce.");
    if (testa.every((byte) => byte === 0)) return;
    let somma = 0;
    for (let i = 0; i < BLOCCO; i += 1) somma += i >= 148 && i < 156 ? 32 : (testa[i] as number);
    if (parseInt(campo(testa, 148, 8), 8) !== somma) throw new TarNonValido("L'archivio è rovinato: una voce non torna con il suo controllo.");
    const lunghezza = parseInt(campo(testa, 124, 12), 8);
    if (!Number.isInteger(lunghezza) || lunghezza < 0) throw new TarNonValido("L'archivio è rovinato: una voce non dice quanto è lunga.");
    const tipo = String.fromCharCode(testa[156] ?? 0);
    const riempimento = (BLOCCO - (lunghezza % BLOCCO)) % BLOCCO;
    if (tipo === "L") {
      if (lunghezza > 8192) throw new TarNonValido("L'archivio ha un percorso troppo lungo.");
      const intero = await prendi(lunghezza + riempimento);
      if (intero.length < lunghezza + riempimento) throw new TarNonValido("L'archivio finisce a metà di una voce.");
      nomeLungo = intero.subarray(0, lunghezza).toString("utf8").replace(/\0+$/, "");
      continue;
    }
    const prefisso = campo(testa, 345, 155);
    const nome = campo(testa, 0, 100);
    const percorso = nomeLungo ?? (prefisso === "" ? nome : `${prefisso}/${nome}`);
    nomeLungo = undefined;
    const cartella = tipo === "5";
    const file = tipo === "0" || tipo === "\0";
    await ascolto.voce({ percorso, tipo: file ? "file" : cartella ? "cartella" : "altro", lunghezza: file ? lunghezza : 0, modo: parseInt(campo(testa, 100, 8), 8) || 0o644 });
    let mancano = lunghezza;
    while (mancano > 0) {
      const pezzo = await prendi(Math.min(mancano, 1024 * 1024));
      if (pezzo.length === 0) throw new TarNonValido("L'archivio finisce a metà di un file.");
      mancano -= pezzo.length;
      if (file) await ascolto.dati(pezzo);
    }
    if (riempimento > 0 && (await prendi(riempimento)).length < riempimento) throw new TarNonValido("L'archivio finisce a metà di una voce.");
    await ascolto.fine();
  }
}

/** Il testo di un campo dell'intestazione, fino al primo zero. */
function campo(testa: Buffer, da: number, lungo: number): string {
  const pezzo = testa.subarray(da, da + lungo);
  const fine = pezzo.indexOf(0);
  return pezzo.subarray(0, fine === -1 ? lungo : fine).toString("utf8").trim();
}
