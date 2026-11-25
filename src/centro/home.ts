/**
 * La Home vista dal centro: una conversazione fatta di argomenti. Uno è aperto nella chat
 * principale; ogni chat parallela (ADR 0052) ne tiene aperto un altro.
 *
 * Ogni argomento ha il suo archivio, la sua cartella di lavoro e la sua conversazione con
 * l'harness, che parte a contesto pulito. Quando si passa da un argomento a un altro, quello
 * che si chiude viene archiviato con titolo e riassunto e chi guarda la Home vede quello nuovo.
 * La Home principale tiene le sue chat parallele: ciascuna è una Home con il suo numero, che
 * cambia argomento allo stesso modo e, quando il proprietario la chiude, archivia il suo.
 */

import { mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Allegato } from "../protocollo/allegati.ts";
import type { StatoArgomenti, VoceArgomento } from "../protocollo/argomenti.ts";
import { CARTELLA_HOME } from "../protocollo/azioni.ts";
import type {
  AnteprimaRiavvolgimento,
  DecisionePermesso,
  RispostaAlleDomande,
  EventoArchiviato,
  EventoConversazione,
  IndiceArchivio,
  OrigineMessaggio,
  PortaConversazione,
  UscitaAttivita,
} from "../protocollo/eventi.ts";
import type { ImpostazioniConversazione } from "../protocollo/impostazioni.ts";
import { CHAT_PRINCIPALE } from "../protocollo/chat-parallele.ts";
import type { Argomento, Ramo, RegistroArgomenti } from "./argomenti.ts";
import { Canale } from "./canale.ts";
import { fileDellaVersione, indiceSenzaAprire } from "./indice-archivio.ts";
import type { CustodiaImmagini } from "./immagini.ts";
import { messaggiDelProprietario, type Cercabile } from "./storia.ts";

/** Sotto questo nome il centro custodisce le immagini di tutti gli argomenti della Home. */
export const CUSTODIA_HOME = "home";

/** Ciò che serve per aprire la conversazione di un argomento. */
export interface AperturaArgomento {
  /** La chat in cui l'argomento è aperto: 1 è la principale. */
  numero: number;
  cartella: string;
  idSessione: string | undefined;
  alEvento(evento: EventoConversazione): void;
  alIdSessione(id: string): void;
}

export interface OpzioniHome {
  argomenti: RegistroArgomenti;
  immagini: CustodiaImmagini;
  /** Cartella in cui il centro archivia le conversazioni degli argomenti. */
  cartellaArchivi: string;
  /** Cartella dei progetti dell'ambiente del centro: lì dentro stanno le cartelle degli argomenti. */
  radiceProgetti: string;
  /** Modello, impegno e permessi scelti per la Home, chiesti nel momento in cui servono. */
  impostazioni(): ImpostazioniConversazione;
  /** Come si apre la conversazione di un argomento. Nei test se ne mette una finta. */
  apri(apertura: AperturaArgomento): PortaConversazione;
  /**
   * Ciò che la conversazione di un argomento deve sapere prima del prossimo messaggio del
   * proprietario, se c'è: è così che le arriva la memoria.
   */
  notaPrimaDelMessaggio?(idArgomento: string): string | undefined;
  /** L'orologio, per sapere quali argomenti sono stati archiviati di recente. Nei test se ne mette uno fermo. */
  adesso?: () => number;
}

/** Quanti argomenti archiviati di recente la conversazione aperta conosce, e di quanti giorni al massimo. */
const ARCHIVIATI_DA_DIRE = 8;
const GIORNI_DEGLI_ARCHIVIATI = 14;

/**
 * Gli argomenti archiviati di recente, per la conversazione aperta: così, quando il proprietario
 * scrive il seguito di uno di loro, anche con una foto e poche parole, lo riconosce e lo riprende
 * invece di cominciarne uno nuovo. Nulla se non ce ne sono.
 */
export function notaDegliArchiviati(voci: readonly VoceArgomento[], adesso: number): string | undefined {
  const limite = adesso - GIORNI_DEGLI_ARCHIVIATI * 24 * 60 * 60 * 1000;
  const recenti = voci.filter((voce) => Date.parse(voce.archiviatoIl) >= limite).slice(0, ARCHIVIATI_DA_DIRE);
  if (recenti.length === 0) return undefined;
  return [
    "[Shinka] Gli argomenti archiviati di recente. Se il prossimo messaggio del proprietario è il seguito di uno di loro, anche solo con un'immagine e poche parole, riprendilo con `cambia_argomento` e il suo identificativo in `riprendi`; nel dubbio guarda con `cerca_argomenti` o `leggi_argomento`.",
    ...recenti.map((voce) => `- ${voce.id}: «${voce.titolo}» (archiviato il ${voce.archiviatoIl.slice(0, 10)})`),
  ].join("\n");
}

/** Ciò che la Home chiede a Claude quando è il proprietario a chiudere l'argomento. */
const ISTRUZIONE_ARCHIVIA =
  "[Shinka] Il proprietario passa a un altro argomento. Chiama `cambia_argomento` con il titolo e il " +
  "riassunto di questo argomento, senza indicare `riprendi` e senza scrivere altro.";

/** Ciò che la Home chiede a Claude quando il proprietario chiude una chat parallela. */
const ISTRUZIONE_CHIUDI =
  "[Shinka] Il proprietario chiude questa chat. Chiama `cambia_argomento` con il titolo e il " +
  "riassunto di questo argomento, senza indicare `riprendi` e senza scrivere altro.";

/** Ciò che una chat parallela deve sapere quando comincia. */
const NOTA_CHAT_PARALLELA =
  "[Shinka] Questa è una chat parallela della Home: il proprietario l'ha aperta in una scheda accanto alla principale, " +
  "che intanto può lavorare su altro. I messaggi da Telegram e i lavori programmati arrivano nella principale, non qui.";

