/**
 * Prova a vista della porta solo per i nodi nella pagina Sicurezza (ADR 0065), in un browser vero:
 * spenta, dice come si accende; accesa, dice la porta e l'indirizzo da Internet. Si salta dove manca
 * il browser o l'interfaccia costruita. Con SHINKA_PROVA_IMMAGINI, in quella cartella restano le immagini.
 */

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

for (const [nome, larghezza, accesa] of [
  ["spenta", 1280, false],
  ["accesa-largo", 1280, true],
  ["accesa-telefono", 390, true],
] as const) {
  test(`la porta solo per i nodi nella pagina Sicurezza (${nome})`, { skip: salta, timeout: 120_000 }, async (t) => {
    const banco = await allestisci(t, {
      cartellaWeb,
      ...(accesa ? { nodiDaFuori: { da: () => false, porta: 7853, indirizzo: "http://nodi.esempio.it:7853" } } : {}),
    });
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

    const riga = pagina.locator('[data-parte="porta-dei-nodi"]');
    if (accesa) {
      await riga.getByText("7853", { exact: true }).waitFor();
      await riga.getByText("http://nodi.esempio.it:7853", { exact: true }).waitFor();
      await riga.getByText(/un nodo nuovo si presenta solo mentre c'è un invito aperto/).waitFor();
    } else {
      await riga.getByText(/Porta solo per i nodi: spenta\. Si accende dove gira il centro, con SHINKA_PORTA_NODI/).waitFor();
    }
    if (FOTO !== undefined) {
      mkdirSync(FOTO, { recursive: true });
      await pagina.locator("section", { has: pagina.getByRole("heading", { name: "Collegamento dei nodi" }) }).screenshot({ path: join(FOTO, `porta-dei-nodi-${nome}.png`) });
    }
  });
}
