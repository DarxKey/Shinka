/**
 * Porta le estensioni di Shinka negli ambienti: a ogni nodo appena viene accolto e a tutti quelli
 * attivi ogni volta che l'elenco cambia; per l'ambiente del centro, direttamente. Da qui passano
 * anche la prova di un'estensione in un ambiente, lo sguardo a ciò che l'ambiente ha già, e le
 * chiavi che un'estensione chiede al vault nel momento in cui parte.
 */

import { randomUUID } from "node:crypto";
import type { EstensioniInAmbiente } from "../nodo/estensioni.ts";
import {
  ATTESA_AMBIENTE_MS,
  type ChiaviConsegnate,
  type EsitoProva,
  type EstensioneDistribuita,
  type EstensioniDellAmbiente,
} from "../protocollo/estensioni.ts";
import type { RiferitoDalNodo } from "../protocollo/nodi.ts";
import { ID_AMBIENTE_DEL_CENTRO, type RegistroAmbienti } from "./ambienti.ts";
import type { Estensioni, PortaEstensioni } from "./estensioni.ts";

/** Quanto si aspetta che un ambiente dica che cosa ha già. */
const ATTESA_SGUARDO_MS = 75_000;

export interface OpzioniEstensioniNegliAmbienti {
  ambienti: RegistroAmbienti;
  /** Le estensioni dell'ambiente in cui gira il centro. */
  locale: EstensioniInAmbiente;
  /** L'elenco, chiesto nel momento in cui serve: nasce dopo. */
  estensioni(): Estensioni;
  /** Chiede al gateway le chiavi che un'estensione dichiara, per un ambiente: escono dal vault, e la consegna resta nel registro. */
  chiavi(estensione: string, idAmbiente: string, nomi: string[]): Promise<ChiaviConsegnate>;
  attesaProvaMs?: number;
  attesaSguardoMs?: number;
}

interface InAttesa<T> {
  idAmbiente: string;
  risolvi(valore: T): void;
  scadenza: NodeJS.Timeout;
}

export class EstensioniNegliAmbienti {
  readonly #o: OpzioniEstensioniNegliAmbienti;
  readonly #prove = new Map<string, InAttesa<EsitoProva>>();
  readonly #sguardi = new Map<string, InAttesa<EstensioniDellAmbiente | Error>>();

