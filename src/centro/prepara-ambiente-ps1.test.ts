/**
 * Lo script che prepara un ambiente Windows gira in Windows PowerShell 5.1, che passando un argomento
 * a un programma esterno toglie le virgolette doppie che contiene: il codice dato a `node -e` deve
 * farne a meno. Successo il 24 novembre 2026: il controllo della versione di Node falliva sempre.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

test("il codice passato a node -e nello script per Windows non contiene virgolette doppie", async () => {
  const script = await readFile(join(import.meta.dirname, "prepara-ambiente.ps1"), "utf8");
  const righe = script.split(/\r?\n/).filter((riga) => /&\s*\$node\s+-e\s/.test(riga));
  assert.ok(righe.length >= 2, "le righe con node -e ci sono");
  for (const riga of righe) assert.doesNotMatch(riga.slice(riga.indexOf("-e")), /"/, riga);
});
