/**
 * Prova a vista della prima parte del gruppo B, in un browser vero davanti a un centro con
 * conversazioni finte: modificare un messaggio (con i file da riportare) e rigenerare la risposta,
 * il menu "/" dei comandi, la ricerca nel testo di tutte le conversazioni, l'esportazione, la bozza
 * che resta dopo un ricaricamento e il messaggio che al limite del piano aspetta. Si salta dove manca
 * il browser o l'interfaccia costruita. Con SHINKA_PROVA_IMMAGINI, in quella cartella restano le immagini.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
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

test("modifica e rigenera, menu dei comandi, ricerca, esportazione, bozza e coda al limite", { skip: salta, timeout: 120_000 }, async (t) => {
  const banco = await allestisci(t, { cartellaWeb });
  await banco.centro.listen({ host: "127.0.0.1", port: 0 });
  const indirizzo = `http://127.0.0.1:${(banco.centro.server.address() as AddressInfo).port}`;
  const browser = await chromium.launch({
    chromiumSandbox: disponibile?.recinto !== false,
    ...(disponibile?.canale === undefined ? {} : { channel: disponibile.canale }),
    ...(disponibile?.eseguibile === undefined ? {} : { executablePath: disponibile.eseguibile }),
  });
  t.after(() => browser.close());
  const pagina = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const cartellaImmagini = process.env.SHINKA_PROVA_IMMAGINI;
  if (cartellaImmagini !== undefined) await mkdir(cartellaImmagini, { recursive: true });
  const fotografa = async (nome: string) => {
    if (cartellaImmagini === undefined) return;
    await pagina.waitForTimeout(300);
    await pagina.screenshot({ path: join(cartellaImmagini, `b1-${nome}.png`) });
  };
  await pagina.goto(`${indirizzo}/`);
  await pagina.fill("#password", PASSWORD);
  await pagina.click('button[type="submit"]');
  const campo = pagina.locator("form.scrittura textarea");
  await campo.waitFor();

  // Un messaggio e la risposta; Claude ha cambiato un file.
  await campo.fill("Scrivi la lista della spesa nel file spesa.md");
  await campo.press("Enter");
  await finche(() => banco.home.inviati.length === 1, "il messaggio parte");
  banco.home.emetti({ tipo: "testo-iniziato", idTesto: "t1" });
  banco.home.emetti({ tipo: "testo-concluso", idTesto: "t1", testo: "Fatto: pane, latte e uova in spesa.md." });
  banco.home.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 5 });
  banco.home.fileCambiati = ["/home/node/progetti/_home/spesa.md"];

  // Modifica: il testo sul posto, la casella dei file con il loro elenco.
  const messaggio = pagina.locator(".riga.proprietario").first();
  await messaggio.hover();
  await messaggio.getByRole("button", { name: "Modifica" }).click();
  const modifica = pagina.locator(".modifica-messaggio");
  await modifica.getByText("_home/spesa.md").waitFor();
  await modifica.getByRole("textbox").fill("Scrivi la lista della spesa nel file spesa.md, con anche il caffè");
  await modifica.getByRole("checkbox").check();
  await fotografa("modifica");
  await modifica.getByRole("button", { name: "Manda da qui" }).click();
  await finche(() => banco.home.inviati.length === 2, "il messaggio modificato parte");
  assert.deepEqual(banco.home.riprese, [["m1", true]]);
  assert.equal(banco.home.inviati[1], "Scrivi la lista della spesa nel file spesa.md, con anche il caffè");
  await pagina.getByText("La conversazione riparte da qui, con un file riportato a com'erano.").waitFor();
  assert.equal(await pagina.getByText("Fatto: pane, latte e uova").count(), 0);

  // Rigenera: la stessa modifica sull'ultimo messaggio.
  banco.home.emetti({ tipo: "testo-iniziato", idTesto: "t2" });
  banco.home.emetti({ tipo: "testo-concluso", idTesto: "t2", testo: "Fatto, con il caffè." });
  banco.home.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 5 });
  await pagina.locator(".riga.claude").last().hover();
  await pagina.getByRole("button", { name: "Rigenera" }).click();
  await pagina.locator(".modifica-messaggio textarea").waitFor();
  assert.equal(await pagina.locator(".modifica-messaggio textarea").inputValue(), "Scrivi la lista della spesa nel file spesa.md, con anche il caffè");
  await pagina.locator(".modifica-messaggio").getByRole("button", { name: "Annulla" }).click();

  // Il menu "/": i comandi che l'harness conosce.
  banco.home.emetti({
    tipo: "stato",
    stato: { comandi: [{ nome: "compact", descrizione: "Compatta la conversazione" }, { nome: "mattpocock-skills:grill-me", descrizione: "Un'intervista sul piano", argomenti: "<piano>" }] },
  });
  await campo.fill("/gri");
  await pagina.locator(".menu-comandi li").first().waitFor();
  await fotografa("comandi");
  await campo.press("Enter");
  assert.equal(await campo.inputValue(), "/mattpocock-skills:grill-me ");
  await campo.fill("");

  // La bozza resta dopo un ricaricamento.
  await campo.fill("Una bozza da finire");
  await pagina.waitForTimeout(200);
  await pagina.reload();
  await campo.waitFor();
  assert.equal(await campo.inputValue(), "Una bozza da finire");

  // Al limite del piano il messaggio aspetta, e si può riprendere.
  banco.home.emetti({ tipo: "stato", stato: { limiti: { cinqueOre: { percento: 100, azzeraIl: new Date(Date.now() + 3_600_000).toISOString() } } } });
  await campo.press("Enter");
  await pagina.locator(".messaggio-in-coda").waitFor();
  assert.equal(banco.home.inviati.length, 2);
  await fotografa("coda");
  await pagina.locator(".messaggio-in-coda").getByRole("button", { name: "Modifica" }).click();
  assert.equal(await campo.inputValue(), "Una bozza da finire");

  // Esportazione in Markdown.
  const markdown = await pagina.evaluate(async () => (await fetch("/api/home/esporta")).text());
  assert.match(markdown, /^# Home/);
  assert.match(markdown, /con anche il caffè/);
  assert.doesNotMatch(markdown, /pane, latte e uova/);
  await pagina.locator(".menu-esporta summary").click();
  assert.equal(await pagina.getByRole("link", { name: "Scarica in Markdown" }).getAttribute("href"), "/api/home/esporta");

  // La ricerca nel testo di tutte le conversazioni.
  await pagina.goto(`${indirizzo}/#/cerca`);
  await pagina.getByRole("searchbox").fill("caffè");
  await pagina.locator(".risultati-cerca li").first().waitFor();
  await fotografa("cerca");
  assert.ok((await pagina.locator(".risultati-cerca li").count()) >= 1);
  await pagina.locator(".risultati-cerca a").first().click();
  await pagina.waitForURL(/#\/$/);
});
