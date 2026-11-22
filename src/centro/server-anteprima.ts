/**
 * Il server dell'anteprima: una porta a parte del centro, da cui il browser del proprietario
 * vede l'applicazione web del progetto come se le parlasse direttamente.
 *
 * Sta su un'altra porta perché così è un'altra origine: gli script dell'applicazione non
 * arrivano all'interfaccia di Shinka né alle sue API. Serve solo chi ha la sessione del
 * proprietario, e quel cookie non lo passa all'applicazione.
 */

import fastifyCookie from "@fastify/cookie";
import fastifyWebsocket from "@fastify/websocket";
import fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import type { RequestListener, ServerResponse } from "node:http";
import { serverPoliglotta, type CredenzialiTls } from "./poliglotta.ts";
import {
  CORPO_ANTEPRIMA_MASSIMO,
  MESSAGGIO_ANTEPRIMA_MASSIMO,
  type Intestazioni,
} from "../protocollo/anteprima.ts";
import type { Accesso } from "./accesso.ts";
import type { Anteprime } from "./anteprima.ts";
import { COOKIE_SESSIONE } from "./centro.ts";

/** Quanti messaggi si tengono da parte mentre il WebSocket verso l'applicazione si apre. */
const CODA_MASSIMA = 200;

export interface OpzioniServerAnteprima {
  accesso: Accesso;
  anteprime: Anteprime;
  /** Con un certificato, l'anteprima parla HTTPS e HTTP sulla stessa porta, come il centro. */
  tls?: CredenzialiTls;
}

export async function creaServerAnteprima(opzioni: OpzioniServerAnteprima): Promise<FastifyInstance> {
  const { accesso, anteprime, tls } = opzioni;
  const app = fastify({
    bodyLimit: CORPO_ANTEPRIMA_MASSIMO,
    forceCloseConnections: true,
    // Dentro una pagina HTTPS un riquadro in HTTP verrebbe bloccato: l'anteprima parla anche HTTPS.
    ...(tls === undefined ? {} : { serverFactory: (gestore: RequestListener) => serverPoliglotta(gestore, tls) }),
    // HEAD ha la sua strada qui sotto, come ogni altro metodo.
    exposeHeadRoutes: false,
  });
  await app.register(fastifyCookie);
  await app.register(fastifyWebsocket, { options: { maxPayload: MESSAGGIO_ANTEPRIMA_MASSIMO } });
  // Il corpo va all'applicazione così com'è: qui non lo si interpreta.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", { parseAs: "buffer" }, (_richiesta, corpo, fatto) => fatto(null, corpo));

  const autorizzata = (richiesta: FastifyRequest): boolean => accesso.valida(richiesta.cookies[COOKIE_SESSIONE]);

  const gestisci = (richiesta: FastifyRequest, risposta: FastifyReply): void => {
    risposta.hijack();
    const uscita = risposta.raw;
    if (!autorizzata(richiesta)) {
      scriviPagina(uscita, 401, "Per vedere l'anteprima entra prima in Shinka, da questo stesso browser.");
      return;
    }
    const corpo = Buffer.isBuffer(richiesta.body) && richiesta.body.length > 0 ? richiesta.body : undefined;
    let cominciata = false;
    let finita = false;
    const annulla = anteprime.richiedi(
      {
        metodo: richiesta.method,
        percorso: richiesta.url,
        intestazioni: senzaLaSessione(richiesta.raw.rawHeaders),
        ...(corpo === undefined ? {} : { corpo }),
      },
      {
        inizio: (stato, intestazioni) => {
          cominciata = true;
          try {
            uscita.writeHead(stato, perIlBrowser(intestazioni));
          } catch {
            finita = true;
            uscita.destroy();
          }
        },
        pezzo: (dati) => {
          if (!finita) uscita.write(dati);
        },
        fine: () => {
          if (finita) return;
          finita = true;
          uscita.end();
        },
        errore: (motivo) => {
          if (finita) return;
          finita = true;
          if (cominciata) uscita.destroy();
          else scriviPagina(uscita, 502, motivo);
        },
      },
    );
    if (annulla === undefined) {
      finita = true;
      scriviPagina(uscita, 404, "Non c'è nessuna anteprima aperta. Aprila da un progetto di Shinka.");
      return;
    }
    // Il browser se n'è andato prima della fine: l'applicazione non deve continuare a rispondere.
    uscita.on("close", () => {
      if (finita) return;
      finita = true;
      annulla();
    });
  };

  app.route({
    method: "GET",
    url: "/*",
    handler: gestisci,
    wsHandler: (socket, richiesta) => {
      if (!autorizzata(richiesta)) {
        socket.close(1008, "Accesso richiesto.");
        return;
      }
      const protocolli = String(richiesta.headers["sec-websocket-protocol"] ?? "")
        .split(",")
        .map((protocollo) => protocollo.trim())
        .filter((protocollo) => protocollo !== "");
      let aperto = false;
      const inCoda: (string | Buffer)[] = [];
      const canale = anteprime.apriCanale(richiesta.url, protocolli, {
        aperto: () => {
          aperto = true;
          for (const dato of inCoda.splice(0)) canale?.manda(dato);
        },
        arrivo: (dato) => {
          if (socket.readyState === socket.OPEN) socket.send(dato, { binary: typeof dato !== "string" });
        },
        chiuso: () => socket.close(),
      });
      if (canale === undefined) {
        socket.close(1011, "Nessuna anteprima aperta.");
        return;
      }
      socket.on("message", (dati, binario) => {
        const intero = Array.isArray(dati) ? Buffer.concat(dati) : Buffer.from(dati as Buffer);
        const dato = binario ? intero : intero.toString("utf8");
        if (aperto) canale.manda(dato);
        else if (inCoda.length < CODA_MASSIMA) inCoda.push(dato);
      });
      socket.on("close", () => canale.chiudi());
      socket.on("error", () => socket.close());
    },
  });
  app.route({ method: ["HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"], url: "/*", handler: gestisci });

  return app;
}

