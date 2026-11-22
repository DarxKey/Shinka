import assert from "node:assert/strict";
import { test } from "node:test";
import { fusoValido, leggiPianificazione, pianificazioneInParole, prossimaVolta, type Pianificazione } from "./programmati.ts";

const ROMA = "Europe/Rome";
const prossima = (quando: Pianificazione, dopo: string, fuso = ROMA): string | undefined => prossimaVolta(quando, new Date(dopo), fuso)?.toISOString();

test("ogni giorno a un'ora: oggi se non è ancora passata, altrimenti domani, nel fuso del proprietario", () => {
  const mattina: Pianificazione = { tipo: "giorni", ora: "07:30", giorni: [] };
  // D'inverno a Roma le 07:30 sono le 06:30 UTC.
  assert.equal(prossima(mattina, "2026-11-21T05:00:00Z"), "2026-11-21T06:30:00.000Z");
  assert.equal(prossima(mattina, "2026-11-21T06:30:00Z"), "2026-11-22T06:30:00.000Z");
  // D'estate sono le 05:30 UTC.
  assert.equal(prossima(mattina, "2026-07-01T00:00:00Z"), "2026-07-01T05:30:00.000Z");
  // Lo stesso orario in un altro fuso è un altro istante.
  assert.equal(prossima(mattina, "2026-11-21T05:00:00Z", "UTC"), "2026-11-21T07:30:00.000Z");
});

test("l'ora resta quella dell'orologio anche quando cambia l'ora legale", () => {
  const mattina: Pianificazione = { tipo: "giorni", ora: "07:30", giorni: [] };
  // Il 25 ottobre 2026 torna l'ora solare: il 24 le 07:30 sono le 05:30 UTC, il 25 le 06:30.
  assert.equal(prossima(mattina, "2026-10-24T04:00:00Z"), "2026-10-24T05:30:00.000Z");
  assert.equal(prossima(mattina, "2026-10-24T06:00:00Z"), "2026-10-25T06:30:00.000Z");
  // Il 29 marzo 2026 le 02:30 non esistono: tocca al primo istante dopo, non a un altro giorno.
  const notte = prossima({ tipo: "giorni", ora: "02:30", giorni: [] }, "2026-03-28T12:00:00Z");
  assert.ok(notte !== undefined && notte.startsWith("2026-03-29T0"), notte);
});

test("solo certi giorni della settimana", () => {
  // Il 21 novembre 2026 è un sabato.
  assert.equal(prossima({ tipo: "giorni", ora: "07:30", giorni: ["lun"] }, "2026-11-21T05:00:00Z"), "2026-11-23T06:30:00.000Z");
  assert.equal(prossima({ tipo: "giorni", ora: "07:30", giorni: ["sab", "dom"] }, "2026-11-21T08:00:00Z"), "2026-11-22T06:30:00.000Z");
  assert.equal(prossima({ tipo: "giorni", ora: "07:30", giorni: ["sab"] }, "2026-11-21T08:00:00Z"), "2026-11-28T06:30:00.000Z");
});

test("a intervalli si conta da adesso; una volta sola non torna", () => {
  assert.equal(prossima({ tipo: "ogni", minuti: 90 }, "2026-11-21T05:00:00Z"), "2026-11-21T06:30:00.000Z");
  const unaVolta: Pianificazione = { tipo: "una-volta", data: "2026-12-24", ora: "18:00" };
  assert.equal(prossima(unaVolta, "2026-11-21T05:00:00Z"), "2026-12-24T17:00:00.000Z");
  assert.equal(prossima(unaVolta, "2026-12-24T17:00:00Z"), undefined);
});

test("una pianificazione scritta male dice che cosa non va; quella buona torna in ordine", () => {
  assert.deepEqual(leggiPianificazione({ tipo: "giorni", ora: "07:30", giorni: ["ven", "lun", "lun"] }), { tipo: "giorni", ora: "07:30", giorni: ["lun", "ven"] });
  assert.deepEqual(leggiPianificazione({ tipo: "giorni", ora: "07:30", giorni: ["lun", "mar", "mer", "gio", "ven", "sab", "dom"] }), { tipo: "giorni", ora: "07:30", giorni: [] });
  assert.deepEqual(leggiPianificazione({ tipo: "giorni", ora: "07:30" }), { tipo: "giorni", ora: "07:30", giorni: [] });
  assert.match(String(leggiPianificazione({ tipo: "giorni", ora: "7.30" })), /07:30/);
  assert.match(String(leggiPianificazione({ tipo: "giorni", ora: "07:30", giorni: ["lunedì"] })), /giorni sono/);
  assert.match(String(leggiPianificazione({ tipo: "ogni", minuti: 5 })), /15 minuti/);
  assert.match(String(leggiPianificazione({ tipo: "una-volta", data: "2026-02-30", ora: "09:00" })), /non esiste/);
  assert.match(String(leggiPianificazione({ tipo: "cron", espressione: "* * * * *" })), /a un'ora/);
  assert.match(String(leggiPianificazione(undefined)), /Manca/);
});

test("in parole, e i fusi", () => {
  assert.equal(pianificazioneInParole({ tipo: "giorni", ora: "07:30", giorni: [] }), "ogni giorno alle 07:30");
  assert.equal(pianificazioneInParole({ tipo: "giorni", ora: "07:30", giorni: ["lun", "ven"] }), "lun, ven alle 07:30");
  assert.equal(pianificazioneInParole({ tipo: "ogni", minuti: 120 }), "ogni 2 ore");
  assert.equal(pianificazioneInParole({ tipo: "ogni", minuti: 45 }), "ogni 45 minuti");
  assert.equal(pianificazioneInParole({ tipo: "una-volta", data: "2026-12-24", ora: "18:00" }), "una volta, il 24/12/2026 alle 18:00");
  assert.equal(fusoValido("Europe/Rome"), true);
  assert.equal(fusoValido("Marte/Olympus"), false);
  assert.equal(fusoValido(undefined), false);
});
