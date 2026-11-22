import assert from "node:assert/strict";
import { test } from "node:test";
import { leggiPosizione, messaggioDellaPosizione, quantoFa } from "./posizione.ts";

test("una posizione vale solo se è ben formata, e arriva con la sua fonte", () => {
  assert.deepEqual(leggiPosizione({ lat: 35.68963, lon: 139.6917, precisioneM: 18.6, quando: "2026-11-13T05:32:10Z" }, "telegram"), {
    lat: 35.68963,
    lon: 139.6917,
    precisioneM: 19,
    quando: "2026-11-13T05:32:10.000Z",
    fonte: "telegram",
  });
  const viva = leggiPosizione({ lat: 1, lon: 2, quando: "2026-11-13T05:00:00Z", dalVivo: true, finoA: "2026-11-13T05:15:00Z" }, "telegram");
  assert.equal(viva?.dalVivo, true);
  assert.equal(viva?.finoA, "2026-11-13T05:15:00.000Z");
  for (const sbagliata of [null, {}, { lat: 91, lon: 0, quando: "2026-11-13T05:00:00Z" }, { lat: 0, lon: 181, quando: "x" }, { lat: "1", lon: 2, quando: "2026-11-13T05:00:00Z" }]) {
    assert.equal(leggiPosizione(sbagliata, "browser"), undefined, JSON.stringify(sbagliata));
  }
});

test("il messaggio della posizione dice coordinate, precisione e ora", () => {
  const testo = messaggioDellaPosizione({ lat: 35.689632, lon: 139.691701, precisioneM: 19, quando: "2026-11-13T05:32:10.000Z", fonte: "telegram" });
  assert.equal(testo, "📍 La mia posizione: 35.68963, 139.69170, precisione ±19 m (presa alle 05:32 UTC).");
  assert.match(messaggioDellaPosizione({ lat: 1, lon: 2, quando: "2026-11-13T05:32:10.000Z", fonte: "telegram", dalVivo: true }), /dal vivo/);
  const adesso = Date.parse("2026-11-13T06:00:00Z");
  assert.equal(quantoFa("2026-11-13T06:00:00Z", adesso), "adesso");
  assert.equal(quantoFa("2026-11-13T05:59:00Z", adesso), "un minuto fa");
  assert.equal(quantoFa("2026-11-13T05:32:00Z", adesso), "28 minuti fa");
  assert.equal(quantoFa("2026-11-13T04:00:00Z", adesso), "2 ore fa");
});
