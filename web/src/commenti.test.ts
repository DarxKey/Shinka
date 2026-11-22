import assert from "node:assert/strict";
import { test } from "node:test";
import { conICommenti } from "./commenti.ts";

test("i commenti partono in testa al messaggio, con il file, la riga e il suo testo", () => {
  const commenti = [
    { percorso: "src/gioco.ts", riga: 12, testoDellaRiga: "  const vite = 3;", commento: "Metti 5." },
    { percorso: "README.md", riga: 1, testoDellaRiga: "", commento: "Titolo più corto." },
  ];
  assert.equal(
    conICommenti("Sistema queste cose.", commenti),
    "[Commenti del proprietario]\n- src/gioco.ts:12 (`const vite = 3;`): Metti 5.\n- README.md:1: Titolo più corto.\n\nSistema queste cose.",
  );
  assert.equal(conICommenti("", commenti.slice(0, 1)), "[Commenti del proprietario]\n- src/gioco.ts:12 (`const vite = 3;`): Metti 5.");
  // Su un elaborato intero, con il pezzo scelto e dove sta.
  assert.equal(
    conICommenti("", [{ percorso: "itinerario.md", riga: 0, testoDellaRiga: "Giorno 2:\n  Kyoto", commento: "Togli il tempio.", dove: "ambiente Unraid, argomento 2026-11-18-abc123" }]),
    "[Commenti del proprietario]\n- itinerario.md (ambiente Unraid, argomento 2026-11-18-abc123) («Giorno 2: Kyoto»): Togli il tempio.",
  );
  assert.equal(conICommenti("Solo testo.", []), "Solo testo.");
});
