/**
 * Il bot Telegram di Shinka, dal lato del gateway.
 *
 * Il token del bot sta qui, in un file che legge solo il gateway e fuori dal vault cifrato: così
 * il bot funziona anche a vault chiuso, e nessuna conversazione può leggerlo. Qui si decide anche
 * chi è il proprietario: l'account che manda al bot il codice mostrato nella pagina del vault.
 * Da quel momento il bot ascolta solo lui, in chat privata; chiunque altro viene ignorato, senza
 * risposta. Al centro arrivano soltanto i suoi messaggi e i pulsanti che preme, e ciò che il
 * centro manda arriva soltanto a lui: il destinatario lo mette il gateway.
 *
 * I messaggi si leggono chiedendoli a Telegram (long polling): Shinka non è raggiungibile da
 * Internet, e non deve esserlo.
 *
 * Il token non va mai in un messaggio d'errore, nel registro o sulla console.
 */

import { randomInt } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { rename, rm, writeFile } from "node:fs/promises";
import {
  CODICE_TELEGRAM_MS,
  DATO_PULSANTE_MASSIMO,
  DIDASCALIA_TELEGRAM_MASSIMA,
  FILE_RICEVUTO_MASSIMO,
  FILE_TELEGRAM_MASSIMO,
  FOTO_TELEGRAM_MASSIMA,
  nomeFileTelegram,
  PREFISSO_PULSANTE_DEL_GATEWAY,
  PULSANTI_PER_RIGA,
  RIGHE_DI_PULSANTI,
  senzaFormato,
  TENTATIVI_CODICE_TELEGRAM,
  TESTO_PULSANTE_MASSIMO,
  TESTO_TELEGRAM_MASSIMO,
  type EsitoTelegram,
  type EventiTelegram,
  type EventoTelegram,
  type FileTelegram,
  type MessaggioTelegram,
  type FileRicevuto,
  type PosizioneDaTelegram,
  type StatoTelegram,
  type TelegramInVista,
} from "../protocollo/telegram.ts";

/** Dove risponde Telegram, se non viene indicato altro per le prove. */
export const API_DI_TELEGRAM = "https://api.telegram.org";

/** Com'è fatto un token di BotFather: il numero del bot, due punti, una stringa lunga. */
const FORMA_DEL_TOKEN = /^\d{3,20}:[A-Za-z0-9_-]{20,100}$/;

/** Quanti eventi restano in attesa che il centro li legga. */
const EVENTI_IN_ATTESA = 200;

/** Dopo quanto silenzio del centro il bot dice al proprietario che Shinka non risponde. */
const CENTRO_ASSENTE_MS = 90_000;

const SALUTO = "Sono Shinka. Scrivimi qui e ti rispondo dalla Home; qui arrivano anche gli avvisi dei progetti e le richieste di approvazione.";
const ABBINATO = "Abbinato: da ora ascolto solo te. Scrivimi qui e ti rispondo dalla Home di Shinka.";
const SOLO_TESTO = "Da Telegram leggo testo, posizione, documenti, foto, video e audio. Il resto lo trovi nell'interfaccia di Shinka.";
/** Il tasto accanto a quello della posizione, per toglierli tutti e due. */
const ANNULLA_POSIZIONE = "✖️ Annulla";
const POSIZIONE_RICEVUTA = "📍 Posizione ricevuta.";
const TASTIERA_TOLTA = "Fatto: il pulsante della posizione non c'è più.";
const TASTIERA_GIA_LI =
  "Il pulsante della posizione è già sotto il campo di scrittura: se non lo vedi, tocca l'icona della tastiera accanto al campo. Con /nascondi lo togli.";
/** Telegram toglie i tasti sotto il campo solo con un messaggio che lo chiede. */
const TOGLI_TASTIERA = { remove_keyboard: true } as const;
/** Per quanto il centro può chiedere un file che il proprietario ha mandato. */
const FILE_RICORDATO_MS = 24 * 60 * 60 * 1000;
const CHIEDI_POSIZIONE =
  "Tocca il pulsante qui sotto per mandarmi la posizione di adesso. Per condividerla dal vivo usa la graffetta, poi Posizione e «Condividi la posizione in tempo reale».";
/** I comandi che il bot mostra nel suo menu. */
const COMANDI_DEL_BOT = [{ command: "posizione", description: "Manda la tua posizione alla Home" }];
const CENTRO_ASSENTE = "In questo momento Shinka non risponde: il messaggio non è stato consegnato. Riprova tra poco.";

/** Il token o il codice non sono stati accettati: il messaggio dice perché, in parole per il proprietario. */
export class TelegramRifiutato extends Error {}

interface Custodito {
  gettone: string;
  bot: { id: number; nome: string; utente: string };
  proprietario?: { id: number; nome: string; utente?: string; abbinatoIl: string };
}

type Risposta =
  | { ok: true; risultato: unknown }
  | { ok: false; codice: number; descrizione: string; riprovaTra?: number };

export interface OpzioniTelegram {
  /** Il file in cui stanno il token e l'account del proprietario. */
  file: string;
  /** Dove risponde Telegram: si cambia solo nelle prove. */
  api?: string;
  /** Per quanti secondi Telegram tiene aperta una richiesta di messaggi nuovi. */
  attesaSecondi?: number;
  /** Quanto si aspetta prima di riprovare dopo un errore, dato il numero di errori di fila. */
  pausaMs?: (falliti: number) => number;
  adesso?: () => number;
}

