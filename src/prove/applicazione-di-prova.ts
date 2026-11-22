/**
 * Un'applicazione web di prova, in ascolto su una porta libera di questa macchina: fa da
 * applicazione del progetto nei test dell'anteprima.
 */

import fastifyWebsocket from "@fastify/websocket";
import fastify from "fastify";
import type { AddressInfo } from "node:net";
import type { TestContext } from "node:test";

export interface ApplicazioneDiProva {
  porta: number;
  /** Le richieste arrivate, nell'ordine: metodo, percorso e intestazioni. */
  richieste: { metodo: string; percorso: string; intestazioni: Record<string, string | string[] | undefined> }[];
}

export async function avviaApplicazione(t: TestContext): Promise<ApplicazioneDiProva> {
  const app = fastify({ forceCloseConnections: true });
  await app.register(fastifyWebsocket);
  const richieste: ApplicazioneDiProva["richieste"] = [];
  app.addHook("onRequest", async (richiesta) => {
    richieste.push({ metodo: richiesta.method, percorso: richiesta.url, intestazioni: richiesta.headers });
  });

  app.get("/", async (_richiesta, risposta) =>
    risposta
      .header("Set-Cookie", ["sessione-app=uno; Path=/", "shinka_sessione=rubata; Path=/", "shinka_vault=finto; Path=/vault"])
      .header("X-Frame-Options", "DENY")
      .header("Cache-Control", "public, max-age=3600")
      .header("ETag", '"uno"')
      .header("Content-Security-Policy", "default-src 'self'; frame-ancestors 'none'")
      .type("text/html; charset=utf-8")
      .send("<!doctype html><h1>Applicazione di prova</h1>"),
  );
  app.get("/vai", async (richiesta, risposta) =>
    risposta.redirect(`http://localhost:${(richiesta.socket.address() as AddressInfo).port}/arrivo?da=vai`),
  );
  app.get("/grande", async (_richiesta, risposta) => risposta.type("text/plain").send("x".repeat(700_000)));
  app.post("/eco", async (richiesta) => ({
    corpo: richiesta.body,
    cookie: richiesta.headers.cookie ?? null,
    host: richiesta.headers.host ?? null,
    origine: richiesta.headers.origin ?? null,
  }));
  app.get("/ws", { websocket: true }, (socket) => {
    socket.on("message", (dati, binario) => {
      if (binario) socket.send(dati, { binary: true });
      else socket.send(`eco: ${dati.toString()}`);
    });
  });

  await app.listen({ host: "127.0.0.1", port: 0 });
  t.after(() => app.close());
  return { porta: (app.server.address() as AddressInfo).port, richieste };
}

/** Una porta di questa macchina su cui non ascolta nessuno. */
export async function portaLibera(): Promise<number> {
  const app = fastify();
  await app.listen({ host: "127.0.0.1", port: 0 });
  const { port } = app.server.address() as AddressInfo;
  await app.close();
  return port;
}
