/**
 * Il tramite dell'anteprima in un ambiente: riceve dal centro le richieste del browser del
 * proprietario e le fa all'applicazione che ascolta su `localhost`, riferendo la risposta
 * man mano che arriva. Fa lo stesso con i WebSocket che l'applicazione apre verso il suo server.
 *
 * Raggiunge solo `localhost` di questa macchina, sulla porta indicata dal centro.
 */

import {
  PEZZO_ANTEPRIMA,
  type ComandoAnteprima,
  type Intestazioni,
  type PortaAnteprima,
  type RiferitoAnteprima,
} from "../protocollo/anteprima.ts";

/** Intestazioni che riguardano un singolo collegamento, o che qui si ricalcolano. */
const NON_INOLTRATE = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-length",
  "accept-encoding",
  "expect",
]);

/** La risposta arriva già decompressa: misura e codifica di prima non valgono più. */
const NON_RIFERITE = new Set(["connection", "keep-alive", "transfer-encoding", "content-encoding", "content-length", "set-cookie"]);

export class TramiteAnteprima implements PortaAnteprima {
  readonly #riferisci: (messaggio: RiferitoAnteprima) => void;
  readonly #richieste = new Map<string, AbortController>();
  readonly #canali = new Map<string, WebSocket>();

  constructor(riferisci: (messaggio: RiferitoAnteprima) => void) {
    this.#riferisci = riferisci;
  }

  esegui(comando: ComandoAnteprima): void {
    switch (comando.tipo) {
      case "anteprima-richiesta":
        void this.#richiedi(comando);
        return;
      case "anteprima-annulla":
        this.#richieste.get(comando.idRichiesta)?.abort();
        return;
      case "anteprima-ws-apri":
        this.#apriCanale(comando);
        return;
      case "anteprima-ws-manda": {
        const socket = this.#canali.get(comando.idCanale);
        if (socket === undefined || socket.readyState !== WebSocket.OPEN) return;
        if (comando.testo !== undefined) socket.send(comando.testo);
        else if (comando.binario !== undefined) socket.send(Buffer.from(comando.binario, "base64"));
        return;
      }
      case "anteprima-ws-chiudi":
        this.#chiudiCanale(comando.idCanale);
        return;
    }
  }

  /** Il centro non c'è più: nessuno aspetta le risposte. */
  chiudiTutto(): void {
    for (const annulla of this.#richieste.values()) annulla.abort();
    this.#richieste.clear();
    for (const idCanale of [...this.#canali.keys()]) this.#chiudiCanale(idCanale);
  }

  async #richiedi(comando: Extract<ComandoAnteprima, { tipo: "anteprima-richiesta" }>): Promise<void> {
    const { idRichiesta, porta, metodo } = comando;
    const origine = `http://localhost:${porta}`;
    const annulla = new AbortController();
    this.#richieste.set(idRichiesta, annulla);
    try {
      const conCorpo = metodo !== "GET" && metodo !== "HEAD" && comando.corpo !== undefined;
      const risposta = await fetch(origine + comando.percorso, {
        method: metodo,
        headers: perLApplicazione(comando.intestazioni, origine),
        redirect: "manual",
        signal: annulla.signal,
        ...(conCorpo ? { body: Buffer.from(comando.corpo ?? "", "base64") } : {}),
      });
      this.#riferisci({
        tipo: "anteprima-inizio",
        idRichiesta,
        stato: risposta.status,
        intestazioni: perIlBrowser(risposta.headers, porta),
      });
      if (risposta.body !== null) {
        for await (const pezzo of risposta.body as AsyncIterable<Uint8Array>) {
          for (let da = 0; da < pezzo.length; da += PEZZO_ANTEPRIMA) {
            const dati = Buffer.from(pezzo.buffer, pezzo.byteOffset + da, Math.min(PEZZO_ANTEPRIMA, pezzo.length - da));
            this.#riferisci({ tipo: "anteprima-pezzo", idRichiesta, dati: dati.toString("base64") });
          }
        }
      }
      this.#riferisci({ tipo: "anteprima-fine", idRichiesta });
    } catch (errore) {
      if (!annulla.signal.aborted) {
        this.#riferisci({ tipo: "anteprima-errore", idRichiesta, motivo: motivoDi(errore, porta) });
      }
    } finally {
      this.#richieste.delete(idRichiesta);
    }
  }

