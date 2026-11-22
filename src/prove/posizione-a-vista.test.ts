/**
 * Prova a vista del pulsante della posizione: l'interfaccia costruita, in un browser vero con la
 * posizione concessa, davanti a un centro con conversazioni finte. Si salta dove manca il browser
 * o l'interfaccia costruita. Con SHINKA_PROVA_IMMAGINI, in quella cartella resta l'immagine.
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

test("il pulsante della Home manda la posizione che il browser dà, dopo il permesso", { skip: salta, timeout: 60_000 }, async (t) => {
  const banco = await allestisci(t, { cartellaWeb });
  await banco.centro.listen({ host: "127.0.0.1", port: 0 });
  const porta = (banco.centro.server.address() as AddressInfo).port;
  const browser = await chromium.launch({
    chromiumSandbox: disponibile?.recinto !== false,
    ...(disponibile?.canale === undefined ? {} : { channel: disponibile.canale }),
    ...(disponibile?.eseguibile === undefined ? {} : { executablePath: disponibile.eseguibile }),
  });
  t.after(() => browser.close());
  const contesto = await browser.newContext({ viewport: { width: 390, height: 780 }, geolocation: { latitude: 35.6905, longitude: 139.7003, accuracy: 15 } });
  const pagina = await contesto.newPage();
  await pagina.goto(`http://127.0.0.1:${porta}/`);
  await pagina.fill("#password", PASSWORD);
  await pagina.click('button[type="submit"]');
  const pulsante = pagina.getByRole("button", { name: "Usa la mia posizione" });
  await pulsante.waitFor();

  // Senza permesso il browser non la dà, e il proprietario sa perché.
  await pulsante.click();
  await pagina.getByText("non ha il permesso").waitFor();
  assert.equal(banco.home.inviati.length, 0);

  await contesto.grantPermissions(["geolocation"]);
  await pulsante.click();
  await finche(() => banco.home.inviati.length === 1, "la posizione arriva alla Home");
  assert.match(banco.home.inviati[0] ?? "", /^📍 La mia posizione: 35\.69050, 139\.70030, precisione ±15 m/);
  assert.equal(banco.posizione.ultima()?.fonte, "browser");
  await pagina.getByText("📍 La mia posizione").waitFor();

  const cartellaImmagini = process.env.SHINKA_PROVA_IMMAGINI;
  if (cartellaImmagini !== undefined) {
    await mkdir(cartellaImmagini, { recursive: true });
    await pagina.waitForTimeout(400);
    await pagina.screenshot({ path: join(cartellaImmagini, "posizione-telefono.png") });
  }
});
