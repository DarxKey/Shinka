/**
 * Prova a vista della seconda parte del gruppo C, in un browser vero davanti a un centro con
 * conversazioni finte: la scheda della sessione (contesto, attività con la loro uscita, modifiche
 * da rivedere), l'avviso al 75% del contesto con "Compatta adesso", e due conversazioni affiancate
 * sullo schermo largo. Si salta dove manca il browser o l'interfaccia costruita. Con
 * SHINKA_PROVA_IMMAGINI, in quella cartella restano le immagini.
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
  test(`scheda della sessione, avviso del contesto e vista affiancata (${nome})`, { skip: salta, timeout: 120_000 }, async (t) => {
    const banco = await allestisci(t, { cartellaWeb });
    const progetto = await banco.lavori.crea("Videogioco", "centro", "Un gioco di piattaforme.");
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
      await pagina.screenshot({ path: join(cartellaImmagini, `c2-${nome}-${cosa}.png`) });
    };
    await pagina.goto(`${indirizzo}/`);
    await pagina.fill("#password", PASSWORD);
    await pagina.click('button[type="submit"]');
    await pagina.locator("form.scrittura textarea").waitFor();
    await pagina.goto(`${indirizzo}/#/progetti/${progetto.id}`);
    await finche(() => banco.conversazioniLocali.length === 1, "il progetto apre la sua conversazione");
    const conversazione = banco.conversazioniLocali[0];
    assert.ok(conversazione !== undefined);
    await pagina.getByRole("heading", { name: "Videogioco" }).waitFor();

    // Il turno del brief finisce; il contesto è quasi pieno; un comando e un agente lavorano.
    conversazione.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 5 });
    conversazione.emetti({
      tipo: "stato",
      stato: {
        modello: "claude-opus-5-5",
        contesto: {
          usati: 780_000,
          massimo: 1_000_000,
          percento: 78,
          parti: [
            { nome: "Istruzioni di sistema", token: 12_000, genere: "usato" },
            { nome: "Messaggi", token: 768_000, genere: "usato" },
            { nome: "Riserva per la compattazione", token: 33_000, genere: "riserva" },
            { nome: "Spazio libero", token: 187_000, genere: "libero" },
          ],
        },
      },
    });
    conversazione.emetti({
      tipo: "attivita",
      attivita: [
        { id: "a1", genere: "agente", tipoAgente: "Explore", descrizione: "Cerca dove si salta", stato: "in-corso", inSfondo: false, ultimoStrumento: "Grep", strumentiUsati: 4 },
        { id: "c1", genere: "comando", descrizione: "npm test", stato: "finita", inSfondo: true, riassunto: "Finito (codice 0)", conUscita: true },
      ],
    });
    conversazione.uscite.set("c1", "✔ 42 test superati");
    conversazione.emetti({ tipo: "modifiche", idTurno: "t1", file: [{ percorso: "src/salto.ts", aggiunte: 3, tolte: 1, stato: "cambiato" }] });

    // L'avviso del contesto: "Compatta adesso" manda /compact.
    const avviso = pagina.locator(".avviso-contesto");
    await avviso.getByText("Il contesto è pieno al 78%").waitFor();
    await fotografa("avviso");
    await avviso.getByRole("button", { name: "Compatta adesso" }).click();
    await finche(() => conversazione.inviati.at(-1) === "/compact", "parte /compact");
    await avviso.waitFor({ state: "detached" });
    conversazione.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 5 });

    // La scheda della sessione.
    await pagina.getByLabel("Sessione: un'attività in corso").waitFor();
    await pagina.locator(".menu-sessione > summary").click();
    const scheda = pagina.locator(".scheda-sessione");
    await scheda.getByText("claude-opus-5-5").waitFor();
    await scheda.getByText("Contesto: 78%").waitFor();
    await scheda.getByText("Riserva per la compattazione").waitFor();
    // Le cartelle collegate di un progetto in altri ambienti: qui nessuna, e nessun altro ambiente acceso.
    await scheda.getByText("Cartelle collegate").waitFor();
    await scheda.getByText("Nessuna: il progetto lavora solo nel suo ambiente.").waitFor();
    await scheda.getByText("Un file cambiato.").waitFor();
    await scheda.locator(".attivita.in-corso", { hasText: "Cerca dove si salta" }).getByText("ora: Grep").waitFor();
    await scheda.locator(".attivita", { hasText: "npm test" }).getByRole("button", { name: "Mostra l'uscita" }).click();
    await scheda.getByText("✔ 42 test superati").waitFor();
    await fotografa("sessione");
    await scheda.getByRole("button", { name: "Apri il pannello" }).click();
    await pagina.locator(".pannello-modifiche").getByText("src/salto.ts").waitFor();
    await pagina.getByRole("button", { name: "Chiudi il pannello e torna alla chat" }).click();

    // La vista affiancata, solo sullo schermo largo: la Home accanto al progetto.
    if (larghezza >= 1100) {
      await pagina.locator(".menu-affianca > summary").click();
      await pagina.getByRole("button", { name: "Affianca Home" }).click();
      const seconda = pagina.locator(".chat-affiancata");
      await seconda.getByRole("heading", { name: "Home" }).waitFor();
      await seconda.locator("form.scrittura textarea").fill("Ciao dalla vista affiancata");
      await seconda.locator("form.scrittura button[type=submit]").click();
      await finche(() => banco.home.inviati.includes("Ciao dalla vista affiancata"), "il messaggio arriva alla Home");
      await fotografa("affiancata");
      await seconda.getByRole("button", { name: "Chiudi la conversazione affiancata" }).click();
      await seconda.waitFor({ state: "detached" });
    } else {
      assert.equal(await pagina.locator(".menu-affianca").isVisible(), false);
    }
  });
}
