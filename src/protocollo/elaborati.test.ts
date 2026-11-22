import assert from "node:assert/strict";
import { test } from "node:test";
import { genereDi, percorsoDiElaboratoValido, tipoMimeDi } from "./elaborati.ts";

test("un elaborato si riconosce dal nome, senza badare alle maiuscole", () => {
  assert.equal(genereDi("mappa.PNG"), "immagine");
  assert.equal(genereDi("foto/negozio.jpeg"), "immagine");
  assert.equal(genereDi("percorso.svg"), "immagine");
  assert.equal(genereDi("itinerario.md"), "markdown");
  assert.equal(genereDi("mappa.html"), "html");
  assert.equal(genereDi("negozi.csv"), "testo");
  assert.equal(genereDi("rinomina.ps1"), "testo");
  assert.equal(genereDi("percorso.gpx"), "testo");
  assert.equal(genereDi("Dockerfile"), "testo");
  assert.equal(genereDi(".bashrc"), "altro");
  assert.equal(genereDi("guida.pdf"), "altro");
  assert.equal(genereDi("archivio.tar.gz"), "altro");
});

test("il tipo con cui si manda un elaborato segue il suo genere", () => {
  assert.equal(tipoMimeDi("mappa.png"), "image/png");
  assert.equal(tipoMimeDi("mappa.svg"), "image/svg+xml");
  assert.equal(tipoMimeDi("itinerario.md"), "text/markdown; charset=utf-8");
  assert.equal(tipoMimeDi("mappa.html"), "text/html; charset=utf-8");
  assert.equal(tipoMimeDi("negozi.json"), "text/plain; charset=utf-8");
  assert.equal(tipoMimeDi("guida.pdf"), "application/pdf");
  assert.equal(tipoMimeDi("misterioso.bin"), "application/octet-stream");
});

test("vale solo un percorso relativo che resta nella cartella dell'argomento", () => {
  for (const buono of ["mappa.png", "tokyo/itinerario.md", ".nascosto", "a b/c d.txt"]) {
    assert.equal(percorsoDiElaboratoValido(buono), true, buono);
  }
  for (const cattivo of ["", "/etc/passwd", "C:/Windows/win.ini", "c:segreto", "..", "../fuori.txt", "a/../../b", "a//b", "./a", "a\\b", "a/", "a\u0000b", 3, undefined, "x".repeat(1001)]) {
    assert.equal(percorsoDiElaboratoValido(cattivo), false, String(cattivo));
  }
});
