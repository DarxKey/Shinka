/**
 * Prova a vista dell'estetica e della lettura della chat: l'interfaccia costruita, in un browser
 * vero, con una conversazione di prova. Tema scelto a mano e ricordato; viste della trascrizione;
 * codice con linguaggio, colori e Copia; diagramma e formule disegnati; lista delle cose da fare;
 * pulsante per tornare all'ultimo messaggio; la Home che aspetta il proprietario, anche nella barra
 * laterale. Si salta dove manca il browser o l'interfaccia costruita.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { test } from "node:test";
import { chromium } from "playwright-core";
import { allestisci, PASSWORD } from "./banco.ts";
import { browserDiProva } from "./browser-di-prova.ts";
import { chatDiProva } from "./chat-di-prova.ts";

const cartellaWeb = join(import.meta.dirname, "..", "..", "web", "dist");
const disponibile = browserDiProva();
const salta =
  disponibile === undefined
    ? "su questa macchina non c'è un browser per la prova"
    : !existsSync(join(cartellaWeb, "index.html"))
      ? "l'interfaccia non è costruita"
      : false;

test("la chat si legge come in Claude: codice, formule, diagrammi, viste, tema e attesa", { skip: salta, timeout: 120_000 }, async (t) => {
  const banco = await allestisci(t, { cartellaWeb });
  chatDiProva(banco);
  await banco.centro.listen({ host: "127.0.0.1", port: 0 });
  const indirizzo = `http://127.0.0.1:${(banco.centro.server.address() as AddressInfo).port}`;
  const browser = await chromium.launch({
    chromiumSandbox: disponibile?.recinto !== false,
    ...(disponibile?.canale === undefined ? {} : { channel: disponibile.canale }),
    ...(disponibile?.eseguibile === undefined ? {} : { executablePath: disponibile.eseguibile }),
  });
  t.after(() => browser.close());
  const pagina = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: "light" });
  await pagina.goto(`${indirizzo}/`);
  await pagina.fill("#password", PASSWORD);
  await pagina.click('button[type="submit"]');
  await pagina.locator("form.scrittura textarea").waitFor();

  // Il codice: linguaggio, colori della sintassi, Copia.
  const blocco = pagina.locator(".blocco-codice").first();
  await blocco.locator(".hljs-keyword").first().waitFor();
  assert.equal(await blocco.locator(".linguaggio").textContent(), "ts");
  assert.equal(await blocco.getByRole("button", { name: "Copia il codice" }).count(), 1);
  // Il diagramma e le formule sono disegnati; sotto la risposta c'è Copia.
  await pagina.locator(".blocco-codice.diagramma .disegno svg").waitFor();
  await pagina.locator(".riga.claude .katex").first().waitFor();
  assert.equal(await pagina.getByRole("button", { name: "Copia la risposta" }).count(), 1);
  // Le cose da fare in una scheda, e nessuna azione per la lista.
  assert.equal(await pagina.locator(".riga.cose-da-fare li").count(), 3);
  assert.equal(await pagina.locator(".riga.cose-da-fare .conto-cose").textContent(), "1 di 3");
  // Mentre Claude lavora, la lista resta in vista sopra il campo di scrittura, con ciò che sta facendo.
  assert.equal(await pagina.locator(".cose-in-vista .conto-cose").textContent(), "1 di 3");
  assert.equal(await pagina.locator(".cose-in-vista .ora-cose").textContent(), "Correggo le date");
  // Le fonti in fondo alla risposta stanno chiuse sotto un pulsante.
  const fonti = pagina.locator(".fonti-risposta");
  assert.equal(await fonti.locator("summary").textContent(), "Fonti (2)");
  assert.equal(await fonti.getByRole("link", { name: "GNU coreutils: wc" }).isVisible(), false);
  await fonti.locator("summary").click();
  await fonti.getByRole("link", { name: "GNU coreutils: wc" }).waitFor();
  assert.doesNotMatch((await pagina.locator(".riga.claude").first().textContent()) ?? "", /^Fonti:/m);
  // La Home aspetta il proprietario: lo dice la chat, e la barra laterale.
  await pagina.locator(".laterale .voce.aspetta-te").getByText("aspetta te").waitFor();
  await pagina.getByText("Aspetta una tua risposta").first().waitFor();

  // Salendo a leggere compare il pulsante per tornare giù.
  await pagina.locator(".conversazione").evaluate((elemento) => elemento.scrollTo({ top: 0 }));
  const torna = pagina.locator("button.torna-giu");
  await torna.waitFor();
  assert.match((await torna.textContent()) ?? "", /Aspetta una tua risposta/);
  await torna.click();
  await torna.waitFor({ state: "detached" });

  // La vista normale non mostra il ragionamento; quella con il ragionamento sì; la dettagliata apre le azioni.
  assert.equal(await pagina.locator(".riga.ragionamento").count(), 0);
  await pagina.locator(".laterale .aspetto summary").click();
  await pagina.getByLabel("Con il ragionamento").check({ force: true });
  await pagina.locator(".riga.ragionamento").waitFor();
  assert.equal(await pagina.locator(".riga.gruppo > details[open]").count(), 0);
  await pagina.getByLabel("Dettagliata").check({ force: true });
  await pagina.locator(".riga.gruppo > details[open]").first().waitFor();

  // Il tema scelto a mano vale subito e resta dopo il ricaricamento.
  await pagina.getByLabel("Scuro").check({ force: true });
  assert.equal(await pagina.evaluate(() => document.documentElement.dataset.tema), "scuro");
  const sfondo = await pagina.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.equal(sfondo, "rgb(24, 24, 26)");
  await pagina.reload();
  await pagina.locator("form.scrittura textarea").waitFor();
  assert.equal(await pagina.evaluate(() => document.documentElement.dataset.tema), "scuro");
  await pagina.locator(".riga.gruppo > details[open]").first().waitFor();
  await pagina.locator(".laterale .aspetto summary").click();
  await pagina.getByLabel("Automatico").check({ force: true });
  assert.equal(await pagina.evaluate(() => document.documentElement.dataset.tema), undefined);
});
