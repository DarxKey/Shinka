/**
 * Chi esegue davvero il lavoro di un progetto, a seconda dell'ambiente in cui vive:
 * il centro stesso, per l'ambiente in cui gira, oppure un nodo collegato.
 * Il resto del centro li usa allo stesso modo.
 */

import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { elencaFile, eseguiAzione, eseguiAzioneInCartella } from "../nodo/azioni.ts";
import { adottaCartella, creaCartellaProgetto, type CartellaCreata } from "../nodo/cartelle.ts";
import type { ConfigurazioneConversazione } from "../nodo/conversazione.ts";
import { apriConversazione, motorePredefinito } from "../nodo/motore.ts";
import { soloLeScelte, type FonteEstensioni } from "../nodo/estensioni.ts";
import { preparaProgetto } from "../nodo/preparazione.ts";
import { soloIModelliScelti, type FonteModelliLocali } from "../nodo/modelli-locali.ts";
import { DURATA_PREPARAZIONE_MS, type EsitoPreparazione, type PreparazioneDelProgetto } from "../protocollo/avvio-progetto.ts";
import { configurazioneDiProgetto } from "../nodo/profili.ts";
import { eIncarico } from "../protocollo/incarichi.ts";
import { USCITA_MOSTRATA } from "../protocollo/attivita.ts";
import {
  leggiEsitoAnnullamento,
  leggiVersioni,
  nomeDiCartella,
  type EsitoAnnullamento,
  type RichiestaAllaConversazione,
  type VersioniDiUnFile,
} from "../protocollo/modifiche.ts";
import type {
  DecisionePermesso,
  EventoConversazione,
  AnteprimaRiavvolgimento,
  PortaConversazione,
  RispostaAParte,
  UscitaAttivita,
  RispostaAlleDomande,
} from "../protocollo/eventi.ts";
import type { Allegato } from "../protocollo/allegati.ts";
import {
  CARTELLA_HOME,
  DURATA_COMANDO_MS,
  type AzioneInAmbiente,
  type ElencoFile,
  type EsitoAzione,
  type OrigineFile,
} from "../protocollo/azioni.ts";
import type { ImpostazioniConversazione } from "../protocollo/impostazioni.ts";
import type { ComandoPerNodo, RiferitoDalNodo } from "../protocollo/nodi.ts";
import { eStrumentoComune, type EsitoStrumento } from "../protocollo/strumenti.ts";
import type { RegistroAmbienti } from "./ambienti.ts";

/** Il progetto non può lavorare perché il suo ambiente non è attivo. */
export class AmbienteSpento extends Error {
  constructor() {
    super("L'ambiente è spento.");
  }
}

export interface Esecutore {
  /**
   * Crea la cartella di un progetto nuovo. Con un'origine, il progetto nasce con una copia
   * dei file che quell'argomento della Home ha in questo ambiente.
   */
  creaCartella(nomeCartella: string, brief: string, origine?: OrigineFile): Promise<CartellaCreata>;
  /**
   * Prende come cartella di un progetto una cartella che esiste già, senza toccarla. Lancia se
   * non c'è o non è una cartella; `git` dice se è già un repository.
   */
  adottaCartella(percorso: string): Promise<CartellaCreata & { git: boolean }>;
  /** I file che un argomento della Home ha in questo ambiente. Lancia `AmbienteSpento` se non può. */
  elencaFile(origine: OrigineFile): Promise<ElencoFile>;
  /** Compie un'azione della Home nella cartella di un suo argomento. Lancia `AmbienteSpento` se non può. */
  agisci(idArgomento: string, azione: AzioneInAmbiente): Promise<EsitoAzione>;
  /** Compie un'azione di un progetto in una sua cartella collegata, in questo ambiente (ADR 0050). */
  agisciInCartella(cartella: string, azione: AzioneInAmbiente): Promise<EsitoAzione>;
  /**
   * Prepara la cartella di un progetto nuovo per le estensioni scelte, prima del primo messaggio.
   * Lancia se l'ambiente non risponde; ogni esito dice com'è andata una preparazione.
   */
  preparaProgetto?(cartella: string, preparazioni: PreparazioneDelProgetto[]): Promise<EsitoPreparazione[]>;
  /** Apre la conversazione di un progetto nella sua cartella. */
  apriConversazione(
    idConversazione: string,
    cartella: string,
    /** Da dove riprendere, chiesto nel momento in cui serve. */
    idSessione: () => string | undefined,
    /** Modello, impegno e permessi scelti dal proprietario, chiesti nel momento in cui servono. */
    impostazioni: () => ImpostazioniConversazione,
    alEvento: (evento: EventoConversazione) => void,
    alIdSessione: (id: string) => void,
    /**
     * Le estensioni scelte per il progetto, tra quelle accese nell'ambiente, chieste quando il
     * processo parte. Senza, o se restituisce undefined, le ha tutte.
     */
    estensioni?: () => readonly string[] | undefined,
  ): PortaConversazione;
}

/** Esegue uno strumento di Shinka per conto della conversazione di un progetto. */
export type StrumentoDiProgetto = (idConversazione: string, nome: unknown, argomenti: unknown) => Promise<EsitoStrumento>;