function oggetto(valore: unknown): Record<string, unknown> | undefined {
  return typeof valore === "object" && valore !== null ? (valore as Record<string, unknown>) : undefined;
}

function aspetta(ms: number, segnale: AbortSignal): Promise<void> {
  return new Promise((fatto) => {
    if (segnale.aborted) return fatto();
    const timer = setTimeout(fine, ms);
    timer.unref();
    function fine(): void {
      clearTimeout(timer);
      segnale.removeEventListener("abort", fine);
      fatto();
    }
    segnale.addEventListener("abort", fine, { once: true });
  });
}

export class Telegram {
  /** Vero dopo che /posizione ha messo il suo pulsante sotto il campo, finché non viene tolto. */
  #tastieraPosizione = false;
  /** I file mandati dal proprietario che il centro può chiedere, con la loro scadenza. */
  readonly #fileDelProprietario = new Map<string, number>();
  readonly #o: OpzioniTelegram;
  readonly #api: string;
  #dati: Custodito | undefined;
  /** Il lavoro di ascolto in corso: si ferma quando il token cambia o viene tolto. */
  #ascolto: AbortController | undefined;
  /** Il numero del prossimo aggiornamento da chiedere a Telegram. */
  #prossimo = 0;
  #problema: string | undefined;
  #codice: { valore: string; scadeIl: number; sbagliati: number } | undefined;
  #ignorati = 0;
  #ultimoIgnorato: string | undefined;
  #eventi: EventoTelegram[] = [];
  #n: number;
  /** Il centro in attesa di eventi, se c'è. */
  #sveglia: (() => void) | undefined;
  #ultimaRichiesta: number;
  /** Le scritture del file, una alla volta. */
  #scritture: Promise<unknown> = Promise.resolve();
  /** I messaggi che il gateway ha mandato per sé: il centro non li può cambiare. */
  readonly #suoi = new Set<number>();
  /** Chi, nel gateway, riceve i pulsanti che il gateway ha creato per sé. */
  #pulsantiDelGateway: ((dato: string, messaggio: number) => void) | undefined;

  private constructor(opzioni: OpzioniTelegram, dati: Custodito | undefined) {
    this.#o = opzioni;
    this.#api = (opzioni.api ?? API_DI_TELEGRAM).replace(/\/+$/, "");
    this.#dati = dati;
    this.#n = this.#adesso();
    // All'avvio il centro ha qualche momento per farsi vivo prima di essere dato per assente.
    this.#ultimaRichiesta = this.#adesso();
  }

  /** Apre il bot com'era stato lasciato: se il token c'è, ricomincia ad ascoltare. */
  static async apri(opzioni: OpzioniTelegram): Promise<Telegram> {
    let dati: Custodito | undefined;
    if (existsSync(opzioni.file)) {
      try {
        dati = leggiCustodito(JSON.parse(readFileSync(opzioni.file, "utf8")));
      } catch {
        dati = undefined;
      }
    }
    const telegram = new Telegram(opzioni, dati);
    if (dati !== undefined) telegram.#ascolta();
    return telegram;
  }

