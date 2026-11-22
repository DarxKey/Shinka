import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { preparaProgetto, type EseguiComando } from "./preparazione.ts";

const INDICE = { tipo: "indice-codegraph" as const, pacchetto: "@colbymchenry/codegraph@1.6.2" };

test("la preparazione lancia l'indice di CodeGraph nella cartella del progetto e riferisce la fine dell'uscita", async (t) => {
  const cartella = await mkdtemp(join(tmpdir(), "shinka-prepara-"));
  t.after(() => rm(cartella, { recursive: true, force: true }));
  const lanciati: [string, string][] = [];
  const finto: EseguiComando = async (dove, comando) => {
    lanciati.push([dove, comando]);
    return { riuscita: true, testo: `${"x".repeat(2000)}\nIndexed 12 files\n` };
  };
  const esiti = await preparaProgetto(cartella, [INDICE], finto);
  assert.deepEqual(lanciati, [[cartella, "npx -y @colbymchenry/codegraph@1.6.2 init -y ."]]);
  assert.equal(esiti.length, 1);
  assert.equal(esiti[0]?.riuscita, true);
  assert.match(esiti[0]?.testo ?? "", /Indexed 12 files$/);
  assert.ok((esiti[0]?.testo.length ?? 0) <= 600);
});

test("in una cartella che non c'è non si lancia nulla, e un comando fallito lo dice", async () => {
  const lanciati: string[] = [];
  const finto: EseguiComando = async (_dove, comando) => {
    lanciati.push(comando);
    return { riuscita: false, testo: "Codice di uscita: 1\nnpx: command not found" };
  };
  const mancante = await preparaProgetto(join(tmpdir(), "shinka-non-esiste-davvero"), [INDICE], finto);
  assert.deepEqual(lanciati, []);
  assert.equal(mancante[0]?.riuscita, false);
  assert.match(mancante[0]?.testo ?? "", /non c'è/);

  const fallita = await preparaProgetto(tmpdir(), [INDICE], finto);
  assert.deepEqual(fallita, [{ tipo: "indice-codegraph", riuscita: false, testo: "Codice di uscita: 1\nnpx: command not found" }]);
});
