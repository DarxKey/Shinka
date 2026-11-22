/**
 * Le applicazioni dei progetti viste dal centro: come si avvia quella di ciascuno, se il
 * proprietario la vuole accesa, e la strada per avviarla, fermarla e guardarla, nell'ambiente del
 * centro o su un nodo. È lo stesso meccanismo per il pulsante dell'interfaccia, per il ripristino
 * dopo un riavvio e per gli strumenti degli agenti.
 *
 * Avviare l'applicazione non apre l'anteprima: quella la apre il proprietario. Quando l'avvio lo
 * chiede lui, dal pulsante, l'anteprima si apre insieme.
 */

import { randomUUID } from "node:crypto";
import {
  ATTESA_AVVIO_MS,
  CONDIZIONE_IN_PAROLE,
  leggiAvvio,
  type AvvioApplicazione,
  type ComandoApplicazione,
  type PortaApplicazioni,
  type RiferitoApplicazione,
  type StatoApplicazione,
} from "../protocollo/applicazioni.ts";
import type { EsitoStrumento } from "../protocollo/strumenti.ts";
import { ID_AMBIENTE_DEL_CENTRO, type RegistroAmbienti } from "./ambienti.ts";
import type { ApplicazioneRicordata, RegistroProgetti } from "./progetti.ts";

/** Quanto si aspetta la risposta dell'ambiente, oltre il tempo dell'avvio. */
const MARGINE_MS = 15_000;

export interface OpzioniApplicazioni {
  progetti: Pick<RegistroProgetti, "trova" | "elenco" | "applicazione" | "ricordaAvvio" | "ricordaVoluta">;
  ambienti: RegistroAmbienti;
  /** Chi tiene le applicazioni nell'ambiente del centro: riceve dove riferire. */
  locale(riferisci: (messaggio: RiferitoApplicazione) => void): PortaApplicazioni;
  /** Apre l'anteprima di un progetto: il motivo, se non si può. */
  apriAnteprima?(idProgetto: string, porta: number, percorso: string): Promise<string | undefined>;
  /** Chiude l'anteprima, se è di quel progetto. */
  chiudiAnteprima?(idProgetto: string): void;
  attesaAvvioMs?: number;
}

/** L'applicazione di un progetto per come la vede l'interfaccia. */
export interface VistaApplicazione extends ApplicazioneRicordata {
  /** Com'è adesso, se l'ambiente lo ha detto. */
  stato?: StatoApplicazione;
  /** Perché non si sa com'è: per esempio l'ambiente è spento. */
  motivo?: string;
}

export type EsitoApplicazione = { stato: StatoApplicazione } | { motivo: string };

interface InAttesa {
  idAmbiente: string;
  risolvi(stato: StatoApplicazione): void;
  rifiuta(errore: Error): void;
  scadenza: NodeJS.Timeout;
}

export class ApplicazioniDeiProgetti {
  readonly #o: OpzioniApplicazioni;
  readonly #locale: PortaApplicazioni;
  readonly #richieste = new Map<string, InAttesa>();

