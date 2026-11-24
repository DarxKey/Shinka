/**
 * Prova a vista della seconda parte del gruppo B, in un browser vero davanti a un centro con
 * conversazioni finte: un messaggio della Home mandato in un argomento nuovo, il menu "/"
 * senza la domanda a parte (ADR 0052), e lo stile delle risposte, scelto e creato da una descrizione. Si salta dove manca il
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

for (const [nome, larghezza] of [["largo", 1280], ["telefono", 390]] as const) {
  test(`argomento nuovo da un messaggio e stile delle risposte (${nome})`, { skip: salta, timeout: 120_000 }, async (t) => {
    const banco = await allestisci(t, { cartellaWeb });
    await banco.centro.listen({ host: "127.0.0.1", port: 0 });
    const indirizzo = `http://127.0.0.1:${(banco.centro.server.address() as AddressInfo).port}`;
    const browser = await chromium.launch({
      chromiumSandbox: disponibile?.recinto !== false,
      ...(disponibile?.canale === undefined ? {} : { channel: disponibile.canale }),
      ...(disponibile?.eseguibile === undefined ? {} : { executablePath: disponibile.eseguibile }),
    });
    t.after(() => browser.close());
    const pagina = await browser.newPage({ viewport: { width: larghezza, height: 860 } });
    const cartellaImmagini = process.env.SHINKA_PROVA_IMMAGINI;
    if (cartellaImmagini !== undefined) await mkdir(cartellaImmagini, { recursive: true });
    const fotografa = async (cosa: string) => {
      if (cartellaImmagini === undefined) return;
      await pagina.waitForTimeout(300);
      await pagina.screenshot({ path: join(cartellaImmagini, `b2-${nome}-${cosa}.png`) });
    };
    await pagina.goto(`${indirizzo}/`);
    await pagina.fill("#password", PASSWORD);
    await pagina.click('button[type="submit"]');
    const campo = pagina.locator("form.scrittura textarea");
    await campo.waitFor();

    // Sul telefono Invio va a capo: si manda con il pulsante, come farebbe il proprietario.
    const manda = async () => {
      await pagina.locator("form.scrittura button[type=submit]").click();
      // Il campo si svuota quando il centro ha accettato il messaggio.
      await pagina.waitForFunction(() => document.querySelector<HTMLTextAreaElement>("form.scrittura textarea")?.value === "");
    };
    const rispondi = (id: string, testo: string) => {
      banco.home.emetti({ tipo: "testo-iniziato", idTesto: id });
      banco.home.emetti({ tipo: "testo-concluso", idTesto: id, testo });
      banco.home.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 5 });
    };
    for (const [i, testo] of ["Dammi tre nomi per un gatto.", "Più corti."].entries()) {
      await campo.fill(testo);
      await manda();
      await finche(() => banco.home.inviati.length === i + 1, "il messaggio parte");
      rispondi(`t${i}`, `Risposta ${i + 1}: Micio, Fufi, Tom.`);
    }

    // La domanda a parte non c'è più (ADR 0052): il menu "/" non la propone.
    await campo.fill("/bt");
    assert.equal(await pagina.locator(".menu-comandi li", { hasText: "/btw" }).count(), 0);
    await campo.fill("");

    // Lo stile: sul telefono le scelte si aprono dal riassunto.
    if (larghezza < 860) await pagina.locator("button.apri-scelte").click();
    const stile = pagina.getByLabel("Stile", { exact: true });
    await stile.selectOption("conciso");
    await finche(() => banco.home.impostazioni.at(-1)?.stile?.id === "conciso", "lo stile arriva alla conversazione");
    await stile.selectOption({ label: "Nuovo stile…" });
    const gestione = pagina.locator(".gestione-stili");
    await gestione.getByLabel("Nome dello stile").fill("Pirata");
    await gestione.getByLabel("Descrizione dello stile").fill("Parla come un pirata.");
    await fotografa("nuovo-stile");
    await gestione.getByRole("button", { name: "Crea e usa qui" }).click();
    await finche(() => banco.home.impostazioni.at(-1)?.stile?.nome === "Pirata", "lo stile nuovo vale per la Home");
    assert.equal(await gestione.count(), 0);
    assert.equal(await stile.locator("option:checked").textContent(), "Stile: Pirata");
    assert.equal(banco.stili.elenco().at(-1)?.istruzioni, "Scrivi come «Pirata»: Parla come un pirata.");
    if (larghezza < 860) await pagina.locator("button.apri-scelte").click();

    // Un messaggio della Home in un argomento nuovo: quello di prima resta, archiviato.
    const diPrima = banco.home;
    const secondo = pagina.locator(".riga.proprietario").nth(1);
    await secondo.hover();
    await secondo.getByRole("button", { name: "Modifica" }).click();
    const modifica = pagina.locator(".modifica-messaggio");
    await modifica.getByRole("textbox").fill("Più lunghi.");
    await fotografa("modifica-ramo");
    await modifica.getByRole("button", { name: "In un argomento nuovo" }).click();
    await finche(() => diPrima.istruzioni.length === 1, "Claude intitola l'argomento di prima");
    banco.casa.richiediCambio({ titolo: "Nomi per il gatto", riassunto: "Tre nomi." });
    diPrima.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 1 });
    await finche(() => banco.conversazioniHome.length === 2 && banco.home.inviati.length === 1, "si apre il ramo");
    assert.deepEqual(diPrima.biforcazioni, ["m2"]);
    await pagina.getByText("Da qui un argomento nuovo, con la storia fin qui").waitFor();
    await pagina.getByRole("link", { name: "Nomi per il gatto" }).first().waitFor();
    // La storia di prima c'è, fino al messaggio cambiato; quello che veniva dopo no.
    await pagina.getByText("Dammi tre nomi per un gatto.").waitFor();
    assert.equal(await pagina.getByText("Più corti.").count(), 0);
    await pagina.getByText("Più lunghi.").waitFor();
    await fotografa("ramo");
  });
}
