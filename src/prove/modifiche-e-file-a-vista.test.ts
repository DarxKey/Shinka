/**
 * Prova a vista della prima parte del gruppo C, in un browser vero davanti a un centro con
 * conversazioni finte e file veri: la scheda delle modifiche a fine turno, il pannello Modifiche con
 * le differenze e "riporta com'era"; il pannello File con la ricerca, il codice, il
 * Markdown, un'immagine, e un commento su una riga che parte con il messaggio dopo. Si salta dove
 * manca il browser o l'interfaccia costruita. Con SHINKA_PROVA_IMMAGINI, lì restano le immagini.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
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

/** Un'immagine PNG di un solo punto. */
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

for (const [nome, larghezza] of [["largo", 1280], ["telefono", 390]] as const) {
  test(`pannelli Modifiche e File, con un commento su una riga (${nome})`, { skip: salta, timeout: 120_000 }, async (t) => {
    const banco = await allestisci(t, { cartellaWeb });
    const progetto = await banco.lavori.crea("Videogioco", "centro", "Un gioco di piattaforme.");
    await mkdir(join(progetto.cartella, "src"), { recursive: true });
    await writeFile(join(progetto.cartella, "src", "gioco.ts"), "const vite = 5;\nconst livelli = 3;\nexport { vite, livelli };\n");
    await writeFile(join(progetto.cartella, "LEGGIMI.md"), "# Il gioco\n\nSi salta **in alto**.\n");
    await writeFile(join(progetto.cartella, "copertina.png"), Buffer.from(PNG, "base64"));
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
      await pagina.screenshot({ path: join(cartellaImmagini, `c1-${nome}-${cosa}.png`) });
    };
    await pagina.goto(`${indirizzo}/`);
    await pagina.fill("#password", PASSWORD);
    await pagina.click('button[type="submit"]');
    await pagina.locator("form.scrittura textarea").waitFor();
    await pagina.goto(`${indirizzo}/#/progetti/${progetto.id}`);
    await finche(() => banco.conversazioniLocali.length === 1, "il progetto apre la sua conversazione");
    const conversazione = banco.conversazioniLocali[0];
    assert.ok(conversazione !== undefined);
    await pagina.getByRole("heading", { name: "Videogioco" }).waitFor();

    // Claude finisce il turno del brief, poi in un altro cambia due file.
    conversazione.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 5 });
    conversazione.emetti({ tipo: "turno-iniziato" });
    conversazione.emetti({ tipo: "testo-concluso", idTesto: "t1", testo: "Ho dato 5 vite al giocatore e aggiunto i nemici." });
    conversazione.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 5 });
    conversazione.emetti({
      tipo: "modifiche",
      idTurno: "turno-1",
      file: [
        { percorso: "src/gioco.ts", aggiunte: 1, tolte: 1, stato: "cambiato" },
        { percorso: "src/nemici.ts", aggiunte: 2, tolte: 0, stato: "nuovo" },
        // Questo lo ha cambiato un comando: lo dice il confronto tra le fotografie dei file.
        { percorso: "livelli.json", aggiunte: 1, tolte: 1, stato: "cambiato", daComando: true },
      ],
      altri: 12,
    });
    conversazione.versioni.set("turno-1:livelli.json", { prima: '{ "livelli": 3 }\n', dopo: '{ "livelli": 4 }\n' });
    conversazione.versioni.set("turno-1:src/gioco.ts", { prima: "const vite = 3;\nconst livelli = 3;\nexport { vite, livelli };\n", dopo: "const vite = 5;\nconst livelli = 3;\nexport { vite, livelli };\n" });
    conversazione.versioni.set("turno-1:src/nemici.ts", { prima: null, dopo: "export const nemici = [];\nexport const boss = 1;\n" });

    // La scheda a fine turno; il pulsante del pannello non conta nulla: non c'è niente da accettare.
    const scheda = pagina.locator(".scheda-modifiche");
    await scheda.getByText("Claude ha cambiato 15 file").waitFor();
    await scheda.getByText("13 con dei comandi.").waitFor();
    await pagina.getByRole("button", { name: "Modifiche ai file", exact: true }).waitFor();
    assert.equal(await pagina.locator(".pulsanti-pannello .pallino-conteggio").count(), 0);
    await fotografa("scheda");
    await scheda.getByRole("button", { name: "Guarda" }).click();

    // Il pannello Modifiche: il turno aperto, le differenze di un file.
    const pannello = pagina.locator(".pannello-modifiche");
    await pannello.getByText("Turno 1").waitFor();
    await pannello.getByRole("button", { name: "src/gioco.ts" }).click();
    await pannello.locator(".riga-diff.tolta", { hasText: "const vite = 3;" }).waitFor();
    await pannello.locator(".riga-diff.aggiunta", { hasText: "const vite = 5;" }).waitFor();
    // Il file cambiato da un comando lo dice, e ha le sue differenze come gli altri; di quelli in più c'è solo il conto.
    const daComando = pannello.locator(".file-modificato", { hasText: "livelli.json" });
    await daComando.getByText("da un comando").waitFor();
    assert.equal(await pannello.locator(".file-modificato", { hasText: "src/gioco.ts" }).getByText("da un comando").count(), 0);
    await daComando.getByRole("button", { name: /livelli\.json/ }).click();
    await daComando.locator(".riga-diff.aggiunta", { hasText: '"livelli": 4' }).waitFor();
    await pannello.getByText("Altri 12 file sono cambiati in questo turno per un comando").waitFor();
    await fotografa("differenze");
    // Dove i comandi non si possono guardare, il pannello dice perché.
    conversazione.emetti({ tipo: "stato", stato: { fileDeiComandi: { guardati: false, motivo: "in questo ambiente manca Git" } } });
    await pannello.getByText("Qui i file cambiati dai comandi non si vedono: in questo ambiente manca Git.").waitFor();
    await fotografa("senza-comandi");
    conversazione.emetti({ tipo: "stato", stato: { fileDeiComandi: { guardati: true } } });
    await pannello.getByText("Qui i file cambiati dai comandi non si vedono").waitFor({ state: "detached" });

    // Non c'è «Accetta»: un file resta com'è, l'altro torna com'era, dopo la conferma.
    assert.equal(await pannello.getByRole("button", { name: /Accetta/ }).count(), 0);
    await pannello.locator(".file-modificato", { hasText: "src/nemici.ts" }).getByRole("button", { name: "Riporta com'era" }).click();
    await pannello.getByRole("alertdialog").getByRole("button", { name: "Riporta com'era" }).click();
    await pannello.locator(".file-modificato", { hasText: "src/nemici.ts" }).getByText("riportato com'era").waitFor();
    assert.deepEqual(conversazione.annullamenti, [["turno-1", ["src/nemici.ts"]]]);
    await fotografa("riportato");
    // Quello non riportato si può ancora riportare.
    await pannello.locator(".file-modificato", { hasText: "src/gioco.ts" }).getByRole("button", { name: "Riporta com'era" }).waitFor();

    // Il pannello File: la ricerca, il Markdown impaginato, l'immagine.
    await pagina.getByRole("tab", { name: "File" }).click();
    const file = pagina.locator(".pannello-file");
    await file.getByRole("button", { name: /LEGGIMI\.md/ }).click();
    await file.locator(".markdown-file strong", { hasText: "in alto" }).waitFor();
    await file.getByRole("button", { name: "← Progetto" }).click();
    await file.getByRole("button", { name: /copertina\.png/ }).click();
    await pagina.waitForFunction(() => document.querySelector<HTMLImageElement>(".pannello-file img")?.naturalWidth === 1);
    await file.getByRole("button", { name: "← Progetto" }).click();
    await file.getByRole("searchbox", { name: "Cerca un file per nome" }).fill("gioco");
    await file.getByRole("button", { name: /src\/gioco\.ts/ }).click();

    // Il codice, con i numeri di riga: un commento sulla seconda.
    await file.locator(".riga-file-testo", { hasText: "const livelli = 3;" }).waitFor();
    await file.getByRole("button", { name: "Commenta la riga 2" }).click();
    await file.getByLabel("Commento alla riga 2").fill("Mettine 10.");
    await fotografa("commento");
    await file.getByRole("button", { name: "Aggiungi il commento" }).click();
    await file.locator(".riga-file-testo.commentata").waitFor();

    // Il commento aspetta sopra il campo e parte con il messaggio.
    if (larghezza < 860) await pagina.getByRole("button", { name: "Chiudi il pannello e torna alla chat" }).click();
    const inAttesa = pagina.locator(".commenti-in-attesa");
    await inAttesa.getByText("Mettine 10.").waitFor();
    await fotografa("commenti-in-attesa");
    await pagina.locator("form.scrittura textarea").fill("Sistema questo.");
    await pagina.locator("form.scrittura button[type=submit]").click();
    // Il primo messaggio è il brief del progetto.
    await finche(() => conversazione.inviati.length === 2, "il messaggio parte");
    assert.equal(
      conversazione.inviati[1],
      "[Commenti del proprietario]\n- src/gioco.ts:2 (`const livelli = 3;`): Mettine 10.\n\nSistema questo.",
    );
    await inAttesa.waitFor({ state: "detached" });
  });
}
