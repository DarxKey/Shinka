/**
 * Il ponte tra Telegram e Shinka, dal lato del centro.
 *
 * Il bot lo tiene il gateway, che ascolta solo il proprietario. Qui arriva ciò che lui scrive e
 * i pulsanti che preme, e da qui parte ciò che gli va detto:
 *
 * - un suo messaggio va alla Home, come se lo avesse scritto nell'interfaccia; quando il turno
 *   si chiude gli torna il testo finale, senza il dettaglio delle azioni;
 * - una richiesta che aspetta lui, il consenso a un'azione o l'approvazione di un comando su un
 *   host, gli arriva con due pulsanti. La decisione percorre la stessa strada di quella presa
 *   nell'interfaccia, e il messaggio dice com'è finita, ovunque sia stata presa;
 * - quando un progetto finisce un lavoro, o si ferma ad aspettare una risposta, lo viene a sapere.
 *
 * Per non disturbare chi sta già guardando: una richiesta parte subito se nessuna pagina ha
 * quella conversazione aperta, altrimenti solo se dopo un po' è ancora lì; la fine di un lavoro
 * si annuncia se nessuno guardava, o se il lavoro è stato lungo.
 */

import type { CanaleAvviso, GenereAvviso } from "../protocollo/avvisi.ts";
import { randomBytes } from "node:crypto";
import { dettaglioDi, etichettaDi } from "../protocollo/azioni-in-parole.ts";
import type { Domanda, EventoConversazione } from "../protocollo/eventi.ts";
import type { Impegno, ImpostazioniConversazione, ModoPermessi } from "../protocollo/impostazioni.ts";
import {
  testoPerTelegram,
  type EsitoTelegram,
  type EventoTelegram,
  type MessaggioTelegram,
  type TelegramDalCentro,
} from "../protocollo/telegram.ts";
import { consensoDato, type Approvazioni } from "./approvazioni.ts";
import type { Canale } from "./canale.ts";
import type { PortaGateway } from "./gateway.ts";
import type { Home } from "./home.ts";
import type { LavoriDeiProgetti } from "./lavori.ts";
import { chiaveDellaHome } from "./strumenti-comuni.ts";
import type { SviluppoDiShinka } from "./sviluppo.ts";
import type { Estensioni } from "./estensioni.ts";
import { contenutoInRighe, definizioneInChiaro, tipoInParole } from "../protocollo/estensioni.ts";
import { accorcia, aPezzi, inFormatoTelegram, senzaImmagini } from "./telegram-testo.ts";
import { immaginiDelTesto, type ImmaginiEsterne } from "./immagini-esterne.ts";
import { genereDi, tipoMimeDi } from "../protocollo/elaborati.ts";
import { FILE_TELEGRAM_MASSIMO } from "../protocollo/telegram.ts";
import type { Elaborati } from "./elaborati.ts";
import { mkdir } from "node:fs/promises";
import { messaggioDeiFile, salvaSenzaSovrascrivere, type FileSalvato } from "./file-ricevuti.ts";
import type { PosizioneDelProprietario } from "./posizione.ts";
import { leggiPosizione, messaggioDellaPosizione } from "../protocollo/posizione.ts";

/** Un elaborato da mandare al proprietario: un file della cartella di un argomento, in un ambiente. */
export interface ElaboratoPerTelegram {
  idArgomento: string;
  idAmbiente: string;
  percorso: string;
  /** Una riga sotto il file, se il nome non basta. */
  titolo?: string;
}

/** Le immagini che Telegram sa mostrare come foto; le altre arrivano come documento. */
const COME_FOTO = /\.(png|jpe?g|webp)$/i;

/** Il nome con cui il ponte tiene il conto della Home, accanto agli identificativi dei progetti. */
const HOME = "home";

/** Quanto di un comando o di un'azione sta in un messaggio: oltre, si decide dall'interfaccia. */
const DETTAGLIO_MASSIMO = 2500;

/** Quanto del resoconto di un progetto entra nell'avviso. */
const RESOCONTO_MASSIMO = 1500;

export interface OpzioniPonte {
  gateway: PortaGateway;
  home: Home;
  lavori: LavoriDeiProgetti;
  /** Le approvazioni dei comandi sugli host per gli stack, se in questa installazione ci sono. */
  approvazioni?: Approvazioni;
  /** Lo sviluppo di Shinka, se in questa installazione c'è: proposte e installazioni si decidono anche da qui. */
  sviluppo?: Pick<SviluppoDiShinka, "conferma" | "annulla" | "decidi">;
  /** Le estensioni, se in questa installazione ci sono: le proposte si decidono anche da qui. */
  estensioni?: Pick<Estensioni, "conferma" | "annulla">;
  /** Gli elaborati degli argomenti: quelli mostrati dalla Home arrivano anche su Telegram. */
  elaborati?: Pick<Elaborati, "leggi">;
  /** Le immagini scritte nel testo di una risposta: arrivano dopo il testo, come foto. Senza, restano fuori. */
  immaginiEsterne?: Pick<ImmaginiEsterne, "leggi">;
  /**
   * Gli stessi avvisi, per le notifiche dell'app: una richiesta che aspetta il proprietario, un
   * lavoro finito, la risposta di un lavoro programmato. Partono anche se Telegram non è abbinato.
   * Le risposte a ciò che il proprietario ha scritto da Telegram restano su Telegram.
   */
  avvisa?: (avviso: AvvisoDelPonte) => void;
  /**
   * Ciò che il proprietario ha scelto di ricevere su ciascun canale, per genere di avviso. Senza,
   * tutto arriva dappertutto. Ciò che nasce da un messaggio scritto su Telegram ha comunque lì
   * la sua risposta e le sue richieste.
   */
  vuole?: (canale: CanaleAvviso, genere: GenereAvviso) => boolean;
  /** I lavori programmati: la loro fine la annunciano loro, con `annunciaProgrammato`, non l'avviso solito. */
  programmati?: { inCorsoIn(conversazione: string): boolean };
  /** Quanto si aspetta che arrivino gli altri file di un album prima di passarli alla Home. */
  attesaAlbumMs?: number;
  /** Dove sta la posizione che il proprietario condivide. Senza, le posizioni da Telegram si ignorano. */
  posizione?: PosizioneDelProprietario;
  /** Per quanti secondi una richiesta al gateway aspetta che il proprietario scriva qualcosa. */
  attesaEventiS?: number;
  /** Dopo quanto una richiesta ancora in attesa parte anche se una pagina ha la conversazione aperta. */
  ritardoRichiesteMs?: number;
  /** Da quanto in su un lavoro è lungo: la sua fine si annuncia anche se una pagina era aperta. */
  lavoroLungoMs?: number;
  /** Quanto si aspetta prima di richiedere al gateway che non ha risposto. */
  pausaMs?: number;
  /** Oltre questa età un messaggio arrivato tardi non viene più passato alla Home. */
  messaggioVecchioMs?: number;
  adesso?: () => number;
}