/** Ciò che Shinka offre alle conversazioni dei progetti dell'ambiente del centro. */
export interface ServiziLocali {
  strumento?: StrumentoDiProgetto;
  /** La cartella delle skill di Shinka, che al centro è il loro repository. */
  cartellaSkill?: string;
  /** Vero se quella conversazione è del progetto in cui si sviluppa Shinka stessa. */
  diShinka?(idConversazione: string): boolean;
  /** Le estensioni che Shinka ha acceso nell'ambiente del centro. */
  estensioni?: FonteEstensioni;
  /** Come si prepara la cartella di un progetto nuovo. Nei test se ne mette uno finto. */
  preparaProgetto?: typeof preparaProgetto;
  /** Dove tenere le modifiche dei turni, una cartella per progetto. Senza, restano in memoria. */
  cartellaModifiche?: string;
  /** I modelli locali accesi nell'ambiente del centro (ADR 0051). */
  modelliLocali?: FonteModelliLocali;
}

/** Esegue nell'ambiente in cui gira il centro. */
export class EsecutoreLocale implements Esecutore {
  readonly #radiceProgetti: string;
  readonly #apri: (configurazione: ConfigurazioneConversazione) => PortaConversazione;
  readonly #servizi: ServiziLocali;

  constructor(
    radiceProgetti: string,
    /** Come si apre una conversazione. Nei test se ne mette una finta. */
    apri: (configurazione: ConfigurazioneConversazione) => PortaConversazione = (configurazione) =>
      apriConversazione(configurazione),
    servizi: ServiziLocali = {},
  ) {
    this.#radiceProgetti = radiceProgetti;
    this.#apri = apri;
    this.#servizi = servizi;
  }

  creaCartella(nomeCartella: string, brief: string, origine?: OrigineFile): Promise<CartellaCreata> {
    return creaCartellaProgetto(
      this.#radiceProgetti,
      nomeCartella,
      brief,
      origine === undefined ? undefined : this.#cartellaDi(origine),
    );
  }

  adottaCartella(percorso: string): Promise<CartellaCreata & { git: boolean }> {
    return adottaCartella(percorso);
  }

