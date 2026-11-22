import assert from "node:assert/strict";
import { test } from "node:test";
import { ambientePerHarness, fonteConfigurata, verificaFonte } from "./autenticazione.ts";

test("senza configurazione la fonte è l'abbonamento", () => {
  assert.equal(fonteConfigurata({}), "abbonamento");
  assert.equal(fonteConfigurata({ SHINKA_AUTENTICAZIONE: "  " }), "abbonamento");
});

test("la fonte si può impostare a api-key", () => {
  assert.equal(fonteConfigurata({ SHINKA_AUTENTICAZIONE: "API-Key" }), "api-key");
});

test("un valore sconosciuto è un errore, non un ripiego silenzioso", () => {
  assert.throws(() => fonteConfigurata({ SHINKA_AUTENTICAZIONE: "gratis" }), /abbonamento/);
});

test("con l'abbonamento le credenziali a consumo non arrivano all'harness", () => {
  const ambiente = ambientePerHarness("abbonamento", {
    PATH: "/usr/bin",
    ANTHROPIC_API_KEY: "chiave-di-prova",
    ANTHROPIC_AUTH_TOKEN: "token-di-prova",
  });
  assert.deepEqual(ambiente, { PATH: "/usr/bin" });
});

test("con la api-key l'ambiente passa intatto", () => {
  const origine = { PATH: "/usr/bin", ANTHROPIC_API_KEY: "chiave-di-prova" };
  assert.deepEqual(ambientePerHarness("api-key", origine), origine);
});

test("l'ambiente di partenza non viene modificato", () => {
  const origine = { ANTHROPIC_API_KEY: "chiave-di-prova" };
  ambientePerHarness("abbonamento", origine);
  assert.equal(origine.ANTHROPIC_API_KEY, "chiave-di-prova");
});

test("abbonamento configurato e nessuna chiave in uso: va bene", () => {
  assert.doesNotThrow(() => verificaFonte("abbonamento", "none"));
});

test("abbonamento configurato ma chiave in uso: errore", () => {
  assert.throws(() => verificaFonte("abbonamento", "ANTHROPIC_API_KEY"), /API key/);
});

test("api-key configurata ma nessuna chiave in uso: errore", () => {
  assert.throws(() => verificaFonte("api-key", "none"), /nessuna/);
});
