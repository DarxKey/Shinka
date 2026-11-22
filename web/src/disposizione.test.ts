import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { chromium } from "playwright-core";
import { browserDiProva } from "../../src/prove/browser-di-prova.ts";

/**
 * La disposizione della chat, misurata in un browser vero con lo stile vero: una conversazione
 * lunga deve scorrere dentro il suo riquadro, e il campo di scrittura deve restare sullo schermo.
 * Dall'incremento 8 nelle pagine dei progetti non era così, e nessun test lo guardava.
 */

const browser = browserDiProva();

const righe = Array.from({ length: 200 }, (_, i) => `<div class="riga claude">Riga ${i + 1} di una conversazione lunga.</div>`).join("");
const chat = (classe: string): string =>
  `<div class="${classe}">
    <header class="testata"><h1>Titolo</h1></header>
    ${classe.includes("con-stato") ? '<div class="stato-progetto">Stato del progetto</div>' : ""}
    <div class="conversazione">${righe}</div>
    <form class="scrittura"><textarea rows="1"></textarea><button type="submit">Invia</button></form>
  </div>`;

/** Le pagine come le compone il guscio: la Home da sola, un progetto dentro il contenitore che affianca il pannello. */
const PAGINE: Record<string, string> = {
  "la Home": chat("app"),
  "un progetto": `<div class="affiancati">${chat("app")}</div>`,
  "un progetto con lo stato": `<div class="affiancati">${chat("app con-stato")}</div>`,
  "un progetto con il pannello aperto": `<div class="affiancati aperto">${chat("app")}<aside class="affianco"></aside></div>`,
};

const SCHERMI = [
  { nome: "telefono", width: 375, height: 812 },
  { nome: "computer", width: 1280, height: 800 },
];

test("una conversazione lunga scorre nel suo riquadro, e il campo di scrittura resta sullo schermo", { skip: browser === undefined ? "su questa macchina non c'è un browser" : false }, async (t) => {
  assert.ok(browser);
  const stile = await readFile(new URL("./stile.css", import.meta.url), "utf8");
  const aperto = await chromium.launch({
    headless: true,
    chromiumSandbox: browser.recinto,
    ...(browser.canale === undefined ? {} : { channel: browser.canale }),
    ...(browser.eseguibile === undefined ? {} : { executablePath: browser.eseguibile }),
  });
  t.after(() => aperto.close());

  for (const schermo of SCHERMI) {
    const pagina = await aperto.newPage({ viewport: { width: schermo.width, height: schermo.height } });
    for (const [nome, corpo] of Object.entries(PAGINE)) {
      await pagina.setContent(
        `<!doctype html><html><head><style>${stile}</style></head><body><div id="radice"><div class="guscio"><nav class="laterale"></nav><main class="principale">${corpo}</main></div></div></body></html>`,
      );
      const misure = await pagina.evaluate(() => {
        const conversazione = document.querySelector(".conversazione");
        const campo = document.querySelector(".scrittura");
        if (conversazione === null || campo === null) throw new Error("pagina di prova senza chat");
        conversazione.scrollTop = conversazione.scrollHeight;
        return {
          alta: conversazione.clientHeight,
          contenuto: conversazione.scrollHeight,
          scorsa: conversazione.scrollTop,
          fondoDelCampo: campo.getBoundingClientRect().bottom,
          finestra: window.innerHeight,
        };
      });
      const dove = `${nome}, ${schermo.nome}: ${JSON.stringify(misure)}`;
      assert.ok(misure.alta > 100, `la conversazione ha un riquadro suo (${dove})`);
      assert.ok(misure.alta < misure.finestra, `la conversazione sta nello schermo (${dove})`);
      assert.ok(misure.contenuto > misure.alta, `il contenuto è più lungo del riquadro (${dove})`);
      assert.ok(misure.scorsa > 0, `la conversazione scorre fino in fondo (${dove})`);
      assert.ok(misure.fondoDelCampo <= misure.finestra + 1, `il campo di scrittura resta sullo schermo (${dove})`);
    }
    await pagina.close();
  }
});