/**
 * Un cookie di Shinka: la sessione del proprietario, o quella della pagina del vault, che sta sullo
 * stesso host a un'altra porta. Il browser li manda a ogni porta di questo host, anteprima compresa.
 */
function diShinka(cookie: string): boolean {
  return (cookie.split("=")[0]?.trim() ?? "").startsWith("shinka_");
}

/**
 * Le intestazioni della richiesta, senza i cookie di Shinka: l'applicazione non deve vederli. Via
 * anche le domande "è cambiato da allora?": su questa porta passano applicazioni diverse, e una
 * copia che il browser avesse conservato potrebbe essere di un'altra.
 */
export function senzaLaSessione(grezze: readonly string[]): Intestazioni {
  const intestazioni: Intestazioni = [];
  for (let posizione = 0; posizione + 1 < grezze.length; posizione += 2) {
    const nome = grezze[posizione] ?? "";
    const valore = grezze[posizione + 1] ?? "";
    const minuscolo = nome.toLowerCase();
    if (minuscolo === "if-none-match" || minuscolo === "if-modified-since") continue;
    if (minuscolo !== "cookie") {
      intestazioni.push([nome, valore]);
      continue;
    }
    const altri = valore
      .split(";")
      .map((cookie) => cookie.trim())
      .filter((cookie) => cookie !== "" && !diShinka(cookie));
    if (altri.length > 0) intestazioni.push([nome, altri.join("; ")]);
  }
  return intestazioni;
}

/**
 * Le intestazioni della risposta per il browser. L'applicazione non può scrivere un cookie di
 * Shinka, e il divieto di stare in un riquadro non vale: è lì che il proprietario la guarda.
 * Il browser non conserva nulla: la stessa porta mostra oggi un'applicazione e domani un'altra,
 * e una pagina conservata della prima comparirebbe al posto della seconda.
 */
export function perIlBrowser(intestazioni: Intestazioni): Record<string, string | string[]> {
  const perNome: Record<string, string | string[]> = {};
  for (const [nome, valore] of intestazioni) {
    const minuscolo = nome.toLowerCase();
    if (minuscolo === "x-frame-options" || minuscolo === "connection" || minuscolo === "transfer-encoding") continue;
    if (minuscolo === "cache-control" || minuscolo === "expires") continue;
    let scritto = valore;
    if (minuscolo === "set-cookie" && diShinka(valore)) continue;
    if (minuscolo === "content-security-policy") {
      scritto = valore
        .split(";")
        .filter((direttiva) => !direttiva.trim().toLowerCase().startsWith("frame-ancestors"))
        .join(";");
      if (scritto.trim() === "") continue;
    }
    const prima = perNome[minuscolo];
    if (prima === undefined) perNome[minuscolo] = scritto;
    else perNome[minuscolo] = Array.isArray(prima) ? [...prima, scritto] : [prima, scritto];
  }
  perNome["cache-control"] = "no-store";
  return perNome;
}

function scriviPagina(uscita: ServerResponse, stato: number, messaggio: string): void {
  const pulito = messaggio.replace(/[&<>]/g, (carattere) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[carattere] ?? "");
  const pagina = `<!doctype html><html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Anteprima · Shinka</title><body style="font-family: system-ui, sans-serif; margin: 15vh auto; max-width: 420px; padding: 0 16px; line-height: 1.5"><h1 style="font-size: 1.25rem">Anteprima</h1><p>${pulito}</p></body></html>`;
  try {
    uscita.writeHead(stato, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
    });
    uscita.end(pagina);
  } catch {
    uscita.destroy();
  }
}
