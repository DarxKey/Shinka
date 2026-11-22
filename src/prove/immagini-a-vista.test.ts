/**
 * Prova a vista delle immagini scritte nel testo di una risposta (ADR 0043), in un browser vero:
 * una lista di luoghi con una foto per voce diventa una serie di schede, un'immagine sola si vede
 * grande, una che non si scarica sparisce senza rompere nulla, e un tocco apre la foto a tutto
 * schermo. Le immagini le dà un finto scaricatore del centro: il browser non esce mai dal centro.
 * Si salta dove manca il browser o l'interfaccia costruita. Con SHINKA_PROVA_IMMAGINI, lì restano
 * le immagini.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { test } from "node:test";
import { crc32, deflateSync } from "node:zlib";
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

/** Un PNG con una sfumatura di quel colore, per vedere come si dispone. */
function png(larghezza: number, altezza: number, [r, g, b]: [number, number, number]): Buffer {
  const blocco = (tipo: string, dati: Buffer): Buffer => {
    const lunghezza = Buffer.alloc(4);
    lunghezza.writeUInt32BE(dati.length);
    const corpo = Buffer.concat([Buffer.from(tipo, "latin1"), dati]);
    const controllo = Buffer.alloc(4);
    controllo.writeUInt32BE(crc32(corpo) >>> 0);
    return Buffer.concat([lunghezza, corpo, controllo]);
  };
  const testata = Buffer.alloc(13);
  testata.writeUInt32BE(larghezza, 0);
  testata.writeUInt32BE(altezza, 4);
  testata.set([8, 2, 0, 0, 0], 8);
  const righe = Buffer.alloc((larghezza * 3 + 1) * altezza);
  for (let y = 0; y < altezza; y += 1) {
    for (let x = 0; x < larghezza; x += 1) {
      const posto = y * (larghezza * 3 + 1) + 1 + x * 3;
      const luce = 0.55 + (0.45 * (x + y)) / (larghezza + altezza);
      righe.set([Math.round(r * luce), Math.round(g * luce), Math.round(b * luce)], posto);
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    blocco("IHDR", testata),
    blocco("IDAT", deflateSync(righe)),
    blocco("IEND", Buffer.alloc(0)),
  ]);
}

const FOTO: Record<string, Buffer> = {
  "https://esempio.org/tempio.png": png(640, 480, [40, 120, 90]),
  "https://esempio.org/m50.png": png(480, 640, [180, 90, 50]),
  "https://esempio.org/alberi.png": png(800, 450, [60, 90, 170]),
};

const RISPOSTA = [
  "Ecco tre tappe a Shanghai:",
  "",
  "1. ![Tempio del Buddha di Giada](https://esempio.org/tempio.png) **[Tempio del Buddha di Giada](https://maps.google.com/?q=Jade+Buddha+Temple)** · 1 ora  ",
  "   Tempio buddista attivo con due statue di giada bianca: si visita in fretta ed è vicino a Jing'an.",
  "2. ![M50](https://esempio.org/m50.png) **[M50](https://maps.google.com/?q=M50)** · 1-2 ore  ",
  "   Distretto artistico in vecchie fabbriche lungo il Suzhou Creek, con gallerie e murales.",
  "3. ![1000 Trees](https://esempio.org/sparita.png) **[1000 Trees](https://maps.google.com/?q=1000+Trees)** · 30 minuti  ",
  "   Il centro commerciale a forma di montagna, con alberi sulle terrazze.",
  "",
  "E una veduta d'insieme:",
  "",
  "![Il Bund di sera](https://esempio.org/alberi.png)",
].join("\n");

