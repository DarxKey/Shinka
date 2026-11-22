/**
 * Prova a vista della barra laterale e del pulsante Copia, in un browser vero: il campo Cerca in
 * cima apre la pagina Cerca con le parole scritte; le pagine stanno nel menu dell'icona in fondo,
 * che si apre verso l'alto e si richiude; Copia è un'icona, che diventa una spunta. Sul telefono,
 * con la barra aperta, i progetti hanno lo spazio che prima prendevano le pagine.
 * Si salta dove manca il browser o l'interfaccia costruita.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
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
/** Se c'è, le fotografie della prova vanno qui, per guardarle a occhio. */
const FOTO = process.env.SHINKA_PROVA_IMMAGINI;

test("barra laterale: Cerca in cima, le pagine nel menu dell'icona, Copia con l'icona", { skip: salta, timeout: 120_000 }, async (t) => {
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
  const contesto = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "light" });
  await contesto.grantPermissions(["clipboard-read", "clipboard-write"]);
  const pagina = await contesto.newPage();
  await pagina.goto(`${indirizzo}/`);
  await pagina.fill("#password", PASSWORD);
  await pagina.click('button[type="submit"]');
  await pagina.locator("form.scrittura textarea").waitFor();
  const barra = pagina.locator("nav.laterale");

  // Nella barra non ci sono più le pagine, né il collegamento Cerca.
  for (const nome of ["Programmati", "Memoria", "Vault", "Impostazioni"]) {
    assert.equal(await barra.getByRole("link", { name: nome, exact: true }).count(), 0, nome);
  }

  // Copia: un'icona, senza testo; dopo il tocco una spunta, e il testo è negli appunti.
  const copia = pagina.getByRole("button", { name: "Copia la risposta" });
  assert.equal((await copia.textContent())?.trim(), "");
  assert.equal(await copia.locator("svg").count(), 1);
  await copia.click();
  await pagina.getByRole("button", { name: "Copiato" }).waitFor();
  assert.ok((await pagina.evaluate(() => navigator.clipboard.readText())).length > 0);
  if (FOTO !== undefined) {
    mkdirSync(FOTO, { recursive: true });
    await pagina.locator(".azioni-risposta").first().screenshot({ path: join(FOTO, "copia-icona.png") });
  }

  // Il menu delle pagine: si apre dall'icona, verso l'alto, e un tocco fuori lo richiude.
  const icona = barra.getByLabel("Pagine");
  await icona.click();
  const voci = barra.locator(".voci-pagine");
  await voci.getByRole("link", { name: "Memoria" }).waitFor();
  assert.deepEqual(
    await voci.locator(".voce .nome").allTextContents(),
    ["Programmati", "Uso", "Archiviazione", "Elaborati", "Memoria", "Skill", "Estensioni", "Vault", "Impostazioni"],
  );
  const menuSopra = await voci.boundingBox();
  const iconaDove = await icona.boundingBox();
  assert.ok(menuSopra !== null && iconaDove !== null && menuSopra.y + menuSopra.height <= iconaDove.y + 1, "il menu si apre sopra l'icona");
  if (FOTO !== undefined) await pagina.screenshot({ path: join(FOTO, "menu-pagine-largo.png") });
  await pagina.locator("form.scrittura textarea").click();
  await voci.waitFor({ state: "hidden" });

  // Una pagina scelta dal menu si apre, e il menu si richiude.
  await icona.click();
  await voci.getByRole("link", { name: "Impostazioni" }).click();
  await pagina.waitForURL(/#\/impostazioni$/);
  await voci.waitFor({ state: "hidden" });

  // Cerca: si scrive in cima alla barra, Invio apre la pagina Cerca con le parole, e il campo si svuota.
  const campo = barra.getByRole("searchbox", { name: "Cerca nelle conversazioni" });
  await campo.fill("backup del NAS");
  await campo.press("Enter");
  await pagina.waitForURL(/#\/cerca\/backup%20del%20NAS$/);
  assert.equal(await pagina.getByRole("searchbox", { name: "Parole da cercare in tutte le conversazioni" }).inputValue(), "backup del NAS");
  assert.equal(await campo.inputValue(), "");

  // Sul telefono, con la barra aperta: il campo in cima, l'icona in fondo, nessuna pagina in mezzo.
  const telefono = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: "light" });
  await telefono.context().addCookies(await contesto.cookies());
  await telefono.goto(`${indirizzo}/`);
  await telefono.locator("form.scrittura textarea").waitFor();
  await telefono.locator(".pulsante-menu").click();
  const barraTelefono = telefono.locator("nav.laterale.aperta");
  await barraTelefono.getByRole("searchbox", { name: "Cerca nelle conversazioni" }).waitFor();
  await barraTelefono.getByLabel("Pagine").waitFor();
  assert.equal(await barraTelefono.getByRole("link", { name: "Memoria", exact: true }).count(), 0);
  if (FOTO !== undefined) {
    await telefono.waitForTimeout(400);
    await telefono.screenshot({ path: join(FOTO, "barra-telefono.png") });
    await barraTelefono.getByLabel("Pagine").click();
    await barraTelefono.locator(".voci-pagine").waitFor();
    await telefono.screenshot({ path: join(FOTO, "menu-pagine-telefono.png") });
  }
});
