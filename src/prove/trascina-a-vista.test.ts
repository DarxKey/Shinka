/**
 * Prova a vista del gruppo E, in un browser vero davanti a un centro con conversazioni finte: un file
 * trascinato sopra la chat fa comparire dove lasciarlo, lasciato si allega al messaggio e parte con
 * lui. In un argomento archiviato non si allega nulla. Si salta dove manca il browser o l'interfaccia
 * costruita. Con SHINKA_PROVA_IMMAGINI, in quella cartella resta l'immagine.
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

test("un file trascinato sulla chat si allega al messaggio", { skip: salta, timeout: 90_000 }, async (t) => {
  const banco = await allestisci(t, { cartellaWeb });
  await banco.centro.listen({ host: "127.0.0.1", port: 0 });
  const indirizzo = `http://127.0.0.1:${(banco.centro.server.address() as AddressInfo).port}`;
  const browser = await chromium.launch({
    chromiumSandbox: disponibile?.recinto !== false,
    ...(disponibile?.canale === undefined ? {} : { channel: disponibile.canale }),
    ...(disponibile?.eseguibile === undefined ? {} : { executablePath: disponibile.eseguibile }),
  });
  t.after(() => browser.close());
  const pagina = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await pagina.goto(`${indirizzo}/`);
  await pagina.fill("#password", PASSWORD);
  await pagina.click('button[type="submit"]');
  await pagina.locator("form.scrittura textarea").waitFor();

  // Il browser trascina un file di testo sopra la chat.
  const trascinato = await pagina.evaluateHandle(() => {
    const dati = new DataTransfer();
    dati.items.add(new File(["latte\nuova\n"], "spesa.txt", { type: "text/plain" }));
    return dati;
  });
  const chat = pagina.locator(".app").first();
  await chat.dispatchEvent("dragenter", { dataTransfer: trascinato });
  await pagina.locator(".lascia-qui").waitFor();
  const cartellaImmagini = process.env.SHINKA_PROVA_IMMAGINI;
  if (cartellaImmagini !== undefined) {
    await mkdir(cartellaImmagini, { recursive: true });
    await pagina.screenshot({ path: join(cartellaImmagini, "e-trascina.png") });
  }
  await chat.dispatchEvent("drop", { dataTransfer: trascinato });
  await pagina.locator(".lascia-qui").waitFor({ state: "detached" });
  await pagina.locator(".da-allegare").getByText("spesa.txt").waitFor();

  await pagina.locator("form.scrittura textarea").fill("Ecco la lista");
  await pagina.locator("form.scrittura button[type=submit]").click();
  await finche(() => banco.home.inviati.length === 1, "il messaggio parte");
  assert.deepEqual(
    banco.home.allegati[0]?.map((allegato) => [allegato.nome, Buffer.from(allegato.dati, "base64").toString()]),
    [["spesa.txt", "latte\nuova\n"]],
  );
});
