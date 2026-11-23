/**
 * Prova a vista degli incarichi (ADR 0051), in un browser vero davanti a un centro con conversazioni
 * finte: il proprietario sceglie chi implementa nella scheda della sessione, l'incarico compare tra
 * le attività, e il permesso che chiede si decide dalla chat del progetto. Si salta dove manca il
 * browser o l'interfaccia costruita. Con SHINKA_PROVA_IMMAGINI, in quella cartella restano le immagini.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
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

for (const [nome, larghezza] of [["largo", 1400], ["telefono", 390]] as const) {
  test(`chi implementa e un incarico nella chat del progetto (${nome})`, { skip: salta, timeout: 120_000 }, async (t) => {
    const banco = await allestisci(t, { cartellaWeb });
    const progetto = await banco.lavori.crea("Calcoli", "centro", "Una libreria di calcoli.");
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
      await pagina.screenshot({ path: join(cartellaImmagini, `incarichi-${nome}-${cosa}.png`) });
    };
    await pagina.goto(`${indirizzo}/`);
    await pagina.fill("#password", PASSWORD);
    await pagina.click('button[type="submit"]');
    await pagina.locator("form.scrittura textarea").waitFor();
    await pagina.goto(`${indirizzo}/#/progetti/${progetto.id}`);
    await finche(() => banco.conversazioniLocali.length === 1, "il progetto apre la sua conversazione");
    const guida = banco.conversazioniLocali[0];
    assert.ok(guida !== undefined);
    await pagina.getByRole("heading", { name: "Calcoli" }).waitFor();
    guida.emetti({
      tipo: "stato",
      stato: {
        modello: "claude-opus-5-5",
        modelli: [
          { valore: "opus", nome: "Opus", descrizione: "", impegni: ["low", "medium", "high", "xhigh", "max"] },
          { valore: "sonnet", nome: "Sonnet", descrizione: "", impegni: ["low", "medium", "high"] },
        ],
      },
    });

    // Nella scheda della sessione: nessuno implementa, poi il proprietario sceglie Sonnet con effort medio.
    await pagina.locator(".menu-sessione > summary").click();
    const scheda = pagina.locator(".scheda-sessione");
    const chi = scheda.locator(".chi-implementa");
    await chi.getByText("Nessuno: il progetto lavora con un modello solo.").waitFor();
    await chi.getByRole("button", { name: "Scegli chi implementa" }).click();
    await chi.getByLabel("Modello di chi implementa").selectOption("sonnet");
    await chi.getByLabel("Effort di chi implementa").selectOption("medium");
    await fotografa("scelta");
    await chi.getByRole("button", { name: "Salva" }).click();
    await chi.getByText("Sonnet · effort medio").waitFor();
    assert.deepEqual(banco.progetti.chiImplementa(progetto.id), { modello: "sonnet", impegno: "medium" });
    await finche(() => guida.annotazioni.some((nota) => nota.includes("ha scelto chi implementa: sonnet")), "chi guida lo viene a sapere");
    await fotografa("scelto");
    await pagina.locator(".menu-sessione > summary").click();

    // Chi guida affida un incarico: compare tra le attività, con il modello.
    guida.emetti({ tipo: "azione-iniziata", idAzione: "g1", strumento: "mcp__shinka__affida_incarico", ingresso: { incarico: "Scrivi somma", criteri: "npm test passa" } });
    const risposta = banco.comuniDelProgetto(progetto.id, "affida_incarico", { incarico: "Scrivi la funzione somma.", criteri: "npm test passa." });
    await finche(() => banco.conversazioniLocali.length === 2, "l'incarico apre la sua conversazione");
    const incarico = banco.conversazioniLocali[1];
    assert.ok(incarico !== undefined);
    incarico.emetti({ tipo: "azione-iniziata", idAzione: "i1", strumento: "Write", ingresso: { file_path: "src/somma.ts" } });
    await pagina.getByLabel("Sessione: un'attività in corso").waitFor();
    await pagina.locator(".menu-sessione > summary").click();
    await scheda.locator(".attivita.in-corso", { hasText: "Scrivi la funzione somma." }).getByText("ora: Write").waitFor();
    await fotografa("attivita");
    await pagina.locator(".menu-sessione > summary").click();

    // Il permesso di chi implementa si decide dalla chat del progetto.
    incarico.emetti({ tipo: "permesso-richiesto", idPermesso: "p1", idAzione: "i2", strumento: "Bash", ingresso: { command: "npm test" } });
    const richiesta = pagina.locator(".permesso", { hasText: "Lo chiede sonnet, impegno medium, che svolge un incarico." });
    await richiesta.waitFor();
    await fotografa("permesso");
    await richiesta.getByRole("button", { name: "Approva" }).click();
    await finche(() => incarico.decisioni.length === 1, "la decisione arriva all'incarico");
    assert.deepEqual(incarico.decisioni, [["p1", "approvato"]]);
    incarico.emetti({ tipo: "azione-conclusa", idAzione: "i2", esito: "3 test superati", errore: false });

    incarico.emetti({ tipo: "testo-concluso", idTesto: "x", testo: "Fatto: somma in src/somma.ts, 3 test su 3." });
    incarico.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 1000, token: { ingresso: 5000, uscita: 400 } });
    const esito = await risposta;
    assert.equal(esito.errore, undefined, esito.testo);
    guida.emetti({ tipo: "azione-conclusa", idAzione: "g1", esito: esito.testo, errore: false });
    await pagina.locator(".menu-sessione > summary").click();
    await scheda.locator(".attivita", { hasText: "Scrivi la funzione somma." }).getByText(/Concluso da sonnet/).waitFor();
    await fotografa("finito");
  });
}
