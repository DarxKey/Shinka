/**
 * Prova a vista delle estensioni dell'interfaccia (ADR 0054), in un browser vero: la scheda della
 * Home, il tema che cambia un colore, la pagina nel menu che legge lo stato e manda un messaggio
 * attraverso il ponte, senza poter chiamare le API, il pulsante sopra il campo, e l'indirizzo
 * «?senza-estensioni». Si salta dove manca il browser o l'interfaccia costruita.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { test } from "node:test";
import { chromium } from "playwright-core";
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

/** Legge lo stato, prova a chiamare le API di Shinka (non deve riuscire), e manda un messaggio alla Home. */
const PAGINA = `<!doctype html><meta charset="utf-8"><title>Progetti</title>
<p id="quanti">…</p><p id="api">…</p><p id="mandato">…</p>
<script>
addEventListener("message", (e) => {
  if (e.data.shinka === "stato") document.getElementById("quanti").textContent = e.data.stato.progetti.length + " progetti, " + e.data.stato.qui.tipo;
  if (e.data.shinka === "mandato") document.getElementById("mandato").textContent = e.data.riuscito ? "mandato" : "no: " + e.data.motivo;
});
parent.postMessage({ shinka: "stato" }, "*");
fetch("/api/progetti").then(() => { document.getElementById("api").textContent = "API raggiunte"; }, () => { document.getElementById("api").textContent = "API chiuse"; });
setTimeout(() => parent.postMessage({ shinka: "manda", testo: "Come vanno i progetti?", dove: "home" }, "*"), 300);
</script>`;

test("un'estensione dell'interfaccia si conferma dalla scheda, e porta tema, pagina e pulsante", { skip: salta, timeout: 120_000 }, async (t) => {
  const banco = await allestisci(t, { cartellaWeb });
  await banco.centro.listen({ host: "127.0.0.1", port: 0 });
  await banco.lavori.crea("Videogioco", "centro", "Un gioco.");
  const azioni = azioniDellaHome({ ambienti: banco.ambienti, lavori: banco.lavori, proposte: banco.proposte, home: () => banco.casa, agisci: banco.agisci, interfaccia: banco.interfaccia });
  const indirizzo = `http://localhost:${(banco.centro.server.address() as AddressInfo).port}`;
  const browser = await chromium.launch({
    chromiumSandbox: disponibile?.recinto !== false,
    ...(disponibile?.canale === undefined ? {} : { channel: disponibile.canale }),
    ...(disponibile?.eseguibile === undefined ? {} : { executablePath: disponibile.eseguibile }),
  });
  t.after(() => browser.close());
  const pagina = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await pagina.goto(`${indirizzo}/`);
  await pagina.fill("#password", PASSWORD);
  await pagina.click('button[type="submit"]');
  await pagina.locator("form.scrittura textarea").waitFor();

  const risposta = await azioni.proponiInterfaccia({
    nome: "neon",
    descrizione: "Un accento fucsia, una pagina con i progetti e un pulsante.",
    tema: ":root, :root[data-tema] { --accento: rgb(255, 0, 170) !important; }",
    pagine: [{ id: "progetti", titolo: "I miei progetti", html: PAGINA }],
    pulsanti: [{ etichetta: "Che ore sono?", testo: "Dimmi che ore sono.", dove: "home" }],
  });
  assert.equal(risposta.isError, undefined);
  const scheda = pagina.getByRole("group", { name: "Estensione dell'interfaccia da confermare" });
  await scheda.waitFor();
  await scheda.getByText("Un foglio di stile di una riga").waitFor();
  await scheda.getByText("I miei progetti").waitFor();
  await scheda.getByText("Dimmi che ore sono.").waitFor();
  await scheda.getByRole("button", { name: "Conferma" }).click();
  await pagina.getByText("Estensione dell'interfaccia accesa: neon").waitFor();

  // Il tema cambia il colore d'accento.
  await pagina.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue("--accento").trim() === "rgb(255, 0, 170)");
  // Il pulsante sopra il campo manda il suo testo alla Home.
  await pagina.getByRole("button", { name: "Che ore sono?" }).click();
  await finche(() => banco.home.inviati.includes("Dimmi che ore sono."), "il pulsante manda il suo testo");
  banco.home.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 1 });

  // La pagina nel menu: legge lo stato, non raggiunge le API, manda un messaggio con il suo nome davanti.
  await pagina.locator(".menu-pagine > summary").click();
  await pagina.locator(".voci-pagine").getByRole("link", { name: "I miei progetti" }).click();
  const riquadro = pagina.frameLocator("iframe.riquadro-estensione");
  await riquadro.locator("#quanti", { hasText: "1 progetti, pagina" }).waitFor();
  await riquadro.locator("#api", { hasText: "API chiuse" }).waitFor();
  await riquadro.locator("#mandato", { hasText: "mandato" }).waitFor();
  assert.ok(banco.home.inviati.includes("[Dalla pagina «I miei progetti»] Come vanno i progetti?"), JSON.stringify(banco.home.inviati));
  // Lo stato arriva di nuovo quando cambia: un progetto in più.
  await banco.lavori.crea("Blog", "centro", "Un blog.");
  await riquadro.locator("#quanti", { hasText: "2 progetti, pagina" }).waitFor();

  // Con «?senza-estensioni» niente tema e niente pulsanti.
  await pagina.goto(`${indirizzo}/?senza-estensioni#/`);
  await pagina.locator("form.scrittura textarea").waitFor();
  assert.equal(await pagina.getByRole("button", { name: "Che ore sono?" }).count(), 0);
  assert.notEqual(await pagina.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accento").trim()), "rgb(255, 0, 170)");
});
