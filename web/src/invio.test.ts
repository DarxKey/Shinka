import assert from "node:assert/strict";
import { test } from "node:test";
import { modoDelPulsante } from "./invio.ts";

test("il pulsante manda quando c'è qualcosa da mandare, ferma Claude quando lavora e il campo è vuoto", () => {
  const base = { occupata: false, invio: false, daMandare: false, bloccata: false };
  assert.equal(modoDelPulsante(base), "spento");
  assert.equal(modoDelPulsante({ ...base, daMandare: true }), "invia");
  assert.equal(modoDelPulsante({ ...base, occupata: true }), "interrompi");
  // Mentre Claude lavora si può comunque scrivere: con un testo il pulsante manda.
  assert.equal(modoDelPulsante({ ...base, occupata: true, daMandare: true }), "invia");
  assert.equal(modoDelPulsante({ ...base, daMandare: true, invio: true }), "in-invio");
  // Dove non si può scrivere, il pulsante non fa nulla.
  assert.equal(modoDelPulsante({ ...base, bloccata: true, daMandare: true }), "spento");
});
