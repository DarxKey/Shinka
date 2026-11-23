/**
 * Il lavoro sui progetti visto dal centro: per ogni progetto il suo canale e la sua
 * conversazione, ovunque essa giri, e la condizione in cui si trova.
 */

import { rm } from "node:fs/promises";
import { join } from "node:path";
import { IMPOSTAZIONI_DI_PROGETTO } from "../nodo/profili.ts";
import type { Allegato } from "../protocollo/allegati.ts";
import type { ElencoFile, OrigineFile } from "../protocollo/azioni.ts";
import { statoDelProgetto } from "./storia.ts";
import type {
  AnteprimaRiavvolgimento,
  DecisionePermesso,
  EventoArchiviato,
  PortaConversazione,
  RispostaAParte,
  RispostaAlleDomande,
  UscitaAttivita,
} from "../protocollo/eventi.ts";
import { nomeDiCartella, type EsitoAnnullamento, type VersioniDiUnFile } from "../protocollo/modifiche.ts";
import {
  applicaModifica,
  type ImpostazioniConversazione,
  type ModificaImpostazioni,
} from "../protocollo/impostazioni.ts";
import {
  nomeCartellaDa,
  type CondizioneProgetto,
  type Progetto,
  type StatoProgetti,
} from "../protocollo/progetti.ts";
import {
  primoMessaggio,
  type EsitoPreparazione,
  type PreparazioneDelProgetto,
  type SkillDiPartenza,
} from "../protocollo/avvio-progetto.ts";
import { ID_AMBIENTE_DEL_CENTRO, type RegistroAmbienti } from "./ambienti.ts";
import { Canale } from "./canale.ts";
import { fileDellaVersione } from "./indice-archivio.ts";
import { AmbienteSpento, type Esecutore } from "./esecutori.ts";
import type { CustodiaImmagini } from "./immagini.ts";
import type { NuovoProgetto, RegistroProgetti } from "./progetti.ts";

/** Un progetto appena nato. `filePortati` c'è se doveva portare con sé i file di un argomento. */
export interface ProgettoNato extends Progetto {
  filePortati?: number;
  /** Presente se il progetto ha adottato una cartella esistente: dice se era già un repository Git. */
  adottata?: { git: boolean };
}

/** Come comincia un progetto nuovo, secondo le scelte fatte nella scheda della proposta. */
export interface AvvioDelProgetto {
  /** Le estensioni scelte, tra quelle accese nell'ambiente; senza, il progetto le ha tutte. */
  estensioni?: string[];
  /** La skill con cui comincia il primo messaggio; senza, il primo messaggio è il brief. */
  skillDiPartenza?: SkillDiPartenza;
  /** Ciò che va fatto nella cartella prima del primo messaggio, per le estensioni scelte. */
  preparazioni?: PreparazioneDelProgetto[];
}

/** Una cartella esistente controllata nel suo ambiente, prima di farne un progetto. */
export interface CartellaControllata {
  percorso: string;
  git: boolean;
}

/** Il progetto non può nascere, e il messaggio dice perché in parole per il proprietario. */
export class ProgettoNonCreato extends Error {}

export interface OpzioniLavori {
  progetti: RegistroProgetti;
  ambienti: RegistroAmbienti;
  /** Cartella in cui il centro archivia le conversazioni dei progetti. */
  cartellaConversazioni: string;
  /** Dove il centro tiene le modifiche dei turni dei progetti del suo ambiente, una cartella per progetto: con il progetto se ne vanno. */
  cartellaModifiche?: string;
  /** Dove finiscono le immagini che arrivano con gli eventi delle conversazioni. */
  immagini: CustodiaImmagini;
  /** Chi esegue nell'ambiente del centro. */
  locale: Esecutore;
  /** Chi esegue negli altri ambienti. */
  remoti: { per(idAmbiente: string): Esecutore };
  /**
   * Ciò che la conversazione di un progetto deve sapere prima del prossimo messaggio del
   * proprietario, se c'è: è così che le arriva la memoria.
   */
  notaPrimaDelMessaggio?(idProgetto: string): string | undefined;
}

