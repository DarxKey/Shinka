/**
 * Prova a vista: il campo di scrittura sta in fondo alla finestra anche a chat vuota, con le schede
 * delle chat parallele e con lo stato del progetto, su schermo largo e su telefono; con molti
 * messaggi la conversazione scorre e il campo resta lì. Si salta dove manca il browser o l'interfaccia.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { test } from "node:test";
import { chromium, type Page } from "playwright-core";
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

/** Di quanto il campo in cui si scrive resta sopra il fondo della finestra. */
async function distanzaDalFondo(pagina: Page): Promise<number> {
  return pagina.evaluate(() => {
    const campo = document.querySelector("form.scrittura textarea");
    if (campo === null) return Number.POSITIVE_INFINITY;
    return Math.round(window.innerHeight - campo.getBoundingClientRect().bottom);
  });
}

for (const [nome, larghezza, altezza] of [["largo", 1280, 900], ["telefono", 390, 800]] as const) {
  test(`il campo di scrittura resta in fondo, anche a chat vuota (${nome})`, { skip: salta, timeout: 120_000 }, async (t) => {
    const banco = await allestisci(t, { cartellaWeb });
    await banco.centro.listen({ host: "127.0.0.1", port: 0 });
    const indirizzo = `http://localhost:${(banco.centro.server.address() as AddressInfo).port}`;
    const browser = await chromium.launch({
      chromiumSandbox: disponibile?.recinto !== false,
      ...(disponibile?.canale === undefined ? {} : { channel: disponibile.canale }),
      ...(disponibile?.eseguibile === undefined ? {} : { executablePath: disponibile.eseguibile }),
    });
    t.after(() => browser.close());
    const pagina = await browser.newPage({ viewport: { width: larghezza, height: altezza } });
    await pagina.goto(`${indirizzo}/`);
    await pagina.fill("#password", PASSWORD);
    await pagina.click('button[type="submit"]');
    await pagina.locator("form.scrittura textarea").waitFor();

    // La Home vuota: si misura subito, e si confronta poi con la chat piena.
    await pagina.locator(".vuota").waitFor();
    const aChatVuota = await distanzaDalFondo(pagina);
    // Dove sta il campo con la chat piena: lì deve stare sempre.
    for (let numero = 0; numero < 30; numero += 1) {
      banco.casa.invia(`Domanda ${numero}`);
      banco.home.emetti({ tipo: "testo-concluso", idTesto: `t${numero}`, testo: `Risposta numero ${numero}, abbastanza lunga da occupare una riga intera della conversazione.` });
      banco.home.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 1 });
    }
    await pagina.getByText("Risposta numero 29").waitFor();
    const giusta = await distanzaDalFondo(pagina);
    assert.ok(giusta < 200, `chat piena: ${giusta}px dal fondo`);
    const scorre = await pagina.evaluate(() => {
      const lista = document.querySelector(".conversazione");
      return lista !== null && lista.scrollHeight > lista.clientHeight;
    });
    assert.equal(scorre, true);
    const alSuoPosto = async (cosa: string): Promise<void> => {
      const distanza = await distanzaDalFondo(pagina);
      assert.ok(Math.abs(distanza - giusta) <= 2, `${cosa}: il campo è a ${distanza}px dal fondo invece di ${giusta}px`);
    };
    assert.ok(Math.abs(aChatVuota - giusta) <= 2, `Home vuota: il campo era a ${aChatVuota}px dal fondo invece di ${giusta}px`);
    // Con una chat parallela aperta: c'è la riga delle schede, e la chat nuova è vuota.
    await pagina.getByRole("button", { name: "Nuova chat parallela" }).click();
    await pagina.locator(".schede-chat").waitFor();
    await pagina.locator(".vuota").waitFor();
    await alSuoPosto("chat parallela vuota");

    // Un progetto con lo stato e senza messaggi del proprietario.
    const progetto = await banco.lavori.crea("Videogioco", "centro", "Un gioco.");
    await finche(() => banco.conversazioniLocali.length === 1, "il progetto apre la sua conversazione");
    banco.conversazioniLocali[0]?.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 1 });
    banco.conversazioniLocali[0]?.emetti({ tipo: "stato-progetto", testo: "Appena cominciato." });
    await pagina.goto(`${indirizzo}/#/progetti/${progetto.id}`);
    await pagina.locator("details.stato-progetto").waitFor();
    await alSuoPosto("progetto con lo stato");
    if (process.env.SHINKA_PROVA_IMMAGINI !== undefined) await pagina.screenshot({ path: join(process.env.SHINKA_PROVA_IMMAGINI, `campo-in-fondo-${nome}.png`) });
  });
}
