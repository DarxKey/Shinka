import assert from "node:assert/strict";
import { test } from "node:test";
import { apriSigillo, leggiChiavePrivata, leggiSigillo, nuovaCoppia, sigilla } from "./sigillo.ts";

test("un sigillo si apre solo con la chiave del nodo a cui è destinato, e non si può toccare", () => {
  const nodo = nuovaCoppia();
  const altro = nuovaCoppia();
  const valore = [{ nome: "nas", segreto: "una password" }];
  const sigillo = sigilla(valore, nodo.pubblica);
  assert.ok(!JSON.stringify(sigillo).includes("una password"));
  assert.deepEqual(apriSigillo(sigillo, leggiChiavePrivata(nodo.privata)), valore);
  assert.throws(() => apriSigillo(sigillo, leggiChiavePrivata(altro.privata)));
  const toccato = { ...sigillo, cifrato: Buffer.from(Buffer.from(sigillo.cifrato, "base64").map((b, i) => (i === 0 ? b ^ 1 : b))).toString("base64") };
  assert.throws(() => apriSigillo(toccato, leggiChiavePrivata(nodo.privata)));
  assert.deepEqual(leggiSigillo(JSON.parse(JSON.stringify(sigillo))), sigillo);
  assert.equal(leggiSigillo({ effimera: "x" }), undefined);
  assert.throws(() => sigilla(valore, "non è una chiave"));
});
