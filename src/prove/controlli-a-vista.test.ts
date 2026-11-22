/**
 * Prova a vista dei controlli sotto il campo: sul telefono una riga sola, con il riassunto delle
 * scelte che le apre e i limiti in piccolo; sul computer tutto in vista, come prima. Si salta dove
 * manca il browser o l'interfaccia costruita. Con SHINKA_PROVA_IMMAGINI restano le immagini.
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

test("sul telefono scelte e limiti stanno in una riga che si apre; sul computer restano in vista", { skip: salta, timeout: 60_000 }, async (t) => {
  const banco = await allestisci(t, { cartellaWeb });
  await banco.centro.listen({ host: "127.0.0.1", port: 0 });
  const porta = (banco.centro.server.address() as AddressInfo).port;
  const browser = await chromium.launch({
    chromiumSandbox: disponibile?.recinto !== false,
    ...(disponibile?.canale === undefined ? {} : { channel: disponibile.canale }),
    ...(disponibile?.eseguibile === undefined ? {} : { executablePath: disponibile.eseguibile }),
  });
  t.after(() => browser.close());
  const pagina = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const cartellaImmagini = process.env.SHINKA_PROVA_IMMAGINI;
  if (cartellaImmagini !== undefined) await mkdir(cartellaImmagini, { recursive: true });
  const fotografa = async (nome: string) => {
    if (cartellaImmagini === undefined) return;
    await pagina.waitForTimeout(300);
    await pagina.screenshot({ path: join(cartellaImmagini, `controlli-${nome}.png`) });
  };

  await pagina.goto(`http://127.0.0.1:${porta}/`);
  await pagina.fill("#password", PASSWORD);
  await pagina.click('button[type="submit"]');
  await pagina.locator("form.scrittura textarea").waitFor();
  banco.home.emetti({
    tipo: "stato",
    stato: {
      contesto: { usati: 68_000, massimo: 200_000, percento: 34 },
      limiti: { cinqueOre: { percento: 12 }, setteGiorni: { percento: 76 } },
      modelli: [
        { valore: "haiku", nome: "Haiku", descrizione: "" },
        { valore: "opus", nome: "Opus", descrizione: "" },
      ],
    },
  });

  // Sul telefono: il riassunto e i limiti in piccolo, le scelte chiuse.
  const riassunto = pagina.locator("button.apri-scelte");
  await pagina.locator(".misure.compatte .misura").first().waitFor();
  assert.equal(await riassunto.isVisible(), true);
  // In breve, e per intero per chi ascolta la pagina.
  assert.match((await riassunto.textContent()) ?? "", /^Haiku · Chiedi/);
  assert.match((await riassunto.getAttribute("aria-label")) ?? "", /Haiku · Effort predefinito · Chiedi sempre/);
  const tagliato = await riassunto.locator(".testo-riassunto").evaluate((elemento) => elemento.scrollWidth > elemento.clientWidth);
  assert.equal(tagliato, false, "il riassunto si legge tutto");
  assert.equal(await pagina.getByLabel("Modello", { exact: true }).isVisible(), false);
  assert.deepEqual(await pagina.locator(".misure.compatte .nome").allTextContents(), ["Ctx", "5h", "7g"]);
  assert.match((await pagina.locator(".misure.compatte").textContent()) ?? "", /34%.*12%.*76%/);
  const altezzaChiusa = await pagina.locator(".controlli").evaluate((elemento) => elemento.getBoundingClientRect().height);
  assert.ok(altezzaChiusa <= 32, `una riga sola: ${altezzaChiusa}px`);
  await fotografa("telefono-chiuse");

  // Aperte: le scelte e i limiti per intero; si cambiano come prima.
  await riassunto.click();
  await pagina.getByLabel("Modello", { exact: true }).waitFor();
  assert.equal(await pagina.locator(".misure.compatte").isVisible(), false);
  assert.equal(await pagina.locator(".scelte .misure").isVisible(), true);
  await fotografa("telefono-aperte");
  await pagina.getByLabel("Modello", { exact: true }).selectOption("opus");
  await pagina.waitForTimeout(200);
  assert.equal(banco.statoHome.impostazioni.modello, "opus");
  await riassunto.click();
  assert.equal(await pagina.getByLabel("Modello", { exact: true }).isVisible(), false);

  // Sul computer: tutto in vista, il riassunto no.
  await pagina.setViewportSize({ width: 1200, height: 800 });
  assert.equal(await riassunto.isVisible(), false);
  assert.equal(await pagina.getByLabel("Modello", { exact: true }).isVisible(), true);
  await fotografa("computer");
});
