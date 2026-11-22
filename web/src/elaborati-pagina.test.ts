import assert from "node:assert/strict";
import { test } from "node:test";
import { chiaveElaborato, giornoDelGruppo, perGiorno } from "./elaborati-giorni.ts";

test("gli elaborati stanno sotto il loro giorno: oggi, ieri, poi la data", () => {
  const ora = new Date(2026, 10, 14, 15, 0);
  const alle = (giorno: number, ore: number) => new Date(2026, 10, giorno, ore).toISOString();
  assert.equal(giornoDelGruppo(alle(14, 9), ora), "Oggi");
  assert.equal(giornoDelGruppo(alle(13, 23), ora), "Ieri");
  assert.match(giornoDelGruppo(alle(10, 9), ora), /10 nov/);
  const voce = (giorno: number, ore: number, percorso: string) => ({ idArgomento: "a", idAmbiente: "centro", nomeAmbiente: "Unraid", percorso, quando: alle(giorno, ore) });
  const gruppi = perGiorno([voce(14, 12, "c.md"), voce(14, 9, "b.png"), voce(13, 20, "a.pdf"), voce(10, 8, "z.txt")], ora);
  assert.deepEqual(
    gruppi.map((gruppo) => [gruppo.giorno.replace(/^\d+ nov.*$/, "data"), gruppo.elaborati.map((e) => e.percorso)]),
    [["Oggi", ["c.md", "b.png"]], ["Ieri", ["a.pdf"]], ["data", ["z.txt"]]],
  );
  assert.equal(chiaveElaborato({ idArgomento: "a", idAmbiente: "centro", percorso: "x/y.md" }), "a~centro~x/y.md");
});