  elencaFile(origine: OrigineFile): Promise<ElencoFile> {
    return elencaFile(this.#cartellaDi(origine));
  }

  #cartellaDi(origine: OrigineFile): string {
    return origine.cartellaAlCentro ?? join(resolve(this.#radiceProgetti), CARTELLA_HOME, origine.idArgomento);
  }

  agisci(idArgomento: string, azione: AzioneInAmbiente): Promise<EsitoAzione> {
    return eseguiAzione(this.#radiceProgetti, idArgomento, azione);
  }

  agisciInCartella(cartella: string, azione: AzioneInAmbiente): Promise<EsitoAzione> {
    return eseguiAzioneInCartella(cartella, azione);
  }

  preparaProgetto(cartella: string, preparazioni: PreparazioneDelProgetto[]): Promise<EsitoPreparazione[]> {
    return (this.#servizi.preparaProgetto ?? preparaProgetto)(cartella, preparazioni);
  }

  apriConversazione(
    idConversazione: string,
    cartella: string,
    idSessione: () => string | undefined,
    impostazioni: () => ImpostazioniConversazione,
    alEvento: (evento: EventoConversazione) => void,
    alIdSessione: (id: string) => void,
    scelte?: () => readonly string[] | undefined,
  ): PortaConversazione {
    const { strumento, cartellaSkill, diShinka } = this.#servizi;
    const estensioni =
      this.#servizi.estensioni === undefined || scelte === undefined ? this.#servizi.estensioni : soloLeScelte(this.#servizi.estensioni, scelte);
    return this.#apri(
      configurazioneDiProgetto(cartella, idSessione(), impostazioni(), alEvento, alIdSessione, {
        ...(strumento === undefined ? {} : { chiama: (nome, argomenti) => strumento(idConversazione, nome, argomenti) }),
        ...(cartellaSkill === undefined ? {} : { cartellaSkill }),
        ...(estensioni === undefined ? {} : { estensioni }),
        ...(diShinka?.(idConversazione) === true ? { sviluppoDiShinka: true } : {}),
        ...(eIncarico(idConversazione) ? { incarico: true } : {}),
        // I modelli locali seguono le estensioni scelte per il progetto, come gli strumenti.
        ...(this.#servizi.modelliLocali === undefined
          ? {}
          : { modelliLocali: scelte === undefined ? this.#servizi.modelliLocali : soloIModelliScelti(this.#servizi.modelliLocali, scelte) }),
        ...(this.#servizi.cartellaModifiche === undefined ? {} : { cartellaModifiche: join(this.#servizi.cartellaModifiche, nomeDiCartella(idConversazione)) }),
      }),
    );
  }
}

/** Un motivo, se la risposta di un nodo è un motivo per cui qualcosa non si è fatto. */
function motivoDa(valore: unknown): { motivo: string } | undefined {
  if (typeof valore !== "object" || valore === null) return undefined;
  const { motivo } = valore as Record<string, unknown>;
  return typeof motivo === "string" ? { motivo: motivo.slice(0, 2000) } : undefined;
}

const ATTESA_CARTELLA_MS = 15_000;

/** Quanto si aspetta un riavvolgimento: l'ambiente può dover far partire la conversazione. */
const ATTESA_RIAVVOLGIMENTO_MS = 60_000;

/** Quanto si aspetta la risposta a una domanda a parte: un processo da far partire e una risposta da scrivere. */
const ATTESA_A_PARTE_MS = 180_000;

/** Quanto il centro aspetta l'esito di un'azione oltre il tempo concesso all'azione stessa. */
const MARGINE_AZIONE_MS = 15_000;

interface InAttesa<T> {
  idAmbiente: string;
  risolvi(valore: T): void;
  rifiuta(errore: Error): void;
  scadenza: NodeJS.Timeout;
}

type CartellaInAttesa = InAttesa<CartellaCreata>;

/** Esegue negli ambienti degli altri nodi, passando dal loro collegamento. */
export class EsecutoriRemoti {
  readonly #ambienti: RegistroAmbienti;
  readonly #attesaCartellaMs: number;
  readonly #margineAzioneMs: number;
  readonly #cartelle = new Map<string, CartellaInAttesa>();
  readonly #azioni = new Map<string, InAttesa<EsitoAzione>>();
  readonly #preparazioni = new Map<string, InAttesa<EsitoPreparazione[]> & { quante: number }>();
  readonly #riavvolgimenti = new Map<string, InAttesa<{ anteprima?: AnteprimaRiavvolgimento; motivo?: string }>>();
  readonly #domandeAParte = new Map<string, InAttesa<RispostaAParte>>();
  readonly #richiesteAlleConversazioni = new Map<string, InAttesa<unknown>>();
  readonly #conversazioni = new Map<string, ConversazioneRemota>();
  readonly #strumento: StrumentoDiProgetto | undefined;

  constructor(
    ambienti: RegistroAmbienti,
    attesaCartellaMs: number = ATTESA_CARTELLA_MS,
    margineAzioneMs: number = MARGINE_AZIONE_MS,
    /** Esegue gli strumenti di Shinka che le conversazioni degli altri ambienti chiedono al centro. */
    strumento?: StrumentoDiProgetto,
  ) {
    this.#strumento = strumento;
    this.#ambienti = ambienti;
    this.#attesaCartellaMs = attesaCartellaMs;
    this.#margineAzioneMs = margineAzioneMs;
    ambienti.iscriviRiferiti((idNodo, messaggio) => this.#riferito(idNodo, messaggio));
    ambienti.iscriviScollegamenti((idNodo) => this.#scollegato(idNodo));
  }

  /** L'esecutore di un ambiente. */
  per(idAmbiente: string): Esecutore {
    return {
      creaCartella: (nomeCartella, brief, origine) => this.#creaCartella(idAmbiente, nomeCartella, brief, origine),
      adottaCartella: async (percorso) => {
        const adottata = await this.#chiediCartella(
          idAmbiente,
          (idRichiesta) => ({ tipo: "adotta-cartella", idRichiesta, percorso }),
          "L'ambiente non ha risposto. Se il suo nodo è di una versione precedente non sa ancora adottare una cartella esistente: va aggiornato.",
        );
        // Un nodo che risponde senza dire se è un repository non ha guardato davvero.
        if (adottata.git === undefined) throw new Error("L'ambiente non ha detto com'è la cartella: il suo nodo va aggiornato.");
        return { ...adottata, git: adottata.git };
      },
      elencaFile: async (origine) => {
        const esito = await this.#agisci(idAmbiente, origine.idArgomento, { tipo: "elenca-file" });
        if (!esito.riuscita) throw new Error(esito.testo);
        const percorsi = esito.file ?? [];
        return { percorsi, quanti: esito.quantiFile ?? percorsi.length };
      },
      agisci: (idArgomento, azione) => this.#agisci(idAmbiente, idArgomento, azione),
      agisciInCartella: (cartella, azione) =>
        this.#chiediAzione(idAmbiente, azione, (idRichiesta) => ({ tipo: "azione-in-cartella", idRichiesta, cartella, azione }), "L'ambiente non ha risposto in tempo: se il suo nodo è di una versione precedente non sa ancora lavorare in una cartella collegata, e va aggiornato."),
      preparaProgetto: (cartella, preparazioni) => this.#preparaProgetto(idAmbiente, cartella, preparazioni),
      apriConversazione: (idConversazione, cartella, idSessione, impostazioni, alEvento, alIdSessione, estensioni) => {
        const conversazione = new ConversazioneRemota(
          this.#ambienti,
          idAmbiente,
          idConversazione,
          cartella,
          idSessione,
          impostazioni,
          alEvento,
          alIdSessione,
          estensioni,
          (comando) => this.#riavvolgi(idAmbiente, comando),
          (domanda) => this.#chiediAParte(idAmbiente, idConversazione, domanda),
          (richiesta) => this.#chiediAllaConversazione(idAmbiente, idConversazione, richiesta),
        );
        this.#conversazioni.set(idConversazione, conversazione);
        return conversazione;
      },
    };
  }

  #creaCartella(
    idAmbiente: string,
    nomeCartella: string,
    brief: string,
    origine: OrigineFile | undefined,
  ): Promise<CartellaCreata> {
    return this.#chiediCartella(
      idAmbiente,
      (idRichiesta) => ({
        tipo: "crea-cartella",
        idRichiesta,
        nomeCartella,
        brief,
        ...(origine === undefined ? {} : { daArgomento: origine.idArgomento }),
      }),
      "L'ambiente non ha risposto alla richiesta di creare la cartella.",
    );
  }

  /** Chiede al nodo di un ambiente una cartella, nuova o adottata, e ne aspetta la risposta. */
  #chiediCartella(
    idAmbiente: string,
    comando: (idRichiesta: string) => Extract<ComandoPerNodo, { tipo: "crea-cartella" | "adotta-cartella" }>,
    senzaRisposta: string,
  ): Promise<CartellaCreata> {
    return new Promise((risolvi, rifiuta) => {
      const idRichiesta = randomUUID();
      const scadenza = setTimeout(() => {
        this.#cartelle.delete(idRichiesta);
        rifiuta(new Error(senzaRisposta));
      }, this.#attesaCartellaMs);
      this.#cartelle.set(idRichiesta, { idAmbiente, risolvi, rifiuta, scadenza });
      const inviato = this.#ambienti.inviaAlNodo(idAmbiente, comando(idRichiesta));
      if (!inviato) {
        clearTimeout(scadenza);
        this.#cartelle.delete(idRichiesta);
        rifiuta(new AmbienteSpento());
      }
    });
  }

  /**
   * Chiede al nodo di preparare la cartella di un progetto. Il nodo dice subito che ha cominciato:
   * se non lo dice è di una versione che non sa farlo, e non lo si aspetta oltre.
   */
  #preparaProgetto(idAmbiente: string, cartella: string, preparazioni: PreparazioneDelProgetto[]): Promise<EsitoPreparazione[]> {
    return new Promise((risolvi, rifiuta) => {
      const idRichiesta = randomUUID();
      const scadenza = setTimeout(() => {
        this.#preparazioni.delete(idRichiesta);
        rifiuta(new Error("L'ambiente non ha risposto: se il suo nodo è di una versione precedente non sa ancora preparare un progetto, e va aggiornato."));
      }, this.#attesaCartellaMs);
      this.#preparazioni.set(idRichiesta, { idAmbiente, risolvi, rifiuta, scadenza, quante: preparazioni.length });
      const inviato = this.#ambienti.inviaAlNodo(idAmbiente, { tipo: "prepara-progetto", idRichiesta, cartella, preparazioni });
      if (!inviato) {
        clearTimeout(scadenza);
        this.#preparazioni.delete(idRichiesta);
        rifiuta(new AmbienteSpento());
      }
    });
  }

  /** Chiede al nodo di riprendere una conversazione da un messaggio, o soltanto che cosa cambierebbe. */
  #riavvolgi(
    idAmbiente: string,
    comando: (idRichiesta: string) => Extract<ComandoPerNodo, { tipo: "riavvolgi" }>,
  ): Promise<{ anteprima?: AnteprimaRiavvolgimento; motivo?: string }> {
    return new Promise((risolvi, rifiuta) => {
      const idRichiesta = randomUUID();
      const scadenza = setTimeout(() => {
        this.#riavvolgimenti.delete(idRichiesta);
        rifiuta(new Error("L'ambiente non ha risposto: se il suo nodo è di una versione precedente non sa ancora ripartire da un messaggio, e va aggiornato."));
      }, ATTESA_RIAVVOLGIMENTO_MS);
      this.#riavvolgimenti.set(idRichiesta, { idAmbiente, risolvi, rifiuta, scadenza });
      if (!this.#ambienti.inviaAlNodo(idAmbiente, comando(idRichiesta))) {
        clearTimeout(scadenza);
        this.#riavvolgimenti.delete(idRichiesta);
        rifiuta(new AmbienteSpento());
      }
    });
  }

  /** Chiede al nodo una domanda a parte su una conversazione: l'ambiente fa partire un processo apposta. */
  #chiediAParte(idAmbiente: string, idConversazione: string, domanda: string): Promise<RispostaAParte> {
    return new Promise((risolvi) => {
      const idRichiesta = randomUUID();
      const scadenza = setTimeout(() => {
        this.#domandeAParte.delete(idRichiesta);
        risolvi({ motivo: "L'ambiente non ha risposto in tempo: se il suo nodo è di una versione precedente non sa ancora rispondere a una domanda a parte, e va aggiornato." });
      }, ATTESA_A_PARTE_MS);
      this.#domandeAParte.set(idRichiesta, {
        idAmbiente,
        risolvi,
        rifiuta: (errore) => risolvi({ motivo: errore.message }),
        scadenza,
      });
      if (!this.#ambienti.inviaAlNodo(idAmbiente, { tipo: "a-parte", idRichiesta, idConversazione, domanda })) {
        clearTimeout(scadenza);
        this.#domandeAParte.delete(idRichiesta);
        risolvi({ motivo: new AmbienteSpento().message });
      }
    });
  }

  /** Chiede alla conversazione di un nodo le versioni di un file cambiato, o di riportare dei file indietro. */
  #chiediAllaConversazione(idAmbiente: string, idConversazione: string, richiesta: RichiestaAllaConversazione): Promise<unknown> {
    return new Promise((risolvi, rifiuta) => {
      const idRichiesta = randomUUID();
      const scadenza = setTimeout(() => {
        this.#richiesteAlleConversazioni.delete(idRichiesta);
        rifiuta(new Error("L'ambiente non ha risposto: se il suo nodo è di una versione precedente non tiene ancora le modifiche dei turni, e va aggiornato."));
      }, ATTESA_RIAVVOLGIMENTO_MS);
      this.#richiesteAlleConversazioni.set(idRichiesta, { idAmbiente, risolvi, rifiuta, scadenza });
      if (!this.#ambienti.inviaAlNodo(idAmbiente, { tipo: "alla-conversazione", idRichiesta, idConversazione, richiesta })) {
        clearTimeout(scadenza);
        this.#richiesteAlleConversazioni.delete(idRichiesta);
        rifiuta(new AmbienteSpento());
      }
    });
  }

