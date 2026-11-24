/**
 * Le risorse degli ambienti, per la loro pagina (ADR 0038): l'ambiente del centro le legge da sé,
 * gli altri attraverso il loro nodo. Per l'ambiente del centro si aggiungono i container degli host
 * per gli stack, che il gateway legge con la sua credenziale: lì il centro di solito gira in un
 * container, e Docker non lo vede.
 */

import { randomUUID } from "node:crypto";
import type { RiferitoDalNodo } from "../protocollo/nodi.ts";
import type { DettaglioDellAmbiente, DockerDiUnHost, RisorseDellAmbiente } from "../protocollo/risorse.ts";
import { ID_AMBIENTE_DEL_CENTRO, type RegistroAmbienti } from "./ambienti.ts";

/** Ciò che il gateway dice dei container degli host per gli stack. */
export type ContenitoriDalGateway = { host: DockerDiUnHost[] } | { motivo: string };

export interface OpzioniRisorse {
  ambienti: RegistroAmbienti;
  /** Le risorse della macchina del centro, e i processi che vi accende Shinka. */
  locale: { leggi(): Promise<RisorseDellAmbiente> };
  processiLocali?: { termina(pid: number): Promise<{ riuscita: boolean; testo: string }> };
  /** I container degli host per gli stack, dal gateway. Senza, non si mostrano. */
  contenitori?: () => Promise<ContenitoriDalGateway>;
  /** Per quanto vale una lettura del gateway: la pagina chiede più spesso di quanto serva rileggere. */
  contenitoriOgniMs?: number;
  attesaMs?: number;
  adesso?: () => number;
}

interface InAttesa {
  idAmbiente: string;
  risolvi(esito: DettaglioDellAmbiente): void;
  scadenza: NodeJS.Timeout;
}

export class RisorseDegliAmbienti {
  readonly #o: OpzioniRisorse;
  readonly #inAttesa = new Map<string, InAttesa>();
  readonly #terminazioni = new Map<string, { idAmbiente: string; risolvi(esito: { riuscita: boolean; testo: string }): void; scadenza: NodeJS.Timeout }>();
  #dalGateway: { quando: number; letti: ContenitoriDalGateway } | undefined;
  #gatewayInCorso: Promise<ContenitoriDalGateway> | undefined;

  constructor(opzioni: OpzioniRisorse) {
    this.#o = opzioni;
    opzioni.ambienti.iscriviRiferiti((idNodo, messaggio) => this.#riferito(idNodo, messaggio));
    opzioni.ambienti.iscriviScollegamenti((idNodo) => this.#scollegato(idNodo));
  }

  /** Come sta un ambiente adesso. Non lancia mai: se non si può sapere, dice perché. */
  async leggi(idAmbiente: string): Promise<DettaglioDellAmbiente> {
    if (idAmbiente !== ID_AMBIENTE_DEL_CENTRO) return this.#delNodo(idAmbiente);
    try {
      const [risorse, contenitori] = await Promise.all([this.#o.locale.leggi(), this.#contenitori()]);
      if (contenitori === undefined) return risorse;
      return "motivo" in contenitori ? { ...risorse, motivoHostDocker: contenitori.motivo } : { ...risorse, hostDocker: contenitori.host };
    } catch (errore) {
      return { motivo: `Le risorse non si sono potute leggere: ${errore instanceof Error ? errore.message : String(errore)}` };
    }
  }

  /** I container dal gateway: l'ultima lettura finché è fresca, altrimenti una nuova, una alla volta. */
  async #contenitori(): Promise<ContenitoriDalGateway | undefined> {
    if (this.#o.contenitori === undefined) return undefined;
    const adesso = this.#o.adesso?.() ?? Date.now();
    if (this.#dalGateway !== undefined && adesso - this.#dalGateway.quando < (this.#o.contenitoriOgniMs ?? 10_000)) return this.#dalGateway.letti;
    this.#gatewayInCorso ??= this.#o
      .contenitori()
      .catch((errore: unknown): ContenitoriDalGateway => ({ motivo: errore instanceof Error ? errore.message : String(errore) }))
      .then((letti) => {
        this.#dalGateway = { quando: this.#o.adesso?.() ?? Date.now(), letti };
        return letti;
      })
      .finally(() => {
        this.#gatewayInCorso = undefined;
      });
    // Chi guarda non aspetta il gateway a ogni campione: finché arriva la lettura nuova vale quella di prima.
    return this.#dalGateway?.letti ?? this.#gatewayInCorso;
  }

  #delNodo(idAmbiente: string): Promise<DettaglioDellAmbiente> {
    return new Promise((risolvi) => {
      const idRichiesta = randomUUID();
      const scadenza = setTimeout(() => {
        this.#inAttesa.delete(idRichiesta);
        risolvi({ motivo: "L'ambiente non ha risposto: se il suo nodo è di una versione precedente non sa dire le sue risorse, e va aggiornato." });
      }, this.#o.attesaMs ?? 15_000);
      scadenza.unref();
      this.#inAttesa.set(idRichiesta, { idAmbiente, risolvi, scadenza });
      if (!this.#o.ambienti.inviaAlNodo(idAmbiente, { tipo: "risorse", idRichiesta })) {
        clearTimeout(scadenza);
        this.#inAttesa.delete(idRichiesta);
        risolvi({ motivo: "L'ambiente è spento." });
      }
    });
  }

  /** Termina un processo acceso da Shinka in un ambiente, con ciò che ha avviato. Non lancia: l'esito dice com'è andata. */
  termina(idAmbiente: string, pid: number): Promise<{ riuscita: boolean; testo: string }> {
    if (idAmbiente === ID_AMBIENTE_DEL_CENTRO) {
      return this.#o.processiLocali?.termina(pid) ?? Promise.resolve({ riuscita: false, testo: "Qui i processi non si terminano." });
    }
    return new Promise((risolvi) => {
      const idRichiesta = randomUUID();
      const scadenza = setTimeout(() => {
        this.#terminazioni.delete(idRichiesta);
        risolvi({ riuscita: false, testo: "L'ambiente non ha risposto: se il suo nodo è di una versione precedente non sa terminare i processi, e va aggiornato." });
      }, this.#o.attesaMs ?? 15_000);
      scadenza.unref();
      this.#terminazioni.set(idRichiesta, { idAmbiente, risolvi, scadenza });
      if (!this.#o.ambienti.inviaAlNodo(idAmbiente, { tipo: "termina-processo", idRichiesta, pid })) {
        clearTimeout(scadenza);
        this.#terminazioni.delete(idRichiesta);
        risolvi({ riuscita: false, testo: "L'ambiente è spento." });
      }
    });
  }

  #riferito(idNodo: string, messaggio: RiferitoDalNodo): void {
    if (messaggio.tipo === "processo-terminato") {
      const attesa = this.#terminazioni.get(messaggio.idRichiesta);
      if (attesa === undefined || attesa.idAmbiente !== idNodo) return;
      this.#terminazioni.delete(messaggio.idRichiesta);
      clearTimeout(attesa.scadenza);
      attesa.risolvi({ riuscita: messaggio.riuscita, testo: messaggio.testo });
      return;
    }
    if (messaggio.tipo !== "risorse-esito") return;
    const inAttesa = this.#inAttesa.get(messaggio.idRichiesta);
    // Risponde solo l'ambiente a cui la richiesta era stata fatta.
    if (inAttesa === undefined || inAttesa.idAmbiente !== idNodo) return;
    this.#inAttesa.delete(messaggio.idRichiesta);
    clearTimeout(inAttesa.scadenza);
    inAttesa.risolvi(messaggio.risorse);
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
