/**
 * Prova a vista dello scorrimento all'apertura di una chat: il centro rimanda tutta la storia,
 * evento per evento, e la chat deve comparire già in fondo, senza scorrere davanti al proprietario.
 * Il difetto l'ha visto lui il 12 novembre 2026: a ogni cambio di scheda partiva un veloce
 * scorrimento di tutta la chat. Si salta dove manca il browser o l'interfaccia costruita.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { test } from "node:test";
import { chromium, type Page } from "playwright-core";
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

/** Le posizioni per cui la conversazione è passata da quando la pagina le annota. */
async function posizioni(pagina: Page): Promise<number[]> {
  return pagina.evaluate(() => (window as unknown as { scorsi: number[] }).scorsi.splice(0));
}

test(
  "una chat lunga si apre già in fondo, senza scorrere davanti al proprietario",
  { skip: salta, timeout: 60_000 },
  async (t) => {
    const banco = await allestisci(t, { cartellaWeb });
    for (let i = 1; i <= 150; i += 1) {
      banco.home.invia(`Domanda numero ${i}`);
      banco.home.emetti({ tipo: "testo-iniziato", idTesto: `t${i}` });
      banco.home.emetti({ tipo: "testo-concluso", idTesto: `t${i}`, testo: `Risposta numero ${i}, abbastanza lunga da occupare una riga.` });
      banco.home.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 1 });
    }
    await banco.centro.listen({ host: "127.0.0.1", port: 0 });
    const porta = (banco.centro.server.address() as AddressInfo).port;

    const browser = await chromium.launch({
      chromiumSandbox: disponibile?.recinto !== false,
      ...(disponibile?.canale === undefined ? {} : { channel: disponibile.canale }),
      ...(disponibile?.eseguibile === undefined ? {} : { executablePath: disponibile.eseguibile }),
    });
    t.after(() => browser.close());
    const pagina = await browser.newPage({ viewport: { width: 390, height: 780 } });
    await pagina.addInitScript(() => {
      const scorsi: number[] = [];
      (window as unknown as { scorsi: number[] }).scorsi = scorsi;
      document.addEventListener(
        "scroll",
        (evento) => {
          const bersaglio = evento.target;
          if (bersaglio instanceof HTMLElement && bersaglio.classList.contains("conversazione")) scorsi.push(bersaglio.scrollTop);
        },
        true,
      );
    });

    await pagina.goto(`http://127.0.0.1:${porta}/`);
    // Come dal telefono: la storia arriva a pezzi, in più di un istante.
    const cdp = await pagina.context().newCDPSession(pagina);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 40,
      downloadThroughput: 40 * 1024,
      uploadThroughput: 40 * 1024,
    });
    await pagina.fill("#password", PASSWORD);
    await pagina.click('button[type="submit"]');
    const ultima = pagina.getByText("Risposta numero 150,");

    const controlla = async (quando: string) => {
      await ultima.waitFor({ timeout: 20_000 });
      await pagina.waitForTimeout(1500);
      const viste = await posizioni(pagina);
      const inFondo = await pagina.evaluate(() => {
        const conversazione = document.querySelector(".conversazione");
        if (conversazione === null) throw new Error("chat senza conversazione");
        return conversazione.scrollHeight - conversazione.scrollTop - conversazione.clientHeight < 2;
      });
      assert.ok(inFondo, `${quando}: la chat non è in fondo`);
      assert.ok(viste.length <= 2, `${quando}: la chat è passata per ${viste.length} posizioni (${viste.slice(0, 12).join(", ")}…)`);
    };

    await controlla("all'apertura");

    // Il cambio di scheda: un'altra pagina di Shinka e ritorno alla Home.
    await pagina.evaluate(() => {
      location.hash = "#/memoria";
    });
    await ultima.waitFor({ state: "detached" });
    await posizioni(pagina);
    await pagina.evaluate(() => {
      location.hash = "#/";
    });
    await controlla("al ritorno nella Home");
  },
);