  #agisci(idAmbiente: string, idArgomento: string, azione: AzioneInAmbiente): Promise<EsitoAzione> {
    return this.#chiediAzione(idAmbiente, azione, (idRichiesta) => ({ tipo: "azione", idRichiesta, idArgomento, azione }), "L'ambiente non ha risposto in tempo.");
  }

  #chiediAzione(
    idAmbiente: string,
    azione: AzioneInAmbiente,
    comando: (idRichiesta: string) => Extract<ComandoPerNodo, { tipo: "azione" | "azione-in-cartella" }>,
    seNonRisponde: string,
  ): Promise<EsitoAzione> {
    return new Promise((risolvi, rifiuta) => {
      const idRichiesta = randomUUID();
      const concesso = azione.tipo === "esegui" ? (azione.durataMs ?? DURATA_COMANDO_MS) : 0;
      const scadenza = setTimeout(() => {
        this.#azioni.delete(idRichiesta);
        rifiuta(new Error(seNonRisponde));
      }, concesso + this.#margineAzioneMs);
      this.#azioni.set(idRichiesta, { idAmbiente, risolvi, rifiuta, scadenza });
      const inviato = this.#ambienti.inviaAlNodo(idAmbiente, comando(idRichiesta));
      if (!inviato) {
        clearTimeout(scadenza);
        this.#azioni.delete(idRichiesta);
        rifiuta(new AmbienteSpento());
      }
    });
  }

  #riferito(idNodo: string, messaggio: RiferitoDalNodo): void {
    switch (messaggio.tipo) {
      case "azione-conclusa": {
        const inAttesa = this.#azioni.get(messaggio.idRichiesta);
        // Risponde solo l'ambiente a cui l'azione era stata chiesta.
        if (inAttesa === undefined || inAttesa.idAmbiente !== idNodo) return;
        this.#azioni.delete(messaggio.idRichiesta);
        clearTimeout(inAttesa.scadenza);
        inAttesa.risolvi(messaggio.esito);
        return;
      }
      case "risposta-della-conversazione": {
        const inAttesa = this.#richiesteAlleConversazioni.get(messaggio.idRichiesta);
        if (inAttesa === undefined || inAttesa.idAmbiente !== idNodo) return;
        this.#richiesteAlleConversazioni.delete(messaggio.idRichiesta);
        clearTimeout(inAttesa.scadenza);
        inAttesa.risolvi(messaggio.risposta);
        return;
      }
      case "a-parte-esito": {
        const inAttesa = this.#domandeAParte.get(messaggio.idRichiesta);
        if (inAttesa === undefined || inAttesa.idAmbiente !== idNodo) return;
        this.#domandeAParte.delete(messaggio.idRichiesta);
        clearTimeout(inAttesa.scadenza);
        inAttesa.risolvi(messaggio.risposta);
        return;
      }
      case "riavvolgimento-esito": {
        const inAttesa = this.#riavvolgimenti.get(messaggio.idRichiesta);
        if (inAttesa === undefined || inAttesa.idAmbiente !== idNodo) return;
        this.#riavvolgimenti.delete(messaggio.idRichiesta);
        clearTimeout(inAttesa.scadenza);
        inAttesa.risolvi({ ...(messaggio.anteprima === undefined ? {} : { anteprima: messaggio.anteprima }), ...(messaggio.motivo === undefined ? {} : { motivo: messaggio.motivo }) });
        return;
      }
      case "preparazione-cominciata": {
        const inAttesa = this.#preparazioni.get(messaggio.idRichiesta);
        if (inAttesa === undefined || inAttesa.idAmbiente !== idNodo) return;
        // Ha cominciato: ora si aspetta quanto possono durare le preparazioni.
        clearTimeout(inAttesa.scadenza);
        inAttesa.scadenza = setTimeout(() => {
          this.#preparazioni.delete(messaggio.idRichiesta);
          inAttesa.rifiuta(new Error("L'ambiente non ha finito di preparare il progetto in tempo."));
        }, inAttesa.quante * DURATA_PREPARAZIONE_MS + this.#margineAzioneMs);
        return;
      }
      case "progetto-preparato": {
        const inAttesa = this.#preparazioni.get(messaggio.idRichiesta);
        if (inAttesa === undefined || inAttesa.idAmbiente !== idNodo) return;
        this.#preparazioni.delete(messaggio.idRichiesta);
        clearTimeout(inAttesa.scadenza);
        inAttesa.risolvi(messaggio.esiti);
        return;
      }
      case "cartella-creata":
      case "cartella-non-creata": {
        const inAttesa = this.#cartelle.get(messaggio.idRichiesta);
        // Risponde solo l'ambiente a cui la cartella era stata chiesta.
        if (inAttesa === undefined || inAttesa.idAmbiente !== idNodo) return;
        this.#cartelle.delete(messaggio.idRichiesta);
        clearTimeout(inAttesa.scadenza);
        if (messaggio.tipo === "cartella-creata") {
          inAttesa.risolvi({
            percorso: messaggio.percorso,
            filePortati: messaggio.filePortati ?? 0,
            ...(messaggio.git === undefined ? {} : { git: messaggio.git }),
          });
        }
        else inAttesa.rifiuta(new Error(messaggio.motivo));
        return;
      }
      case "evento":
      case "id-sessione": {
        const conversazione = this.#conversazioni.get(messaggio.idConversazione);
        // Un nodo può riferire solo delle conversazioni del proprio ambiente.
        if (conversazione === undefined || conversazione.idAmbiente !== idNodo) return;
        if (messaggio.tipo === "evento") conversazione.ricevi(messaggio.evento);
        else conversazione.riceviIdSessione(messaggio.idSessione);
        return;
      }
      case "strumento":
        void this.#eseguiStrumento(idNodo, messaggio);
        return;
    }
  }

  async #eseguiStrumento(idNodo: string, richiesta: Extract<RiferitoDalNodo, { tipo: "strumento" }>): Promise<void> {
    const conversazione = this.#conversazioni.get(richiesta.idConversazione);
    let esito: EsitoStrumento;
    // Un nodo può usare gli strumenti solo per le conversazioni del proprio ambiente.
    if (conversazione === undefined || conversazione.idAmbiente !== idNodo) {
      esito = { testo: "Questa conversazione non è tra quelle di questo ambiente.", errore: true };
    } else if (this.#strumento === undefined || !eStrumentoComune(richiesta.nome)) {
      esito = { testo: "Questo strumento non esiste.", errore: true };
    } else {
      esito = await this.#strumento(richiesta.idConversazione, richiesta.nome, richiesta.argomenti);
    }
    this.#ambienti.inviaAlNodo(idNodo, { tipo: "esito-strumento", idRichiesta: richiesta.idRichiesta, ...esito });
  }

  #scollegato(idNodo: string): void {
    for (const [idRichiesta, inAttesa] of this.#richiesteAlleConversazioni) {
      if (inAttesa.idAmbiente !== idNodo) continue;
      this.#richiesteAlleConversazioni.delete(idRichiesta);
      clearTimeout(inAttesa.scadenza);
      inAttesa.rifiuta(new AmbienteSpento());
    }
    for (const [idRichiesta, inAttesa] of this.#domandeAParte) {
      if (inAttesa.idAmbiente !== idNodo) continue;
      this.#domandeAParte.delete(idRichiesta);
      clearTimeout(inAttesa.scadenza);
      inAttesa.rifiuta(new AmbienteSpento());
    }
    for (const [idRichiesta, inAttesa] of this.#riavvolgimenti) {
      if (inAttesa.idAmbiente !== idNodo) continue;
      this.#riavvolgimenti.delete(idRichiesta);
      clearTimeout(inAttesa.scadenza);
      inAttesa.rifiuta(new AmbienteSpento());
    }
    for (const [idRichiesta, inAttesa] of this.#preparazioni) {
      if (inAttesa.idAmbiente !== idNodo) continue;
      this.#preparazioni.delete(idRichiesta);
      clearTimeout(inAttesa.scadenza);
      inAttesa.rifiuta(new AmbienteSpento());
    }
    for (const [idRichiesta, inAttesa] of this.#cartelle) {
      if (inAttesa.idAmbiente !== idNodo) continue;
      this.#cartelle.delete(idRichiesta);
      clearTimeout(inAttesa.scadenza);
      inAttesa.rifiuta(new AmbienteSpento());
    }
    for (const [idRichiesta, inAttesa] of this.#azioni) {
      if (inAttesa.idAmbiente !== idNodo) continue;
      this.#azioni.delete(idRichiesta);
      clearTimeout(inAttesa.scadenza);
      inAttesa.rifiuta(new AmbienteSpento());
    }
    for (const conversazione of this.#conversazioni.values()) {
      if (conversazione.idAmbiente === idNodo) conversazione.caduta();
    }
  }
}

