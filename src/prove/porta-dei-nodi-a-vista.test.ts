/**
 * Prova a vista della porta solo per i nodi nella pagina Sicurezza (ADR 0065), in un browser vero:
 * spenta, dice come si accende; accesa, dice la porta e l'indirizzo da Internet, che si cambia dal
 * campo e resta dopo un ricaricamento. Si salta dove manca
 * il browser o l'interfaccia costruita. Con SHINKA_PROVA_IMMAGINI, in quella cartella restano le immagini.
 */

import { existsSync, mkdirSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { test } from "node:test";
import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { NodiDaFuoriDelCentro, PortaDeiNodi } from "../centro/porta-dei-nodi.ts";
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

for (const [nome, larghezza, accesa] of [
  ["spenta", 1280, false],
  ["accesa-largo", 1280, true],
  ["accesa-telefono", 390, true],
] as const) {
  test(`la porta solo per i nodi nella pagina Sicurezza (${nome})`, { skip: salta, timeout: 120_000 }, async (t) => {
    const porta = new PortaDeiNodi();
    const nodiDaFuori = new NodiDaFuoriDelCentro(porta, "http://nodi.esempio.it:7853", () => {});
    const banco = await allestisci(t, { cartellaWeb, ...(accesa ? { nodiDaFuori } : {}) });
    await banco.centro.listen({ host: "127.0.0.1", port: 0 });
    const portaNodi = accesa ? await porta.apri(banco.centro.server, 0, "127.0.0.1") : undefined;
    t.after(() => porta.chiudi());
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
    if (larghezza > 1000) {
      // Dal menu delle pagine, dove la pagina Sicurezza sta accanto alle Impostazioni.
      await pagina.locator(".menu-pagine > summary").click();
      await pagina.locator(".voci-pagine").getByRole("link", { name: "Sicurezza" }).click();
    } else await pagina.goto(`${indirizzo}/#/sicurezza`);

    const riga = pagina.locator('[data-parte="porta-dei-nodi"]');
    if (accesa) {
      await riga.getByText(String(portaNodi), { exact: true }).waitFor();
      await riga.getByText(/un nodo nuovo si presenta solo mentre c'è un invito aperto/).waitFor();
      const campo = riga.getByLabel("Indirizzo da Internet per i nodi");
      assert.equal(await campo.inputValue(), "http://nodi.esempio.it:7853");
      assert.equal(await riga.getByRole("button", { name: "Salva" }).isDisabled(), true);
      // Cambiato e salvato: la pagina lo ricorda e offre di tornare a quello di partenza.
      await campo.fill("http://nodi2.esempio.net:7853");
      await riga.getByRole("button", { name: "Salva" }).click();
      await riga.getByRole("button", { name: "Torna a quello di partenza" }).waitFor();
      await riga.getByText(/Quello di partenza è http:\/\/nodi\.esempio\.it:7853/).waitFor();
      await pagina.reload();
      assert.equal(await pagina.locator('[data-parte="porta-dei-nodi"]').getByLabel("Indirizzo da Internet per i nodi").inputValue(), "http://nodi2.esempio.net:7853");
    } else {
      await riga.getByText(/Porta solo per i nodi: spenta\. Si accende dove gira il centro, con SHINKA_PORTA_NODI/).waitFor();
    }
    if (FOTO !== undefined) {
      mkdirSync(FOTO, { recursive: true });
      await pagina.locator("section", { has: pagina.getByRole("heading", { name: "Collegamento dei nodi" }) }).screenshot({ path: join(FOTO, `porta-dei-nodi-${nome}.png`) });
    }
  });
}

test("per un ambiente nuovo la pagina Ambienti propone anche l'indirizzo da Internet", { skip: salta, timeout: 120_000 }, async (t) => {
  const banco = await allestisci(t, { cartellaWeb });
  banco.ambienti.indirizzoDaFuori("http://nodi.esempio.it:7853");
  await banco.centro.listen({ host: "127.0.0.1", port: 0 });
  const indirizzo = `http://127.0.0.1:${(banco.centro.server.address() as AddressInfo).port}`;
  const browser = await chromium.launch({
    chromiumSandbox: disponibile?.recinto !== false,
    ...(disponibile?.canale === undefined ? {} : { channel: disponibile.canale }),
    ...(disponibile?.eseguibile === undefined ? {} : { executablePath: disponibile.eseguibile }),
  });
  t.after(() => browser.close());
  const pagina = await browser.newPage({ viewport: { width: 1200, height: 900 }, colorScheme: "light" });
  await pagina.goto(`${indirizzo}/`);
  await pagina.fill("#password", PASSWORD);
  await pagina.click('button[type="submit"]');
  await pagina.locator("form.scrittura textarea").waitFor();
  await pagina.locator(".menu-pagine > summary").click();
  await pagina.locator(".voci-pagine").getByRole("button", { name: /Ambienti/ }).click();
  const pannello = pagina.getByRole("region", { name: "Ambienti" });
  await pannello.getByRole("button", { name: "Aggiungi un ambiente" }).click();
  const campo = pannello.getByLabel("Indirizzo di Shinka visto da quella macchina");
  assert.equal(await campo.inputValue(), indirizzo);
  await pannello.getByRole("button", { name: "Da Internet" }).click();
  assert.equal(await campo.inputValue(), "http://nodi.esempio.it:7853");
  assert.equal(await pannello.getByRole("button", { name: "Da Internet" }).getAttribute("aria-pressed"), "true");
  if (FOTO !== undefined) {
    mkdirSync(FOTO, { recursive: true });
    await pannello.locator("form").screenshot({ path: join(FOTO, "ambiente-nuovo-da-internet.png") });
  }
  await pannello.getByRole("button", { name: "Da casa" }).click();
  assert.equal(await campo.inputValue(), indirizzo);
});
