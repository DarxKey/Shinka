import assert from "node:assert/strict";
import { test } from "node:test";
import { nomeCartellaDa } from "./progetti.ts";

test("il nome della cartella è il nome del progetto in minuscole e trattini", () => {
  assert.equal(nomeCartellaDa("Videogioco spaziale"), "videogioco-spaziale");
  assert.equal(nomeCartellaDa("  Sito   del   club  "), "sito-del-club");
});

test("accenti e simboli spariscono senza lasciare caratteri strani", () => {
  assert.equal(nomeCartellaDa("Caffè & Città: l'app!"), "caffe-citta-l-app");
  assert.equal(nomeCartellaDa("C:\\Windows\\..\\segreti"), "c-windows-segreti");
});

test("un nome senza lettere né cifre dà comunque una cartella", () => {
  assert.equal(nomeCartellaDa("???"), "progetto");
  assert.equal(nomeCartellaDa(""), "progetto");
});

test("un nome lungo viene accorciato senza finire con un trattino", () => {
  const cartella = nomeCartellaDa("un progetto con un nome davvero molto lungo che non finisce mai più");
  assert.ok(cartella.length <= 48);
  assert.equal(cartella.endsWith("-"), false);
});
