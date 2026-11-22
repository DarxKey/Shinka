/**
 * Prova a vista del gruppo G, in un browser vero davanti a un centro con conversazioni finte e
 * file veri: un elaborato vivo con "Aggiorna" (nella chat e nella pagina), la modifica a mano di un
 * elaborato Markdown, e un commento su un pezzo scelto, che parte con il messaggio dopo alla Home.
 * Si salta dove manca il browser o l'interfaccia costruita. Con SHINKA_PROVA_IMMAGINI, lì restano
 * le immagini.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { test } from "node:test";
import { chromium } from "playwright-core";
import { chiaveElaborato } from "../../web/src/elaborati-giorni.ts";
import { azioniDellaHome } from "../centro/strumenti-home.ts";
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
  test(`elaborati vivi, modifica a mano e commenti (${nome})`, { skip: salta, timeout: 120_000 }, async (t) => {
    const banco = await allestisci(t, { cartellaWeb });
    const idArgomento = banco.casa.idArgomentoAperto;
    const cartella = banco.casa.cartellaAperta;
    await mkdir(cartella, { recursive: true });
    await writeFile(join(cartella, "prezzi.md"), "# Prezzi\n\nieri: 10\n");
    await writeFile(join(cartella, "itinerario.md"), "# Itinerario\n\nGiorno 1: Tokyo\n\nGiorno 2: Kyoto\n");
    const azioni = azioniDellaHome({ ambienti: banco.ambienti, lavori: banco.lavori, proposte: banco.proposte, home: () => banco.casa, agisci: banco.agisci, elaborati: banco.elaborati });
    await azioni.mostraElaborato({ ambiente: "Unraid", percorso: "prezzi.md", titolo: "Prezzi di oggi", aggiorna: "printf '# Prezzi\\n\\noggi: 12\\n' > prezzi.md" });
    await azioni.mostraElaborato({ ambiente: "Unraid", percorso: "itinerario.md", titolo: "Itinerario" });

    await banco.centro.listen({ host: "127.0.0.1", port: 0 });
    const indirizzo = `http://127.0.0.1:${(banco.centro.server.address() as AddressInfo).port}`;
    const browser = await chromium.launch({
      chromiumSandbox: disponibile?.recinto !== false,
      ...(disponibile?.canale === undefined ? {} : { channel: disponibile.canale }),
      ...(disponibile?.eseguibile === undefined ? {} : { executablePath: disponibile.eseguibile }),
    });
    t.after(() => browser.close());
    const pagina = await browser.newPage({ viewport: { width: larghezza, height: 900 } });
    const cartellaImmagini = process.env.SHINKA_PROVA_IMMAGINI;
    if (cartellaImmagini !== undefined) await mkdir(cartellaImmagini, { recursive: true });
    const fotografa = async (cosa: string) => {
      if (cartellaImmagini === undefined) return;
      await pagina.waitForTimeout(300);
      await pagina.screenshot({ path: join(cartellaImmagini, `g-${nome}-${cosa}.png`) });
    };
    await pagina.goto(`${indirizzo}/`);
    await pagina.fill("#password", PASSWORD);
    await pagina.click('button[type="submit"]');
    await pagina.locator("form.scrittura textarea").waitFor();

    // Nella chat: l'elaborato vivo ha "Aggiorna", con il comando da leggere.
    const scheda = pagina.locator(".scheda-elaborato", { hasText: "Prezzi di oggi" });
    await scheda.getByText("ieri: 10").waitFor();
    await scheda.getByText("Che cosa fa").click();
    await scheda.getByText("printf").waitFor();
    await fotografa("chat");
    await scheda.getByRole("button", { name: "Aggiorna" }).click();
    await scheda.getByText("oggi: 12").waitFor();
    assert.equal(await readFile(join(cartella, "prezzi.md"), "utf8"), "# Prezzi\n\noggi: 12\n");

    // Nella pagina: la modifica a mano.
    const chiave = chiaveElaborato({ idArgomento, idAmbiente: "centro", percorso: "itinerario.md" });
    await pagina.goto(`${indirizzo}/#/elaborati/${encodeURIComponent(chiave)}`);
    await pagina.getByText("Giorno 2: Kyoto").waitFor();
    await pagina.getByRole("button", { name: "Modifica" }).click();
    const editor = pagina.getByLabel("Il testo dell'elaborato");
    assert.match(await editor.inputValue(), /Giorno 2: Kyoto/);
    await editor.fill("# Itinerario\n\nGiorno 1: Tokyo\n\nGiorno 2: Nara\n");
    await fotografa("modifica");
    await pagina.getByRole("button", { name: "Salva" }).click();
    await pagina.getByText("Giorno 2: Nara").waitFor();
    assert.equal(await readFile(join(cartella, "itinerario.md"), "utf8"), "# Itinerario\n\nGiorno 1: Tokyo\n\nGiorno 2: Nara\n");

    // Un commento su un pezzo scelto.
    // L'anteprima si rilegge dopo il salvataggio: si sceglie il pezzo quando ha finito.
    await pagina.waitForLoadState("networkidle");
    await pagina.locator(".anteprima-elaborato p", { hasText: "Giorno 1: Tokyo" }).selectText();
    await pagina.getByRole("button", { name: "Commenta" }).click();
    await pagina.locator(".commento-elaborato blockquote", { hasText: "Giorno 1: Tokyo" }).waitFor();
    await pagina.getByLabel("Commento all'elaborato").fill("Aggiungi il mercato del pesce.");
    await fotografa("commento");
    await pagina.getByRole("button", { name: "Aggiungi il commento" }).click();
    await pagina.getByRole("link", { name: "Vai alla Home" }).click();

    // Nella Home i due avvisi aspettano sopra il campo e partono con il messaggio.
    const inAttesa = pagina.locator(".commenti-in-attesa");
    await inAttesa.getByText("Aggiungi il mercato del pesce.").waitFor();
    await inAttesa.getByText("L'ho modificato a mano").waitFor();
    await pagina.locator("form.scrittura textarea").fill("Rivedi l'itinerario.");
    await pagina.locator("form.scrittura button[type=submit]").click();
    await finche(() => banco.home.inviati.length === 1, "il messaggio parte");
    const mandato = banco.home.inviati[0] ?? "";
    assert.match(mandato, /^\[Commenti del proprietario\]\n/);
    assert.match(mandato, /- itinerario\.md \(elaborato nell'ambiente Unraid, argomento aperto \(.+\)\): L'ho modificato a mano/);
    assert.match(mandato, /\(«Giorno 1: Tokyo»\): Aggiungi il mercato del pesce\./);
    assert.match(mandato, /\n\nRivedi l'itinerario\.$/);
  });
}
