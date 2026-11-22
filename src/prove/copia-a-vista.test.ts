/**
 * Prova a vista della copia di sicurezza (ADR 0042), in un browser vero davanti a due centri di
 * prova: nel primo si prepara e si scarica una copia; nel secondo la si carica, la si apre con la
 * sua password, si portano memoria e una skill, e si chiede il ripristino. Si salta dove manca il
 * browser o l'interfaccia costruita. Con SHINKA_PROVA_IMMAGINI, lì restano le immagini.
 */

import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { chromium } from "playwright-core";
import { applicaRipristino } from "../centro/copia-di-sicurezza.ts";
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

const DELLA_COPIA = "la password della copia";

for (const [nome, larghezza] of [["largo", 1280], ["telefono", 390]] as const) {
  test(`copia di sicurezza: scaricata, caricata altrove, trasloco e ripristino (${nome})`, { skip: salta, timeout: 120_000 }, async (t) => {
    const casa = await allestisci(t, { cartellaWeb });
    await casa.memoria.annota("Preferisce le risposte brevi.");
    await casa.skill.salva({ nome: "backup-foto", descrizione: "Quando serve copiare le foto.", contenuto: "1. Monta il disco.", motivo: "prova" }, "prova");
    await casa.skill.salva({ nome: "aggiorna-esxi", descrizione: "Quando c'è da aggiornare ESXi.", contenuto: "Passi.", motivo: "prova" }, "prova");
    const lavoro = await allestisci(t, { cartellaWeb });
    await lavoro.memoria.annota("Una voce del lavoro.");
    const scaricati = mkdtempSync(join(tmpdir(), "shinka-copia-vista-"));
    t.after(() => rm(scaricati, { recursive: true, force: true }));
    const browser = await chromium.launch({
      chromiumSandbox: disponibile?.recinto !== false,
      ...(disponibile?.canale === undefined ? {} : { channel: disponibile.canale }),
      ...(disponibile?.eseguibile === undefined ? {} : { executablePath: disponibile.eseguibile }),
    });
    t.after(() => browser.close());
    const cartellaImmagini = process.env.SHINKA_PROVA_IMMAGINI;
    if (cartellaImmagini !== undefined) await mkdir(cartellaImmagini, { recursive: true });

    /** Entra in un centro e apre la sezione delle copie. */
    const apri = async (banco: typeof casa) => {
      await banco.centro.listen({ host: "127.0.0.1", port: 0 });
      const indirizzo = `http://127.0.0.1:${(banco.centro.server.address() as AddressInfo).port}`;
      const contesto = await browser.newContext({ viewport: { width: larghezza, height: 900 }, acceptDownloads: true });
      const pagina = await contesto.newPage();
      const sezione = pagina.locator(".copia-di-sicurezza");
      const entra = async () => {
        await pagina.goto(`${indirizzo}/`);
        await pagina.fill("#password", PASSWORD);
        await pagina.click('button[type="submit"]');
        await pagina.locator("form.scrittura textarea").waitFor();
        await pagina.goto(`${indirizzo}/#/impostazioni`);
        await sezione.getByRole("heading", { name: "Copia di sicurezza", exact: true }).waitFor();
      };
      await entra();
      const fotografa = async (cosa: string) => {
        if (cartellaImmagini === undefined) return;
        await sezione.getByRole("heading", { name: "Carica una copia", exact: true }).scrollIntoViewIfNeeded();
        await pagina.waitForTimeout(300);
        await pagina.screenshot({ path: join(cartellaImmagini, `copia-${nome}-${cosa}.png`) });
      };
      return { pagina, sezione, fotografa, entra, contesto };
    };

    // A casa: la copia, con una password sua.
    const diCasa = await apri(casa);
    await diCasa.sezione.getByLabel("Password per questa copia").fill("corta");
    await diCasa.sezione.getByText("Almeno 10 caratteri.").waitFor();
    await diCasa.sezione.getByLabel("Password per questa copia").fill(DELLA_COPIA);
    await diCasa.sezione.getByLabel("Ripeti la password").fill(DELLA_COPIA);
    const [scaricato] = await Promise.all([diCasa.pagina.waitForEvent("download"), diCasa.sezione.getByRole("button", { name: "Prepara e scarica" }).click()]);
    assert.match(scaricato.suggestedFilename(), /^shinka-copia-.*\.shinka$/);
    const file = join(scaricati, scaricato.suggestedFilename());
    await scaricato.saveAs(file);
    await diCasa.sezione.getByText("La copia è pronta").waitFor();
    await diCasa.fotografa("scaricata");

    // Al lavoro: caricata, aperta con la sua password, e da lì memoria e una skill.
    const alLavoro = await apri(lavoro);
    const [scelta] = await Promise.all([alLavoro.pagina.waitForEvent("filechooser"), alLavoro.sezione.getByRole("button", { name: "Scegli il file…" }).click()]);
    await scelta.setFiles(file);
    await alLavoro.sezione.getByLabel("La password di questa copia").fill("non è questa qui");
    await alLavoro.sezione.getByRole("button", { name: "Apri la copia" }).click();
    await alLavoro.sezione.getByText("La password non apre questa copia.").waitFor();
    await alLavoro.sezione.getByLabel("La password di questa copia").fill(DELLA_COPIA);
    await alLavoro.sezione.getByRole("button", { name: "Apri la copia" }).click();
    await alLavoro.sezione.getByText("1 voce di memoria, 2 skill").waitFor();
    await alLavoro.sezione.getByText("1 voce che qui non c'è").waitFor();
    await alLavoro.fotografa("aperta");
    await alLavoro.sezione.locator("label.scelta", { hasText: "backup-foto" }).getByRole("checkbox").uncheck();
    await alLavoro.sezione.getByRole("button", { name: "Porta qui" }).click();
    await alLavoro.sezione.getByText("Portate 1 voce di memoria e 1 skill.").waitFor();
    assert.deepEqual(lavoro.memoria.voci().map((voce) => voce.testo), ["Una voce del lavoro.", "Preferisce le risposte brevi."]);
    assert.deepEqual(lavoro.skill.elenco().map((skill) => skill.nome), ["aggiorna-esxi"]);
    await alLavoro.sezione.getByText("le sue voci qui ci sono già tutte").waitFor();
    await alLavoro.fotografa("trasloco");

    // Il ripristino: con la password di Shinka sbagliata non parte; con quella giusta il centro chiede di ripartire.
    await alLavoro.sezione.getByRole("button", { name: "Ripristina tutto…" }).click();
    const conferma = alLavoro.sezione.getByRole("alertdialog", { name: "Ripristinare tutti i dati dalla copia" });
    await conferma.getByLabel("Password di Shinka").fill("non è la password di Shinka");
    await conferma.getByRole("button", { name: "Ripristina", exact: true }).click();
    await alLavoro.sezione.getByText("La password di Shinka non è giusta.").waitFor();
    assert.deepEqual(lavoro.riavvii, []);
    await alLavoro.fotografa("conferma");
    await conferma.getByLabel("Password di Shinka").fill(PASSWORD);
    await conferma.getByRole("button", { name: "Ripristina", exact: true }).click();
    await alLavoro.sezione.getByText("Shinka si riavvia con i dati della copia").waitFor();
    assert.equal(lavoro.riavvii.length, 1);
    await alLavoro.fotografa("chiesto");

    // Ciò che il centro fa ripartendo. Le sessioni di prima non valgono più: si rientra, con la
    // password della copia, e la pagina dice com'è andata.
    assert.equal(applicaRipristino(lavoro.cartella)?.riuscito, true);
    await alLavoro.contesto.clearCookies();
    await alLavoro.entra();
    const esito = alLavoro.pagina.locator(".esito-ripristino");
    await esito.getByText("i dati sono stati ripristinati dalla copia").waitFor();
    await esito.getByRole("button", { name: "Elimina i dati di prima" }).click();
    await esito.getByRole("alertdialog").getByRole("button", { name: "Elimina" }).click();
    await esito.getByRole("button", { name: "Elimina i dati di prima" }).waitFor({ state: "detached" });
  });
}
