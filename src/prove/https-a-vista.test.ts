/**
 * Prova a vista dell'HTTPS: l'interfaccia costruita, servita dal centro in HTTPS con i certificati
 * di Shinka, in un browser vero che si fida solo di quel certificato. Il proprietario entra, scrive
 * alla Home, manda la posizione e guarda la sezione HTTPS della pagina Vault; la pagina del
 * certificato si apre anche in HTTP. Si salta dove manca il browser o l'interfaccia costruita. Con
 * SHINKA_PROVA_IMMAGINI, in quella cartella restano le immagini.
 */

import assert from "node:assert/strict";
import { createHash, X509Certificate } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { test } from "node:test";
import { chromium } from "playwright-core";
import { preparaCertificati, type HttpsDelCentro } from "../centro/https.ts";
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

test("in HTTPS il proprietario entra, scrive, manda la posizione e vede il certificato", { skip: salta, timeout: 90_000 }, async (t) => {
  const base = await allestisci(t);
  const certificati = preparaCertificati(join(base.cartella, "https"), ["127.0.0.1", "localhost"]);
  const https: HttpsDelCentro = {
    dati: base.cartella,
    configurazione: { attivo: true, nomi: ["127.0.0.1"], reindirizza: false },
    scelta: { attivo: true, nomi: ["127.0.0.1"], reindirizza: false },
    decisoDaVariabile: false,
    certificati,
    porta: 0,
    riavvia: () => {},
  };
  const banco = await allestisci(t, { cartellaWeb, https });
  await banco.centro.listen({ host: "127.0.0.1", port: 0 });
  const porta = (banco.centro.server.address() as AddressInfo).port;
  https.porta = porta;

  // Il browser si fida del certificato del server, e solo di quello.
  const spki = createHash("sha256").update(new X509Certificate(certificati.catena).publicKey.export({ type: "spki", format: "der" })).digest("base64");
  const browser = await chromium.launch({
    chromiumSandbox: disponibile?.recinto !== false,
    args: [`--ignore-certificate-errors-spki-list=${spki}`],
    ...(disponibile?.canale === undefined ? {} : { channel: disponibile.canale }),
    ...(disponibile?.eseguibile === undefined ? {} : { executablePath: disponibile.eseguibile }),
  });
  t.after(() => browser.close());
  const contesto = await browser.newContext({
    viewport: { width: 390, height: 844 },
    geolocation: { latitude: 35.6905, longitude: 139.7003, accuracy: 12 },
    permissions: ["geolocation"],
  });
  const pagina = await contesto.newPage();
  const cartellaImmagini = process.env.SHINKA_PROVA_IMMAGINI;
  if (cartellaImmagini !== undefined) await mkdir(cartellaImmagini, { recursive: true });
  const fotografa = async (nome: string) => {
    if (cartellaImmagini === undefined) return;
    await pagina.waitForTimeout(400);
    await pagina.screenshot({ path: join(cartellaImmagini, `https-${nome}.png`), fullPage: true });
  };

  await pagina.goto(`https://127.0.0.1:${porta}/`);
  await pagina.fill("#password", PASSWORD);
  await pagina.click('button[type="submit"]');
  const campo = pagina.locator("form.scrittura textarea");
  await campo.waitFor();
  assert.equal(await pagina.evaluate(() => window.isSecureContext && location.protocol), "https:");
  const cookie = (await contesto.cookies()).find((voce) => voce.name === "shinka_sessione" || voce.httpOnly);
  assert.equal(cookie?.secure, true, "entrando in HTTPS il cookie è sicuro");

  // Si scrive alla Home: il POST passa il controllo dell'origine anche in HTTPS.
  await campo.fill("Come ci arrivo al Tocho?");
  await campo.press("Enter");
  await finche(() => banco.home.inviati.length === 1, "il messaggio arriva alla Home");
  banco.home.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 1 });

  // La posizione dal browser, che in HTTPS la dà.
  await pagina.getByRole("button", { name: "Usa la mia posizione" }).click();
  await finche(() => banco.home.inviati.length === 2, "la posizione arriva alla Home");
  assert.match(banco.home.inviati[1] ?? "", /35\.69050, 139\.70030/);
  await fotografa("chat");

  // La pagina Impostazioni mostra indirizzo, scadenza e impronta.
  await pagina.goto(`https://127.0.0.1:${porta}/#/impostazioni`);
  await pagina.getByText("Collegamento sicuro (HTTPS)").waitFor();
  await pagina.getByText(`https://127.0.0.1:${porta}`).first().waitFor();
  await pagina.getByText(certificati.ca?.impronta ?? "?").waitFor();
  await pagina.getByText("Collegamento sicuro (HTTPS)").scrollIntoViewIfNeeded();
  await fotografa("impostazioni");

  // La pagina del certificato, in HTTP come la apre un iPhone che non si fida ancora.
  await pagina.goto(`http://127.0.0.1:${porta}/certificato`);
  await pagina.getByText("Attendibilità certificati").waitFor();
  await fotografa("certificato");
});