/** Una conversazione che gira in un altro ambiente, comandata attraverso il suo nodo. */
class ConversazioneRemota implements PortaConversazione {
  readonly idAmbiente: string;
  readonly #ambienti: RegistroAmbienti;
  readonly #idConversazione: string;
  readonly #cartella: string;
  readonly #idSessione: () => string | undefined;
  readonly #impostazioni: () => ImpostazioniConversazione;
  readonly #alEvento: (evento: EventoConversazione) => void;
  readonly #alIdSessione: (id: string) => void;
  readonly #estensioni: (() => readonly string[] | undefined) | undefined;
  readonly #riavvolgi: ((comando: (idRichiesta: string) => Extract<ComandoPerNodo, { tipo: "riavvolgi" }>) => Promise<{ anteprima?: AnteprimaRiavvolgimento; motivo?: string }>) | undefined;
  readonly #aParte: ((domanda: string) => Promise<RispostaAParte>) | undefined;
  readonly #allaConversazioneDelNodo: ((richiesta: RichiestaAllaConversazione) => Promise<unknown>) | undefined;
  /** Vero se il nodo, su questo collegamento, sa già di questa conversazione. */
  #aperta = false;
  readonly #permessiInAttesa = new Set<string>();
  readonly #domandeInAttesa = new Set<string>();

