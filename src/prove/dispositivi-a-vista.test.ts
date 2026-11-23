/**
 * Prova a vista dei dispositivi nella pagina Sicurezza (ADR 0047), in un browser vero: il
 * dispositivo con il suo nome e la sua app, tolto con una conferma. Si salta dove manca il browser
 * o l'interfaccia costruita. Con SHINKA_PROVA_IMMAGINI, in quella cartella restano le immagini.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
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
const FOTO = process.env.SHINKA_PROVA_IMMAGINI;

for (const [nome, larghezza] of [["largo", 1280], ["telefono", 390]] as const) {
  test(`i dispositivi nella pagina Sicurezza, tolti con una conferma (${nome})`, { skip: salta, timeout: 120_000 }, async (t) => {
    const banco = await allestisci(t, { cartellaWeb });
    const aggiunto = await banco.centro.inject({
      method: "POST",
      url: "/api/dispositivi",
      headers: { "user-agent": "ShinkaDesktop/0.1.0" },
      payload: { password: PASSWORD, nome: "PC dello studio", genere: "desktop" },
    });
    const { token } = aggiunto.json() as { token: string };
    await banco.centro.listen({ host: "127.0.0.1", port: 0 });
    const indirizzo = `http://127.0.0.1:${(banco.centro.server.address() as AddressInfo).port}`;
    const browser = await chromium.launch({
      chromiumSandbox: disponibile?.recinto !== false,
      ...(disponibile?.canale === undefined ? {} : { channel: disponibile.canale }),
      ...(disponibile?.eseguibile === undefined ? {} : { executablePath: disponibile.eseguibile }),
    });
    t.after(() => browser.close());
    const pagina = await browser.newPage({ viewport: { width: larghezza, height: 900 }, colorScheme: "light" });
    await pagina.goto(`${indirizzo}/`);
    await pagina.fill("#password", PASSWORD);
    await pagina.click('button[type="submit"]');
    await pagina.locator("form.scrittura textarea").waitFor();
    await pagina.goto(`${indirizzo}/#/sicurezza`);

    const sezione = pagina.locator("section", { has: pagina.getByRole("heading", { name: "Dispositivi" }) });
    await sezione.getByText("PC dello studio").waitFor();
    await sezione.getByText("App per il computer · Shinka Desktop 0.1.0").waitFor();
    if (FOTO !== undefined) {
      mkdirSync(FOTO, { recursive: true });
      await sezione.screenshot({ path: join(FOTO, `dispositivi-${nome}.png`) });
    }
    await sezione.getByRole("button", { name: "Togli", exact: true }).click();
    await sezione.getByRole("button", { name: "Togli davvero" }).click();
    await sezione.waitFor({ state: "detached" });
    const dopo = await banco.centro.inject({ method: "GET", url: "/api/sicurezza", headers: { authorization: `Bearer ${token}` } });
    assert.equal(dopo.statusCode, 401);
  });
}
