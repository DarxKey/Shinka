import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Accesso } from "./accesso.ts";
import { FILE_PRIMO_AVVIO, PrimoAvvio } from "./primo-avvio.ts";

test("senza password nasce un codice, che resta uguale a ogni riavvio finché serve", async () => {
  const dati = mkdtempSync(join(tmpdir(), "shinka-primo-"));
  const accesso = await Accesso.apri(dati);
  const { primoAvvio, codice } = PrimoAvvio.apri(dati, accesso);
  assert.match(codice ?? "", /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(primoAvvio.attivo, true);
  assert.equal(PrimoAvvio.apri(dati, accesso).codice, codice);
  assert.equal(readFileSync(join(dati, FILE_PRIMO_AVVIO), "utf8").trim(), codice);
});

test("con il codice giusto la prima password si sceglie una volta sola, e chi la sceglie è dentro", async () => {
  const dati = mkdtempSync(join(tmpdir(), "shinka-primo-"));
  const accesso = await Accesso.apri(dati);
  const { primoAvvio, codice } = PrimoAvvio.apri(dati, accesso);
  assert.equal((await primoAvvio.imposta("AAAA-AAAA", "una-password-lunga")).esito, "rifiutato");
  assert.equal((await primoAvvio.imposta(codice ?? "", "corta")).esito, "password-corta");
  const fatto = await primoAvvio.imposta((codice ?? "").toLowerCase().replace("-", " "), "una-password-lunga");
  assert.ok(fatto.esito === "ok" && accesso.valida(fatto.token));
  assert.equal(existsSync(join(dati, FILE_PRIMO_AVVIO)), false);
  assert.equal(primoAvvio.attivo, false);
  assert.equal((await primoAvvio.imposta(codice ?? "", "un-altra-password")).esito, "non-serve");
  // Con la password già scelta, al riavvio il codice non nasce.
  assert.equal(PrimoAvvio.apri(dati, accesso).codice, undefined);
});

test("dopo cinque codici sbagliati bisogna aspettare", async () => {
  const dati = mkdtempSync(join(tmpdir(), "shinka-primo-"));
  const accesso = await Accesso.apri(dati);
  const { primoAvvio, codice } = PrimoAvvio.apri(dati, accesso);
  for (let i = 0; i < 5; i++) await primoAvvio.imposta("BBBB-BBBB", "una-password-lunga", 1000);
  assert.equal((await primoAvvio.imposta(codice ?? "", "una-password-lunga", 2000)).esito, "troppi-tentativi");
});
