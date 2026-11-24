/**
 * Le schermate del README: l'interfaccia vera davanti a un centro di prova con dati inventati, mai
 * quelli di un'installazione vera. Si lancia a mano, quando l'interfaccia cambia:
 *
 *   npm run costruisci && node src/prove/schermate-readme.ts
 *
 * Le immagini finiscono in `docs/schermate/`. Il browser è quello delle prove (vedi browser-di-prova.ts).
 */

import { mkdirSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { chromium, type Page } from "playwright-core";
import { allestisci, avviaNodoAccettato, finche, PASSWORD } from "./banco.ts";
import { browserDiProva } from "./browser-di-prova.ts";
import { chatDiProva } from "./chat-di-prova.ts";

const cartellaWeb = join(import.meta.dirname, "..", "..", "web", "dist");
const destinazione = join(import.meta.dirname, "..", "..", "docs", "schermate");
mkdirSync(destinazione, { recursive: true });

const disponibile = browserDiProva();
if (disponibile === undefined) throw new Error("Su questa macchina non c'è un browser per le schermate.");

// Il banco vuole il contesto di un test per pulire: qui basta raccogliere ciò che va chiuso alla fine.
const daChiudere: (() => unknown)[] = [];
const contesto = { after: (fai: () => unknown) => daChiudere.push(fai) } as unknown as Parameters<typeof allestisci>[0];

const banco = await allestisci(contesto, { cartellaWeb, estensioni: {} });
await banco.centro.listen({ host: "127.0.0.1", port: 0 });
await avviaNodoAccettato(contesto, banco);
const indirizzo = `http://localhost:${(banco.centro.server.address() as AddressInfo).port}`;

// I progetti, con la loro conversazione e lo stato.
const gioco = await banco.lavori.crea("Platformer", "centro", "A small 2D platformer for the browser.");
await finche(() => banco.conversazioniLocali.length === 1, "il progetto apre la sua conversazione");
const conversazione = banco.conversazioniLocali[0];
conversazione?.emetti({ tipo: "testo-concluso", idTesto: "g1", testo: "The level loader is done: three levels, read from `levels/*.json`, with the tests passing." });
conversazione?.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 42_000 });
conversazione?.emetti({ tipo: "stato-progetto", testo: "Levels load from JSON; next: enemies and the score." });
await banco.lavori.crea("Home network", "centro", "Scripts and notes for the home network.");
// Qualche estensione, inventata: un server MCP, un plugin e un'estensione dell'interfaccia.
const estensioni = banco.estensioni;
if (estensioni !== undefined) {
  for (const [nome, descrizione, argomenti] of [
    ["notes", "Search and write notes in the owner's notebook.", ["-y", "notes-mcp-server@2.1.0"]],
    ["browser", "Drive a headless browser for checks and screenshots.", ["-y", "browser-mcp@0.9.4"]],
  ] as const) {
    const proposta = await estensioni.proponi({ nome, descrizione, idAmbiente: "centro", definizione: { tipo: "mcp-locale", comando: "npx", argomenti: [...argomenti], variabili: {} }, chiavi: [] });
    if ("idProposta" in proposta) await estensioni.conferma(proposta.idProposta);
  }
}
const tema = banco.interfaccia.proponi(
  { nome: "neon", descrizione: "A neon accent and a page with the projects at a glance.", tema: ":root { --accento: #c026d3; }", pagine: [{ id: "glance", titolo: "At a glance", dove: "menu", html: "<p>…</p>" }], pulsanti: [{ etichetta: "Summarize", testo: "Summarize this conversation.", dove: "ovunque" }] },
  banco.canale,
);
await banco.interfaccia.conferma(tema);
await banco.interfaccia.accendi(banco.interfaccia.stato().estensioni[0]?.id ?? "", false);
chatDiProva(banco);


const browser = await chromium.launch({
  chromiumSandbox: disponibile.recinto !== false,
  ...(disponibile.canale === undefined ? {} : { channel: disponibile.canale }),
  ...(disponibile.eseguibile === undefined ? {} : { executablePath: disponibile.eseguibile }),
});

async function entra(pagina: Page): Promise<void> {
  await pagina.goto(`${indirizzo}/`);
  await pagina.fill("#password", PASSWORD);
  await pagina.click('button[type="submit"]');
  await pagina.locator("form.scrittura textarea").waitFor();
}

async function foto(pagina: Page, nome: string): Promise<void> {
  await pagina.waitForTimeout(400);
  await pagina.screenshot({ path: join(destinazione, `${nome}.png`) });
  console.log(`${nome}.png`);
}

try {
  for (const tema of ["light", "dark"] as const) {
    const pagina = await browser.newPage({ viewport: { width: 1280, height: 800 }, colorScheme: tema });
    await entra(pagina);
    await pagina.getByText("Approva").first().waitFor();
    await foto(pagina, `home-${tema}`);
    if (tema === "light") {
      await pagina.goto(`${indirizzo}/#/progetti/${gioco.id}`);
      await pagina.locator("details.stato-progetto").waitFor();
      await pagina.getByRole("button", { name: "File del progetto" }).click();
      await pagina.locator(".affianco").waitFor();
      await foto(pagina, "project");
      await pagina.goto(`${indirizzo}/#/estensioni`);
      await pagina.getByText("Nell'elenco di Shinka").waitFor();
      await foto(pagina, "extensions");
      await pagina.goto(`${indirizzo}/#/presentazione`);
      await pagina.getByText("Benvenuto in Shinka").waitFor();
      await foto(pagina, "tour");
    }
    await pagina.close();
  }
  // Sul telefono: la Home.
  const telefono = await browser.newPage({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, colorScheme: "dark" });
  await entra(telefono);
  await telefono.getByText("Approva").first().waitFor();
  await foto(telefono, "phone");
} finally {
  await browser.close();
  for (const fai of daChiudere.reverse()) await fai();
}
process.exit(0);
