/**
 * Prova a vista di una conversazione lunga: l'interfaccia costruita, in un browser vero, davanti a
 * un centro con conversazioni finte. La chat si apre con le sole voci più recenti e un pulsante per
 * le precedenti; il dettaglio di un'azione entra nella pagina, intero, solo quando la si apre. I
 * messaggi del proprietario mostrano a capo ed elenchi; sul telefono Invio va a capo e continua
 * l'elenco, al computer manda. Si salta dove manca il browser o l'interfaccia costruita. Con
 * SHINKA_PROVA_IMMAGINI, in quella cartella restano le immagini.
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

const CONTENUTO = `// file lungo\n${"const riga = 1;\n".repeat(400)}FINE-DEL-FILE`;

test(
  "una conversazione lunga si apre dalle voci recenti, e il dettaglio delle azioni arriva quando serve",
  { skip: salta, timeout: 120_000 },
  async (t) => {
    const banco = await allestisci(t, { cartellaWeb });
    // Duecento turni: un messaggio, un file scritto, una risposta.
    for (let turno = 1; turno <= 200; turno += 1) {
      banco.home.emetti({ tipo: "messaggio-proprietario", id: `m${turno}`, testo: `Richiesta numero ${turno}` });
      banco.home.emetti({ tipo: "turno-iniziato" });
      banco.home.emetti({ tipo: "azione-iniziata", idAzione: `a${turno}`, strumento: "Write", ingresso: { file_path: `/p/file-${turno}.ts`, content: CONTENUTO } });
      banco.home.emetti({ tipo: "azione-conclusa", idAzione: `a${turno}`, esito: `Scritto il file ${turno}`, errore: false });
      banco.home.emetti({ tipo: "testo-iniziato", idTesto: `t${turno}` });
      banco.home.emetti({ tipo: "testo-concluso", idTesto: `t${turno}`, testo: `Fatto il **turno ${turno}**.` });
      banco.home.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 5 });
    }
    await banco.centro.listen({ host: "127.0.0.1", port: 0 });
    const porta = (banco.centro.server.address() as AddressInfo).port;
    const browser = await chromium.launch({
      chromiumSandbox: disponibile?.recinto !== false,
      ...(disponibile?.canale === undefined ? {} : { channel: disponibile.canale }),
      ...(disponibile?.eseguibile === undefined ? {} : { executablePath: disponibile.eseguibile }),
    });
    t.after(() => browser.close());
    const cartellaImmagini = process.env.SHINKA_PROVA_IMMAGINI;
    if (cartellaImmagini !== undefined) await mkdir(cartellaImmagini, { recursive: true });

    const pagina = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    const fotografa = async (nome: string, quale = pagina) => {
      if (cartellaImmagini === undefined) return;
      await quale.waitForTimeout(300);
      await quale.screenshot({ path: join(cartellaImmagini, `chat-${nome}.png`) });
    };
    await pagina.goto(`http://127.0.0.1:${porta}/`);
    await pagina.fill("#password", PASSWORD);
    await pagina.click('button[type="submit"]');
    await pagina.getByText("Richiesta numero 200").waitFor();

    // Solo le voci recenti, e il pulsante per le altre; il contenuto dei file non è nella pagina.
    assert.equal(await pagina.getByText("Richiesta numero 1", { exact: true }).count(), 0);
    const precedenti = pagina.getByRole("button", { name: /Mostra i precedenti/ });
    assert.match((await precedenti.textContent()) ?? "", /\(5\d\d\)/);
    assert.equal(await pagina.getByText("FINE-DEL-FILE").count(), 0);
    assert.equal((await pagina.content()).includes("const riga = 1;"), false);
    await fotografa("aperta");

    // Aprendo un'azione arriva il dettaglio intero, chiesto al centro.
    const azione = pagina.locator(".riga.azione").last();
    await azione.locator("summary").click();
    await azione.getByText(/FINE-DEL-FILE/).waitFor();
    await fotografa("dettaglio");

    // Le precedenti si aggiungono in cima, e la conversazione resta dov'era.
    await pagina.locator(".conversazione").evaluate((elemento) => (elemento.scrollTop = 0));
    const primaVisibile = await pagina.getByText("Richiesta numero 181", { exact: true }).boundingBox();
    await precedenti.click();
    await pagina.getByText("Richiesta numero 161", { exact: true }).waitFor({ state: "attached" });
    const dopo = await pagina.getByText("Richiesta numero 181", { exact: true }).boundingBox();
    assert.ok(primaVisibile !== null && dopo !== null && Math.abs(primaVisibile.y - dopo.y) < 40, `${primaVisibile?.y} → ${dopo?.y}`);

    // Al computer Invio manda, Maiuscole+Invio va a capo continuando l'elenco.
    const campo = pagina.getByRole("textbox", { name: /Scrivi/ });
    await campo.click();
    await campo.pressSequentially("Cose da fare:");
    await campo.press("Shift+Enter");
    await campo.pressSequentially("- pane");
    await campo.press("Shift+Enter");
    await campo.pressSequentially("latte");
    assert.equal(await campo.inputValue(), "Cose da fare:\n- pane\n- latte");
    await campo.press("Enter");
    await finche(() => banco.home.inviati.length === 1, "il messaggio parte con Invio");
    assert.equal(banco.home.inviati[0], "Cose da fare:\n- pane\n- latte");
    // Nel fumetto, l'a capo e l'elenco.
    const fumetto = pagina.locator(".riga.proprietario .fumetto").last();
    await fumetto.locator("li").nth(1).waitFor();
    assert.deepEqual(await fumetto.locator("li").allTextContents(), ["pane", "latte"]);
    await fotografa("elenco");

    // Sul telefono Invio va a capo e continua l'elenco; si manda con il pulsante.
    const telefono = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, colorScheme: "dark" });
    t.after(() => telefono.close());
    const schermo = await telefono.newPage();
    await schermo.goto(`http://127.0.0.1:${porta}/`);
    await schermo.fill("#password", PASSWORD);
    await schermo.click('button[type="submit"]');
    const campoTelefono = schermo.getByRole("textbox", { name: /Scrivi/ });
    await campoTelefono.waitFor();
    await campoTelefono.click();
    await campoTelefono.pressSequentially("1. uno");
    await campoTelefono.press("Enter");
    await campoTelefono.pressSequentially("due");
    await campoTelefono.press("Enter");
    await campoTelefono.press("Enter");
    await campoTelefono.pressSequentially("Grazie");
    assert.equal(await campoTelefono.inputValue(), "1. uno\n2. due\nGrazie");
    assert.equal(banco.home.inviati.length, 1);
    await fotografa("telefono-scrittura", schermo);
    await schermo.getByRole("button", { name: "Invia" }).click();
    await finche(() => banco.home.inviati.length === 2, "il messaggio parte con il pulsante");
    assert.equal(banco.home.inviati[1], "1. uno\n2. due\nGrazie");
    await schermo.locator(".riga.proprietario .fumetto ol li").nth(1).waitFor();
    await fotografa("telefono-inviato", schermo);
  },
);
