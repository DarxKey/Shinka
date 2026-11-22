import assert from "node:assert/strict";
import { test } from "node:test";
import { leggiSessioni, scriviSessioni } from "./sessioni.ts";

test("una conversazione che ha conosciuto solo Claude resta con l'identificativo di sempre", () => {
  assert.equal(scriviSessioni({ ultimo: "claude", sessioni: { claude: "s-1" } }), "s-1");
  assert.deepEqual(leggiSessioni("s-1"), { ultimo: "claude", sessioni: { claude: "s-1" } });
  assert.equal(leggiSessioni(""), undefined);
  assert.equal(leggiSessioni(undefined), undefined);
});

test("con Codex le sessioni dei due motori stanno insieme, con l'ultimo che ha lavorato", () => {
  const scritto = scriviSessioni({ ultimo: "codex", sessioni: { claude: "s-1", codex: "t-1" } });
  assert.deepEqual(leggiSessioni(scritto), { ultimo: "codex", sessioni: { claude: "s-1", codex: "t-1" } });
  const soloCodex = scriviSessioni({ ultimo: "codex", sessioni: { codex: "t-2" } });
  assert.deepEqual(leggiSessioni(soloCodex), { ultimo: "codex", sessioni: { codex: "t-2" } });
  // Tornati a Claude, il thread di Codex resta ricordato.
  const tornati = scriviSessioni({ ultimo: "claude", sessioni: { claude: "s-1", codex: "t-1" } });
  assert.deepEqual(leggiSessioni(tornati), { ultimo: "claude", sessioni: { claude: "s-1", codex: "t-1" } });
  assert.equal(leggiSessioni("{rotto"), undefined);
});
