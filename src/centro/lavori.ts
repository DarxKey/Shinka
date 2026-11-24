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
import { Incarichi } from "./incarichi.ts";
import type { Attivita } from "../protocollo/attivita.ts";
import { descriviChiImplementa, progettoDellaConversazione, type ChiImplementa } from "../protocollo/incarichi.ts";
import { CHAT_PRINCIPALE, conversazioneDellaChat, numeroDellaChat } from "../protocollo/chat-parallele.ts";
import type { EsitoStrumento } from "../protocollo/strumenti.ts";
import { notaDelLavoroOffline, type ConsegnaOffline, type ProgettoDelNodo } from "../protocollo/offline.ts";

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

/** Il progetto ha lavoro fatto offline che sta arrivando dal suo ambiente: finché non arriva, non gli si scrive. */
export class LavoroOfflineInArrivo extends AmbienteSpento {
  constructor() {
    super();
    this.message = "Il progetto ha lavoro fatto offline che sta arrivando dal suo ambiente: riprova tra poco.";
  }
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
  /** Dove ogni incarico finito lascia le sue misure (ADR 0051). */
  registroIncarichi?: string;
  /** Quanto può durare un incarico. Nei test meno. */
  durataIncaricoMs?: number;
}

/** Ciò che una chat parallela di un progetto deve sapere quando comincia (ADR 0052). */
const NOTA_CHAT_PARALLELA =
  "[Shinka] Questa è una chat parallela del progetto: un'altra conversazione nella stessa cartella, che il proprietario ha aperto " +
  "in una scheda accanto alla principale, che intanto può lavorare su altro. Non cambiare i file su cui sta lavorando l'altra " +
  "senza che il proprietario lo chieda; lo stato del progetto lo tieni aggiornato come nella principale.";

export class LavoriDeiProgetti {
  /** Le impostazioni scelte per un lavoro solo, finché quel lavoro non finisce. */
  readonly #perQuestoLavoro = new Map<string, ImpostazioniConversazione>();
  readonly #o: OpzioniLavori;
  readonly #canali = new Map<string, Canale>();
  readonly #porte = new Map<string, PortaConversazione>();
  readonly #ascoltatori = new Set<(stato: StatoProgetti) => void>();
  /** Chi ascolta gli eventi nuovi di ogni progetto, anche di quelli che nasceranno. */
  readonly #ascoltatoriDegliEventi = new Set<(idProgetto: string, archiviato: EventoArchiviato) => void>();
  /** Le attività che la conversazione di ogni progetto ha riferito per ultime: vi si aggiungono quelle degli incarichi. */
  readonly #attivitaDellaConversazione = new Map<string, Attivita[]>();
  readonly #incarichi: Incarichi;
  /** I progetti la cui conversazione va riaperta appena è ferma: le estensioni scelte sono cambiate. */
  readonly #daRiaprire = new Set<string>();
  /** Ciò che la conversazione di un progetto deve sapere e non ha ancora saputo, perché non era aperta. */
  readonly #daDire = new Map<string, string[]>();
  /** I progetti con lavoro fatto offline nel loro ambiente e non ancora consegnato (ADR 0056): il centro non vi scrive. */
  readonly #inConsegna = new Set<string>();
  /** Vero mentre si riportano gli eventi di un lavoro offline: chi ascolta i progetti non li riceve come nuovi. */
  #riportando = false;