  constructor(opzioni: OpzioniEstensioniNegliAmbienti) {
    this.#o = opzioni;
    opzioni.ambienti.iscriviRiferiti((idNodo, messaggio) => this.#riferito(idNodo, messaggio));
    opzioni.ambienti.iscriviScollegamenti((idNodo) => this.#scollegato(idNodo));
  }

  /**
   * Da adesso l'elenco arriva agli ambienti: subito a quello del centro, a ogni nodo quando si
   * collega, e a tutti a ogni cambiamento. Si può aspettare che l'ambiente del centro sia pronto.
   */
  avvia(): Promise<void> {
    const { ambienti, locale } = this.#o;
    const manda = (idAmbiente: string): void => {
      ambienti.inviaAlNodo(idAmbiente, { tipo: "estensioni", estensioni: this.#o.estensioni().accese(idAmbiente) });
    };
    ambienti.iscriviCollegamenti(manda);
    this.#o.estensioni().ascolta(() => {
      void locale.imposta(this.#o.estensioni().accese(ID_AMBIENTE_DEL_CENTRO));
      for (const idAmbiente of ambienti.collegati()) manda(idAmbiente);
    });
    return locale.imposta(this.#o.estensioni().accese(ID_AMBIENTE_DEL_CENTRO));
  }

  /** Le chiavi di un'estensione, per l'ambiente che le chiede: solo se lì è accesa, o in prova dopo la conferma. */
  chiavi(estensione: string, idAmbiente: string): Promise<ChiaviConsegnate> {
    const nomi = this.#o.estensioni().chiaviRichiedibili(estensione, idAmbiente);
    if (nomi === undefined) {
      return Promise.resolve({ motivo: `l'estensione "${estensione}" non è accesa in questo ambiente, e la sua chiave non viene consegnata` });
    }
    return this.#o.chiavi(estensione, idAmbiente, nomi).catch((errore: unknown) => ({ motivo: errore instanceof Error ? errore.message : String(errore) }));
  }

  /** Come si raggiungono le estensioni di un ambiente. */
  per(idAmbiente: string): PortaEstensioni {
    if (idAmbiente === ID_AMBIENTE_DEL_CENTRO) return this.#o.locale;
    return {
      prova: (estensione) => this.#prova(idAmbiente, estensione),
      guarda: () => this.#guarda(idAmbiente),
    };
  }

  #prova(idAmbiente: string, estensione: EstensioneDistribuita): Promise<EsitoProva> {
    return new Promise((risolvi) => {
      const idRichiesta = randomUUID();
      const scadenza = setTimeout(() => {
        this.#prove.delete(idRichiesta);
        risolvi({ riuscita: false, motivo: "L'ambiente non ha risposto alla prova: il suo nodo forse è di una versione che non conosce le estensioni, e va aggiornato." });
      }, this.#o.attesaProvaMs ?? ATTESA_AMBIENTE_MS);
      this.#prove.set(idRichiesta, { idAmbiente, risolvi, scadenza });
      if (!this.#o.ambienti.inviaAlNodo(idAmbiente, { tipo: "prova-estensione", idRichiesta, estensione })) {
        clearTimeout(scadenza);
        this.#prove.delete(idRichiesta);
        risolvi({ riuscita: false, motivo: "L'ambiente è spento.", riprovabile: true });
      }
    });
  }

  #guarda(idAmbiente: string): Promise<EstensioniDellAmbiente> {
    return new Promise((risolvi, rifiuta) => {
      const idRichiesta = randomUUID();
      const scadenza = setTimeout(() => {
        this.#sguardi.delete(idRichiesta);
        rifiuta(new Error("L'ambiente non ha risposto: il suo nodo forse è di una versione che non conosce le estensioni."));
      }, this.#o.attesaSguardoMs ?? ATTESA_SGUARDO_MS);
      this.#sguardi.set(idRichiesta, {
        idAmbiente,
        risolvi: (valore) => (valore instanceof Error ? rifiuta(valore) : risolvi(valore)),
        scadenza,
      });
      if (!this.#o.ambienti.inviaAlNodo(idAmbiente, { tipo: "guarda-estensioni", idRichiesta })) {
        clearTimeout(scadenza);
        this.#sguardi.delete(idRichiesta);
        rifiuta(new Error("L'ambiente è spento."));
      }
    });
  }

  #riferito(idNodo: string, messaggio: RiferitoDalNodo): void {
    switch (messaggio.tipo) {
      case "estensione-provata": {
        const inAttesa = this.#prove.get(messaggio.idRichiesta);
        // Risponde solo l'ambiente a cui la prova era stata chiesta.
        if (inAttesa === undefined || inAttesa.idAmbiente !== idNodo) return;
        this.#prove.delete(messaggio.idRichiesta);
        clearTimeout(inAttesa.scadenza);
        inAttesa.risolvi(messaggio.esito);
        return;
      }
      case "estensioni-guardate": {
        const inAttesa = this.#sguardi.get(messaggio.idRichiesta);
        if (inAttesa === undefined || inAttesa.idAmbiente !== idNodo) return;
        this.#sguardi.delete(messaggio.idRichiesta);
        clearTimeout(inAttesa.scadenza);
        inAttesa.risolvi(messaggio.viste ?? new Error(messaggio.motivo ?? "L'ambiente non ha saputo guardare."));
        return;
      }
      case "chiavi-richieste": {
        const { idRichiesta, estensione } = messaggio;
        // Un nodo riceve solo le chiavi delle estensioni accese nel proprio ambiente.
        void this.chiavi(estensione, idNodo).then((chiavi) => this.#o.ambienti.inviaAlNodo(idNodo, { tipo: "chiavi-consegnate", idRichiesta, chiavi }));
        return;
      }
      default:
        return;
    }
  }

  #scollegato(idNodo: string): void {
    for (const [idRichiesta, inAttesa] of this.#prove) {
      if (inAttesa.idAmbiente !== idNodo) continue;
      this.#prove.delete(idRichiesta);
      clearTimeout(inAttesa.scadenza);
      inAttesa.risolvi({ riuscita: false, motivo: "L'ambiente si è scollegato durante la prova.", riprovabile: true });
    }
    for (const [idRichiesta, inAttesa] of this.#sguardi) {
      if (inAttesa.idAmbiente !== idNodo) continue;
      this.#sguardi.delete(idRichiesta);
      clearTimeout(inAttesa.scadenza);
      inAttesa.risolvi(new Error("L'ambiente si è scollegato."));
    }
  }
}
