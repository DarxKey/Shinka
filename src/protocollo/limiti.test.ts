import assert from "node:assert/strict";
import { test } from "node:test";
import { limiteNelMessaggio, quandoRiparte } from "./limiti.ts";

test("il limite del piano si riconosce dal messaggio dell'harness, con quando si azzera se lo dice", () => {
  assert.deepEqual(limiteNelMessaggio("Claude AI usage limit reached|1795000000"), { azzeraIl: new Date(1_795_000_000_000).toISOString() });
  assert.deepEqual(limiteNelMessaggio("You've hit your 5-hour limit · resets 3pm (Europe/Rome)"), {});
  assert.deepEqual(limiteNelMessaggio("5-hour limit reached ∙ resets 3am"), {});
  assert.equal(limiteNelMessaggio("Non autenticato"), undefined);
  assert.equal(limiteNelMessaggio(undefined), undefined);
});

test("quando riparte: il più lontano tra i limiti esauriti e ancora da azzerare", () => {
  const adesso = new Date("2026-11-24T10:00:00Z");
  assert.equal(quandoRiparte(undefined, adesso), undefined);
  assert.equal(quandoRiparte({ cinqueOre: { percento: 80, azzeraIl: "2026-11-24T12:00:00Z" } }, adesso), undefined);
  assert.equal(
    quandoRiparte({ cinqueOre: { percento: 100, azzeraIl: "2026-11-24T12:00:00Z" }, setteGiorni: { percento: 100, azzeraIl: "2026-11-26T08:00:00Z" } }, adesso),
    "2026-11-26T08:00:00Z",
  );
  assert.equal(quandoRiparte({ cinqueOre: { percento: 100, azzeraIl: "2026-11-24T09:00:00Z" } }, adesso), undefined);
});
