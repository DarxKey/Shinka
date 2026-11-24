import assert from "node:assert/strict";
import { test } from "node:test";
import { chiaveDelModello, gruppiDiModelli, nomeDelModello, sceltaDaChiave, sceltaRiallineata } from "./motori.ts";

const claude = [
  { valore: "default", nome: "Predefinito", descrizione: "", motore: "claude" as const },
  { valore: "opus", nome: "Opus", descrizione: "", motore: "claude" as const },
];
const codex = [{ valore: "gpt-5.5", nome: "GPT-5.5", descrizione: "", motore: "codex" as const }];

test("con un motore solo il menu resta un elenco, con due ha un gruppo per motore", () => {
  assert.deepEqual(gruppiDiModelli(claude), [{ modelli: [claude[1]] }]);
  const gruppi = gruppiDiModelli([...claude, ...codex]);
  assert.deepEqual(gruppi.map((gruppo) => [gruppo.motore, gruppo.modelli.map((modello) => modello.valore)]), [
    ["claude", ["opus"]],
    ["codex", ["gpt-5.5"]],
  ]);
});

test("una voce dice motore e modello, e il modello vuoto è il predefinito del motore", () => {
  assert.equal(chiaveDelModello("codex", "gpt-5.5"), "codex:gpt-5.5");
  assert.deepEqual(sceltaDaChiave("codex:gpt-5.5"), { motore: "codex", modello: "gpt-5.5" });
  assert.deepEqual(sceltaDaChiave("claude:"), { motore: "claude", modello: null });
  assert.deepEqual(sceltaDaChiave("opus"), { modello: "opus" });
  assert.deepEqual(sceltaDaChiave(""), { modello: null });
});

test("il riassunto nomina il modello, o il predefinito del motore", () => {
  const gruppi = gruppiDiModelli([...claude, ...codex]);
  assert.equal(nomeDelModello(gruppi, "codex", "gpt-5.5"), "GPT-5.5");
  assert.equal(nomeDelModello(gruppi, "codex", undefined), "Codex predefinito");
  assert.equal(nomeDelModello(gruppiDiModelli(claude), "claude", undefined), "Modello predefinito");
});

test("cambiando ambiente la scelta resta se lì c'è, altrimenti torna al predefinito", () => {
  const delCentro = [...claude, ...codex, { valore: "locale:qwen", nome: "qwen3 (in rete, PC)", descrizione: "", motore: "claude" as const }];
  const delPc = [{ valore: "sonnet", nome: "Sonnet", descrizione: "", motore: "claude" as const }];
  // Il modello c'è anche lì, con il suo motore: resta.
  assert.deepEqual(sceltaRiallineata(delCentro, "claude", "opus"), { motore: "claude", modello: "opus" });
  assert.deepEqual(sceltaRiallineata(delCentro, "claude", "locale:qwen"), { motore: "claude", modello: "locale:qwen" });
  // Lì non c'è: torna il predefinito del motore.
  assert.deepEqual(sceltaRiallineata(delPc, "claude", "opus"), { motore: "claude", modello: "" });
  // Lì il motore non ha un accesso: torna il predefinito anche lui.
  assert.deepEqual(sceltaRiallineata(delPc, "codex", "gpt-5.5"), { motore: undefined, modello: "" });
  // Il predefinito resta il predefinito.
  assert.deepEqual(sceltaRiallineata(delPc, undefined, ""), { motore: undefined, modello: "" });
  // Un modello che c'è ma è dell'altro motore non vale per questo.
  assert.deepEqual(sceltaRiallineata(delCentro, "codex", "opus"), { motore: "codex", modello: "" });
});
