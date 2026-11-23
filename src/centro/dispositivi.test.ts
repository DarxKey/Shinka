/**
 * I gettoni dei dispositivi, come Shinka Desktop (ADR 0047): nell'accesso, e attraverso il centro.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import type { StatoSicurezza } from "../protocollo/sicurezza.ts";
import { allestisci, PASSWORD, type Banco } from "../prove/banco.ts";
import { Accesso, DISPOSITIVO_DECADE_DOPO_MS } from "./accesso.ts";
import { COOKIE_SESSIONE, gettoneDi } from "./centro.ts";
import { programmaDa } from "./registro-accessi.ts";

const APP = "ShinkaDesktop/0.1.0 (Windows)";

async function cartellaProvvisoria(t: TestContext): Promise<string> {
  const cartella = await mkdtemp(join(tmpdir(), "shinka-dispositivi-"));
  t.after(() => rm(cartella, { recursive: true, force: true }));
  return cartella;
}

test("un dispositivo riceve il gettone con la password; sul disco ne resta l'impronta; vale finché viene usato", async (t) => {
  const cartella = await cartellaProvvisoria(t);
  const accesso = await Accesso.apri(cartella);
  await accesso.impostaPassword(PASSWORD);
  const ora = Date.parse("2026-11-23T10:00:00Z");

  assert.deepEqual(await accesso.aggiungiDispositivo("sbagliata!!", { nome: "PC", genere: "desktop" }, ora), { esito: "rifiutato" });
  const esito = await accesso.aggiungiDispositivo(PASSWORD, { nome: "PC dello studio", genere: "desktop" }, ora, { da: "192.168.1.30", programma: "Shinka Desktop 0.1.0" });
  assert.equal(esito.esito, "ok");
  if (esito.esito !== "ok") return;
  assert.ok(esito.token.length >= 40);
  assert.equal((await readFile(join(cartella, "dispositivi.json"), "utf8")).includes(esito.token), false);
  assert.equal(accesso.validaDispositivo(esito.token, ora), true);
  assert.equal(accesso.validaDispositivo("inventato-inventato-inventato", ora), false);
  // Un gettone non è una sessione, e una sessione non è un gettone.
  assert.equal(accesso.valida(esito.token, ora), false);
  assert.deepEqual(accesso.dispositivi(ora).map((d) => [d.id, d.nome, d.genere, d.programma]), [[esito.id, "PC dello studio", "desktop", "Shinka Desktop 0.1.0"]]);

  // Un altro processo con gli stessi dati lo riconosce.
  assert.equal((await Accesso.apri(cartella)).validaDispositivo(esito.token, ora), true);

  // Usato, vale altri novanta giorni da quel momento; fermo, decade.
  const dopo80 = ora + 80 * 24 * 3600 * 1000;
  accesso.segnaDispositivo(esito.token, { da: "10.0.0.9", programma: "Shinka Desktop 0.2.0" }, dopo80);
  assert.equal(accesso.validaDispositivo(esito.token, ora + DISPOSITIVO_DECADE_DOPO_MS + 1), true);
  assert.equal(accesso.dispositivi(dopo80)[0]?.programma, "Shinka Desktop 0.2.0");
  assert.equal(accesso.validaDispositivo(esito.token, dopo80 + DISPOSITIVO_DECADE_DOPO_MS + 1), false);
});

test("si toglie dal suo identificativo o esce da sé; cambiare la password li toglie tutti", async (t) => {
  const accesso = await Accesso.apri(await cartellaProvvisoria(t));
  await accesso.impostaPassword(PASSWORD);
  const uno = await accesso.aggiungiDispositivo(PASSWORD, { nome: "Uno", genere: "desktop" });
  const due = await accesso.aggiungiDispositivo(PASSWORD, { nome: "Due", genere: "desktop" });
  const tre = await accesso.aggiungiDispositivo(PASSWORD, { nome: "Tre", genere: "desktop" });
  assert.ok(uno.esito === "ok" && due.esito === "ok" && tre.esito === "ok");

  assert.equal(await accesso.togliDispositivo(uno.id), true);
  assert.equal(await accesso.togliDispositivo(uno.id), false);
  assert.equal(accesso.validaDispositivo(uno.token), false);
  assert.equal(await accesso.esciDalDispositivo(due.token), true);
  assert.equal(accesso.validaDispositivo(due.token), false);

  await accesso.cambiaPassword(PASSWORD, "un'altra-password-lunga");
  assert.equal(accesso.validaDispositivo(tre.token), false);
  assert.deepEqual(accesso.dispositivi(), []);
});

test("nel registro l'app si chiama Shinka Desktop, con la versione", () => {
  assert.equal(programmaDa(APP), "Shinka Desktop 0.1.0");
  assert.equal(programmaDa("ShinkaDesktop/1.2.3-beta.1"), "Shinka Desktop 1.2.3-beta.1");
  assert.equal(programmaDa("node"), "node");
  assert.equal(gettoneDi("Bearer abcdefghijklmnopqrstuvwxyz_-0123"), "abcdefghijklmnopqrstuvwxyz_-0123");
  assert.equal(gettoneDi("Basic abcdefghijklmnopqrstuvwxyz"), undefined);
  assert.equal(gettoneDi("Bearer corto"), undefined);
  assert.equal(gettoneDi(undefined), undefined);
});

async function aggiungi(banco: Banco, password = PASSWORD) {
  return banco.centro.inject({
    method: "POST",
    url: "/api/dispositivi",
    headers: { "user-agent": APP },
    payload: { password, nome: "PC dello studio", genere: "desktop" },
  });
}

test("dal centro: il gettone al posto del cookie, nella pagina Sicurezza, e tolto da lì non vale più", async (t) => {
  const banco = await allestisci(t);
  assert.equal((await aggiungi(banco, "sbagliata!!")).statusCode, 401);
  const risposta = await aggiungi(banco);
  assert.equal(risposta.statusCode, 201);
  const { id, token } = risposta.json() as { id: string; token: string };
  const conGettone = { authorization: `Bearer ${token}`, "user-agent": APP };

  const sicurezza = await banco.centro.inject({ method: "GET", url: "/api/sicurezza", headers: conGettone });
  assert.equal(sicurezza.statusCode, 200);
  const stato = sicurezza.json() as StatoSicurezza;
  assert.equal(stato.questoDispositivo, id);
  assert.deepEqual(stato.dispositivi?.map((d) => [d.nome, d.programma]), [["PC dello studio", "Shinka Desktop 0.1.0"]]);
  assert.ok(stato.voci.some((voce) => voce.tipo === "dispositivo-aggiunto" && voce.programma === "Shinka Desktop 0.1.0"));
  assert.ok(stato.voci.some((voce) => voce.tipo === "dispositivo-non-aggiunto"));
  assert.equal((await banco.centro.inject({ method: "GET", url: "/api/stato", headers: conGettone })).json().autenticato, true);

  // Il proprietario lo toglie dalla pagina Sicurezza, dal browser: la richiesta dopo risponde 401.
  const cookies = { [COOKIE_SESSIONE]: await banco.entra() };
  const tolto = await banco.centro.inject({ method: "POST", url: `/api/sicurezza/dispositivi/${id}/chiusura`, cookies });
  assert.equal(tolto.statusCode, 200);
  assert.equal((await banco.centro.inject({ method: "GET", url: "/api/sicurezza", headers: conGettone })).statusCode, 401);
  // Con un gettone che non vale non basta un cookie valido: vale il gettone.
  assert.equal((await banco.centro.inject({ method: "GET", url: "/api/sicurezza", headers: conGettone, cookies })).statusCode, 401);
});

test("dal centro: i gettoni sbagliati non frenano la password; l'app esce da sé; un altro sito non può chiedere un gettone", async (t) => {
  const banco = await allestisci(t);
  for (let i = 0; i < 10; i++) {
    const inventato = await banco.centro.inject({ method: "GET", url: "/api/sicurezza", headers: { authorization: "Bearer inventato-inventato-inventato" } });
    assert.equal(inventato.statusCode, 401);
  }
  const entrata = await banco.centro.inject({ method: "POST", url: "/api/accesso", payload: { password: PASSWORD } });
  assert.equal(entrata.statusCode, 200);

  const { token } = (await aggiungi(banco)).json() as { token: string };
  const uscita = await banco.centro.inject({ method: "POST", url: "/api/dispositivi/chiusura", headers: { authorization: `Bearer ${token}` } });
  assert.deepEqual([uscita.statusCode, uscita.json()], [200, { chiuso: true }]);
  assert.equal((await banco.centro.inject({ method: "GET", url: "/api/sicurezza", headers: { authorization: `Bearer ${token}` } })).statusCode, 401);

  const daFuori = await banco.centro.inject({
    method: "POST",
    url: "/api/dispositivi",
    headers: { origin: "https://altro.example" },
    payload: { password: PASSWORD, nome: "x", genere: "desktop" },
  });
  assert.equal(daFuori.statusCode, 403);
  const genereStrano = await banco.centro.inject({ method: "POST", url: "/api/dispositivi", payload: { password: PASSWORD, nome: "x", genere: "telefono" } });
  assert.equal(genereStrano.statusCode, 400);
});

test("dal centro: un WebSocket con il gettone si apre senza origine; con il solo cookie no", async (t) => {
  const banco = await allestisci(t);
  const { token } = (await aggiungi(banco)).json() as { token: string };
  const comeWebSocket = { upgrade: "websocket", connection: "Upgrade" };
  const conGettone = await banco.centro.inject({ method: "GET", url: "/api/sicurezza", headers: { ...comeWebSocket, authorization: `Bearer ${token}` } });
  assert.notEqual(conGettone.statusCode, 403);
  const conCookie = await banco.centro.inject({ method: "GET", url: "/api/sicurezza", headers: comeWebSocket, cookies: { [COOKIE_SESSIONE]: await banco.entra() } });
  assert.equal(conCookie.statusCode, 403);
  const conGettoneDaUnAltroSito = await banco.centro.inject({
    method: "GET",
    url: "/api/sicurezza",
    headers: { ...comeWebSocket, authorization: `Bearer ${token}`, origin: "https://altro.example" },
  });
  assert.equal(conGettoneDaUnAltroSito.statusCode, 403);
});

test("dal centro: un flusso di eventi aperto con il gettone riceve gli eventi come con il cookie", async (t) => {
  const banco = await allestisci(t);
  const { token } = (await aggiungi(banco)).json() as { token: string };
  await banco.centro.listen({ host: "127.0.0.1", port: 0 });
  const { port } = banco.centro.server.address() as AddressInfo;
  const controllo = new AbortController();
  t.after(() => controllo.abort());
  const risposta = await fetch(`http://127.0.0.1:${port}/api/home/eventi`, { headers: { authorization: `Bearer ${token}` }, signal: controllo.signal });
  assert.equal(risposta.status, 200);
  assert.ok(risposta.body);
  const lettore = risposta.body.pipeThrough(new TextDecoderStream()).getReader();
  let ricevuto = "";
  const finche = async (atteso: string): Promise<void> => {
    while (!ricevuto.includes(atteso)) {
      const { value, done } = await lettore.read();
      if (done) throw new Error(`il flusso si è chiuso prima di "${atteso}"`);
      ricevuto += value;
    }
  };
  await finche("event: storia");
  banco.casa.invia("Ciao dall'app");
  await finche('"testo":"Ciao dall\'app"');
});
