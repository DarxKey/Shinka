/**
 * Prova a vista della scheda di proposta con una cartella che esiste già: l'interfaccia costruita,
 * in un browser vero, davanti a un centro con conversazioni finte. Il proprietario vede il percorso
 * proposto, lo cambia o lo svuota, e conferma. Si salta dove manca il browser o l'interfaccia
 * costruita. Con SHINKA_PROVA_IMMAGINI, in quella cartella restano le immagini.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { chromium } from "playwright-core";
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

test(
  "la scheda propone la cartella che esiste già, e il proprietario può cambiarla o svuotarla",
  { skip: salta, timeout: 60_000 },
  async (t) => {
    const banco = await allestisci(t, { cartellaWeb });
    const radice = await mkdtemp(join(tmpdir(), "shinka-scheda-"));
    t.after(() => rm(radice, { recursive: true, force: true }));
    const gioco = join(radice, "Rougue AFK");
    await mkdir(gioco);
    await banco.centro.listen({ host: "127.0.0.1", port: 0 });
    const porta = (banco.centro.server.address() as AddressInfo).port;

    const browser = await chromium.launch({
      chromiumSandbox: disponibile?.recinto !== false,
      ...(disponibile?.canale === undefined ? {} : { channel: disponibile.canale }),
      ...(disponibile?.eseguibile === undefined ? {} : { executablePath: disponibile.eseguibile }),
    });
    t.after(() => browser.close());
    const pagina = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    const cartellaImmagini = process.env.SHINKA_PROVA_IMMAGINI;
    if (cartellaImmagini !== undefined) await mkdir(cartellaImmagini, { recursive: true });
    const fotografa = async (nome: string) => {
      if (cartellaImmagini === undefined) return;
      await pagina.waitForTimeout(400);
      await pagina.screenshot({ path: join(cartellaImmagini, `proposta-${nome}.png`), fullPage: true });
    };

    await pagina.goto(`http://127.0.0.1:${porta}/`);
    await pagina.fill("#password", PASSWORD);
    await pagina.click('button[type="submit"]');
    await pagina.locator("form.scrittura textarea").waitFor();

    banco.proposte.proponi({
      nome: "Rougue AFK",
      brief: "Portaluce: gioco per browser, monorepo pnpm con Node 24.",
      idAmbiente: "centro",
      cartellaEsistente: gioco,
      avvisoCartella: "Non è un repository Git: Shinka non lo inizializza. Se serve, il progetto te lo proporrà.",
    });
    const campo = pagina.getByLabel("Cartella che esiste già");
    await campo.waitFor();
    assert.equal(await campo.inputValue(), gioco);
    await pagina.getByText("Non è un repository Git").waitFor();
    await pagina.getByText("così com'è").waitFor();
    // Le impostazioni con cui il progetto nasce: si parte da quelle di sempre.
    assert.equal(await pagina.getByLabel("Permessi del lavoro").inputValue(), "modifiche-libere");
    await fotografa("cartella-esistente");

    // Svuotato, la scheda torna a dire quale cartella nuova nascerebbe; l'avviso non vale più.
    await campo.fill("");
    await pagina.getByText("Il progetto nasce in una cartella nuova").waitFor();
    assert.equal(await pagina.getByText("Non è un repository Git").count(), 0);
    await fotografa("cartella-nuova");

    // Riscritto a mano, si conferma, e il progetto nasce lì.
    await campo.fill(gioco);
    await pagina.getByLabel("Effort del lavoro").selectOption("high");
    await pagina.getByRole("button", { name: "Conferma" }).click();
    await pagina.waitForURL(/#\/progetti\//);
    const [progetto] = banco.progetti.elenco();
    assert.equal(progetto?.cartella, await realpath(gioco));
    assert.equal(banco.lavori.impostazioni(progetto?.id ?? "").impegno, "high");
    assert.equal(existsSync(join(gioco, "BRIEF.md")), false);
  },
);
