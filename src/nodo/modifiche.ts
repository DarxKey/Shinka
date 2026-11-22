/**
 * Il registro delle modifiche di una conversazione: prima che Claude cambi un file con un suo
 * strumento, ne tiene la versione di allora; a fine turno guarda com'è adesso, e tiene i file
 * cambiati davvero. Ciò che cambiano i comandi lo dicono le fotografie dei file, scattate prima
 * che il turno possa toccare qualcosa e quando finisce. Da qui il proprietario rivede le modifiche
 * di un turno e riporta i file a com'erano. Le versioni restano in una cartella, se c'è: così
 * valgono anche dopo un riavvio.
 */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { conta } from "../protocollo/differenze.ts";
import { FILE_MASSIMO, TURNI_TENUTI, type EsitoAnnullamento, type FileDeiComandi, type FileModificato, type VersioniDiUnFile } from "../protocollo/modifiche.ts";
import { Fotografo, type CambiatiTraLeFoto, type Fotografia } from "./fotografie.ts";

/** Quanto si aspetta la fotografia prima di lasciar partire ciò che può cambiare i file. */
const ATTESA_DELLA_FOTOGRAFIA_MS = 45_000;

interface VoceDelTurno {
  /** Assoluto. */
  assoluto: string;
  percorso: string;
  prima: string | null;
  dopo: string | null;
  /** Non lo ha cambiato uno strumento di modifica. */
  daComando?: true;
}

/** Il turno in corso: i file toccati dagli strumenti, con la versione di prima, e la sua fotografia. */
interface TurnoInCorso {
  idTurno: string;
  prima: Map<string, string | null>;
  /** I file che uno strumento ha toccato senza che se ne sappia la versione di prima. */
  toccati: Set<string>;
  foto?: Promise<Fotografia | undefined>;
}

/** I file cambiati in un turno, come li riceve chi lo ha chiuso. */
export interface ModificheDelTurno {
  idTurno: string;
  file: FileModificato[];
  /** Quanti altri file sono cambiati senza che se ne tenga la versione: erano troppi. */
  altri?: number;
}

export interface OpzioniDelRegistro {
  /** Chi fotografa i file; se manca, e c'è una cartella per le versioni, il registro ne fa uno suo. */
  fotografo?: Fotografo;
  /** Niente fotografie: restano solo le modifiche fatte con gli strumenti. */
  senzaFotografie?: true;
  /** Chiamato quando si sa se i file cambiati dai comandi si vedono, e quando cambia. */
  alStato?: (stato: FileDeiComandi) => void;
}

interface TurnoSalvato {
  idTurno: string;
  quando: string;
  file: VoceDelTurno[];
}

export class RegistroModifiche {
  readonly #cartellaProgetto: string;
  readonly #cartella: string | undefined;
  readonly #fotografo: Fotografo | undefined;
  #inCorso: TurnoInCorso | undefined;
  /** I turni conclusi tenuti in memoria quando non c'è una cartella. */
  readonly #inMemoria = new Map<string, TurnoSalvato>();

