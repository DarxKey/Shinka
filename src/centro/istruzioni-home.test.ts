import assert from "node:assert/strict";
import { test } from "node:test";
import { istruzioniHome } from "./istruzioni-home.ts";

test("la Home cerca i posti sul web e prova Overpass una volta sola, con un tempo massimo breve", () => {
  const istruzioni = istruzioniHome(new Date("2026-11-16T10:00:00Z"));
  assert.match(istruzioni, /## Cercare sul web/);
  assert.match(istruzioni, /Per trovare posti vicini al proprietario parti da WebSearch/);
  assert.match(istruzioni, /un tentativo solo e un tempo massimo di 20 secondi \(`curl -m 20`\), senza riprovare su altri server/);
  // Le regole che valgono sempre restano in fondo.
  assert.ok(istruzioni.indexOf("## Cercare sul web") < istruzioni.indexOf("## Sempre"));
});
