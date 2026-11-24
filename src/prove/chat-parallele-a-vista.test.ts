/**
 * Prova a vista delle chat parallele (ADR 0052), in un browser vero: nella Home e in un progetto il
 * pulsante ＋ apre una chat in una scheda, il messaggio va a quella chat e non alla principale, e la ×
 * la chiude. Si salta dove manca il browser o l'interfaccia costruita.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { test } from "node:test";
import { chromium } from "playwright-core";
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

test("nella Home e in un progetto una chat parallela si apre in una scheda, riceve i suoi messaggi e si chiude", { skip: salta, timeout: 120_000 }, async (t) => {
  const banco = await allestisci(t, { cartellaWeb });
  await banco.centro.listen({ host: "127.0.0.1", port: 0 });
  const progetto = await banco.lavori.crea("Videogioco", "centro", "Un gioco.");
  await finche(() => banco.conversazioniLocali.length === 1, "il progetto apre la sua conversazione");
  banco.conversazioniLocali[0]?.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 1 });
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

  // Nella Home: senza chat parallele non ci sono schede; il ＋ ne apre una e la mostra.
  assert.equal(await pagina.locator(".schede-chat").count(), 0);
  await pagina.getByRole("button", { name: "Nuova chat parallela" }).click();
  const schede = pagina.getByRole("navigation", { name: "Chat" });
  await schede.waitFor();
  await schede.locator('.scheda-chat[aria-current="true"]', { hasText: "Chat 2" }).waitFor();
  await pagina.locator(".sottotitolo", { hasText: "Chat 2" }).waitFor();
  await pagina.locator("form.scrittura textarea").fill("Che ore sono?");
  await pagina.locator("form.scrittura textarea").press("Enter");
  const chatHome = banco.conversazioniHome.at(-1);
  await finche(() => chatHome?.inviati.includes("Che ore sono?") === true, "il messaggio arriva alla chat parallela");
  assert.deepEqual(banco.conversazioniHome[0]?.inviati, []);
  await pagina.locator(".fumetto", { hasText: "Che ore sono?" }).waitFor();
  chatHome?.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 1 });

  // Tornando alla principale il messaggio non c'è; la × chiude la chat e la sua scheda.
  await schede.getByRole("button", { name: "Principale" }).click();
  await pagina.locator(".sottotitolo", { hasText: "Chat 2" }).waitFor({ state: "detached" });
  assert.equal(await pagina.locator(".fumetto", { hasText: "Che ore sono?" }).count(), 0);
  await schede.getByRole("button", { name: "Chiudi la chat 2" }).click();
  await finche(() => chatHome?.istruzioni.some((istruzione) => /chiude questa chat/.test(istruzione)) === true, "Claude scrive titolo e riassunto");
  banco.casa.chat(2)?.richiediCambio({ titolo: "L'ora", riassunto: "Il proprietario ha chiesto l'ora." });
  chatHome?.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 1 });
  await pagina.locator(".schede-chat").waitFor({ state: "detached" });
  assert.deepEqual(banco.casa.archiviati().map((voce) => voce.titolo), ["L'ora"]);

  // In un progetto: la chat lavora nella stessa cartella, e chiuderla chiede conferma.
  await pagina.goto(`${indirizzo}/#/progetti/${progetto.id}`);
  await pagina.locator("h1", { hasText: "Videogioco" }).waitFor();
  await pagina.getByRole("button", { name: "Nuova chat parallela" }).click();
  await schede.locator('.scheda-chat[aria-current="true"]', { hasText: "Chat 2" }).waitFor();
  await pagina.locator("form.scrittura textarea").fill("Leggi il README.");
  await pagina.locator("form.scrittura textarea").press("Enter");
  await finche(() => banco.conversazioniLocali.length === 2 && banco.conversazioniLocali[1]?.inviati.includes("Leggi il README.") === true, "il messaggio arriva alla chat del progetto");
  assert.equal(banco.conversazioniLocali[1]?.configurazione?.cartella, progetto.cartella);
  assert.equal(banco.conversazioniLocali[0]?.inviati.includes("Leggi il README."), false);
  banco.conversazioniLocali[1]?.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 1 });
  await schede.getByRole("button", { name: "Chiudi la chat 2" }).click();
  await schede.getByText("La sua storia si cancella.").waitFor();
  await schede.getByRole("button", { name: "Chiudi", exact: true }).click();
  await pagina.locator(".schede-chat").waitFor({ state: "detached" });
  assert.equal(banco.progetti.chatParallele(progetto.id).length, 0);
  assert.equal(banco.conversazioniLocali[1]?.chiusa, true);

  // Sul telefono le schede stanno sotto la testata senza farla traboccare.
  await pagina.setViewportSize({ width: 390, height: 800 });
  await pagina.getByRole("button", { name: "Nuova chat parallela" }).click();
  await schede.waitFor();
  const larghezza = await pagina.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(larghezza <= 390, `la pagina è larga ${larghezza}px`);
});
