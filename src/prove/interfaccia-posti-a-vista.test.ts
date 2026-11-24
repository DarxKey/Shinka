/**
 * Prova a vista dell'interfaccia riscrivibile (ADR 0057), in un browser vero: un'estensione mette una
 * pagina in tre posti (barra destra, testata, pannello flottante), chiama con il ponte le API che ha
 * dichiarato e non le altre, mette un'etichetta accanto a un progetto, riceve il segnale di un comando
 * da tastiera, nasconde una parte; un altro riquadro, come l'anteprima di un progetto, non può usare il
 * ponte; spenta, sparisce; con «?senza-estensioni» non c'è. Poi la barra delle risorse del riferimento,
 * così com'è scritta lì. Si salta dove manca il browser o l'interfaccia costruita.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { chromium, type Page } from "playwright-core";
import { azioniDellaHome } from "../centro/strumenti-home.ts";
import { COOKIE_SESSIONE } from "../centro/centro.ts";
import { allestisci, PASSWORD, type Banco } from "./banco.ts";
import { browserDiProva } from "./browser-di-prova.ts";

const cartellaWeb = join(import.meta.dirname, "..", "..", "web", "dist");
const disponibile = browserDiProva();
const salta =
  disponibile === undefined
    ? "su questa macchina non c'è un browser per la prova"
    : !existsSync(join(cartellaWeb, "index.html"))
      ? "l'interfaccia non è costruita"
      : false;

/** Dice in quale posto sta, chiama un'API dichiarata e una no, mette un'etichetta, ascolta un segnale. */
const PAGINA = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<p id="dove">…</p><p id="risorse">…</p><p id="negata">…</p><p id="segnale">…</p>
<script>
shinka.alloStato(function (stato) {
  document.getElementById("dove").textContent = stato.posto + " " + stato.qui.tipo + " " + stato.client;
  if (stato.progetti[0]) shinka.etichette({ [stato.progetti[0].id]: "⚡ ok" });
});
shinka.get("/api/ambienti/centro/risorse").then(function (r) { document.getElementById("risorse").textContent = "cpu " + (typeof r.campione.cpu); }, function (e) { document.getElementById("risorse").textContent = "errore " + e.message; });
shinka.get("/api/uso").then(function () { document.getElementById("negata").textContent = "raggiunta"; }, function (e) { document.getElementById("negata").textContent = "negata " + e.stato; });
shinka.alSegnale("saluta", function () { document.getElementById("segnale").textContent = "salutato"; });
</script></body></html>`;

async function apri(t: TestContext): Promise<{ banco: Banco; pagina: Page; indirizzo: string; azioni: ReturnType<typeof azioniDellaHome> }> {
  const banco = await allestisci(t, { cartellaWeb });
  await banco.centro.listen({ host: "127.0.0.1", port: 0 });
  const azioni = azioniDellaHome({ ambienti: banco.ambienti, lavori: banco.lavori, proposte: banco.proposte, home: () => banco.casa, agisci: banco.agisci, interfaccia: banco.interfaccia });
  const indirizzo = `http://localhost:${(banco.centro.server.address() as AddressInfo).port}`;
  const browser = await chromium.launch({
    chromiumSandbox: disponibile?.recinto !== false,
    ...(disponibile?.canale === undefined ? {} : { channel: disponibile.canale }),
    ...(disponibile?.eseguibile === undefined ? {} : { executablePath: disponibile.eseguibile }),
  });
  t.after(() => browser.close());
  const pagina = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await pagina.goto(`${indirizzo}/`);
  await pagina.fill("#password", PASSWORD);
  await pagina.click('button[type="submit"]');
  await pagina.locator("form.scrittura textarea").waitFor();
  return { banco, pagina, indirizzo, azioni };
}

async function conferma(pagina: Page, nome: string): Promise<void> {
  const scheda = pagina.getByRole("group", { name: "Estensione dell'interfaccia da confermare" }).last();
  await scheda.waitFor();
  await scheda.getByRole("button", { name: "Conferma" }).click();
  await pagina.getByText(`Estensione dell'interfaccia accesa: ${nome}`).waitFor();
}

