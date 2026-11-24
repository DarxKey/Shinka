/**
 * Prova a vista della testata della Home, in un browser vero: Esporta e Nuovo argomento sono icone,
 * con il loro nome per chi ascolta la pagina, e sul telefono la testata sta nella sua larghezza.
 * Nuovo argomento funziona come prima. Si salta dove manca il browser o l'interfaccia costruita.
 * Con SHINKA_PROVA_IMMAGINI, in quella cartella restano le immagini.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { test } from "node:test";
import { chromium } from "playwright-core";
import { allestisci, PASSWORD } from "./banco.ts";
import { browserDiProva } from "./browser-di-prova.ts";

const cartellaWeb = join(import.meta.dirname, "..", "..", "web", "dist");
const disponibile = browserDiProva();
const salta =
  disponibile === undefined
    ? "su questa macchina non c'è un browser per la prova"
    : !existsSync(join(cartellaWeb, "index.html"))
      ? "l'interfaccia non è costruita"
      : false;

test("nella testata della Home Esporta e Nuovo argomento sono icone, e sul telefono tutto ci sta", { skip: salta, timeout: 90_000 }, async (t) => {
  const banco = await allestisci(t, { cartellaWeb });
  await banco.centro.listen({ host: "127.0.0.1", port: 0 });
  const indirizzo = `http://127.0.0.1:${(banco.centro.server.address() as AddressInfo).port}`;
  const browser = await chromium.launch({
    chromiumSandbox: disponibile?.recinto !== false,
    ...(disponibile?.canale === undefined ? {} : { channel: disponibile.canale }),
    ...(disponibile?.eseguibile === undefined ? {} : { executablePath: disponibile.eseguibile }),
  });
  t.after(() => browser.close());
  const pagina = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const cartellaImmagini = process.env.SHINKA_PROVA_IMMAGINI;
  if (cartellaImmagini !== undefined) await mkdir(cartellaImmagini, { recursive: true });
  await pagina.goto(`${indirizzo}/`);
  await pagina.fill("#password", PASSWORD);
  await pagina.click('button[type="submit"]');
  await pagina.locator("form.scrittura textarea").waitFor();

  for (const [larghezza, nome] of [
    [390, "telefono"],
    [1200, "computer"],
  ] as const) {
    await pagina.setViewportSize({ width: larghezza, height: 844 });
    const testata = pagina.locator(".testata").first();
    const esporta = testata.getByLabel("Esporta la conversazione");
    const nuovo = testata.getByRole("button", { name: "Nuovo argomento" });
    assert.equal(await esporta.isVisible(), true, `Esporta si vede sul ${nome}`);
    assert.equal(await nuovo.isVisible(), true, `Nuovo argomento si vede sul ${nome}`);
    // Icone: senza parole, con il nome e il suggerimento.
    assert.equal(((await esporta.textContent()) ?? "").trim(), "");
    assert.equal(((await nuovo.textContent()) ?? "").trim(), "");
    assert.match((await nuovo.getAttribute("title")) ?? "", /Nuovo argomento: archivia questo argomento/);
    const larghezze = await testata.evaluate((elemento) => ({ dentro: elemento.scrollWidth, fuori: elemento.clientWidth }));
    assert.ok(larghezze.dentro <= larghezze.fuori, `la testata sta nella sua larghezza sul ${nome}: ${larghezze.dentro} su ${larghezze.fuori}`);
    if (cartellaImmagini !== undefined) await pagina.screenshot({ path: join(cartellaImmagini, `testata-home-${nome}.png`) });
  }

  // Il menu Esporta si apre come prima.
  await pagina.locator(".menu-esporta summary").click();
  await pagina.getByRole("link", { name: "Scarica in Markdown" }).waitFor();
  await pagina.locator(".menu-esporta summary").click();
  // Nuovo argomento fa ciò che faceva.
  let archiviato = false;
  await pagina.route("**/api/home/argomento-nuovo", async (rotta) => {
    archiviato = true;
    await rotta.fulfill({ json: {} });
  });
  await pagina.locator(".testata").first().getByRole("button", { name: "Nuovo argomento" }).click();
  for (let volte = 0; volte < 100 && !archiviato; volte++) await pagina.waitForTimeout(50);
  assert.equal(archiviato, true);
});
