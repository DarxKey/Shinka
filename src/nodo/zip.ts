/**
 * Un archivio ZIP scritto a flusso, per scaricare una cartella dal pannello File: i pezzi escono
 * mentre i file si leggono, senza tenere in memoria né su disco l'archivio intero. ZIP64 quando
 * serve, cioè oltre i 4 GB o i 65.535 file, perché una cartella si scarica intera, dipendenze e
 * .git compresi. I file già compressi (immagini, video, archivi) si mettono così come sono.
 *
 * Mai fuori dalla cartella: un collegamento che porta fuori non entra, e un collegamento a una
 * cartella non si segue, per non girare in tondo.
 */

import { createReadStream } from "node:fs";
import { lstat, readdir, realpath, stat } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
import { crc32, createDeflateRaw } from "node:zlib";

const FIRMA_LOCALE = 0x04034b50;
const FIRMA_DESCRITTORE = 0x08074b50;
const FIRMA_CENTRALE = 0x02014b50;
const FIRMA_FINE = 0x06054b50;
const FIRMA_FINE_64 = 0x06064b50;
const FIRMA_LOCALIZZATORE_64 = 0x07064b50;
const MASSIMO_32 = 0xffffffff;
const MASSIMO_16 = 0xffff;
/** Bit 3: dimensioni e CRC nel descrittore dopo i dati. Bit 11: nomi in UTF-8. */
const BANDIERE = (1 << 3) | (1 << 11);
const VERSIONE_ZIP64 = 45;
const VERSIONE_SEMPLICE = 20;
/** Fatto da un sistema Unix: gli attributi esterni portano i permessi. */
const FATTO_DA = (3 << 8) | VERSIONE_ZIP64;

/** Le estensioni dei file che compressi non diventano più piccoli. */
const GIA_COMPRESSI = new Set([
  ".zip", ".gz", ".tgz", ".bz2", ".xz", ".7z", ".rar", ".zst", ".jar", ".apk", ".whl",
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif", ".heic",
  ".mp4", ".mov", ".mkv", ".webm", ".avi", ".mp3", ".m4a", ".aac", ".ogg", ".opus", ".flac",
  ".pdf", ".docx", ".xlsx", ".pptx", ".woff", ".woff2",
]);

interface Voce {
  /** Il nome nell'archivio, con "/"; una cartella finisce con "/". */
  nome: string;
  assoluto: string;
  cartella: boolean;
  dimensione: number;
  modificato: Date;
  permessi: number;
}

interface Scritta {
  nome: Buffer;
  cartella: boolean;
  metodo: number;
  crc: number;
  compressa: number;
  intera: number;
  scostamento: number;
  dos: { ora: number; data: number };
  permessi: number;
  zip64: boolean;
}

/** I file e le cartelle sotto `radice`, in ordine, con i nomi dell'archivio che cominciano da `base`. */
export async function vociDellaCartella(radice: string, base: string): Promise<Voce[]> {
  const vera = await realpath(radice);
  const voci: Voce[] = [];
  const visita = async (qui: string): Promise<void> => {
    const elementi = await readdir(qui, { withFileTypes: true }).catch(() => []);
    elementi.sort((a, b) => a.name.localeCompare(b.name));
    let vuota = true;
    for (const elemento of elementi) {
      const completo = join(qui, elemento.name);
      const nome = `${base}/${relative(vera, completo).split(sep).join("/")}`;
      let info = await lstat(completo).catch(() => undefined);
      if (info === undefined) continue;
      if (info.isSymbolicLink()) {
        // Un collegamento entra solo se porta a un file dentro la cartella.
        const destinazione = await realpath(completo).catch(() => undefined);
        if (destinazione === undefined || !destinazione.startsWith(vera + sep)) continue;
        info = await stat(destinazione).catch(() => undefined);
        if (info === undefined || !info.isFile()) continue;
      }
      if (info.isDirectory()) {
        vuota = false;
        await visita(completo);
        continue;
      }
      if (!info.isFile()) continue;
      vuota = false;
      voci.push({ nome, assoluto: completo, cartella: false, dimensione: info.size, modificato: info.mtime, permessi: info.mode & 0o777 });
    }
    // Una cartella vuota resta, come voce a sé.
    if (vuota) {
      const info = await stat(qui).catch(() => undefined);
      const nome = qui === vera ? `${base}/` : `${base}/${relative(vera, qui).split(sep).join("/")}/`;
      voci.push({ nome, assoluto: qui, cartella: true, dimensione: 0, modificato: info?.mtime ?? new Date(), permessi: (info?.mode ?? 0o755) & 0o777 });
    }
  };
  await visita(vera);
  return voci;
}

/** Data e ora come le vuole il formato ZIP, all'ora locale, dal 1980. */
function dataDos(quando: Date): { ora: number; data: number } {
  const anno = Math.max(1980, quando.getFullYear());
  return {
    ora: (quando.getHours() << 11) | (quando.getMinutes() << 5) | Math.floor(quando.getSeconds() / 2),
    data: ((anno - 1980) << 9) | ((quando.getMonth() + 1) << 5) | quando.getDate(),
  };
}

