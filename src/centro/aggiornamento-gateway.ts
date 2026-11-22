/**
 * Il centro propone al gateway la versione di Shinka che ha in funzione.
 *
 * Il gateway custodisce il vault e fa da confine: una versione nuova di sé non la decide il
 * centro. Il centro gli passa i file della sua parte e in parole che cosa cambia; il gateway
 * guarda da sé che cosa cambierebbe e chiede il sì al proprietario lui stesso, su Telegram o nella
 * pagina del vault. Qui si propone, si aspetta e si riferisce al progetto Shinka com'è finita.
 */

import type { EsitoStrumento } from "../protocollo/strumenti.ts";
import { inBreve, versioneDi } from "../protocollo/versione.ts";
import type { PortaGateway } from "./gateway.ts";
import { cambiaLaParteDelGateway, pacchettoDelGateway } from "./pacchetto.ts";

export interface OpzioniGatewayAllaVersione {
  gateway: PortaGateway;
  /** La cartella della versione in funzione: il centro gira da lì. */
  installata: string;
  /** Dice al progetto Shinka com'è finita, prima del suo prossimo messaggio. */
  riferisci(testo: string): void;
  /** Ogni quanto si chiede al gateway a che punto è. */
  pausaMs?: number;
  /** Per quanto, dopo la scadenza della domanda, si aspetta ancora che il gateway riparta e dica com'è finita. */
  codaMs?: number;
  adesso?: () => number;
}

function riuscito(testo: string): EsitoStrumento {
  return { testo };
}

function fallito(testo: string): EsitoStrumento {
  return { testo, errore: true };
}

const DA_FUORI = "Questa volta lo deve aggiornare da fuori chi ha accesso al server: dillo al proprietario.";

export class GatewayAllaVersione {
  readonly #o: OpzioniGatewayAllaVersione;
  /** La versione di cui si sta aspettando l'esito, se ce n'è una. */
  #seguita: string | undefined;
  #chiuso = false;

  constructor(opzioni: OpzioniGatewayAllaVersione) {
    this.#o = opzioni;
  }

