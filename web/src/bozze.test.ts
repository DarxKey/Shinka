import assert from "node:assert/strict";
import { test } from "node:test";
import { quandoRiparte } from "./bozze.ts";

test("al limite il messaggio aspetta il momento più lontano in cui i limiti esauriti si azzerano", () => {
  const adesso = new Date("2026-11-17T10:00:00Z");
  assert.equal(quandoRiparte(undefined, adesso), undefined);
  assert.equal(quandoRiparte({ cinqueOre: { percento: 80, azzeraIl: "2026-11-17T12:00:00Z" } }, adesso), undefined);
  assert.equal(quandoRiparte({ cinqueOre: { percento: 100, azzeraIl: "2026-11-17T12:00:00Z" } }, adesso), "2026-11-17T12:00:00Z");
  assert.equal(
    quandoRiparte({ cinqueOre: { percento: 100, azzeraIl: "2026-11-17T12:00:00Z" }, setteGiorni: { percento: 100, azzeraIl: "2026-11-19T08:00:00Z" } }, adesso),
    "2026-11-19T08:00:00Z",
  );
  // Un limite già azzerato, o senza ora, non trattiene nulla.
  assert.equal(quandoRiparte({ cinqueOre: { percento: 100, azzeraIl: "2026-11-17T09:00:00Z" } }, adesso), undefined);
  assert.equal(quandoRiparte({ cinqueOre: { percento: 100 } }, adesso), undefined);
});
