import assert from "node:assert/strict";
import { test } from "node:test";
import { disposizioneImmagini, type NodoHtml } from "./immagini-nel-testo.ts";

const img: NodoHtml = { type: "element", tagName: "img" };
const testo = (value: string): NodoHtml => ({ type: "text", value });
const el = (tagName: string, children: NodoHtml[] = []): NodoHtml => ({ type: "element", tagName, children });

test("una voce che comincia con un'immagine e continua con del testo è una scheda", () => {
  assert.equal(disposizioneImmagini(el("li", [testo("\n"), img, testo(" "), el("strong", [testo("Tempio")]), testo(" · 1 ora"), el("br"), testo("Descrizione")])), "con-immagine");
  // Anche un'immagine dentro un collegamento.
  assert.equal(disposizioneImmagini(el("p", [el("a", [img]), testo(" M50")])), "con-immagine");
  // E una voce da spuntare.
  assert.equal(disposizioneImmagini(el("li", [el("input"), testo(" "), img, testo(" Alberi")])), "con-immagine");
});

test("solo immagini: grandi, una accanto all'altra; un'immagine dopo il testo non cambia nulla", () => {
  assert.equal(disposizioneImmagini(el("p", [img])), "solo-immagini");
  assert.equal(disposizioneImmagini(el("p", [img, testo("\n"), el("br"), img])), "solo-immagini");
  assert.equal(disposizioneImmagini(el("p", [testo("Guarda: "), img])), undefined);
  assert.equal(disposizioneImmagini(el("p", [testo("Solo testo")])), undefined);
  assert.equal(disposizioneImmagini(el("li", [el("p", [img, testo(" Tempio")])])), undefined, "in un elenco largo la scheda la fa il paragrafo");
  assert.equal(disposizioneImmagini(undefined), undefined);
});
