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
