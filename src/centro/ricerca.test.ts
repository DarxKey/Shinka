import assert from "node:assert/strict";
import { test } from "node:test";
import type { EventoConversazione } from "../protocollo/eventi.ts";
import { cercaNelleConversazioni } from "./ricerca.ts";

const storia = (voci: [string, EventoConversazione][]) => voci.map(([quando, evento], n) => ({ n: n + 1, quando, evento }));

const HOME = {
  dove: { tipo: "home" as const },
  titolo: "Home",
  storia: storia([
    ["2026-11-17T10:00:00Z", { tipo: "messaggio-proprietario", id: "m1", testo: "Cerca un ristorante di sushi a Shinjuku" }],
    ["2026-11-17T10:01:00Z", { tipo: "testo-concluso", idTesto: "t1", testo: "Ho trovato tre posti di Sushi con il nastro che gira, vicino alla stazione." }],
    ["2026-11-17T10:01:00Z", { tipo: "azione-iniziata", idAzione: "a1", strumento: "WebSearch", ingresso: { query: "sushi shinjuku" } }],
  ]),
};
const PROGETTO = {
  dove: { tipo: "progetto" as const, id: "p1" },
  titolo: "Ricettario",
  storia: storia([["2026-11-16T09:00:00Z", { tipo: "testo-concluso", idTesto: "t2", testo: "La ricetta del sushi è nel file ricette.md: è più facile così." }]]),
};

test("si cerca nei messaggi e nelle risposte, tutte le parole, senza maiuscole né accenti, dai più recenti", () => {
  const trovati = cercaNelleConversazioni([PROGETTO, HOME], "SUSHI");
  assert.deepEqual(trovati.map((t) => [t.titolo, t.chi]), [
    ["Home", "claude"],
    ["Home", "proprietario"],
    ["Ricettario", "claude"],
  ]);
  assert.deepEqual(cercaNelleConversazioni([PROGETTO, HOME], "sushi stazione").map((t) => t.chi), ["claude"]);
  assert.deepEqual(cercaNelleConversazioni([PROGETTO, HOME], "piu facile").map((t) => t.titolo), ["Ricettario"]);
  assert.deepEqual(cercaNelleConversazioni([PROGETTO, HOME], "   "), []);
  // Le azioni non contano: "shinjuku" c'è solo nel messaggio, non due volte.
  assert.equal(cercaNelleConversazioni([HOME], "shinjuku").length, 1);
});

test("l'estratto mostra il testo intorno alla parola", () => {
  const lungo = { ...HOME, storia: storia([["2026-11-17T10:00:00Z", { tipo: "testo-concluso", idTesto: "t", testo: `${"prima ".repeat(40)}PAROLA${" dopo".repeat(40)}` }]]) };
  const [trovato] = cercaNelleConversazioni([lungo], "parola");
  assert.match(trovato?.estratto ?? "", /^….*PAROLA.*…$/);
  assert.ok((trovato?.estratto.length ?? 0) < 200);
});
