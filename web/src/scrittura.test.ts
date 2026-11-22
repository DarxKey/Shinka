import assert from "node:assert/strict";
import { test } from "node:test";
import { aCapo, conGliACapo } from "./scrittura.ts";

/** Va a capo con il cursore dove c'è la barra verticale. */
function invio(conCursore: string): string {
  const posizione = conCursore.indexOf("|");
  const { testo, cursore } = aCapo(conCursore.replace("|", ""), posizione);
  return `${testo.slice(0, cursore)}|${testo.slice(cursore)}`;
}

test("fuori da un elenco andare a capo aggiunge solo l'a capo", () => {
  assert.equal(invio("Ciao|"), "Ciao\n|");
  assert.equal(invio("Ciao| mondo"), "Ciao\n| mondo");
  assert.equal(invio("-nonelenco|"), "-nonelenco\n|");
});

test("in un elenco la riga nuova comincia con lo stesso segno, e un numero cresce", () => {
  assert.equal(invio("Spesa:\n- pane|"), "Spesa:\n- pane\n- |");
  assert.equal(invio("* uno|"), "* uno\n* |");
  assert.equal(invio("• uno|"), "• uno\n• |");
  assert.equal(invio("  - rientrato|"), "  - rientrato\n  - |");
  assert.equal(invio("1. primo|"), "1. primo\n2. |");
  assert.equal(invio("9) nono|"), "9) nono\n10) |");
  // A metà di un elemento il resto va nell'elemento nuovo.
  assert.equal(invio("- pane| e latte"), "- pane\n- | e latte");
});

test("un elemento vuoto chiude l'elenco", () => {
  assert.equal(invio("- pane\n- |"), "- pane\n|");
  assert.equal(invio("1. primo\n2. |"), "1. primo\n|");
});

test("una selezione viene sostituita dall'a capo", () => {
  assert.deepEqual(aCapo("Ciao mondo", 4, 10), { testo: "Ciao\n", cursore: 5 });
});

test("nei messaggi del proprietario ogni a capo resta, tranne nel codice e attorno alle righe vuote", () => {
  assert.equal(conGliACapo("riga uno\nriga due\n\nparagrafo"), "riga uno  \nriga due\n\nparagrafo");
  assert.equal(conGliACapo("- pane\n- latte"), "- pane  \n- latte");
  assert.equal(conGliACapo("```\na\nb\n```\nfine"), "```\na\nb\n```\nfine");
  assert.equal(conGliACapo("con spazi   \ndopo"), "con spazi  \ndopo");
  assert.equal(conGliACapo("una riga"), "una riga");
  // Ciò che segue un elenco non finisce dentro il suo ultimo elemento.
  assert.equal(conGliACapo("1. uno\n2. due\nGrazie"), "1. uno  \n2. due\n\nGrazie");
  assert.equal(conGliACapo("- pane\n  con il sesamo"), "- pane  \n  con il sesamo");
});
