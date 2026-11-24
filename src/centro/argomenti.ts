/**
 * Il registro degli argomenti della Home: quello aperto e quelli archiviati,
 * con titolo, riassunto e il punto da cui la loro conversazione riprende.
 */

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ChatDellaHome, StatoArgomenti, VoceArgomento } from "../protocollo/argomenti.ts";
import { CHAT_PRINCIPALE, eNumeroDiChatParallela, primoNumeroLibero } from "../protocollo/chat-parallele.ts";

export interface Argomento {
  /** Fa anche da nome della cartella dei suoi file, in ogni ambiente. */
  id: string;
  apertoIl: string;
  /** Presenti da quando l'argomento è stato archiviato almeno una volta. */
  titolo?: string;
  riassunto?: string;
  /** Presente finché l'argomento è archiviato. */
  archiviatoIl?: string;
  /** Identificativo da cui l'harness riprende la conversazione dell'argomento. */
  idSessione?: string;
  /**
   * Dove stanno archivio e cartella di lavoro, se non sono al posto solito: vale per la
   * conversazione della Home nata prima che esistessero gli argomenti.
   */
  archivio?: string;
  cartella?: string;
}

/**
 * Un argomento nuovo che nasce da un punto di un altro: ne usa la cartella di lavoro, e riprende
 * dalla copia della sua conversazione fino a quel punto, se ce n'è una.
 */
export interface Ramo {
  tipo: "ramo";
  cartella: string;
  idSessione?: string;
}

interface Salvato {
  idAperto: string;
  argomenti: Argomento[];
  /** Gli argomenti aperti nelle chat parallele (ADR 0052). */
  chat?: ChatDellaHome[];
}

/** Da dove viene il primo argomento quando il registro non esiste ancora. */
export interface ArgomentoEreditato {
  idSessione?: string;
  archivio: string;
  cartella: string;
}

export class RegistroArgomenti {
  readonly #file: string;
  readonly #argomenti: Map<string, Argomento>;
  #idAperto: string;
  /** Le chat parallele, con l'argomento che ciascuna tiene aperto. */
  #chat: ChatDellaHome[];
  readonly #ascoltatori = new Set<(stato: StatoArgomenti) => void>();

