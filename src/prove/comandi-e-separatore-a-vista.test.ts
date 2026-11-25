/**
 * Prova a vista, in un browser vero, di due cose della pagina di un progetto prese da Claude Desktop:
 * il pulsante ▶ di un blocco di comando, che apre il terminale del progetto e ve lo scrive con Invio,
 * e il separatore tra la chat e il pannello, che ne cambia la larghezza nei suoi limiti, la ricorda,
 * torna alla proporzione predefinita con il doppio clic e sotto i 1100 pixel non c'è.
 * Con SHINKA_PROVA_IMMAGINI, in quella cartella restano le immagini.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { test } from "node:test";
import { chromium, type Page } from "playwright-core";
import { allestisci, finche, PASSWORD } from "./banco.ts";
import { browserDiProva } from "./browser-di-prova.ts";

const cartellaWeb = join(import.meta.dirname, "..", "..", "web", "dist");
const disponibile = browserDiProva();
const salta =
  disponibile === undefined
    ? "su questa macchina non c'è un browser per la prova"
    : !existsSync(join(cartellaWeb, "index.html"))
      ? "l'interfaccia non è costruita"
      : false;

const larghezza = (pagina: Page, selettore: string): Promise<number> => pagina.locator(selettore).first().evaluate((elemento) => elemento.getBoundingClientRect().width);

test("il ▶ di un comando lo lancia nel terminale del progetto, e il pannello si allarga trascinando il separatore", { skip: salta, timeout: 120_000 }, async (t) => {
  const banco = await allestisci(t, { cartellaWeb });
  const progetto = await banco.lavori.crea("Blog", "centro", "Un blog.");
  await finche(() => banco.conversazioniLocali.length === 1, "la conversazione del progetto parte");
  const conversazione = banco.conversazioniLocali[0]!;
  conversazione.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 1 });
  conversazione.emetti({ tipo: "testo-concluso", idTesto: "t1", testo: "Per provarlo:\n\n```bash\nnpm test\n```\n\nE in Python:\n\n```python\nprint(1)\n```" });
  await banco.centro.listen({ host: "127.0.0.1", port: 0 });
  const indirizzo = `http://127.0.0.1:${(banco.centro.server.address() as AddressInfo).port}`;
  const browser = await chromium.launch({
    chromiumSandbox: disponibile?.recinto !== false,
    ...(disponibile?.canale === undefined ? {} : { channel: disponibile.canale }),
    ...(disponibile?.eseguibile === undefined ? {} : { executablePath: disponibile.eseguibile }),
  });
  t.after(() => browser.close());
  const pagina = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const cartellaImmagini = process.env.SHINKA_PROVA_IMMAGINI;
  if (cartellaImmagini !== undefined) await mkdir(cartellaImmagini, { recursive: true });
  await pagina.goto(`${indirizzo}/`);
  await pagina.fill("#password", PASSWORD);
  await pagina.click('button[type="submit"]');
  await pagina.locator("form.scrittura textarea").waitFor();

  // Nella Home un comando non ha il ▶.
  banco.home.emetti({ tipo: "testo-concluso", idTesto: "h1", testo: "```bash\nls\n```" });
  await pagina.locator(".blocco-codice").first().waitFor();
  assert.equal(await pagina.locator(".testa-codice button.esegui").count(), 0);

  // Nel progetto: il ▶ c'è solo sul blocco di shell, accanto a Copia.
  await pagina.goto(`${indirizzo}/#/progetti/${progetto.id}`);
  const bash = pagina.locator(".blocco-codice", { hasText: "npm test" });
  await bash.waitFor();
  assert.equal(await bash.locator("button.esegui").count(), 1);
  assert.equal(await pagina.locator(".blocco-codice", { hasText: "print(1)" }).locator("button.esegui").count(), 0);
  if (cartellaImmagini !== undefined) await pagina.screenshot({ path: join(cartellaImmagini, "comando-esegui.png") });

  // Il clic apre il pannello sul terminale e vi scrive il comando, con Invio.
  await bash.getByRole("button", { name: "Esegui nel terminale del progetto" }).click();
  await pagina.locator(".affianco").waitFor();
  assert.equal(await pagina.getByRole("tab", { name: "Terminale" }).getAttribute("aria-selected"), "true");
  await finche(() => banco.shellLocali.some((shell) => shell.scritti.join("").includes("npm test\r")), "il comando arriva alla shell del progetto, con Invio");
  await bash.getByRole("button", { name: "Lanciato nel terminale" }).waitFor();
  if (cartellaImmagini !== undefined) await pagina.screenshot({ path: join(cartellaImmagini, "comando-lanciato.png") });

  // Il separatore: trascinato verso sinistra, il pannello si allarga.
  const separatore = pagina.locator(".separatore-pannello");
  assert.equal(await separatore.getAttribute("role"), "separator");
  assert.equal(await separatore.getAttribute("data-parte"), "separatore-pannello");
  const prima = await larghezza(pagina, ".affianco");
  const riquadro = (await separatore.boundingBox())!;
  await pagina.mouse.move(riquadro.x + riquadro.width / 2, riquadro.y + 200);
  await pagina.mouse.down();
  await pagina.mouse.move(riquadro.x + riquadro.width / 2 - 60, riquadro.y + 200, { steps: 5 });
  await pagina.mouse.up();
  const dopo = await larghezza(pagina, ".affianco");
  assert.ok(Math.abs(dopo - (prima + 60)) <= 3, `il pannello passa da ${prima} a circa ${prima + 60}: ${dopo}`);
  assert.equal(await pagina.evaluate(() => window.localStorage.getItem("shinka.larghezzaPannello")), String(Math.round(dopo)));

  // Trascinato tutto a sinistra, la chat resta di almeno 340 pixel; tutto a destra, il pannello di almeno 280.
  await pagina.mouse.move(riquadro.x + riquadro.width / 2 - 60, riquadro.y + 200);
  await pagina.mouse.down();
  await pagina.mouse.move(5, riquadro.y + 200, { steps: 5 });
  await pagina.mouse.up();
  assert.ok((await larghezza(pagina, ".affiancati > .app.chat")) >= 339);
  const ora = (await separatore.boundingBox())!;
  await pagina.mouse.move(ora.x + ora.width / 2, ora.y + 200);
  await pagina.mouse.down();
  await pagina.mouse.move(1395, ora.y + 200, { steps: 5 });
  await pagina.mouse.up();
  assert.ok(Math.abs((await larghezza(pagina, ".affianco")) - 280) <= 2);

  // Da tastiera: la freccia a sinistra lo allarga.
  await separatore.focus();
  await pagina.keyboard.press("ArrowLeft");
  assert.ok(Math.abs((await larghezza(pagina, ".affianco")) - 304) <= 2);
  assert.equal(await separatore.getAttribute("aria-valuenow"), "304");

  // Chiuso e riaperto, e dopo un ricaricamento, la larghezza resta.
  await pagina.getByRole("button", { name: "Chiudi il pannello e torna alla chat" }).click();
  await pagina.locator(".pulsanti-pannello").getByRole("button", { name: "Terminale del progetto" }).click();
  await pagina.locator(".affianco").waitFor();
  assert.ok(Math.abs((await larghezza(pagina, ".affianco")) - 304) <= 2);
  await pagina.reload();
  await pagina.locator(".pulsanti-pannello").getByRole("button", { name: "Terminale del progetto" }).click();
  await pagina.locator(".separatore-pannello").waitFor();
  assert.ok(Math.abs((await larghezza(pagina, ".affianco")) - 304) <= 2);
  if (cartellaImmagini !== undefined) {
    await pagina.screenshot({ path: join(cartellaImmagini, "pannello-ridimensionato.png") });
    // Nel tema scuro, con il separatore illuminato al passaggio.
    await pagina.emulateMedia({ colorScheme: "dark" });
    await pagina.locator(".separatore-pannello").hover();
    await pagina.screenshot({ path: join(cartellaImmagini, "pannello-ridimensionato-scuro.png") });
    await pagina.emulateMedia({ colorScheme: "light" });
  }

  // Doppio clic: torna la proporzione predefinita, e non si ricorda più nulla.
  await pagina.locator(".separatore-pannello").dblclick();
  const totale = await larghezza(pagina, ".affiancati");
  assert.ok(Math.abs((await larghezza(pagina, ".affianco")) - (totale * 3) / 5) <= 4);
  assert.equal(await pagina.evaluate(() => window.localStorage.getItem("shinka.larghezzaPannello")), null);

  // Sotto i 1100 pixel il pannello copre la chat e il separatore non c'è.
  await pagina.setViewportSize({ width: 1000, height: 900 });
  assert.equal(await pagina.locator(".separatore-pannello").isVisible(), false);
});
