/**
 * Il ponte di un nodo (ADR 0058): un nodo che non vede il centro si collega attraverso il ponte, con
 * il collegamento cifrato da capo a capo; lo script per un ambiente nuovo passa; il resto no.
 */

import assert from "node:assert/strict";
import { connect as connettiTcp } from "node:net";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { connect as connettiTls } from "node:tls";
import { COOKIE_SESSIONE } from "../centro/centro.ts";
import { allestisci, avviaNodoAccettato, finche, ID_NODO } from "../prove/banco.ts";
import { NOME_TLS_DEI_NODI } from "../protocollo/nodi.ts";
import { nomeChiesto, Ponte } from "./ponte.ts";

/** Una richiesta in chiaro attraverso il ponte: la risposta intera, come testo. */
function richiesta(porta: number, testo: string): Promise<string> {
  return new Promise((risolvi) => {
    const socket = connettiTcp({ host: "127.0.0.1", port: porta }, () => socket.write(testo));
    let ricevuto = "";
    socket.on("data", (dati) => (ricevuto += dati.toString("latin1")));
    socket.on("close", () => risolvi(ricevuto));
    socket.on("error", () => risolvi(ricevuto));
  });
}

test("attraverso il ponte un nodo si collega cifrato e viene accolto; lo script passa, le pagine no, gli altri nomi TLS nemmeno", { timeout: 30_000 }, async (t) => {
  const banco = await allestisci(t);
  await banco.centro.listen({ host: "127.0.0.1", port: 0 });
  const centro = `http://127.0.0.1:${(banco.centro.server.address() as AddressInfo).port}`;
  const ponte = new Ponte({ centro, ascolta: "127.0.0.1" });
  const porta = await ponte.apri(0);
  t.after(() => ponte.chiudi());

  const nodo = await avviaNodoAccettato(t, banco, { centro: `http://127.0.0.1:${porta}` });
  assert.ok(nodo.stati.some((stato) => stato.stato === "attivo"));
  assert.equal(banco.ambienti.attivo(ID_NODO), true);
  // Il collegamento è cifrato da capo a capo: il centro lo vede tale.
  assert.equal(banco.ambienti.stato().ambienti.find((ambiente) => ambiente.id === ID_NODO)?.cifrato, true);

  // Lo script per un ambiente nuovo arriva al centro (che qui dice che l'invito non vale).
  const script = await richiesta(porta, "GET /api/ambienti/preparazione?invito=nessuno HTTP/1.1\r\nHost: x\r\n\r\n");
  assert.match(script, /^HTTP\/1\.1 (4\d\d|200)/);
  assert.doesNotMatch(script, /ponte serve solo/);
  // Le pagine e le API dell'interfaccia no.
  assert.match(await richiesta(porta, "GET / HTTP/1.1\r\nHost: x\r\n\r\n"), /^HTTP\/1\.1 403[\s\S]*ponte serve solo ai nodi/);
  assert.match(await richiesta(porta, "POST /api/accesso HTTP/1.1\r\nHost: x\r\n\r\n"), /^HTTP\/1\.1 403/);
  // Un collegamento cifrato con un altro nome si chiude senza risposta.
  const altro = await new Promise<string>((risolvi) => {
    const socket = connettiTls({ host: "127.0.0.1", port: porta, servername: "shinka.example", rejectUnauthorized: false });
    socket.on("secureConnect", () => risolvi("aperto"));
    socket.on("error", () => risolvi("chiuso"));
    socket.on("close", () => risolvi("chiuso"));
  });
  assert.equal(altro, "chiuso");
});

test("il nome chiesto si legge dal saluto TLS, anche quando arriva a pezzi", async (t) => {
  const { createServer } = await import("node:net");
  let ricevuto = Buffer.alloc(0);
  const server = createServer((socket) => socket.on("data", (dati) => (ricevuto = Buffer.concat([ricevuto, dati]))));
  await new Promise<void>((risolvi) => server.listen(0, "127.0.0.1", () => risolvi()));
  t.after(() => server.close());
  const socket = connettiTls({ host: "127.0.0.1", port: (server.address() as AddressInfo).port, servername: NOME_TLS_DEI_NODI, rejectUnauthorized: false });
  socket.on("error", () => {});
  while (nomeChiesto(ricevuto) === undefined) await new Promise((fatto) => setTimeout(fatto, 10));
  socket.destroy();
  assert.equal(nomeChiesto(ricevuto), NOME_TLS_DEI_NODI);
  assert.equal(nomeChiesto(ricevuto.subarray(0, 20)), undefined);
  assert.equal(nomeChiesto(Buffer.from("GET / HTTP/1.1\r\n")), null);
});

test("il proprietario accende il ponte di un ambiente: il centro lo dice al nodo, anche a ogni collegamento, e la pagina sa se è aperto", { timeout: 30_000 }, async (t) => {
  const banco = await allestisci(t);
  await banco.centro.listen({ host: "127.0.0.1", port: 0 });
  const centro = `http://127.0.0.1:${(banco.centro.server.address() as AddressInfo).port}`;
  const ponte = new Ponte({ centro, ascolta: "127.0.0.1" });
  t.after(() => ponte.chiudi());
  const nodo = await avviaNodoAccettato(t, banco, { ponte });
  const cookie = await banco.entra();
  const accendi = (porta: number | null) => banco.centro.inject({ method: "POST", url: `/api/ambienti/${ID_NODO}/ponte`, cookies: { [COOKIE_SESSIONE]: cookie }, payload: { porta } });
  const statoDelPonte = () => banco.ambienti.stato().ambienti.find((ambiente) => ambiente.id === ID_NODO)?.ponte;

  assert.equal((await accendi(80)).statusCode, 400);
  assert.equal((await accendi(47_990)).statusCode, 200);
  await finche(() => statoDelPonte()?.aperto === true, "il nodo apre il ponte");
  assert.equal(ponte.porta, 47_990);
  // Il nodo si ricollega: il centro gli ridice di aprirlo.
  await ponte.chiudi();
  nodo.collegamento.ferma();
  await finche(() => !banco.ambienti.attivo(ID_NODO), "il nodo si scollega");
  assert.deepEqual(statoDelPonte(), { porta: 47_990, aperto: false, motivo: "L'ambiente è spento." });
  nodo.collegamento.avvia();
  await finche(() => statoDelPonte()?.aperto === true && ponte.porta === 47_990, "il ponte si riapre al collegamento");
  // Spento, si chiude.
  assert.equal((await accendi(null)).statusCode, 200);
  await finche(() => ponte.porta === undefined, "il nodo chiude il ponte");
  assert.equal(statoDelPonte(), undefined);
});