  #adesso(): number {
    return this.#o.adesso?.() ?? Date.now();
  }

  /**
   * Ciò che il proprietario deve sapere prima di approvare una versione preparata in `nuova`, se
   * cambia la parte del gateway; nulla se non cambia.
   */
  async avviso(nuova: string): Promise<string | undefined> {
    let cambia: boolean;
    try {
      cambia = await cambiaLaParteDelGateway(this.#o.installata, nuova);
    } catch {
      // Se non si riesce a confrontare, meglio dirlo che tacere.
      return "Non è stato possibile capire se cambia anche il gateway: dopo l'installazione lo dirà lui, se ha una versione nuova da chiederti.";
    }
    if (!cambia) return undefined;
    const stato = await this.#o.gateway.stato();
    if (stato.gateway === "non-configurato") return undefined;
    return stato.siAggiorna === true
      ? "Cambia anche il gateway: dopo l'installazione sarà lui a chiederti il sì, su Telegram o nella pagina del vault. " +
          "Con quel sì si riavvia: il vault si chiude e va riaperto con la tua frase."
      : "Cambia anche il gateway, e quello in funzione non sa aggiornarsi da dentro: resta quello di prima finché non lo si aggiorna da fuori.";
  }

  /**
   * Propone al gateway la versione in funzione al centro. Non installa nulla: se cambia qualcosa
   * il gateway lo chiede al proprietario, e l'esito arriva più tardi, con `riferisci`.
   */
  async proponi(riassunto: string): Promise<EsitoStrumento & { esito: "uguale" | "chiesto" | "non-accolto" }> {
    const esito = await this.#proponi(riassunto);
    return { ...esito, esito: esito.errore === true ? "non-accolto" : this.#seguita === undefined ? "uguale" : "chiesto" };
  }

  async #proponi(riassunto: string): Promise<EsitoStrumento> {
    if (this.#seguita !== undefined) {
      return fallito(`Il gateway sta già decidendo della versione ${inBreve(this.#seguita)}: com'è finita lo saprai da un messaggio [Shinka].`);
    }
    const versione = await versioneDi(this.#o.installata);
    if (versione === undefined) {
      return fallito("Non è scritto quale versione sia in funzione al centro: non c'è una versione da proporre al gateway.");
    }
    let file;
    try {
      file = await pacchettoDelGateway(this.#o.installata);
    } catch (errore) {
      return fallito(`La parte del gateway non si è potuta leggere dalla versione in funzione: ${errore instanceof Error ? errore.message : String(errore)}`);
    }
    const esito = await this.#o.gateway.proponiVersione({ versione, riassunto: riassunto.trim().slice(0, 2000), file });
    const breve = inBreve(versione);
    if (esito.esito === "uguale") {
      return riuscito(`Il gateway ha già il codice della versione ${breve}: per lui non c'è nulla da installare, e al proprietario non è stato chiesto nulla.`);
    }
    if (esito.esito === "rifiutato") {
      return fallito(`Il gateway non ha accolto la versione ${breve}: ${esito.motivo}${/da fuori/.test(esito.motivo) ? ` ${DA_FUORI}` : ""}`);
    }
    this.#seguita = versione;
    void this.#segui(versione, Date.parse(esito.scadeIl));
    return riuscito(
      `Il gateway ha chiesto al proprietario il sì per la sua versione ${breve} (cambiano ${esito.cambiano.length} file): glielo chiede lui stesso, ` +
        "su Telegram o nella pagina del vault, e tu non puoi darlo né sollecitarlo con altri mezzi. Con il sì il gateway si riavvia: " +
        "il vault si chiude finché il proprietario non lo riapre con la sua frase, e fino ad allora credenziali, browser del gateway e stack non si usano. " +
        "Se la versione nuova non parte, torna da sola quella di prima. Com'è finita lo saprai da un messaggio [Shinka].",
    );
  }

  /** Il centro si spegne: non si aspetta più nulla. */
  chiudi(): void {
    this.#chiuso = true;
  }

  async #segui(versione: string, scade: number): Promise<void> {
    const breve = inBreve(versione);
    const entro = (Number.isFinite(scade) ? scade : this.#adesso()) + (this.#o.codaMs ?? 20 * 60 * 1000);
    const fine = (testo: string): void => {
      this.#seguita = undefined;
      if (!this.#chiuso) this.#o.riferisci(`[Shinka] ${testo}`);
    };
    for (;;) {
      await new Promise((fatto) => setTimeout(fatto, this.#o.pausaMs ?? 5_000).unref());
      if (this.#chiuso) return;
      const stato = await this.#o.gateway.stato();
      if (stato.gateway === "attivo") {
        const ultima = stato.aggiornamento?.versione === versione ? stato.aggiornamento : undefined;
        if (ultima?.stato === "negato") return fine(`Il proprietario ha detto di no alla versione ${breve} del gateway: resta quella di prima. Se non ha detto perché, chiediglielo.`);
        if (ultima?.stato === "scaduto") {
          return fine(`La richiesta di installare la versione ${breve} del gateway è scaduta senza risposta: resta quella di prima. Se serve ancora, riproponila con aggiorna_gateway.`);
        }
        if (ultima?.stato === "non-riuscito") {
          return fine(`La versione ${breve} del gateway non è entrata in funzione (${ultima.motivo}): il gateway è tornato a quella di prima. Trova il difetto prima di riproporla.`);
        }
        if (ultima === undefined && stato.versione === versione) {
          return fine(
            `Il gateway è passato alla versione ${breve}. Il vault è ${stato.condizione === "aperto" ? "aperto" : "chiuso: lo riapre il proprietario con la sua frase, e fino ad allora credenziali, browser del gateway e stack non si usano"}.`,
          );
        }
      }
      if (this.#adesso() > entro) {
        return fine(`Non si sa com'è finita l'installazione della versione ${breve} del gateway: il gateway non lo ha detto in tempo. Guarda la pagina Vault.`);
      }
    }
  }
}
