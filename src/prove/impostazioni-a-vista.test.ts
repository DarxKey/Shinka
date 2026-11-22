/**
 * Prova a vista della pagina Impostazioni, in un browser vero davanti a un centro con accessi finti:
 * il motore delle conversazioni nuove, l'accesso a Codex con il codice da scrivere sul sito (che
 * si conclude da sé), l'uscita da Claude e il nuovo accesso con il codice incollato. Si salta dove
 * manca il browser o l'interfaccia costruita. Con SHINKA_PROVA_IMMAGINI, in quella cartella restano
 * le immagini.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { test } from "node:test";
import { chromium } from "playwright-core";
import type { AccessoInCorso, EsitoAccessi, RichiestaAccessi } from "../protocollo/accessi.ts";
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

/** Gli accessi di un ambiente finto: Claude collegato, Codex no; l'accesso a Codex riesce al secondo sguardo. */
function accessiFinti(): { esegui(richiesta: RichiestaAccessi): Promise<EsitoAccessi>; codici: string[] } {
  let claude = true;
  let codex = false;
  let inCorso: AccessoInCorso[] = [];
  let sguardiCodex = 0;
  const codici: string[] = [];
  const stato = (): EsitoAccessi => ({
    accessi: {
      claude: claude ? { collegato: true, descrizione: "Claude Pro" } : { collegato: false },
      codex: codex ? { collegato: true, descrizione: "ChatGPT Plus" } : { collegato: false },
    },
    ...(inCorso.length === 0 ? {} : { inCorso }),
  });
  return {
    codici,
    async esegui(richiesta) {
      if (richiesta.tipo === "stato" && inCorso.some((voce) => voce.motore === "codex") && ++sguardiCodex >= 2) {
        codex = true;
        inCorso = inCorso.filter((voce) => voce.motore !== "codex");
      }
      if (richiesta.tipo === "avvia") {
        inCorso.push(
          richiesta.motore === "codex"
            ? { motore: "codex", indirizzo: "https://auth.openai.com/codex/device", codice: "ABCD-12345", chiedeCodice: false }
            : { motore: "claude", indirizzo: "https://claude.com/cai/oauth/authorize?code=true", chiedeCodice: true },
        );
      }
      if (richiesta.tipo === "esci" && richiesta.motore === "claude") claude = false;
      if (richiesta.tipo === "codice") {
        codici.push(richiesta.codice);
        inCorso = inCorso.filter((voce) => voce.motore !== "claude");
        if (richiesta.codice !== "codice-giusto") return { ...stato(), motivo: "L'accesso a Claude non è riuscito: codice sbagliato." };
        claude = true;
      }
      return stato();
    },
  };
}