/**
 * Quanto si aspetta, dopo che Claude ha chiesto il cambio, prima di fermare il turno:
 * il tempo che la risposta dello strumento arrivi all'harness e resti nella conversazione.
 */
const ATTESA_PRIMA_DI_FERMARE_MS = 400;

const NOTA_RIAPERTO = "[Shinka] Questo argomento era archiviato: il proprietario lo ha ripreso adesso.";

/** Ciò che la conversazione di un ramo deve sapere prima del messaggio da cui prende un'altra strada. */
function notaDelRamo(titolo: string | undefined): string {
  return (
    "[Shinka] Il proprietario ha fatto nascere un argomento nuovo da un suo messaggio: la conversazione riprende da " +
    "prima di quello, e il messaggio che segue lo sostituisce. Ciò che era venuto dopo resta nell'argomento archiviato" +
    (titolo === undefined ? "" : ` «${titolo}»`) +
    ", e i file della cartella sono com'erano lì: non sono tornati indietro."
  );
}

/**
 * Ciò che la conversazione deve sapere di un messaggio arrivato da Telegram: il proprietario
 * leggerà lì solo il testo con cui il turno si chiude.
 */
const NOTA_TELEGRAM =
  "[Shinka] Il messaggio che segue arriva da Telegram: il proprietario è al telefono e riceverà lì il testo con cui chiudi il turno, le foto scritte nel testo e, come allegati, i file che mostri con mostra_elaborato.";

interface Messaggio {
  testo: string;
  allegati: Allegato[];
  origine?: OrigineMessaggio;
}

interface Passaggio {
  verso: "nuovo" | string | Ramo;
  /** In un ramo, la storia dell'argomento di prima fino al messaggio da cui nasce. */
  storia?: readonly EventoArchiviato[];
  /** Mancano finché Claude non li ha scritti. */
  titolo?: string;
  riassunto?: string;
  /** Vero se l'argomento che si chiude non conteneva nulla da conservare. */
  daDimenticare: boolean;
  /** Vero se si chiude la chat parallela: non si apre nessun argomento al posto di quello archiviato. */
  chiudi?: true;
  /** Il messaggio che ha fatto cambiare argomento: avrà risposta in quello nuovo. */
  ripeti?: Messaggio;
  /**
   * Dove comincia, nella storia dell'argomento che si chiude, quel messaggio con il turno che lo ha
   * seguito: passa all'argomento nuovo, e da quello vecchio si toglie.
   */
  togliDa?: number;
}

interface Seguace {
  ricevi(archiviato: EventoArchiviato): void;
  azzera(): void;
  /** La storia è stata rimandata, fin dove arriva l'archivio: da qui in poi arrivano solo eventi nuovi. */
  storiaInviata(indice: IndiceArchivio): void;
  scollega(): void;
}

/** Perché un passaggio di argomento chiesto dal proprietario non si può fare adesso. */
export type RifiutoPassaggio = "occupata" | "non-trovato";

/** La condizione della Home, con le stesse parole dei progetti. */
export type CondizioneDellaHome = "al-lavoro" | "aspetta-te" | "fermo";

/** Ciò che la Home principale e le sue chat parallele hanno in comune. */
interface Comune {
  /** Gli archivi aperti in memoria, di tutti gli argomenti: ne vale uno per argomento. */
  canali: Map<string, Canale>;
  /** Chi vuole sapere che in una chat qualunque è successo qualcosa: la condizione può essere cambiata. */
  suiCambi: Set<() => void>;
  /** Chi vuole sapere quando un passaggio di argomento è finito, in una chat qualunque, con gli archivi a posto. */
  dopoIPassaggi: Set<() => void>;
}

function segnala(comune: Comune): void {
  for (const ascoltatore of comune.suiCambi) ascoltatore();
}

export class Home implements PortaConversazione {
  readonly #o: OpzioniHome;
  /** Il numero di questa chat: 1 è la principale. */
  readonly #numero: number;
  readonly #comune: Comune;
  /** Nella principale, le chat parallele aperte. */
  readonly #parallele = new Map<number, Home>();
  /** In una chat parallela, ciò che la principale fa quando si chiude. */
  #allaChiusura: (() => void) | undefined;
  readonly #seguaci = new Set<Seguace>();
  #canale: Canale;
  #porta: PortaConversazione;
  #passaggio: Passaggio | undefined;
  /** Vero mentre un passaggio si sta compiendo. */
  #inPassaggio = false;
  /** Vero se il turno in corso è stato fermato dalla Home perché l'argomento sta cambiando. */
  #fermato = false;
  /** L'ultimo messaggio del proprietario: se fa cambiare argomento, va riproposto in quello nuovo. */
  #ultimoMessaggio: Messaggio | undefined;
  /** L'ultimo elenco degli archiviati detto alla conversazione aperta: si ripete solo se cambia. */
  #archiviatiDetti: string | undefined;
  /** I messaggi arrivati durante un passaggio: partono appena l'argomento nuovo è aperto. */
  readonly #inCoda: Messaggio[] = [];
  /** Da dove arriva il messaggio che si sta consegnando alla conversazione, se non dall'interfaccia. */
  #origineInConsegna: OrigineMessaggio | undefined;
  /** Chi ascolta gli eventi nuovi dell'argomento aperto, qualunque esso sia. */
  readonly #ascoltatori = new Set<(archiviato: EventoArchiviato) => void>();
  #scollegaAscolto: () => void = () => {};

  private constructor(opzioni: OpzioniHome, canale: Canale, numero: number, comune: Comune) {
    this.#o = opzioni;
    this.#canale = canale;
    this.#numero = numero;
    this.#comune = comune;
    this.#ascoltaIlCanale(canale);
    this.#porta = this.#apriPorta(this.#aperto(), canale);
  }

