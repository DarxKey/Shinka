/**
 * Prova a vista della sezione Shinka Desktop delle Impostazioni (ADR 0049), in un browser vero:
 * nessuna versione, la pubblicazione dalla cartella del progetto con la password, poi la versione
 * pubblicata. Si salta dove manca il browser o l'interfaccia costruita. Con SHINKA_PROVA_IMMAGINI,
 * in quella cartella restano le immagini.
 */

import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
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
const FOTO = process.env.SHINKA_PROVA_IMMAGINI;

test("Shinka Desktop nelle Impostazioni: pubblicare dalla cartella del progetto", { skip: salta, timeout: 120_000 }, async (t) => {
  const banco = await allestisci(t, { cartellaWeb });
  const progetto = await banco.lavori.crea("Shinka Desktop", "centro", "L'app per Windows.");
  const dist = join(progetto.cartella, "dist");
  mkdirSync(dist);
  const installer = randomBytes(200_000);
  const sha512 = createHash("sha512").update(installer).digest("base64");
  const nome = "Shinka-Desktop-0.2.0-installa.exe";
  writeFileSync(join(dist, nome), installer);
  writeFileSync(join(dist, `${nome}.blockmap`), gzipSync("{}"));
  writeFileSync(join(dist, "latest.yml"), `version: 0.2.0\nfiles:\n  - url: ${nome}\n    sha512: ${sha512}\n    size: ${installer.length}\npath: ${nome}\nsha512: ${sha512}\n`);

  await banco.centro.listen({ host: "127.0.0.1", port: 0 });
  const indirizzo = `http://127.0.0.1:${(banco.centro.server.address() as AddressInfo).port}`;
  const browser = await chromium.launch({
    chromiumSandbox: disponibile?.recinto !== false,
    ...(disponibile?.canale === undefined ? {} : { channel: disponibile.canale }),
    ...(disponibile?.eseguibile === undefined ? {} : { executablePath: disponibile.eseguibile }),
  });
  t.after(() => browser.close());
  const pagina = await browser.newPage({ viewport: { width: 390, height: 900 }, colorScheme: "light" });
  await pagina.goto(`${indirizzo}/`);
  await pagina.fill("#password", PASSWORD);
  await pagina.click('button[type="submit"]');
  await pagina.locator("form.scrittura textarea").waitFor();
  await pagina.goto(`${indirizzo}/#/impostazioni`);

  const sezione = pagina.locator("section.sezione-desktop");
  await sezione.getByText("Nessuna versione pubblicata.").waitFor();
  assert.equal(await sezione.locator("select").inputValue(), progetto.id);
  assert.equal(await sezione.getByLabel("Cartella nel progetto").inputValue(), "dist");
  await sezione.getByLabel("Password di Shinka").fill(PASSWORD);
  await sezione.getByRole("button", { name: "Pubblica" }).click();
  await sezione.getByText(/Pubblicata la versione 0\.2\.0: le app la prendono/).waitFor();
  await sezione.getByText("0.2.0", { exact: true }).waitFor();
  if (FOTO !== undefined) {
    mkdirSync(FOTO, { recursive: true });
    await sezione.screenshot({ path: join(FOTO, "desktop-pubblicata.png") });
  }
  assert.equal(banco.desktop.stato().pubblicata?.versione, "0.2.0");
});
