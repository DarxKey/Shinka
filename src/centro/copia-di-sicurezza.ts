/**
 * La copia di sicurezza dei dati del centro (ADR 0042): un solo file, cifrato con una password che
 * il proprietario sceglie quando la fa. Dentro c'è un archivio tar compresso con tutti i dati del
 * centro, meno ciò che è della macchina o che si rifà da solo. La stessa copia serve a ripristinare
 * tutto, al prossimo avvio del centro, e a portare altrove memoria e skill.
 *
 * Il file:
 *
 *   "SHINKA-COPIA-1\n"
 *   lunghezza della testata (4 byte), testata in JSON: quando, versione, come ricavare la chiave
 *   pezzi cifrati con AES-256-GCM: lunghezza (4 byte), cifrato con il suo sigillo
 *
 * Ogni pezzo porta nel sigillo la testata, la sua posizione e se è l'ultimo: una copia tagliata,
 * rimescolata o con la testata cambiata non si apre.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { chmod, lstat, mkdir, open, readdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable, Transform, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import type { EsitoRipristino } from "../protocollo/copia.ts";
import { FILE_TAR_MASSIMO, FINE_TAR, intestazioneTar, leggiTar, riempimentoTar } from "./archivio-tar.ts";

const MAGIA = Buffer.from("SHINKA-COPIA-1\n", "ascii");
const PEZZO = 1024 * 1024;
const SIGILLO = 16;
const TESTATA_MASSIMA = 16 * 1024;
const COSTO_PREDEFINITO = 2 ** 17;

/** La cartella, tra i dati, in cui stanno le copie in lavorazione e i dati di prima di un ripristino. */
export const CARTELLA_DELLE_COPIE = "copia-di-sicurezza";

/**
 * Ciò che è della macchina e non dei dati: non entra in una copia e un ripristino non lo tocca.
 * Il collegamento con il gateway e ciò che centro e guardiano si dicono sulle versioni installate.
 */
export const DELLA_MACCHINA: ReadonlySet<string> = new Set([CARTELLA_DELLE_COPIE, "gateway.json", "installazione.json"]);

/** Ciò che non serve portare: le sessioni aperte, e ciò che il centro rifà da sé. */
const NON_SERVE: ReadonlySet<string> = new Set(["sessioni.json", "estensioni-in-esame"]);

/** Il file che, nella copia aperta, dice al centro di ripartire con quei dati. */
const SEGNO = "RIPRISTINA";

/** Il file non è una copia di sicurezza di Shinka, o è rovinato. */
export class CopiaNonValida extends Error {}

/** La password non apre la copia. */
export class PasswordDellaCopiaSbagliata extends Error {}

interface Derivazione {
  sale: string;
  N: number;
  r: number;
  p: number;
}

export interface TestataDellaCopia {
  formato: 1;
  quando: string;
  versione?: string;
  derivazione: Derivazione;
}

function ricava(password: string, derivazione: Derivazione): Promise<Buffer> {
  return new Promise((risolvi, rifiuta) => {
    scrypt(
      password.normalize("NFKC"),
      Buffer.from(derivazione.sale, "base64"),
      32,
      { N: derivazione.N, r: derivazione.r, p: derivazione.p, maxmem: 256 * derivazione.N * derivazione.r },
      (errore, chiave) => (errore === null ? risolvi(chiave) : rifiuta(errore)),
    );
  });
}

function nonce(indice: number): Buffer {
  const valore = Buffer.alloc(12, 0);
  valore.writeBigUInt64BE(BigInt(indice), 4);
  return valore;
}

function daSigillare(improntaTestata: Buffer, ultimo: boolean): Buffer {
  return Buffer.concat([improntaTestata, Buffer.from([ultimo ? 1 : 0])]);
}

/** Taglia ciò che passa in pezzi, li cifra e li scrive uno dopo l'altro. */
class Cifratore extends Transform {
  readonly #chiave: Buffer;
  readonly #impronta: Buffer;
  #attesi: Buffer[] = [];
  #quanti = 0;
  #indice = 0;

  constructor(chiave: Buffer, improntaTestata: Buffer) {
    super();
    this.#chiave = chiave;
    this.#impronta = improntaTestata;
  }

