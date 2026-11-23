/**
 * I file dei progetti visti dal centro, per il pannello File: la strada per sfogliarli, cercarli,
 * leggerli e scaricarli nell'ambiente di ciascun progetto, qui o su un nodo. Solo lettura.
 */

import { randomUUID } from "node:crypto";
import { PassThrough, type Readable } from "node:stream";
import {
  FILE_LETTO_MASSIMO,
  leggiElenco,
  leggiFileLetto,
  leggiTrovati,
  percorsoRelativoValido,
  type ComandoFile,
  type ElencoCartella,
  type FileLetto,
  type FileTrovati,
  type PortaFile,
  type RiferitoFile,
} from "../protocollo/file-progetto.ts";
import { ID_AMBIENTE_DEL_CENTRO, type RegistroAmbienti } from "./ambienti.ts";
import type { RegistroProgetti } from "./progetti.ts";

/** Quanto si aspetta la risposta dell'ambiente: un file grande deve fare la strada. */
const ATTESA_MS = 60_000;
/** Quanto può restare fermo uno scaricamento, senza pezzi nuovi, prima di lasciar perdere. */
const SCARICAMENTO_FERMO_MS = 120_000;

/** Un file o una cartella che arriva dall'ambiente: il nome con cui salvarlo e i suoi byte, a flusso. */
export interface Scaricato {
  nome: string;
  comeArchivio: boolean;
  dimensione?: number;
  flusso: Readable;
}

interface InScaricamento {
  idAmbiente: string;
  flusso: PassThrough;
  /** Finché non arriva l'inizio: come rispondere a chi ha chiesto. */
  allInizio?: (esito: Esito<Scaricato>) => void;
  fermo: NodeJS.Timeout;
  /** Pezzi passati al browser mentre il flusso era pieno: il nodo li saprà quando si svuota. */
  daConfermare: number;
  finito: boolean;
}

export interface OpzioniFile {
  progetti: Pick<RegistroProgetti, "trova">;
  ambienti: RegistroAmbienti;
  /** Chi tiene i file nell'ambiente del centro: riceve dove riferire. */
  locale(riferisci: (messaggio: RiferitoFile) => void): PortaFile;
}

interface InAttesa {
  idAmbiente: string;
  risolvi(esito: unknown): void;
  rifiuta(errore: Error): void;
  scadenza: NodeJS.Timeout;
}

export type Esito<T> = T | { motivo: string };

export class FileDeiProgetti {
  readonly #o: OpzioniFile;
  readonly #locale: PortaFile;
  readonly #richieste = new Map<string, InAttesa>();
  readonly #scaricamenti = new Map<string, InScaricamento>();