export class LavoriDeiProgetti {
  /** Le impostazioni scelte per un lavoro solo, finché quel lavoro non finisce. */
  readonly #perQuestoLavoro = new Map<string, ImpostazioniConversazione>();
  readonly #o: OpzioniLavori;
  readonly #canali = new Map<string, Canale>();
  readonly #porte = new Map<string, PortaConversazione>();
  readonly #ascoltatori = new Set<(stato: StatoProgetti) => void>();
  /** Chi ascolta gli eventi nuovi di ogni progetto, anche di quelli che nasceranno. */
  readonly #ascoltatoriDegliEventi = new Set<(idProgetto: string, archiviato: EventoArchiviato) => void>();

  private constructor(opzioni: OpzioniLavori) {
    this.#o = opzioni;
  }

  static async apri(opzioni: OpzioniLavori): Promise<LavoriDeiProgetti> {
    const lavori = new LavoriDeiProgetti(opzioni);
    for (const progetto of opzioni.progetti.elenco()) await lavori.#apriCanale(progetto.id);
    opzioni.progetti.iscrivi(() => lavori.#avvisa());
    opzioni.ambienti.iscrivi(() => lavori.#avvisa());
    opzioni.ambienti.iscriviScollegamenti((idAmbiente) => lavori.#ambienteScollegato(idAmbiente));
    return lavori;
  }

  /**
   * Fa nascere un progetto: cartella nuova nell'ambiente scelto e conversazione
   * che parte con il solo brief. Con un'origine, nella cartella finisce anche una copia
   * dei file che quell'argomento della Home ha nello stesso ambiente.
   */
  async crea(
    nome: string,
    idAmbiente: string,
    brief: string,
    origine?: OrigineFile,
    /** Il percorso completo di una cartella che esiste già: il progetto nasce lì, senza toccarla. */
    cartellaEsistente?: string,
    /** Modello, effort e permessi scelti dal proprietario nella scheda: le impostazioni con cui il progetto nasce. */
    impostazioni?: ModificaImpostazioni,
    /** Estensioni, skill di partenza e preparazioni scelte nella scheda. */
    avvio: AvvioDelProgetto = {},
  ): Promise<ProgettoNato> {
    const estensioni = avvio.estensioni === undefined ? {} : { estensioni: avvio.estensioni };
    // Le scelte valgono dal primo messaggio: si salvano prima che la conversazione parta.
    const ricordaLeScelte = async (idProgetto: string): Promise<void> => {
      if (impostazioni === undefined || Object.keys(impostazioni).length === 0) return;
      await this.#o.progetti.ricordaImpostazioni(idProgetto, applicaModifica(IMPOSTAZIONI_DI_PROGETTO, impostazioni));
    };
    const nomePulito = nome.trim();
    if (nomePulito === "" || nomePulito.length > 60) {
      throw new ProgettoNonCreato("Il nome del progetto deve avere da 1 a 60 caratteri.");
    }
    if (brief.trim() === "") throw new ProgettoNonCreato("Il brief del progetto è vuoto.");
    const esiste = this.#o.ambienti.stato().ambienti.some((ambiente) => ambiente.id === idAmbiente);
    if (!esiste || !this.#o.ambienti.attivo(idAmbiente)) {
      throw new ProgettoNonCreato("L'ambiente scelto non è attivo: scegline un altro.");
    }

    if (cartellaEsistente !== undefined) {
      const adottata = await this.controllaCartella(idAmbiente, cartellaEsistente);
      const progetto = await this.#o.progetti.crea({ nome: nomePulito, cartella: adottata.percorso, idAmbiente, brief, ...estensioni });
      await ricordaLeScelte(progetto.id);
      await this.#apriCanale(progetto.id);
      // Chi comincia il lavoro deve sapere che la cartella è del proprietario, con quello che contiene.
      const avviso =
        "\n\n[Shinka] Questo progetto lavora in una cartella che esisteva già, con il suo contenuto: guardala prima di cominciare, " +
        "e non cancellare, spostare o riorganizzare ciò che c'è senza chiederlo al proprietario." +
        (adottata.git
          ? ""
          : " La cartella non è un repository Git, e Shinka non l'ha inizializzato: se serve, proponilo al proprietario e fallo solo con il suo sì.");
      this.#comincia(progetto, brief.trim() + avviso, avvio);
      return { ...progetto, adottata: { git: adottata.git } };
    }

    let cartella: string;
    let filePortati: number;
    try {
      const creata = await this.#esecutore(idAmbiente).creaCartella(nomeCartellaDa(nomePulito), brief, origine);
      cartella = creata.percorso;
      filePortati = creata.filePortati;
    } catch (errore) {
      throw new ProgettoNonCreato(errore instanceof Error ? errore.message : String(errore));
    }
    const progetto = await this.#o.progetti.crea({ nome: nomePulito, cartella, idAmbiente, brief, ...estensioni });
    await ricordaLeScelte(progetto.id);
    await this.#apriCanale(progetto.id);
    // Chi comincia il lavoro deve sapere che nella cartella c'è già qualcosa, e da dove viene.
    const giaPresenti =
      filePortati === 0
        ? ""
        : `\n\n[Shinka] Questo progetto nasce da un lavoro cominciato nella Home: nella cartella ${
            filePortati === 1 ? "c'è già un file prodotto lì" : `ci sono già ${filePortati} file prodotti lì`
          }. Guardali prima di cominciare, e parti da quelli.`;
    this.#comincia(progetto, brief.trim() + giaPresenti, avvio);
    return origine === undefined ? progetto : { ...progetto, filePortati };
  }

  /**
   * Il primo messaggio di un progetto nuovo. Se la sua cartella va preparata, il messaggio parte
   * dopo, e la chat del progetto dice intanto che cosa succede: il progetto nasce subito.
   */
  #comincia(progetto: Progetto, testo: string, avvio: AvvioDelProgetto): void {
    const preparazioni = avvio.preparazioni ?? [];
    if (preparazioni.length === 0) {
      this.invia(progetto.id, primoMessaggio(testo, avvio.skillDiPartenza));
      return;
    }
    void this.#preparaEComincia(progetto, testo, avvio, preparazioni);
  }

  async #preparaEComincia(
    progetto: Progetto,
    testo: string,
    avvio: AvvioDelProgetto,
    preparazioni: PreparazioneDelProgetto[],
  ): Promise<void> {
    const canale = this.#canali.get(progetto.id);
    canale?.pubblica({ tipo: "nota", testo: "CodeGraph costruisce l'indice del codice nella cartella del progetto: il lavoro comincia appena è pronto." });
    const esecutore = this.#esecutore(progetto.idAmbiente);
    let esiti: EsitoPreparazione[];
    try {
      if (esecutore.preparaProgetto === undefined) throw new Error("Questo ambiente non sa preparare un progetto.");
      esiti = await esecutore.preparaProgetto(progetto.cartella, preparazioni);
    } catch (errore) {
      const motivo = errore instanceof Error ? errore.message : String(errore);
      esiti = preparazioni.map((una) => ({ tipo: una.tipo, riuscita: false, testo: motivo }));
    }
    let perClaude = "";
    for (const esito of esiti) {
      canale?.pubblica({
        tipo: "nota",
        testo: esito.riuscita
          ? "L'indice di CodeGraph è pronto, in .codegraph/ nella cartella del progetto."
          : `L'indice di CodeGraph non si è potuto costruire: ${ultimaRiga(esito.testo)}`,
      });
      perClaude += esito.riuscita
        ? "\n\n[Shinka] CodeGraph è acceso per questo progetto, e Shinka ne ha già costruito l'indice in .codegraph/: usalo per esplorare il codice."
        : "\n\n[Shinka] CodeGraph è acceso per questo progetto, ma Shinka non è riuscita a costruirne l'indice. " +
          "Quando ti serve, proponi al proprietario di lanciare `codegraph init -y` nella cartella del progetto.";
    }
    try {
      this.invia(progetto.id, primoMessaggio(testo + perClaude, avvio.skillDiPartenza));
    } catch (errore) {
      canale?.pubblica({
        tipo: "errore",
        messaggio: `Il primo messaggio non è partito: ${errore instanceof Error ? errore.message : String(errore)} Scrivilo tu quando l'ambiente è attivo.`,
      });
    }
  }

  /**
   * Prende come progetto una cartella che c'è già: la registra e le apre l'archivio, senza
   * creare nulla e senza mandare un primo messaggio. È così che nasce il progetto Shinka.
   */
  async adotta(nuovo: NuovoProgetto): Promise<Progetto> {
    const progetto = await this.#o.progetti.crea(nuovo);
    await this.#apriCanale(progetto.id);
    this.#avvisa();
    return progetto;
  }

  /**
   * Controlla una cartella esistente che il proprietario vuole come progetto: che ci sia, nel suo
   * ambiente, e che non sia già di un altro progetto, né dentro uno né attorno a uno. Non la tocca.
   * Lancia `ProgettoNonCreato` con il motivo.
   */
  async controllaCartella(idAmbiente: string, percorso: string): Promise<CartellaControllata> {
    const indicato = percorso.trim();
    if (indicato === "") throw new ProgettoNonCreato("Manca il percorso della cartella.");
    if (!this.#o.ambienti.attivo(idAmbiente)) {
      throw new ProgettoNonCreato("L'ambiente scelto non è attivo: scegline un altro.");
    }
    this.#nessunAltroProgetto(idAmbiente, indicato);
    let adottata: CartellaControllata;
    try {
      adottata = await this.#esecutore(idAmbiente).adottaCartella(indicato);
    } catch (errore) {
      throw new ProgettoNonCreato(errore instanceof Error ? errore.message : String(errore));
    }
    // Sul disco il percorso può essere scritto in un altro modo: si controlla anche quello.
    this.#nessunAltroProgetto(idAmbiente, adottata.percorso);
    return { percorso: adottata.percorso, git: adottata.git };
  }

  #nessunAltroProgetto(idAmbiente: string, percorso: string): void {
    const questo = confrontabile(percorso);
    for (const altro of this.#o.progetti.elenco()) {
      if (altro.idAmbiente !== idAmbiente) continue;
      const suo = confrontabile(altro.cartella);
      if (questo === suo) {
        throw new ProgettoNonCreato(`La cartella ${percorso} è già del progetto «${altro.nome}».`);
      }
      if (questo.startsWith(`${suo}/`) || suo.startsWith(`${questo}/`)) {
        throw new ProgettoNonCreato(
          `La cartella ${percorso} ${questo.startsWith(`${suo}/`) ? "sta dentro" : "contiene"} quella del progetto «${altro.nome}» (${altro.cartella}).`,
        );
      }
    }
  }