  constructor(opzioni: OpzioniApplicazioni) {
    this.#o = opzioni;
    this.#locale = opzioni.locale((messaggio) => this.#riferito(ID_AMBIENTE_DEL_CENTRO, messaggio));
    opzioni.ambienti.iscriviRiferiti((idNodo, messaggio) => {
      if (messaggio.tipo === "applicazione-esito") this.#riferito(idNodo, messaggio);
    });
    opzioni.ambienti.iscriviScollegamenti((idNodo) => {
      for (const [idRichiesta, inAttesa] of [...this.#richieste]) {
        if (inAttesa.idAmbiente !== idNodo) continue;
        this.#richieste.delete(idRichiesta);
        clearTimeout(inAttesa.scadenza);
        inAttesa.rifiuta(new Error("L'ambiente del progetto si è scollegato."));
      }
    });
    // Un ambiente che torna attivo riprende le applicazioni che il proprietario voleva accese.
    opzioni.ambienti.iscriviCollegamenti((idNodo) => void this.ripristina(idNodo));
  }

  /** Com'è l'applicazione di un progetto: come si avvia, se è voluta, e com'è adesso. */
  async vista(idProgetto: string): Promise<VistaApplicazione | undefined> {
    const progetto = this.#o.progetti.trova(idProgetto);
    if (progetto === undefined) return undefined;
    const ricordata = this.#o.progetti.applicazione(idProgetto);
    if (ricordata.avvio === undefined) return ricordata;
    if (!this.#o.ambienti.attivo(progetto.idAmbiente)) return { ...ricordata, motivo: "L'ambiente del progetto è spento." };
    try {
      return { ...ricordata, stato: await this.#chiedi(progetto.idAmbiente, (idRichiesta) => ({ tipo: "applicazione-stato", idRichiesta, idApplicazione: idProgetto, porta: ricordata.avvio?.porta ?? 0 }), MARGINE_MS) };
    } catch (errore) {
      return { ...ricordata, motivo: inParole(errore) };
    }
  }

  /** Imposta come si avvia l'applicazione. Il motivo, se non va bene. */
  async imposta(idProgetto: string, valore: unknown): Promise<string | undefined> {
    if (this.#o.progetti.trova(idProgetto) === undefined) return "Progetto non trovato.";
    const avvio = leggiAvvio(valore);
    if (avvio === undefined) {
      return "Servono il comando, su una riga sola, e la porta su cui l'applicazione risponde (un numero tra 1 e 65535); il percorso, se c'è, comincia con una barra.";
    }
    await this.#o.progetti.ricordaAvvio(idProgetto, avvio);
    return undefined;
  }

  /**
   * Avvia l'applicazione, se non è già accesa, e da qui in poi la ricorda voluta: dopo un riavvio
   * riparte da sola. Con `apriAnteprima` (il pulsante del proprietario) apre anche l'anteprima.
   */
  async avvia(idProgetto: string, opzioni: { apriAnteprima?: boolean } = {}): Promise<EsitoApplicazione> {
    const progetto = this.#o.progetti.trova(idProgetto);
    if (progetto === undefined) return { motivo: "Progetto non trovato." };
    const { avvio } = this.#o.progetti.applicazione(idProgetto);
    if (avvio === undefined) return { motivo: "Non è ancora detto come si avvia l'applicazione di questo progetto: servono il comando e la porta." };
    if (!this.#o.ambienti.attivo(progetto.idAmbiente)) return { motivo: "L'ambiente del progetto è spento." };
    await this.#o.progetti.ricordaVoluta(idProgetto, true);
    let stato: StatoApplicazione;
    try {
      stato = await this.#chiedi(
        progetto.idAmbiente,
        (idRichiesta) => ({ tipo: "applicazione-avvia", idRichiesta, idApplicazione: idProgetto, cartella: progetto.cartella, comando: avvio.comando, porta: avvio.porta }),
        (this.#o.attesaAvvioMs ?? ATTESA_AVVIO_MS) + MARGINE_MS,
      );
    } catch (errore) {
      return { motivo: inParole(errore) };
    }
    if (opzioni.apriAnteprima === true && (stato.condizione === "attiva" || stato.condizione === "fuori-da-shinka")) {
      const motivo = await this.#o.apriAnteprima?.(idProgetto, avvio.porta, avvio.percorso);
      if (motivo !== undefined) return { stato: { ...stato, motivo: `L'applicazione risponde, ma l'anteprima non si è aperta: ${motivo}` } };
    }
    return { stato };
  }

  /** Ferma l'applicazione e chiude la sua anteprima: dopo un riavvio non riparte. */
  async ferma(idProgetto: string): Promise<EsitoApplicazione> {
    const progetto = this.#o.progetti.trova(idProgetto);
    if (progetto === undefined) return { motivo: "Progetto non trovato." };
    await this.#o.progetti.ricordaVoluta(idProgetto, false);
    this.#o.chiudiAnteprima?.(idProgetto);
    if (!this.#o.ambienti.attivo(progetto.idAmbiente)) return { motivo: "L'ambiente del progetto è spento." };
    try {
      return { stato: await this.#chiedi(progetto.idAmbiente, (idRichiesta) => ({ tipo: "applicazione-ferma", idRichiesta, idApplicazione: idProgetto }), MARGINE_MS) };
    } catch (errore) {
      return { motivo: inParole(errore) };
    }
  }

  /**
   * Rilancia le applicazioni volute di un ambiente: all'avvio del centro per il suo, quando un
   * nodo torna attivo per il suo. Una alla volta; chi non riparte resta voluta, e lo dirà la scheda.
   */
  async ripristina(idAmbiente: string): Promise<void> {
    for (const progetto of this.#o.progetti.elenco()) {
      if (progetto.idAmbiente !== idAmbiente || !this.#o.progetti.applicazione(progetto.id).voluta) continue;
      const esito = await this.avvia(progetto.id);
      if ("motivo" in esito || esito.stato.condizione === "fallita") {
        console.error(`L'applicazione di «${progetto.nome}» non è ripartita: ${"motivo" in esito ? esito.motivo : (esito.stato.motivo ?? "")}`);
      }
    }
  }

  /**
   * Gli strumenti degli agenti: imposta_anteprima, avvia_anteprima, ferma_anteprima e
   * stato_anteprima. `chiave` è il progetto che li usa, oppure la Home, che indica il progetto.
   */
  async strumento(chiave: string, nome: string, argomenti: Record<string, unknown>): Promise<EsitoStrumento> {
    const progetto = this.#progettoDi(chiave, argomenti.progetto);
    if (typeof progetto === "string") return { testo: progetto, errore: true };
    const nomeProgetto = `«${progetto.nome}»`;
    if (nome === "imposta_anteprima") {
      if (progetto.id !== chiave) return { testo: "Come si avvia l'applicazione lo dice il progetto stesso, dalla sua conversazione.", errore: true };
      const motivo = await this.imposta(progetto.id, argomenti);
      if (motivo !== undefined) return { testo: motivo, errore: true };
      return {
        testo:
          "Fatto: Shinka sa come si avvia l'applicazione. Avviala con avvia_anteprima; il proprietario la accende e la spegne anche dal pulsante " +
          "dell'anteprima, e dopo un riavvio di Shinka riparte da sola se era accesa.",
      };
    }
    const esito = nome === "avvia_anteprima" ? await this.avvia(progetto.id) : nome === "ferma_anteprima" ? await this.ferma(progetto.id) : await this.#comeSta(progetto.id);
    if ("motivo" in esito) return { testo: `${nomeProgetto}: ${esito.motivo}`, errore: true };
    const { stato } = esito;
    const righe = stato.righe.length === 0 ? "" : `\nUltime righe dell'uscita:\n${stato.righe.slice(-15).join("\n")}`;
    const avvio = this.#o.progetti.applicazione(progetto.id).avvio;
    return {
      testo:
        `L'applicazione di ${nomeProgetto} è ${CONDIZIONE_IN_PAROLE[stato.condizione]}` +
        (avvio === undefined ? "." : ` (porta ${avvio.porta}).`) +
        (stato.motivo === undefined ? "" : ` ${stato.motivo}`) +
        (nome === "avvia_anteprima" && stato.condizione === "attiva"
          ? " Se il proprietario non la sta già guardando, proponigli l'anteprima: ad aprirla è lui."
          : "") +
        righe,
      ...(stato.condizione === "fallita" ? { errore: true as const } : {}),
    };
  }

  async #comeSta(idProgetto: string): Promise<EsitoApplicazione> {
    const vista = await this.vista(idProgetto);
    if (vista?.avvio === undefined) return { motivo: "Non è ancora detto come si avvia l'applicazione di questo progetto: si imposta con imposta_anteprima." };
    return vista.stato === undefined ? { motivo: vista.motivo ?? "Non si sa com'è." } : { stato: vista.stato };
  }

  /** Il progetto di cui si parla: quello che chiama, oppure quello che la Home indica per nome. */
  #progettoDi(chiave: string, indicato: unknown): { id: string; nome: string } | string {
    const proprio = this.#o.progetti.trova(chiave);
    if (proprio !== undefined) return proprio;
    if (typeof indicato !== "string" || indicato.trim() === "") return "Indica il progetto, con il suo nome.";
    const cercato = indicato.trim().toLowerCase();
    const trovati = this.#o.progetti.elenco().filter((uno) => uno.id === indicato.trim() || uno.nome.toLowerCase() === cercato);
    if (trovati.length === 1 && trovati[0] !== undefined) return trovati[0];
    return `Non trovo un progetto che si chiami «${indicato.trim()}»: elenca_progetti dice quali ci sono.`;
  }

  #chiedi(idAmbiente: string, comando: (idRichiesta: string) => ComandoApplicazione, attesaMs: number): Promise<StatoApplicazione> {
    return new Promise((risolvi, rifiuta) => {
      const idRichiesta = randomUUID();
      const scadenza = setTimeout(() => {
        this.#richieste.delete(idRichiesta);
        rifiuta(new Error("L'ambiente non ha risposto: se il suo nodo è di una versione precedente non sa ancora avviare un'applicazione, e va aggiornato."));
      }, attesaMs);
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

  #riferito(idAmbiente: string, messaggio: RiferitoApplicazione): void {
    const inAttesa = this.#richieste.get(messaggio.idRichiesta);
    // Risponde solo l'ambiente a cui era stato chiesto.
    if (inAttesa === undefined || inAttesa.idAmbiente !== idAmbiente) return;
    this.#richieste.delete(messaggio.idRichiesta);
    clearTimeout(inAttesa.scadenza);
    inAttesa.risolvi(messaggio.stato);
  }
}

function inParole(errore: unknown): string {
  return errore instanceof Error ? errore.message : String(errore);
}