  constructor(opzioni: OpzioniFile) {
    this.#o = opzioni;
    this.#locale = opzioni.locale((messaggio) => this.#riferito(ID_AMBIENTE_DEL_CENTRO, messaggio));
    opzioni.ambienti.iscriviRiferiti((idNodo, messaggio) => {
      if (messaggio.tipo.startsWith("file-")) this.#riferito(idNodo, messaggio as RiferitoFile);
    });
    opzioni.ambienti.iscriviScollegamenti((idNodo) => {
      for (const [idRichiesta, scaricamento] of [...this.#scaricamenti]) {
        if (scaricamento.idAmbiente === idNodo) this.#chiudiScaricamento(idRichiesta, "L'ambiente del progetto si è scollegato.");
      }
      for (const [idRichiesta, inAttesa] of [...this.#richieste]) {
        if (inAttesa.idAmbiente !== idNodo) continue;
        this.#richieste.delete(idRichiesta);
        clearTimeout(inAttesa.scadenza);
        inAttesa.rifiuta(new Error("L'ambiente del progetto si è scollegato."));
      }
    });
  }

  async elenca(idProgetto: string, percorso: string): Promise<Esito<ElencoCartella>> {
    if (!percorsoRelativoValido(percorso)) return { motivo: "Il percorso non è valido." };
    return this.#chiedi(idProgetto, (idRichiesta, cartella) => ({ tipo: "file-elenca", idRichiesta, cartella, percorso }), leggiElenco);
  }

  async cerca(idProgetto: string, testo: string): Promise<Esito<FileTrovati>> {
    const cercato = testo.trim().slice(0, 200);
    if (cercato === "") return { percorsi: [], incompleta: false };
    return this.#chiedi(idProgetto, (idRichiesta, cartella) => ({ tipo: "file-cerca", idRichiesta, cartella, testo: cercato }), leggiTrovati);
  }

  async leggi(idProgetto: string, percorso: string): Promise<Esito<FileLetto>> {
    if (!percorsoRelativoValido(percorso) || percorso === "") return { motivo: "Il percorso non è valido." };
    const letto = await this.#chiedi(idProgetto, (idRichiesta, cartella) => ({ tipo: "file-leggi", idRichiesta, cartella, percorso }), leggiFileLetto);
    if ("dati" in letto && letto.dimensione > FILE_LETTO_MASSIMO) return { motivo: "Il file è troppo grande per l'anteprima." };
    return letto;
  }

  /**
   * Un file così com'è, o una cartella come ZIP (con il percorso vuoto, quella del progetto), a
   * flusso: i pezzi arrivano mentre il browser scarica. Il nodo ne manda pochi alla volta, e il
   * centro gli dice di andare avanti solo quando il browser li ha presi.
   */
  async scarica(idProgetto: string, percorso: string): Promise<Esito<Scaricato>> {
    if (!percorsoRelativoValido(percorso)) return { motivo: "Il percorso non è valido." };
    const progetto = this.#o.progetti.trova(idProgetto);
    if (progetto === undefined) return { motivo: "Progetto non trovato." };
    if (!this.#o.ambienti.attivo(progetto.idAmbiente)) return { motivo: "L'ambiente del progetto è spento." };
    const idRichiesta = randomUUID();
    const idAmbiente = progetto.idAmbiente;
    return new Promise((risolvi) => {
      const flusso = new PassThrough({ highWaterMark: 2 * 1024 * 1024 });
      const scaricamento: InScaricamento = {
        idAmbiente,
        flusso,
        allInizio: risolvi,
        fermo: setTimeout(() => this.#chiudiScaricamento(idRichiesta, "L'ambiente non ha risposto: se il suo nodo è di una versione precedente non sa ancora far scaricare i file, e va aggiornato."), ATTESA_MS),
        daConfermare: 0,
        finito: false,
      };
      this.#scaricamenti.set(idRichiesta, scaricamento);
      flusso.on("drain", () => {
        if (scaricamento.daConfermare === 0) return;
        this.#invia(idAmbiente, { tipo: "file-scarica-avanti", idRichiesta, quanti: scaricamento.daConfermare });
        scaricamento.daConfermare = 0;
      });
      // Il browser se n'è andato prima della fine: l'ambiente smette di leggere.
      flusso.on("close", () => {
        if (!this.#scaricamenti.has(idRichiesta)) return;
        clearTimeout(scaricamento.fermo);
        this.#scaricamenti.delete(idRichiesta);
        if (!scaricamento.finito) this.#invia(idAmbiente, { tipo: "file-scarica-annulla", idRichiesta });
      });
      if (!this.#invia(idAmbiente, { tipo: "file-scarica", idRichiesta, cartella: progetto.cartella, percorso })) {
        this.#chiudiScaricamento(idRichiesta, "L'ambiente del progetto è spento.");
      }
    });
  }

  /** Quanti scaricamenti sono in corso: per le prove. */
  get scaricamentiInCorso(): number {
    return this.#scaricamenti.size;
  }

  /** Manda un comando a chi tiene i file dell'ambiente. Falso se non c'è. */
  #invia(idAmbiente: string, comando: ComandoFile): boolean {
    if (idAmbiente === ID_AMBIENTE_DEL_CENTRO) {
      this.#locale.esegui(comando);
      return true;
    }
    return this.#o.ambienti.inviaAlNodo(idAmbiente, comando);
  }

  #riferitoScaricamento(idAmbiente: string, messaggio: Exclude<RiferitoFile, { tipo: "file-esito" }>): void {
    const { idRichiesta } = messaggio;
    const scaricamento = this.#scaricamenti.get(idRichiesta);
    if (scaricamento === undefined || scaricamento.idAmbiente !== idAmbiente) return;
    clearTimeout(scaricamento.fermo);
    scaricamento.fermo = setTimeout(() => this.#chiudiScaricamento(idRichiesta, "Lo scaricamento si è fermato."), SCARICAMENTO_FERMO_MS);
    switch (messaggio.tipo) {
      case "file-scarica-inizio": {
        const allInizio = scaricamento.allInizio;
        scaricamento.allInizio = undefined;
        allInizio?.({
          nome: messaggio.nome,
          comeArchivio: messaggio.comeArchivio,
          ...(messaggio.dimensione === undefined ? {} : { dimensione: messaggio.dimensione }),
          flusso: scaricamento.flusso,
        });
        return;
      }
      case "file-scarica-pezzo":
        if (scaricamento.flusso.write(Buffer.from(messaggio.dati, "base64"))) {
          this.#invia(idAmbiente, { tipo: "file-scarica-avanti", idRichiesta, quanti: 1 });
        } else {
          scaricamento.daConfermare += 1;
        }
        return;
      case "file-scarica-fine":
        scaricamento.finito = true;
        clearTimeout(scaricamento.fermo);
        this.#scaricamenti.delete(idRichiesta);
        scaricamento.flusso.end();
        return;
      case "file-scarica-errore":
        this.#chiudiScaricamento(idRichiesta, messaggio.motivo);
        return;
    }
  }

  /** Chiude uno scaricamento che non può finire: chi aspettava l'inizio riceve il motivo, il browser un flusso interrotto. */
  #chiudiScaricamento(idRichiesta: string, motivo: string): void {
    const scaricamento = this.#scaricamenti.get(idRichiesta);
    if (scaricamento === undefined) return;
    this.#scaricamenti.delete(idRichiesta);
    clearTimeout(scaricamento.fermo);
    if (!scaricamento.finito) this.#invia(scaricamento.idAmbiente, { tipo: "file-scarica-annulla", idRichiesta });
    if (scaricamento.allInizio !== undefined) {
      scaricamento.allInizio({ motivo: motivo.slice(0, 2000) });
      scaricamento.flusso.destroy();
    } else {
      scaricamento.flusso.destroy(new Error(motivo));
    }
  }

  async #chiedi<T>(
    idProgetto: string,
    comando: (idRichiesta: string, cartella: string) => ComandoFile,
    leggi: (valore: unknown) => T | undefined,
  ): Promise<Esito<T>> {
    const progetto = this.#o.progetti.trova(idProgetto);
    if (progetto === undefined) return { motivo: "Progetto non trovato." };
    if (!this.#o.ambienti.attivo(progetto.idAmbiente)) return { motivo: "L'ambiente del progetto è spento." };
    let esito: unknown;
    try {
      esito = await this.#manda(progetto.idAmbiente, (idRichiesta) => comando(idRichiesta, progetto.cartella));
    } catch (errore) {
      return { motivo: errore instanceof Error ? errore.message : String(errore) };
    }
    if (typeof esito === "object" && esito !== null && typeof (esito as { motivo?: unknown }).motivo === "string") {
      return { motivo: String((esito as { motivo: string }).motivo).slice(0, 2000) };
    }
    return leggi(esito) ?? { motivo: "L'ambiente ha risposto in un modo che non capisco." };
  }

  #manda(idAmbiente: string, comando: (idRichiesta: string) => ComandoFile): Promise<unknown> {
    return new Promise((risolvi, rifiuta) => {
      const idRichiesta = randomUUID();
      const scadenza = setTimeout(() => {
        this.#richieste.delete(idRichiesta);
        rifiuta(new Error("L'ambiente non ha risposto: se il suo nodo è di una versione precedente non sa ancora mostrare i file, e va aggiornato."));
      }, ATTESA_MS);
      this.#richieste.set(idRichiesta, { idAmbiente, risolvi, rifiuta, scadenza });
      const daMandare = comando(idRichiesta);
      if (idAmbiente === ID_AMBIENTE_DEL_CENTRO) {
        this.#locale.esegui(daMandare);
        return;
      }
      if (!this.#o.ambienti.inviaAlNodo(idAmbiente, daMandare)) {
        clearTimeout(scadenza);
        this.#richieste.delete(idRichiesta);
        rifiuta(new Error("L'ambiente del progetto è spento."));
      }
    });
  }

  #riferito(idAmbiente: string, messaggio: RiferitoFile): void {
    if (messaggio.tipo !== "file-esito") {
      this.#riferitoScaricamento(idAmbiente, messaggio);
      return;
    }
    const inAttesa = this.#richieste.get(messaggio.idRichiesta);
    if (inAttesa === undefined || inAttesa.idAmbiente !== idAmbiente) return;
    this.#richieste.delete(messaggio.idRichiesta);
    clearTimeout(inAttesa.scadenza);
    inAttesa.risolvi(messaggio.esito);
  }
}
