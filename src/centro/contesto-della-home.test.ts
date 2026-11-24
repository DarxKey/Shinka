/**
 * Il contesto della Home resta leggero: gli strumenti delle estensioni, e quelli di Shinka usati di
 * rado, si caricano con ToolSearch quando servono; quelli di ogni giorno restano sempre caricati.
 * Di un modello locale il proprietario sceglie la risposta massima, che decide la riserva per la
 * compattazione; e ogni estensione dice quanto pesa.
 */

import assert from "node:assert/strict";
import { createServer, type AddressInfo } from "node:net";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { allestisci } from "../prove/banco.ts";
import { PESO_DI_PROVA } from "../prove/harness-di-prova.ts";
import { COOKIE_SESSIONE } from "./centro.ts";
import { STRUMENTI_HOME, STRUMENTI_HOME_SENZA_RICHIESTA } from "./istruzioni-home.ts";
import { creaStrumentiHome, STRUMENTI_HOME_SEMPRE_CARICATI } from "./strumenti-home.ts";

test("la Home cerca gli strumenti con ToolSearch: quelli di ogni giorno restano caricati, gli altri si caricano al bisogno", () => {
  assert.ok(STRUMENTI_HOME.includes("ToolSearch"));
  assert.ok(STRUMENTI_HOME_SENZA_RICHIESTA.includes("ToolSearch"));
  const finto = {} as never;
  const server = creaStrumentiHome({ ambienti: finto, lavori: finto, proposte: finto, home: finto, agisci: finto, comuni: (async () => ({ testo: "" })) as never, estensioni: finto, interfaccia: finto });
  assert.equal(server.type, "sdk");
  const registrati = (server.instance as unknown as { _registeredTools: Record<string, { _meta?: Record<string, unknown> }> })._registeredTools;
  const sempre = Object.entries(registrati).filter(([, definizione]) => definizione._meta?.["anthropic/alwaysLoad"] === true).map(([nome]) => nome);
  assert.deepEqual(sempre.sort(), [...STRUMENTI_HOME_SEMPRE_CARICATI].sort());
  // Quelli usati di rado ci sono, ma si cercano.
  for (const nome of ["avvia_stack", "apri_sito", "programma_lavoro", "disegna_mappa", "proponi_estensione", "proponi_estensione_interfaccia", "salva_skill"]) {
    assert.ok(registrati[nome] !== undefined, nome);
    assert.equal(registrati[nome]?._meta?.["anthropic/alwaysLoad"], undefined, nome);
  }
});

test("la risposta massima di un modello locale si sceglie, nei suoi limiti, e un'estensione dice quanto pesa", async (t) => {
  const banco = await allestisci(t, { estensioni: {} });
  const estensioni = banco.estensioni;
  assert.ok(estensioni !== undefined);
  const libera = createServer();
  await new Promise<void>((fatto) => libera.listen(0, "127.0.0.1", fatto));
  const porta = (libera.address() as AddressInfo).port;
  await new Promise<void>((fatto) => libera.close(() => fatto()));
  const programma = join(banco.cartella, "server.cjs");
  await writeFile(programma, "require('node:http').createServer((q, r) => r.end('ok')).listen(Number(process.argv[2]), '127.0.0.1')");
  const proposta = await estensioni.proponi({
    nome: "qwen",
    descrizione: "Qwen.",
    idAmbiente: "centro",
    definizione: { tipo: "modello-locale", comando: process.execPath, argomenti: [programma, String(porta)], variabili: {}, porta, modello: "qwen-prova", contesto: 65_536, uscita: 16_000, impegni: ["medium"] },
    chiavi: [],
  });
  assert.ok("idProposta" in proposta);
  assert.equal((await estensioni.conferma(proposta.idProposta))?.stato, "accesa");
  const id = estensioni.stato().estensioni[0]?.id ?? "";
  const cookies = { [COOKIE_SESSIONE]: await banco.entra() };
  const imposta = (uscita: number) => banco.centro.inject({ method: "POST", url: `/api/estensioni/${id}/uscita`, cookies, payload: { uscita } });

  assert.equal((await imposta(512)).statusCode, 409);
  assert.match((await imposta(40_000)).json<{ errore: string }>().errore, /da 1024 a 32768/);
  assert.equal((await imposta(4096)).statusCode, 200);
  const definizione = estensioni.stato().estensioni[0]?.definizione;
  assert.ok(definizione?.tipo === "modello-locale" && definizione.uscita === 4096);
  // L'ambiente la riceve con la risposta massima nuova, e resta accesa.
  assert.equal(estensioni.accese("centro")[0]?.definizione.tipo === "modello-locale" && (estensioni.accese("centro")[0]?.definizione as { uscita: number }).uscita, 4096);

  // Un server MCP provato dice quanto pesano i suoi strumenti nel contesto.
  const server = await estensioni.proponi({ nome: "saluti", descrizione: "Saluta.", idAmbiente: "centro", definizione: { tipo: "mcp-locale", comando: "node", argomenti: ["saluti.js"], variabili: {} }, chiavi: [] });
  assert.ok("idProposta" in server);
  assert.equal((await estensioni.conferma(server.idProposta))?.stato, "accesa");
  const saluti = estensioni.stato().estensioni.find((una) => una.nome === "saluti");
  assert.equal(saluti?.ambienti[0]?.token, PESO_DI_PROVA);
});