  private constructor(opzioni: OpzioniLavori) {
    this.#o = opzioni;
    this.#incarichi = new Incarichi({
      esecutore: (idAmbiente) => this.#esecutore(idAmbiente),
      pubblica: (idProgetto, evento) => this.#canali.get(idProgetto)?.pubblica(evento),
      attivitaCambiate: (idProgetto) => this.#pubblicaAttivita(idProgetto),
      estensioni: (idProgetto) => opzioni.progetti.estensioni(idProgetto),
      ...(opzioni.registroIncarichi === undefined ? {} : { registro: opzioni.registroIncarichi }),
      ...(opzioni.durataIncaricoMs === undefined ? {} : { durataMassimaMs: opzioni.durataIncaricoMs }),
    });
  }

  static async apri(opzioni: OpzioniLavori): Promise<LavoriDeiProgetti> {
    const lavori = new LavoriDeiProgetti(opzioni);
    for (const progetto of opzioni.progetti.elenco()) {
      for (const idConversazione of lavori.#conversazioniDi(progetto.id)) await lavori.#apriCanale(idConversazione);
    }
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

  /** L'archivio di una conversazione di un progetto: la principale, con l'identificativo del progetto, o una chat parallela. */
  canale(idConversazione: string): Canale | undefined {
    return this.#canali.get(idConversazione);
  }

  /** La conversazione di progetto di cui questo è l'archivio, se lo è. */
  conversazioneDelCanale(canale: Canale): string | undefined {
    for (const [idConversazione, aperto] of this.#canali) if (aperto === canale) return idConversazione;
    return undefined;
  }

  /** Le conversazioni del progetto: la principale e le chat parallele aperte (ADR 0052). */
  #conversazioniDi(idProgetto: string): string[] {
    return [idProgetto, ...this.#o.progetti.chatParallele(idProgetto).map((numero) => conversazioneDellaChat(idProgetto, numero))];
  }

  /** Il progetto di una conversazione aperta, principale o parallela; nulla se non c'è. */
  #progettoDi(idConversazione: string): Progetto | undefined {
    if (!this.#canali.has(idConversazione)) return undefined;
    return this.#o.progetti.trova(progettoDellaConversazione(idConversazione));
  }

  /**
   * Il proprietario apre una chat parallela nel progetto (ADR 0052): un'altra conversazione nella
   * stessa cartella, con le stesse impostazioni. Il suo identificativo, o il motivo se non si può.
   */
  async apriChat(idProgetto: string): Promise<{ idConversazione: string; numero: number } | { motivo: string }> {
    if (this.#o.progetti.trova(idProgetto) === undefined) return { motivo: "Progetto non trovato." };
    const numero = await this.#o.progetti.apriChat(idProgetto);
    if (numero === undefined) return { motivo: "Le chat del progetto sono già tutte aperte: chiudine una." };
    const idConversazione = conversazioneDellaChat(idProgetto, numero);
    // Un archivio rimasto da una chat di prima con lo stesso numero non le appartiene.
    await this.#togliArchivio(idConversazione);
    await this.#apriCanale(idConversazione);
    // La chat lo viene a sapere con il primo messaggio.
    this.#daDire.set(idConversazione, [NOTA_CHAT_PARALLELA]);
    this.#avvisa();
    return { idConversazione, numero };
  }

  /**
   * Il proprietario chiude una chat parallela: se lavora si ferma, la sua conversazione si chiude e
   * la sua storia si cancella. Ciò che ha fatto resta nei file. Falso se non c'era.
   */
  async chiudiChat(idProgetto: string, numero: number): Promise<boolean> {
    const idConversazione = conversazioneDellaChat(idProgetto, numero);
    if (numero === CHAT_PRINCIPALE || !this.#canali.has(idConversazione)) return false;
    if ((this.#canali.get(idConversazione)?.sospesi.turni ?? 0) > 0) await this.#porte.get(idConversazione)?.interrompi().catch(() => {});
    this.#chiudiConversazione(idConversazione);
    await this.#o.progetti.chiudiChat(idProgetto, numero);
    await this.#togliArchivio(idConversazione);
    this.#avvisa();
    return true;
  }

  /** Chiude la conversazione e dimentica il suo archivio in memoria. */
  #chiudiConversazione(idConversazione: string): void {
    this.#porte.get(idConversazione)?.chiudi();
    this.#porte.delete(idConversazione);
    this.#canali.delete(idConversazione);
    this.#attivitaDellaConversazione.delete(idConversazione);
    this.#daRiaprire.delete(idConversazione);
  }

  async #togliArchivio(idConversazione: string): Promise<void> {
    const archivio = join(this.#o.cartellaConversazioni, `${idConversazione}.jsonl`);
    await rm(archivio, { force: true });
    await rm(fileDellaVersione(archivio), { force: true });
  }

  /** Il proprietario ha aperto una conversazione del progetto: la prepara, se il suo ambiente è attivo. */
  prepara(idConversazione: string): void {
    const progetto = this.#progettoDi(idConversazione);
    if (progetto !== undefined && this.#inConsegna.has(progetto.id)) return;
    if (progetto !== undefined && this.#o.ambienti.attivo(progetto.idAmbiente)) {
      this.#porta(progetto, idConversazione).prepara();
    }
  }

  /**
   * Manda un messaggio a una conversazione del progetto: la principale, con l'identificativo del
   * progetto, o una chat parallela. Lancia `AmbienteSpento` se non può.
   */
  invia(
    idConversazione: string,
    testo: string,
    allegati: Allegato[] = [],
    /**
     * Impostazioni solo per il lavoro che questo messaggio comincia: valgono finché il progetto ha
     * turni aperti, poi tornano quelle salvate, che non cambiano.
     */
    perQuestoLavoro?: ModificaImpostazioni,
  ): void {
    const progetto = this.#progettoDi(idConversazione);
    if (progetto === undefined) throw new Error("Progetto non trovato.");
    if (!this.#o.ambienti.attivo(progetto.idAmbiente)) throw new AmbienteSpento();
    if (this.#inConsegna.has(progetto.id)) throw new LavoroOfflineInArrivo();
    const porta = this.#porta(progetto, idConversazione);
    // Le impostazioni per un lavoro solo valgono nella principale: è lì che partono i lavori programmati.
    if (perQuestoLavoro !== undefined && idConversazione === progetto.id) {
      const temporanee = applicaModifica(this.impostazioni(progetto.id), perQuestoLavoro);
      this.#perQuestoLavoro.set(progetto.id, temporanee);
      porta.imposta(temporanee);
      this.#canali.get(progetto.id)?.pubblica({ tipo: "impostazioni", impostazioni: temporanee });
    }
    const nota = this.#o.notaPrimaDelMessaggio?.(idConversazione);
    if (nota !== undefined) porta.annota(nota);
    for (const daDire of this.#daDire.get(idConversazione) ?? []) porta.annota(daDire);
    this.#daDire.delete(idConversazione);
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
    return this.#o.progetti.impostazioni(progettoDellaConversazione(idProgetto)) ?? IMPOSTAZIONI_DI_PROGETTO;
  }

  /** Le impostazioni con cui una conversazione del progetto lavora adesso: nella principale, quelle di un lavoro solo, se ce ne sono. */
  impostazioniInUso(idConversazione: string): ImpostazioniConversazione {
    return this.#perQuestoLavoro.get(idConversazione) ?? this.impostazioni(idConversazione);
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
    idConversazione: string,
    modifica: ModificaImpostazioni,
  ): Promise<ImpostazioniConversazione | undefined> {
    // Le impostazioni sono del progetto: valgono per la principale e per le chat parallele.
    const progetto = this.#progettoDi(idConversazione);
    if (progetto === undefined) return undefined;
    const idProgetto = progetto.id;
    // Una scelta fatta a mano vale come scelta di sempre, anche durante un lavoro con impostazioni sue.
    this.#perQuestoLavoro.delete(idProgetto);
    const nuove = applicaModifica(this.impostazioni(idProgetto), modifica);
    await this.#o.progetti.ricordaImpostazioni(idProgetto, nuove);
    for (const id of this.#conversazioniDi(idProgetto)) {
      this.#porte.get(id)?.imposta(nuove);
      this.#canali.get(id)?.pubblica({ tipo: "impostazioni", impostazioni: nuove });
    }
    return nuove;
  }

  decidiPermesso(idConversazione: string, idPermesso: string, decisione: DecisionePermesso, sempre?: boolean): boolean {
    // Il permesso può essere di chi svolge un incarico del progetto.
    return (
      (this.#porte.get(idConversazione)?.decidiPermesso(idPermesso, decisione, sempre) ?? false) ||
      this.#incarichi.decidiPermesso(progettoDellaConversazione(idConversazione), idPermesso, decisione, sempre)
    );
  }

  /**
   * Chi guida il progetto affida un incarico a chi implementa, e ne aspetta la fine (ADR 0051).
   * Non lancia: ciò che va storto è nella risposta.
   */
  affidaIncarico(idProgetto: string, argomenti: unknown): Promise<EsitoStrumento> {
    const progetto = this.#o.progetti.trova(idProgetto);
    if (progetto === undefined) return Promise.resolve({ testo: "Progetto non trovato.", errore: true });
    if (!this.#o.ambienti.attivo(progetto.idAmbiente)) return Promise.resolve({ testo: "L'ambiente del progetto è spento.", errore: true });
    return this.#incarichi.affida(progetto, this.#o.progetti.chiImplementa(idProgetto), this.impostazioniInUso(idProgetto).permessi, argomenti);
  }

  /**
   * Il proprietario cambia le estensioni del progetto mentre c'è già: la conversazione riparte con
   * quelle nuove, dalla stessa sessione, appena non sta lavorando. Falso se il progetto non c'è.
   */
  async cambiaEstensioni(idProgetto: string, scelte: readonly string[] | undefined): Promise<boolean> {
    if (!(await this.#o.progetti.ricordaEstensioni(idProgetto, scelte))) return false;
    const nota = `[Shinka] Il proprietario ha cambiato le estensioni di questo progetto: ${scelte === undefined ? "ora ha tutte quelle accese nel suo ambiente" : scelte.length === 0 ? "ora non ne ha nessuna" : `ora ha ${scelte.join(", ")}`}. Gli strumenti e i modelli locali sono quelli nuovi.`;
    for (const idConversazione of this.#conversazioniDi(idProgetto)) {
      // Ferma, la conversazione si chiude subito e la nota arriva con il prossimo messaggio; al lavoro, dopo il turno.
      if ((this.#canali.get(idConversazione)?.sospesi.turni ?? 0) > 0) this.#daRiaprire.add(idConversazione);
      else this.#riapri(idConversazione);
      this.#annotaOPoi(idConversazione, nota);
    }
    return true;
  }

  /** Chiude una conversazione del progetto: alla prossima richiesta riparte, dalla stessa sessione, con le scelte di adesso. */
  #riapri(idConversazione: string): void {
    this.#daRiaprire.delete(idConversazione);
    const porta = this.#porte.get(idConversazione);
    if (porta === undefined) return;
    this.#porte.delete(idConversazione);
    porta.chiudi();
  }

  /** Le estensioni scelte per il progetto; nulla se ha tutte quelle accese nel suo ambiente. */
  estensioniScelte(idProgetto: string): string[] | undefined {
    return this.#o.progetti.estensioni(idProgetto);
  }

  /** Chi implementa gli incarichi del progetto, se il proprietario lo ha scelto. */
  chiImplementa(idProgetto: string): ChiImplementa | undefined {
    return this.#o.progetti.chiImplementa(idProgetto);
  }

  /**
   * Il proprietario sceglie chi implementa, o con nulla torna a un modello solo. La conversazione del
   * progetto lo viene a sapere. Falso se il progetto non c'è.
   */
  async cambiaChiImplementa(idProgetto: string, scelta: ChiImplementa | undefined): Promise<boolean> {
    if (!(await this.#o.progetti.ricordaChiImplementa(idProgetto, scelta))) return false;
    this.#annotaOPoi(
      idProgetto,
      scelta === undefined
        ? "[Shinka] In questo progetto il proprietario non vuole più un modello che implementa: il lavoro lo fai tu, senza affida_incarico."
        : `[Shinka] In questo progetto il proprietario ha scelto chi implementa: ${descriviChiImplementa(scelta)}. Pianifica e controlla tu, e affida l'implementazione con i suoi test con affida_incarico.`,
    );
    return true;
  }

  /** Quali file tornerebbero com'erano riprendendo da prima di quel messaggio. */
  async anteprimaRiavvolgimento(idConversazione: string, idMessaggio: string): Promise<AnteprimaRiavvolgimento> {
    const porta = this.#portaAttiva(idConversazione);
    if (typeof porta === "string") return { motivo: porta };
    return porta.anteprimaRiavvolgimento?.(idMessaggio) ?? { motivo: "Questa conversazione non sa ripartire da un messaggio." };
  }

  /** Il proprietario modifica un suo messaggio: si riparte da prima di quello, e il testo nuovo parte. Il motivo, se non si può. */
  async modifica(idConversazione: string, idMessaggio: string, testo: string, opzioni: { file: boolean }): Promise<string | undefined> {
    const porta = this.#portaAttiva(idConversazione);
    if (typeof porta === "string") return porta;
    if (porta.riprendiDa === undefined) return "Questa conversazione non sa ripartire da un messaggio.";
    const motivo = await porta.riprendiDa(idMessaggio, opzioni);
    if (motivo !== undefined) return motivo;
    this.invia(idConversazione, testo);
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

  /** Una conversazione di un progetto con l'ambiente acceso, o perché non c'è. */
  #portaAttiva(idConversazione: string): PortaConversazione | string {
    const progetto = this.#progettoDi(idConversazione);
    if (progetto === undefined) return "Progetto non trovato.";
    if (!this.#o.ambienti.attivo(progetto.idAmbiente)) return "L'ambiente del progetto è spento.";
    return this.#porta(progetto, idConversazione);
  }

  /** La parte finale dell'uscita di un'attività del progetto. */
  async uscitaAttivita(idProgetto: string, idAttivita: string): Promise<UscitaAttivita | { motivo: string }> {
    const diUnIncarico = this.#incarichi.uscita(idAttivita);
    if (diUnIncarico !== undefined) return diUnIncarico;
    const porta = this.#portaAttiva(idProgetto);
    if (typeof porta === "string") return { motivo: porta };
    return porta.uscitaAttivita?.(idAttivita) ?? { motivo: "Questa conversazione non tiene le attività." };
  }

  rispondiDomande(idConversazione: string, idDomande: string, risposta: RispostaAlleDomande): boolean {
    return (
      (this.#porte.get(idConversazione)?.rispondiDomande?.(idDomande, risposta) ?? false) ||
      this.#incarichi.rispondiDomande(progettoDellaConversazione(idConversazione), idDomande, risposta)
    );
  }

  /** Ferma una conversazione del progetto; la principale ferma anche l'incarico che sta aspettando. */
  async interrompi(idConversazione: string): Promise<void> {
    // Prima l'incarico: chi guida lo sta aspettando, e saprà che è stato fermato.
    if (numeroDellaChat(idConversazione) === CHAT_PRINCIPALE) await this.#incarichi.interrompi(idConversazione);
    await this.#porte.get(idConversazione)?.interrompi();
  }

  // --- Il lavoro offline (ADR 0056) ---

  /**
   * I progetti di un ambiente come li tiene il suo nodo per il lavoro offline: tutti, con le
   * impostazioni e la sessione da cui riprendere la conversazione principale.
   */
  progettiDelNodo(idAmbiente: string): ProgettoDelNodo[] {
    return this.#o.progetti
      .elenco()
      .filter((progetto) => progetto.idAmbiente === idAmbiente)
      .map((progetto) => {
        const idSessione = this.#o.progetti.idSessione(progetto.id);
        const estensioni = this.#o.progetti.estensioni(progetto.id);
        return {
          id: progetto.id,
          nome: progetto.nome,
          cartella: progetto.cartella,
          brief: progetto.brief,
          creatoIl: progetto.creatoIl,
          impostazioni: this.impostazioni(progetto.id),
          ...(idSessione === undefined ? {} : { idSessione }),
          ...(estensioni === undefined ? {} : { estensioni }),
          ...(progetto.diShinka === true ? { diShinka: true as const } : {}),
        };
      });
  }

  /** Il nodo di un ambiente si è collegato dicendo quali progetti hanno lavoro offline da consegnare. */
  inConsegnaDa(idAmbiente: string, idProgetti: readonly string[]): void {
    const dichiarati = new Set(idProgetti);
    let cambiato = false;
    for (const progetto of this.#o.progetti.elenco()) {
      if (progetto.idAmbiente !== idAmbiente) continue;
      const prima = this.#inConsegna.has(progetto.id);
      if (dichiarati.has(progetto.id)) this.#inConsegna.add(progetto.id);
      else this.#inConsegna.delete(progetto.id);
      cambiato ||= prima !== dichiarati.has(progetto.id);
    }
    // Quelli nati offline il centro non li conosce ancora: li registrerà la consegna.
    if (cambiato) this.#avvisa();
  }

  inConsegna(idProgetto: string): boolean {
    return this.#inConsegna.has(progettoDellaConversazione(idProgetto));
  }

  /**
   * Un pezzo del lavoro offline di un progetto, consegnato dal nodo del suo ambiente: gli eventi vanno
   * in fondo all'archivio, ciascuno una volta sola. Dice fin dove il centro ha preso l'archivio offline.
   */
  async riceviOffline(idAmbiente: string, consegna: Extract<ConsegnaOffline, { tipo: "offline-eventi" }>): Promise<number> {
    const id = consegna.idProgetto;
    let progetto = this.#o.progetti.trova(id);
    if (progetto === undefined) {
      // Un progetto eliminato mentre il PC era offline: ciò che arriva non ha più dove andare.
      if (consegna.nuovo === undefined) return consegna.ultimo;
      progetto = await this.#o.progetti.adottaNatoOffline(consegna.nuovo, idAmbiente);
      await this.#apriCanale(id);
    }
    // Un nodo consegna solo i progetti del suo ambiente.
    if (progetto.idAmbiente !== idAmbiente) return consegna.ultimo;
    this.#inConsegna.add(id);
    const canale = this.#canali.get(id);
    let fino = this.#o.progetti.offlinePreso(id, consegna.versione);
    if (canale !== undefined) {
      this.#riportando = true;
      try {
        for (const archiviato of [...consegna.eventi].sort((a, b) => a.n - b.n)) {
          if (archiviato.n <= fino) continue;
          // Un buco: il nodo rimanda da dove il centro è arrivato.
          if (archiviato.n !== fino + 1) break;
          if (fino === 0) canale.riporta({ n: 0, quando: archiviato.quando, evento: { tipo: "nota", testo: notaDelLavoroOffline(consegna.ambiente, archiviato.quando) } });
          canale.riporta({ ...archiviato, evento: this.#o.immagini.prendi(id, archiviato.evento) });
          fino = archiviato.n;
        }
      } finally {
        this.#riportando = false;
      }
    }
    await this.#o.progetti.ricordaOfflinePreso(id, consegna.versione, fino);
    if (fino >= consegna.ultimo) {
      if (consegna.idSessione !== undefined) await this.#o.progetti.ricordaSessione(id, consegna.idSessione);
      const impostazioni = consegna.impostazioni ?? consegna.nuovo?.impostazioni;
      if (impostazioni !== undefined) await this.#o.progetti.ricordaImpostazioni(id, impostazioni);
      this.#inConsegna.delete(id);
    }
    this.#avvisa();
    return fino;
  }

  stato(): StatoProgetti {
    const ambienti = new Map(this.#o.ambienti.stato().ambienti.map((a) => [a.id, a]));
    return {
      progetti: this.#o.progetti.elenco().map((progetto) => ({
        ...progetto,
        nomeAmbiente: ambienti.get(progetto.idAmbiente)?.nome ?? "ambiente rimosso",
        condizione: this.#condizione(progetto),
        ...(this.#inConsegna.has(progetto.id) ? { offlineInArrivo: true as const } : {}),
        // Fin dove arriva il suo archivio: chi ne tiene una copia sa se gli manca qualcosa.
        ...this.#canali.get(progetto.id)?.indice,
        ...(this.#o.progetti.chatParallele(progetto.id).length === 0
          ? {}
          : {
              chat: this.#o.progetti.chatParallele(progetto.id).map((numero) => ({
                numero,
                condizione: this.#condizioneDi(progetto, conversazioneDellaChat(progetto.id, numero)),
              })),
            }),
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
   * Elimina un progetto da Shinka: se sta lavorando si ferma, la sua conversazione si chiude, con ciò
   * che aveva acceso in background, e il suo archivio si cancella, con le immagini. Con `cartella` si
   * elimina anche la cartella con i file, nel suo ambiente; senza, resta dov'è. Il progetto Shinka
   * non si elimina. Il motivo, se non si può; altrimenti com'è andata la cartella, se era chiesta.
   */
  async elimina(idProgetto: string, opzioni: { cartella?: boolean } = {}): Promise<{ motivo: string } | { cartella?: { riuscita: boolean; testo: string } }> {
    const progetto = this.#o.progetti.trova(idProgetto);
    if (progetto === undefined) return { motivo: "Progetto non trovato." };
    if (progetto.diShinka === true) return { motivo: "Il progetto Shinka non si elimina: è quello in cui Shinka sviluppa sé stessa." };
    // Un progetto al lavoro si ferma: il proprietario ha scelto di eliminarlo.
    const conversazioni = this.#conversazioniDi(idProgetto);
    for (const idConversazione of conversazioni) {
      if ((this.#canali.get(idConversazione)?.sospesi.turni ?? 0) > 0 || (idConversazione === idProgetto && this.#incarichi.inCorso(idProgetto))) {
        await this.interrompi(idConversazione).catch(() => {});
      }
    }
    this.#incarichi.chiudiDelProgetto(idProgetto);
    for (const idConversazione of conversazioni) this.#chiudiConversazione(idConversazione);
    this.#perQuestoLavoro.delete(idProgetto);
    await this.#o.progetti.togli(idProgetto);
    for (const idConversazione of conversazioni) await this.#togliArchivio(idConversazione);
    await this.#o.immagini.dimentica(idProgetto);
    // Le versioni dei file e le loro fotografie, per i progetti dell'ambiente del centro; non deve fermare l'eliminazione.
    if (this.#o.cartellaModifiche !== undefined) {
      await rm(join(this.#o.cartellaModifiche, nomeDiCartella(idProgetto)), { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
    }
    if (opzioni.cartella !== true) return {};
    if (!this.#o.ambienti.attivo(progetto.idAmbiente)) {
      return { cartella: { riuscita: false, testo: `L'ambiente è spento: la cartella ${progetto.cartella} è rimasta, e va eliminata a mano.` } };
    }
    // Ciò che il processo chiuso lasciava (shell, server) ha un attimo per uscire e lasciare i file.
    await new Promise((fatto) => setTimeout(fatto, 500));
    const esito = await this.#esecutore(progetto.idAmbiente)
      .agisciInCartella(progetto.cartella, { tipo: "elimina-cartella" })
      .catch((errore: unknown) => ({ riuscita: false, testo: errore instanceof Error ? errore.message : String(errore) }));
    return { cartella: { riuscita: esito.riuscita, testo: esito.riuscita ? esito.testo : `La cartella ${progetto.cartella} non si è potuta eliminare: ${esito.testo}` } };
  }

  /** Chiude le conversazioni aperte, per esempio allo spegnimento del centro. */
  chiudi(): void {
    this.#incarichi.chiudi();
    for (const porta of this.#porte.values()) porta.chiudi();
    this.#porte.clear();
  }

  /** La condizione del progetto, con quella delle sue chat parallele: se una aspetta il proprietario, il progetto aspetta te. */
  #condizione(progetto: Progetto): CondizioneProgetto {
    const condizioni = this.#conversazioniDi(progetto.id).map((idConversazione) => this.#condizioneDi(progetto, idConversazione));
    for (const parola of ["ambiente-spento", "aspetta-te", "al-lavoro"] as const) if (condizioni.includes(parola)) return parola;
    return "fermo";
  }

  #condizioneDi(progetto: Progetto, idConversazione: string): CondizioneProgetto {
    if (!this.#o.ambienti.attivo(progetto.idAmbiente)) return "ambiente-spento";
    const sospesi = this.#canali.get(idConversazione)?.sospesi;
    if (sospesi === undefined) return "fermo";
    if (sospesi.permessi > 0) return "aspetta-te";
    return sospesi.turni > 0 ? "al-lavoro" : "fermo";
  }

  /** Chi agisce in un ambiente per i progetti: qui al centro o su un nodo. */
  esecutore(idAmbiente: string): Esecutore {
    return this.#esecutore(idAmbiente);
  }

  /** Aggiunge un'informazione alla conversazione di un progetto, se è aperta, senza farla rispondere. */
  annota(idProgetto: string, testo: string): void {
    this.#porte.get(idProgetto)?.annota(testo);
  }

  /** Come `annota`, ma se la conversazione non è aperta lo dice prima del prossimo messaggio. */
  #annotaOPoi(idProgetto: string, testo: string): void {
    const porta = this.#porte.get(idProgetto);
    if (porta !== undefined) {
      porta.annota(testo);
      return;
    }
    // Vale l'ultima scelta: una nota di prima sulla stessa cosa non serve più.
    this.#daDire.set(idProgetto, [testo]);
  }

  #esecutore(idAmbiente: string): Esecutore {
    return idAmbiente === ID_AMBIENTE_DEL_CENTRO ? this.#o.locale : this.#o.remoti.per(idAmbiente);
  }

  /** La conversazione aperta di una conversazione del progetto: la principale, se non se ne indica un'altra. */
  #porta(progetto: Progetto, idConversazione: string = progetto.id): PortaConversazione {
    const esistente = this.#porte.get(idConversazione);
    if (esistente !== undefined) return esistente;
    const canale = this.#canali.get(idConversazione);
    if (canale === undefined) throw new Error("Il progetto non ha ancora il suo archivio.");
    const principale = this.#canali.get(progetto.id) ?? canale;
    const porta = this.#esecutore(progetto.idAmbiente).apriConversazione(
      idConversazione,
      progetto.cartella,
      () => this.#o.progetti.idSessione(idConversazione),
      () => this.impostazioniInUso(idConversazione),
      // Le immagini restano al centro come file: nell'archivio della conversazione va solo il loro nome.
      (evento) => {
        // Lo stato del progetto entra nella storia della principale, da qualunque chat arrivi, e solo
        // quando cambia: dopo un riavvio chi lavora lo riferisce di nuovo, anche se è quello di prima.
        if (evento.tipo === "stato-progetto") {
          if (statoDelProgetto(principale.archiviati)?.testo !== evento.testo) principale.pubblica(evento);
          return;
        }
        // Le attività della conversazione si mostrano insieme a quelle degli incarichi.
        if (evento.tipo === "attivita") {
          this.#attivitaDellaConversazione.set(idConversazione, evento.attivita);
          this.#pubblicaAttivita(idConversazione);
          return;
        }
        canale.pubblica(this.#o.immagini.prendi(progetto.id, evento));
      },
      (idSessione) => void this.#o.progetti.ricordaSessione(idConversazione, idSessione),
      () => this.#o.progetti.estensioni(progetto.id),
    );
    this.#porte.set(idConversazione, porta);
    return porta;
  }

  async #apriCanale(idConversazione: string): Promise<void> {
    if (this.#canali.has(idConversazione)) return;
    const idProgetto = progettoDellaConversazione(idConversazione);
    const principale = idConversazione === idProgetto;
    const canale = await Canale.apri(join(this.#o.cartellaConversazioni, `${idConversazione}.jsonl`));
    this.#canali.set(idConversazione, canale);
    // Chi apre il progetto deve sapere subito come è impostato.
    canale.pubblica({ tipo: "impostazioni", impostazioni: this.impostazioni(idProgetto) });
    // La condizione di un progetto cambia quando un turno o un permesso si apre o si chiude.
    canale.ascolta((archiviato) => {
      const { evento } = archiviato;
      if (evento.tipo === "turno-concluso" && canale.sospesi.turni === 0) {
        // Un lavoro con impostazioni sue finisce quando il progetto non ha più turni aperti.
        if (principale) this.#tornaAlleSalvate(idProgetto);
        if (this.#daRiaprire.has(idConversazione)) this.#riapri(idConversazione);
      }
      // Chi ascolta il progetto (lavori programmati, avvisi) segue la sua conversazione principale.
      if (principale && !this.#riportando) for (const ascoltatore of this.#ascoltatoriDegliEventi) ascoltatore(idProgetto, archiviato);
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

  /** Le attività di una conversazione del progetto; nella principale anche quelle dei suoi incarichi. */
  #pubblicaAttivita(idConversazione: string): void {
    const incarichi = numeroDellaChat(idConversazione) === CHAT_PRINCIPALE ? this.#incarichi.attivita(idConversazione) : [];
    const dellaConversazione = this.#attivitaDellaConversazione.get(idConversazione);
    if (dellaConversazione === undefined && incarichi.length === 0) return;
    this.#canali.get(idConversazione)?.pubblica({ tipo: "attivita", attivita: [...(dellaConversazione ?? []), ...incarichi] });
  }

  /** Un ambiente si è scollegato: ciò che vi era in corso non arriverà più a conclusione. */
  #ambienteScollegato(idAmbiente: string): void {
    this.#incarichi.ambienteScollegato(idAmbiente);
    for (const progetto of this.#o.progetti.elenco()) {
      if (progetto.idAmbiente !== idAmbiente) continue;
      for (const idConversazione of this.#conversazioniDi(progetto.id)) {
        this.#canali.get(idConversazione)?.chiudiSospesi("L'ambiente si è scollegato mentre Claude stava lavorando.");
      }
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

