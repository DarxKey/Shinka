/**
 * I modelli tra cui scegliere per un progetto che nasce in un ambiente: per la scheda del progetto
 * nuovo, che li riallinea quando il proprietario cambia ambiente. Nell'ambiente del centro sono quelli
 * dei suoi motori, i suoi modelli locali e quelli in rete degli altri ambienti (ADR 0053), con il nome
 * dell'ambiente che li fornisce; in un altro ambiente li dice il suo nodo.
 *
 * L'ultimo elenco di ogni ambiente si ricorda: se il nodo non risponde (un nodo di prima non sa la
 * domanda) vale quello.
 */

import { randomUUID } from "node:crypto";
import type { ModelloDisponibile } from "../protocollo/impostazioni.ts";
import { ID_AMBIENTE_DEL_CENTRO, type RegistroAmbienti } from "./ambienti.ts";

/** Quanto si aspetta il nodo: la prima volta sonda i suoi motori, e ci vuole qualche secondo. */
const ATTESA_MS = 20_000;

export type EsitoCatalogo = { modelli: ModelloDisponibile[] } | { motivo: string };

export interface OpzioniCatalogo {
  ambienti: Pick<RegistroAmbienti, "attivo" | "inviaAlNodo" | "iscriviRiferiti" | "iscriviScollegamenti">;
  /** I modelli dell'ambiente del centro: dei suoi motori, i suoi locali e quelli in rete. */
  delCentro(): Promise<ModelloDisponibile[]>;
  attesaMs?: number;
}

interface InAttesa {
  idAmbiente: string;
  risolvi(modelli: ModelloDisponibile[] | undefined): void;
  scadenza: NodeJS.Timeout;
}

export class CatalogoDeiModelli {
  readonly #o: OpzioniCatalogo;
  readonly #inAttesa = new Map<string, InAttesa>();
  readonly #ultimi = new Map<string, ModelloDisponibile[]>();

  constructor(opzioni: OpzioniCatalogo) {
    this.#o = opzioni;
    opzioni.ambienti.iscriviRiferiti((idNodo, messaggio) => {
      if (messaggio.tipo !== "modelli-esito") return;
      const attesa = this.#inAttesa.get(messaggio.idRichiesta);
      // Risponde solo l'ambiente a cui la domanda era stata fatta.
      if (attesa === undefined || attesa.idAmbiente !== idNodo) return;
      this.#chiudi(messaggio.idRichiesta, attesa, messaggio.modelli);
    });
    opzioni.ambienti.iscriviScollegamenti((idNodo) => {
      for (const [idRichiesta, attesa] of this.#inAttesa) if (attesa.idAmbiente === idNodo) this.#chiudi(idRichiesta, attesa, undefined);
    });
  }

  /** I modelli dell'ambiente, chiesti adesso; se l'ambiente non risponde, gli ultimi che aveva detto. */
  async perAmbiente(idAmbiente: string): Promise<EsitoCatalogo> {
    if (!this.#o.ambienti.attivo(idAmbiente)) return { motivo: "L'ambiente è spento." };
    const letti = idAmbiente === ID_AMBIENTE_DEL_CENTRO ? await this.#o.delCentro().catch(() => undefined) : await this.#chiediAlNodo(idAmbiente);
    if (letti !== undefined) this.#ultimi.set(idAmbiente, letti);
    const modelli = letti ?? this.#ultimi.get(idAmbiente);
    return modelli === undefined ? { motivo: "L'ambiente non ha detto i suoi modelli: se il suo nodo è di una versione precedente, va aggiornato." } : { modelli };
  }

  #chiediAlNodo(idAmbiente: string): Promise<ModelloDisponibile[] | undefined> {
    return new Promise((risolvi) => {
      const idRichiesta = randomUUID();
      const scadenza = setTimeout(() => {
        const attesa = this.#inAttesa.get(idRichiesta);
        if (attesa !== undefined) this.#chiudi(idRichiesta, attesa, undefined);
      }, this.#o.attesaMs ?? ATTESA_MS);
      scadenza.unref();
      this.#inAttesa.set(idRichiesta, { idAmbiente, risolvi, scadenza });
      if (!this.#o.ambienti.inviaAlNodo(idAmbiente, { tipo: "modelli", idRichiesta })) this.#chiudi(idRichiesta, this.#inAttesa.get(idRichiesta)!, undefined);
    });
  }

  #chiudi(idRichiesta: string, attesa: InAttesa, modelli: ModelloDisponibile[] | undefined): void {
    this.#inAttesa.delete(idRichiesta);
    clearTimeout(attesa.scadenza);
    attesa.risolvi(modelli);
  }
}