function intestazioneLocale(voce: Scritta): Buffer {
  // Con ZIP64 le dimensioni stanno nel campo in più, a zero, e il descrittore le ha a 8 byte.
  const extra = voce.zip64 ? Buffer.alloc(20) : Buffer.alloc(0);
  if (voce.zip64) {
    extra.writeUInt16LE(0x0001, 0);
    extra.writeUInt16LE(16, 2);
  }
  const testa = Buffer.alloc(30);
  testa.writeUInt32LE(FIRMA_LOCALE, 0);
  testa.writeUInt16LE(voce.zip64 ? VERSIONE_ZIP64 : VERSIONE_SEMPLICE, 4);
  testa.writeUInt16LE(BANDIERE, 6);
  testa.writeUInt16LE(voce.metodo, 8);
  testa.writeUInt16LE(voce.dos.ora, 10);
  testa.writeUInt16LE(voce.dos.data, 12);
  testa.writeUInt32LE(0, 14);
  testa.writeUInt32LE(voce.zip64 ? MASSIMO_32 : 0, 18);
  testa.writeUInt32LE(voce.zip64 ? MASSIMO_32 : 0, 22);
  testa.writeUInt16LE(voce.nome.length, 26);
  testa.writeUInt16LE(extra.length, 28);
  return Buffer.concat([testa, voce.nome, extra]);
}

function descrittore(voce: Scritta): Buffer {
  if (voce.zip64) {
    const fine = Buffer.alloc(24);
    fine.writeUInt32LE(FIRMA_DESCRITTORE, 0);
    fine.writeUInt32LE(voce.crc, 4);
    fine.writeBigUInt64LE(BigInt(voce.compressa), 8);
    fine.writeBigUInt64LE(BigInt(voce.intera), 16);
    return fine;
  }
  const fine = Buffer.alloc(16);
  fine.writeUInt32LE(FIRMA_DESCRITTORE, 0);
  fine.writeUInt32LE(voce.crc, 4);
  fine.writeUInt32LE(voce.compressa, 8);
  fine.writeUInt32LE(voce.intera, 12);
  return fine;
}

function intestazioneCentrale(voce: Scritta): Buffer {
  const grandi = [voce.intera, voce.compressa, voce.scostamento].map((valore) => valore >= MASSIMO_32);
  const extraValori = [voce.intera, voce.compressa, voce.scostamento].filter((_, indice) => grandi[indice]);
  const extra = Buffer.alloc(extraValori.length === 0 ? 0 : 4 + extraValori.length * 8);
  if (extraValori.length > 0) {
    extra.writeUInt16LE(0x0001, 0);
    extra.writeUInt16LE(extraValori.length * 8, 2);
    extraValori.forEach((valore, indice) => extra.writeBigUInt64LE(BigInt(valore), 4 + indice * 8));
  }
  const zip64 = voce.zip64 || extraValori.length > 0;
  const testa = Buffer.alloc(46);
  testa.writeUInt32LE(FIRMA_CENTRALE, 0);
  testa.writeUInt16LE(FATTO_DA, 4);
  testa.writeUInt16LE(zip64 ? VERSIONE_ZIP64 : VERSIONE_SEMPLICE, 6);
  testa.writeUInt16LE(BANDIERE, 8);
  testa.writeUInt16LE(voce.metodo, 10);
  testa.writeUInt16LE(voce.dos.ora, 12);
  testa.writeUInt16LE(voce.dos.data, 14);
  testa.writeUInt32LE(voce.crc, 16);
  testa.writeUInt32LE(grandi[1] ? MASSIMO_32 : voce.compressa, 20);
  testa.writeUInt32LE(grandi[0] ? MASSIMO_32 : voce.intera, 24);
  testa.writeUInt16LE(voce.nome.length, 28);
  testa.writeUInt16LE(extra.length, 30);
  testa.writeUInt16LE(0, 32);
  testa.writeUInt16LE(0, 34);
  testa.writeUInt16LE(0, 36);
  const tipo = voce.cartella ? 0o040000 : 0o100000;
  testa.writeUInt32LE((((tipo | voce.permessi) << 16) | (voce.cartella ? 0x10 : 0)) >>> 0, 38);
  testa.writeUInt32LE(grandi[2] ? MASSIMO_32 : voce.scostamento, 42);
  return Buffer.concat([testa, voce.nome, extra]);
}