  constructor(cartellaProgetto: string, cartella?: string, opzioni: OpzioniDelRegistro = {}) {
    this.#cartellaProgetto = resolve(cartellaProgetto);
    this.#cartella = cartella;
    this.#fotografo =
      opzioni.senzaFotografie === true
        ? undefined
        : (opzioni.fotografo ??
          (cartella === undefined
            ? undefined
            : new Fotografo(this.#cartellaProgetto, join(cartella, "fotografie"), opzioni.alStato === undefined ? {} : { alStato: opzioni.alStato })));
  }

  /** Vero se un turno è aperto. */
  get inCorso(): boolean {
    return this.#inCorso !== undefined;
  }

  /** Comincia un turno: da qui i file toccati appartengono a lui. L'identificativo lo può dare il motore. */
  apriTurno(idTurno: string = randomUUID()): string {
    this.#inCorso = { idTurno, prima: new Map(), toccati: new Set() };
    return idTurno;
  }

  /**
   * Qualcosa sta per poter cambiare i file: la prima volta nel turno si scatta la fotografia, e
   * chi chiama aspetta che ci sia. Non fallisce, e non aspetta oltre un certo tempo.
   */
  pronto(): Promise<void> {
    const turno = this.#inCorso;
    if (turno === undefined || this.#fotografo === undefined) return Promise.resolve();
    turno.foto ??= this.#fotografo.scatta();
    const foto = turno.foto;
    return new Promise((fatto) => {
      const scadenza = setTimeout(fatto, ATTESA_DELLA_FOTOGRAFIA_MS);
      scadenza.unref();
      void foto
        .catch(() => undefined)
        .then(() => {
          clearTimeout(scadenza);
          fatto();
        });
    });
  }

  /** Claude sta per cambiare questo file: se è la prima volta nel turno, se ne tiene la versione di adesso. */
  prima(percorso: string): void {
    const turno = this.#inCorso;
    if (turno === undefined || percorso === "") return;
    const assoluto = resolve(this.#cartellaProgetto, percorso);
    if (turno.prima.has(assoluto)) return;
    const letto = leggiTesto(assoluto);
    // Un file troppo grande, o che non è testo, non si tiene: non comparirà tra le modifiche.
    if (letto === "illeggibile") return;
    turno.prima.set(assoluto, letto);
  }

  /**
   * La versione di prima di un file, data da chi chiama: con Codex, che cambia i file senza
   * aspettare Shinka, la si ricostruisce dal diff del turno. Vale la prima volta nel turno.
   */
  primaCon(percorso: string, contenuto: string | null): void {
    const turno = this.#inCorso;
    if (turno === undefined || percorso === "") return;
    const assoluto = resolve(this.#cartellaProgetto, percorso);
    if (turno.prima.has(assoluto)) return;
    if (contenuto !== null && (Buffer.byteLength(contenuto) > FILE_MASSIMO || contenuto.includes("\0"))) return;
    turno.prima.set(assoluto, contenuto);
  }

  /**
   * Uno strumento di modifica ha toccato questo file, ma com'era prima non si sa: se lo dice la
   * fotografia dei file il file entra nel turno, e non come cambiato da un comando.
   */
  toccato(percorso: string): void {
    if (percorso !== "") this.#inCorso?.toccati.add(chiave(resolve(this.#cartellaProgetto, percorso)));
  }

  /**
   * Finisce il turno: restituisce i file cambiati davvero, e ne tiene le due versioni. Il motore
   * può dare qui l'identificativo del turno, se lo ha saputo dopo averlo aperto.
   */
  chiudiTurno(idTurno?: string): Promise<ModificheDelTurno | undefined> {
    const turno = this.#inCorso;
    this.#inCorso = undefined;
    if (turno === undefined) return Promise.resolve(undefined);
    // La seconda fotografia va chiesta subito: quella del turno dopo deve venire dopo di lei.
    const cambiati = turno.foto === undefined ? undefined : this.#fotografo?.cambiatiDa(turno.foto);
    if (cambiati === undefined && turno.prima.size === 0) return Promise.resolve(undefined);
    return this.#chiudi(idTurno ?? turno.idTurno, turno, cambiati);
  }

  async #chiudi(idTurno: string, turno: TurnoInCorso, cambiati: Promise<CambiatiTraLeFoto | undefined> | undefined): Promise<ModificheDelTurno | undefined> {
    const daFoto = await cambiati?.catch(() => undefined);
    const candidati = new Map<string, { assoluto: string; prima: string | null; daComando: boolean }>();
    for (const [assoluto, prima] of turno.prima) candidati.set(chiave(assoluto), { assoluto, prima, daComando: false });
    for (const file of daFoto?.file ?? []) {
      const assoluto = resolve(this.#cartellaProgetto, file.percorso);
      const toccato = candidati.get(chiave(assoluto));
      // La fotografia è di prima che il turno toccasse qualcosa: la sua versione vale più di quella
      // tenuta davanti a uno strumento, che un comando potrebbe aver già cambiato.
      candidati.set(chiave(assoluto), { assoluto: toccato?.assoluto ?? assoluto, prima: file.prima, daComando: toccato === undefined && !turno.toccati.has(chiave(assoluto)) });
    }
    const voci: VoceDelTurno[] = [];
    for (const { assoluto, prima, daComando } of candidati.values()) {
      const dopo = leggiTesto(assoluto);
      if (dopo === "illeggibile" || dopo === prima) continue;
      voci.push({ assoluto, percorso: this.#mostrato(assoluto), prima, dopo, ...(daComando ? { daComando: true as const } : {}) });
    }
    const altri = daFoto?.altri ?? 0;
    if (voci.length === 0 && altri === 0) return undefined;
    if (voci.length > 0) await this.#salva({ idTurno, quando: new Date().toISOString(), file: voci });
    return { idTurno, file: voci.map(riassunto), ...(altri > 0 ? { altri } : {}) };
  }

  /** Le due versioni di un file di un turno, oppure perché non ci sono. */
  async versioni(idTurno: string, percorso: string): Promise<VersioniDiUnFile | { motivo: string }> {
    const turno = await this.#leggi(idTurno);
    if (turno === undefined) return { motivo: "Le modifiche di questo turno non ci sono più: se ne tengono solo le più recenti." };
    const voce = turno.file.find((file) => file.percorso === percorso);
    return voce === undefined ? { motivo: "Questo file non è tra le modifiche del turno." } : { prima: voce.prima, dopo: voce.dopo };
  }

  /**
   * Riporta i file a com'erano prima del turno; senza elenco, tutti quelli del turno. Un file
   * cambiato ancora dopo il turno non si tocca: si perderebbe ciò che è venuto dopo.
   */
  async annulla(idTurno: string, percorsi?: readonly string[]): Promise<EsitoAnnullamento | { motivo: string }> {
    const turno = await this.#leggi(idTurno);
    if (turno === undefined) return { motivo: "Le modifiche di questo turno non ci sono più: se ne tengono solo le più recenti." };
    const scelti = percorsi === undefined ? turno.file : turno.file.filter((file) => percorsi.includes(file.percorso));
    const esito: EsitoAnnullamento = { annullati: [], nonAnnullati: [] };
    for (const percorso of percorsi ?? []) {
      if (!turno.file.some((file) => file.percorso === percorso)) esito.nonAnnullati.push({ percorso, motivo: "non è tra le modifiche del turno" });
    }
    for (const file of scelti) {
      const adesso = leggiTesto(file.assoluto);
      if (adesso === file.prima) {
        esito.annullati.push(file.percorso);
        continue;
      }
      if (adesso !== file.dopo) {
        esito.nonAnnullati.push({ percorso: file.percorso, motivo: "è cambiato ancora dopo questo turno" });
        continue;
      }
      try {
        if (file.prima === null) await unlink(file.assoluto);
        else {
          await mkdir(dirname(file.assoluto), { recursive: true });
          await writeFile(file.assoluto, file.prima);
        }
        esito.annullati.push(file.percorso);
      } catch (errore) {
        esito.nonAnnullati.push({ percorso: file.percorso, motivo: errore instanceof Error ? errore.message : String(errore) });
      }
    }
    return esito;
  }

  /** I file cambiati da questi turni, con le righe aggiunte e tolte: per l'anteprima di un riavvolgimento. Quelli non tenuti non contano. */
  async insieme(idTurni: readonly string[]): Promise<{ file: string[]; aggiunte: number; tolte: number }> {
    const file = new Set<string>();
    let aggiunte = 0;
    let tolte = 0;
    for (const idTurno of idTurni) {
      const turno = await this.#leggi(idTurno);
      for (const voce of turno?.file ?? []) {
        file.add(voce.percorso);
        const conto = conta(voce.prima ?? "", voce.dopo ?? "");
        aggiunte += conto.aggiunte;
        tolte += conto.tolte;
      }
    }
    return { file: [...file], aggiunte, tolte };
  }

  /**
   * Riporta i file a com'erano prima del primo di questi turni, dati nell'ordine in cui sono
   * avvenuti: li annulla dal più recente, così ogni file torna indietro un turno alla volta.
   */
  async annullaTurni(idTurni: readonly string[]): Promise<EsitoAnnullamento> {
    const annullati = new Set<string>();
    const nonAnnullati = new Map<string, string>();
    for (const idTurno of [...idTurni].reverse()) {
      if ((await this.#leggi(idTurno)) === undefined) continue;
      const esito = await this.annulla(idTurno);
      if ("motivo" in esito) continue;
      for (const percorso of esito.annullati) annullati.add(percorso);
      for (const { percorso, motivo } of esito.nonAnnullati) nonAnnullati.set(percorso, motivo);
    }
    for (const percorso of nonAnnullati.keys()) annullati.delete(percorso);
    return { annullati: [...annullati], nonAnnullati: [...nonAnnullati].map(([percorso, motivo]) => ({ percorso, motivo })) };
  }

  #mostrato(assoluto: string): string {
    const dentro = relative(this.#cartellaProgetto, assoluto);
    return dentro === "" || dentro.startsWith("..") || isAbsolute(dentro) ? assoluto : dentro.split("\\").join("/");
  }

  async #salva(turno: TurnoSalvato): Promise<void> {
    if (this.#cartella === undefined) {
      this.#inMemoria.set(turno.idTurno, turno);
      while (this.#inMemoria.size > TURNI_TENUTI) this.#inMemoria.delete(this.#inMemoria.keys().next().value ?? "");
      return;
    }
    try {
      await mkdir(this.#cartella, { recursive: true });
      await writeFile(join(this.#cartella, `${turno.idTurno}.json`), JSON.stringify(turno));
      await this.#sfoltisci();
    } catch {
      // Se non si riesce a salvare, il turno resta almeno finché il processo è acceso.
      this.#inMemoria.set(turno.idTurno, turno);
    }
  }

  async #leggi(idTurno: string): Promise<TurnoSalvato | undefined> {
    const inMemoria = this.#inMemoria.get(idTurno);
    // L'identificativo diventa il nome di un file: solo lettere, cifre e trattini.
    if (inMemoria !== undefined || this.#cartella === undefined || !/^[0-9A-Za-z-]{1,100}$/.test(idTurno)) return inMemoria;
    try {
      return JSON.parse(await readFile(join(this.#cartella, `${idTurno}.json`), "utf8")) as TurnoSalvato;
    } catch {
      return undefined;
    }
  }

  /** Tiene solo i turni più recenti. */
  async #sfoltisci(): Promise<void> {
    const cartella = this.#cartella;
    if (cartella === undefined) return;
    const nomi = (await readdir(cartella)).filter((nome) => nome.endsWith(".json"));
    if (nomi.length <= TURNI_TENUTI) return;
    const datati = await Promise.all(nomi.map(async (nome) => ({ nome, quando: (await stat(join(cartella, nome))).mtimeMs })));
    datati.sort((a, b) => a.quando - b.quando);
    for (const { nome } of datati.slice(0, datati.length - TURNI_TENUTI)) await rm(join(cartella, nome), { force: true });
  }
}

/** Il testo di un file; null se non c'è; "illeggibile" se è troppo grande o non è testo. */
function leggiTesto(assoluto: string): string | null | "illeggibile" {
  try {
    const contenuto = readFileSync(assoluto);
    if (contenuto.length > FILE_MASSIMO || contenuto.includes(0)) return "illeggibile";
    return contenuto.toString("utf8");
  } catch (errore) {
    return errore instanceof Error && "code" in errore && errore.code === "ENOENT" ? null : "illeggibile";
  }
}

function riassunto(voce: VoceDelTurno): FileModificato {
  const { aggiunte, tolte } = conta(voce.prima ?? "", voce.dopo ?? "");
  return {
    percorso: voce.percorso,
    aggiunte,
    tolte,
    stato: voce.prima === null ? "nuovo" : voce.dopo === null ? "tolto" : "cambiato",
    ...(voce.daComando === true ? { daComando: true as const } : {}),
  };
}

/** Lo stesso file ha una chiave sola: su Windows maiuscole e minuscole non contano. */
function chiave(assoluto: string): string {
  return process.platform === "win32" ? assoluto.toLowerCase() : assoluto;
}
