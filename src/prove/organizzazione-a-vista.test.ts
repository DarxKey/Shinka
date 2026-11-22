/**
 * Prova a vista del gruppo F, in un browser vero davanti a un centro con conversazioni finte: la
 * palette con Ctrl+K, la barra laterale con i gruppi, un progetto fissato, rinominato ed eliminato,
 * e le pagine Uso e Archiviazione. Si salta dove manca il browser o l'interfaccia costruita. Con
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

for (const [nome, larghezza] of [["largo", 1280], ["telefono", 390]] as const) {
  test(`palette, barra laterale, Uso e Archiviazione (${nome})`, { skip: salta, timeout: 120_000 }, async (t) => {
    const banco = await allestisci(t, { cartellaWeb });
    const gioco = await banco.lavori.crea("Videogioco", "centro", "Un gioco.");
    await banco.lavori.crea("Ricette", "centro", "Un ricettario.");
    await finche(() => banco.conversazioniLocali.length === 2, "i progetti aprono le loro conversazioni");
    for (const conversazione of banco.conversazioniLocali) conversazione.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 1, token: { ingresso: 5000, uscita: 400 } });
    await banco.centro.listen({ host: "127.0.0.1", port: 0 });
    const indirizzo = `http://127.0.0.1:${(banco.centro.server.address() as AddressInfo).port}`;
    const browser = await chromium.launch({
      chromiumSandbox: disponibile?.recinto !== false,
      ...(disponibile?.canale === undefined ? {} : { channel: disponibile.canale }),
      ...(disponibile?.eseguibile === undefined ? {} : { executablePath: disponibile.eseguibile }),
    });
    t.after(() => browser.close());
    const pagina = await browser.newPage({ viewport: { width: larghezza, height: 860 } });
    const cartellaImmagini = process.env.SHINKA_PROVA_IMMAGINI;
    if (cartellaImmagini !== undefined) await mkdir(cartellaImmagini, { recursive: true });
    const fotografa = async (cosa: string) => {
      if (cartellaImmagini === undefined) return;
      await pagina.waitForTimeout(300);
      await pagina.screenshot({ path: join(cartellaImmagini, `f-${nome}-${cosa}.png`) });
    };
    await pagina.goto(`${indirizzo}/`);
    await pagina.fill("#password", PASSWORD);
    await pagina.click('button[type="submit"]');
    await pagina.locator("form.scrittura textarea").waitFor();

    // La palette: Ctrl+K, qualche lettera, Invio.
    await pagina.keyboard.press("Control+k");
    const palette = pagina.getByRole("dialog", { name: "Vai a" });
    await palette.getByRole("searchbox").fill("video");
    // Sotto carico l'elenco dei progetti può arrivare dopo: Invio solo quando la voce c'è.
    await palette.getByText("Videogioco").first().waitFor();
    await fotografa("palette");
    await palette.getByRole("searchbox").press("Enter");
    await pagina.getByRole("heading", { name: "Videogioco" }).waitFor();
    // Esc la chiude senza fare nulla.
    await pagina.keyboard.press("Control+k");
    await palette.waitFor();
    await pagina.keyboard.press("Escape");
    await palette.waitFor({ state: "detached" });

    const apriBarra = async () => {
      if (larghezza < 860) await pagina.getByRole("button", { name: /^Progetti/ }).click();
    };
    const barra = pagina.getByRole("navigation", { name: "Home e progetti" });

    // Fissa in cima e rinomina dal menu del progetto.
    await apriBarra();
    const riga = barra.locator(".riga-progetto", { hasText: "Videogioco" });
    await riga.locator("summary").click();
    await riga.getByRole("button", { name: "Fissa in cima" }).click();
    await barra.getByRole("group", { name: "Fissati" }).getByText("Videogioco").waitFor();
    await barra.locator(".riga-progetto", { hasText: "Videogioco" }).locator("summary").click();
    await barra.getByRole("button", { name: "Rinomina" }).click();
    await barra.getByLabel("Nuovo nome di Videogioco").fill("Gioco di salti");
    await barra.getByRole("button", { name: "Salva" }).click();
    await barra.getByText("Gioco di salti").waitFor();
    assert.equal(banco.progetti.trova(gioco.id)?.nome, "Gioco di salti");
    await barra.getByLabel("Raggruppa i progetti").selectOption("ambiente");
    await barra.getByRole("group", { name: "Unraid" }).getByText("Ricette").waitFor();
    await fotografa("barra");

    // Elimina, con la conferma.
    await barra.locator(".riga-progetto", { hasText: "Ricette" }).locator("summary").click();
    await barra.getByRole("button", { name: "Elimina…" }).click();
    await barra.getByRole("alertdialog").getByRole("button", { name: "Elimina" }).click();
    await barra.locator(".riga-progetto", { hasText: "Ricette" }).waitFor({ state: "detached" });
    assert.equal(banco.lavori.stato().progetti.length, 1);

    // La pagina Uso.
    await pagina.goto(`${indirizzo}/#/uso`);
    await pagina.getByRole("heading", { name: "Uso", exact: true }).waitFor();
    await pagina.locator(".tabella-uso").getByText("Gioco di salti").waitFor();
    await fotografa("uso");

    // La pagina Archiviazione.
    await pagina.goto(`${indirizzo}/#/archiviazione`);
    await pagina.locator(".voce-spazio", { hasText: "Gioco di salti" }).waitFor();
    await fotografa("archiviazione");
  });
}
