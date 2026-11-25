/**
 * Prova a vista della pagina degli ambienti, in un browser vero: si apre dal menu delle pagine, e un
 * ambiente si reinstalla con un comando già compilato con i suoi dati e con l'indirizzo che il suo
 * nodo usa per raggiungere il centro. Si salta dove manca il browser o l'interfaccia costruita.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { test } from "node:test";
import { chromium } from "playwright-core";
import { allestisci, avviaNodoAccettato, finche, ID_NODO, PASSWORD } from "./banco.ts";
import { Ponte } from "../nodo/ponte.ts";
import { browserDiProva } from "./browser-di-prova.ts";

const cartellaWeb = join(import.meta.dirname, "..", "..", "web", "dist");
const disponibile = browserDiProva();
const salta =
  disponibile === undefined
    ? "su questa macchina non c'è un browser per la prova"
    : !existsSync(join(cartellaWeb, "index.html"))
      ? "l'interfaccia non è costruita"
      : false;

test("gli ambienti si aprono dal menu delle pagine, e un nodo si reinstalla con i suoi dati", { skip: salta, timeout: 120_000 }, async (t) => {
  const banco = await allestisci(t, { cartellaWeb });
  await banco.centro.listen({ host: "127.0.0.1", port: 0 });
  await avviaNodoAccettato(t, banco);
  await finche(() => banco.ambienti.stato().ambienti.find((uno) => uno.id === ID_NODO)?.indirizzoDelCentro !== undefined, "il nodo dice il suo indirizzo");
  const indirizzoDelNodo = banco.ambienti.stato().ambienti.find((uno) => uno.id === ID_NODO)?.indirizzoDelCentro ?? "";
  const indirizzo = `http://localhost:${(banco.centro.server.address() as AddressInfo).port}`;
  const browser = await chromium.launch({
    chromiumSandbox: disponibile?.recinto !== false,
    ...(disponibile?.canale === undefined ? {} : { channel: disponibile.canale }),
    ...(disponibile?.eseguibile === undefined ? {} : { executablePath: disponibile.eseguibile }),
  });
  t.after(() => browser.close());
  const pagina = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await pagina.goto(`${indirizzo}/`);
  await pagina.fill("#password", PASSWORD);
  await pagina.click('button[type="submit"]');
  await pagina.locator("form.scrittura textarea").waitFor();

  // Il pulsante nella barra non c'è più: gli ambienti stanno nel menu delle pagine.
  assert.equal(await pagina.locator(".pulsante-ambienti").count(), 0);
  await pagina.locator(".menu-pagine > summary").click();
  await pagina.locator(".voci-pagine").getByRole("button", { name: /Ambienti/ }).click();
  const pannello = pagina.getByRole("region", { name: "Ambienti" });
  const nodo = pannello.locator("li.ambiente", { hasText: "PC Windows" });
  await nodo.waitFor();

  // La proposta per un ambiente nuovo usa l'indirizzo che i nodi usano, non quello della pagina.
  await pannello.getByRole("button", { name: "Aggiungi un ambiente" }).click();
  assert.equal(await pannello.getByLabel("Indirizzo di Shinka visto da quella macchina").inputValue(), indirizzoDelNodo);
  await pannello.getByRole("button", { name: "Annulla" }).click();

  await nodo.getByRole("button", { name: "Reinstalla" }).click();
  await nodo.getByRole("heading", { name: "Reinstalla «PC Windows»" }).waitFor();
  assert.equal(await nodo.getByLabel("Nome").inputValue(), "PC Windows");
  assert.equal(await nodo.getByLabel("Indirizzo di Shinka visto da quella macchina").inputValue(), indirizzoDelNodo);
  // Il banco non prepara i pacchetti dei nodi: qui conta che la richiesta parta con i dati del nodo.
  let chiesto: Record<string, unknown> | undefined;
  await pagina.route("**/api/ambienti/inviti", async (rotta) => {
    chiesto = rotta.request().postDataJSON() as Record<string, unknown>;
    await rotta.fulfill({ json: { comando: "irm http://esempio | iex", sistema: "linux", scade: new Date(Date.now() + 3_600_000).toISOString() } });
  });
  await nodo.getByRole("button", { name: "Prepara il comando" }).click();
  await nodo.locator(".comando-ambiente code").waitFor();
  const ambiente = banco.ambienti.stato().ambienti.find((uno) => uno.id === ID_NODO);
  assert.deepEqual(chiesto, { sistema: /windows/i.test(ambiente?.sistema ?? "") ? "windows" : "linux", centro: indirizzoDelNodo, nome: "PC Windows", descrizione: ambiente?.descrizione });
});