  /** L'argomento aperto in questa chat. */
  #aperto(): Argomento {
    return this.#o.argomenti.apertoIn(this.#numero);
  }

  #ascoltaIlCanale(canale: Canale): void {
    this.#scollegaAscolto();
    this.#scollegaAscolto = canale.ascolta((archiviato) => {
      for (const ascoltatore of this.#ascoltatori) ascoltatore(archiviato);
      segnala(this.#comune);
    });
  }

  /** Il numero di questa chat: 1 è la principale. */
  get numero(): number {
    return this.#numero;
  }

  /** Una chat della Home: 1 è questa, la principale; le altre sono le chat parallele aperte. */
  chat(numero: number): Home | undefined {
    return numero === this.#numero ? this : this.#parallele.get(numero);
  }

  /** Le chat parallele aperte, ciascuna con la sua condizione. */
  condizioniDelleChat(): { numero: number; condizione: CondizioneDellaHome }[] {
    return [...this.#parallele.values()].sort((a, b) => a.#numero - b.#numero).map((chat) => ({ numero: chat.#numero, condizione: chat.condizione }));
  }

  /** La condizione della Home con le sue chat parallele: se una aspetta il proprietario, la Home aspetta te. */
  get condizioneComplessiva(): CondizioneDellaHome {
    const condizioni = [this.condizione, ...this.condizioniDelleChat().map((chat) => chat.condizione)];
    return condizioni.includes("aspetta-te") ? "aspetta-te" : condizioni.includes("al-lavoro") ? "al-lavoro" : "fermo";
  }

  /** Chiamata quando in una chat qualunque succede qualcosa, o quando se ne apre o se ne chiude una. */
  suiCambi(ascoltatore: () => void): () => void {
    this.#comune.suiCambi.add(ascoltatore);
    return () => this.#comune.suiCambi.delete(ascoltatore);
  }

  /**
   * Il proprietario apre una chat parallela, con un argomento nuovo. Il suo numero, o nulla se sono
   * già tutte aperte. Solo dalla principale.
   */
  async apriChat(): Promise<number | undefined> {
    if (this.#numero !== CHAT_PRINCIPALE) return undefined;
    const aperta = await this.#o.argomenti.apriChat();
    if (aperta === undefined) return undefined;
    const chat = await this.#apriParallela(aperta.numero);
    chat.annota(NOTA_CHAT_PARALLELA);
    segnala(this.#comune);
    return aperta.numero;
  }

  /**
   * Il proprietario chiude una chat parallela: Claude scrive titolo e riassunto e il suo argomento va
   * tra gli archiviati, alla fine del turno; se è vuoto non lascia nulla.
   */
  async chiudiChat(numero: number): Promise<RifiutoPassaggio | undefined> {
    const chat = this.#numero === CHAT_PRINCIPALE ? this.#parallele.get(numero) : undefined;
    if (chat === undefined) return "non-trovato";
    return chat.#chiudiQuesta();
  }

  async #apriParallela(numero: number): Promise<Home> {
    const argomento = this.#o.argomenti.apertoIn(numero);
    const canale = await this.canaleDi(argomento.id);
    if (canale === undefined) throw new Error("L'argomento della chat parallela non c'è.");
    const chat = new Home(this.#o, canale, numero, this.#comune);
    chat.#allaChiusura = () => {
      this.#parallele.delete(numero);
      segnala(this.#comune);
    };
    this.#parallele.set(numero, chat);
    canale.pubblica({ tipo: "impostazioni", impostazioni: this.#o.impostazioni() });
    return chat;
  }

  async #chiudiQuesta(): Promise<RifiutoPassaggio | undefined> {
    if (this.#passaggio !== undefined || this.#inPassaggio || this.#canale.sospesi.turni > 0) return "occupata";
    if (messaggiDelProprietario(this.#canale.archiviati) === 0) {
      await this.#compi({ verso: "nuovo", daDimenticare: true, chiudi: true });
      return undefined;
    }
    // Titolo e riassunto li scrive Claude, che conosce l'argomento: la chat si chiude a fine turno.
    this.#passaggio = { verso: "nuovo", daDimenticare: false, chiudi: true };
    try {
      this.#porta.istruisci(ISTRUZIONE_CHIUDI);
    } catch {
      const passaggio = this.#passaggio;
      this.#passaggio = undefined;
      await this.#compi(passaggio);
    }
    return undefined;
  }

  /**
   * Ascolta la Home senza guardarla: riceve solo gli eventi nuovi dell'argomento aperto, anche
   * dopo che l'argomento è cambiato, e non conta come una pagina aperta.
   */
  ascolta(ascoltatore: (archiviato: EventoArchiviato) => void): () => void {
    this.#ascoltatori.add(ascoltatore);
    return () => this.#ascoltatori.delete(ascoltatore);
  }

  /** Come sta la Home, in una parola: al lavoro, aspetta il proprietario, oppure ferma. */
  get condizione(): CondizioneDellaHome {
    const { turni, permessi } = this.#canale.sospesi;
    return permessi > 0 ? "aspetta-te" : turni > 0 ? "al-lavoro" : "fermo";
  }

  /** Chiamata quando la condizione della Home cambia, anche passando a un altro argomento. */
  iscriviCondizione(ascoltatore: (condizione: CondizioneDellaHome) => void): () => void {
    let ultima = this.condizione;
    ascoltatore(ultima);
    return this.ascolta(() => {
      if (this.condizione === ultima) return;
      ultima = this.condizione;
      ascoltatore(ultima);
    });
  }

  /** Vero mentre l'argomento aperto sta per cambiare, o sta cambiando. */
  get staCambiandoArgomento(): boolean {
    return this.#passaggio !== undefined || this.#inPassaggio;
  }

  static async apri(opzioni: OpzioniHome): Promise<Home> {
    const aperto = opzioni.argomenti.aperto;
    const canale = await Canale.apri(archivioDi(opzioni, aperto));
    const comune: Comune = { canali: new Map([[aperto.id, canale]]), suiCambi: new Set(), dopoIPassaggi: new Set() };
    const home = new Home(opzioni, canale, CHAT_PRINCIPALE, comune);
    // Chi apre la Home deve sapere subito come è impostata.
    canale.pubblica({ tipo: "impostazioni", impostazioni: opzioni.impostazioni() });
    // Le chat parallele aperte prima che il centro ripartisse.
    for (const chat of opzioni.argomenti.chatParallele()) await home.#apriParallela(chat.numero);
    return home;
  }

  /** L'archivio dell'argomento aperto. */
  get canale(): Canale {
    return this.#canale;
  }

  get idArgomentoAperto(): string {
    return this.#aperto().id;
  }

  /** La cartella di lavoro dell'argomento aperto, nell'ambiente del centro. */
  get cartellaAperta(): string {
    return cartellaDi(this.#o, this.#aperto());
  }

  /** La cartella di lavoro di un argomento qualunque, aperto o archiviato, nell'ambiente del centro. */
  cartellaDellArgomento(idArgomento: string): string {
    const argomento = this.#o.argomenti.trova(idArgomento);
    return argomento === undefined
      ? join(resolve(this.#o.radiceProgetti), CARTELLA_HOME, idArgomento)
      : cartellaDi(this.#o, argomento);
  }

  /** Pubblica un evento nell'argomento aperto. */
  readonly pubblica = (evento: EventoConversazione): void => {
    this.#canale.pubblica(evento);
  };

  /**
   * Segue la Home: riceve la storia dell'argomento aperto e poi gli eventi nuovi. Quando
   * l'argomento cambia viene chiamato `azzera`, e subito dopo arriva la storia di quello nuovo.
   * Finita ogni storia viene chiamato `storiaInviata`. Restituisce la funzione per smettere.
   *
   * Con `da` chi segue ha già una copia della storia dell'argomento aperto fino all'evento `dopo`,
   * in quella versione: se vale riceve solo gli eventi archiviati dopo, altrimenti `azzera` e la
   * storia intera (ADR 0046).
   */
  segui(
    ricevi: (archiviato: EventoArchiviato) => void,
    azzera: () => void,
    storiaInviata: (indice: IndiceArchivio) => void = () => {},
    da?: { dopo: number; versione: string },
  ): () => void {
    const riprende = da !== undefined && this.#canale.riprendibile(da.dopo, da.versione);
    if (da !== undefined && !riprende) azzera();
    const seguace: Seguace = { ricevi, azzera, storiaInviata, scollega: this.#canale.iscrivi(ricevi, riprende ? da.dopo : 0) };
    storiaInviata(this.#canale.indice);
    this.#seguaci.add(seguace);
    return () => {
      seguace.scollega();
      this.#seguaci.delete(seguace);
    };
  }

  /** L'argomento di cui questo è l'archivio, se è uno di quelli aperti in memoria. */
  argomentoDelCanale(canale: Canale): string | undefined {
    for (const [idArgomento, aperto] of this.#comune.canali) if (aperto === canale) return idArgomento;
    return undefined;
  }

  /** L'archivio di un argomento qualunque, aperto o archiviato. Nulla se non esiste. */
  async canaleDi(idArgomento: string): Promise<Canale | undefined> {
    const esistente = this.#comune.canali.get(idArgomento);
    if (esistente !== undefined) return esistente;
    const argomento = this.#o.argomenti.trova(idArgomento);
    if (argomento === undefined) return undefined;
    const canale = await Canale.apri(archivioDi(this.#o, argomento));
    // Nel frattempo può averlo aperto qualcun altro: ne vale uno solo.
    const giaAperto = this.#comune.canali.get(idArgomento);
    if (giaAperto !== undefined) return giaAperto;
    this.#comune.canali.set(idArgomento, canale);
    return canale;
  }

  /**
   * Fin dove arriva l'archivio di un argomento, aperto o archiviato, e in quale versione. Di uno
   * che non è aperto in memoria lo dice il file della versione, senza leggere l'archivio.
   */
  indiceDi(idArgomento: string): IndiceArchivio | undefined {
    const aperto = this.#comune.canali.get(idArgomento);
    if (aperto !== undefined) return aperto.indice;
    const argomento = this.#o.argomenti.trova(idArgomento);
    return argomento === undefined ? undefined : indiceSenzaAprire(archivioDi(this.#o, argomento));
  }

  /** L'elenco degli argomenti con, per ciascuno e per quello aperto, l'indice del suo archivio. */
  conIndici(stato: StatoArgomenti): StatoArgomenti {
    const aperto = this.indiceDi(stato.idAperto);
    return {
      ...stato,
      ...(aperto === undefined ? {} : { aperto }),
      archiviati: stato.archiviati.map((voce) => {
        const indice = this.indiceDi(voce.id);
        return indice === undefined ? voce : { ...voce, ...indice };
      }),
    };
  }

  /** Avvisa quando un passaggio di argomento è finito: gli archivi dei due argomenti sono com'erano da restare. */
  dopoIPassaggi(ascoltatore: () => void): () => void {
    this.#comune.dopoIPassaggi.add(ascoltatore);
    return () => this.#comune.dopoIPassaggi.delete(ascoltatore);
  }

  /** Dove sta l'archivio di un argomento, aperto o archiviato. */
  archivioDellArgomento(idArgomento: string): string | undefined {
    const argomento = this.#o.argomenti.trova(idArgomento);
    return argomento === undefined ? undefined : archivioDi(this.#o, argomento);
  }

  /**
   * Elimina un argomento archiviato: la sua storia e la sua cartella nell'ambiente del centro. Le
   * cartelle che ha negli altri ambienti restano. Quello aperto non si elimina. Il motivo, se non si può.
   */
  async eliminaArchiviato(idArgomento: string): Promise<string | undefined> {
    const argomento = this.#o.argomenti.trova(idArgomento);
    if (argomento === undefined) return "Argomento non trovato.";
    if (argomento.archiviatoIl === undefined || idArgomento === this.idArgomentoAperto) return "L'argomento aperto non si elimina: prima passa a un altro.";
    const archivio = archivioDi(this.#o, argomento);
    const cartella = cartellaDi(this.#o, argomento);
    if (!(await this.#o.argomenti.togli(idArgomento))) return "Argomento non trovato tra quelli archiviati.";
    this.#comune.canali.delete(idArgomento);
    await rm(archivio, { force: true });
    await rm(fileDellaVersione(archivio), { force: true });
    // Solo la cartella che è sua: quella della Home di prima degli argomenti ha un posto suo, e resta.
    if (argomento.cartella === undefined) await rm(cartella, { recursive: true, force: true });
    return undefined;
  }

  archiviati(): VoceArgomento[] {
    return this.#o.argomenti.archiviati();
  }

  /** Gli argomenti archiviati, ciascuno con la sua storia, per cercarvi dentro. */
  async cercabili(): Promise<Cercabile[]> {
    const cercabili: Cercabile[] = [];
    for (const voce of this.archiviati()) {
      const canale = await this.canaleDi(voce.id);
      if (canale === undefined) continue;
      cercabili.push({ id: voce.id, titolo: voce.titolo, riassunto: voce.riassunto, storia: canale.archiviati });
    }
    return cercabili;
  }

  prepara(): void {
    this.#porta.prepara();
  }

  invia(testo: string, allegati: Allegato[] = [], origine?: OrigineMessaggio): void {
    const messaggio: Messaggio = { testo, allegati, ...(origine === undefined ? {} : { origine }) };
    if (this.#passaggio !== undefined || this.#inPassaggio) {
      this.#inCoda.push(messaggio);
      return;
    }
    this.#ultimoMessaggio = messaggio;
    const nota = this.#o.notaPrimaDelMessaggio?.(this.idArgomentoAperto);
    if (nota !== undefined) this.#porta.annota(nota);
    const archiviati = notaDegliArchiviati(this.#o.argomenti.archiviati(), this.#o.adesso?.() ?? Date.now());
    if (archiviati !== undefined && archiviati !== this.#archiviatiDetti) {
      this.#porta.annota(archiviati);
      this.#archiviatiDetti = archiviati;
    }
    if (origine === "telegram") this.#porta.annota(NOTA_TELEGRAM);
    // La conversazione pubblica il messaggio mentre lo riceve: è lì che gli si scrive da dove arriva.
    this.#origineInConsegna = origine;
    try {
      this.#porta.invia(testo, allegati);
    } finally {
      this.#origineInConsegna = undefined;
    }
  }

  /** Le skill di Shinka sono cambiate: la conversazione dell'argomento aperto le rilegge, anche nelle chat parallele. */
  ricaricaSkill(): void {
    this.#porta.ricaricaSkill?.();
    for (const chat of this.#parallele.values()) chat.ricaricaSkill();
  }

  /** Le estensioni accese nell'ambiente del centro sono cambiate: le conversazioni aperte ripartono con quelle nuove. */
  ricaricaEstensioni(): void {
    this.#porta.ricaricaEstensioni?.();
    for (const chat of this.#parallele.values()) chat.ricaricaEstensioni();
  }

  annota(testo: string): void {
    this.#porta.annota(testo);
  }

  istruisci(testo: string): void {
    this.#porta.istruisci(testo);
  }

  decidiPermesso(idPermesso: string, decisione: DecisionePermesso): boolean {
    return this.#porta.decidiPermesso(idPermesso, decisione);
  }

  /** Quali file tornerebbero com'erano riprendendo da prima di quel messaggio. */
  async anteprimaRiavvolgimento(idMessaggio: string): Promise<AnteprimaRiavvolgimento> {
    if (this.#porta.anteprimaRiavvolgimento === undefined) return { motivo: "Questa conversazione non sa ripartire da un messaggio." };
    return this.#porta.anteprimaRiavvolgimento(idMessaggio);
  }

  /**
   * Il proprietario modifica un suo messaggio: la conversazione riparte da prima di quello, con i
   * file se lo vuole, e il testo nuovo parte come un messaggio. Il motivo, se non si può.
   */
  async modifica(idMessaggio: string, testo: string, opzioni: { file: boolean }): Promise<string | undefined> {
    if (this.#passaggio !== undefined || this.#inPassaggio) return "La Home sta cambiando argomento: riprova tra poco.";
    if (this.#porta.riprendiDa === undefined) return "Questa conversazione non sa ripartire da un messaggio.";
    const motivo = await this.#porta.riprendiDa(idMessaggio, opzioni);
    if (motivo !== undefined) return motivo;
    this.invia(testo);
    return undefined;
  }

  /**
   * Il proprietario modifica un suo messaggio e lo manda in un argomento nuovo: quello nuovo ha la
   * storia fino a prima del messaggio e riparte da lì, nella stessa cartella; quello aperto viene
   * archiviato com'è. Il motivo, se non si può.
   */
  async ramoDa(idMessaggio: string, testo: string): Promise<string | undefined> {
    if (this.#passaggio !== undefined || this.#inPassaggio) return "La Home sta cambiando argomento: riprova tra poco.";
    if (this.#canale.sospesi.turni > 0) return "Claude sta lavorando: aspetta che finisca, o fermalo.";
    if (this.#porta.biforca === undefined) return "Questa conversazione non sa far nascere un argomento da un messaggio.";
    const storia = storiaPrimaDi(this.#canale.archiviati, idMessaggio);
    if (storia === undefined) return "Questo messaggio non è nell'argomento aperto.";
    const esito = await this.#porta.biforca(idMessaggio);
    if (!esito.riuscita) return esito.motivo;
    const ramo: Ramo = {
      tipo: "ramo",
      cartella: this.cartellaAperta,
      ...(esito.idSessione === undefined ? {} : { idSessione: esito.idSessione }),
    };
    const rifiuto = await this.#passaSuRichiesta(ramo, { storia, ripeti: { testo, allegati: [] } });
    return rifiuto === undefined ? undefined : "Claude sta lavorando: aspetta che finisca, o fermalo.";
  }

  rispondiDomande(idDomande: string, risposta: RispostaAlleDomande): boolean {
    return this.#porta.rispondiDomande?.(idDomande, risposta) ?? false;
  }

  /** La parte finale dell'uscita di un'attività dell'argomento aperto. */
  async uscitaAttivita(idAttivita: string): Promise<UscitaAttivita | { motivo: string }> {
    return this.#porta.uscitaAttivita?.(idAttivita) ?? { motivo: "Questa conversazione non tiene le attività." };
  }

  /** Le impostazioni della Home sono cambiate: valgono per la principale e per le chat parallele. */
  imposta(impostazioni: ImpostazioniConversazione): void {
    this.#porta.imposta(impostazioni);
    this.#canale.pubblica({ tipo: "impostazioni", impostazioni });
    for (const chat of this.#parallele.values()) chat.imposta(impostazioni);
  }

  interrompi(): Promise<void> {
    return this.#porta.interrompi();
  }

  chiudi(): void {
    this.#porta.chiudi();
    for (const chat of this.#parallele.values()) chat.chiudi();
  }

  /**
   * Claude chiede di cambiare argomento, oppure risponde alla richiesta di archiviare quello aperto.
   * Il passaggio avviene quando il turno in corso si chiude. Restituisce ciò che va detto a Claude,
   * oppure il motivo per cui il cambio non si fa.
   */
  richiediCambio(richiesta: { titolo: string; riassunto: string; riprendi?: string }): string | { rifiuto: string } {
    const titolo = richiesta.titolo.trim().slice(0, 80);
    const riassunto = richiesta.riassunto.trim();
    if (titolo === "") return { rifiuto: "Serve un titolo per l'argomento che si chiude." };

    if (this.#passaggio !== undefined) {
      // È il proprietario ad aver chiesto il passaggio: mancavano solo titolo e riassunto.
      this.#passaggio.titolo = titolo;
      this.#passaggio.riassunto = riassunto;
      this.#fermaIlTurno();
      return "Argomento archiviato. Non scrivere altro.";
    }

    const scambi = messaggiDelProprietario(this.#canale.archiviati);
    let verso: Passaggio["verso"] = "nuovo";
    if (richiesta.riprendi !== undefined && richiesta.riprendi.trim() !== "") {
      const daRiprendere = this.#o.argomenti.trova(richiesta.riprendi.trim());
      if (daRiprendere === undefined || daRiprendere.archiviatoIl === undefined) {
        return {
          rifiuto: `Nessun argomento archiviato ha l'identificativo "${richiesta.riprendi}". Usa quello indicato da cerca_argomenti.`,
        };
      }
      verso = daRiprendere.id;
    } else if (scambi <= 1) {
      return {
        rifiuto:
          "Questo argomento è appena cominciato: non c'è nulla da archiviare. Rispondi alla richiesta del proprietario qui.",
      };
    }
    // Il messaggio che fa cambiare argomento è l'ultimo del proprietario: comincia lì ciò che passa a quello nuovo.
    const togliDa = this.#ultimoMessaggio === undefined ? undefined : ultimoMessaggioDelProprietario(this.#canale.archiviati);
    this.#passaggio = {
      verso,
      titolo,
      riassunto,
      // Un argomento con il solo messaggio che lo ha fatto cambiare non lascia nulla da conservare.
      daDimenticare: scambi <= 1,
      ...(this.#ultimoMessaggio === undefined ? {} : { ripeti: this.#ultimoMessaggio }),
      ...(togliDa === undefined ? {} : { togliDa }),
    };
    this.#fermaIlTurno();
    return (
      "Fatto: l'argomento viene archiviato e la richiesta del proprietario viene riproposta " +
      (verso === "nuovo" ? "in un argomento nuovo" : "nell'argomento ripreso") +
      ". Termina qui, senza scrivere altro e senza rispondere alla richiesta."
    );
  }

  /**
   * Deciso il cambio, il turno in corso non ha altro da fare. Claude non sempre si ferma da sé:
   * lasciato andare, risponderebbe alla richiesta anche qui, e poi di nuovo nell'argomento nuovo.
   */
  #fermaIlTurno(): void {
    const porta = this.#porta;
    const attesa = setTimeout(() => {
      if (porta !== this.#porta || this.#passaggio === undefined) return;
      this.#fermato = true;
      porta.interrompi().catch(() => {
        this.#fermato = false;
      });
    }, ATTESA_PRIMA_DI_FERMARE_MS);
    attesa.unref();
  }

  /** Il proprietario chiude l'argomento aperto e ne comincia uno nuovo. */
  nuovoArgomento(): Promise<RifiutoPassaggio | undefined> {
    return this.#passaSuRichiesta("nuovo");
  }

  /** Il proprietario riprende un argomento archiviato: quello aperto viene archiviato al suo posto. */
  riapri(idArgomento: string): Promise<RifiutoPassaggio | undefined> {
    const argomento = this.#o.argomenti.trova(idArgomento);
    if (argomento === undefined || argomento.archiviatoIl === undefined) return Promise.resolve("non-trovato");
    return this.#passaSuRichiesta(argomento.id);
  }

  async #passaSuRichiesta(
    verso: Passaggio["verso"],
    ramo?: Pick<Passaggio, "storia" | "ripeti">,
  ): Promise<RifiutoPassaggio | undefined> {
    if (this.#passaggio !== undefined || this.#inPassaggio || this.#canale.sospesi.turni > 0) return "occupata";
    const scambi = messaggiDelProprietario(this.#canale.archiviati);
    if (scambi === 0) {
      // Un argomento ancora vuoto è già quello nuovo; se se ne riprende un altro, non lascia traccia.
      if (verso !== "nuovo") await this.#compi({ verso, daDimenticare: true, ...ramo });
      return undefined;
    }
    // Titolo e riassunto li scrive Claude, che conosce l'argomento: il passaggio avviene a fine turno.
    this.#passaggio = { verso, daDimenticare: false, ...ramo };
    try {
      this.#porta.istruisci(ISTRUZIONE_ARCHIVIA);
    } catch {
      // Se Claude non può scriverli, l'argomento viene archiviato lo stesso con un titolo di ripiego.
      const passaggio = this.#passaggio;
      this.#passaggio = undefined;
      await this.#compi(passaggio);
    }
    return undefined;
  }

  /** Riceve un evento dalla conversazione di un argomento e lo archivia nel suo canale. */
  #alEvento(porta: () => PortaConversazione, canale: Canale, ricevuto: EventoConversazione): void {
    let evento = ricevuto;
    if (evento.tipo === "turno-concluso" && evento.interrotto === true && this.#fermato && porta() === this.#porta) {
      // Lo ha fermato la Home, non il proprietario: nella storia è un turno finito come gli altri.
      this.#fermato = false;
      evento = { tipo: "turno-concluso", riuscito: true, durataMs: evento.durataMs, ...(evento.token === undefined ? {} : { token: evento.token }) };
    }
    if (evento.tipo === "messaggio-proprietario" && this.#origineInConsegna !== undefined && porta() === this.#porta) {
      evento = { ...evento, origine: this.#origineInConsegna };
    }
    canale.pubblica(this.#o.immagini.prendi(CUSTODIA_HOME, evento));
    if (evento.tipo !== "turno-concluso" || this.#passaggio === undefined) return;
    // Conta solo il turno dell'argomento aperto, e solo quando non ne restano altri in corso.
    if (porta() !== this.#porta || canale.sospesi.turni > 0) return;
    const passaggio = this.#passaggio;
    this.#passaggio = undefined;
    void this.#compi(passaggio);
  }

  async #compi(passaggio: Passaggio): Promise<void> {
    if (passaggio.chiudi === true) {
      await this.#compiLaChiusura(passaggio);
      return;
    }
    this.#inPassaggio = true;
    this.#fermato = false;
    let riuscito = false;
    const vecchio = this.#aperto();
    const canaleVecchio = this.#canale;
    const portaVecchia = this.#porta;
    try {
      const chiuso = passaggio.daDimenticare
        ? "da-dimenticare"
        : {
            titolo: passaggio.titolo ?? titoloDiRipiego(canaleVecchio),
            riassunto: passaggio.riassunto ?? "",
          };
      const prossimo = await this.#o.argomenti.passa(chiuso, passaggio.verso, Date.now(), this.#numero);
      portaVecchia.chiudi();
      if (chiuso === "da-dimenticare") {
        this.#comune.canali.delete(vecchio.id);
        if (vecchio.archivio === undefined) {
          await rm(archivioDi(this.#o, vecchio), { force: true });
          await rm(fileDellaVersione(archivioDi(this.#o, vecchio)), { force: true });
        }
      } else {
        // Il messaggio che ha fatto cambiare argomento, e il turno che lo ha seguito, passano a quello nuovo.
        if (passaggio.togliDa !== undefined) canaleVecchio.taglia(passaggio.togliDa);
        canaleVecchio.pubblica({
          tipo: "argomento-archiviato",
          titolo: chiuso.titolo,
          proseguito: passaggio.ripeti !== undefined,
        });
      }

      const canale = (await this.canaleDi(prossimo.id)) ?? canaleVecchio;
      const riaperto = typeof passaggio.verso === "string" && passaggio.verso !== "nuovo";
      const ramo = typeof passaggio.verso === "object";
      // Un ramo comincia con la storia di quello da cui nasce, fino al messaggio che cambia.
      if (ramo && canale !== canaleVecchio) for (const archiviato of passaggio.storia ?? []) canale.riporta(archiviato);
      this.#canale = canale;
      this.#ascoltaIlCanale(canale);
      this.#porta = this.#apriPorta(prossimo, canale);
      // La conversazione dell'altro argomento non ha ancora sentito l'elenco degli archiviati.
      this.#archiviatiDetti = undefined;
      canale.pubblica({
        tipo: "passaggio-argomento",
        riaperto,
        ...(chiuso === "da-dimenticare" ? {} : { archiviato: { id: vecchio.id, titolo: chiuso.titolo } }),
        ...(ramo ? { ramo: true as const } : {}),
      });
      canale.pubblica({ tipo: "impostazioni", impostazioni: this.#o.impostazioni() });
      // Limiti del piano e modelli disponibili non dipendono dall'argomento: valgono da subito.
      const noto = canaleVecchio.ricordato("stato");
      if (noto?.tipo === "stato") {
        const { limiti, modelli } = noto.stato;
        if (limiti !== undefined || modelli !== undefined) {
          canale.pubblica({
            tipo: "stato",
            stato: { ...(limiti === undefined ? {} : { limiti }), ...(modelli === undefined ? {} : { modelli }) },
          });
        }
      }
      for (const seguace of this.#seguaci) {
        seguace.scollega();
        seguace.azzera();
        seguace.scollega = canale.iscrivi(seguace.ricevi);
        seguace.storiaInviata(canale.indice);
      }
      if (riaperto) this.#porta.annota(NOTA_RIAPERTO);
      if (ramo) this.#porta.annota(notaDelRamo(chiuso === "da-dimenticare" ? undefined : chiuso.titolo));
      riuscito = true;
    } catch (errore) {
      canaleVecchio.pubblica({
        tipo: "errore",
        messaggio: `Non sono riuscito a cambiare argomento: ${errore instanceof Error ? errore.message : String(errore)}`,
      });
    } finally {
      this.#inPassaggio = false;
      for (const ascoltatore of this.#comune.dopoIPassaggi) ascoltatore();
    }
    // Se il passaggio non è riuscito il messaggio che lo aveva chiesto non va riproposto: lo richiederebbe di nuovo.
    const daMandare = [
      ...(riuscito && passaggio.ripeti !== undefined ? [passaggio.ripeti] : []),
      ...this.#inCoda.splice(0),
    ];
    for (const messaggio of daMandare) this.invia(messaggio.testo, messaggio.allegati, messaggio.origine);
  }

  /**
   * La chat parallela si chiude: il suo argomento va tra gli archiviati, o viene dimenticato se è
   * vuoto, la sua conversazione si chiude e la principale smette di tenerla.
   */
  async #compiLaChiusura(passaggio: Passaggio): Promise<void> {
    this.#inPassaggio = true;
    this.#fermato = false;
    const vecchio = this.#aperto();
    try {
      const chiuso = passaggio.daDimenticare
        ? "da-dimenticare"
        : { titolo: passaggio.titolo ?? titoloDiRipiego(this.#canale), riassunto: passaggio.riassunto ?? "" };
      this.#porta.chiudi();
      await this.#o.argomenti.chiudiChat(this.#numero, chiuso);
      if (chiuso === "da-dimenticare") {
        this.#comune.canali.delete(vecchio.id);
        await rm(archivioDi(this.#o, vecchio), { force: true });
        await rm(fileDellaVersione(archivioDi(this.#o, vecchio)), { force: true });
      } else {
        this.#canale.pubblica({ tipo: "argomento-archiviato", titolo: chiuso.titolo, proseguito: false });
      }
    } catch (errore) {
      this.#canale.pubblica({
        tipo: "errore",
        messaggio: `Non sono riuscito a chiudere la chat: ${errore instanceof Error ? errore.message : String(errore)}`,
      });
      this.#inPassaggio = false;
      return;
    }
    this.#scollegaAscolto();
    for (const seguace of this.#seguaci) seguace.scollega();
    this.#seguaci.clear();
    this.#inPassaggio = false;
    this.#inCoda.splice(0);
    for (const ascoltatore of this.#comune.dopoIPassaggi) ascoltatore();
    this.#allaChiusura?.();
  }

  #apriPorta(argomento: Argomento, canale: Canale): PortaConversazione {
    const cartella = cartellaDi(this.#o, argomento);
    mkdirSync(cartella, { recursive: true });
    const porta: PortaConversazione = this.#o.apri({
      numero: this.#numero,
      cartella,
      idSessione: argomento.idSessione,
      alEvento: (evento) => this.#alEvento(() => porta, canale, evento),
      // Se non si riesce a salvarlo, alla ripresa l'argomento riparte senza il contesto dell'harness.
      alIdSessione: (id) => void this.#o.argomenti.ricordaSessione(argomento.id, id).catch(() => {}),
    });
    return porta;
  }
}

/** Il numero, nella storia, dell'ultimo messaggio del proprietario. */
function ultimoMessaggioDelProprietario(archiviati: readonly EventoArchiviato[]): number | undefined {
  for (let posto = archiviati.length - 1; posto >= 0; posto -= 1) {
    const archiviato = archiviati[posto];
    if (archiviato?.evento.tipo === "messaggio-proprietario") return archiviato.n;
  }
  return undefined;
}

function archivioDi(opzioni: OpzioniHome, argomento: Argomento): string {
  return argomento.archivio ?? join(opzioni.cartellaArchivi, `${argomento.id}.jsonl`);
}

function cartellaDi(opzioni: OpzioniHome, argomento: Argomento): string {
  return argomento.cartella ?? join(resolve(opzioni.radiceProgetti), CARTELLA_HOME, argomento.id);
}

/**
 * La storia di un argomento fino a prima di un messaggio del proprietario, come la riceve il ramo
 * che ne nasce: senza ciò che riguarda solo l'argomento di prima, e con i messaggi che non si
 * possono più modificare, perché nella copia della conversazione hanno un altro identificativo.
 * Undefined se il messaggio non c'è.
 */
export function storiaPrimaDi(archiviati: readonly EventoArchiviato[], idMessaggio: string): EventoArchiviato[] | undefined {
  const posizione = archiviati.findIndex(({ evento }) => evento.tipo === "messaggio-proprietario" && evento.id === idMessaggio);
  if (posizione < 0) return undefined;
  const storia: EventoArchiviato[] = [];
  let turniAperti = 0;
  for (const archiviato of archiviati.slice(0, posizione)) {
    const { evento } = archiviato;
    if (evento.tipo === "passaggio-argomento" || evento.tipo === "argomento-archiviato" || evento.tipo === "riavvolto") continue;
    if (evento.tipo === "turno-iniziato") turniAperti += 1;
    if (evento.tipo === "turno-concluso") turniAperti = Math.max(0, turniAperti - 1);
    if (evento.tipo === "messaggio-proprietario" && evento.modificabile === true) {
      const { modificabile: _non, ...resto } = evento;
      storia.push({ ...archiviato, evento: resto });
    } else {
      storia.push(archiviato);
    }
  }
  // Il messaggio era entrato in un turno già cominciato: nel ramo quel turno finisce lì.
  const quando = archiviati[posizione]?.quando ?? new Date().toISOString();
  for (; turniAperti > 0; turniAperti -= 1) storia.push({ n: 0, quando, evento: { tipo: "turno-concluso", riuscito: true, durataMs: 0 } });
  return storia;
}

/** Il titolo di un argomento che Claude non ha potuto intitolare: l'inizio della prima richiesta. */
function titoloDiRipiego(canale: Canale): string {
  for (const { evento } of canale.archiviati) {
    if (evento.tipo !== "messaggio-proprietario") continue;
    const testo = evento.testo.replace(/\s+/g, " ").trim();
    if (testo !== "") return testo.length <= 60 ? testo : `${testo.slice(0, 57)}…`;
  }
  return "Senza titolo";
}
