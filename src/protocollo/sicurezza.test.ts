import assert from "node:assert/strict";
import { test } from "node:test";
import { accessoInParole, DA_GUARDARE, settimanaInBreve, TIPI_ACCESSO, type VoceAccesso } from "./sicurezza.ts";

test("ogni cosa che il registro annota ha le sue parole, e ciò che merita uno sguardo è tra quelle", () => {
  for (const tipo of TIPI_ACCESSO) assert.notEqual(accessoInParole(tipo), tipo);
  for (const tipo of DA_GUARDARE) assert.ok(TIPI_ACCESSO.includes(tipo));
  assert.ok(!DA_GUARDARE.includes("entrata"));
});

test("la settimana in breve conta le entrate e i tentativi non riusciti, con le ripetizioni", () => {
  const ora = Date.parse("2026-11-22T12:00:00Z");
  const voce = (tipo: VoceAccesso["tipo"], giorniFa: number, volte?: number): VoceAccesso => ({
    quando: new Date(ora - giorniFa * 86_400_000).toISOString(),
    tipo,
    da: "203.0.113.7",
    ...(volte === undefined ? {} : { volte }),
  });
  const voci = [voce("entrata", 0), voce("entrata", 3), voce("entrata", 9), voce("entrata-fallita", 1), voce("entrata-frenata", 2, 12), voce("senza-sessione", 1, 40), voce("entrata-fallita", 8)];
  assert.deepEqual(settimanaInBreve(voci, ora), { entrate: 2, falliti: 13 });
  assert.deepEqual(settimanaInBreve([], ora), { entrate: 0, falliti: 0 });
});
