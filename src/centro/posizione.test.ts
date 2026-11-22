import assert from "node:assert/strict";
import { test } from "node:test";
import type { Posizione } from "../protocollo/posizione.ts";
import { posizioneInParole, PosizioneDelProprietario } from "./posizione.ts";

const ORA = Date.parse("2026-11-13T06:00:00Z");
const UNA: Posizione = { lat: 35.68963, lon: 139.6917, precisioneM: 19, quando: "2026-11-13T05:55:00.000Z", fonte: "telegram" };

test("una posizione condivisa una volta vale due ore, poi si dimentica", () => {
  let adesso = ORA;
  const custodia = new PosizioneDelProprietario(() => adesso);
  assert.equal(custodia.ultima(), undefined);
  custodia.registra(UNA);
  assert.deepEqual(custodia.ultima(), UNA);
  // Un punto dal vivo non la cambia: una posizione mandata una volta non diventa un tracciamento.
  assert.equal(custodia.aggiorna({ ...UNA, lat: 1, dalVivo: true, quando: "2026-11-13T05:58:00.000Z" }), false);
  assert.equal(custodia.ultima()?.lat, UNA.lat);
  adesso = Date.parse("2026-11-13T07:56:00Z");
  assert.equal(custodia.ultima(), undefined);
});

test("una posizione dal vivo si aggiorna finché dura la condivisione, e poco dopo", () => {
  let adesso = ORA;
  const custodia = new PosizioneDelProprietario(() => adesso);
  custodia.registra({ ...UNA, dalVivo: true, finoA: "2026-11-13T06:15:00.000Z" });
  assert.equal(custodia.aggiorna({ ...UNA, lat: 35.7, dalVivo: true, quando: "2026-11-13T05:59:00.000Z" }), true);
  assert.equal(custodia.ultima()?.lat, 35.7);
  assert.equal(custodia.ultima()?.finoA, "2026-11-13T06:15:00.000Z");
  // Un punto più vecchio, arrivato tardi, non torna indietro.
  assert.equal(custodia.aggiorna({ ...UNA, lat: 1, dalVivo: true, quando: "2026-11-13T05:50:00.000Z" }), false);
  adesso = Date.parse("2026-11-13T06:24:00Z");
  assert.ok(custodia.ultima() !== undefined);
  adesso = Date.parse("2026-11-13T06:26:00Z");
  assert.equal(custodia.ultima(), undefined);
});

test("la Home legge la posizione con la sua fonte e la sua età, e sa come chiederla se manca", () => {
  const letta = posizioneInParole(UNA, ORA);
  assert.match(letta, /35\.68963, 139\.69170 \(precisione ±19 m\), condivisa da Telegram, presa alle 05:55 UTC, 5 minuti fa\./);
  assert.match(letta, /di' al proprietario che parti da lì e quanto è vecchia/);
  assert.doesNotMatch(letta, /È vecchia/);
  assert.match(posizioneInParole({ ...UNA, quando: "2026-11-13T05:00:00.000Z", fonte: "browser" }, ORA), /dal browser.*È vecchia/);
  assert.match(posizioneInParole({ ...UNA, dalVivo: true, finoA: "2026-11-13T06:15:00.000Z" }, ORA), /dal vivo fino alle 06:15 UTC/);
  assert.match(posizioneInParole(undefined, ORA), /\/posizione/);
});