for (const [nome, larghezza] of [["largo", 1280], ["telefono", 390]] as const) {
  test(`pagina Impostazioni: motore e accessi (${nome})`, { skip: salta, timeout: 120_000 }, async (t) => {
    const accessi = accessiFinti();
    const banco = await allestisci(t, { cartellaWeb, accessi });
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
      await pagina.screenshot({ path: join(cartellaImmagini, `impostazioni-${nome}-${cosa}.png`), fullPage: true });
    };
    await pagina.goto(`${indirizzo}/`);
    await pagina.fill("#password", PASSWORD);
    await pagina.click('button[type="submit"]');
    await pagina.locator("form.scrittura textarea").waitFor();
    await pagina.goto(`${indirizzo}/#/impostazioni`);
    await pagina.getByRole("heading", { name: "Impostazioni" }).waitFor();

    // Il motore delle conversazioni nuove: senza scelta vale quello dell'installazione.
    const radioCodex = pagina.getByRole("radio", { name: "Codex" });
    assert.equal(await pagina.getByRole("radio", { name: "Claude" }).isChecked(), true);
    // La scelta diventa quella salvata quando il centro ha risposto: un clic, poi si aspetta.
    await radioCodex.click();
    await pagina.waitForFunction(() => document.querySelector<HTMLInputElement>('input[value="codex"]')?.checked === true);
    await pagina.getByText("Collegato · Claude Pro").waitFor();
    assert.deepEqual(JSON.parse(await readFile(join(banco.cartella, "impostazioni.json"), "utf8")), { motore: "codex" });
    await fotografa("motore");

    // Codex: il codice da scrivere sul sito; la pagina si accorge da sola che l'accesso è fatto.
    const voce = pagina.locator(".voce-accessi").first();
    await voce.locator(".accesso-motore", { hasText: "Codex" }).getByRole("button", { name: "Accedi" }).click();
    await voce.getByText("ABCD-12345").waitFor();
    assert.equal(await voce.getByRole("link", { name: "Apri la pagina di OpenAI" }).getAttribute("href"), "https://auth.openai.com/codex/device");
    await fotografa("codex");
    await voce.getByText("Collegato · ChatGPT Plus").waitFor({ timeout: 15_000 });

    // Claude: si esce con una conferma, si rientra incollando il codice; uno sbagliato lo dice.
    await voce.locator(".accesso-motore", { hasText: "Claude" }).getByRole("button", { name: "Esci" }).click();
    await voce.getByRole("button", { name: "Esci da Claude" }).click();
    await voce.locator(".accesso-motore", { hasText: "Claude" }).getByRole("button", { name: "Accedi" }).click();
    await voce.getByRole("link", { name: "Apri la pagina di Anthropic" }).waitFor();
    await voce.getByLabel("Codice dato dal sito").fill("codice-sbagliato");
    await fotografa("claude");
    await voce.getByRole("button", { name: "Conferma" }).click();
    await voce.getByText("codice sbagliato").waitFor();
    await voce.locator(".accesso-motore", { hasText: "Claude" }).getByRole("button", { name: "Accedi" }).click();
    await voce.getByLabel("Codice dato dal sito").fill("codice-giusto");
    await voce.getByRole("button", { name: "Conferma" }).click();
    await voce.getByText("Collegato · Claude Pro").waitFor();
    assert.deepEqual(accessi.codici, ["codice-sbagliato", "codice-giusto"]);
    await fotografa("fatto");

    // L'ambiente del centro cambia nome, e lo vede subito anche il registro.
    const ambiente = pagina.locator("section", { has: pagina.getByRole("heading", { name: "Ambiente del centro" }) });
    await ambiente.getByLabel("Nome").fill("Server di casa");
    await ambiente.getByRole("button", { name: "Salva" }).click();
    await ambiente.getByText("Salvato.").waitFor();
    assert.equal(banco.ambienti.stato().ambienti[0]?.nome, "Server di casa");

    // La password: quella attuale, la nuova due volte; questo browser resta dentro.
    const sezionePassword = pagina.locator("section", { has: pagina.getByRole("heading", { name: "Password di Shinka" }) });
    await sezionePassword.getByLabel("Password attuale").fill(PASSWORD);
    await sezionePassword.getByLabel("Password nuova", { exact: true }).fill("una-nuova-password");
    await sezionePassword.getByLabel("Ripeti la password nuova").fill("una-nuova-password");
    await fotografa("password");
    await sezionePassword.getByRole("button", { name: "Cambia password" }).click();
    await sezionePassword.getByText("Password cambiata").waitFor();
    await pagina.reload();
    await pagina.getByRole("heading", { name: "Impostazioni" }).waitFor();
    await pagina.locator("section", { has: pagina.getByRole("heading", { name: "Ambiente del centro" }) }).getByLabel("Nome").waitFor();
    assert.equal(await pagina.locator("section", { has: pagina.getByRole("heading", { name: "Ambiente del centro" }) }).getByLabel("Nome").inputValue(), "Server di casa");

    // Niente esce dallo schermo del telefono.
    const larga = await pagina.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(larga <= larghezza, `la pagina è larga ${larga}`);
  });
}
