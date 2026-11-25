import assert from "node:assert/strict";
import { test } from "node:test";
import { CHAT_MINIMA, larghezzaConsentita, PANNELLO_MINIMO } from "./larghezza-pannello.ts";

test("la chat resta di almeno 340 pixel e il pannello di almeno 280", () => {
  assert.equal(larghezzaConsentita(600, 1400), 600);
  assert.equal(larghezzaConsentita(100, 1400), PANNELLO_MINIMO);
  assert.equal(larghezzaConsentita(1300, 1400), 1400 - CHAT_MINIMA);
  assert.equal(larghezzaConsentita(500.6, 1400), 501);
  // Senza posto per due colonne non c'è una larghezza.
  assert.equal(larghezzaConsentita(400, CHAT_MINIMA + PANNELLO_MINIMO - 1), undefined);
  assert.equal(larghezzaConsentita(400, CHAT_MINIMA + PANNELLO_MINIMO), PANNELLO_MINIMO);
});