test("la cartella dei progetti nuovi di un nodo si cambia dalla pagina degli ambienti", { skip: salta, timeout: 120_000 }, async (t) => {
  const banco = await allestisci(t, { cartellaWeb });
  await banco.centro.listen({ host: "127.0.0.1", port: 0 });
  await avviaNodoAccettato(t, banco);
  const indirizzo = `http://localhost:${(banco.centro.server.address() as AddressInfo).port}`;
  const browser = await chromium.launch({
    chromiumSandbox: disponibile?.recinto !== false,
    ...(disponibile?.canale === undefined ? {} : { channel: disponibile.canale }),
    ...(disponibile?.eseguibile === undefined ? {} : { executablePath: disponibile.eseguibile }),
  });
  t.after(() => browser.close());
  const pagina = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await pagina.goto(`${indirizzo}/`);
  await pagina.fill("#password", PASSWORD);
  await pagina.click('button[type="submit"]');
  await pagina.locator("form.scrittura textarea").waitFor();
  await pagina.locator(".menu-pagine > summary").click();
  await pagina.locator(".voci-pagine").getByRole("button", { name: /Ambienti/ }).click();
  const pannello = pagina.getByRole("region", { name: "Ambienti" });
  const nodo = pannello.locator("li.ambiente", { hasText: "PC Windows" });
  await nodo.waitFor();
  // Quella del centro si vede ma non si cambia da qui.
  const centro = pannello.locator("li.ambiente", { hasText: "qui gira il centro" });
  assert.equal(await centro.locator(".cartella-progetti-ambiente").getByRole("button", { name: "Cambia" }).count(), 0);

  const prima = banco.ambienti.stato().ambienti.find((uno) => uno.id === ID_NODO)?.radiceProgetti ?? "";
  assert.match((await nodo.locator(".cartella-progetti-ambiente").textContent()) ?? "", new RegExp(prima.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  await nodo.getByRole("button", { name: "Cambia" }).click();
  const campo = nodo.getByLabel("Cartella dei progetti nuovi");
  assert.equal(await campo.inputValue(), prima);
  // Un percorso che non va lo dice, e il campo resta.
  await campo.fill("progetti");
  await nodo.getByRole("button", { name: "Salva" }).click();
  await nodo.getByRole("alert").filter({ hasText: "percorso completo" }).waitFor();
  const nuova = join(banco.cartella, "Progetti scelti");
  await campo.fill(nuova);
  await nodo.getByRole("button", { name: "Salva" }).click();
  await nodo.getByRole("status").filter({ hasText: `I progetti nuovi nasceranno in ${nuova} dal prossimo avvio del nodo.` }).waitFor();
  assert.ok(existsSync(nuova));
});

test("nella pagina dell'ambiente i processi di Shinka stanno con il loro progetto, e uno si termina", { skip: salta, timeout: 120_000 }, async (t) => {
  const banco = await allestisci(t, { cartellaWeb });
  const progetto = await banco.lavori.crea("Blog", "centro", "Un blog.");
  await banco.centro.listen({ host: "127.0.0.1", port: 0 });
  const indirizzo = `http://127.0.0.1:${(banco.centro.server.address() as AddressInfo).port}`;
  const browser = await chromium.launch({
    chromiumSandbox: disponibile?.recinto !== false,
    ...(disponibile?.canale === undefined ? {} : { channel: disponibile.canale }),
    ...(disponibile?.eseguibile === undefined ? {} : { executablePath: disponibile.eseguibile }),
  });
  t.after(() => browser.close());
  const pagina = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await pagina.goto(`${indirizzo}/`);
  await pagina.fill("#password", PASSWORD);
  await pagina.click('button[type="submit"]');
  await pagina.locator("form.scrittura textarea").waitFor();
  await pagina.goto(`${indirizzo}/#/ambienti/centro`);
  const sezione = pagina.locator(".processi-di-shinka");
  const blog = sezione.locator(".gruppo-processi", { has: pagina.getByRole("link", { name: "Blog" }) });
  await blog.waitFor();
  assert.deepEqual(await blog.locator(".riga-processo .nome").allTextContents(), ["claude · conversazione", "node"]);
  await sezione.locator(".gruppo-processi", { hasText: "Shinka" }).locator(".riga-processo", { hasText: "bash" }).waitFor();
  const server = blog.locator("li", { hasText: "node server.js" });
  await server.getByRole("button", { name: "Termina…" }).click();
  await server.getByRole("button", { name: "Termina", exact: true }).click();
  await blog.locator("li", { hasText: "node server.js" }).waitFor({ state: "detached" });
  void progetto;
});

test("nel pannello di un progetto i suoi processi, il modello locale che usa, e uno si termina", { skip: salta, timeout: 120_000 }, async (t) => {
  const banco = await allestisci(t, { cartellaWeb });
  const progetto = await banco.lavori.crea("Blog", "centro", "Un blog.");
  await banco.centro.listen({ host: "127.0.0.1", port: 0 });
  const indirizzo = `http://127.0.0.1:${(banco.centro.server.address() as AddressInfo).port}`;
  const browser = await chromium.launch({
    chromiumSandbox: disponibile?.recinto !== false,
    ...(disponibile?.canale === undefined ? {} : { channel: disponibile.canale }),
    ...(disponibile?.eseguibile === undefined ? {} : { executablePath: disponibile.eseguibile }),
  });
  t.after(() => browser.close());
  const pagina = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  await pagina.goto(`${indirizzo}/`);
  await pagina.fill("#password", PASSWORD);
  await pagina.click('button[type="submit"]');
  await pagina.locator("form.scrittura textarea").waitFor();
  await pagina.goto(`${indirizzo}/#/progetti/${progetto.id}`);
  await pagina.locator("form.scrittura textarea").waitFor();

  // Dalla scheda della sessione si apre la scheda Processi del pannello, accanto alla chat.
  await pagina.locator(".menu-sessione > summary").click();
  await pagina.getByRole("button", { name: "Processi, risorse e termina…" }).click();
  const pannello = pagina.locator(".pannello-processi");
  await pannello.locator(".riga-processo").first().waitFor();
  assert.equal(await pagina.getByRole("tab", { name: "Processi" }).getAttribute("aria-selected"), "true");
  assert.equal(await pagina.locator(".menu-sessione").getAttribute("open"), null, "la scheda della sessione si chiude");
  // I suoi, con chi li ha avviati; il server del modello locale tra quelli dell'ambiente, con chi lo usa.
  const suoi = pannello.locator(".gruppo-processi", { hasText: "Del progetto" });
  assert.deepEqual(await suoi.locator(".riga-processo .nome").allTextContents(), ["claude · conversazione", "node"]);
  const condivisi = pannello.locator(".gruppo-processi", { hasText: "Dell'ambiente, in uso dal progetto" });
  assert.deepEqual(await condivisi.locator(".riga-processo .nome").allTextContents(), ["llama-server · modello locale"]);
  assert.match((await condivisi.textContent()) ?? "", /In uso da Blog/);
  // Il processo della shell di Shinka non è del progetto e non compare.
  assert.equal(await pannello.locator(".riga-processo", { hasText: "bash" }).count(), 0);
  // Il totale tiene conto di tutto ciò che il progetto usa: 2,5 + 95 + 40.
  assert.match((await pannello.locator(".riassunto-processi").textContent()) ?? "", /138%/);
  await pannello.locator(".linea-processore").waitFor();
  // Con SHINKA_PROVA_IMMAGINI resta una foto del pannello, da guardare.
  const cartellaImmagini = process.env.SHINKA_PROVA_IMMAGINI;
  if (cartellaImmagini !== undefined) await pagina.screenshot({ path: join(cartellaImmagini, "processi-del-progetto.png") });

  const server = suoi.locator("li", { hasText: "node server.js" });
  await server.getByRole("button", { name: "Termina…" }).click();
  await server.getByRole("button", { name: "Termina", exact: true }).click();
  await suoi.locator("li", { hasText: "node server.js" }).waitFor({ state: "detached" });

  // Nella pagina dell'ambiente il server condiviso dice chi lo usa.
  await pagina.goto(`${indirizzo}/#/ambienti/centro`);
  const shinka = pagina.locator(".processi-di-shinka .gruppo-processi", { hasText: "llama-server" });
  await shinka.waitFor();
  assert.match((await shinka.textContent()) ?? "", /In uso da Blog/);
});

test("un ambiente fa da ponte per un'altra macchina: si accende dalla pagina, dice il suo indirizzo, si spegne", { skip: salta, timeout: 120_000 }, async (t) => {
  const banco = await allestisci(t, { cartellaWeb });
  await banco.centro.listen({ host: "127.0.0.1", port: 0 });
  const indirizzo = `http://localhost:${(banco.centro.server.address() as AddressInfo).port}`;
  const ponte = new Ponte({ centro: indirizzo.replace("localhost", "127.0.0.1"), ascolta: "127.0.0.1" });
  t.after(() => ponte.chiudi());
  await avviaNodoAccettato(t, banco, { ponte });
  const browser = await chromium.launch({
    chromiumSandbox: disponibile?.recinto !== false,
    ...(disponibile?.canale === undefined ? {} : { channel: disponibile.canale }),
    ...(disponibile?.eseguibile === undefined ? {} : { executablePath: disponibile.eseguibile }),
  });
  t.after(() => browser.close());
  const pagina = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await pagina.goto(`${indirizzo}/`);
  await pagina.fill("#password", PASSWORD);
  await pagina.click('button[type="submit"]');
  await pagina.locator("form.scrittura textarea").waitFor();
  await pagina.locator(".menu-pagine > summary").click();
  await pagina.locator(".voci-pagine").getByRole("button", { name: /Ambienti/ }).click();
  const nodo = pagina.getByRole("region", { name: "Ambienti" }).locator("li.ambiente", { hasText: "PC Windows" });
  await nodo.getByRole("button", { name: "Fai da ponte per un'altra macchina" }).click();
  await nodo.getByLabel("Porta").fill("47991");
  await nodo.getByRole("button", { name: "Accendi il ponte" }).click();
  await nodo.getByText("Ponte aperto sulla porta 47991.").waitFor();
  await nodo.getByText(/come indirizzo di Shinka/).locator("code", { hasText: ":47991" }).waitFor();
  assert.equal(ponte.porta, 47991);
  if (process.env.SHINKA_PROVA_IMMAGINI !== undefined) await nodo.screenshot({ path: join(process.env.SHINKA_PROVA_IMMAGINI, "ponte.png") });
  await nodo.getByRole("button", { name: "Spegni il ponte" }).click();
  await nodo.getByRole("button", { name: "Fai da ponte per un'altra macchina" }).waitFor();
  await finche(() => ponte.porta === undefined, "il nodo chiude il ponte");
});