  override _transform(pezzo: Buffer, _codifica: BufferEncoding, fatto: TransformCallback): void {
    this.#attesi.push(pezzo);
    this.#quanti += pezzo.length;
    while (this.#quanti >= PEZZO) {
      const tutto = Buffer.concat(this.#attesi);
      this.push(this.#cifra(tutto.subarray(0, PEZZO), false));
      const resto = tutto.subarray(PEZZO);
      this.#attesi = resto.length === 0 ? [] : [resto];
      this.#quanti = resto.length;
    }
    fatto();
  }

  override _flush(fatto: TransformCallback): void {
    this.push(this.#cifra(Buffer.concat(this.#attesi), true));
    fatto();
  }

  #cifra(chiaro: Buffer, ultimo: boolean): Buffer {
    const cifra = createCipheriv("aes-256-gcm", this.#chiave, nonce(this.#indice));
    this.#indice += 1;
    cifra.setAAD(daSigillare(this.#impronta, ultimo));
    const cifrato = Buffer.concat([cifra.update(chiaro), cifra.final(), cifra.getAuthTag()]);
    const lunghezza = Buffer.alloc(4);
    lunghezza.writeUInt32BE(cifrato.length);
    return Buffer.concat([lunghezza, cifrato]);
  }
}

/** Rimette insieme i pezzi cifrati e li apre: se uno non torna, o manca l'ultimo, si ferma. */
class Decifratore extends Transform {
  readonly #chiave: Buffer;
  readonly #impronta: Buffer;
  #attesi: Buffer = Buffer.alloc(0);
  #indice = 0;
  #finita = false;

  constructor(chiave: Buffer, improntaTestata: Buffer) {
    super();
    this.#chiave = chiave;
    this.#impronta = improntaTestata;
  }

  override _transform(pezzo: Buffer, _codifica: BufferEncoding, fatto: TransformCallback): void {
    this.#attesi = this.#attesi.length === 0 ? pezzo : Buffer.concat([this.#attesi, pezzo]);
    try {
      for (;;) {
        if (this.#attesi.length < 4) break;
        const lunghezza = this.#attesi.readUInt32BE(0);
        if (lunghezza < SIGILLO || lunghezza > PEZZO + SIGILLO) throw new CopiaNonValida("La copia è rovinata.");
        if (this.#attesi.length < 4 + lunghezza) break;
        if (this.#finita) throw new CopiaNonValida("La copia è rovinata: continua dopo la sua fine.");
        const cifrato = this.#attesi.subarray(4, 4 + lunghezza);
        this.#attesi = this.#attesi.subarray(4 + lunghezza);
        this.push(this.#apri(cifrato));
      }
      fatto();
    } catch (errore) {
      fatto(errore instanceof Error ? errore : new Error(String(errore)));
    }
  }

  override _flush(fatto: TransformCallback): void {
    fatto(this.#finita && this.#attesi.length === 0 ? null : new CopiaNonValida("La copia è incompleta: il file finisce prima del dovuto."));
  }

  #apri(cifrato: Buffer): Buffer {
    const corpo = cifrato.subarray(0, cifrato.length - SIGILLO);
    const sigillo = cifrato.subarray(cifrato.length - SIGILLO);
    // Se è l'ultimo pezzo lo dice il sigillo: si prova prima come uno qualunque, poi come l'ultimo.
    for (const ultimo of [false, true]) {
      const apre = createDecipheriv("aes-256-gcm", this.#chiave, nonce(this.#indice));
      apre.setAAD(daSigillare(this.#impronta, ultimo));
      apre.setAuthTag(sigillo);
      try {
        const chiaro = Buffer.concat([apre.update(corpo), apre.final()]);
        this.#indice += 1;
        this.#finita = ultimo;
        return chiaro;
      } catch {
        // Si prova l'altro caso.
      }
    }
    if (this.#indice === 0) throw new PasswordDellaCopiaSbagliata("La password non apre questa copia.");
    throw new CopiaNonValida("La copia è rovinata: un pezzo non torna con il suo sigillo.");
  }
}

/** Vero se questo percorso, relativo ai dati e con le barre in avanti, resta fuori dalla copia. */
export function fuoriDallaCopia(relativo: string): boolean {
  const parti = relativo.split("/");
  const primo = parti[0] ?? "";
  if (DELLA_MACCHINA.has(primo) || NON_SERVE.has(primo)) return true;
  // Le fotografie dei file si rifanno da sole, e sono la parte più pesante delle modifiche.
  if (primo === "modifiche" && parti[2] === "fotografie") return true;
  return (parti.at(-1) ?? "").endsWith(".tmp");
}

interface DaScrivere {
  /** Dentro l'archivio. */
  percorso: string;
  assoluto: string;
  cartella: boolean;
}

/** I file e le cartelle dei dati che entrano nella copia, in ordine. */
async function* voci(dati: string, relativo = ""): AsyncGenerator<DaScrivere | { saltato: string }> {
  let nomi: string[];
  try {
    nomi = (await readdir(join(dati, relativo))).sort();
  } catch {
    if (relativo !== "") yield { saltato: relativo };
    return;
  }
  for (const nome of nomi) {
    const qui = relativo === "" ? nome : `${relativo}/${nome}`;
    if (fuoriDallaCopia(qui)) continue;
    const assoluto = join(dati, qui);
    let cosa;
    try {
      cosa = await lstat(assoluto);
    } catch {
      continue;
    }
    if (cosa.isDirectory()) {
      yield { percorso: `dati/${qui}`, assoluto, cartella: true };
      yield* voci(dati, qui);
    } else if (cosa.isFile()) {
      yield { percorso: `dati/${qui}`, assoluto, cartella: false };
    } else {
      // Un collegamento simbolico, o altro che non è un file: nella copia non entra.
      yield { saltato: qui };
    }
  }
}

/** Sopra questa misura un file non si legge tutto in memoria. */
const FILE_IN_MEMORIA = 32 * 1024 * 1024;

/** L'archivio tar dei dati, un pezzo alla volta. Tiene il conto di ciò che scrive. */
async function* archivio(dati: string, testata: TestataDellaCopia, conto: { file: number; saltati: string[] }): AsyncGenerator<Buffer> {
  const momento = new Date(testata.quando);
  const manifesto = Buffer.from(`${JSON.stringify({ formato: testata.formato, quando: testata.quando, ...(testata.versione === undefined ? {} : { versione: testata.versione }) })}\n`);
  yield intestazioneTar("manifesto.json", manifesto.length, momento);
  yield manifesto;
  yield riempimentoTar(manifesto.length);
  for await (const voce of voci(dati)) {
    if ("saltato" in voce) {
      conto.saltati.push(voce.saltato);
      continue;
    }
    if (voce.cartella) {
      yield intestazioneTar(voce.percorso, 0, momento, { cartella: true });
      continue;
    }
    let modo: number;
    let lungo: number;
    try {
      const cosa = await stat(voce.assoluto);
      modo = cosa.mode & 0o777;
      lungo = cosa.size;
    } catch {
      continue;
    }
    if (lungo > FILE_TAR_MASSIMO) {
      conto.saltati.push(voce.percorso.slice("dati/".length));
      continue;
    }
    if (lungo <= FILE_IN_MEMORIA) {
      // Un file che cresce mentre lo si copia, come l'archivio di una conversazione: vale com'è in questo istante.
      let contenuto: Buffer;
      try {
        contenuto = await readFile(voce.assoluto);
      } catch (errore) {
        if (!(errore instanceof Error && "code" in errore && errore.code === "ENOENT")) conto.saltati.push(voce.percorso.slice("dati/".length));
        continue;
      }
      yield intestazioneTar(voce.percorso, contenuto.length, momento, { modo });
      yield contenuto;
      yield riempimentoTar(contenuto.length);
      conto.file += 1;
      continue;
    }
    // Un file grande passa a pezzi, lungo quanto era quando lo si è guardato.
    let aperto;
    try {
      aperto = await open(voce.assoluto, "r");
    } catch {
      conto.saltati.push(voce.percorso.slice("dati/".length));
      continue;
    }
    try {
      yield intestazioneTar(voce.percorso, lungo, momento, { modo });
      let scritti = 0;
      while (scritti < lungo) {
        const pezzo = Buffer.alloc(Math.min(PEZZO, lungo - scritti));
        const { bytesRead } = await aperto.read(pezzo, 0, pezzo.length, scritti);
        // Se nel frattempo si è accorciato, il resto sono zeri: l'archivio deve tornare.
        yield bytesRead === pezzo.length ? pezzo : Buffer.concat([pezzo.subarray(0, bytesRead), Buffer.alloc(pezzo.length - bytesRead, 0)]);
        scritti += pezzo.length;
      }
      yield riempimentoTar(lungo);
      conto.file += 1;
    } finally {
      await aperto.close();
    }
  }
  yield FINE_TAR;
}

/** Scrive in un file la copia cifrata dei dati. Restituisce quanto pesa e che cosa è rimasto fuori. */
export async function scriviCopia(opzioni: {
  dati: string;
  destinazione: string;
  password: string;
  versione?: string;
  adesso?: Date;
  /** Quanto costa ricavare la chiave dalla password: solo le prove lo abbassano. */
  costo?: number;
}): Promise<{ byte: number; file: number; saltati: string[] }> {
  const derivazione: Derivazione = { sale: randomBytes(16).toString("base64"), N: opzioni.costo ?? COSTO_PREDEFINITO, r: 8, p: 1 };
  const testata: TestataDellaCopia = {
    formato: 1,
    quando: (opzioni.adesso ?? new Date()).toISOString(),
    ...(opzioni.versione === undefined ? {} : { versione: opzioni.versione }),
    derivazione,
  };
  const scritta = Buffer.from(JSON.stringify(testata), "utf8");
  const lunghezza = Buffer.alloc(4);
  lunghezza.writeUInt32BE(scritta.length);
  const inizio = Buffer.concat([MAGIA, lunghezza, scritta]);
  const chiave = await ricava(opzioni.password, derivazione);
  const conto = { file: 0, saltati: [] as string[] };
  await mkdir(dirname(opzioni.destinazione), { recursive: true });
  const uscita = createWriteStream(opzioni.destinazione, { mode: 0o600 });
  try {
    await new Promise<void>((fatto, rifiuta) => uscita.write(inizio, (errore) => (errore == null ? fatto() : rifiuta(errore))));
    await pipeline(Readable.from(archivio(opzioni.dati, testata, conto), { objectMode: false }), createGzip(), new Cifratore(chiave, impronta(inizio)), uscita);
  } catch (errore) {
    uscita.destroy();
    await rm(opzioni.destinazione, { force: true });
    throw errore;
  } finally {
    chiave.fill(0);
  }
  return { byte: (await stat(opzioni.destinazione)).size, ...conto };
}

function impronta(inizio: Buffer): Buffer {
  return createHash("sha256").update(inizio).digest();
}

/** Legge l'inizio di una copia: la testata, e dove comincia il cifrato. Lancia `CopiaNonValida`. */
export async function leggiTestata(file: string): Promise<{ testata: TestataDellaCopia; inizio: Buffer }> {
  let aperto;
  try {
    aperto = await open(file, "r");
  } catch {
    throw new CopiaNonValida("La copia non si legge.");
  }
  try {
    const capo = Buffer.alloc(MAGIA.length + 4);
    const letti = (await aperto.read(capo, 0, capo.length, 0)).bytesRead;
    if (letti < capo.length || !capo.subarray(0, MAGIA.length).equals(MAGIA)) throw new CopiaNonValida("Questo file non è una copia di sicurezza di Shinka.");
    const lunga = capo.readUInt32BE(MAGIA.length);
    if (lunga < 2 || lunga > TESTATA_MASSIMA) throw new CopiaNonValida("La copia è rovinata.");
    const scritta = Buffer.alloc(lunga);
    if ((await aperto.read(scritta, 0, lunga, capo.length)).bytesRead < lunga) throw new CopiaNonValida("La copia è incompleta.");
    let letta: unknown;
    try {
      letta = JSON.parse(scritta.toString("utf8"));
    } catch {
      throw new CopiaNonValida("La copia è rovinata.");
    }
    const testata = leggiLaTestata(letta);
    if (testata === undefined) throw new CopiaNonValida("La copia è di un formato che questa versione di Shinka non conosce.");
    return { testata, inizio: Buffer.concat([capo, scritta]) };
  } finally {
    await aperto.close();
  }
}

function leggiLaTestata(valore: unknown): TestataDellaCopia | undefined {
  if (typeof valore !== "object" || valore === null) return undefined;
  const { formato, quando, versione, derivazione } = valore as Record<string, unknown>;
  if (formato !== 1 || typeof quando !== "string" || Number.isNaN(Date.parse(quando))) return undefined;
  if (typeof derivazione !== "object" || derivazione === null) return undefined;
  const { sale, N, r, p } = derivazione as Record<string, unknown>;
  // Chi scrive la testata non deve poter chiedere al centro un lavoro o una memoria senza misura.
  if (typeof sale !== "string" || sale.length > 100 || typeof N !== "number" || typeof r !== "number" || typeof p !== "number") return undefined;
  if (!Number.isInteger(N) || N < 2 ** 10 || N > 2 ** 20 || (N & (N - 1)) !== 0 || r !== 8 || p !== 1) return undefined;
  return { formato, quando, ...(typeof versione === "string" && versione.length <= 100 ? { versione } : {}), derivazione: { sale, N, r, p } };
}

/** Il percorso di una voce dell'archivio, se è uno di quelli che una copia può contenere. */
function percorsoSicuro(percorso: string): string[] | undefined {
  const parti = percorso.replace(/\/+$/, "").split("/");
  if (parti.length === 0 || parti.some((parte) => parte === "" || parte === "." || parte === ".." || /[\\\0:]/.test(parte))) return undefined;
  if (parti.length === 1) return parti[0] === "manifesto.json" || parti[0] === "dati" ? parti : undefined;
  if (parti[0] !== "dati" || DELLA_MACCHINA.has(parti[1] ?? "")) return undefined;
  return parti;
}

/**
 * Apre una copia con la sua password e ne mette il contenuto in una cartella, che deve essere
 * vuota o non esserci. Lancia `PasswordDellaCopiaSbagliata` o `CopiaNonValida`: allora la cartella
 * non resta.
 */
export async function apriCopia(opzioni: { file: string; password: string; destinazione: string; byteMassimi?: number }): Promise<{ file: number; byte: number }> {
  const { testata, inizio } = await leggiTestata(opzioni.file);
  const chiave = await ricava(opzioni.password, testata.derivazione);
  const massimi = opzioni.byteMassimi ?? 64 * 1024 * 1024 * 1024;
  let file = 0;
  let byte = 0;
  let scrittura: ReturnType<typeof createWriteStream> | undefined;
  let modo = 0o644;
  let assoluto: string | undefined;
  await rm(opzioni.destinazione, { recursive: true, force: true });
  await mkdir(opzioni.destinazione, { recursive: true });
  try {
    await pipeline(
      createReadStream(opzioni.file, { start: inizio.length }),
      new Decifratore(chiave, impronta(inizio)),
      createGunzip(),
      async (sorgente: AsyncIterable<Buffer>) => {
        await leggiTar(sorgente, {
          voce: async (voce) => {
            assoluto = undefined;
            if (voce.tipo === "altro") return;
            const parti = percorsoSicuro(voce.percorso);
            if (parti === undefined) throw new CopiaNonValida(`La copia contiene un percorso che non le appartiene: ${voce.percorso.slice(0, 200)}`);
            const qui = join(opzioni.destinazione, ...parti);
            if (voce.tipo === "cartella") {
              await mkdir(qui, { recursive: true });
              return;
            }
            await mkdir(dirname(qui), { recursive: true });
            assoluto = qui;
            modo = voce.modo & 0o777;
            scrittura = createWriteStream(qui, { mode: 0o600 });
            file += 1;
          },
          dati: async (pezzo) => {
            byte += pezzo.length;
            if (byte > massimi) throw new CopiaNonValida("La copia, aperta, occupa più di quanto Shinka accetta.");
            const dove = scrittura;
            if (dove === undefined) return;
            if (!dove.write(pezzo)) await new Promise<void>((fatto) => dove.once("drain", fatto));
          },
          fine: async () => {
            const dove = scrittura;
            const quale = assoluto;
            scrittura = undefined;
            if (dove === undefined || quale === undefined) return;
            await new Promise<void>((fatto, rifiuta) => {
              dove.once("error", rifiuta);
              dove.end(fatto);
            });
            // I permessi di com'era: una chiave privata resta leggibile solo da chi fa girare Shinka.
            if (process.platform !== "win32") await chmod(quale, modo === 0 ? 0o600 : modo);
          },
        });
      },
    );
    if (!existsSync(join(opzioni.destinazione, "manifesto.json"))) throw new CopiaNonValida("La copia non ha il suo manifesto.");
  } catch (errore) {
    scrittura?.destroy();
    await rm(opzioni.destinazione, { recursive: true, force: true });
    // Il compressore si lamenta per primo quando il cifrato non era quello: conta il perché.
    if (errore instanceof CopiaNonValida || errore instanceof PasswordDellaCopiaSbagliata) throw errore;
    throw new CopiaNonValida(`La copia non si apre: ${errore instanceof Error ? errore.message : String(errore)}`);
  } finally {
    chiave.fill(0);
  }
  return { file, byte };
}

/** Segna che al prossimo avvio il centro deve ripartire con i dati di questa copia aperta. */
export function segnaIlRipristino(cartellaAperta: string, copia: { quando: string; versione?: string }, adesso: Date = new Date()): void {
  writeFileSync(join(cartellaAperta, SEGNO), JSON.stringify({ chiesto: adesso.toISOString(), copia }));
}

/**
 * All'avvio del centro, prima che qualcuno apra i dati: se il proprietario ha chiesto un
 * ripristino, i dati di adesso vanno da parte e al loro posto entrano quelli della copia. Ciò che
 * è della macchina resta. Se qualcosa va storto tutto torna com'era. Restituisce com'è andata, e
 * nulla se non c'era niente da fare.
 */
export function applicaRipristino(dati: string, adesso: Date = new Date()): EsitoRipristino | undefined {
  const base = join(dati, CARTELLA_DELLE_COPIE);
  const aperta = join(base, "aperta");
  const segno = join(aperta, SEGNO);
  if (!existsSync(segno)) return undefined;
  let copia: { quando: string; versione?: string } = { quando: adesso.toISOString() };
  try {
    const letto = JSON.parse(readFileSync(segno, "utf8")) as { copia?: { quando?: unknown; versione?: unknown } };
    if (typeof letto.copia?.quando === "string") {
      copia = { quando: letto.copia.quando, ...(typeof letto.copia.versione === "string" ? { versione: letto.copia.versione } : {}) };
    }
  } catch {
    // Il segno c'è: tanto basta.
  }
  const nuovi = join(aperta, "dati");
  const prima = join(base, `prima-${adesso.toISOString().replace(/[:.]/g, "-")}`);
  const tolti: string[] = [];
  const messi: string[] = [];
  let esito: EsitoRipristino;
  try {
    if (!existsSync(nuovi)) throw new Error("nella copia aperta non ci sono dati");
    mkdirSync(prima, { recursive: true });
    for (const nome of readdirSync(dati)) {
      if (DELLA_MACCHINA.has(nome)) continue;
      renameSync(join(dati, nome), join(prima, nome));
      tolti.push(nome);
    }
    for (const nome of readdirSync(nuovi)) {
      if (DELLA_MACCHINA.has(nome)) continue;
      renameSync(join(nuovi, nome), join(dati, nome));
      messi.push(nome);
    }
    esito = { quando: adesso.toISOString(), riuscito: true, copia };
  } catch (errore) {
    // Tutto torna com'era: prima via ciò che è entrato, poi indietro ciò che era uscito.
    for (const nome of messi.reverse()) {
      try {
        rmSync(join(dati, nome), { recursive: true, force: true });
      } catch {
        // Si prova comunque a rimettere il resto.
      }
    }
    for (const nome of tolti.reverse()) {
      try {
        renameSync(join(prima, nome), join(dati, nome));
      } catch {
        // Resta tra i dati di prima, dove il proprietario lo può ritrovare.
      }
    }
    esito = { quando: adesso.toISOString(), riuscito: false, copia, errore: errore instanceof Error ? errore.message : String(errore) };
    try {
      if (readdirSync(prima).length === 0) rmSync(prima, { recursive: true, force: true });
    } catch {
      // Non c'era.
    }
  }
  // La copia aperta e quella caricata hanno fatto il loro lavoro, comunque sia andata.
  rmSync(aperta, { recursive: true, force: true });
  rmSync(join(base, "caricata.shinka"), { force: true });
  if (esito.riuscito) {
    // Dei dati di prima si tiene solo l'ultima volta.
    for (const nome of readdirSync(base)) {
      if (nome.startsWith("prima-") && join(base, nome) !== prima) rmSync(join(base, nome), { recursive: true, force: true });
    }
  }
  try {
    writeFileSync(join(base, "esito.json"), JSON.stringify(esito, null, 2));
  } catch {
    // L'esito lo dice comunque chi ha chiamato.
  }
  return esito;
}
