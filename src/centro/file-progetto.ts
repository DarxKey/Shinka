/**
 * I file dei progetti visti dal centro, per il pannello File: la strada per sfogliarli, cercarli e
 * leggerli nell'ambiente di ciascun progetto, qui o su un nodo. Solo lettura.
 */

import { randomUUID } from "node:crypto";
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

  constructor(opzioni: OpzioniFile) {
    this.#o = opzioni;
    this.#locale = opzioni.locale((messaggio) => this.#riferito(ID_AMBIENTE_DEL_CENTRO, messaggio));
    opzioni.ambienti.iscriviRiferiti((idNodo, messaggio) => {
      if (messaggio.tipo === "file-esito") this.#riferito(idNodo, messaggio);
    });
    opzioni.ambienti.iscriviScollegamenti((idNodo) => {
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
    const inAttesa = this.#richieste.get(messaggio.idRichiesta);
    if (inAttesa === undefined || inAttesa.idAmbiente !== idAmbiente) return;
    this.#richieste.delete(messaggio.idRichiesta);
    clearTimeout(inAttesa.scadenza);
    inAttesa.risolvi(messaggio.esito);
  }
}