test("una pagina in tre posti usa il ponte con le API dichiarate; l'anteprima no; spenta sparisce", { skip: salta, timeout: 180_000 }, async (t) => {
  const { banco, pagina, indirizzo, azioni } = await apri(t);
  const progetto = await banco.lavori.crea("Videogioco", "centro", "Un gioco.");
  const proposta = await azioni.proponiInterfaccia({
    nome: "prova-posti",
    descrizione: "Una pagina in tre posti.",
    pagine: [{ id: "posti", titolo: "Posti", html: PAGINA, posti: [{ posto: "barra-destra" }, { posto: "testata" }, { posto: "flottante" }] }],
    api: ["GET /api/ambienti/*/risorse"],
    comandi: [{ etichetta: "Saluta", tasti: "Ctrl+Shift+Y", azione: { tipo: "segnale", nome: "saluta" } }],
    parti: [{ parte: "stato-progetto" }],
  });
  assert.equal(proposta.isError, undefined);
  // La scheda dice dove va la pagina e quali API userà.
  const scheda = pagina.getByRole("group", { name: "Estensione dell'interfaccia da confermare" });
  await scheda.getByText("GET /api/ambienti/*/risorse").waitFor();
  await scheda.getByText(/la barra a destra.*striscia sotto la testata.*pannello flottante/).waitFor();
  await scheda.getByText(/Nasconde il riquadro dello stato del progetto/).waitFor();
  await conferma(pagina, "prova-posti");

  // La barra a destra e la testata: ciascuna sa dove sta, chiama l'API dichiarata, non l'altra.
  const barra = pagina.frameLocator(".barra-destra iframe.riquadro-estensione");
  await barra.locator("#dove", { hasText: "barra-destra home web" }).waitFor();
  await barra.locator("#risorse", { hasText: "cpu number" }).waitFor();
  await barra.locator("#negata", { hasText: "negata 403" }).waitFor();
  const testata = pagina.frameLocator(".posto-testata iframe.riquadro-estensione");
  await testata.locator("#dove", { hasText: "testata home web" }).waitFor();
  // Il pannello flottante si apre dal suo pulsante.
  await pagina.getByRole("button", { name: "Pannello delle estensioni" }).click();
  await pagina.frameLocator(".flottante-pannello iframe.riquadro-estensione").locator("#dove", { hasText: "flottante home web" }).waitFor();

  // L'etichetta accanto al progetto, e il segnale del comando da tastiera.
  await pagina.locator(".laterale .etichetta-estensione", { hasText: "⚡ ok" }).waitFor();
  await pagina.keyboard.press("Control+Shift+KeyY");
  await barra.locator("#segnale", { hasText: "salutato" }).waitFor();

  // In un progetto la pagina sa dove sta, e lo stato del progetto è nascosto.
  banco.conversazioniLocali[0]?.emetti({ tipo: "stato-progetto", testo: "Appena cominciato." });
  await pagina.goto(`${indirizzo}/#/progetti/${progetto.id}`);
  await barra.locator("#dove", { hasText: "barra-destra progetto web" }).waitFor();
  await pagina.locator("form.scrittura textarea").waitFor();
  assert.equal(await pagina.locator("details.stato-progetto").count(), 0);

  // La barra si richiude, e la scelta resta.
  await pagina.getByRole("button", { name: "Chiudi la barra delle estensioni" }).click();
  assert.equal(await pagina.locator(".barra-destra iframe").count(), 0);
  await pagina.reload();
  await pagina.locator("form.scrittura textarea").waitFor();
  assert.equal(await pagina.locator(".barra-destra iframe").count(), 0);
  await pagina.getByRole("button", { name: "Apri la barra delle estensioni" }).click();
  await barra.locator("#risorse", { hasText: "cpu number" }).waitFor();

  // Un altro riquadro, come l'anteprima di un progetto, non ha risposta dal ponte.
  const senzaRisposta = await pagina.evaluate(
    () =>
      new Promise<string>((risolvi) => {
        const estraneo = document.createElement("iframe");
        estraneo.setAttribute("sandbox", "allow-scripts");
        estraneo.srcdoc = `<script>
          addEventListener("message", (e) => parent.postMessage({ esito: "risposto", tipo: e.data && e.data.shinka }, "*"));
          parent.postMessage({ shinka: "api", id: "x", metodo: "GET", percorso: "/api/ambienti/centro/risorse" }, "*");
          parent.postMessage({ shinka: "stato" }, "*");
        </script>`;
        addEventListener("message", (e) => {
          if (e.source === estraneo.contentWindow && (e.data as { esito?: string }).esito === "risposto") risolvi("risposto");
        });
        document.body.append(estraneo);
        setTimeout(() => risolvi("nessuna risposta"), 2000);
      }),
  );
  assert.equal(senzaRisposta, "nessuna risposta");

  // Le richieste fatte per l'estensione sono nel registro, con il suo nome.
  const cookie = await banco.entra();
  const registro = (await banco.centro.inject({ method: "GET", url: "/api/sicurezza", cookies: { [COOKIE_SESSIONE]: cookie } })).json() as { voci: { tipo: string; dettaglio?: string }[] };
  assert.ok(registro.voci.some((voce) => voce.tipo === "richiesta-estensione" && voce.dettaglio === "«prova-posti» GET /api/ambienti/centro/risorse"));

  // Spenta, sparisce subito: barra, testata, pannello flottante, etichetta; lo stato del progetto torna.
  const id = banco.interfaccia.stato().estensioni[0]?.id ?? "";
  await banco.interfaccia.accendi(id, false);
  await pagina.locator(".barra-destra").waitFor({ state: "detached" });
  assert.equal(await pagina.locator(".posto-testata, .flottante, .etichetta-estensione").count(), 0);
  await pagina.locator("details.stato-progetto").waitFor();
  // Riaccesa, con «?senza-estensioni» l'interfaccia è pulita.
  await banco.interfaccia.accendi(id, true);
  await pagina.locator(".barra-destra").waitFor();
  await pagina.goto(`${indirizzo}/?senza-estensioni#/progetti/${progetto.id}`);
  await pagina.locator("form.scrittura textarea").waitFor();
  assert.equal(await pagina.locator(".barra-destra, .posto-testata, .flottante").count(), 0);
});