  private constructor(file: string, salvato: Salvato) {
    this.#file = file;
    this.#argomenti = new Map(salvato.argomenti.map((argomento) => [argomento.id, argomento]));
    this.#idAperto = salvato.idAperto;
    // Restano le chat con un numero valido e un argomento aperto che c'è, una per numero e per argomento.
    const viste = new Set<string>([salvato.idAperto]);
    this.#chat = [];
    for (const chat of Array.isArray(salvato.chat) ? salvato.chat : []) {
      const argomento = this.#argomenti.get(chat?.idAperto);
      if (!eNumeroDiChatParallela(chat?.numero) || argomento === undefined || argomento.archiviatoIl !== undefined) continue;
      if (viste.has(chat.idAperto) || this.#chat.some((altra) => altra.numero === chat.numero)) continue;
      viste.add(chat.idAperto);
      this.#chat.push({ numero: chat.numero, idAperto: chat.idAperto });
    }
  }

  /**
   * Apre il registro. Se non esiste ne crea uno con un solo argomento aperto: quello ereditato
   * dalla Home di prima, se c'è, altrimenti uno nuovo.
   */
  static async apri(file: string, ereditato?: ArgomentoEreditato, ora: number = Date.now()): Promise<RegistroArgomenti> {
    await mkdir(dirname(file), { recursive: true });
    const letto = leggi(file);
    if (letto !== undefined && letto.argomenti.some((argomento) => argomento.id === letto.idAperto)) {
      return new RegistroArgomenti(file, letto);
    }
    const primo: Argomento = { id: nuovoId(ora), apertoIl: new Date(ora).toISOString(), ...ereditato };
    const registro = new RegistroArgomenti(file, { idAperto: primo.id, argomenti: [primo] });
    await registro.#salva();
    return registro;
  }

  get aperto(): Argomento {
    const aperto = this.#argomenti.get(this.#idAperto);
    if (aperto === undefined) throw new Error("Il registro degli argomenti non ha un argomento aperto.");
    return aperto;
  }

  /** L'argomento aperto in una chat: 1 è la principale, le altre sono chat parallele. */
  apertoIn(numero: number): Argomento {
    if (numero === CHAT_PRINCIPALE) return this.aperto;
    const id = this.#chat.find((chat) => chat.numero === numero)?.idAperto;
    const aperto = id === undefined ? undefined : this.#argomenti.get(id);
    if (aperto === undefined) throw new Error("Questa chat della Home non è aperta.");
    return aperto;
  }

  /** Le chat parallele aperte, in ordine. */
  chatParallele(): ChatDellaHome[] {
    return [...this.#chat].sort((a, b) => a.numero - b.numero).map((chat) => ({ ...chat }));
  }

  /** Apre una chat parallela con un argomento nuovo; nulla se sono già tutte aperte. */
  async apriChat(ora: number = Date.now()): Promise<{ numero: number; argomento: Argomento } | undefined> {
    const numero = primoNumeroLibero(this.#chat.map((chat) => chat.numero));
    if (numero === undefined) return undefined;
    const argomento: Argomento = { id: this.#idLibero(ora), apertoIl: new Date(ora).toISOString() };
    this.#argomenti.set(argomento.id, argomento);
    this.#chat.push({ numero, idAperto: argomento.id });
    await this.#salva();
    this.#avvisa();
    return { numero, argomento };
  }

  /**
   * Chiude una chat parallela: il suo argomento viene archiviato con titolo e riassunto, oppure
   * dimenticato se non conteneva nulla da conservare. Falso se la chat non era aperta.
   */
  async chiudiChat(numero: number, chiuso: { titolo: string; riassunto: string } | "da-dimenticare", ora: number = Date.now()): Promise<boolean> {
    const chat = this.#chat.find((una) => una.numero === numero);
    if (chat === undefined) return false;
    this.#chat = this.#chat.filter((una) => una !== chat);
    const argomento = this.#argomenti.get(chat.idAperto);
    if (argomento !== undefined) this.#archiviaODimentica(argomento, chiuso, new Date(ora).toISOString());
    await this.#salva();
    this.#avvisa();
    return true;
  }

  #archiviaODimentica(argomento: Argomento, chiuso: { titolo: string; riassunto: string } | "da-dimenticare", quando: string): void {
    if (chiuso === "da-dimenticare") {
      this.#argomenti.delete(argomento.id);
      return;
    }
    argomento.titolo = chiuso.titolo;
    argomento.riassunto = chiuso.riassunto;
    argomento.archiviatoIl = quando;
  }

  trova(id: string): Argomento | undefined {
    return this.#argomenti.get(id);
  }

  /** Gli argomenti archiviati, dal più recente. */
  archiviati(): VoceArgomento[] {
    return [...this.#argomenti.values()]
      .filter((argomento) => argomento.archiviatoIl !== undefined)
      .map((argomento) => ({
        id: argomento.id,
        titolo: argomento.titolo ?? "Senza titolo",
        riassunto: argomento.riassunto ?? "",
        apertoIl: argomento.apertoIl,
        archiviatoIl: argomento.archiviatoIl ?? "",
      }))
      .sort((a, b) => b.archiviatoIl.localeCompare(a.archiviatoIl));
  }

  stato(): StatoArgomenti {
    return { idAperto: this.#idAperto, archiviati: this.archiviati(), ...(this.#chat.length === 0 ? {} : { chat: this.chatParallele() }) };
  }

  /**
   * Chiude l'argomento aperto in una chat (la principale, se non se ne indica un'altra) e ne apre un
   * altro: uno nuovo, un ramo di quello aperto, oppure uno archiviato da riprendere.
   * Quello che si chiude viene archiviato con titolo e riassunto, oppure dimenticato se non
   * conteneva nulla da conservare. Restituisce l'argomento ora aperto.
   */
  async passa(
    chiuso: { titolo: string; riassunto: string } | "da-dimenticare",
    verso: "nuovo" | string | Ramo,
    ora: number = Date.now(),
    numero: number = CHAT_PRINCIPALE,
  ): Promise<Argomento> {
    const precedente = this.apertoIn(numero);
    const quando = new Date(ora).toISOString();
    let prossimo: Argomento;
    if (verso === "nuovo") {
      prossimo = { id: this.#idLibero(ora), apertoIl: quando };
    } else if (typeof verso === "object") {
      prossimo = {
        id: this.#idLibero(ora),
        apertoIl: quando,
        cartella: verso.cartella,
        ...(verso.idSessione === undefined ? {} : { idSessione: verso.idSessione }),
      };
    } else {
      const trovato = this.#argomenti.get(verso);
      if (trovato === undefined || trovato.id === precedente.id) {
        throw new Error("L'argomento da riaprire non esiste.");
      }
      // Un argomento aperto in un'altra chat resta lì.
      if (trovato.archiviatoIl === undefined) throw new Error("Questo argomento è aperto in un'altra chat.");
      prossimo = trovato;
      delete prossimo.archiviatoIl;
    }
    this.#archiviaODimentica(precedente, chiuso, quando);
    this.#argomenti.set(prossimo.id, prossimo);
    if (numero === CHAT_PRINCIPALE) this.#idAperto = prossimo.id;
    else this.#chat = this.#chat.map((chat) => (chat.numero === numero ? { numero, idAperto: prossimo.id } : chat));
    await this.#salva();
    this.#avvisa();
    return prossimo;
  }

  /** Toglie un argomento archiviato dal registro; quello aperto no. Falso se non si può. */
  async togli(id: string): Promise<boolean> {
    const argomento = this.#argomenti.get(id);
    if (argomento === undefined || argomento.archiviatoIl === undefined || id === this.#idAperto) return false;
    this.#argomenti.delete(id);
    await this.#salva();
    this.#avvisa();
    return true;
  }

  /** Ricorda da dove riprendere la conversazione di un argomento; una stringa vuota lo fa dimenticare. */
  async ricordaSessione(id: string, idSessione: string): Promise<void> {
    const argomento = this.#argomenti.get(id);
    if (argomento === undefined) return;
    if (idSessione === "") delete argomento.idSessione;
    else argomento.idSessione = idSessione;
    await this.#salva();
  }

  /** Collega un ascoltatore: riceve subito lo stato, poi ogni cambiamento. */
  iscrivi(ascoltatore: (stato: StatoArgomenti) => void): () => void {
    ascoltatore(this.stato());
    this.#ascoltatori.add(ascoltatore);
    return () => this.#ascoltatori.delete(ascoltatore);
  }

  #idLibero(ora: number): string {
    for (;;) {
      const id = nuovoId(ora);
      if (!this.#argomenti.has(id)) return id;
    }
  }

  #avvisa(): void {
    const stato = this.stato();
    for (const ascoltatore of this.#ascoltatori) ascoltatore(stato);
  }

  /** Le scritture si fanno una alla volta: due insieme si contenderebbero il file provvisorio. */
  #scritture: Promise<void> = Promise.resolve();

  #salva(): Promise<void> {
    const scrittura = this.#scritture.then(() => this.#scrivi());
    this.#scritture = scrittura.catch(() => {});
    return scrittura;
  }

  async #scrivi(): Promise<void> {
    const salvato: Salvato = {
      idAperto: this.#idAperto,
      argomenti: [...this.#argomenti.values()],
      ...(this.#chat.length === 0 ? {} : { chat: this.#chat }),
    };
    const provvisorio = `${this.#file}.tmp`;
    await writeFile(provvisorio, JSON.stringify(salvato, null, 2));
    await rename(provvisorio, this.#file);
  }
}

/** La data e qualche carattere a caso: si ordina per giorno e fa da nome di cartella ovunque. */
function nuovoId(ora: number): string {
  return `${new Date(ora).toISOString().slice(0, 10)}-${randomBytes(3).toString("hex")}`;
}

function leggi(file: string): Salvato | undefined {
  try {
    const letto = JSON.parse(readFileSync(file, "utf8")) as Partial<Salvato>;
    if (typeof letto.idAperto !== "string" || !Array.isArray(letto.argomenti)) return undefined;
    return { idAperto: letto.idAperto, argomenti: letto.argomenti, ...(Array.isArray(letto.chat) ? { chat: letto.chat } : {}) };
  } catch (errore) {
    if (errore instanceof Error && "code" in errore && errore.code === "ENOENT") return undefined;
    throw errore;
  }
}
