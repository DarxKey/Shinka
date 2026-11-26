import assert from "node:assert/strict";
import { test } from "node:test";
import { istruzioniHome } from "../centro/istruzioni-home.ts";
import { ISTRUZIONI_DISEGNI, leggiRiquadro } from "./disegni.ts";

test("il riquadro di cifre: titolo, righe con valore e nota, segno del valore, spiegazioni sotto", () => {
  assert.deepEqual(
    leggiRiquadro("# Bilancio del viaggio\nTu | −35,17 €\nBruno | -681,73 € | ha pagato meno\nAlice | +716,90 €\nTotale | 0 €\n\nSolo una voce\n> Arrotondato alla fine."),
    {
      titolo: "Bilancio del viaggio",
      righe: [
        { voce: "Tu", valore: "−35,17 €", segno: "meno" },
        { voce: "Bruno", valore: "-681,73 €", nota: "ha pagato meno", segno: "meno" },
        { voce: "Alice", valore: "+716,90 €", segno: "piu" },
        { voce: "Totale", valore: "0 €" },
        { voce: "Solo una voce" },
      ],
      note: ["Arrotondato alla fine."],
    },
  );
  // Un trattino che non precede una cifra non è un segno; «# » dopo le righe non è un titolo.
  assert.deepEqual(leggiRiquadro("Stato | - in attesa\n# non titolo").righe, [{ voce: "Stato", valore: "- in attesa" }, { voce: "# non titolo" }]);
  assert.deepEqual(leggiRiquadro(""), { righe: [], note: [] });
});

test("la Home sa dei disegni, prima delle regole che valgono sempre, e da Telegram non li usa", () => {
  const istruzioni = istruzioniHome(new Date("2026-11-26T10:00:00Z"), { sviluppo: true });
  assert.equal(istruzioni.split("## Disegni nelle risposte").length, 2);
  assert.ok(istruzioni.indexOf("## Disegni nelle risposte") < istruzioni.indexOf("## Sempre"));
  assert.match(istruzioni, /senza tabelle, riquadri né diagrammi/);
  assert.match(ISTRUZIONI_DISEGNI, /```riquadro/);
});
