/**
 * Prova a vista della scelta di estensioni e skill di partenza nella scheda di una proposta di
 * progetto: l'interfaccia costruita, in un browser vero, davanti a un centro con conversazioni
 * finte e tre estensioni accese. Il proprietario trova spuntate le consigliate, ne cambia, vede la
 * skill seguire le sue scelte, e conferma. Si salta dove manca il browser o l'interfaccia costruita.
 * Con SHINKA_PROVA_IMMAGINI, in quella cartella restano le immagini.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { test } from "node:test";
import { chromium } from "playwright-core";
import type { PreparazioneDelProgetto } from "../protocollo/avvio-progetto.ts";
import type { RichiestaEstensione } from "../centro/estensioni.ts";
import { allestisci, finche, PASSWORD } from "./banco.ts";
import { browserDiProva } from "./browser-di-prova.ts";
import { repositoryDiProva } from "./plugin-di-prova.ts";

const cartellaWeb = join(import.meta.dirname, "..", "..", "web", "dist");
const disponibile = browserDiProva();
const salta =
  disponibile === undefined
    ? "su questa macchina non c'è un browser per la prova"
    : !existsSync(join(cartellaWeb, "index.html"))
      ? "l'interfaccia non è costruita"
      : false;

test(
  "nella scheda il proprietario sceglie le estensioni del progetto e la skill con cui comincia",
  { skip: salta, timeout: 90_000 },
  async (t) => {
    const { repository } = await repositoryDiProva(t);
    const preparate: PreparazioneDelProgetto[][] = [];
    const banco = await allestisci(t, {
      cartellaWeb,
      estensioni: { accettaRepository: (indirizzo) => indirizzo === repository },
      preparaProgetto: async (_cartella, preparazioni) => {
        preparate.push([...preparazioni]);
        return preparazioni.map((p) => ({ tipo: p.tipo, riuscita: true, testo: "Indexed 0 files" }));
      },
    });
    const estensioni = banco.estensioni;
    assert.ok(estensioni);
    const accendi = async (richiesta: RichiestaEstensione) => {
      const proposta = await estensioni.proponi(richiesta);
      assert.ok("idProposta" in proposta);
      assert.equal((await estensioni.conferma(proposta.idProposta))?.stato, "accesa");
    };
    await accendi({ nome: "mattpocock-skills", descrizione: "Le skill di Matt Pocock.", idAmbiente: "centro", definizione: { tipo: "plugin", repository }, chiavi: [] });
    await accendi({
      nome: "codegraph",
      descrizione: "Il grafo del codice.",
      idAmbiente: "centro",
      definizione: { tipo: "mcp-locale", comando: "npx", argomenti: ["-y", "@colbymchenry/codegraph@1.6.2", "serve", "--mcp"], variabili: {} },
      chiavi: [],
    });
    await accendi({ nome: "codex-imagegen", descrizione: "Genera immagini.", idAmbiente: "centro", definizione: { tipo: "mcp-locale", comando: "node", argomenti: ["immagini.js"], variabili: {} }, chiavi: [] });
    await estensioni.guarda("centro");

    await banco.centro.listen({ host: "127.0.0.1", port: 0 });
    const porta = (banco.centro.server.address() as AddressInfo).port;
    const browser = await chromium.launch({
      chromiumSandbox: disponibile?.recinto !== false,
      ...(disponibile?.canale === undefined ? {} : { channel: disponibile.canale }),
      ...(disponibile?.eseguibile === undefined ? {} : { executablePath: disponibile.eseguibile }),
    });
    t.after(() => browser.close());
    const pagina = await browser.newPage({ viewport: { width: 1100, height: 1000 }, colorScheme: "light" });
    const cartellaImmagini = process.env.SHINKA_PROVA_IMMAGINI;
    if (cartellaImmagini !== undefined) await mkdir(cartellaImmagini, { recursive: true });
    const fotografa = async (nome: string) => {
      if (cartellaImmagini === undefined) return;
      await pagina.waitForTimeout(400);
      await pagina.screenshot({ path: join(cartellaImmagini, `avvio-${nome}.png`), fullPage: true });
    };

    await pagina.goto(`http://127.0.0.1:${porta}/`);
    await pagina.fill("#password", PASSWORD);
    await pagina.click('button[type="submit"]');
    await pagina.locator("form.scrittura textarea").waitFor();

    banco.proposte.proponi({ nome: "Ricettario", brief: "Un'app per le ricette di casa, da usare dal telefono.", idAmbiente: "centro" });
    const scheda = pagina.locator(".estensioni-progetto");
    await scheda.waitFor();
    const casella = (nome: string) => scheda.locator("label", { hasText: nome }).locator("input");
    // Le consigliate sono già spuntate; le altre si scelgono; quelle installate per conto suo ci sono sempre.
    assert.equal(await casella("mattpocock-skills").isChecked(), true);
    assert.equal(await casella("codegraph").isChecked(), true);
    assert.equal(await casella("codex-imagegen").isChecked(), false);
    assert.equal(await casella("del-proprietario").isDisabled(), true);
    const comincia = pagina.getByLabel("Come comincia");
    assert.equal(await comincia.inputValue(), "grill-me");
    await pagina.getByText("Alla nascita del progetto Shinka ne costruisce l'indice").waitFor();
    await fotografa("scheda");

    // Con una cartella che esiste già la consigliata è grill-with-docs.
    await pagina.getByLabel("Cartella che esiste già").fill("/una/cartella");
    assert.equal(await comincia.inputValue(), "grill-with-docs");
    await pagina.getByLabel("Cartella che esiste già").fill("");

    // Senza il plugin delle skill il progetto comincia dal solo brief, e la scelta si spegne.
    await casella("mattpocock-skills").uncheck();
    assert.equal(await comincia.inputValue(), "nessuna");
    assert.equal(await comincia.isDisabled(), true);
    await casella("mattpocock-skills").check();
    await comincia.selectOption("grill-with-docs");
    await casella("codex-imagegen").check();
    await fotografa("scelte");

    await pagina.getByRole("button", { name: "Conferma" }).click();
    await pagina.waitForURL(/#\/progetti\//);
    const idProgetto = banco.progetti.elenco()[0]?.id ?? "";
    assert.deepEqual(banco.progetti.estensioni(idProgetto), ["codegraph", "mattpocock-skills", "codex-imagegen"]);
    const conversazione = banco.conversazioniLocali.at(-1);
    assert.ok(conversazione);
    await finche(() => conversazione.inviati.length === 1, "il primo messaggio parte dopo l'indice");
    assert.match(conversazione.inviati[0] ?? "", /^\/mattpocock-skills:grill-with-docs Un'app per le ricette/);
    assert.equal(preparate.length, 1);
    await pagina.getByText("L'indice di CodeGraph è pronto").waitFor();
    await fotografa("progetto");

    // Sul telefono, in tema scuro, la scheda di un'altra proposta.
    await pagina.goto(`http://127.0.0.1:${porta}/`);
    await pagina.emulateMedia({ colorScheme: "dark" });
    await pagina.setViewportSize({ width: 390, height: 844 });
    banco.proposte.proponi({ nome: "Altro", brief: "Un altro progetto.", idAmbiente: "centro" });
    await pagina.locator(".estensioni-progetto").last().scrollIntoViewIfNeeded();
    await fotografa("telefono");
  },
);
