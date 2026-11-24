import assert from "node:assert/strict";
import { test } from "node:test";
import { separaFonti } from "./fonti.ts";

test("la riga «Fonti:» in fondo, con i collegamenti, si stacca dalla risposta", () => {
  const separata = separaFonti("Ecco la risposta.\n\nAltro testo.\n\nFonti: [Uno](https://a.it/1), [Due](https://b.it/2)\n");
  assert.equal(separata.corpo, "Ecco la risposta.\n\nAltro testo.");
  assert.equal(separata.quante, 2);
  assert.equal(separata.fonti, "- [Uno](https://a.it/1)\n- [Due](https://b.it/2)");
});

test("anche come titolo o in grassetto, con un elenco sotto", () => {
  for (const inizio of ["## Fonti", "**Fonti**", "**Fonti:**", "Sources:"]) {
    const separata = separaFonti(`Testo.\n\n${inizio}\n- [Uno](https://a.it)\n- https://b.it/x\n`);
    assert.equal(separata.corpo, "Testo.", inizio);
    assert.equal(separata.quante, 2, inizio);
    assert.equal(separata.fonti, "- [Uno](https://a.it)\n- https://b.it/x", inizio);
  }
});

test("una risposta senza fonti, o che parla di fonti, resta com'è", () => {
  assert.deepEqual(separaFonti("Solo testo."), { corpo: "Solo testo.", quante: 0 });
  const parla = "Le fonti sono importanti.\n\nFonti: ne parlo sotto, senza collegamenti.";
  assert.deepEqual(separaFonti(parla), { corpo: parla, quante: 0 });
  // Dopo le fonti c'è altro testo: non si tocca.
  const dopo = "Testo.\n\nFonti: [Uno](https://a.it)\n\nE poi una conclusione.";
  assert.deepEqual(separaFonti(dopo), { corpo: dopo, quante: 0 });
});
