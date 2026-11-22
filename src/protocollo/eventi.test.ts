import assert from "node:assert/strict";
import { test } from "node:test";
import { leggiRispostaAlleDomande, MASSIMO_RISPOSTA } from "./eventi.ts";

test("una risposta alle domande arrivata da fuori passa solo se è fatta come deve", () => {
  assert.deepEqual(leggiRispostaAlleDomande({ tipo: "saltate", altro: 1 }), { tipo: "saltate" });
  assert.deepEqual(leggiRispostaAlleDomande({ tipo: "risposte", risposte: ["Sì", "Rosso, Blu"] }), {
    tipo: "risposte",
    risposte: ["Sì", "Rosso, Blu"],
  });
  for (const sbagliata of [
    undefined,
    null,
    "risposte",
    { tipo: "risposte" },
    { tipo: "risposte", risposte: [] },
    { tipo: "risposte", risposte: ["  "] },
    { tipo: "risposte", risposte: [3] },
    { tipo: "risposte", risposte: ["a", "b", "c", "d", "e"] },
    { tipo: "risposte", risposte: ["x".repeat(MASSIMO_RISPOSTA + 1)] },
    { tipo: "in-chat", testo: "ciao" },
  ]) {
    assert.equal(leggiRispostaAlleDomande(sbagliata), undefined, JSON.stringify(sbagliata));
  }
});
