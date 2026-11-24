import assert from "node:assert/strict";
import { test } from "node:test";
import { comandiPer, testoDelComando } from "./comandi.ts";

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
