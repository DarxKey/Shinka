import assert from "node:assert/strict";
import { test } from "node:test";
import { filtraPalette } from "./palette.ts";

const VOCI = [
  { etichetta: "Home", genere: "pagina" },
  { etichetta: "Videogioco", genere: "progetto", dettaglio: "PC Windows" },
  { etichetta: "Viaggio a Kyōto", genere: "argomento", dettaglio: "12 nov" },
  { etichetta: "Il mio gioco", genere: "progetto", dettaglio: "Unraid" },
];

test("la palette trova con tutte le parole, senza maiuscole né accenti, e mette prima chi comincia così", () => {
  assert.deepEqual(filtraPalette(VOCI, "").length, 4);
  assert.deepEqual(filtraPalette(VOCI, "gioco").map((voce) => voce.etichetta), ["Videogioco", "Il mio gioco"]);
  assert.deepEqual(filtraPalette(VOCI, "vi").map((voce) => voce.etichetta), ["Videogioco", "Viaggio a Kyōto"]);
  assert.deepEqual(filtraPalette(VOCI, "kyoto").map((voce) => voce.etichetta), ["Viaggio a Kyōto"]);
  assert.deepEqual(filtraPalette(VOCI, "progetto unraid").map((voce) => voce.etichetta), ["Il mio gioco"]);
  assert.deepEqual(filtraPalette(VOCI, "zzz"), []);
});
