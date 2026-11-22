import assert from "node:assert/strict";
import { test } from "node:test";
import { COMANDO_A_PARTE, comandiPer, domandaAParte, testoDelComando } from "./comandi.ts";

const COMANDI = [
  { nome: "compact", descrizione: "Compatta la conversazione" },
  { nome: "mattpocock-skills:grill-me", descrizione: "Intervista", argomenti: "<piano>" },
  { nome: "context", descrizione: "Il contesto" },
];

test("il menu compare con la barra all'inizio, filtra e mette prima chi comincia così", () => {
  assert.deepEqual(comandiPer("/", COMANDI).map((c) => c.nome), ["compact", "mattpocock-skills:grill-me", "context"]);
  assert.deepEqual(comandiPer("/co", COMANDI).map((c) => c.nome), ["compact", "context", "mattpocock-skills:grill-me"]);
  assert.deepEqual(comandiPer("/grill", COMANDI).map((c) => c.nome), ["mattpocock-skills:grill-me"]);
  assert.deepEqual(comandiPer("/compact ora", COMANDI), []);
  assert.deepEqual(comandiPer("ciao /co", COMANDI), []);
  assert.equal(testoDelComando(COMANDI[0]!), "/compact");
  assert.equal(testoDelComando(COMANDI[1]!), "/mattpocock-skills:grill-me ");
});

test("/btw con una domanda è una domanda a parte; senza domanda, o in mezzo al testo, no", () => {
  assert.equal(domandaAParte("/btw che ore sono?"), "che ore sono?");
  assert.equal(domandaAParte("  /BTW  riga uno\nriga due  "), "riga uno\nriga due");
  assert.equal(domandaAParte("/btw"), undefined);
  assert.equal(domandaAParte("/btw   "), undefined);
  assert.equal(domandaAParte("/btwx ciao"), undefined);
  assert.equal(domandaAParte("ciao /btw ciao"), undefined);
  // Nel menu "/" compare come gli altri, con lo spazio dopo per scrivere la domanda.
  assert.equal(testoDelComando(COMANDO_A_PARTE), "/btw ");
  assert.deepEqual(comandiPer("/bt", [COMANDO_A_PARTE, ...COMANDI]).map((c) => c.nome), ["btw"]);
});
