/**
 * Ricava le icone di Shinka dal disegno in `web/public/icona.svg`: l'icona per la schermata Home
 * dell'iPhone, quelle del manifest e il favicon. Le rende un browser vero, che legge l'SVG com'è;
 * ImageMagick ne fa solo il file .ico. Si lancia a mano, quando il disegno cambia:
 *
 *   npm run icone
 *
 * Il browser è quello delle prove (vedi browser-di-prova.ts).
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { browserDiProva } from "./browser-di-prova.ts";

const cartella = join(import.meta.dirname, "..", "..", "web", "public");
const disegno = readFileSync(join(cartella, "icona.svg"), "utf8");
// Alle misure piccole il disegno pieno si perde: lì vale quello semplificato, senza griglia né glitch.
const piccolo = readFileSync(join(cartella, "icona-piccola.svg"), "utf8");
const LATO_PICCOLO = 64;

/** Il lato in pixel e il file. iOS vuole un PNG quadrato e pieno: gli angoli li arrotonda lui. */
const ICONE: [number, string][] = [
  [180, "apple-touch-icon.png"],
  // Lo stesso, con il nome che iOS chiede da solo quando non trova altro.
  [180, "apple-touch-icon-precomposed.png"],
  [192, "icona-192.png"],
  [512, "icona-512.png"],
  [32, "favicon-32.png"],
  [16, "favicon-16.png"],
];

const browser = browserDiProva();
if (browser === undefined) throw new Error("Su questa macchina non c'è un browser per rendere le icone.");
const aperto = await chromium.launch({
  chromiumSandbox: browser.recinto,
  ...(browser.canale === undefined ? {} : { channel: browser.canale }),
  ...(browser.eseguibile === undefined ? {} : { executablePath: browser.eseguibile }),
});
try {
  for (const [lato, file] of ICONE) {
    const pagina = await aperto.newPage({ viewport: { width: lato, height: lato } });
    const svg = (lato <= LATO_PICCOLO ? piccolo : disegno).replace('width="512" height="512"', `width="${lato}" height="${lato}"`);
    await pagina.setContent(`<!doctype html><html><body style="margin:0">${svg}</body></html>`);
    await pagina.screenshot({ path: join(cartella, file) });
    await pagina.close();
    console.log(`${file}: ${lato}×${lato}`);
  }
} finally {
  await aperto.close();
}
// Il favicon classico, che i browser chiedono da soli alla radice.
execFileSync(process.platform === "win32" ? "magick" : "convert", [
  join(cartella, "favicon-16.png"),
  join(cartella, "favicon-32.png"),
  join(cartella, "favicon.ico"),
]);
console.log("favicon.ico: 16 e 32");