  #apriCanale(comando: Extract<ComandoAnteprima, { tipo: "anteprima-ws-apri" }>): void {
    const { idCanale } = comando;
    let socket: WebSocket;
    try {
      socket = new WebSocket(`ws://localhost:${comando.porta}${comando.percorso}`, comando.protocolli);
    } catch {
      this.#riferisci({ tipo: "anteprima-ws-chiuso", idCanale });
      return;
    }
    socket.binaryType = "arraybuffer";
    this.#canali.set(idCanale, socket);
    socket.addEventListener("open", () => {
      this.#riferisci({ tipo: "anteprima-ws-aperto", idCanale, protocollo: socket.protocol });
    });
    socket.addEventListener("message", (evento: MessageEvent) => {
      const dato: unknown = evento.data;
      if (typeof dato === "string") this.#riferisci({ tipo: "anteprima-ws-arrivo", idCanale, testo: dato });
      else if (dato instanceof ArrayBuffer) {
        this.#riferisci({ tipo: "anteprima-ws-arrivo", idCanale, binario: Buffer.from(dato).toString("base64") });
      }
    });
    const finito = (): void => {
      if (this.#canali.get(idCanale) !== socket) return;
      this.#canali.delete(idCanale);
      this.#riferisci({ tipo: "anteprima-ws-chiuso", idCanale });
    };
    socket.addEventListener("close", finito);
    // Un errore è seguito dalla chiusura; se il collegamento non si è mai aperto, la si dice subito.
    socket.addEventListener("error", finito);
  }

  #chiudiCanale(idCanale: string): void {
    const socket = this.#canali.get(idCanale);
    if (socket === undefined) return;
    this.#canali.delete(idCanale);
    try {
      socket.close();
    } catch {
      // Già chiuso.
    }
  }
}

/** Le intestazioni del browser come le deve vedere l'applicazione: per lei chi chiama è `localhost`. */
export function perLApplicazione(intestazioni: Intestazioni, origine: string): Intestazioni {
  const inoltrate: Intestazioni = [];
  for (const [nome, valore] of intestazioni) {
    const minuscolo = nome.toLowerCase();
    if (NON_INOLTRATE.has(minuscolo)) continue;
    if (minuscolo === "origin") inoltrate.push([nome, origine]);
    else if (minuscolo === "referer") inoltrate.push([nome, conOrigine(valore, origine)]);
    else inoltrate.push([nome, valore]);
  }
  return inoltrate;
}

function conOrigine(indirizzo: string, origine: string): string {
  try {
    const letto = new URL(indirizzo);
    return origine + letto.pathname + letto.search;
  } catch {
    return origine + "/";
  }
}

/** Le intestazioni della risposta come le deve vedere il browser, che sta parlando con il centro. */
export function perIlBrowser(intestazioni: Headers, porta: number): Intestazioni {
  const riferite: Intestazioni = [];
  for (const [nome, valore] of intestazioni) {
    if (NON_RIFERITE.has(nome.toLowerCase())) continue;
    riferite.push([nome, nome.toLowerCase() === "location" ? senzaOrigineLocale(valore, porta) : valore]);
  }
  // Ogni cookie ha la sua riga: messi insieme non si leggerebbero più.
  for (const cookie of intestazioni.getSetCookie()) riferite.push(["set-cookie", cookie]);
  return riferite;
}

/** Un rinvio verso l'applicazione stessa diventa un percorso: per il browser l'applicazione sta al centro. */
export function senzaOrigineLocale(indirizzo: string, porta: number): string {
  for (const origine of [`http://localhost:${porta}`, `http://127.0.0.1:${porta}`, `http://[::1]:${porta}`]) {
    if (indirizzo === origine) return "/";
    if (indirizzo.startsWith(`${origine}/`) || indirizzo.startsWith(`${origine}?`)) {
      const resto = indirizzo.slice(origine.length);
      return resto.startsWith("/") ? resto : `/${resto}`;
    }
  }
  return indirizzo;
}

function codiceDi(errore: unknown): string | undefined {
  if (typeof errore !== "object" || errore === null) return undefined;
  const campi = errore as { code?: unknown; cause?: unknown; errors?: unknown };
  if (typeof campi.code === "string") return campi.code;
  if (Array.isArray(campi.errors)) {
    for (const interno of campi.errors as unknown[]) {
      const codice = codiceDi(interno);
      if (codice !== undefined) return codice;
    }
  }
  return codiceDi(campi.cause);
}

function motivoDi(errore: unknown, porta: number): string {
  const codice = codiceDi(errore);
  if (codice === "ECONNREFUSED") return `Sulla porta ${porta} di questo ambiente non risponde nulla.`;
  if (codice === "ECONNRESET" || codice === "UND_ERR_SOCKET") {
    return `L'applicazione sulla porta ${porta} ha chiuso il collegamento.`;
  }
  const dettaglio = errore instanceof Error ? errore.message : String(errore);
  return `La richiesta alla porta ${porta} non è riuscita: ${dettaglio}`;
}