  constructor(
    ambienti: RegistroAmbienti,
    idAmbiente: string,
    idConversazione: string,
    cartella: string,
    idSessione: () => string | undefined,
    impostazioni: () => ImpostazioniConversazione,
    alEvento: (evento: EventoConversazione) => void,
    alIdSessione: (id: string) => void,
    estensioni?: () => readonly string[] | undefined,
    riavvolgi?: (comando: (idRichiesta: string) => Extract<ComandoPerNodo, { tipo: "riavvolgi" }>) => Promise<{ anteprima?: AnteprimaRiavvolgimento; motivo?: string }>,
    aParte?: (domanda: string) => Promise<RispostaAParte>,
    allaConversazione?: (richiesta: RichiestaAllaConversazione) => Promise<unknown>,
  ) {
    this.#allaConversazioneDelNodo = allaConversazione;
    this.#riavvolgi = riavvolgi;
    this.#aParte = aParte;
    this.#ambienti = ambienti;
    this.#impostazioni = impostazioni;
    this.#estensioni = estensioni;
    this.idAmbiente = idAmbiente;
    this.#idConversazione = idConversazione;
    this.#cartella = cartella;
    this.#idSessione = idSessione;
    this.#alEvento = alEvento;
    this.#alIdSessione = alIdSessione;
  }

