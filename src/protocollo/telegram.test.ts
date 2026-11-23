import assert from "node:assert/strict";
import { test } from "node:test";
import { nomeFileTelegram } from "./telegram.ts";

test("un file arriva su Telegram con il solo nome, senza cartelle né caratteri di controllo", () => {
  assert.equal(nomeFileTelegram("itinerario-tokyo.pdf"), "itinerario-tokyo.pdf");
  assert.equal(nomeFileTelegram("tokyo/mappa.html"), "mappa.html");
  assert.equal(nomeFileTelegram("C:\\Users\\mario\\giro.pdf"), "giro.pdf");
  assert.equal(nomeFileTelegram('nome "strano"\n.txt'), "nome strano.txt");
  assert.equal(nomeFileTelegram("Itinerario dei negozi di carte.pdf"), "Itinerario dei negozi di carte.pdf");
  for (const vuoto of ["", "  ", "cartella/", ".", "..", "\u0000"]) assert.equal(nomeFileTelegram(vuoto), undefined, vuoto);
  // Un nome lunghissimo tiene la fine, dove sta l'estensione.
  const lungo = nomeFileTelegram(`${"a".repeat(300)}.pdf`);
  assert.equal(lungo?.length, 200);
  assert.ok(lungo?.endsWith(".pdf"));
});
