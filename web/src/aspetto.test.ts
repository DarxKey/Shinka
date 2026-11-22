import assert from "node:assert/strict";
import { test } from "node:test";
import { leggiAspetto } from "./aspetto.ts";

test("le scelte di aspetto salvate si rileggono, e ciò che non vale torna al predefinito", () => {
  assert.deepEqual(leggiAspetto(null), { tema: "automatico", vista: "normale" });
  assert.deepEqual(leggiAspetto(JSON.stringify({ tema: "scuro", vista: "dettagliata" })), { tema: "scuro", vista: "dettagliata" });
  assert.deepEqual(leggiAspetto(JSON.stringify({ tema: "viola", vista: "ragionamento" })), { tema: "automatico", vista: "ragionamento" });
  assert.deepEqual(leggiAspetto("non è json"), { tema: "automatico", vista: "normale" });
});
