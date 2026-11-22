/**
 * Un Telegram finto per le prove: risponde come l'API dei bot per le poche chiamate che il
 * gateway usa, e permette di far scrivere qualcuno al bot o di fargli premere un pulsante.
 *
 * Non è Telegram: serve a provare che il gateway ascolti solo il proprietario, consegni al centro
 * ciò che scrive e mandi i messaggi come Telegram li vuole. Le stesse cose con il Telegram vero
 * le può provare solo il proprietario, con il suo bot.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface PersonaDiProva {
  id: number;
  nome: string;
  utente?: string;
}

export interface MessaggioDelBot {
  message_id: number;
  chat_id: number;
  text: string;
  parse_mode?: string;
  /** Le righe di pulsanti, se ce ne sono. */
  pulsanti: { text: string; callback_data: string }[][];
  silenzioso: boolean;
  /** Quante volte è stato modificato dopo l'invio. */
  modifiche: number;
  /** I tasti sotto il campo di scrittura, se il messaggio ne porta: testo e se chiedono la posizione. */
  tasti?: { text: string; request_location?: boolean }[][];
  /** Vero se il messaggio toglie i tasti sotto il campo di scrittura. */
  togliTasti?: boolean;
}

/** Un file che il bot ha mandato, come foto o come documento. */
export interface FileDelBot {
  message_id: number;
  metodo: "sendPhoto" | "sendDocument";
  chat_id: number;
  nome: string;
  tipo: string;
  contenuto: Buffer;
  didascalia?: string;
}

interface Errore {
  error_code: number;
  description: string;
  parameters?: { retry_after?: number };
}

const SEGNI_AMMESSI = new Set(["b", "strong", "i", "em", "u", "ins", "s", "strike", "del", "code", "pre", "a", "blockquote", "tg-spoiler"]);