  ricevi(evento: EventoConversazione): void {
    if (evento.tipo === "permesso-richiesto") this.#permessiInAttesa.add(evento.idPermesso);
    if (evento.tipo === "permesso-deciso") this.#permessiInAttesa.delete(evento.idPermesso);
    if (evento.tipo === "domande-poste") this.#domandeInAttesa.add(evento.idDomande);
    if (evento.tipo === "domande-chiuse") this.#domandeInAttesa.delete(evento.idDomande);
    this.#alEvento(evento);
  }

  riceviIdSessione(idSessione: string): void {
    this.#alIdSessione(idSessione);
  }

  /** Il nodo si è scollegato: al prossimo collegamento la conversazione andrà riaperta. */
  caduta(): void {
    this.#aperta = false;
    this.#permessiInAttesa.clear();
    this.#domandeInAttesa.clear();
  }

  prepara(): void {
    this.#apri();
  }

  invia(testo: string, allegati: Allegato[] = []): void {
    const inviato =
      this.#apri() &&
      this.#ambienti.inviaAlNodo(this.idAmbiente, {
        tipo: "messaggio",
        idConversazione: this.#idConversazione,
        testo,
        ...(allegati.length === 0 ? {} : { allegati }),
      });
    if (!inviato) throw new AmbienteSpento();
  }

  imposta(impostazioni: ImpostazioniConversazione): void {
    // Se il nodo non sa ancora di questa conversazione, le riceverà quando verrà aperta.
    if (!this.#aperta) return;
    this.#ambienti.inviaAlNodo(this.idAmbiente, {
      tipo: "imposta",
      idConversazione: this.#idConversazione,
      impostazioni,
    });
  }

  annota(testo: string): void {
    // Se l'ambiente è spento l'annotazione si perde: chi la manda la ripeterà quando serve.
    if (!this.#apri()) return;
    this.#ambienti.inviaAlNodo(this.idAmbiente, {
      tipo: "annota",
      idConversazione: this.#idConversazione,
      testo,
    });
  }

  istruisci(): void {
    // Né istruzioni di Shinka: quelle servono solo alla Home.
  }

  decidiPermesso(idPermesso: string, decisione: DecisionePermesso, sempre?: boolean): boolean {
    if (!this.#permessiInAttesa.has(idPermesso)) return false;
    return this.#ambienti.inviaAlNodo(this.idAmbiente, {
      tipo: "decidi-permesso",
      idConversazione: this.#idConversazione,
      idPermesso,
      decisione,
      ...(sempre === true ? { sempre: true as const } : {}),
    });
  }

  async anteprimaRiavvolgimento(idMessaggio: string): Promise<AnteprimaRiavvolgimento> {
    const esito = await this.#chiediRiavvolgimento(idMessaggio, true, false);
    return esito.anteprima ?? { motivo: esito.motivo ?? "L'ambiente non ha detto che cosa cambierebbe." };
  }

  async riprendiDa(idMessaggio: string, opzioni: { file: boolean }): Promise<string | undefined> {
    return (await this.#chiediRiavvolgimento(idMessaggio, false, opzioni.file)).motivo;
  }

  async #chiediRiavvolgimento(idMessaggio: string, prova: boolean, file: boolean): Promise<{ anteprima?: AnteprimaRiavvolgimento; motivo?: string }> {
    if (this.#riavvolgi === undefined || !this.#apri()) return { motivo: "L'ambiente del progetto è spento." };
    try {
      return await this.#riavvolgi((idRichiesta) => ({ tipo: "riavvolgi", idRichiesta, idConversazione: this.#idConversazione, idMessaggio, prova, file }));
    } catch (errore) {
      return { motivo: errore instanceof Error ? errore.message : String(errore) };
    }
  }

  async versioniModificate(idTurno: string, percorso: string): Promise<VersioniDiUnFile | { motivo: string }> {
    const risposta = await this.#chiediAllaConversazione({ tipo: "versioni", idTurno, percorso });
    if ("motivo" in risposta) return risposta;
    return leggiVersioni(risposta.valore) ?? motivoDa(risposta.valore) ?? { motivo: "L'ambiente ha risposto in un modo che non capisco." };
  }

  async annullaModifiche(idTurno: string, percorsi?: readonly string[]): Promise<EsitoAnnullamento | { motivo: string }> {
    const risposta = await this.#chiediAllaConversazione({ tipo: "annulla-modifiche", idTurno, ...(percorsi === undefined ? {} : { percorsi: [...percorsi] }) });
    if ("motivo" in risposta) return risposta;
    return motivoDa(risposta.valore) ?? leggiEsitoAnnullamento(risposta.valore) ?? { motivo: "L'ambiente ha risposto in un modo che non capisco." };
  }

  async uscitaAttivita(idAttivita: string): Promise<UscitaAttivita | { motivo: string }> {
    const risposta = await this.#chiediAllaConversazione({ tipo: "uscita-attivita", idAttivita });
    if ("motivo" in risposta) return risposta;
    const valore = risposta.valore as Record<string, unknown> | null;
    if (typeof valore === "object" && valore !== null && typeof valore.testo === "string") return { testo: valore.testo.slice(-USCITA_MOSTRATA), troncata: valore.troncata === true };
    return motivoDa(valore) ?? { motivo: "L'ambiente ha risposto in un modo che non capisco." };
  }

  async #chiediAllaConversazione(richiesta: RichiestaAllaConversazione): Promise<{ valore: unknown } | { motivo: string }> {
    if (this.#allaConversazioneDelNodo === undefined || !this.#apri()) return { motivo: "L'ambiente del progetto è spento." };
    try {
      return { valore: await this.#allaConversazioneDelNodo(richiesta) };
    } catch (errore) {
      return { motivo: errore instanceof Error ? errore.message : String(errore) };
    }
  }

  async chiediAParte(domanda: string): Promise<RispostaAParte> {
    if (this.#aParte === undefined || !this.#apri()) return { motivo: "L'ambiente del progetto è spento." };
    return this.#aParte(domanda);
  }

  rispondiDomande(idDomande: string, risposta: RispostaAlleDomande): boolean {
    if (!this.#domandeInAttesa.has(idDomande)) return false;
    return this.#ambienti.inviaAlNodo(this.idAmbiente, {
      tipo: "rispondi-domande",
      idConversazione: this.#idConversazione,
      idDomande,
      risposta,
    });
  }

  async interrompi(): Promise<void> {
    this.#ambienti.inviaAlNodo(this.idAmbiente, {
      tipo: "interrompi",
      idConversazione: this.#idConversazione,
    });
  }

  chiudi(): void {
    if (!this.#aperta) return;
    this.#aperta = false;
    this.#ambienti.inviaAlNodo(this.idAmbiente, {
      tipo: "chiudi-conversazione",
      idConversazione: this.#idConversazione,
    });
  }

  #apri(): boolean {
    if (this.#aperta) return true;
    const idSessione = this.#idSessione();
    const estensioni = this.#estensioni?.();
    this.#aperta = this.#ambienti.inviaAlNodo(this.idAmbiente, {
      tipo: "apri-conversazione",
      idConversazione: this.#idConversazione,
      cartella: this.#cartella,
      ...(idSessione === undefined ? {} : { idSessione }),
      impostazioni: this.#impostazioni(),
      ...(estensioni === undefined ? {} : { estensioni: [...estensioni] }),
      // Il predefinito è dell'installazione, cioè del centro: il nodo di un altro ambiente non lo sa.
      motorePredefinito: motorePredefinito(),
    });
    return this.#aperta;
  }
}
