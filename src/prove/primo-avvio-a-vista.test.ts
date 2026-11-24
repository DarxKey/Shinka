/**
 * Prova a vista del primo avvio di un'installazione nuova, in un browser vero: la pagina chiede il
 * codice e la password, rifiuta un codice sbagliato, poi porta alle Impostazioni con il benvenuto.
 * Si salta dove manca il browser o l'interfaccia costruita. Con SHINKA_PROVA_IMMAGINI, in quella
 * cartella restano le immagini.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { test } from "node:test";
import { chromium } from "playwright-core";
import { allestisci } from "./banco.ts";
import { browserDiProva } from "./browser-di-prova.ts";

const cartellaWeb = join(import.meta.dirname, "..", "..", "web", "dist");
const disponibile = browserDiProva();
const salta =
  disponibile === undefined
    ? "su questa macchina non c'è un browser per la prova"
    : !existsSync(join(cartellaWeb, "index.html"))
      ? "l'interfaccia non è costruita"
      : false;

test("primo avvio: codice, password, poi il benvenuto nelle Impostazioni", { skip: salta, timeout: 120_000 }, async (t) => {
  const banco = await allestisci(t, { cartellaWeb, primoAvvio: true });
  await banco.centro.listen({ host: "127.0.0.1", port: 0 });
  const indirizzo = `http://127.0.0.1:${(banco.centro.server.address() as AddressInfo).port}`;
  const browser = await chromium.launch({
    chromiumSandbox: disponibile?.recinto !== false,
    ...(disponibile?.canale === undefined ? {} : { channel: disponibile.canale }),
    ...(disponibile?.eseguibile === undefined ? {} : { executablePath: disponibile.eseguibile }),
  });
  t.after(() => browser.close());
  const pagina = await browser.newPage({ viewport: { width: 390, height: 860 } });
  const cartellaImmagini = process.env.SHINKA_PROVA_IMMAGINI;
  if (cartellaImmagini !== undefined) await mkdir(cartellaImmagini, { recursive: true });
  const fotografa = async (cosa: string) => {
    if (cartellaImmagini !== undefined) await pagina.screenshot({ path: join(cartellaImmagini, `primo-avvio-${cosa}.png`), fullPage: true });
  };

  await pagina.goto(`${indirizzo}/`);
  await pagina.getByLabel("Codice di primo avvio").fill("AAAA-AAAA");
  await pagina.getByLabel("Password nuova").fill("una-password-di-prova");
  await pagina.getByLabel("Ripeti la password").fill("una-password-di-prova");
  await pagina.getByRole("button", { name: "Comincia" }).click();
  await pagina.getByText("Il codice non è giusto").waitFor();
  await fotografa("codice-sbagliato");

  await pagina.getByLabel("Codice di primo avvio").fill(banco.codicePrimoAvvio ?? "");
  await pagina.getByRole("button", { name: "Comincia" }).click();
  await pagina.getByRole("heading", { name: "Benvenuto in Shinka" }).waitFor();
  assert.equal(new URL(pagina.url()).hash, "#/impostazioni");
  assert.equal(banco.accesso.configurato, true);
  await fotografa("benvenuto");

  // «Ho finito» porta alla Home, e il benvenuto non torna.
  // Finita la preparazione, la presentazione guidata: si scorre fino in fondo e si arriva alla Home.
  await pagina.getByRole("link", { name: "Ho finito: com'è fatta Shinka" }).click();
  await pagina.getByRole("heading", { name: "Benvenuto in Shinka" }).waitFor();
  assert.equal(new URL(pagina.url()).hash, "#/presentazione");
  for (const titolo of ["La Home", "I progetti", "Gli ambienti", "Le estensioni", "Le tue chiavi restano tue", "Shinka si sviluppa da sé"]) {
    await pagina.getByRole("button", { name: "Avanti" }).click();
    await pagina.getByRole("heading", { name: titolo }).waitFor();
  }
  await pagina.getByRole("button", { name: "Vai alla Home" }).click();
  await pagina.locator("form.scrittura textarea").waitFor();
  // Si riapre quando si vuole (dal menu delle pagine, che la prova della barra laterale guarda).
  await pagina.goto(`${indirizzo}/#/presentazione`);
  await pagina.getByRole("heading", { name: "Benvenuto in Shinka" }).waitFor();
  await pagina.getByRole("button", { name: "Salta" }).click();
  await pagina.locator("form.scrittura textarea").waitFor();
  await pagina.goto(`${indirizzo}/#/impostazioni`);
  await pagina.getByRole("heading", { name: "Motore delle conversazioni nuove" }).waitFor();
  assert.equal(await pagina.getByRole("heading", { name: "Benvenuto in Shinka" }).count(), 0);
});