  /** I file che un argomento della Home ha in un ambiente. Lancia `AmbienteSpento` se non è attivo. */
  elencaFile(idAmbiente: string, origine: OrigineFile): Promise<ElencoFile> {
    if (!this.#o.ambienti.attivo(idAmbiente)) return Promise.reject(new AmbienteSpento());
    return this.#esecutore(idAmbiente).elencaFile(origine);
  }

  canale(idProgetto: string): Canale | undefined {
    return this.#canali.get(idProgetto);
  }

  /** Il proprietario ha aperto il progetto: prepara la conversazione, se il suo ambiente è attivo. */
  prepara(idProgetto: string): void {
    const progetto = this.#o.progetti.trova(idProgetto);
    if (progetto !== undefined && this.#o.ambienti.attivo(progetto.idAmbiente)) {
      this.#porta(progetto).prepara();
    }
  }

  /** Manda un messaggio alla conversazione del progetto. Lancia `AmbienteSpento` se non può. */
  invia(
    idProgetto: string,
    testo: string,
    allegati: Allegato[] = [],
    /**
     * Impostazioni solo per il lavoro che questo messaggio comincia: valgono finché il progetto ha
     * turni aperti, poi tornano quelle salvate, che non cambiano.
     */
    perQuestoLavoro?: ModificaImpostazioni,
  ): void {
    const progetto = this.#o.progetti.trova(idProgetto);
    if (progetto === undefined) throw new Error("Progetto non trovato.");
    if (!this.#o.ambienti.attivo(progetto.idAmbiente)) throw new AmbienteSpento();
    const porta = this.#porta(progetto);
    if (perQuestoLavoro !== undefined) {
      const temporanee = applicaModifica(this.impostazioni(idProgetto), perQuestoLavoro);
      this.#perQuestoLavoro.set(idProgetto, temporanee);
      porta.imposta(temporanee);
      this.#canali.get(idProgetto)?.pubblica({ tipo: "impostazioni", impostazioni: temporanee });
    }
    const nota = this.#o.notaPrimaDelMessaggio?.(progetto.id);
    if (nota !== undefined) porta.annota(nota);
    porta.invia(testo, allegati);
  }

  /** Le skill di Shinka sono cambiate: le conversazioni aperte nell'ambiente del centro le rileggono. */
  ricaricaSkill(): void {
    for (const porta of this.#porte.values()) porta.ricaricaSkill?.();
  }

  /** Le estensioni accese nell'ambiente del centro sono cambiate: le conversazioni aperte lì ripartono con quelle nuove. */
  ricaricaEstensioni(): void {
    for (const porta of this.#porte.values()) porta.ricaricaEstensioni?.();
  }

  /** Le impostazioni salvate di un progetto: quelle con cui lavora quando non c'è una scelta per un lavoro solo. */
  impostazioni(idProgetto: string): ImpostazioniConversazione {
    return this.#o.progetti.impostazioni(idProgetto) ?? IMPOSTAZIONI_DI_PROGETTO;
  }

  /** Le impostazioni con cui il progetto lavora adesso: quelle di un lavoro solo, se ce ne sono. */
  impostazioniInUso(idProgetto: string): ImpostazioniConversazione {
    return this.#perQuestoLavoro.get(idProgetto) ?? this.impostazioni(idProgetto);
  }

  /** Finito il lavoro, tornano le impostazioni salvate. */
  #tornaAlleSalvate(idProgetto: string): void {
    if (!this.#perQuestoLavoro.delete(idProgetto)) return;
    const salvate = this.impostazioni(idProgetto);
    this.#porte.get(idProgetto)?.imposta(salvate);
    this.#canali.get(idProgetto)?.pubblica({ tipo: "impostazioni", impostazioni: salvate });
  }

  /**
   * Il proprietario cambia modello, impegno o permessi di un progetto. La scelta resta salvata
   * e vale dal messaggio successivo. Nulla se il progetto non esiste.
   */
  async cambiaImpostazioni(
    idProgetto: string,
    modifica: ModificaImpostazioni,
  ): Promise<ImpostazioniConversazione | undefined> {
    const canale = this.#canali.get(idProgetto);
    if (canale === undefined || this.#o.progetti.trova(idProgetto) === undefined) return undefined;
    // Una scelta fatta a mano vale come scelta di sempre, anche durante un lavoro con impostazioni sue.
    this.#perQuestoLavoro.delete(idProgetto);
    const nuove = applicaModifica(this.impostazioni(idProgetto), modifica);
    await this.#o.progetti.ricordaImpostazioni(idProgetto, nuove);
    this.#porte.get(idProgetto)?.imposta(nuove);
    canale.pubblica({ tipo: "impostazioni", impostazioni: nuove });
    return nuove;
  }

  decidiPermesso(idProgetto: string, idPermesso: string, decisione: DecisionePermesso): boolean {
    return this.#porte.get(idProgetto)?.decidiPermesso(idPermesso, decisione) ?? false;
  }

  /** Quali file tornerebbero com'erano riprendendo da prima di quel messaggio. */
  async anteprimaRiavvolgimento(idProgetto: string, idMessaggio: string): Promise<AnteprimaRiavvolgimento> {
    const progetto = this.#o.progetti.trova(idProgetto);
    if (progetto === undefined) return { motivo: "Progetto non trovato." };
    if (!this.#o.ambienti.attivo(progetto.idAmbiente)) return { motivo: "L'ambiente del progetto è spento." };
    const porta = this.#porta(progetto);
    return porta.anteprimaRiavvolgimento?.(idMessaggio) ?? { motivo: "Questa conversazione non sa ripartire da un messaggio." };
  }

  /** Il proprietario modifica un suo messaggio: si riparte da prima di quello, e il testo nuovo parte. Il motivo, se non si può. */
  async modifica(idProgetto: string, idMessaggio: string, testo: string, opzioni: { file: boolean }): Promise<string | undefined> {
    const progetto = this.#o.progetti.trova(idProgetto);
    if (progetto === undefined) return "Progetto non trovato.";
    if (!this.#o.ambienti.attivo(progetto.idAmbiente)) return "L'ambiente del progetto è spento.";
    const porta = this.#porta(progetto);
    if (porta.riprendiDa === undefined) return "Questa conversazione non sa ripartire da un messaggio.";
    const motivo = await porta.riprendiDa(idMessaggio, opzioni);
    if (motivo !== undefined) return motivo;
    this.invia(idProgetto, testo);
    return undefined;
  }

  /** Com'era un file prima di un turno e com'è alla fine. */
  async versioniModificate(idProgetto: string, idTurno: string, percorso: string): Promise<VersioniDiUnFile | { motivo: string }> {
    const porta = this.#portaAttiva(idProgetto);
    if (typeof porta === "string") return { motivo: porta };
    return porta.versioniModificate?.(idTurno, percorso) ?? { motivo: "Questa conversazione non tiene le modifiche dei turni." };
  }

  /** Riporta a com'erano prima del turno i file indicati, o tutti quelli del turno. */
  async annullaModifiche(idProgetto: string, idTurno: string, percorsi?: readonly string[]): Promise<EsitoAnnullamento | { motivo: string }> {
    const porta = this.#portaAttiva(idProgetto);
    if (typeof porta === "string") return { motivo: porta };
    return porta.annullaModifiche?.(idTurno, percorsi) ?? { motivo: "Questa conversazione non tiene le modifiche dei turni." };
  }

  /** La conversazione di un progetto con l'ambiente acceso, o perché non c'è. */
  #portaAttiva(idProgetto: string): PortaConversazione | string {
    const progetto = this.#o.progetti.trova(idProgetto);
    if (progetto === undefined) return "Progetto non trovato.";
    if (!this.#o.ambienti.attivo(progetto.idAmbiente)) return "L'ambiente del progetto è spento.";
    return this.#porta(progetto);
  }

  /** La parte finale dell'uscita di un'attività del progetto. */
  async uscitaAttivita(idProgetto: string, idAttivita: string): Promise<UscitaAttivita | { motivo: string }> {
    const porta = this.#portaAttiva(idProgetto);
    if (typeof porta === "string") return { motivo: porta };
    return porta.uscitaAttivita?.(idAttivita) ?? { motivo: "Questa conversazione non tiene le attività." };
  }

  /** Una domanda a parte sulla conversazione del progetto: non vi resta. */
  async chiediAParte(idProgetto: string, domanda: string): Promise<RispostaAParte> {
    const progetto = this.#o.progetti.trova(idProgetto);
    if (progetto === undefined) return { motivo: "Progetto non trovato." };
    if (!this.#o.ambienti.attivo(progetto.idAmbiente)) return { motivo: "L'ambiente del progetto è spento." };
    const porta = this.#porta(progetto);
    return porta.chiediAParte?.(domanda) ?? { motivo: "Questa conversazione non sa rispondere a una domanda a parte." };
  }

  rispondiDomande(idProgetto: string, idDomande: string, risposta: RispostaAlleDomande): boolean {
    return this.#porte.get(idProgetto)?.rispondiDomande?.(idDomande, risposta) ?? false;
  }

  async interrompi(idProgetto: string): Promise<void> {
    await this.#porte.get(idProgetto)?.interrompi();
  }

  stato(): StatoProgetti {
    const ambienti = new Map(this.#o.ambienti.stato().ambienti.map((a) => [a.id, a]));
    return {
      progetti: this.#o.progetti.elenco().map((progetto) => ({
        ...progetto,
        nomeAmbiente: ambienti.get(progetto.idAmbiente)?.nome ?? "ambiente rimosso",
        condizione: this.#condizione(progetto),
        // Fin dove arriva il suo archivio: chi ne tiene una copia sa se gli manca qualcosa.
        ...this.#canali.get(progetto.id)?.indice,
      })),
    };
  }

  /** Collega un ascoltatore: riceve subito lo stato, poi ogni cambiamento. */
  iscrivi(ascoltatore: (stato: StatoProgetti) => void): () => void {
    ascoltatore(this.stato());
    this.#ascoltatori.add(ascoltatore);
    return () => this.#ascoltatori.delete(ascoltatore);
  }

  /**
   * Ascolta gli eventi nuovi di tutti i progetti senza guardarli: non riceve la storia, e non
   * conta come una pagina aperta.
   */
  ascolta(ascoltatore: (idProgetto: string, archiviato: EventoArchiviato) => void): () => void {
    this.#ascoltatoriDegliEventi.add(ascoltatore);
    return () => this.#ascoltatoriDegliEventi.delete(ascoltatore);
  }

  progetto(idProgetto: string): Progetto | undefined {
    return this.#o.progetti.trova(idProgetto);
  }

  /** Dove sta la storia di un progetto. */
  archivioDelProgetto(idProgetto: string): string {
    return join(this.#o.cartellaConversazioni, `${idProgetto}.jsonl`);
  }

  rinomina(idProgetto: string, nome: string): Promise<boolean> {
    return this.#o.progetti.rinomina(idProgetto, nome);
  }

  fissa(idProgetto: string, fissato: boolean): Promise<boolean> {
    return this.#o.progetti.fissa(idProgetto, fissato);
  }

  /**
   * Elimina un progetto da Shinka: la sua conversazione si chiude e il suo archivio si cancella, con
   * le immagini. La cartella con i file resta dov'è. Il progetto Shinka non si elimina. Il motivo,
   * se non si può.
   */
  async elimina(idProgetto: string): Promise<string | undefined> {
    const progetto = this.#o.progetti.trova(idProgetto);
    if (progetto === undefined) return "Progetto non trovato.";
    if (progetto.diShinka === true) return "Il progetto Shinka non si elimina: è quello in cui Shinka sviluppa sé stessa.";
    if ((this.#canali.get(idProgetto)?.sospesi.turni ?? 0) > 0) return "Il progetto sta lavorando: fermalo prima di eliminarlo.";
    this.#porte.get(idProgetto)?.chiudi();
    this.#porte.delete(idProgetto);
    this.#perQuestoLavoro.delete(idProgetto);
    this.#canali.delete(idProgetto);
    await this.#o.progetti.togli(idProgetto);
    await rm(join(this.#o.cartellaConversazioni, `${idProgetto}.jsonl`), { force: true });
    await rm(fileDellaVersione(join(this.#o.cartellaConversazioni, `${idProgetto}.jsonl`)), { force: true });
    await this.#o.immagini.dimentica(idProgetto);
    // Le versioni dei file e le loro fotografie, per i progetti dell'ambiente del centro; non deve fermare l'eliminazione.
    if (this.#o.cartellaModifiche !== undefined) {
      await rm(join(this.#o.cartellaModifiche, nomeDiCartella(idProgetto)), { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
    }
    return undefined;
  }

  /** Chiude le conversazioni aperte, per esempio allo spegnimento del centro. */
  chiudi(): void {
    for (const porta of this.#porte.values()) porta.chiudi();
    this.#porte.clear();
  }

  #condizione(progetto: Progetto): CondizioneProgetto {
    if (!this.#o.ambienti.attivo(progetto.idAmbiente)) return "ambiente-spento";
    const sospesi = this.#canali.get(progetto.id)?.sospesi;
    if (sospesi === undefined) return "fermo";
    if (sospesi.permessi > 0) return "aspetta-te";
    return sospesi.turni > 0 ? "al-lavoro" : "fermo";
  }

  #esecutore(idAmbiente: string): Esecutore {
    return idAmbiente === ID_AMBIENTE_DEL_CENTRO ? this.#o.locale : this.#o.remoti.per(idAmbiente);
  }

  #porta(progetto: Progetto): PortaConversazione {
    const esistente = this.#porte.get(progetto.id);
    if (esistente !== undefined) return esistente;
    const canale = this.#canali.get(progetto.id);
    if (canale === undefined) throw new Error("Il progetto non ha ancora il suo archivio.");
    const porta = this.#esecutore(progetto.idAmbiente).apriConversazione(
      progetto.id,
      progetto.cartella,
      () => this.#o.progetti.idSessione(progetto.id),
      () => this.impostazioniInUso(progetto.id),
      // Le immagini restano al centro come file: nell'archivio della conversazione va solo il loro nome.
      (evento) => {
        // Lo stato del progetto entra nella storia solo quando cambia: dopo un riavvio
        // chi lavora lo riferisce di nuovo, anche se è quello di prima.
        if (evento.tipo === "stato-progetto" && statoDelProgetto(canale.archiviati)?.testo === evento.testo) return;
        canale.pubblica(this.#o.immagini.prendi(progetto.id, evento));
      },
      (idSessione) => void this.#o.progetti.ricordaSessione(progetto.id, idSessione),
      () => this.#o.progetti.estensioni(progetto.id),
    );
    this.#porte.set(progetto.id, porta);
    return porta;
  }

  async #apriCanale(idProgetto: string): Promise<void> {
    if (this.#canali.has(idProgetto)) return;
    const canale = await Canale.apri(join(this.#o.cartellaConversazioni, `${idProgetto}.jsonl`));
    this.#canali.set(idProgetto, canale);
    // Chi apre il progetto deve sapere subito come è impostato.
    canale.pubblica({ tipo: "impostazioni", impostazioni: this.impostazioni(idProgetto) });
    // La condizione di un progetto cambia quando un turno o un permesso si apre o si chiude.
    canale.ascolta((archiviato) => {
      const { evento } = archiviato;
      // Un lavoro con impostazioni sue finisce quando il progetto non ha più turni aperti.
      if (evento.tipo === "turno-concluso" && canale.sospesi.turni === 0) this.#tornaAlleSalvate(idProgetto);
      for (const ascoltatore of this.#ascoltatoriDegliEventi) ascoltatore(idProgetto, archiviato);
      if (
        evento.tipo === "turno-iniziato" ||
        evento.tipo === "turno-concluso" ||
        evento.tipo === "permesso-richiesto" ||
        evento.tipo === "permesso-deciso" ||
        evento.tipo === "domande-poste" ||
        evento.tipo === "domande-chiuse" ||
        evento.tipo === "approvazione-richiesta" ||
        evento.tipo === "approvazione-decisa" ||
        evento.tipo === "installazione-richiesta" ||
        evento.tipo === "installazione-decisa"
      ) {
        this.#avvisa();
      }
    });
  }

  /** Un ambiente si è scollegato: ciò che vi era in corso non arriverà più a conclusione. */
  #ambienteScollegato(idAmbiente: string): void {
    for (const progetto of this.#o.progetti.elenco()) {
      if (progetto.idAmbiente !== idAmbiente) continue;
      this.#canali
        .get(progetto.id)
        ?.chiudiSospesi("L'ambiente si è scollegato mentre Claude stava lavorando.");
    }
  }

  #avvisa(): void {
    const stato = this.stato();
    for (const ascoltatore of this.#ascoltatori) ascoltatore(stato);
  }
}

/** L'ultima riga non vuota di un'uscita: di solito dice che cosa è andato storto. */
function ultimaRiga(testo: string): string {
  return (
    testo
      .split("\n")
      .map((riga) => riga.trim())
      .filter((riga) => riga !== "")
      .at(-1) ?? "nessuna risposta"
  );
}

/**
 * Un percorso scritto in modo da confrontarlo con un altro: barre dritte, senza quella finale, e
 * senza maiuscole se è un percorso di Windows, dove non contano.
 */
function confrontabile(percorso: string): string {
  const dritto = percorso.trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/(.)\/$/, "$1");
  return /^[A-Za-z]:/.test(dritto) ? dritto.toLowerCase() : dritto;
}
