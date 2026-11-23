/**
 * Le cartelle collegate di un progetto (ADR 0050): un progetto vive nel suo ambiente, con il suo
 * motore e la sua cartella, e il proprietario può collegargli cartelle di altri ambienti, per
 * esempio il codice di Shinka Desktop sul PC al progetto Shinka su Unraid. Lì il progetto lavora
 * con gli strumenti di Shinka: comandi, file letti, scritti e modificati. Seguono il modo dei
 * permessi del progetto, come i suoi comandi.
 */

import type { AzioneInAmbiente } from "../protocollo/azioni.ts";
import { DURATA_MASSIMA_COMANDO_MS } from "../protocollo/azioni.ts";
import { COLLEGATE_MASSIME, type CartellaCollegata, type StatoCollegate } from "../protocollo/progetti.ts";
import type { EsitoStrumento } from "../protocollo/strumenti.ts";
import type { RegistroAmbienti } from "./ambienti.ts";
import type { Esecutore } from "./esecutori.ts";
import type { RegistroProgetti } from "./progetti.ts";

export interface OpzioniCollegate {
  progetti: Pick<RegistroProgetti, "trova" | "collegate" | "ricordaCollegate">;
  ambienti: Pick<RegistroAmbienti, "stato" | "attivo">;
  esecutore(idAmbiente: string): Pick<Esecutore, "agisciInCartella">;
  /** Dice alla conversazione del progetto, se è aperta, che le sue cartelle collegate sono cambiate. */
  annota?(idProgetto: string, testo: string): void;
}

/** Quanto può durare un comando in una cartella collegata, se chi lo lancia non dice altro. */
const SECONDI_COMANDO = 120;

function fallito(testo: string): EsitoStrumento {
  return { testo, errore: true };
}

export class CartelleCollegate {
  readonly #o: OpzioniCollegate;

  constructor(opzioni: OpzioniCollegate) {
    this.#o = opzioni;
  }

  stato(idProgetto: string): StatoCollegate | undefined {
    const progetto = this.#o.progetti.trova(idProgetto);
    if (progetto === undefined) return undefined;
    const ambienti = this.#o.ambienti.stato().ambienti;
    const collegate = this.#o.progetti.collegate(idProgetto).map((voce) => {
      const ambiente = ambienti.find((uno) => uno.id === voce.idAmbiente);
      return { ...voce, nomeAmbiente: ambiente?.nome ?? "ambiente rimosso", sistema: ambiente?.sistema ?? "", attivo: this.#o.ambienti.attivo(voce.idAmbiente) };
    });
    const prese = new Set([progetto.idAmbiente, ...collegate.map((voce) => voce.idAmbiente)]);
    const possibili = ambienti
      .filter((ambiente) => !prese.has(ambiente.id) && this.#o.ambienti.attivo(ambiente.id))
      .map((ambiente) => ({ idAmbiente: ambiente.id, nomeAmbiente: ambiente.nome, sistema: ambiente.sistema }));
    return { collegate, possibili };
  }

