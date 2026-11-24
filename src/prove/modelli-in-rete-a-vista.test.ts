/**
 * Prova a vista dei modelli locali in rete (ADR 0053), in un browser vero: nella pagina Estensioni,
 * sotto un modello acceso su un nodo, la casella «In rete» con l'indirizzo del nodo già scritto, e la
 * regola del firewall per Windows. Si salta dove manca il browser o l'interfaccia costruita.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createServer, type AddressInfo } from "node:net";
import { join } from "node:path";
import { test } from "node:test";
import { chromium } from "playwright-core";
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

test("un modello locale acceso su un nodo si mette in rete dalla pagina Estensioni", { skip: salta, timeout: 120_000 }, async (t) => {
  const banco = await allestisci(t, { cartellaWeb, estensioni: {} });
  const estensioni = banco.estensioni;
  assert.ok(estensioni !== undefined);
  await banco.centro.listen({ host: "127.0.0.1", port: 0 });
  await avviaNodoAccettato(t, banco);
  await finche(() => banco.ambienti.stato().ambienti.find((uno) => uno.id === ID_NODO)?.indirizzoDelNodo !== undefined, "il centro sa da dove arriva il nodo");

  const libera = createServer();
  await new Promise<void>((fatto) => libera.listen(0, "127.0.0.1", fatto));
  const porta = (libera.address() as AddressInfo).port;
  await new Promise<void>((fatto) => libera.close(() => fatto()));
  const programma = join(banco.cartella, "server-del-modello.cjs");
  await writeFile(programma, "require('node:http').createServer((q, r) => r.end('ok')).listen(Number(process.argv[3]), '127.0.0.1')");
  const proposta = await estensioni.proponi({
    nome: "qwen",
    descrizione: "Qwen sulla scheda video.",
    idAmbiente: ID_NODO,
    definizione: { tipo: "modello-locale", comando: process.execPath, argomenti: [programma, "--port", String(porta)], variabili: {}, porta, modello: "qwen-prova", contesto: 65_536, uscita: 16_000, impegni: ["medium"] },
    chiavi: [],
  });
  assert.ok("idProposta" in proposta);
  assert.equal((await estensioni.conferma(proposta.idProposta))?.stato, "accesa");

  const indirizzo = `http://localhost:${(banco.centro.server.address() as AddressInfo).port}`;
  const browser = await chromium.launch({
    chromiumSandbox: disponibile?.recinto !== false,
    ...(disponibile?.canale === undefined ? {} : { channel: disponibile.canale }),
    ...(disponibile?.eseguibile === undefined ? {} : { executablePath: disponibile.eseguibile }),
  });
  t.after(() => browser.close());
  const pagina = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await pagina.goto(`${indirizzo}/`);
  await pagina.fill("#password", PASSWORD);
  await pagina.click('button[type="submit"]');
  await pagina.locator("form.scrittura textarea").waitFor();
  await pagina.goto(`${indirizzo}/#/estensioni`);

  const casella = pagina.getByLabel("In rete: lo usano anche la Home e i progetti delle altre macchine");
  await casella.waitFor();
  const campo = pagina.getByLabel("Indirizzo di «PC Windows» visto dal centro");
  // L'indirizzo è già quello da cui il nodo si è collegato.
  assert.equal(await campo.inputValue(), banco.ambienti.stato().ambienti.find((uno) => uno.id === ID_NODO)?.indirizzoDelNodo);
  await casella.click();
  await finche(() => estensioni.modelliInRete().length === 1, "il modello va in rete");
  await pagina.getByText(/vuole una chiave, che Shinka tiene per sé/).waitFor();
  assert.equal(await campo.isDisabled(), true);
  // La chiave non arriva mai alla pagina.
  const chiave = estensioni.modelliInRete()[0]?.chiave ?? "";
  assert.ok(chiave.length >= 16);
  assert.equal((await pagina.content()).includes(chiave), false);
  if (process.env.SHINKA_PROVA_IMMAGINI !== undefined) await pagina.screenshot({ path: join(process.env.SHINKA_PROVA_IMMAGINI, "modello-in-rete.png"), fullPage: true });

  await casella.click();
  await finche(() => estensioni.modelliInRete().length === 0, "il modello esce dalla rete");
});
