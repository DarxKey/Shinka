import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { request as richiestaHttp } from "node:http";
import { request as richiestaHttps } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import WebSocket from "ws";
import { preparaCertificati, type CertificatiPronti } from "./https.ts";
import { serverPoliglotta } from "./poliglotta.ts";
import { connect as connettiTls } from "node:tls";
import { NOME_TLS_DEI_NODI } from "../protocollo/nodi.ts";
import { improntaInBreve, preparaIdentitaPerINodi } from "./identita-per-i-nodi.ts";

async function certificati(t: TestContext): Promise<CertificatiPronti> {
  const dove = await mkdtemp(join(tmpdir(), "shinka-poliglotta-"));
  t.after(() => rm(dove, { recursive: true, force: true }));
  return preparaCertificati(join(dove, "https"), ["127.0.0.1", "localhost"]);
}

async function servizio(c: CertificatiPronti) {
  const app = fastify({ forceCloseConnections: true, serverFactory: (gestore) => serverPoliglotta(gestore, { chiave: c.chiave, catena: c.catena }) });
  await app.register(fastifyWebsocket);
  app.get("/chi", async (richiesta) => ({ protocollo: richiesta.protocol }));
  app.get("/eco", { websocket: true }, (presa, richiesta) => presa.send(richiesta.protocol));
  // Un flusso che non finisce, come quello degli eventi della chat.
  app.get("/flusso", (_richiesta, risposta) => {
    risposta.hijack();
    risposta.raw.writeHead(200, { "content-type": "text/event-stream" });
    risposta.raw.write(": aperto\n\n");
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  return { app, porta: (app.server.address() as AddressInfo).port };
}

function leggi(schema: "http" | "https", porta: number, percorso: string, ca?: string): Promise<string> {
  return new Promise((fatto, fallito) => {
    const q = (schema === "https" ? richiestaHttps : richiestaHttp)({ host: "127.0.0.1", port: porta, path: percorso, ...(ca === undefined ? {} : { ca }) }, (r) => {
      let testo = "";
      r.on("data", (pezzo) => (testo += pezzo));
      r.on("end", () => fatto(testo));
    });
    q.on("error", fallito);
    q.end();
  });
}

test("la stessa porta risponde in HTTP e in HTTPS, anche ai WebSocket, e chi non si fida viene respinto", async (t) => {
  const c = await certificati(t);
  const { app, porta } = await servizio(c);
  t.after(() => app.close());
  const ca = c.ca?.pem ?? "";
  for (let giro = 0; giro < 3; giro += 1) {
    assert.deepEqual(JSON.parse(await leggi("http", porta, "/chi")), { protocollo: "http" });
    assert.deepEqual(JSON.parse(await leggi("https", porta, "/chi", ca)), { protocollo: "https" });
  }
  await assert.rejects(leggi("https", porta, "/chi"), /self-signed|SELF_SIGNED|certificate/i);
  // Dopo una stretta di mano rifiutata il server c'è ancora.
  assert.deepEqual(JSON.parse(await leggi("http", porta, "/chi")), { protocollo: "http" });
  for (const [indirizzo, atteso] of [[`ws://127.0.0.1:${porta}/eco`, "http"], [`wss://127.0.0.1:${porta}/eco`, "https"]] as const) {
    const ricevuto = await new Promise<string>((fatto, fallito) => {
      const presa = new WebSocket(indirizzo, { ca });
      presa.on("message", (dato) => {
        presa.close();
        fatto(dato.toString());
      });
      presa.on("error", fallito);
    });
    assert.equal(ricevuto, atteso);
  }
});

test("allo spegnimento si chiudono anche le connessioni cifrate, come un flusso di eventi aperto in HTTPS", async (t) => {
  const c = await certificati(t);
  const { app, porta } = await servizio(c);
  await new Promise<void>((fatto) => {
    const q = richiestaHttps({ host: "127.0.0.1", port: porta, path: "/flusso", ca: c.ca?.pem ?? "" }, (r) => r.once("data", () => fatto()));
    q.on("error", () => {});
    q.end();
  });
  const inizio = Date.now();
  await app.close();
  assert.ok(Date.now() - inizio < 2000, `chiuso in ${Date.now() - inizio} ms`);
});

test("chi chiede il nome dei nodi riceve il loro certificato, gli altri quello dell'HTTPS", async (t) => {
  const c = await certificati(t);
  const dove = await mkdtemp(join(tmpdir(), "shinka-poliglotta-nodi-"));
  t.after(() => rm(dove, { recursive: true, force: true }));
  const nodi = preparaIdentitaPerINodi(dove);
  const app = fastify({ forceCloseConnections: true, serverFactory: (gestore) => serverPoliglotta(gestore, { chiave: c.chiave, catena: c.catena }, { chiave: nodi.chiave, catena: nodi.certificato }) });
  await app.register(fastifyWebsocket);
  app.get("/eco", { websocket: true }, (presa, richiesta) => presa.send(String((richiesta.raw.socket as { encrypted?: boolean }).encrypted === true)));
  await app.listen({ host: "127.0.0.1", port: 0 });
  t.after(() => app.close());
  const porta = (app.server.address() as AddressInfo).port;
  const vista = (nome: string | undefined): Promise<string> =>
    new Promise((fatto, fallito) => {
      const presa = connettiTls({ host: "127.0.0.1", port: porta, rejectUnauthorized: false, ...(nome === undefined ? {} : { servername: nome }) }, () => {
        const certificato = presa.getPeerX509Certificate();
        presa.destroy();
        if (certificato === undefined) fallito(new Error("nessun certificato"));
        else fatto(improntaInBreve(certificato));
      });
      presa.on("error", fallito);
    });
  assert.equal(await vista(NOME_TLS_DEI_NODI), nodi.impronta);
  assert.notEqual(await vista("localhost"), nodi.impronta);
  assert.notEqual(await vista(undefined), nodi.impronta);

  // Un WebSocket aperto con il certificato dei nodi arriva al centro come cifrato.
  const detto = await new Promise<string>((fatto, fallito) => {
    const presa = new WebSocket(`wss://127.0.0.1:${porta}/eco`, { servername: NOME_TLS_DEI_NODI, rejectUnauthorized: false } as WebSocket.ClientOptions);
    presa.on("message", (dati) => {
      fatto(dati.toString());
      presa.close();
    });
    presa.on("error", fallito);
  });
  assert.equal(detto, "true");
});
