/**
 * Prova a vista dell'indicatore di attività: l'interfaccia costruita, in un browser vero, davanti
 * a un centro con conversazioni finte. Si salta dove manca il browser o l'interfaccia costruita
 * (`npm run costruisci`). Con SHINKA_PROVA_IMMAGINI, in quella cartella restano le immagini della
 * chat: tema chiaro, tema scuro e telefono.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { test } from "node:test";
import { chromium } from "playwright-core";
import { CAMBIO_PAROLA_MS, PAROLE_BUFFE } from "../../web/src/parole-buffe.ts";
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

test(
  "mentre Claude lavora la chat mostra una parola buffa che cambia, e alla risposta sparisce",
  { skip: salta, timeout: 60_000 },
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
    const pagina = await browser.newPage({ viewport: { width: 1100, height: 700 }, colorScheme: "light" });

    const cartellaImmagini = process.env.SHINKA_PROVA_IMMAGINI;
    if (cartellaImmagini !== undefined) await mkdir(cartellaImmagini, { recursive: true });
    const fotografa = async (nome: string) => {
      if (cartellaImmagini === undefined) return;
      // Il tempo che la parola affiori e che la pagina si assesti dopo un cambio di misura.
      await pagina.waitForTimeout(700);
      if (cartellaImmagini !== undefined) await pagina.screenshot({ path: join(cartellaImmagini, `${nome}.png`) });
    };

    await pagina.goto(`http://127.0.0.1:${porta}/`);
    await pagina.fill("#password", PASSWORD);
    await pagina.click('button[type="submit"]');

    const attesa = pagina.locator(".attesa-risposta");
    const campo = pagina.locator("form.scrittura textarea");
    await campo.waitFor();
    assert.equal(await attesa.count(), 0, "a riposo l'indicatore non c'è");

    await campo.fill("Che tempo farà domani?");
    await campo.press("Enter");
    await attesa.waitFor();
    assert.equal(await attesa.getAttribute("aria-label"), "Claude sta lavorando");
    // Un solo pulsante accanto al campo: mentre Claude lavora, con il campo vuoto, lo ferma.
    const pulsante = pagina.locator("button.pulsante-invio");
    assert.equal(await pulsante.count(), 1);
    assert.equal(await pulsante.getAttribute("aria-label"), "Interrompi");
    // Scrivendo diventa di nuovo "Invia", anche mentre Claude lavora; svuotando torna a fermare.
    await campo.fill("Anche dopodomani");
    assert.equal(await pulsante.getAttribute("aria-label"), "Invia");
    assert.equal(await pulsante.isEnabled(), true);
    await campo.fill("");
    assert.equal(await pulsante.getAttribute("aria-label"), "Interrompi");
    await pulsante.click();
    await finche(() => banco.home.interruzioni === 1, "il quadrato ferma Claude");
    assert.equal(await attesa.locator(".puntini span").count(), 3);
    // Accanto alla parola, il germoglio di Shinka che si muove; per chi ascolta la pagina è nascosto.
    const germoglio = attesa.locator("svg.germoglio");
    assert.equal(await germoglio.count(), 1);
    assert.equal(await germoglio.getAttribute("aria-hidden"), "true");
    assert.notEqual(await germoglio.locator(".pianta").evaluate((g) => getComputedStyle(g).animationName), "none");
    // Con le animazioni ridotte, il germoglio resta fermo.
    await pagina.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(await germoglio.locator(".pianta").evaluate((g) => getComputedStyle(g).animationName), "none");
    await pagina.emulateMedia({ reducedMotion: "no-preference" });
    await fotografa("chiaro");

    // La parola viene dall'elenco e nel giro di due cambi non è più la stessa.
    const viste = new Set<string>();
    const fine = Date.now() + CAMBIO_PAROLA_MS * 2 + 1500;
    while (Date.now() < fine && viste.size < 3) {
      viste.add((await attesa.locator(".parola").textContent()) ?? "");
      await pagina.waitForTimeout(250);
    }
    for (const parola of viste) assert.ok(PAROLE_BUFFE.includes(parola), `"${parola}" non è nell'elenco`);
    assert.ok(viste.size >= 2, `la parola non è cambiata: ${[...viste].join(", ")}`);

    await pagina.emulateMedia({ colorScheme: "dark" });
    await fotografa("scuro");
    await pagina.setViewportSize({ width: 390, height: 780 });
    await fotografa("telefono");

    // Mentre Claude scrive la risposta il turno è ancora aperto: l'indicatore resta.
    banco.home.emetti({ tipo: "testo-iniziato", idTesto: "t1" });
    banco.home.emetti({ tipo: "testo-frammento", idTesto: "t1", frammento: "Domani sole" });
    await pagina.getByText("Domani sole").waitFor();
    assert.equal(await attesa.count(), 1);
    await fotografa("telefono-in-arrivo");

    banco.home.emetti({ tipo: "testo-concluso", idTesto: "t1", testo: "Domani sole." });
    banco.home.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 10 });
    await attesa.waitFor({ state: "detached" });
    // A riposo e con il campo vuoto non c'è nulla da fare.
    assert.equal(await pagina.locator("button.pulsante-invio").getAttribute("aria-label"), "Invia");
    assert.equal(await pagina.locator("button.pulsante-invio").isDisabled(), true);
    await pagina.getByText("Domani sole.").waitFor();
    await fotografa("telefono-finito");

    // Nulla dell'indicatore è entrato nella conversazione né nel suo archivio.
    const archivio = JSON.stringify(banco.canale.archiviati);
    for (const parola of PAROLE_BUFFE) assert.ok(!archivio.includes(parola), `"${parola}" è finita nell'archivio`);
    assert.deepEqual(banco.home.inviati, ["Che tempo farà domani?"]);
  },
);
