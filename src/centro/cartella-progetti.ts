/**
 * La cartella in cui nascono i progetti nuovi di un ambiente, scelta dalla pagina degli ambienti:
 * il centro la chiede al nodo, che la prepara e la salva tra le sue scelte, e aspetta com'è andata.
 * Quella dell'ambiente del centro si sceglie dove gira il centro (`SHINKA_PROGETTI`).
 */

import { randomUUID } from "node:crypto";
import { ID_AMBIENTE_DEL_CENTRO, type RegistroAmbienti } from "./ambienti.ts";

/** Quanto si aspetta la risposta del nodo. */
const ATTESA_MS = 20_000;

export type EsitoCartellaProgetti = { percorso: string; riparte: boolean } | { motivo: string };

export class CartellaDeiProgetti {
  readonly #ambienti: Pick<RegistroAmbienti, "stato" | "inviaAlNodo" | "iscriviRiferiti" | "iscriviScollegamenti">;
  readonly #attesaMs: number;
  readonly #inAttesa = new Map<string, { idAmbiente: string; risolvi: (esito: EsitoCartellaProgetti) => void; scadenza: NodeJS.Timeout }>();

  constructor(ambienti: Pick<RegistroAmbienti, "stato" | "inviaAlNodo" | "iscriviRiferiti" | "iscriviScollegamenti">, attesaMs: number = ATTESA_MS) {
    this.#ambienti = ambienti;
    this.#attesaMs = attesaMs;
    ambienti.iscriviRiferiti((idNodo, messaggio) => {
      if (messaggio.tipo !== "cartella-progetti-esito") return;
      const attesa = this.#inAttesa.get(messaggio.idRichiesta);
      // Risponde solo l'ambiente a cui la richiesta era stata fatta.
      if (attesa === undefined || attesa.idAmbiente !== idNodo) return;
      this.#inAttesa.delete(messaggio.idRichiesta);
      clearTimeout(attesa.scadenza);
      attesa.risolvi(
        messaggio.percorso !== undefined && messaggio.motivo === undefined
          ? { percorso: messaggio.percorso, riparte: messaggio.riparte === true }
          : { motivo: messaggio.motivo ?? "Il nodo non ha detto com'è andata." },
      );
    });
    ambienti.iscriviScollegamenti((idNodo) => {
      for (const [id, attesa] of this.#inAttesa) {
        if (attesa.idAmbiente !== idNodo) continue;
        this.#inAttesa.delete(id);
        clearTimeout(attesa.scadenza);
        attesa.risolvi({ motivo: "Il nodo si è scollegato prima di rispondere." });
      }
    });
  }

  /** Chiede al nodo di far nascere i progetti nuovi in quella cartella. */
  imposta(idAmbiente: string, percorso: string): Promise<EsitoCartellaProgetti> {
    if (idAmbiente === ID_AMBIENTE_DEL_CENTRO) {
      return Promise.resolve({ motivo: "La cartella dei progetti dell'ambiente del centro si sceglie dove gira il centro, con SHINKA_PROGETTI." });
    }
    const ambiente = this.#ambienti.stato().ambienti.find((uno) => uno.id === idAmbiente);
    if (ambiente === undefined) return Promise.resolve({ motivo: "Ambiente non trovato." });
    if (!ambiente.attivo) return Promise.resolve({ motivo: "L'ambiente è spento: si cambia quando il nodo è collegato." });
    return new Promise((risolvi) => {
      const idRichiesta = randomUUID();
      const scadenza = setTimeout(() => {
        this.#inAttesa.delete(idRichiesta);
        risolvi({ motivo: "Il nodo non ha risposto: se è di una versione precedente, va aggiornato." });
      }, this.#attesaMs);
      scadenza.unref();
      this.#inAttesa.set(idRichiesta, { idAmbiente, risolvi, scadenza });
      if (!this.#ambienti.inviaAlNodo(idAmbiente, { tipo: "cartella-progetti", idRichiesta, percorso })) {
        clearTimeout(scadenza);
        this.#inAttesa.delete(idRichiesta);
        risolvi({ motivo: "L'ambiente è spento." });
      }
    });
  }
}
