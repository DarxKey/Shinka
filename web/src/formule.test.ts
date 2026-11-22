import assert from "node:assert/strict";
import { test } from "node:test";
import { haFormule } from "./formule.ts";

test("le formule si riconoscono, i prezzi in dollari no", () => {
  assert.equal(haFormule("La crescita è $O(n \\log n)$."), true);
  assert.equal(haFormule("$$\\sum_{i=1}^{n} i$$"), true);
  assert.equal(haFormule("$x^2$"), true);
  assert.equal(haFormule("Costa $5 oppure $10."), false);
  assert.equal(haFormule("Nessuna formula qui."), false);
});
