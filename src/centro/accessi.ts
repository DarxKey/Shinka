/**
 * Gli accessi dei motori in tutti gli ambienti, per la pagina Impostazioni (ADR 0030): l'ambiente
 * del centro risponde da sé, gli altri attraverso il loro nodo.
 */

import { randomUUID } from "node:crypto";
import type { EsitoAccessi, RichiestaAccessi } from "../protocollo/accessi.ts";
import type { RiferitoDalNodo } from "../protocollo/nodi.ts";
import { ID_AMBIENTE_DEL_CENTRO, type RegistroAmbienti } from "./ambienti.ts";

/** Ciò che sa fare un ambiente sugli accessi: nell'ambiente del centro, gli accessi di questa macchina. */
export interface PortaAccessi {
  esegui(richiesta: RichiestaAccessi): Promise<EsitoAccessi>;
}

/** Lo stato di un ambiente si chiede in fretta; un codice incollato aspetta che Claude Code concluda. */
const ATTESA_STATO_MS = 30_000;
const ATTESA_AZIONE_MS = 90_000;

interface InAttesa {
  idAmbiente: string;
  risolvi(esito: EsitoAccessi): void;
  scadenza: NodeJS.Timeout;
}

export class AccessiNegliAmbienti {
  readonly #ambienti: RegistroAmbienti;
  readonly #locale: PortaAccessi;
  readonly #inAttesa = new Map<string, InAttesa>();

  constructor(ambienti: RegistroAmbienti, locale: PortaAccessi) {
    this.#ambienti = ambienti;
    this.#locale = locale;
    ambienti.iscriviRiferiti((idNodo, messaggio) => this.#riferito(idNodo, messaggio));
    ambienti.iscriviScollegamenti((idNodo) => this.#scollegato(idNodo));
  }

  esegui(idAmbiente: string, richiesta: RichiestaAccessi): Promise<EsitoAccessi> {
    if (idAmbiente === ID_AMBIENTE_DEL_CENTRO) return this.#locale.esegui(richiesta);
    return new Promise((risolvi) => {
      const idRichiesta = randomUUID();
      const scadenza = setTimeout(() => {
        this.#inAttesa.delete(idRichiesta);
        risolvi({ motivo: "L'ambiente non ha risposto: se il suo nodo è di una versione precedente non conosce gli accessi, e va aggiornato." });
      }, richiesta.tipo === "stato" ? ATTESA_STATO_MS : ATTESA_AZIONE_MS);
      this.#inAttesa.set(idRichiesta, { idAmbiente, risolvi, scadenza });
      if (!this.#ambienti.inviaAlNodo(idAmbiente, { tipo: "accessi", idRichiesta, richiesta })) {
        clearTimeout(scadenza);
        this.#inAttesa.delete(idRichiesta);
        risolvi({ motivo: "L'ambiente è spento." });
      }
    });
  }

  #riferito(idNodo: string, messaggio: RiferitoDalNodo): void {
    if (messaggio.tipo !== "accessi-esito") return;
    const inAttesa = this.#inAttesa.get(messaggio.idRichiesta);
    // Risponde solo l'ambiente a cui la richiesta era stata fatta.
    if (inAttesa === undefined || inAttesa.idAmbiente !== idNodo) return;
    this.#inAttesa.delete(messaggio.idRichiesta);
    clearTimeout(inAttesa.scadenza);
    inAttesa.risolvi(messaggio.esito);
  }

  #scollegato(idNodo: string): void {
    for (const [idRichiesta, inAttesa] of this.#inAttesa) {
      if (inAttesa.idAmbiente !== idNodo) continue;
      this.#inAttesa.delete(idRichiesta);
      clearTimeout(inAttesa.scadenza);
      inAttesa.risolvi({ motivo: "L'ambiente si è scollegato." });
    }
  }
}
