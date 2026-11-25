/**
 * I lavori della Home nel Chrome di un PC (ADR 0063). La Home gira sul centro, dove Chrome non c'è:
 * per usare quello di un ambiente fa partire lì una conversazione a parte di Claude Code, con Claude
 * in Chrome acceso e un solo compito. Ogni azione nel browser chiede il consenso del proprietario
 * nella chat della Home; alla fine la Home riceve il risultato. La conversazione poi si chiude.
 */

import { randomUUID } from "node:crypto";
import { conversazioneNelBrowser } from "../protocollo/browser-del-pc.ts";
import type { DecisionePermesso, EventoConversazione, PortaConversazione } from "../protocollo/eventi.ts";
import type { ImpostazioniConversazione } from "../protocollo/impostazioni.ts";
import type { EsitoStrumento } from "../protocollo/strumenti.ts";
import type { RegistroAmbienti } from "./ambienti.ts";
import type { Esecutore } from "./esecutori.ts";

/** Quanto può durare un lavoro nel browser: ogni azione aspetta il proprietario. */
const DURATA_MASSIMA_MS = 30 * 60 * 1000;
/** Quanto del risultato torna alla Home. */
const RISULTATO_MASSIMO = 20_000;

export interface OpzioniLavoriNelBrowser {
  ambienti: Pick<RegistroAmbienti, "stato">;
  esecutore(idAmbiente: string): Pick<Esecutore, "apriConversazione">;
  durataMs?: number;
}

/** Le impostazioni del lavoro: Claude, Chrome acceso, e ogni altra azione chiesta. */
const IMPOSTAZIONI: ImpostazioniConversazione = { motore: "claude", permessi: "chiedi", browserChrome: true };

export class LavoriNelBrowser {
  readonly #o: OpzioniLavoriNelBrowser;
  /** Le richieste di permesso in attesa, con la conversazione che le ha fatte. */
  readonly #permessi = new Map<string, PortaConversazione>();

  constructor(opzioni: OpzioniLavoriNelBrowser) {
    this.#o = opzioni;
  }

  /** Il proprietario ha deciso di un'azione nel browser, dalla chat della Home. Falso se non è di un lavoro nel browser. */
  decidiPermesso(idPermesso: string, decisione: DecisionePermesso): boolean {
    const porta = this.#permessi.get(idPermesso);
    if (porta === undefined) return false;
    this.#permessi.delete(idPermesso);
    return porta.decidiPermesso(idPermesso, decisione);
  }

  /**
   * Fa il compito nel Chrome dell'ambiente indicato per nome. `pubblica` mette nella chat della Home
   * da cui parte il lavoro le richieste di consenso. Non lancia: l'esito dice com'è andata.
   */
  async esegui(nomeAmbiente: string, compito: string, pubblica: (evento: EventoConversazione) => void): Promise<EsitoStrumento> {
    const tutti = this.#o.ambienti.stato().ambienti;
    const cercato = nomeAmbiente.trim().toLowerCase();
    const ambiente = tutti.find((uno) => uno.nome.trim().toLowerCase() === cercato);
    const conChrome = tutti.filter((uno) => uno.attivo && uno.browserDelPc === true && uno.chrome?.estensione === true).map((uno) => `"${uno.nome}"`);
    const dove = conChrome.length === 0 ? "Nessun ambiente ha adesso Chrome acceso per Claude: il proprietario lo accende dalla pagina Ambienti." : `Hanno Chrome acceso: ${conChrome.join(", ")}.`;
    if (ambiente === undefined) return { testo: `Nessun ambiente si chiama "${nomeAmbiente}". ${dove}`, errore: true };
    if (!ambiente.attivo) return { testo: `L'ambiente "${ambiente.nome}" è spento. ${dove}`, errore: true };
    if (ambiente.chrome === undefined || !ambiente.chrome.chrome) return { testo: `In "${ambiente.nome}" Chrome non c'è, o il nodo non lo sa dire. ${dove}`, errore: true };
    if (!ambiente.chrome.estensione) return { testo: `In "${ambiente.nome}" manca l'estensione Claude in Chrome: il proprietario la installa dal Chrome Web Store.`, errore: true };
    if (ambiente.browserDelPc !== true) return { testo: `In "${ambiente.nome}" il proprietario non ha acceso Chrome per Claude: lo fa dalla pagina Ambienti. ${dove}`, errore: true };

    const idConversazione = conversazioneNelBrowser(randomUUID());
    const miei = new Set<string>();
    let risultato = "";
    const errori: string[] = [];
    let finito!: (esito: EsitoStrumento) => void;
    const fine = new Promise<EsitoStrumento>((risolvi) => (finito = risolvi));
    let porta: PortaConversazione | undefined;
    const alEvento = (evento: EventoConversazione): void => {
      switch (evento.tipo) {
        case "permesso-richiesto":
          if (porta !== undefined) this.#permessi.set(evento.idPermesso, porta);
          miei.add(evento.idPermesso);
          pubblica({ ...evento, motivo: `Nel Chrome di «${ambiente.nome}», per la Home.${evento.motivo === undefined ? "" : ` ${evento.motivo}`}` });
          return;
        case "permesso-deciso":
          this.#permessi.delete(evento.idPermesso);
          miei.delete(evento.idPermesso);
          pubblica(evento);
          return;
        case "domande-poste":
          // Il lavoro nel browser non fa domande: se ne fa, non c'è chi risponda, e si va avanti senza.
          porta?.rispondiDomande?.(evento.idDomande, { tipo: "saltate" });
          return;
        case "testo-concluso":
          risultato = evento.testo;
          return;
        case "errore":
          errori.push(evento.messaggio);
          return;
        case "turno-concluso":
          finito(
            evento.riuscito
              ? { testo: `Fatto nel Chrome di «${ambiente.nome}».\n\n${(risultato || "Il lavoro è finito senza un resoconto.").slice(0, RISULTATO_MASSIMO)}` }
              : { testo: `Il lavoro nel Chrome di «${ambiente.nome}» non è riuscito.${errori.length === 0 ? "" : ` ${errori.join(" ")}`}${risultato === "" ? "" : `\n\n${risultato.slice(0, RISULTATO_MASSIMO)}`}`, errore: true },
          );
          return;
        default:
          return;
      }
    };
    try {
      porta = this.#o.esecutore(ambiente.id).apriConversazione(idConversazione, ambiente.radiceProgetti, () => undefined, () => IMPOSTAZIONI, alEvento, () => {}, () => []);
      porta.invia(compito);
    } catch (errore) {
      return { testo: `Il lavoro nel Chrome di «${ambiente.nome}» non è partito: ${errore instanceof Error ? errore.message : String(errore)}`, errore: true };
    }
    const scadenza = setTimeout(() => {
      void porta?.interrompi().catch(() => {});
      finito({ testo: `Il lavoro nel Chrome di «${ambiente.nome}» è durato troppo, e si è fermato.${risultato === "" ? "" : `\n\n${risultato.slice(0, RISULTATO_MASSIMO)}`}`, errore: true });
    }, this.#o.durataMs ?? DURATA_MASSIMA_MS);
    scadenza.unref();
    try {
      return await fine;
    } finally {
      clearTimeout(scadenza);
      // Ciò che aspettava il proprietario non vale più: nella chat della Home si chiude.
      for (const idPermesso of miei) {
        this.#permessi.delete(idPermesso);
        pubblica({ tipo: "permesso-deciso", idPermesso, decisione: "negato" });
      }
      porta.chiudi();
    }
  }
}
