import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FILE_STATO_DEL_COLLEGAMENTO, scriviStatoDelCollegamento, statoSuDisco } from "./stato-del-collegamento.ts";

const ADESSO = new Date("2026-11-23T09:00:00.000Z");

test("sul disco va lo stato con ciò che serve a chi lo legge, e il processo che lo ha scritto", () => {
  assert.deepEqual(statoSuDisco({ stato: "in-attesa", codice: "123 456" }, 42, ADESSO), {
    stato: "in-attesa",
    codice: "123 456",
    pid: 42,
    quando: "2026-11-23T09:00:00.000Z",
  });
  assert.deepEqual(statoSuDisco({ stato: "attivo", nome: "PC Windows" }, 42, ADESSO), { stato: "attivo", nome: "PC Windows", pid: 42, quando: "2026-11-23T09:00:00.000Z" });
  assert.deepEqual(statoSuDisco({ stato: "rifiutato", motivo: "rimosso" }, 42, ADESSO), { stato: "rifiutato", motivo: "rimosso", pid: 42, quando: "2026-11-23T09:00:00.000Z" });
  assert.deepEqual(statoSuDisco({ stato: "scollegato", riprovaTraMs: 5000 }, 42, ADESSO), { stato: "scollegato", pid: 42, quando: "2026-11-23T09:00:00.000Z" });
});

test("il file si sostituisce intero, senza lasciare file provvisori", async (t) => {
  const cartella = mkdtempSync(join(tmpdir(), "shinka-stato-collegamento-"));
  t.after(() => rmSync(cartella, { recursive: true, force: true }));
  const file = join(cartella, FILE_STATO_DEL_COLLEGAMENTO);
  await scriviStatoDelCollegamento(file, { stato: "collegamento" }, 7, ADESSO);
  await scriviStatoDelCollegamento(file, { stato: "attivo", nome: "PC" }, 7, ADESSO);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { stato: "attivo", nome: "PC", pid: 7, quando: "2026-11-23T09:00:00.000Z" });
  assert.deepEqual(readdirSync(cartella), [FILE_STATO_DEL_COLLEGAMENTO]);
});
