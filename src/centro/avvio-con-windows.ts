/**
 * Far partire un nodo Windows a ogni accesso, oppure no, dalla pagina degli ambienti: il centro lo
 * chiede al nodo, che mette o toglie il suo collegamento in Esecuzione automatica, e aspetta com'è
 * andata.
 */

import { randomUUID } from "node:crypto";
import type { RegistroAmbienti } from "./ambienti.ts";

/** Quanto si aspetta la risposta del nodo. */
const ATTESA_MS = 20_000;

export type EsitoAvvioConWindows = { attivo: boolean } | { motivo: string };

export class AvvioConWindows {
  readonly #ambienti: RegistroAmbienti;
  readonly #attesaMs: number;
  readonly #inAttesa = new Map<string, { idAmbiente: string; risolvi: (esito: EsitoAvvioConWindows) => void; scadenza: NodeJS.Timeout }>();

  constructor(ambienti: RegistroAmbienti, attesaMs: number = ATTESA_MS) {
    this.#ambienti = ambienti;
    this.#attesaMs = attesaMs;
    ambienti.iscriviRiferiti((idNodo, messaggio) => {
      if (messaggio.tipo !== "avvio-con-windows-esito") return;
      const attesa = this.#inAttesa.get(messaggio.idRichiesta);
      if (attesa === undefined || attesa.idAmbiente !== idNodo) return;
      this.#inAttesa.delete(messaggio.idRichiesta);
      clearTimeout(attesa.scadenza);
      if (messaggio.attivo !== undefined) {
        ambienti.segnaAvvioConWindows(idNodo, messaggio.attivo);
        attesa.risolvi({ attivo: messaggio.attivo });
      } else {
        attesa.risolvi({ motivo: messaggio.motivo ?? "Il nodo non ha detto com'è andata." });
      }
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

  /** Chiede al nodo di partire, o di non partire più, a ogni accesso a Windows. */
  imposta(idAmbiente: string, attivo: boolean): Promise<EsitoAvvioConWindows> {
    const ambiente = this.#ambienti.stato().ambienti.find((uno) => uno.id === idAmbiente);
    if (ambiente === undefined) return Promise.resolve({ motivo: "Ambiente non trovato." });
    if (!ambiente.attivo) return Promise.resolve({ motivo: "L'ambiente è spento: si cambia quando il nodo è collegato." });
    if (ambiente.avvioConWindows === undefined) {
      return Promise.resolve({ motivo: "Questo nodo non sa cambiarlo da qui: rilancia su quella macchina il comando di una riga (Reinstalla)." });
    }
    return new Promise((risolvi) => {
      const idRichiesta = randomUUID();
      const scadenza = setTimeout(() => {
        this.#inAttesa.delete(idRichiesta);
        risolvi({ motivo: "Il nodo non ha risposto in tempo." });
      }, this.#attesaMs);
      this.#inAttesa.set(idRichiesta, { idAmbiente, risolvi, scadenza });
      if (!this.#ambienti.inviaAlNodo(idAmbiente, { tipo: "avvio-con-windows", idRichiesta, attivo })) {
        clearTimeout(scadenza);
        this.#inAttesa.delete(idRichiesta);
        risolvi({ motivo: "L'ambiente è spento." });
      }
    });
  }
}