/** Legge il testo con i segni di formato come farebbe Telegram: restituisce l'errore, se c'è. */
export function erroreNelFormato(testo: string): string | undefined {
  const aperti: string[] = [];
  const segno = /<(\/?)([a-z][a-z0-9-]*)((?:\s+[a-z-]+="[^"<>]*")*)\s*>|<|&(?!(?:lt|gt|amp|quot|#\d+|#x[0-9a-f]+);)/gi;
  for (const trovato of testo.matchAll(segno)) {
    const nome = trovato[2]?.toLowerCase();
    if (nome === undefined) return `Bad Request: can't parse entities: unexpected character at byte offset ${trovato.index}`;
    if (!SEGNI_AMMESSI.has(nome)) return `Bad Request: can't parse entities: unsupported start tag "${nome}"`;
    if (trovato[1] === "/") {
      if (aperti.pop() !== nome) return `Bad Request: can't parse entities: unexpected end tag "${nome}"`;
    } else {
      aperti.push(nome);
    }
  }
  return aperti.length === 0 ? undefined : `Bad Request: can't parse entities: can't find end tag corresponding to start tag "${aperti.at(-1)}"`;
}

function senzaSegni(testo: string): string {
  return testo
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

export class TelegramDiProva {
  readonly gettone: string;
  readonly bot = { id: 7_000_000_001, is_bot: true, first_name: "Shinka di prova", username: "shinka_prova_bot" };
  /** Tutto ciò che il bot ha mandato, nell'ordine. */
  readonly messaggi: MessaggioDelBot[] = [];
  /** Le risposte ai pulsanti premuti: l'identificativo di ogni pressione a cui il bot ha risposto. */
  readonly risposteAiPulsanti: string[] = [];
  /** Quante volte il bot ha fatto vedere che sta scrivendo. */
  staScrivendo = 0;
  /** Quante volte è stato chiesto di togliere l'indirizzo dei messaggi. */
  webhookTolti = 0;
  /** I nomi delle chiamate ricevute, nell'ordine. */
  readonly chiamate: string[] = [];
  /** I file che il bot ha mandato, nell'ordine. */
  readonly file: FileDelBot[] = [];
  /** Tutto ciò che il bot ha mandato, messaggi e file, nell'ordine in cui è arrivato. */
  readonly ordine: string[] = [];
  /** I file che il proprietario ha mandato al bot, per identificativo: Telegram li tiene e li dà con getFile. */
  readonly #fileMandati = new Map<string, Buffer>();
  #prossimoFile = 1;
  /** I comandi che il bot ha messo nel suo menu. */
  comandi: { command: string; description: string }[] = [];

  readonly #server: Server;
  #aggiornamenti: { update_id: number; [campo: string]: unknown }[] = [];
  #prossimoAggiornamento = 1000;
  #prossimoMessaggio = 1;
  #prossimaPressione = 1;
  /** Chi sta aspettando messaggi nuovi: ce n'è uno solo, come su Telegram. */
  #inAttesa: { sveglia(conflitto: boolean): void } | undefined;
  readonly #erroriPronti = new Map<string, Errore[]>();
  readonly #osservatori = new Set<() => void>();

  private constructor(gettone: string, server: Server) {
    this.gettone = gettone;
    this.#server = server;
  }

  static async avvia(opzioni: { gettone?: string; porta?: number } = {}): Promise<TelegramDiProva> {
    const server = createServer((richiesta, risposta) => void finto.#servi(richiesta, risposta));
    const finto = new TelegramDiProva(opzioni.gettone ?? "7000000001:PROVA_token-di-prova_non-vero_0123456789", server);
    await new Promise<void>((pronto) => server.listen(opzioni.porta ?? 0, "127.0.0.1", pronto));
    return finto;
  }

  get indirizzo(): string {
    return `http://127.0.0.1:${(this.#server.address() as AddressInfo).port}`;
  }

  /** Qualcuno scrive al bot. Senza `testo` è un messaggio che il bot non sa ricevere, un adesivo. */
  scrive(da: PersonaDiProva, testo: string | undefined, chat: { id: number; type: string } = { id: da.id, type: "private" }): void {
    this.#aggiungi({
      message: {
        message_id: this.#prossimoMessaggio++,
        from: { id: da.id, is_bot: false, first_name: da.nome, ...(da.utente === undefined ? {} : { username: da.utente }) },
        chat,
        date: Math.floor(Date.now() / 1000),
        // Ciò che non è testo, e che il bot non sa ricevere: un adesivo.
        ...(testo === undefined ? { sticker: { file_id: "adesivo" } } : { text: testo }),
      },
    });
  }

  /**
   * Qualcuno manda al bot la sua posizione, una volta o dal vivo per `durataS` secondi.
   * Restituisce l'identificativo del messaggio, che serve per spostarla.
   */
  condivide(da: PersonaDiProva, lat: number, lon: number, opzioni: { precisione?: number; durataS?: number; quando?: number } = {}): number {
    const id = this.#prossimoMessaggio++;
    this.#aggiungi({
      message: {
        message_id: id,
        from: { id: da.id, is_bot: false, first_name: da.nome },
        chat: { id: da.id, type: "private" },
        date: Math.floor((opzioni.quando ?? Date.now()) / 1000),
        location: {
          latitude: lat,
          longitude: lon,
          ...(opzioni.precisione === undefined ? {} : { horizontal_accuracy: opzioni.precisione }),
          ...(opzioni.durataS === undefined ? {} : { live_period: opzioni.durataS }),
        },
      },
    });
    return id;
  }

  /** Una posizione condivisa dal vivo si sposta: Telegram modifica lo stesso messaggio. */
  sposta(da: PersonaDiProva, idMessaggio: number, lat: number, lon: number, durataS: number, inizio: number): void {
    this.#aggiungi({
      edited_message: {
        message_id: idMessaggio,
        from: { id: da.id, is_bot: false, first_name: da.nome },
        chat: { id: da.id, type: "private" },
        date: Math.floor(inizio / 1000),
        edit_date: Math.floor(Date.now() / 1000),
        location: { latitude: lat, longitude: lon, live_period: durataS },
      },
    });
  }

  /**
   * Qualcuno manda al bot un file, come documento o come foto. I file di un album hanno lo stesso
   * `gruppo`. Restituisce l'identificativo del file, come lo dà Telegram.
   */
  mandaFile(
    da: PersonaDiProva,
    file: { come: "document" | "photo"; nome?: string; mime?: string; contenuto: Buffer; dimensione?: number },
    opzioni: { didascalia?: string; gruppo?: string } = {},
  ): string {
    const id = `file-${this.#prossimoFile++}`;
    this.#fileMandati.set(id, file.contenuto);
    const dati = { file_id: id, file_unique_id: `u${id}`, file_size: file.dimensione ?? file.contenuto.length };
    this.#aggiungi({
      message: {
        message_id: this.#prossimoMessaggio++,
        from: { id: da.id, is_bot: false, first_name: da.nome },
        chat: { id: da.id, type: "private" },
        date: Math.floor(Date.now() / 1000),
        ...(file.come === "photo"
          ? { photo: [{ ...dati, file_id: `${id}-piccola`, width: 90, height: 90 }, { ...dati, width: 1280, height: 960 }] }
          : { document: { ...dati, ...(file.nome === undefined ? {} : { file_name: file.nome }), ...(file.mime === undefined ? {} : { mime_type: file.mime }) } }),
        ...(opzioni.didascalia === undefined ? {} : { caption: opzioni.didascalia }),
        ...(opzioni.gruppo === undefined ? {} : { media_group_id: opzioni.gruppo }),
      },
    });
    return id;
  }

  /** Il proprietario corregge un messaggio di testo già mandato. */
  correggi(da: PersonaDiProva, idMessaggio: number, testo: string): void {
    this.#aggiungi({
      edited_message: {
        message_id: idMessaggio,
        from: { id: da.id, is_bot: false, first_name: da.nome },
        chat: { id: da.id, type: "private" },
        date: Math.floor(Date.now() / 1000),
        edit_date: Math.floor(Date.now() / 1000),
        text: testo,
      },
    });
  }

  /** Qualcuno preme un pulsante sotto un messaggio del bot. Restituisce l'identificativo della pressione. */
  preme(da: PersonaDiProva, idMessaggio: number, dato: string): string {
    const id = `pressione-${this.#prossimaPressione++}`;
    this.#aggiungi({
      callback_query: {
        id,
        from: { id: da.id, is_bot: false, first_name: da.nome },
        message: { message_id: idMessaggio, chat: { id: da.id, type: "private" } },
        data: dato,
      },
    });
    return id;
  }

  /** La prossima chiamata a questo metodo fallisce così, una volta. */
  faiFallire(metodo: string, errore: Errore): void {
    this.#erroriPronti.set(metodo, [...(this.#erroriPronti.get(metodo) ?? []), errore]);
  }

  /** Quanti aggiornamenti Telegram tiene ancora, non confermati dal bot. */
  get daConsegnare(): number {
    return this.#aggiornamenti.length;
  }

  /** Aspetta che ciò che il bot ha fatto soddisfi la condizione. */
  async attendi(condizione: () => boolean, ms = 5000, cosa = "ciò che il bot doveva fare"): Promise<void> {
    if (condizione()) return;
    await new Promise<void>((fatto, fallito) => {
      const controlla = (): void => {
        if (!condizione()) return;
        clearTimeout(timer);
        this.#osservatori.delete(controlla);
        fatto();
      };
      const timer = setTimeout(() => {
        this.#osservatori.delete(controlla);
        fallito(new Error(`Dopo ${ms} ms non è successo: ${cosa}.`));
      }, ms);
      this.#osservatori.add(controlla);
    });
  }

  async chiudi(): Promise<void> {
    this.#inAttesa?.sveglia(false);
    this.#server.closeAllConnections();
    await new Promise<void>((chiuso) => this.#server.close(() => chiuso()));
  }

  #aggiungi(aggiornamento: Record<string, unknown>): void {
    this.#aggiornamenti.push({ update_id: this.#prossimoAggiornamento++, ...aggiornamento });
    this.#inAttesa?.sveglia(false);
  }

  #avvisa(): void {
    for (const osservatore of [...this.#osservatori]) osservatore();
  }

  async #servi(richiesta: IncomingMessage, risposta: ServerResponse): Promise<void> {
    const manda = (stato: number, corpo: unknown): void => {
      risposta.writeHead(stato, { "content-type": "application/json" });
      risposta.end(JSON.stringify(corpo));
    };
    const pezzi: Buffer[] = [];
    for await (const pezzo of richiesta) pezzi.push(pezzo as Buffer);
    let corpo: Record<string, unknown> = {};
    /** Il file arrivato con la richiesta, se è arrivata come modulo con un file. */
    let allegato: { campo: string; nome: string; tipo: string; contenuto: Buffer } | undefined;
    const tipoRichiesta = richiesta.headers["content-type"] ?? "";
    try {
      if (tipoRichiesta.startsWith("multipart/form-data")) {
        const modulo = await new Response(Buffer.concat(pezzi), { headers: { "content-type": tipoRichiesta } }).formData();
        for (const [campo, valore] of modulo.entries()) {
          if (typeof valore === "string") corpo[campo] = valore;
          else allegato = { campo, nome: valore.name, tipo: valore.type, contenuto: Buffer.from(await valore.arrayBuffer()) };
        }
      } else {
        corpo = pezzi.length === 0 ? {} : (JSON.parse(Buffer.concat(pezzi).toString("utf8")) as Record<string, unknown>);
      }
    } catch {
      return manda(400, { ok: false, error_code: 400, description: "Bad Request: can't parse JSON" });
    }

    const indirizzo = new URL(richiesta.url ?? "/", "http://finto");
    // Il contenuto di un file, all'indirizzo che getFile ha dato.
    const scaricato = /^\/file\/bot([^/]+)\/(.+)$/.exec(indirizzo.pathname);
    if (scaricato !== null) {
      if (scaricato[1] !== this.gettone) return manda(401, { ok: false, error_code: 401, description: "Unauthorized" });
      const contenuto = this.#fileMandati.get(decodeURIComponent(scaricato[2] ?? "").replace(/^documenti\//, ""));
      if (contenuto === undefined) return manda(404, { ok: false, error_code: 404, description: "Not Found" });
      risposta.writeHead(200, { "content-type": "application/octet-stream" });
      risposta.end(contenuto);
      return;
    }
    // Per le prove a mano: far scrivere qualcuno, far premere un pulsante, leggere ciò che il bot ha mandato.
    if (indirizzo.pathname === "/prova/scrive") {
      this.scrive(corpo.da as PersonaDiProva, typeof corpo.testo === "string" ? corpo.testo : undefined);
      return manda(200, { ok: true });
    }
    if (indirizzo.pathname === "/prova/preme") {
      return manda(200, { ok: true, id: this.preme(corpo.da as PersonaDiProva, Number(corpo.messaggio), String(corpo.dato)) });
    }
    if (indirizzo.pathname === "/prova/messaggi") {
      return manda(200, { ok: true, messaggi: this.messaggi, staScrivendo: this.staScrivendo, risposteAiPulsanti: this.risposteAiPulsanti });
    }

    const trovato = /^\/bot([^/]+)\/([A-Za-z]+)$/.exec(indirizzo.pathname);
    if (trovato === null) return manda(404, { ok: false, error_code: 404, description: "Not Found" });
    const [, gettone, metodo] = trovato as unknown as [string, string, string];
    if (gettone !== this.gettone) return manda(401, { ok: false, error_code: 401, description: "Unauthorized" });
    this.chiamate.push(metodo);
    const errore = this.#erroriPronti.get(metodo)?.shift();
    if (errore !== undefined) return manda(errore.error_code, { ok: false, ...errore });
    const rifiuta = (description: string): void => manda(400, { ok: false, error_code: 400, description });

    switch (metodo) {
      case "getMe":
        return manda(200, { ok: true, result: this.bot });
      case "deleteWebhook":
        this.webhookTolti += 1;
        return manda(200, { ok: true, result: true });
      case "getFile": {
        const id = String(corpo.file_id);
        if (!this.#fileMandati.has(id)) return rifiuta("Bad Request: invalid file_id");
        return manda(200, { ok: true, result: { file_id: id, file_path: `documenti/${id}` } });
      }
      case "setMyCommands":
        this.comandi = Array.isArray(corpo.commands) ? (corpo.commands as { command: string; description: string }[]) : [];
        this.#avvisa();
        return manda(200, { ok: true, result: true });
      case "sendChatAction":
        this.staScrivendo += 1;
        this.#avvisa();
        return manda(200, { ok: true, result: true });
      case "answerCallbackQuery":
        this.risposteAiPulsanti.push(String(corpo.callback_query_id));
        this.#avvisa();
        return manda(200, { ok: true, result: true });
      case "getUpdates": {
        const da = typeof corpo.offset === "number" ? corpo.offset : 0;
        this.#aggiornamenti = this.#aggiornamenti.filter((aggiornamento) => aggiornamento.update_id >= da);
        this.#avvisa();
        // Una richiesta nuova manda via quella che stava aspettando, come fa Telegram.
        this.#inAttesa?.sveglia(true);
        if (this.#aggiornamenti.length === 0 && typeof corpo.timeout === "number" && corpo.timeout > 0) {
          const conflitto = await new Promise<boolean>((sveglio) => {
            const timer = setTimeout(() => fine(false), Math.min(corpo.timeout as number, 30) * 1000);
            const fine = (come: boolean): void => {
              clearTimeout(timer);
              if (this.#inAttesa === attesa) this.#inAttesa = undefined;
              sveglio(come);
            };
            const attesa = { sveglia: fine };
            this.#inAttesa = attesa;
            richiesta.socket.once("close", () => fine(false));
          });
          if (conflitto) {
            return manda(409, { ok: false, error_code: 409, description: "Conflict: terminated by other getUpdates request" });
          }
        }
        return manda(200, { ok: true, result: this.#aggiornamenti.slice(0, 100) });
      }
      case "sendPhoto":
      case "sendDocument": {
        const campo = metodo === "sendPhoto" ? "photo" : "document";
        if (allegato === undefined || allegato.campo !== campo) return rifiuta(`Bad Request: there is no ${campo} in the request`);
        // Come Telegram: una foto dev'essere un'immagine che sa leggere, e non troppo grande.
        if (metodo === "sendPhoto" && (!/^image\/(png|jpeg|webp|gif)$/.test(allegato.tipo) || allegato.contenuto.length > 10 * 1024 * 1024)) {
          return rifiuta("Bad Request: PHOTO_INVALID_DIMENSIONS");
        }
        if (allegato.contenuto.length > 50 * 1024 * 1024) return manda(413, { ok: false, error_code: 413, description: "Request Entity Too Large" });
        const mandato: FileDelBot = {
          message_id: this.#prossimoMessaggio++,
          metodo,
          chat_id: Number(corpo.chat_id),
          nome: allegato.nome,
          tipo: allegato.tipo,
          contenuto: allegato.contenuto,
          ...(typeof corpo.caption === "string" ? { didascalia: corpo.caption } : {}),
        };
        this.file.push(mandato);
        this.ordine.push(`file:${mandato.nome}`);
        this.#avvisa();
        return manda(200, { ok: true, result: { message_id: mandato.message_id, chat: { id: mandato.chat_id, type: "private" } } });
      }
      case "sendMessage":
      case "editMessageText": {
        const testo = typeof corpo.text === "string" ? corpo.text : "";
        if (corpo.parse_mode === "HTML") {
          const sbagliato = erroreNelFormato(testo);
          if (sbagliato !== undefined) return rifiuta(sbagliato);
        }
        const letto = corpo.parse_mode === "HTML" ? senzaSegni(testo) : testo;
        if (letto.trim() === "") return rifiuta("Bad Request: message text is empty");
        if (letto.length > 4096) return rifiuta("Bad Request: message is too long");
        const tastiera = (corpo.reply_markup as { inline_keyboard?: MessaggioDelBot["pulsanti"] } | undefined)?.inline_keyboard ?? [];
        const tasti = (corpo.reply_markup as { keyboard?: MessaggioDelBot["tasti"] } | undefined)?.keyboard;
        const togliTasti = (corpo.reply_markup as { remove_keyboard?: boolean } | undefined)?.remove_keyboard === true;
        for (const pulsante of tastiera.flat()) {
          if (Buffer.byteLength(pulsante.callback_data) > 64 || pulsante.callback_data === "") return rifiuta("Bad Request: BUTTON_DATA_INVALID");
        }
        if (metodo === "sendMessage") {
          const messaggio: MessaggioDelBot = {
            message_id: this.#prossimoMessaggio++,
            chat_id: Number(corpo.chat_id),
            text: testo,
            ...(typeof corpo.parse_mode === "string" ? { parse_mode: corpo.parse_mode } : {}),
            pulsanti: tastiera,
            silenzioso: corpo.disable_notification === true,
            modifiche: 0,
            ...(tasti === undefined ? {} : { tasti }),
            ...(togliTasti ? { togliTasti: true } : {}),
          };
          this.messaggi.push(messaggio);
          this.ordine.push(`testo:${letto}`);
          this.#avvisa();
          return manda(200, { ok: true, result: { message_id: messaggio.message_id, chat: { id: messaggio.chat_id, type: "private" }, text: letto } });
        }
        const messaggio = this.messaggi.find((mandato) => mandato.message_id === corpo.message_id && mandato.chat_id === Number(corpo.chat_id));
        if (messaggio === undefined) return rifiuta("Bad Request: message to edit not found");
        if (messaggio.text === testo && JSON.stringify(messaggio.pulsanti) === JSON.stringify(tastiera)) {
          return rifiuta("Bad Request: message is not modified: specified new message content and reply markup are exactly the same");
        }
        messaggio.text = testo;
        if (typeof corpo.parse_mode === "string") messaggio.parse_mode = corpo.parse_mode;
        else delete messaggio.parse_mode;
        messaggio.pulsanti = tastiera;
        messaggio.modifiche += 1;
        this.#avvisa();
        return manda(200, { ok: true, result: { message_id: messaggio.message_id } });
      }
      default:
        return manda(404, { ok: false, error_code: 404, description: "Not Found: method not found" });
    }
  }
}
