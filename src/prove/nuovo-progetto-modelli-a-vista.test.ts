/**
 * Prova a vista del modello nella scheda di un progetto nuovo: l'interfaccia costruita, in un browser
 * vero, davanti a un centro con conversazioni finte e un nodo. Nell'ambiente del centro il menu ha i
 * modelli dei due motori e quello in rete di un altro ambiente, con il suo nome; cambiando ambiente
 * le voci diventano quelle del nodo e la scelta che lì non vale torna al predefinito, anche quella di
 * chi implementa; il sottomodello e chi implementa si salvano, e valgono dal primo messaggio. Si salta dove manca il browser o l'interfaccia costruita.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { test } from "node:test";
import { chromium } from "playwright-core";
import type { ModelloDisponibile } from "../protocollo/impostazioni.ts";
import { allestisci, avviaNodoAccettato, finche, ID_NODO, PASSWORD } from "./banco.ts";
import { browserDiProva } from "./browser-di-prova.ts";

const cartellaWeb = join(import.meta.dirname, "..", "..", "web", "dist");
const disponibile = browserDiProva();
const salta =
  disponibile === undefined
    ? "su questa macchina non c'è un browser per la prova"
    : !existsSync(join(cartellaWeb, "index.html"))
      ? "l'interfaccia non è costruita"
      : false;

/** Come `finche`, per ciò che nella pagina si legge solo in modo asincrono. */
async function finoA(condizione: () => Promise<boolean>, che: string): Promise<void> {
  for (let volte = 0; volte < 100; volte++) {
    if (await condizione()) return;
    await new Promise((fatto) => setTimeout(fatto, 50));
  }
  assert.fail(`non è successo in tempo: ${che}`);
}

const DEL_CENTRO: ModelloDisponibile[] = [
  { valore: "opus", nome: "Opus", descrizione: "", motore: "claude" },
  { valore: "gpt-6", nome: "GPT-6", descrizione: "", motore: "codex" },
  { valore: "locale:qwen", nome: "qwen3 (in rete, PC Windows)", descrizione: "Gira su «PC Windows».", motore: "claude" },
];

test("nella scheda del progetto nuovo il modello segue l'ambiente, e quello scelto vale dal primo messaggio", { skip: salta, timeout: 90_000 }, async (t) => {
  const banco = await allestisci(t, { cartellaWeb, modelliDelCentro: DEL_CENTRO });
  // Nel nodo c'è solo Claude, con un modello che al centro non c'è.
  const nodo = await avviaNodoAccettato(t, banco, {
    modelli: { leggi: async (motore) => (motore === "claude" ? [{ valore: "sonnet", nome: "Sonnet", descrizione: "" }] : undefined) },
  });
  const porta = (banco.centro.server.address() as AddressInfo).port;
  const browser = await chromium.launch({
    chromiumSandbox: disponibile?.recinto !== false,
    ...(disponibile?.canale === undefined ? {} : { channel: disponibile.canale }),
    ...(disponibile?.eseguibile === undefined ? {} : { executablePath: disponibile.eseguibile }),
  });
  t.after(() => browser.close());
  const pagina = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
  await pagina.goto(`http://127.0.0.1:${porta}/`);
  await pagina.fill("#password", PASSWORD);
  await pagina.click('button[type="submit"]');
  await pagina.locator("form.scrittura textarea").waitFor();
  await pagina.goto(`http://127.0.0.1:${porta}/#/nuovo-progetto`);

  const menu = pagina.getByLabel("Modello del lavoro");
  const voci = () => menu.locator("option").allTextContents();
  // Nell'ambiente del centro: i due motori, e il modello in rete con l'ambiente che lo fornisce.
  await finoA(async () => (await voci()).includes("qwen3 (in rete, PC Windows)"), "il menu ha il modello in rete");
  assert.deepEqual(await voci(), ["Motore predefinito", "Claude predefinito", "Opus", "qwen3 (in rete, PC Windows)", "Codex predefinito", "GPT-6"]);
  await menu.selectOption("codex:gpt-6");
  // Chi implementa: si affida l'implementazione a un altro modello, qui Codex.
  await pagina.getByLabel("Affida l'implementazione a un altro modello").check();
  const implementa = pagina.getByLabel("Modello di chi implementa");
  await implementa.selectOption("codex:gpt-6");

  // Nel nodo Codex non ha un accesso: le voci sono le sue, e la scelta torna al predefinito.
  await pagina.getByLabel("Ambiente").selectOption(ID_NODO);
  await finoA(async () => (await voci()).includes("Sonnet"), "il menu ha i modelli del nodo");
  assert.deepEqual(await voci(), ["Modello predefinito", "Sonnet"]);
  assert.equal(await menu.inputValue(), "");
  await menu.selectOption("sonnet");
  // Anche chi implementa si riallinea: lì Codex non c'è, e si sceglie fra i modelli del nodo.
  assert.equal(await implementa.inputValue(), "");
  await implementa.selectOption("sonnet");
  await pagina.getByLabel("Effort di chi implementa").selectOption("high");
  // Con SHINKA_PROVA_IMMAGINI resta una foto della scheda, da guardare.
  const cartellaImmagini = process.env.SHINKA_PROVA_IMMAGINI;
  if (cartellaImmagini !== undefined) await pagina.screenshot({ path: join(cartellaImmagini, "nuovo-progetto-chi-implementa.png"), fullPage: true });

  await pagina.getByLabel("Nome").fill("Videogioco");
  await pagina.getByLabel("Brief: tutto ciò che il progetto saprà all'inizio").fill("Un platformer.");
  await pagina.getByRole("button", { name: "Crea il progetto" }).click();
  await finche(() => banco.progetti.elenco().some((progetto) => progetto.nome === "Videogioco"), "il progetto nasce");
  const progetto = banco.progetti.elenco().find((uno) => uno.nome === "Videogioco")!;
  assert.equal(progetto.idAmbiente, ID_NODO);
  const impostazioni = banco.lavori.impostazioni(progetto.id);
  assert.equal(impostazioni.modello, "sonnet");
  assert.equal(impostazioni.motore, undefined);
  assert.deepEqual(banco.lavori.chiImplementa(progetto.id), { modello: "sonnet", impegno: "high" });
  // Il primo messaggio parte con il modello scelto.
  await finche(() => nodo.conversazioni[0]?.inviati[0]?.startsWith("Un platformer.") === true, "il brief arriva al nodo");
  assert.match(nodo.conversazioni[0]?.inviati[0] ?? "", /ha scelto chi implementa: .*affida_incarico/);
  assert.equal(nodo.conversazioni[0]?.configurazione?.impostazioni.modello, "sonnet");
});