function fine(quante: number, inizioCentrale: number, lunghezzaCentrale: number): Buffer {
  const parti: Buffer[] = [];
  const zip64 = quante >= MASSIMO_16 || inizioCentrale >= MASSIMO_32 || lunghezzaCentrale >= MASSIMO_32;
  if (zip64) {
    const record = Buffer.alloc(56);
    record.writeUInt32LE(FIRMA_FINE_64, 0);
    record.writeBigUInt64LE(44n, 4);
    record.writeUInt16LE(FATTO_DA, 12);
    record.writeUInt16LE(VERSIONE_ZIP64, 14);
    record.writeUInt32LE(0, 16);
    record.writeUInt32LE(0, 20);
    record.writeBigUInt64LE(BigInt(quante), 24);
    record.writeBigUInt64LE(BigInt(quante), 32);
    record.writeBigUInt64LE(BigInt(lunghezzaCentrale), 40);
    record.writeBigUInt64LE(BigInt(inizioCentrale), 48);
    const localizzatore = Buffer.alloc(20);
    localizzatore.writeUInt32LE(FIRMA_LOCALIZZATORE_64, 0);
    localizzatore.writeUInt32LE(0, 4);
    localizzatore.writeBigUInt64LE(BigInt(inizioCentrale + lunghezzaCentrale), 8);
    localizzatore.writeUInt32LE(1, 16);
    parti.push(record, localizzatore);
  }
  const ultima = Buffer.alloc(22);
  ultima.writeUInt32LE(FIRMA_FINE, 0);
  ultima.writeUInt16LE(Math.min(quante, MASSIMO_16), 8);
  ultima.writeUInt16LE(Math.min(quante, MASSIMO_16), 10);
  ultima.writeUInt32LE(Math.min(lunghezzaCentrale, MASSIMO_32), 12);
  ultima.writeUInt32LE(Math.min(inizioCentrale, MASSIMO_32), 16);
  parti.push(ultima);
  return Buffer.concat(parti);
}

/** Il contenuto di un file, compresso o così com'è, con il suo CRC e le sue dimensioni. */
async function* datiDelFile(voce: Voce, comprimi: boolean, conta: { crc: number; intera: number; compressa: number }): AsyncGenerator<Buffer> {
  const lettura = createReadStream(voce.assoluto);
  if (!comprimi) {
    for await (const pezzo of lettura as AsyncIterable<Buffer>) {
      conta.crc = crc32(pezzo, conta.crc);
      conta.intera += pezzo.length;
      conta.compressa += pezzo.length;
      yield pezzo;
    }
    return;
  }
  const compressore = createDeflateRaw({ level: 6 });
  lettura.on("data", (pezzo: string | Buffer) => {
    conta.crc = crc32(pezzo, conta.crc);
    conta.intera += pezzo.length;
  });
  lettura.on("error", (errore) => compressore.destroy(errore));
  lettura.pipe(compressore);
  for await (const pezzo of compressore as AsyncIterable<Buffer>) {
    conta.compressa += pezzo.length;
    yield pezzo;
  }
}

/**
 * L'archivio di una cartella, a pezzi. I nomi cominciano da `base`, il nome della cartella. Un file
 * che non si riesce ad aprire resta fuori; uno che si interrompe a metà ferma l'archivio.
 */
export async function* zipDellaCartella(radice: string, base: string): AsyncGenerator<Buffer> {
  const voci = await vociDellaCartella(radice, base);
  const scritte: Scritta[] = [];
  let posizione = 0;
  for (const voce of voci) {
    if (!voce.cartella) {
      // Se il file non si apre (permessi, sparito) resta fuori, prima di scriverne qualcosa.
      const apribile = await stat(voce.assoluto).then(() => true, () => false);
      if (!apribile) continue;
    }
    const comprimi = !voce.cartella && voce.dimensione > 0 && !GIA_COMPRESSI.has(extname(voce.nome).toLowerCase());
    const scritta: Scritta = {
      nome: Buffer.from(voce.nome, "utf8"),
      cartella: voce.cartella,
      metodo: comprimi ? 8 : 0,
      crc: 0,
      compressa: 0,
      intera: 0,
      scostamento: posizione,
      dos: dataDos(voce.modificato),
      permessi: voce.permessi,
      // Un file che sta vicino ai 4 GB potrebbe superarli: meglio ZIP64 da subito.
      zip64: voce.dimensione >= MASSIMO_32 - 1024 * 1024,
    };
    const testa = intestazioneLocale(scritta);
    posizione += testa.length;
    yield testa;
    if (!voce.cartella) {
      const conta = { crc: 0, intera: 0, compressa: 0 };
      for await (const pezzo of datiDelFile(voce, comprimi, conta)) {
        posizione += pezzo.length;
        yield pezzo;
      }
      Object.assign(scritta, conta);
      if (!scritta.zip64 && (conta.intera >= MASSIMO_32 || conta.compressa >= MASSIMO_32)) {
        throw new Error(`${voce.nome} è cresciuto oltre i 4 GB mentre si leggeva.`);
      }
    }
    const coda = descrittore(scritta);
    posizione += coda.length;
    yield coda;
    scritte.push(scritta);
  }
  const inizioCentrale = posizione;
  for (const scritta of scritte) {
    const centrale = intestazioneCentrale(scritta);
    posizione += centrale.length;
    yield centrale;
  }
  yield fine(scritte.length, inizioCentrale, posizione - inizioCentrale);
}