/** Un avviso come il ponte lo dà a chi manda le notifiche dell'app: in testo semplice. */
export interface AvvisoDelPonte {
  titolo: string;
  corpo: string;
  /** "home", oppure l'identificativo di un progetto. */
  conversazione: string;
  /** Vero se qualcosa aspetta il proprietario. */
  urgente: boolean;
}

/** Un testo scritto per Telegram, senza i suoi segni: per chi lo mostra come testo semplice. */
export function senzaSegni(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

/** Ciò che il ponte ricorda di una conversazione mentre lavora. */
interface Seguita {
  /** L'ultimo testo scritto da Claude nel turno in corso. */
  ultimoTesto: string;
  /** Da quando la conversazione sta lavorando. */
  alLavoroDal: number | undefined;
  /** Vero se il lavoro in corso è cominciato con un messaggio arrivato da Telegram. */
  daTelegram: boolean;
  /** Gli elaborati mostrati nel lavoro in corso: se è cominciato da Telegram, arrivano lì dopo il testo. */
  elaborati: ElaboratoPerTelegram[];
}

/** Una richiesta che aspetta il proprietario. */
interface Richiesta {
  /** Il nome breve che viaggia nei pulsanti. */
  corto: string;
  tipo: "permesso" | "domande" | "approvazione" | "sviluppo" | "installazione" | "estensione";
  conversazione: string;
  id: string;
  /** Il testo del messaggio, nei segni di formato di Telegram. */
  testo: string;
  /** Falso se ciò che va deciso non sta per intero nel messaggio: allora si decide dall'interfaccia. */
  conPulsanti: boolean;
  parole: [si: string, no: string];
  timer?: NodeJS.Timeout;
  /** Il messaggio su Telegram, una volta mandato. */
  messaggio?: number;
  /** Com'è finita, se è finita prima che il messaggio fosse mandato. */
  esito?: string;
  /** Vero se nasce da un messaggio che il proprietario ha scritto su Telegram: lì arriva comunque. */
  daTelegram?: true;
}

/**
 * Le domande di Claude in un messaggio: ciascuna con le sue risposte numerate. Il proprietario
 * risponde a parole, con un messaggio, e quello arriva a chi le ha poste.
 */
export function testoDelleDomande(chi: string, domande: Domanda[], rispondeDaQui: boolean): string {
  const righe = [`<b>${testoPerTelegram(`${chi} ti chiede`)}</b>`];
  for (const [indice, voce] of domande.entries()) {
    const numero = domande.length > 1 ? `${indice + 1}. ` : "";
    righe.push("", `<b>${testoPerTelegram(`${numero}${accorcia(voce.domanda, 500)}`)}</b>${voce.piuScelte ? " <i>(anche più di una)</i>" : ""}`);
    for (const [quale, opzione] of voce.opzioni.entries()) {
      const descrizione = opzione.descrizione === undefined ? "" : ` · ${testoPerTelegram(accorcia(opzione.descrizione, 200))}`;
      righe.push(`${String.fromCharCode(97 + quale)}) ${testoPerTelegram(accorcia(opzione.etichetta, 200))}${descrizione}`);
    }
  }
  righe.push(
    "",
    rispondeDaQui
      ? "Rispondi con un messaggio, a parole tue (per esempio «1a, 2 b e c»), oppure dalla scheda nell'interfaccia di Shinka."
      : "Rispondi dalla scheda nell'interfaccia di Shinka: i messaggi da qui vanno alla Home.",
  );
  return righe.join("\n");
}

function minuti(ms: number): string {
  const quanti = Math.max(1, Math.round(ms / 60_000));
  return quanti === 1 ? "un minuto" : `${quanti} minuti`;
}

/** Quante immagini di una risposta arrivano su Telegram come foto. */
const IMMAGINI_PER_RISPOSTA = 10;

export class PonteTelegram {
  readonly #o: OpzioniPonte;
  readonly #seguite = new Map<string, Seguita>();
  readonly #richieste = new Map<string, Richiesta>();
  readonly #perId = new Map<string, Richiesta>();
  /** Le approvazioni che non sono comandi ma credenziali in chiaro da salvare: l'esito si dice in altre parole. */
  readonly #credenziali = new Set<string>();
  /** Così le proposte di un lavoro programmato. */
  readonly #programmatiProposti = new Set<string>();
  readonly #scollega: (() => void)[] = [];
  #stato: TelegramDalCentro = { condizione: "non-disponibile" };
  #chiuso = false;
  /** I messaggi partono uno alla volta, nell'ordine in cui sono nati. */
  #coda: Promise<unknown> = Promise.resolve();
  /** I file appena arrivati, raccolti per album finché non smettono di arrivare. */
  readonly #fileInArrivo = new Map<string, { eventi: Extract<EventoTelegram, { tipo: "file" }>[]; timer: NodeJS.Timeout | undefined }>();
  /** Gli elaborati già mandati nel lavoro in corso della Home: alla fine non si rimandano. */
  readonly #mandatiNelLavoro = new Set<string>();
  #battito: NodeJS.Timeout | undefined;
  /** Vero mentre un messaggio arrivato da Telegram aspetta di essere riproposto in un altro argomento. */
  #daRiproporre = false;
  #svegliaPausa: (() => void) | undefined;

  constructor(opzioni: OpzioniPonte) {
    this.#o = opzioni;
  }

  /** Comincia ad ascoltare il gateway, la Home e i progetti. */
  avvia(): void {
    this.#scollega.push(this.#o.home.ascolta(({ evento }) => this.#evento(HOME, evento)));
    this.#scollega.push(this.#o.lavori.ascolta((idProgetto, { evento }) => this.#evento(idProgetto, evento)));
    void this.#ascolta();
  }

  /**
   * Manda al proprietario un elaborato su Telegram, dopo ciò che è già in coda. Restituisce il motivo
   * se non ci è riuscito. Nello stesso lavoro della Home lo stesso file non parte due volte.
   */
  async inviaElaborato(elaborato: ElaboratoPerTelegram): Promise<string | undefined> {
    this.#mandatiNelLavoro.add(chiaveDi(elaborato));
    const elaborati = this.#o.elaborati;
    if (elaborati === undefined) return "In questa installazione di Shinka gli elaborati non ci sono.";
    const titolo = elaborato.titolo?.trim();
    // Il file si legge al suo turno nella coda: così arriva nell'ordine in cui è stato chiesto.
    const invio = this.#coda.then(async (): Promise<EsitoTelegram> => {
      const letto = await elaborati.leggi(elaborato.idArgomento, elaborato.idAmbiente, elaborato.percorso, FILE_TELEGRAM_MASSIMO);
      if (!("dati" in letto)) return { esito: "rifiutato", motivo: letto.problema };
      return this.#o.gateway.telegramInviaFile(
        {
          nome: elaborato.percorso.split("/").pop() ?? elaborato.percorso,
          tipo: tipoMimeDi(elaborato.percorso),
          ...(titolo === undefined || titolo === "" ? {} : { didascalia: titolo }),
          ...(genereDi(elaborato.percorso) === "immagine" && COME_FOTO.test(elaborato.percorso) ? { comeFoto: true } : {}),
        },
        letto.dati,
      );
    });
    this.#coda = invio.catch(() => {});
    const esito = await invio;
    return esito.esito === "inviato" ? undefined : esito.motivo;
  }

  /** Telegram com'era l'ultima volta che il gateway lo ha detto. */
  get stato(): TelegramDalCentro {
    return this.#stato;
  }

  chiudi(): void {
    this.#chiuso = true;
    for (const scollega of this.#scollega.splice(0)) scollega();
    for (const richiesta of this.#richieste.values()) clearTimeout(richiesta.timer);
    this.#richieste.clear();
    this.#perId.clear();
    this.#smettiDiScrivere();
    this.#svegliaPausa?.();
  }

  #adesso(): number {
    return this.#o.adesso?.() ?? Date.now();
  }

  // ── Dal proprietario a Shinka ─────────────────────────────────────────────

  async #ascolta(): Promise<void> {
    let dopo = 0;
    // La prima richiesta non aspetta: serve a sapere subito in che stato è il bot.
    let attesa = 0;
    while (!this.#chiuso) {
      const letto = await this.#o.gateway.telegramEventi(dopo, attesa);
      if (this.#chiuso) return;
      attesa = this.#o.attesaEventiS ?? 25;
      if (letto === undefined) {
        this.#stato = { condizione: "non-disponibile" };
        await new Promise<void>((fatto) => {
          const timer = setTimeout(fatto, this.#o.pausaMs ?? 5_000);
          timer.unref();
          this.#svegliaPausa = () => {
            clearTimeout(timer);
            fatto();
          };
        });
        continue;
      }
      this.#stato = letto.stato;
      for (const evento of letto.eventi) {
        dopo = Math.max(dopo, evento.n);
        try {
          this.#ricevi(evento);
        } catch (errore) {
          this.#manda({ testo: `Non sono riuscito a farlo: ${accorcia(errore instanceof Error ? errore.message : String(errore), 300)}` });
        }
      }
    }
  }

  #ricevi(evento: EventoTelegram): void {
    if (evento.tipo === "pulsante") return this.#premuto(evento.dato, evento.messaggio);
    if (evento.tipo === "posizione") return this.#posizione(evento);
    if (evento.tipo === "file") return this.#file(evento);
    const eta = this.#adesso() - Date.parse(evento.quando);
    if (Number.isFinite(eta) && eta > (this.#o.messaggioVecchioMs ?? 10 * 60_000)) {
      // Rispondere adesso a una richiesta di molto tempo fa farebbe più danno che dirlo.
      this.#manda({ testo: `Ho ricevuto tardi un tuo messaggio («${accorcia(evento.testo, 80)}»): riscrivilo, se serve ancora.` });
      return;
    }
    this.#o.home.invia(evento.testo, [], "telegram");
  }

  /**
   * Il proprietario ha condiviso la posizione: diventa un suo messaggio alla Home, con il dato e la
   * sua ora. I punti successivi di una posizione dal vivo la aggiornano senza disturbare la Home.
   */
  #posizione(evento: Extract<EventoTelegram, { tipo: "posizione" }>): void {
    const posizione = leggiPosizione(evento.posizione, "telegram");
    const custodia = this.#o.posizione;
    if (posizione === undefined || custodia === undefined) return;
    if (evento.aggiornamento) {
      custodia.aggiorna(posizione);
      return;
    }
    const eta = this.#adesso() - Date.parse(evento.quando);
    if (Number.isFinite(eta) && eta > (this.#o.messaggioVecchioMs ?? 10 * 60_000)) {
      this.#manda({ testo: "Ho ricevuto tardi la tua posizione: rimandala, se serve ancora." });
      return;
    }
    custodia.registra(posizione);
    this.#o.home.invia(messaggioDellaPosizione(posizione), [], "telegram");
  }

  /**
   * Un file mandato dal proprietario. Si aspetta un attimo: i file di un album arrivano uno per
   * uno, e la Home li riceve insieme, in un messaggio solo.
   */
  #file(evento: Extract<EventoTelegram, { tipo: "file" }>): void {
    const chiave = evento.gruppo ?? `da-solo-${evento.n}`;
    const gruppo = this.#fileInArrivo.get(chiave) ?? { eventi: [], timer: undefined };
    gruppo.eventi.push(evento);
    clearTimeout(gruppo.timer);
    gruppo.timer = setTimeout(() => {
      this.#fileInArrivo.delete(chiave);
      void this.#consegnaFile(gruppo.eventi);
    }, this.#o.attesaAlbumMs ?? 1_500);
    gruppo.timer.unref();
    this.#fileInArrivo.set(chiave, gruppo);
  }

  /** Scarica i file dal gateway, li salva nella cartella dell'argomento aperto e li passa alla Home. */
  async #consegnaFile(eventi: Extract<EventoTelegram, { tipo: "file" }>[]): Promise<void> {
    const cartella = this.#o.home.cartellaAperta;
    const salvati: FileSalvato[] = [];
    const persi: string[] = [];
    for (const evento of eventi) {
      const scaricato = await this.#o.gateway.telegramScaricaFile(evento.file.id);
      if (!("dati" in scaricato)) {
        persi.push(`${evento.file.nome}: ${accorcia(scaricato.problema, 200)}`);
        continue;
      }
      try {
        await mkdir(cartella, { recursive: true });
        const nome = await salvaSenzaSovrascrivere(cartella, evento.file.nome, scaricato.dati);
        salvati.push({ file: evento.file, nome, byte: scaricato.dati.length });
      } catch (errore) {
        persi.push(`${evento.file.nome}: ${accorcia(errore instanceof Error ? errore.message : String(errore), 200)}`);
      }
    }
    if (persi.length > 0) this.#manda({ testo: `Non sono riuscito a ricevere ${persi.length === 1 ? "un file" : `${persi.length} file`}:\n${persi.join("\n")}` });
    if (salvati.length === 0) return;
    this.#manda({
      testo: salvati.length === 1 ? `Ricevuto ${salvati[0]?.nome}.` : `Ricevuti ${salvati.length} file: ${salvati.map((salvato) => salvato.nome).join(", ")}.`,
      silenzioso: true,
    });
    const didascalie = eventi.map((evento) => evento.didascalia).filter((testo): testo is string => testo !== undefined);
    this.#o.home.invia(messaggioDeiFile(salvati, cartella, didascalie), [], "telegram");
  }

  #premuto(dato: string, messaggio: number): void {
    const letto = /^r:([\w-]+):([sn])$/.exec(dato);
    const richiesta = letto === null ? undefined : this.#richieste.get(letto[1] ?? "");
    if (richiesta === undefined) {
      // Un pulsante rimasto sotto un messaggio vecchio, per esempio dopo un riavvio del centro.
      this.#modifica(messaggio, { testo: "Questa richiesta non è più in attesa. Se serve ancora, la trovi nell'interfaccia di Shinka." });
      return;
    }
    const si = letto?.[2] === "s";
    const { home, lavori, approvazioni, sviluppo } = this.#o;
    let trovata: boolean;
    if (richiesta.tipo === "estensione") {
      this.#decidiEstensione(richiesta, si);
      return;
    }
    if (richiesta.tipo === "approvazione") {
      trovata = approvazioni?.decidi(richiesta.id, si ? "approvata" : "negata") === true;
    } else if (richiesta.tipo === "installazione") {
      trovata = sviluppo?.decidi(richiesta.id, si ? "approvata" : "negata") === true;
    } else if (richiesta.tipo === "sviluppo") {
      try {
        trovata = si ? sviluppo?.conferma(richiesta.id) !== undefined : sviluppo?.annulla(richiesta.id) === true;
      } catch (errore) {
        // La richiesta non è passata al progetto: la proposta resta in attesa nell'interfaccia.
        this.#manda({ testo: `La proposta non è partita: ${accorcia(errore instanceof Error ? errore.message : String(errore), 300)}` });
        return;
      }
    } else if (richiesta.conversazione === HOME) {
      const decisione = si ? "approvato" : "negato";
      consensoDato(approvazioni, chiaveDellaHome(home.idArgomentoAperto), home.canale, richiesta.id, decisione);
      trovata = home.decidiPermesso(richiesta.id, decisione);
    } else {
      const decisione = si ? "approvato" : "negato";
      consensoDato(approvazioni, richiesta.conversazione, lavori.canale(richiesta.conversazione), richiesta.id, decisione);
      trovata = lavori.decidiPermesso(richiesta.conversazione, richiesta.id, decisione);
    }
    // Se la decisione è arrivata, a chiudere il messaggio è l'evento che ne nasce.
    if (!trovata) this.#decisa(richiesta.tipo, richiesta.id, "Non era più in attesa.");
  }

  /**
   * Il proprietario ha deciso di un'estensione. Confermata, l'ambiente la prova, e ci vuole un
   * momento: intanto il messaggio lo dice, senza pulsanti. A chiuderlo è l'evento che ne nasce;
   * se manca solo qualcosa che il proprietario può mettere a posto, i pulsanti tornano.
   */
  #decidiEstensione(richiesta: Richiesta, si: boolean): void {
    const { estensioni } = this.#o;
    const nonPiu = (): void => this.#decisa("estensione", richiesta.id, "Non era più in attesa.");
    if (estensioni === undefined) return nonPiu();
    if (!si) {
      if (!estensioni.annulla(richiesta.id)) nonPiu();
      return;
    }
    const aggiorna = (nota: string, conPulsanti: boolean): void => {
      if (richiesta.messaggio === undefined || richiesta.esito !== undefined) return;
      this.#modifica(richiesta.messaggio, {
        testo: `${richiesta.testo}\n\n${testoPerTelegram(nota)}`,
        html: true,
        ...(conPulsanti
          ? {
              pulsanti: [
                [
                  { testo: richiesta.parole[0], dato: `r:${richiesta.corto}:s` },
                  { testo: richiesta.parole[1], dato: `r:${richiesta.corto}:n` },
                ],
              ],
            }
          : {}),
      });
    };
    aggiorna("La sto provando nel suo ambiente…", false);
    void estensioni.conferma(richiesta.id).then(
      (esito) => {
        if (esito === undefined) return nonPiu();
        if (esito.stato === "da-riprovare") aggiorna(`Non ancora: ${accorcia(esito.motivo, 500)} Quando è a posto, conferma di nuovo.`, true);
      },
      (errore: unknown) => aggiorna(`Non ci sono riuscito: ${accorcia(errore instanceof Error ? errore.message : String(errore), 300)}`, true),
    );
  }

  // ── Da Shinka al proprietario ─────────────────────────────────────────────

  #seguita(conversazione: string): Seguita {
    let seguita = this.#seguite.get(conversazione);
    if (seguita === undefined) {
      seguita = { ultimoTesto: "", alLavoroDal: undefined, daTelegram: false, elaborati: [] };
      this.#seguite.set(conversazione, seguita);
    }
    return seguita;
  }

  #canale(conversazione: string): Canale | undefined {
    return conversazione === HOME ? this.#o.home.canale : this.#o.lavori.canale(conversazione);
  }

  /** Chi sta chiedendo, in parole. */
  #chi(conversazione: string): string {
    if (conversazione === HOME) return "La Home";
    const nome = this.#o.lavori.stato().progetti.find((progetto) => progetto.id === conversazione)?.nome;
    return nome === undefined ? "Un progetto" : `Il progetto «${nome}»`;
  }

  #evento(conversazione: string, evento: EventoConversazione): void {
    const seguita = this.#seguita(conversazione);
    switch (evento.tipo) {
      case "messaggio-proprietario":
        if (conversazione === HOME) this.#daRiproporre = false;
        if (conversazione === HOME && evento.origine === "telegram") {
          seguita.daTelegram = true;
          this.#cominciaAScrivere();
        }
        break;
      case "turno-iniziato":
        if (seguita.alLavoroDal === undefined) {
          seguita.alLavoroDal = this.#adesso();
          seguita.ultimoTesto = "";
        }
        break;
      case "testo-concluso":
        if (evento.testo.trim() !== "") seguita.ultimoTesto = evento.testo;
        break;
      case "elaborato-mostrato":
        if (conversazione === HOME && seguita.daTelegram && !seguita.elaborati.some((gia) => chiaveDi(gia) === chiaveDi(evento))) {
          seguita.elaborati.push({
            idArgomento: evento.idArgomento,
            idAmbiente: evento.idAmbiente,
            percorso: evento.percorso,
            ...(evento.titolo === undefined ? {} : { titolo: evento.titolo }),
          });
        }
        break;
      case "permesso-richiesto": {
        const dettaglio = dettaglioDi(evento.strumento, evento.ingresso).trim();
        const intero = dettaglio.length <= DETTAGLIO_MASSIMO;
        this.#chiedi(conversazione, seguita, {
          tipo: "permesso",
          id: evento.idPermesso,
          parole: ["Consenti", "Nega"],
          conPulsanti: intero,
          testo: [
            `<b>${testoPerTelegram(`${this.#chi(conversazione)} chiede il tuo consenso`)}</b>`,
            testoPerTelegram(etichettaDi(evento.strumento)) + (evento.motivo === undefined ? "" : ` · ${testoPerTelegram(accorcia(evento.motivo, 300))}`),
            ...(dettaglio === "" ? [] : [`<pre>${testoPerTelegram(accorcia(dettaglio, DETTAGLIO_MASSIMO))}</pre>`]),
            ...(intero ? [] : ["È troppo lungo per mostrarlo qui per intero: decidi dall'interfaccia di Shinka, dove si legge tutto."]),
          ].join("\n"),
        });
        break;
      }
      case "permesso-deciso":
        this.#decisa("permesso", evento.idPermesso, evento.decisione === "approvato" ? "Consentito." : "Negato.");
        break;
      case "domande-poste":
        // Alle domande della Home si risponde con un messaggio, che arriva a lei; quelle di un
        // progetto aspettano nell'interfaccia, perché da qui i messaggi vanno alla Home.
        this.#chiedi(conversazione, seguita, {
          tipo: "domande",
          id: evento.idDomande,
          parole: ["", ""],
          conPulsanti: false,
          testo: testoDelleDomande(this.#chi(conversazione), evento.domande, conversazione === HOME),
        });
        break;
      case "domande-chiuse":
        this.#decisa(
          "domande",
          evento.idDomande,
          { risposte: "Hai risposto dall'interfaccia.", "in-chat": "Hai risposto con un messaggio.", saltate: "Le hai saltate.", annullate: "Annullate: non aspettano più." }[evento.esito],
        );
        break;
      case "approvazione-richiesta": {
        // Dove il sì lo raccoglie il gateway, il messaggio con i pulsanti lo manda lui: due sarebbero uno di troppo.
        if (evento.alGateway === true) break;
        if (evento.genere === "programmato") {
          this.#programmatiProposti.add(evento.idApprovazione);
          const resta = Date.parse(evento.scadeIl) - this.#adesso();
          const intera = evento.comando.length <= DETTAGLIO_MASSIMO;
          this.#chiedi(conversazione, seguita, {
            tipo: "approvazione",
            id: evento.idApprovazione,
            parole: ["Conferma", "Annulla"],
            conPulsanti: intera,
            testo: [
              `<b>${testoPerTelegram(`${this.#chi(conversazione)}: lavoro programmato da confermare`)}</b>`,
              testoPerTelegram(`«${evento.credenziale}»: ${evento.host}.`),
              `<pre>${testoPerTelegram(accorcia(evento.comando, DETTAGLIO_MASSIMO))}</pre>`,
              intera
                ? `Partirà da solo, con i permessi che la conversazione avrà allora. Hai ${minuti(resta)} per decidere.`
                : "È troppo lungo per mostrarlo qui per intero: decidi dall'interfaccia di Shinka, dove si legge tutto.",
            ].join("\n"),
          });
          break;
        }
        if (evento.genere === "credenziale") {
          this.#credenziali.add(evento.idApprovazione);
          const resta = Date.parse(evento.scadeIl) - this.#adesso();
          this.#chiedi(conversazione, seguita, {
            tipo: "approvazione",
            id: evento.idApprovazione,
            parole: ["Salva", "Non salvare"],
            conPulsanti: true,
            testo: [
              `<b>${testoPerTelegram(`${this.#chi(conversazione)}: credenziale in chiaro da salvare`)}</b>`,
              testoPerTelegram(`«${evento.credenziale}», per ${evento.host}. ${evento.comando}`),
              testoPerTelegram("Claude potrà rileggerne il valore: salvala solo se è di prova o a basso rischio."),
              `Hai ${minuti(resta)}: poi scade, e non viene salvata.`,
            ].join("\n"),
          });
          break;
        }
        const intero = evento.comando.length <= DETTAGLIO_MASSIMO;
        const resta = Date.parse(evento.scadeIl) - this.#adesso();
        this.#chiedi(conversazione, seguita, {
          tipo: "approvazione",
          id: evento.idApprovazione,
          parole: ["Approva", "Nega"],
          conPulsanti: intero,
          testo: [
            `<b>${testoPerTelegram(`${this.#chi(conversazione)}: comando da approvare`)}</b>`,
            testoPerTelegram(`Su ${evento.host}, con la credenziale ${evento.credenziale}.`),
            `<pre>${testoPerTelegram(accorcia(evento.comando, DETTAGLIO_MASSIMO))}</pre>`,
            intero
              ? `Hai ${minuti(resta)}: poi scade, e non viene eseguito.`
              : "È troppo lungo per mostrarlo qui per intero: approvalo dall'interfaccia di Shinka, dove si legge tutto.",
          ].join("\n"),
        });
        break;
      }
      case "approvazione-decisa":
        this.#decisa(
          "approvazione",
          evento.idApprovazione,
          this.#credenziali.delete(evento.idApprovazione)
            ? { approvata: "Salvata nel vault.", negata: "Non salvata.", scaduta: "Scaduta: non è stata salvata." }[evento.esito]
            : this.#programmatiProposti.delete(evento.idApprovazione)
              ? { approvata: "Confermato: il lavoro è programmato.", negata: "Annullato: non è stato programmato.", scaduta: "Scaduta: non è stato programmato." }[evento.esito]
              : { approvata: "Approvato.", negata: "Negato: il comando non è stato eseguito.", scaduta: "Scaduta: il comando non è stato eseguito." }[evento.esito],
        );
        break;
      case "sviluppo-proposto": {
        const intera = evento.richiesta.length <= DETTAGLIO_MASSIMO;
        this.#chiedi(conversazione, seguita, {
          tipo: "sviluppo",
          id: evento.idProposta,
          parole: ["Conferma", "Annulla"],
          conPulsanti: intera,
          testo: [
            `<b>${testoPerTelegram(`Sviluppo di Shinka: ${evento.titolo}`)}</b>`,
            testoPerTelegram(accorcia(evento.richiesta, DETTAGLIO_MASSIMO)),
            intera
              ? "Se confermi, la richiesta passa al progetto Shinka, che ci lavora. Non viene installato nulla senza una tua seconda approvazione."
              : "È troppo lunga per mostrarla qui per intero: decidi dall'interfaccia di Shinka, dove si legge tutta.",
            ...(evento.impostazioni === undefined
              ? []
              : [
                  testoPerTelegram(
                    `Confermando da qui lavora con le impostazioni di sempre: ${impostazioniInParole(evento.impostazioni)}. Per sceglierne altre per questo lavoro, conferma dall'interfaccia.`,
                  ),
                ]),
          ].join("\n"),
        });
        break;
      }
      case "sviluppo-deciso":
        this.#decisa(
          "sviluppo",
          evento.idProposta,
          evento.esito === "confermata" ? "Confermata: il progetto Shinka ci sta lavorando." : "Annullata: non è partito nulla.",
        );
        break;
      case "estensione-proposta": {
        const chiaro = definizioneInChiaro(evento.definizione).join("\n");
        const contenuto = evento.contenuto === undefined ? [] : contenutoInRighe(evento.contenuto);
        // Si decide da qui solo se qui si legge tutto ciò che la scheda dice.
        const intera =
          chiaro.length + contenuto.join("\n").length <= DETTAGLIO_MASSIMO && evento.avvisi.length <= 8 && evento.avvisi.every((avviso) => avviso.length <= 500);
        this.#chiedi(conversazione, seguita, {
          tipo: "estensione",
          id: evento.idProposta,
          parole: ["Conferma", "Annulla"],
          conPulsanti: intera,
          testo: [
            `<b>${testoPerTelegram(`Estensione da ${evento.giaInElenco === true ? "accendere" : "installare"}: ${evento.nome}`)}</b>`,
            testoPerTelegram(`${tipoInParole(evento.definizione.tipo)}, nell'ambiente «${evento.nomeAmbiente}».`),
            testoPerTelegram(accorcia(evento.descrizione, 600)),
            `<pre>${testoPerTelegram(accorcia(chiaro, DETTAGLIO_MASSIMO))}</pre>`,
            ...(contenuto.length === 0 ? [] : [testoPerTelegram(accorcia(contenuto.map((riga) => `• ${riga}`).join("\n"), DETTAGLIO_MASSIMO))]),
            ...(evento.chiavi.length === 0 ? [] : [testoPerTelegram(`Chiavi dal vault: ${evento.chiavi.join(", ")}.`)]),
            ...evento.avvisi.slice(0, 8).map((avviso) => `⚠️ ${testoPerTelegram(accorcia(avviso, 500))}`),
            intera
              ? "Se confermi, l'ambiente la avvia una volta: viene accesa solo se parte. Finché non confermi non viene installato né avviato nulla."
              : "È troppo lunga per mostrarla qui per intero: decidi dall'interfaccia di Shinka, dove si legge tutta.",
          ].join("\n"),
        });
        break;
      }
      case "estensione-decisa":
        this.#decisa(
          "estensione",
          evento.idProposta,
          evento.esito === "accesa"
            ? `Accesa: è partita${evento.strumenti === undefined || evento.strumenti.length === 0 ? "." : `, con ${evento.strumenti.length === 1 ? "uno strumento" : `${evento.strumenti.length} strumenti`}.`}`
            : evento.esito === "non-partita"
              ? `Non è partita, e non è stata accesa${evento.motivo === undefined ? "." : `: ${accorcia(evento.motivo, 400)}`}`
              : "Annullata: non è stato installato né avviato nulla.",
        );
        break;
      case "installazione-richiesta": {
        const altre = evento.modifiche.length - 8;
        this.#chiedi(conversazione, seguita, {
          tipo: "installazione",
          id: evento.idInstallazione,
          parole: ["Installa", "Nega"],
          conPulsanti: true,
          testo: [
            `<b>${testoPerTelegram(`Shinka: versione ${evento.versione} pronta da installare`)}</b>`,
            "Le prove sono passate.",
            testoPerTelegram(accorcia(evento.riassunto, 1500)),
            ...(evento.modifiche.length === 0
              ? []
              : [
                  testoPerTelegram(
                    evento.modifiche
                      .slice(0, 8)
                      .map((modifica) => `• ${accorcia(modifica, 120)}`)
                      .join("\n") + (altre > 0 ? `\n… e altre ${altre}` : ""),
                  ),
                ]),
            evento.quantiFile === 1 ? "Cambia un file." : `Cambiano ${evento.quantiFile} file.`,
            ...evento.avvisi.map((avviso) => `⚠️ ${testoPerTelegram(accorcia(avviso, 300))}`),
            "Se la installi, Shinka si riavvia; se la versione nuova non parte, torna quella di prima. La richiesta aspetta finché non decidi.",
          ].join("\n"),
        });
        break;
      }
      case "installazione-decisa":
        this.#decisa(
          "installazione",
          evento.idInstallazione,
          {
            approvata: "Approvata: Shinka si riavvia con la versione nuova.",
            negata: "Negata: non è stata installata.",
            scaduta: "Non aspetta più: ne è arrivata una più recente, o Shinka è ripartita. Non è stata installata.",
          }[evento.esito],
        );
        break;
      case "installazione-conclusa":
        this.#manda({
          testo:
            evento.esito === "installata"
              ? `Shinka è ripartita con la versione ${evento.versione}.`
              : `La versione ${evento.versione} non è partita${evento.motivo === undefined ? "" : ` (${accorcia(evento.motivo, 300)})`}: Shinka è tornata da sola a quella di prima.`,
        });
        break;
      case "turno-concluso":
        this.#lavoroConcluso(conversazione, seguita, evento);
        break;
      case "errore":
        // Il cambio di argomento non è riuscito: il messaggio non verrà riproposto, e va detto.
        if (conversazione === HOME && this.#daRiproporre) {
          this.#daRiproporre = false;
          this.#manda({ testo: `Non sono riuscito a rispondere: ${accorcia(evento.messaggio, 500)}` });
        }
        break;
      default:
        break;
    }
  }

  #lavoroConcluso(conversazione: string, seguita: Seguita, evento: Extract<EventoConversazione, { tipo: "turno-concluso" }>): void {
    const canale = this.#canale(conversazione);
    const ancoraAperti = canale?.sospesi.turni ?? 0;
    const testo = seguita.ultimoTesto.trim();
    const durata = seguita.alLavoroDal === undefined ? 0 : this.#adesso() - seguita.alLavoroDal;
    seguita.ultimoTesto = "";
    if (ancoraAperti === 0) seguita.alLavoroDal = undefined;
    const elaborati = seguita.elaborati;
    if (ancoraAperti === 0) seguita.elaborati = [];
    const giaMandati = new Set(this.#mandatiNelLavoro);
    if (conversazione === HOME && ancoraAperti === 0) this.#mandatiNelLavoro.clear();

    if (conversazione === HOME && seguita.daTelegram) {
      // A ciò che è arrivato da Telegram la Home risponde lì, con il suo testo per intero.
      if (ancoraAperti === 0) {
        seguita.daTelegram = false;
        this.#smettiDiScrivere();
      }
      if (this.#o.home.staCambiandoArgomento) {
        // La richiesta viene riproposta in un altro argomento: la risposta arriverà da lì.
        this.#daRiproporre = true;
        return;
      }
      if (evento.interrotto === true) return void this.#manda({ testo: "Interrotto." });
      if (!evento.riuscito) {
        return void this.#manda({ testo: `Non sono riuscito a rispondere${evento.errore === undefined ? "." : `: ${accorcia(evento.errore, 500)}`}` });
      }
      const daMandare = elaborati.filter((elaborato) => !giaMandati.has(chiaveDi(elaborato)));
      const immagini = immaginiDelTesto(testo);
      const scritto = senzaImmagini(testo);
      if (scritto === "" && daMandare.length === 0 && immagini.length === 0) {
        return void this.#manda({ testo: "Fatto, ma senza una risposta scritta: il dettaglio è nell'interfaccia di Shinka." });
      }
      for (const pezzo of aPezzi(scritto)) this.#manda({ testo: inFormatoTelegram(pezzo), html: true });
      this.#mandaImmagini(immagini);
      // I file mostrati dalla Home arrivano dopo il testo che li accompagna.
      for (const elaborato of daMandare) {
        void this.inviaElaborato(elaborato).then((problema) => {
          if (problema === undefined) return;
          const nome = elaborato.percorso.split("/").pop() ?? elaborato.percorso;
          this.#manda({ testo: `Non sono riuscito a mandarti ${nome}: ${accorcia(problema, 500)}` });
        });
      }
      return;
    }

    // Un lavoro programmato dice da sé com'è finito, anche quando non c'è nulla da dire.
    if (this.#o.programmati?.inCorsoIn(conversazione) === true) return;
    if (ancoraAperti > 0 || evento.interrotto === true) return;
    // Tra un argomento e l'altro la Home lavora per sé: non c'è niente da annunciare.
    if (conversazione === HOME && (this.#o.home.staCambiandoArgomento || (evento.riuscito && testo === ""))) return;
    // Chi stava guardando un lavoro breve lo ha già visto finire.
    if (canale?.seguito === true && durata < (this.#o.lavoroLungoMs ?? 120_000)) return;
    const chi = this.#chi(conversazione);
    const titolo = !evento.riuscito
      ? `${chi} si è fermato per un errore`
      : /\?\s*$/.test(testo)
        ? `${chi} aspetta una tua risposta`
        : `${chi} ha finito`;
    const corpo = evento.riuscito
      ? inFormatoTelegram(accorcia(testo, RESOCONTO_MASSIMO))
      : testoPerTelegram(accorcia(evento.errore ?? "", 500));
    this.#avvisa("lavori", { titolo, corpo: evento.riuscito ? senzaImmagini(testo) : (evento.errore ?? ""), conversazione, urgente: titolo.includes("aspetta") });
    if (this.#vuole("telegram", "lavori")) this.#manda({ testo: `<b>${testoPerTelegram(titolo)}</b>${corpo === "" ? "" : `\n\n${corpo}`}`, html: true });
  }

  /** Un lavoro programmato ha finito: la sua risposta arriva per intero, con il suo titolo in cima. */
  annunciaProgrammato(concluso: { titolo: string; dove: string; testo: string; errore?: string; conversazione?: string }): void {
    const titolo = `Lavoro programmato «${concluso.titolo}» (${concluso.dove})`;
    this.#avvisa("programmati", {
      titolo: concluso.errore === undefined ? titolo : `${titolo}: si è fermato`,
      corpo: concluso.errore ?? (concluso.testo === "" ? "Fatto, senza una risposta scritta." : senzaImmagini(concluso.testo)),
      conversazione: concluso.conversazione ?? HOME,
      urgente: false,
    });
    if (this.#stato.condizione !== "attivo" && this.#stato.condizione !== "errore") return;
    if (!this.#vuole("telegram", "programmati")) return;
    if (concluso.errore !== undefined) {
      return void this.#manda({ testo: `<b>${testoPerTelegram(`${titolo}: si è fermato`)}</b>\n\n${testoPerTelegram(accorcia(concluso.errore, 500))}`, html: true });
    }
    if (concluso.testo === "") {
      return void this.#manda({ testo: `<b>${testoPerTelegram(titolo)}</b>\n\nFatto, ma senza una risposta scritta: il dettaglio è nell'interfaccia di Shinka.`, html: true });
    }
    const pezzi = aPezzi(senzaImmagini(concluso.testo));
    if (pezzi.length === 0) this.#manda({ testo: `<b>${testoPerTelegram(titolo)}</b>`, html: true });
    pezzi.forEach((pezzo, posto) => {
      this.#manda({ testo: `${posto === 0 ? `<b>${testoPerTelegram(titolo)}</b>\n\n` : ""}${inFormatoTelegram(pezzo)}`, html: true });
    });
    this.#mandaImmagini(immaginiDelTesto(concluso.testo));
  }

  /**
   * Le immagini scritte nel testo, dopo il testo, come foto con il loro nome per didascalia: al
   * massimo dieci. Una che non si scarica o che Telegram non accetta resta fuori, senza avvisi:
   * come nell'interfaccia, dove un'immagine che non si carica non si vede.
   */
  #mandaImmagini(immagini: { testo: string; indirizzo: string }[]): void {
    const esterne = this.#o.immaginiEsterne;
    if (esterne === undefined) return;
    for (const [posto, immagine] of immagini.slice(0, IMMAGINI_PER_RISPOSTA).entries()) {
      // Si scaricano subito, tutte insieme; partono al loro turno nella coda, nell'ordine del testo.
      const letta = esterne.leggi(immagine.indirizzo);
      const invio = this.#coda.then(async (): Promise<EsitoTelegram> => {
        const esito = await letta;
        if (!("dati" in esito)) return { esito: "rifiutato", motivo: esito.motivo };
        return this.#o.gateway.telegramInviaFile(
          {
            nome: `immagine-${posto + 1}.${esito.tipo.split("/")[1] === "jpeg" ? "jpg" : (esito.tipo.split("/")[1] ?? "jpg")}`,
            tipo: esito.tipo,
            ...(immagine.testo === "" ? {} : { didascalia: immagine.testo }),
            comeFoto: true,
          },
          esito.dati,
        );
      });
      this.#coda = invio.catch(() => {});
    }
  }

  #vuole(canale: CanaleAvviso, genere: GenereAvviso): boolean {
    return this.#o.vuole?.(canale, genere) ?? true;
  }

  /** Passa un avviso a chi manda le notifiche dell'app, se il proprietario lo vuole lì; un guasto lì non tocca Telegram. */
  #avvisa(genere: GenereAvviso, avviso: AvvisoDelPonte): void {
    if (!this.#vuole("app", genere)) return;
    try {
      this.#o.avvisa?.(avviso);
    } catch {
      // Le notifiche dell'app sono un di più.
    }
  }

  #chiedi(conversazione: string, seguita: Seguita, cosa: Pick<Richiesta, "tipo" | "id" | "testo" | "conPulsanti" | "parole">): void {
    const richiesta: Richiesta = { ...cosa, conversazione, corto: randomBytes(6).toString("base64url"), ...(conversazione === HOME && seguita.daTelegram ? { daTelegram: true as const } : {}) };
    this.#richieste.set(richiesta.corto, richiesta);
    this.#perId.set(`${richiesta.tipo}:${richiesta.id}`, richiesta);
    // Chi ha scritto da Telegram, o non ha la conversazione davanti, lo viene a sapere subito.
    const subito = (conversazione === HOME && seguita.daTelegram) || this.#canale(conversazione)?.seguito !== true;
    richiesta.timer = setTimeout(() => this.#mostra(richiesta), subito ? 0 : (this.#o.ritardoRichiesteMs ?? 20_000));
    richiesta.timer.unref();
  }

  #mostra(richiesta: Richiesta): void {
    // Il titolo è la prima riga; il resto dice che cosa si chiede.
    const [titolo = "", ...resto] = senzaSegni(richiesta.testo).split("\n");
    this.#avvisa("richieste", { titolo, corpo: resto.join("\n").trim(), conversazione: richiesta.conversazione, urgente: true });
    // Senza un proprietario abbinato, su Telegram non c'è nessuno a cui chiedere.
    if (this.#stato.condizione !== "attivo" && this.#stato.condizione !== "errore") return;
    if (richiesta.daTelegram !== true && !this.#vuole("telegram", "richieste")) return;
    const [si, no] = richiesta.parole;
    void this.#manda({
      testo: richiesta.testo,
      html: true,
      ...(richiesta.conPulsanti
        ? {
            pulsanti: [
              [
                { testo: si, dato: `r:${richiesta.corto}:s` },
                { testo: no, dato: `r:${richiesta.corto}:n` },
              ],
            ],
          }
        : {}),
    }).then((esito) => {
      if (esito.esito !== "inviato") return;
      richiesta.messaggio = esito.messaggio;
      // Decisa mentre il messaggio partiva: va chiuso adesso.
      if (richiesta.esito !== undefined) this.#chiudiMessaggio(richiesta);
    });
  }

  /** Una richiesta è stata decisa, da qui o dall'interfaccia, oppure è scaduta. */
  #decisa(tipo: Richiesta["tipo"], id: string, esito: string): void {
    const richiesta = this.#perId.get(`${tipo}:${id}`);
    if (richiesta === undefined) return;
    clearTimeout(richiesta.timer);
    this.#perId.delete(`${tipo}:${id}`);
    this.#richieste.delete(richiesta.corto);
    richiesta.esito = esito;
    if (richiesta.messaggio !== undefined) this.#chiudiMessaggio(richiesta);
  }

  #chiudiMessaggio(richiesta: Richiesta): void {
    if (richiesta.messaggio === undefined || richiesta.esito === undefined) return;
    this.#modifica(richiesta.messaggio, { testo: `${richiesta.testo}\n\n<b>${testoPerTelegram(richiesta.esito)}</b>`, html: true });
  }

  #manda(messaggio: MessaggioTelegram): Promise<EsitoTelegram> {
    const invio = this.#coda.then(() => this.#o.gateway.telegramInvia(messaggio));
    this.#coda = invio.catch(() => {});
    return invio;
  }

  #modifica(idMessaggio: number, messaggio: MessaggioTelegram): void {
    this.#coda = this.#coda.then(() => this.#o.gateway.telegramModifica(idMessaggio, messaggio)).catch(() => {});
  }

  /** Finché la Home lavora a un messaggio arrivato da Telegram, lì si vede che sta scrivendo. */
  #cominciaAScrivere(): void {
    void this.#o.gateway.telegramScrive();
    if (this.#battito !== undefined) return;
    this.#battito = setInterval(() => void this.#o.gateway.telegramScrive(), 4_000);
    this.#battito.unref();
  }

  #smettiDiScrivere(): void {
    clearInterval(this.#battito);
    this.#battito = undefined;
  }
}

function chiaveDi(elaborato: Pick<ElaboratoPerTelegram, "idArgomento" | "idAmbiente" | "percorso">): string {
  return `${elaborato.idArgomento}\n${elaborato.idAmbiente}\n${elaborato.percorso}`;
}

const IMPEGNI_IN_PAROLE: Record<Impegno, string> = { low: "basso", medium: "medio", high: "alto", xhigh: "molto alto", max: "massimo" };
const PERMESSI_IN_PAROLE: Record<ModoPermessi, string> = {
  chiedi: "chiedi sempre",
  "modifiche-libere": "modifiche libere",
  automatico: "automatico",
  "senza-permessi": "senza permessi",
};

/** Modello, effort e permessi in poche parole, per un messaggio. */
export function impostazioniInParole(impostazioni: ImpostazioniConversazione): string {
  const modello = impostazioni.modello === undefined ? "predefinito" : impostazioni.modello.charAt(0).toUpperCase() + impostazioni.modello.slice(1);
  const impegno = impostazioni.impegno === undefined ? "predefinito" : IMPEGNI_IN_PAROLE[impostazioni.impegno];
  return `modello ${modello}, effort ${impegno}, permessi «${PERMESSI_IN_PAROLE[impostazioni.permessi]}»`;
}