test("la barra delle risorse del riferimento funziona così com'è scritta", { skip: salta, timeout: 120_000 }, async (t) => {
  const { pagina, azioni } = await apri(t);
  const riferimento = readFileSync(join(import.meta.dirname, "..", "..", "docs", "estensioni-interfaccia.md"), "utf8");
  const html = /## Esempio[\s\S]*?```html\n([\s\S]*?)```/.exec(riferimento)?.[1];
  assert.ok(html !== undefined, "il riferimento ha l'esempio");
  const proposta = await azioni.proponiInterfaccia({
    nome: "barra-risorse",
    descrizione: "Processore, memoria, disco e GPU dell'ambiente su cui si lavora.",
    pagine: [{ id: "risorse", titolo: "Risorse", posti: [{ posto: "barra-destra" }], html }],
    api: ["GET /api/ambienti/*/risorse"],
  });
  assert.equal(proposta.isError, undefined);
  await conferma(pagina, "barra-risorse");
  const barra = pagina.frameLocator(".barra-destra iframe.riquadro-estensione");
  await barra.locator("#ambiente", { hasText: "Unraid" }).waitFor();
  await barra.getByText("Processore").waitFor({ timeout: 15_000 });
  await barra.getByText("Memoria").waitFor();
  await barra.getByText(/GPU: questo ambiente non la dice|%/).first().waitFor();
  if (process.env.SHINKA_PROVA_IMMAGINI !== undefined) await pagina.screenshot({ path: join(process.env.SHINKA_PROVA_IMMAGINI, "barra-risorse.png") });
});
