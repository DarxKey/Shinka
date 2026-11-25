/**
 * Chrome per Claude in un ambiente (ADR 0063), acceso o spento dalla pagina Ambienti: il centro lo
 * chiede al nodo, che salva la scelta e, con il suo guardiano, riparte per usarla.
 */

import { randomUUID } from "node:crypto";
import type { RegistroAmbienti } from "./ambienti.ts";

const ATTESA_MS = 20_000;

export type EsitoChrome = { attivo: boolean; riparte: boolean } | { motivo: string };

export class ChromeNegliAmbienti {
  readonly #ambienti: Pick<RegistroAmbienti, "stato" | "inviaAlNodo" | "iscriviRiferiti" | "iscriviScollegamenti">;
  readonly #attesaMs: number;
  readonly #inAttesa = new Map<string, { idAmbiente: string; risolvi: (esito: EsitoChrome) => void; scadenza: NodeJS.Timeout }>();

  constructor(ambienti: Pick<RegistroAmbienti, "stato" | "inviaAlNodo" | "iscriviRiferiti" | "iscriviScollegamenti">, attesaMs: number = ATTESA_MS) {
    this.#ambienti = ambienti;
    this.#attesaMs = attesaMs;
    ambienti.iscriviRiferiti((idNodo, messaggio) => {
      if (messaggio.tipo !== "browser-del-pc-esito") return;
      const attesa = this.#inAttesa.get(messaggio.idRichiesta);
      if (attesa === undefined || attesa.idAmbiente !== idNodo) return;
      this.#inAttesa.delete(messaggio.idRichiesta);
      clearTimeout(attesa.scadenza);
      if (messaggio.attivo !== undefined && messaggio.motivo === undefined) {
        // Il nodo che riparte si ripresenta con lo stato nuovo; quello che non riparte lo usa dal prossimo avvio.
        attesa.risolvi({ attivo: messaggio.attivo, riparte: messaggio.riparte === true });
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

  imposta(idAmbiente: string, attivo: boolean): Promise<EsitoChrome> {
    const ambiente = this.#ambienti.stato().ambienti.find((uno) => uno.id === idAmbiente);
    if (ambiente === undefined) return Promise.resolve({ motivo: "Ambiente non trovato." });
    if (!ambiente.attivo) return Promise.resolve({ motivo: "L'ambiente è spento: si cambia quando il nodo è collegato." });
    if (ambiente.chrome === undefined) return Promise.resolve({ motivo: "Questo nodo non sa dire se c'è Chrome: vale solo su Windows e macOS, con il nodo alla versione nuova." });
    if (attivo && !ambiente.chrome.estensione) return Promise.resolve({ motivo: "Su questa macchina manca l'estensione Claude in Chrome: installala dal Chrome Web Store, poi riprova." });
    return new Promise((risolvi) => {
      const idRichiesta = randomUUID();
      const scadenza = setTimeout(() => {
        this.#inAttesa.delete(idRichiesta);
        risolvi({ motivo: "Il nodo non ha risposto in tempo." });
      }, this.#attesaMs);
      scadenza.unref();
      this.#inAttesa.set(idRichiesta, { idAmbiente, risolvi, scadenza });
      if (!this.#ambienti.inviaAlNodo(idAmbiente, { tipo: "browser-del-pc", idRichiesta, attivo })) {
        clearTimeout(scadenza);
        this.#inAttesa.delete(idRichiesta);
        risolvi({ motivo: "L'ambiente è spento." });
      }
    });
  }
}