  /**
   * Collega una cartella di un altro ambiente: l'ambiente dev'essere acceso, e la cartella esserci.
   * Una per ambiente: collegarne un'altra nello stesso ambiente sostituisce quella di prima.
   */
  async collega(idProgetto: string, collegata: CartellaCollegata): Promise<StatoCollegate | { motivo: string }> {
    const progetto = this.#o.progetti.trova(idProgetto);
    if (progetto === undefined) return { motivo: "Progetto non trovato." };
    if (collegata.idAmbiente === progetto.idAmbiente) return { motivo: "Questa è la cartella del progetto, nel suo ambiente: non serve collegarla." };
    if (!this.#o.ambienti.attivo(collegata.idAmbiente)) return { motivo: "L'ambiente scelto non è acceso: accendilo e riprova." };
    const cartella = collegata.cartella.trim();
    if (cartella === "" || cartella.length > 1000) return { motivo: "Serve il percorso completo della cartella." };
    const altre = this.#o.progetti.collegate(idProgetto).filter((voce) => voce.idAmbiente !== collegata.idAmbiente);
    if (altre.length >= COLLEGATE_MASSIME) return { motivo: `Un progetto ha al massimo ${COLLEGATE_MASSIME} cartelle collegate.` };
    let controllo;
    try {
      controllo = await this.#o.esecutore(collegata.idAmbiente).agisciInCartella(cartella, { tipo: "controlla-cartella" });
    } catch (errore) {
      return { motivo: errore instanceof Error ? errore.message : String(errore) };
    }
    if (!controllo.riuscita) return { motivo: controllo.testo };
    await this.#o.progetti.ricordaCollegate(idProgetto, [...altre, { idAmbiente: collegata.idAmbiente, cartella: controllo.percorso ?? cartella }]);
    this.#avvisa(idProgetto);
    return this.stato(idProgetto) ?? { motivo: "Progetto non trovato." };
  }

  async scollega(idProgetto: string, idAmbiente: string): Promise<StatoCollegate | { motivo: string }> {
    if (this.#o.progetti.trova(idProgetto) === undefined) return { motivo: "Progetto non trovato." };
    const prima = this.#o.progetti.collegate(idProgetto);
    const dopo = prima.filter((voce) => voce.idAmbiente !== idAmbiente);
    if (dopo.length === prima.length) return { motivo: "In quell'ambiente il progetto non ha una cartella collegata." };
    await this.#o.progetti.ricordaCollegate(idProgetto, dopo);
    this.#avvisa(idProgetto);
    return this.stato(idProgetto) ?? { motivo: "Progetto non trovato." };
  }

  /** Ciò che la conversazione del progetto deve sapere delle sue cartelle collegate, in parole. */
  descrizione(idProgetto: string): string {
    const stato = this.stato(idProgetto);
    if (stato === undefined || stato.collegate.length === 0) {
      return "Questo progetto non ha cartelle collegate in altri ambienti: le collega il proprietario, dalla scheda della sessione.";
    }
    const righe = stato.collegate.map(
      (voce) =>
        `- ambiente "${voce.nomeAmbiente}" (${/windows/i.test(voce.sistema) ? `${voce.sistema}, comandi in PowerShell` : `${voce.sistema === "" ? "sistema sconosciuto" : voce.sistema}, comandi in bash`}${voce.attivo ? "" : ", spento adesso"}): ${voce.cartella}`,
    );
    return `Le cartelle collegate a questo progetto, in altri ambienti:\n${righe.join("\n")}`;
  }

  /** Gli strumenti delle cartelle collegate, per la conversazione del progetto. Non lancia mai. */
  async strumento(idProgetto: string, nome: string, argomenti: Record<string, unknown>): Promise<EsitoStrumento> {
    if (nome === "cartelle_collegate") return { testo: this.descrizione(idProgetto) };
    const nomeAmbiente = typeof argomenti.ambiente === "string" ? argomenti.ambiente.trim() : "";
    const stato = this.stato(idProgetto);
    if (stato === undefined) return fallito("Progetto non trovato.");
    const voce = stato.collegate.find((una) => una.nomeAmbiente.toLowerCase() === nomeAmbiente.toLowerCase() || una.idAmbiente === nomeAmbiente);
    if (voce === undefined) {
      return fallito(stato.collegate.length === 0 ? "Questo progetto non ha cartelle collegate." : `In "${nomeAmbiente}" il progetto non ha una cartella collegata. ${this.descrizione(idProgetto)}`);
    }
    if (!voce.attivo) return fallito(`L'ambiente "${voce.nomeAmbiente}" è spento: la sua cartella collegata non si raggiunge.`);
    const testo = (campo: string): string | undefined => (typeof argomenti[campo] === "string" ? (argomenti[campo] as string) : undefined);
    let azione: AzioneInAmbiente;
    switch (nome) {
      case "esegui_nella_collegata": {
        const comando = testo("comando");
        if (comando === undefined || comando.trim() === "") return fallito("Manca il comando.");
        const secondi = typeof argomenti.secondi === "number" && Number.isFinite(argomenti.secondi) ? argomenti.secondi : SECONDI_COMANDO;
        azione = { tipo: "esegui", comando, durataMs: Math.min(Math.max(1, secondi) * 1000, DURATA_MASSIMA_COMANDO_MS) };
        break;
      }
      case "leggi_nella_collegata": {
        const percorso = testo("percorso");
        if (percorso === undefined || percorso.trim() === "") return fallito("Manca il percorso del file.");
        azione = { tipo: "leggi-file", percorso };
        break;
      }
      case "scrivi_nella_collegata": {
        const percorso = testo("percorso");
        const contenuto = testo("contenuto");
        if (percorso === undefined || percorso.trim() === "" || contenuto === undefined) return fallito("Servono il percorso e il contenuto del file.");
        azione = { tipo: "scrivi-file", percorso, contenuto };
        break;
      }
      case "modifica_nella_collegata": {
        const percorso = testo("percorso");
        const vecchio = testo("testo_vecchio");
        const nuovo = testo("testo_nuovo");
        if (percorso === undefined || percorso.trim() === "" || vecchio === undefined || vecchio === "" || nuovo === undefined) {
          return fallito("Servono il percorso, il testo da cambiare e quello nuovo.");
        }
        if (vecchio === nuovo) return fallito("Il testo nuovo è uguale a quello vecchio.");
        azione = { tipo: "modifica-file", percorso, vecchio, nuovo, ...(argomenti.tutte === true ? { tutte: true } : {}) };
        break;
      }
      default:
        return fallito("Questo strumento non esiste.");
    }
    try {
      const esito = await this.#o.esecutore(voce.idAmbiente).agisciInCartella(voce.cartella, azione);
      return esito.riuscita ? { testo: esito.testo } : fallito(esito.testo);
    } catch (errore) {
      return fallito(errore instanceof Error ? errore.message : String(errore));
    }
  }

  #avvisa(idProgetto: string): void {
    this.#o.annota?.(idProgetto, `[Shinka] Le cartelle collegate a questo progetto sono cambiate. ${this.descrizione(idProgetto)}`);
  }
}