for (const [nome, larghezza] of [["largo", 1100], ["telefono", 390]] as const) {
  test(`le immagini nel testo di una risposta: schede, foto grande, foto che manca (${nome})`, { skip: salta, timeout: 120_000 }, async (t) => {
    const chieste: string[] = [];
    const banco = await allestisci(t, {
      cartellaWeb,
      immaginiEsterne: {
        leggi: async (indirizzo) => {
          chieste.push(indirizzo);
          const dati = FOTO[indirizzo];
          return dati === undefined ? { motivo: "Il sito ha risposto 404." } : { tipo: "image/png", dati };
        },
      },
    });
    banco.home.emetti({ tipo: "messaggio-proprietario", id: "m1", testo: "Cosa vedere a Shanghai?" });
    banco.home.emetti({ tipo: "turno-iniziato" });
    banco.home.emetti({ tipo: "testo-iniziato", idTesto: "t1" });
    banco.home.emetti({ tipo: "testo-concluso", idTesto: "t1", testo: RISPOSTA });
    banco.home.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 5 });
    await banco.centro.listen({ host: "127.0.0.1", port: 0 });
    const porta = (banco.centro.server.address() as AddressInfo).port;
    const browser = await chromium.launch({
      chromiumSandbox: disponibile?.recinto !== false,
      ...(disponibile?.canale === undefined ? {} : { channel: disponibile.canale }),
      ...(disponibile?.eseguibile === undefined ? {} : { executablePath: disponibile.eseguibile }),
    });
    t.after(() => browser.close());
    const cartellaImmagini = process.env.SHINKA_PROVA_IMMAGINI;
    if (cartellaImmagini !== undefined) await mkdir(cartellaImmagini, { recursive: true });
    const contesto = await browser.newContext({
      viewport: { width: larghezza, height: 900 },
      ...(nome === "telefono" ? { hasTouch: true, isMobile: true, colorScheme: "dark" as const } : {}),
    });
    const pagina = await contesto.newPage();
    // Il browser non chiede nulla fuori dal centro.
    const fuori: string[] = [];
    pagina.on("request", (richiesta) => {
      if (!richiesta.url().startsWith(`http://127.0.0.1:${porta}/`)) fuori.push(richiesta.url());
    });
    const fotografa = async (quale: string) => {
      if (cartellaImmagini === undefined) return;
      await pagina.waitForTimeout(300);
      await pagina.screenshot({ path: join(cartellaImmagini, `immagini-${quale}-${nome}.png`) });
    };
    await pagina.goto(`http://127.0.0.1:${porta}/`);
    await pagina.fill("#password", PASSWORD);
    await pagina.click('button[type="submit"]');
    await pagina.getByText("Ecco tre tappe a Shanghai:").waitFor();

    const voci = pagina.locator(".riga li.con-immagine");
    assert.equal(await voci.count(), 3);
    // Le due foto che ci sono si caricano; quella che manca sparisce e lascia il testo.
    await pagina.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>(".con-immagine img")].filter((img) => img.complete && img.naturalWidth > 0).length === 2);
    await pagina.waitForFunction(() => document.querySelectorAll(".con-immagine img").length === 2);
    assert.equal(await voci.nth(2).locator("img").count(), 0);
    assert.match((await voci.nth(2).textContent()) ?? "", /1000 Trees · 30 minuti/);

    // Nella scheda la foto sta a sinistra del nome e della descrizione, in piccolo.
    const foto = await voci.nth(0).locator("img").boundingBox();
    const titolo = await voci.nth(0).getByRole("link", { name: "Tempio del Buddha di Giada" }).boundingBox();
    const descrizione = await voci.nth(0).getByText(/Tempio buddista attivo/).boundingBox();
    assert.ok(foto !== null && titolo !== null && descrizione !== null);
    assert.ok(foto.width <= 150 && foto.height <= 115, `${foto.width}×${foto.height}`);
    assert.ok(titolo.x >= foto.x + foto.width, "il nome sta a destra della foto");
    assert.ok(titolo.y < foto.y + foto.height, "il nome sta accanto alla foto, non sotto");
    // La voce dopo comincia sotto la foto: le schede non si accavallano.
    const seconda = await voci.nth(1).boundingBox();
    assert.ok(seconda !== null && seconda.y >= foto.y + foto.height, `${seconda?.y} ≥ ${foto.y + foto.height}`);

    // Un'immagine da sola si vede grande, senza uscire dalla colonna.
    const grande = await pagina.locator(".riga p.solo-immagini img").boundingBox();
    assert.ok(grande !== null && grande.width > 200 && grande.width <= larghezza, `${grande?.width}`);
    // La pagina non scorre di lato.
    assert.equal(await pagina.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await fotografa("schede");

    // Un tocco la apre a tutto schermo, e si richiude.
    await voci.nth(1).getByRole("button", { name: /Apri l'immagine: M50/ }).click();
    const visore = pagina.getByRole("dialog", { name: "Immagine" });
    await visore.waitFor();
    await fotografa("visore");
    await visore.getByRole("button", { name: "Chiudi" }).click();
    await visore.waitFor({ state: "detached" });

    assert.deepEqual(fuori, []);
    assert.deepEqual([...new Set(chieste)].sort(), [...Object.keys(FOTO), "https://esempio.org/sparita.png"].sort());
  });
}