  #adesso(): number {
    return this.#o.adesso?.() ?? Date.now();
  }

  get stato(): StatoTelegram {
    if (this.#dati === undefined) return { condizione: "da-configurare" };
    const bot = this.#dati.bot.utente;
    if (this.#problema !== undefined) return { condizione: "errore", bot, problema: this.#problema };
    return { condizione: this.#dati.proprietario === undefined ? "da-abbinare" : "attivo", bot };
  }

  /** Ciò che il proprietario vede nella pagina del vault. Il token non c'è. */
  inVista(): TelegramInVista {
    const codice = this.#codiceValido();
    return {
      ...this.stato,
      ...(this.#dati?.proprietario === undefined ? {} : { proprietario: { ...this.#dati.proprietario } }),
      ...(codice === undefined ? {} : { codice: { valore: codice.valore, scadeIl: new Date(codice.scadeIl).toISOString() } }),
      ignorati: this.#ignorati,
      ...(this.#ultimoIgnorato === undefined ? {} : { ultimoIgnorato: this.#ultimoIgnorato }),
    };
  }

  /**
   * Il proprietario scrive il token del bot. Lo si prova con Telegram prima di tenerlo; se è il
   * token di un altro bot, l'abbinamento va rifatto.
   */
  async imposta(scritto: string): Promise<void> {
    const gettone = scritto.trim();
    if (!FORMA_DEL_TOKEN.test(gettone)) {
      throw new TelegramRifiutato("Questo non ha la forma di un token di BotFather: copialo per intero, numero e due punti compresi.");
    }
    const chi = await this.#chiama(gettone, "getMe", {}, 15_000);
    if (!chi.ok) {
      throw new TelegramRifiutato(
        chi.codice === 401 || chi.codice === 404
          ? "Telegram non riconosce questo token: copialo di nuovo da @BotFather."
          : "Telegram non risponde: riprova tra poco.",
      );
    }
    const bot = oggetto(chi.risultato);
    const id = bot?.id;
    const utente = bot?.username;
    if (typeof id !== "number" || typeof utente !== "string") throw new TelegramRifiutato("Telegram ha risposto in un modo che non capisco: riprova.");

    this.#fermaAscolto();
    // Se era stato impostato un indirizzo a cui Telegram spedisce i messaggi, chiederli non funziona.
    await this.#chiama(gettone, "deleteWebhook", {}, 15_000);
    const prima = this.#dati;
    this.#dati = {
      gettone,
      bot: { id, nome: typeof bot?.first_name === "string" ? bot.first_name : utente, utente },
      ...(prima?.proprietario !== undefined && prima.bot.id === id ? { proprietario: prima.proprietario } : {}),
    };
    this.#codice = undefined;
    this.#problema = undefined;
    this.#prossimo = 0;
    await this.#salva();
    this.#ascolta();
    this.#sveglia?.();
  }

  /** Un codice nuovo da mandare al bot: vale per poco e sopporta pochi errori. */
  nuovoCodice(): void {
    if (this.#dati === undefined) throw new TelegramRifiutato("Prima serve il token del bot.");
    if (this.#dati.proprietario !== undefined) throw new TelegramRifiutato("Il bot è già abbinato: scollegalo, se vuoi abbinarne un altro.");
    this.#codice = {
      valore: String(randomInt(0, 1_000_000)).padStart(6, "0"),
      scadeIl: this.#adesso() + CODICE_TELEGRAM_MS,
      sbagliati: 0,
    };
  }

  /** Il bot dimentica il proprietario: finché non viene abbinato di nuovo non ascolta nessuno. */
  async scollega(): Promise<void> {
    if (this.#dati?.proprietario === undefined) return;
    const { proprietario: _tolto, ...resto } = this.#dati;
    this.#dati = resto;
    this.#eventi = [];
    await this.#salva();
    this.#sveglia?.();
  }

  /** Toglie il token: il bot smette di esistere per Shinka. */
  async rimuovi(): Promise<void> {
    this.#fermaAscolto();
    this.#dati = undefined;
    this.#codice = undefined;
    this.#problema = undefined;
    this.#eventi = [];
    await this.#salva();
    this.#sveglia?.();
  }

  /**
   * Ciò che il proprietario ha fatto dopo l'evento `dopo`. Se non c'è nulla aspetta fino a
   * `attesaMs` che arrivi qualcosa, o che lo stato cambi.
   */
  eventi(dopo: number, attesaMs: number): Promise<EventiTelegram> {
    this.#ultimaRichiesta = this.#adesso();
    this.#eventi = this.#eventi.filter((evento) => evento.n > dopo);
    const adesso = (): EventiTelegram => ({ stato: this.stato, eventi: [...this.#eventi] });
    if (this.#eventi.length > 0 || attesaMs <= 0) return Promise.resolve(adesso());
    // Chi aspettava prima lascia il posto: il centro è uno solo.
    this.#sveglia?.();
    return new Promise((pronto) => {
      const fine = (): void => {
        clearTimeout(timer);
        if (this.#sveglia === fine) this.#sveglia = undefined;
        this.#ultimaRichiesta = this.#adesso();
        pronto(adesso());
      };
      const timer = setTimeout(fine, attesaMs);
      timer.unref();
      this.#sveglia = fine;
    });
  }

  /**
   * Il gateway dice chi riceve i pulsanti che crea per sé: quando il proprietario ne preme uno,
   * arriva qui e non al centro.
   */
  ascoltaPulsantiDelGateway(riceve: (dato: string, messaggio: number) => void): void {
    this.#pulsantiDelGateway = riceve;
  }

  /**
   * Manda un messaggio al proprietario. Non lancia mai: l'esito dice com'è andata.
   *
   * `delGateway` è vero solo quando a mandarlo è il gateway per sé: solo allora i pulsanti possono
   * portare il dato riservato, e il messaggio resta fuori dalla portata del centro.
   */
  async invia(messaggio: MessaggioTelegram, delGateway = false): Promise<EsitoTelegram> {
    const pronto = this.#pronto(messaggio, delGateway);
    if ("esito" in pronto) return pronto;
    // Il pulsante della posizione resta appeso finché un messaggio non chiede di toglierlo: lo fa il
    // primo messaggio senza pulsanti suoi, qualunque sia.
    const togli = this.#tastieraPosizione && messaggio.pulsanti === undefined;
    const corpo: Record<string, unknown> = {
      chat_id: pronto.destinatario,
      text: messaggio.testo,
      link_preview_options: { is_disabled: true },
      ...(messaggio.html === true ? { parse_mode: "HTML" } : {}),
      ...(messaggio.silenzioso === true ? { disable_notification: true } : {}),
      ...(messaggio.pulsanti === undefined ? {} : { reply_markup: tastiera(messaggio.pulsanti) }),
      ...(togli ? { reply_markup: TOGLI_TASTIERA } : {}),
    };
    const esito = await this.#consegna(pronto.gettone, "sendMessage", corpo, messaggio);
    if (togli && esito.esito === "inviato") this.#tastieraPosizione = false;
    if (delGateway && esito.esito === "inviato" && esito.messaggio !== 0) this.#suoi.add(esito.messaggio);
    return esito;
  }

  /** Cambia un messaggio già mandato: senza `pulsanti` i pulsanti spariscono. */
  async modifica(idMessaggio: number, messaggio: MessaggioTelegram, delGateway = false): Promise<EsitoTelegram> {
    if (!delGateway && this.#suoi.has(idMessaggio)) {
      return { esito: "rifiutato", motivo: "Questo messaggio è del gateway: non si può cambiare da fuori." };
    }
    const pronto = this.#pronto(messaggio, delGateway);
    if ("esito" in pronto) return pronto;
    const corpo: Record<string, unknown> = {
      chat_id: pronto.destinatario,
      message_id: idMessaggio,
      text: messaggio.testo,
      link_preview_options: { is_disabled: true },
      ...(messaggio.html === true ? { parse_mode: "HTML" } : {}),
      reply_markup: tastiera(messaggio.pulsanti ?? []),
    };
    const esito = await this.#consegna(pronto.gettone, "editMessageText", corpo, messaggio);
    return esito.esito === "inviato" ? { esito: "inviato", messaggio: idMessaggio } : esito;
  }

  /**
   * Manda un file al proprietario: un'immagine come foto, se lo chiede chi la manda e Telegram la
   * accetta, altrimenti come documento. Non lancia mai: l'esito dice com'è andata.
   */
  async inviaFile(file: FileTelegram, contenuto: Buffer): Promise<EsitoTelegram> {
    const dati = this.#dati;
    if (dati === undefined) return { esito: "rifiutato", motivo: "Telegram non è configurato: manca il token del bot." };
    if (dati.proprietario === undefined) return { esito: "rifiutato", motivo: "Il bot non è ancora abbinato al proprietario." };
    const nome = nomeFileTelegram(file.nome);
    if (nome === undefined) return { esito: "rifiutato", motivo: "Il file non ha un nome usabile." };
    if (contenuto.length === 0) return { esito: "rifiutato", motivo: `${nome} è vuoto: Telegram non manda file vuoti.` };
    if (contenuto.length > FILE_TELEGRAM_MASSIMO) {
      return { esito: "rifiutato", motivo: `${nome} è troppo grande per Telegram: un bot può mandare file fino a 50 MB.` };
    }
    const tipo = /^[\w.+-]+\/[\w.+-]+(;.*)?$/.test(file.tipo) ? file.tipo : "application/octet-stream";
    const didascalia = file.didascalia?.trim().slice(0, DIDASCALIA_TELEGRAM_MASSIMA);
    const campi: Record<string, string> = {
      chat_id: String(dati.proprietario.id),
      ...(didascalia === undefined || didascalia === "" ? {} : { caption: didascalia }),
    };
    if (file.comeFoto === true && contenuto.length <= FOTO_TELEGRAM_MASSIMA) {
      const foto = await this.#chiamaConFile(dati.gettone, "sendPhoto", campi, "photo", contenuto, nome, tipo);
      // Una foto che Telegram non accetta come tale (misure, formato) arriva come documento.
      if (foto.ok || foto.codice !== 400) return this.#esitoDi(foto, "file");
    }
    return this.#esitoDi(await this.#chiamaConFile(dati.gettone, "sendDocument", campi, "document", contenuto, nome, tipo), "file");
  }

  /** Fa vedere al proprietario che Shinka sta scrivendo: dura pochi secondi. */
  async scrive(): Promise<void> {
    const dati = this.#dati;
    if (dati?.proprietario === undefined) return;
    await this.#chiama(dati.gettone, "sendChatAction", { chat_id: dati.proprietario.id, action: "typing" }, 10_000);
  }

  /** Smette di ascoltare e libera chi aspettava: allo spegnimento del gateway. */
  ferma(): void {
    this.#fermaAscolto();
    this.#sveglia?.();
  }

  // ── Dentro ────────────────────────────────────────────────────────────────

  #codiceValido(): { valore: string; scadeIl: number; sbagliati: number } | undefined {
    if (this.#codice !== undefined && this.#codice.scadeIl <= this.#adesso()) this.#codice = undefined;
    return this.#codice;
  }

  #pronto(messaggio: MessaggioTelegram, delGateway: boolean): { gettone: string; destinatario: number } | EsitoTelegram {
    const dati = this.#dati;
    if (dati === undefined) return { esito: "rifiutato", motivo: "Telegram non è configurato: manca il token del bot." };
    if (dati.proprietario === undefined) return { esito: "rifiutato", motivo: "Il bot non è ancora abbinato al proprietario." };
    const visibile = messaggio.html === true ? senzaFormato(messaggio.testo) : messaggio.testo;
    if (visibile.trim() === "") return { esito: "rifiutato", motivo: "Il messaggio è vuoto." };
    if (visibile.length > TESTO_TELEGRAM_MASSIMO) return { esito: "rifiutato", motivo: "Il messaggio è troppo lungo per Telegram." };
    const righe = messaggio.pulsanti ?? [];
    const ammessi =
      righe.length <= RIGHE_DI_PULSANTI &&
      righe.every(
        (riga) =>
          riga.length >= 1 &&
          riga.length <= PULSANTI_PER_RIGA &&
          riga.every(
            (pulsante) =>
              pulsante.testo !== "" &&
              pulsante.testo.length <= TESTO_PULSANTE_MASSIMO &&
              pulsante.dato !== "" &&
              Buffer.byteLength(pulsante.dato) <= DATO_PULSANTE_MASSIMO,
          ),
      );
    if (!ammessi) return { esito: "rifiutato", motivo: "I pulsanti del messaggio non sono come Telegram li accetta." };
    // Con quel dato il gateway riconosce i sì che ha chiesto lui: nessun altro può metterlo in un pulsante.
    if (!delGateway && righe.some((riga) => riga.some((pulsante) => pulsante.dato.startsWith(PREFISSO_PULSANTE_DEL_GATEWAY)))) {
      return { esito: "rifiutato", motivo: "Questi pulsanti sono riservati al gateway." };
    }
    return { gettone: dati.gettone, destinatario: dati.proprietario.id };
  }

  async #consegna(gettone: string, metodo: string, corpo: Record<string, unknown>, messaggio: MessaggioTelegram): Promise<EsitoTelegram> {
    let risposta = await this.#chiamaInsistendo(gettone, metodo, corpo);
    if (!risposta.ok && risposta.codice === 400 && messaggio.html === true && /entit|tag/i.test(risposta.descrizione)) {
      // Telegram non ha capito i segni di formato: meglio il testo nudo che nessun messaggio.
      const { parse_mode: _tolto, ...nudo } = corpo;
      risposta = await this.#chiamaInsistendo(gettone, metodo, { ...nudo, text: senzaFormato(messaggio.testo) });
    }
    // Un messaggio che è già com'è non è un errore.
    if (!risposta.ok && risposta.codice === 400 && /not modified/i.test(risposta.descrizione)) return { esito: "inviato", messaggio: 0 };
    return this.#esitoDi(risposta, "messaggio");
  }

  #esitoDi(risposta: Risposta, cosa: "messaggio" | "file"): EsitoTelegram {
    if (risposta.ok) {
      const id = oggetto(risposta.risultato)?.message_id;
      return { esito: "inviato", messaggio: typeof id === "number" ? id : 0 };
    }
    if (risposta.codice === 401 || risposta.codice === 404) {
      return { esito: "fallito", motivo: "Telegram non riconosce più il token del bot: il proprietario deve riscriverlo nella pagina del vault." };
    }
    if (risposta.codice === 403) {
      return { esito: "fallito", motivo: `Telegram non consegna il ${cosa}: il proprietario ha fermato o bloccato il bot.` };
    }
    if (risposta.codice === 413) return { esito: "fallito", motivo: "Telegram dice che il file è troppo grande." };
    if (risposta.codice === 0) return { esito: "fallito", motivo: "Telegram non risponde." };
    return { esito: "fallito", motivo: `Telegram ha rifiutato il ${cosa} (${risposta.codice}).` };
  }

  /**
   * Una chiamata con un file, nel modo in cui Telegram li riceve. Riprova una volta, come le altre.
   * Mandare un file grosso può durare: si aspetta di più.
   */
  async #chiamaConFile(
    gettone: string,
    metodo: string,
    campi: Record<string, string>,
    campoFile: string,
    contenuto: Buffer,
    nome: string,
    tipo: string,
  ): Promise<Risposta> {
    const chiama = (): Promise<Risposta> => {
      const modulo = new FormData();
      for (const [chiave, valore] of Object.entries(campi)) modulo.append(chiave, valore);
      modulo.append(campoFile, new Blob([new Uint8Array(contenuto)], { type: tipo }), nome);
      return this.#chiama(gettone, metodo, modulo, 180_000);
    };
    const prima = await chiama();
    if (prima.ok || (prima.codice !== 429 && prima.codice !== 0)) return prima;
    const attesa = prima.codice === 429 ? Math.min(prima.riprovaTra ?? 1, 20) * 1000 : 1000;
    await new Promise((fatto) => setTimeout(fatto, this.#o.pausaMs === undefined ? attesa : this.#o.pausaMs(1)));
    return chiama();
  }

  /** Una chiamata che riprova una volta: dopo l'attesa che Telegram chiede, o dopo un errore di rete. */
  async #chiamaInsistendo(gettone: string, metodo: string, corpo: Record<string, unknown>): Promise<Risposta> {
    const prima = await this.#chiama(gettone, metodo, corpo, 20_000);
    if (prima.ok || (prima.codice !== 429 && prima.codice !== 0)) return prima;
    const attesa = prima.codice === 429 ? Math.min(prima.riprovaTra ?? 1, 20) * 1000 : 1000;
    await new Promise((fatto) => setTimeout(fatto, this.#o.pausaMs === undefined ? attesa : this.#o.pausaMs(1)));
    return this.#chiama(gettone, metodo, corpo, 20_000);
  }

  async #chiama(
    gettone: string,
    metodo: string,
    corpo: Record<string, unknown> | FormData,
    attesaMs: number,
    segnale?: AbortSignal,
  ): Promise<Risposta> {
    try {
      const scadenza = AbortSignal.timeout(attesaMs);
      const conFile = corpo instanceof FormData;
      // L'indirizzo contiene il token: non va mai scritto in un errore né sulla console.
      const risposta = await fetch(`${this.#api}/bot${gettone}/${metodo}`, {
        method: "POST",
        // Con un file il tipo lo scrive fetch, con il separatore delle parti.
        ...(conFile ? {} : { headers: { "content-type": "application/json" } }),
        body: conFile ? corpo : JSON.stringify(corpo),
        signal: segnale === undefined ? scadenza : AbortSignal.any([segnale, scadenza]),
      });
      const letto = oggetto(await risposta.json()) ?? {};
      if (letto.ok === true) return { ok: true, risultato: letto.result };
      const riprovaTra = oggetto(letto.parameters)?.retry_after;
      return {
        ok: false,
        codice: typeof letto.error_code === "number" ? letto.error_code : risposta.status,
        descrizione: typeof letto.description === "string" ? letto.description : "",
        ...(typeof riprovaTra === "number" ? { riprovaTra } : {}),
      };
    } catch {
      return { ok: false, codice: 0, descrizione: "" };
    }
  }

  #fermaAscolto(): void {
    this.#ascolto?.abort();
    this.#ascolto = undefined;
  }

  /** Chiede a Telegram i messaggi nuovi, senza smettere finché il token non cambia. */
  #ascolta(): void {
    const dati = this.#dati;
    if (dati === undefined) return;
    this.#fermaAscolto();
    const ascolto = new AbortController();
    this.#ascolto = ascolto;
    const secondi = this.#o.attesaSecondi ?? 50;
    const pausa = this.#o.pausaMs ?? ((falliti: number) => Math.min(2 ** falliti, 60) * 1000);
    // Il comando /posizione compare nel menu del bot. Se Telegram non lo accetta, il comando funziona lo stesso.
    void this.#chiama(dati.gettone, "setMyCommands", { commands: COMANDI_DEL_BOT }, 15_000);
    void (async () => {
      let falliti = 0;
      while (!ascolto.signal.aborted) {
        const risposta = await this.#chiama(
          dati.gettone,
          "getUpdates",
          { offset: this.#prossimo, timeout: secondi, allowed_updates: ["message", "edited_message", "callback_query"] },
          (secondi + 15) * 1000,
          ascolto.signal,
        );
        if (ascolto.signal.aborted) return;
        if (risposta.ok) {
          falliti = 0;
          this.#segnala(undefined);
          for (const aggiornamento of Array.isArray(risposta.risultato) ? risposta.risultato : []) {
            const letto = oggetto(aggiornamento);
            if (typeof letto?.update_id !== "number") continue;
            this.#prossimo = Math.max(this.#prossimo, letto.update_id + 1);
            try {
              await this.#ricevi(letto);
            } catch {
              // Un aggiornamento che non si riesce a trattare non deve fermare l'ascolto.
            }
            if (ascolto.signal.aborted) return;
          }
          continue;
        }
        falliti += 1;
        if (risposta.codice === 401 || risposta.codice === 404) {
          this.#segnala("Telegram non riconosce più il token del bot: va riscritto.");
          return;
        }
        if (risposta.codice === 409) {
          this.#segnala("Un altro programma sta leggendo i messaggi di questo bot: Shinka deve essere l'unico a usarlo.");
        } else if (falliti >= 3) {
          this.#segnala("Telegram non risponde: riprovo da solo.");
        }
        await aspetta(risposta.codice === 429 ? Math.min(risposta.riprovaTra ?? 5, 60) * 1000 : pausa(falliti), ascolto.signal);
      }
    })();
  }

  #segnala(problema: string | undefined): void {
    if (this.#problema === problema) return;
    this.#problema = problema;
    this.#sveglia?.();
  }

  #ignora(): void {
    this.#ignorati += 1;
    this.#ultimoIgnorato = new Date(this.#adesso()).toISOString();
  }

  async #ricevi(aggiornamento: Record<string, unknown>): Promise<void> {
    const dati = this.#dati;
    if (dati === undefined) return;
    const premuto = oggetto(aggiornamento.callback_query);
    if (premuto !== undefined) {
      const da = oggetto(premuto.from);
      if (dati.proprietario === undefined || da?.id !== dati.proprietario.id) return this.#ignora();
      // Telegram mostra una rotella sul pulsante finché non gli si risponde.
      void this.#chiama(dati.gettone, "answerCallbackQuery", { callback_query_id: premuto.id }, 10_000);
      const messaggio = oggetto(premuto.message)?.message_id;
      if (typeof premuto.data !== "string" || typeof messaggio !== "number") return;
      if (premuto.data.startsWith(PREFISSO_PULSANTE_DEL_GATEWAY)) {
        // È una risposta data al gateway: resta qui, il centro non la vede e non la può dare.
        this.#pulsantiDelGateway?.(premuto.data, messaggio);
        return;
      }
      this.#accoda({ tipo: "pulsante", dato: premuto.data, messaggio });
      return;
    }

    // Una posizione condivisa dal vivo arriva come lo stesso messaggio, modificato a ogni spostamento.
    const modificato = oggetto(aggiornamento.edited_message);
    const messaggio = oggetto(aggiornamento.message) ?? modificato;
    if (messaggio === undefined) return;
    const da = oggetto(messaggio.from);
    const chat = oggetto(messaggio.chat);
    // Solo persone, e solo in chat privata: in un gruppo leggerebbero anche gli altri.
    if (typeof da?.id !== "number" || da.is_bot === true || chat?.type !== "private" || chat.id !== da.id) return this.#ignora();
    const testo = typeof messaggio.text === "string" ? messaggio.text.trim() : undefined;

    if (dati.proprietario === undefined) {
      const codice = this.#codiceValido();
      const scritto = testo === undefined ? null : /^(?:\/start(?:@\w+)?\s+)?(\d{6})$/.exec(testo);
      if (codice === undefined || scritto === null) return this.#ignora();
      if (scritto[1] !== codice.valore) {
        codice.sbagliati += 1;
        if (codice.sbagliati >= TENTATIVI_CODICE_TELEGRAM) this.#codice = undefined;
        return this.#ignora();
      }
      this.#codice = undefined;
      this.#dati = {
        ...dati,
        proprietario: {
          id: da.id,
          nome: typeof da.first_name === "string" ? da.first_name : "",
          ...(typeof da.username === "string" ? { utente: da.username } : {}),
          abbinatoIl: new Date(this.#adesso()).toISOString(),
        },
      };
      await this.#salva();
      this.#sveglia?.();
      await this.#rispondi(ABBINATO);
      return;
    }

    if (da.id !== dati.proprietario.id) return this.#ignora();
    const centroAssente = (): boolean => this.#sveglia === undefined && this.#adesso() - this.#ultimaRichiesta > CENTRO_ASSENTE_MS;
    const posizione = posizioneDi(messaggio);
    if (posizione !== undefined) {
      // Arrivata la posizione, il pulsante non serve più: si toglie, e il proprietario sa che è arrivata.
      if (this.#tastieraPosizione) await this.#togliTastiera(POSIZIONE_RICEVUTA);
      if (modificato === undefined && centroAssente()) return void (await this.#rispondi(CENTRO_ASSENTE));
      this.#accoda({ tipo: "posizione", posizione, aggiornamento: modificato !== undefined });
      return;
    }
    // Di un messaggio modificato conta solo la posizione: un testo corretto non si rimanda alla Home.
    if (modificato !== undefined) return;
    const file = fileDi(messaggio);
    if (file !== undefined) {
      if (file.byte > FILE_RICEVUTO_MASSIMO) {
        return void (await this.#rispondi(
          `${file.nome} è troppo grande: un bot può ricevere da Telegram file fino a 20 MB. Mandalo diviso in parti, o dall'interfaccia di Shinka.`,
        ));
      }
      if (centroAssente()) return void (await this.#rispondi(CENTRO_ASSENTE));
      // Il centro potrà chiedere il contenuto di questo file, e solo dei file mandati dal proprietario.
      this.#fileDelProprietario.set(file.id, this.#adesso() + FILE_RICORDATO_MS);
      const didascalia = typeof messaggio.caption === "string" && messaggio.caption.trim() !== "" ? messaggio.caption.trim() : undefined;
      const gruppo = typeof messaggio.media_group_id === "string" ? messaggio.media_group_id : undefined;
      this.#accoda({ tipo: "file", file, ...(didascalia === undefined ? {} : { didascalia }), ...(gruppo === undefined ? {} : { gruppo }) });
      return;
    }
    if (testo === undefined || testo === "") return void (await this.#rispondi(SOLO_TESTO));
    if (testo === ANNULLA_POSIZIONE || /^\/nascondi(?:@\w+)?$/i.test(testo)) {
      return void (await this.#togliTastiera(TASTIERA_TOLTA));
    }
    if (/^\/posizione(?:@\w+)?$/i.test(testo)) {
      // Se il pulsante c'è già, non se ne mette un altro.
      if (this.#tastieraPosizione) return void (await this.#chiama(dati.gettone, "sendMessage", { chat_id: dati.proprietario.id, text: TASTIERA_GIA_LI }, 20_000));
      const mostrato = await this.#chiama(
        dati.gettone,
        "sendMessage",
        {
          chat_id: dati.proprietario.id,
          text: CHIEDI_POSIZIONE,
          reply_markup: {
            keyboard: [[{ text: "📍 Invia la mia posizione", request_location: true }], [{ text: ANNULLA_POSIZIONE }]],
            one_time_keyboard: true,
            resize_keyboard: true,
          },
        },
        20_000,
      );
      if (mostrato.ok) this.#tastieraPosizione = true;
      return;
    }
    if (/^\/start(?:@\w+)?(?:\s|$)/.test(testo)) return void (await this.#rispondi(SALUTO));
    // Se il centro tace da un po', il messaggio resterebbe qui senza risposta: meglio dirlo subito.
    if (this.#sveglia === undefined && this.#adesso() - this.#ultimaRichiesta > CENTRO_ASSENTE_MS) {
      return void (await this.#rispondi(CENTRO_ASSENTE));
    }
    this.#accoda({ tipo: "messaggio", testo });
  }

  /** Toglie i tasti sotto il campo di scrittura, con un messaggio breve: Telegram vuole un messaggio per farlo. */
  async #togliTastiera(testo: string): Promise<void> {
    const dati = this.#dati;
    if (dati?.proprietario === undefined) return;
    const tolta = await this.#chiama(dati.gettone, "sendMessage", { chat_id: dati.proprietario.id, text: testo, reply_markup: TOGLI_TASTIERA }, 20_000);
    if (tolta.ok) this.#tastieraPosizione = false;
  }

  /**
   * Il contenuto di un file che il proprietario ha mandato al bot, per il centro. Solo i file
   * mandati da lui nelle ultime ore: il bot non scarica per il centro nient'altro.
   */
  async scaricaFile(idFile: string): Promise<{ dati: Buffer } | { problema: string }> {
    const dati = this.#dati;
    if (dati === undefined) return { problema: "Telegram non è configurato." };
    const scade = this.#fileDelProprietario.get(idFile);
    if (scade === undefined || scade < this.#adesso()) {
      this.#fileDelProprietario.delete(idFile);
      return { problema: "Questo file non è tra quelli mandati dal proprietario, o è passato troppo tempo." };
    }
    const informazioni = await this.#chiama(dati.gettone, "getFile", { file_id: idFile }, 20_000);
    const percorso = oggetto(informazioni.ok ? informazioni.risultato : undefined)?.file_path;
    if (typeof percorso !== "string") {
      return { problema: informazioni.ok ? "Telegram non dice dove sta il file." : `Telegram non dà il file (${informazioni.codice}).` };
    }
    try {
      // L'indirizzo contiene il token: non va mai scritto in un errore né sulla console.
      const risposta = await fetch(`${this.#api}/file/bot${dati.gettone}/${percorso}`, { signal: AbortSignal.timeout(120_000) });
      if (!risposta.ok) return { problema: `Telegram non dà il file (${risposta.status}).` };
      const contenuto = Buffer.from(await risposta.arrayBuffer());
      if (contenuto.length > FILE_RICEVUTO_MASSIMO) return { problema: "Il file è più grande di 20 MB." };
      return { dati: contenuto };
    } catch {
      return { problema: "Telegram non risponde." };
    }
  }

  #accoda(
    evento:
      | { tipo: "messaggio"; testo: string }
      | { tipo: "pulsante"; dato: string; messaggio: number }
      | { tipo: "posizione"; posizione: PosizioneDaTelegram; aggiornamento: boolean }
      | { tipo: "file"; file: FileRicevuto; didascalia?: string; gruppo?: string },
  ): void {
    this.#n = Math.max(this.#n + 1, this.#adesso());
    this.#eventi.push({ n: this.#n, quando: new Date(this.#adesso()).toISOString(), ...evento });
    if (this.#eventi.length > EVENTI_IN_ATTESA) this.#eventi.splice(0, this.#eventi.length - EVENTI_IN_ATTESA);
    this.#sveglia?.();
  }

  async #rispondi(testo: string): Promise<void> {
    await this.invia({ testo });
  }

  #salva(): Promise<void> {
    const dati = this.#dati;
    const scrittura = this.#scritture.then(async () => {
      if (dati === undefined) return rm(this.#o.file, { force: true });
      const provvisorio = `${this.#o.file}.nuovo`;
      await writeFile(provvisorio, `${JSON.stringify(dati, null, 2)}\n`, { mode: 0o600 });
      await rename(provvisorio, this.#o.file);
    });
    this.#scritture = scrittura.catch(() => {});
    return scrittura;
  }
}

/** Il file che un messaggio porta, se ne porta uno: documento, foto, video, audio o nota vocale. */
function fileDi(messaggio: Record<string, unknown>): FileRicevuto | undefined {
  const quando = typeof messaggio.date === "number" ? new Date(messaggio.date * 1000) : new Date();
  const ora = quando.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  // Di una foto Telegram manda più misure: la più grande è l'ultima.
  const foto = Array.isArray(messaggio.photo) ? oggetto(messaggio.photo.at(-1)) : undefined;
  const candidati: [Record<string, unknown> | undefined, string, string][] = [
    [oggetto(messaggio.document), "documento", "application/octet-stream"],
    [foto, `foto-${ora}.jpg`, "image/jpeg"],
    [oggetto(messaggio.video), `video-${ora}.mp4`, "video/mp4"],
    [oggetto(messaggio.animation), `animazione-${ora}.mp4`, "video/mp4"],
    [oggetto(messaggio.audio), `audio-${ora}.mp3`, "audio/mpeg"],
    [oggetto(messaggio.voice), `nota-vocale-${ora}.ogg`, "audio/ogg"],
    [oggetto(messaggio.video_note), `video-nota-${ora}.mp4`, "video/mp4"],
  ];
  for (const [voce, nomeSeManca, tipoSeManca] of candidati) {
    if (voce === undefined || typeof voce.file_id !== "string") continue;
    const nome = nomeFileTelegram(typeof voce.file_name === "string" ? voce.file_name : "") ?? nomeSeManca;
    return {
      id: voce.file_id,
      nome,
      mime: typeof voce.mime_type === "string" && /^[\w.+-]+\/[\w.+-]+$/.test(voce.mime_type) ? voce.mime_type : tipoSeManca,
      byte: typeof voce.file_size === "number" && voce.file_size >= 0 ? voce.file_size : 0,
    };
  }
  return undefined;
}

/** La posizione che un messaggio porta, se ne porta una valida. */
function posizioneDi(messaggio: Record<string, unknown>): PosizioneDaTelegram | undefined {
  const luogo = oggetto(messaggio.location);
  if (luogo === undefined) return undefined;
  const { latitude, longitude, horizontal_accuracy: precisione, live_period: durata } = luogo;
  if (typeof latitude !== "number" || typeof longitude !== "number") return undefined;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return undefined;
  // Per un aggiornamento dal vivo l'ora è quella della modifica.
  const secondi = typeof messaggio.edit_date === "number" ? messaggio.edit_date : messaggio.date;
  const quando = new Date(typeof secondi === "number" ? secondi * 1000 : Date.now()).toISOString();
  const inizio = typeof messaggio.date === "number" ? messaggio.date * 1000 : undefined;
  const dalVivo = typeof durata === "number" && durata > 0;
  return {
    lat: latitude,
    lon: longitude,
    ...(typeof precisione === "number" && precisione >= 0 ? { precisioneM: Math.round(precisione) } : {}),
    quando,
    ...(dalVivo ? { dalVivo: true } : {}),
    ...(dalVivo && inizio !== undefined && durata < 0x7fffffff ? { finoA: new Date(inizio + durata * 1000).toISOString() } : {}),
  };
}

function tastiera(righe: NonNullable<MessaggioTelegram["pulsanti"]>): { inline_keyboard: { text: string; callback_data: string }[][] } {
  return { inline_keyboard: righe.map((riga) => riga.map((pulsante) => ({ text: pulsante.testo, callback_data: pulsante.dato }))) };
}

function leggiCustodito(letto: unknown): Custodito | undefined {
  const dati = oggetto(letto);
  const bot = oggetto(dati?.bot);
  if (typeof dati?.gettone !== "string" || !FORMA_DEL_TOKEN.test(dati.gettone)) return undefined;
  if (typeof bot?.id !== "number" || typeof bot.utente !== "string") return undefined;
  const proprietario = oggetto(dati.proprietario);
  return {
    gettone: dati.gettone,
    bot: { id: bot.id, nome: typeof bot.nome === "string" ? bot.nome : bot.utente, utente: bot.utente },
    ...(typeof proprietario?.id === "number"
      ? {
          proprietario: {
            id: proprietario.id,
            nome: typeof proprietario.nome === "string" ? proprietario.nome : "",
            ...(typeof proprietario.utente === "string" ? { utente: proprietario.utente } : {}),
            abbinatoIl: typeof proprietario.abbinatoIl === "string" ? proprietario.abbinatoIl : "",
          },
        }
      : {}),
  };
}
