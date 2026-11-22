/**
 * Prova a vista delle domande di Claude: l'interfaccia costruita, in un browser vero, davanti a un
 * centro con conversazioni finte. La Home pone due domande; il proprietario ne sceglie le risposte,
 * ne scrive una sua con "Altro", e le manda. Poi ne pone altre, che lui salta. Si salta dove manca
 * il browser o l'interfaccia costruita. Con SHINKA_PROVA_IMMAGINI, in quella cartella restano le immagini.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { test } from "node:test";
import { chromium } from "playwright-core";
import type { Domanda } from "../protocollo/eventi.ts";
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

const DOMANDE: Domanda[] = [
  {
    domanda: "Che tipo di viaggio vuoi fare a Tokyo?",
    intestazione: "Viaggio",
    opzioni: [
      { etichetta: "Negozi di carte (consigliata)", descrizione: "Akihabara, Nakano Broadway, Ikebukuro." },
      { etichetta: "Templi e giardini", descrizione: "Asakusa, Meiji Jingu, Shinjuku Gyoen." },
      { etichetta: "Cibo di strada", descrizione: "Ameyoko, Tsukiji, Omoide Yokocho." },
    ],
    piuScelte: false,
  },
  {
    domanda: "Che cosa vuoi nell'itinerario?",
    intestazione: "Contenuto",
    opzioni: [
      { etichetta: "Mappa", descrizione: "Un'immagine con le tappe." },
      { etichetta: "Orari", descrizione: "A che ora essere dove." },
      { etichetta: "Costi" },
    ],
    piuScelte: true,
  },
];

test(
  "il proprietario risponde alle domande di Claude dalla scheda, anche con una risposta sua, oppure le salta",
  { skip: salta, timeout: 90_000 },
  async (t) => {
    const banco = await allestisci(t, { cartellaWeb });
    await banco.centro.listen({ host: "127.0.0.1", port: 0 });
    const porta = (banco.centro.server.address() as AddressInfo).port;
    const browser = await chromium.launch({
      chromiumSandbox: disponibile?.recinto !== false,
      ...(disponibile?.canale === undefined ? {} : { channel: disponibile.canale }),
      ...(disponibile?.eseguibile === undefined ? {} : { executablePath: disponibile.eseguibile }),
    });
    t.after(() => browser.close());

    const pagina = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: "light" });
    const cartellaImmagini = process.env.SHINKA_PROVA_IMMAGINI;
    if (cartellaImmagini !== undefined) await mkdir(cartellaImmagini, { recursive: true });
    const fotografa = async (nome: string) => {
      if (cartellaImmagini === undefined) return;
      await pagina.waitForTimeout(400);
      await pagina.screenshot({ path: join(cartellaImmagini, `domande-${nome}.png`), fullPage: true });
    };

    await pagina.goto(`http://127.0.0.1:${porta}/`);
    await pagina.fill("#password", PASSWORD);
    await pagina.click('button[type="submit"]');
    await pagina.locator("form.scrittura textarea").waitFor();

    banco.home.invia("Organizzami un giro a Tokyo.");
    // L'azione dello strumento delle domande non compare: compare la sua scheda.
    banco.home.emetti({ tipo: "azione-iniziata", idAzione: "d1", strumento: "AskUserQuestion", ingresso: { questions: [] } });
    banco.home.emetti({ tipo: "domande-poste", idDomande: "d1", domande: DOMANDE });

    const scheda = pagina.locator("form.domande");
    await scheda.waitFor();
    assert.equal(await pagina.locator(".azione").count(), 0);
    const rispondi = scheda.getByRole("button", { name: "Rispondi" });
    assert.equal(await rispondi.isDisabled(), true);
    await fotografa("aperte");

    // Due risposte più una sua alla seconda; alla prima, "Altro" senza testo non è una risposta.
    await scheda.getByText("Mappa", { exact: true }).click();
    await scheda.getByText("Costi", { exact: true }).click();
    await scheda.locator("fieldset").nth(0).getByText("Altro", { exact: true }).click();
    assert.equal(await rispondi.isDisabled(), true);
    await scheda.getByText("Templi e giardini").click();
    await scheda.getByText("Negozi di carte (consigliata)").click();
    assert.equal(await rispondi.isDisabled(), false);
    // Con più scelte "Altro" si aggiunge alle altre.
    await scheda.locator("fieldset").nth(1).getByText("Altro", { exact: true }).click();
    await scheda.getByRole("textbox", { name: /La tua risposta: Che cosa vuoi/ }).fill("Dove mangiare vicino");
    await fotografa("scelte");
    await rispondi.click();

    await finche(() => banco.home.risposteAlleDomande.length === 1, "le risposte arrivano alla Home");
    assert.deepEqual(banco.home.risposteAlleDomande[0], [
      "d1",
      { tipo: "risposte", risposte: ["Negozi di carte (consigliata)", "Mappa, Costi, Dove mangiare vicino"] },
    ]);
    // La scheda chiusa ricorda le risposte.
    const chiusa = pagina.locator(".domande.chiuse");
    await chiusa.waitFor();
    assert.deepEqual(await chiusa.locator("dd").allTextContents(), ["Negozi di carte (consigliata)", "Mappa, Costi, Dove mangiare vicino"]);
    await fotografa("risposte");

    // Altre domande, saltate, su un telefono in tema scuro.
    await pagina.emulateMedia({ colorScheme: "dark" });
    await pagina.setViewportSize({ width: 390, height: 844 });
    banco.home.emetti({ tipo: "domande-poste", idDomande: "d2", domande: [DOMANDE[0] as Domanda] });
    const seconda = pagina.locator("form.domande");
    await seconda.waitFor();
    await fotografa("telefono-scuro");
    await seconda.getByRole("button", { name: "Salta" }).click();
    await finche(() => banco.home.risposteAlleDomande.length === 2, "il salto arriva alla Home");
    assert.deepEqual(banco.home.risposteAlleDomande[1], ["d2", { tipo: "saltate" }]);
    await pagina.getByText("Hai saltato le domande").waitFor();
    assert.equal(await pagina.locator("form.domande").count(), 0);
  },
);
