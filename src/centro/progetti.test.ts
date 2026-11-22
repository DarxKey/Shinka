import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { RegistroProgetti } from "./progetti.ts";

async function fileProvvisorio(t: TestContext): Promise<string> {
  const cartella = await mkdtemp(join(tmpdir(), "shinka-progetti-"));
  t.after(() => rm(cartella, { recursive: true, force: true }));
  return join(cartella, "progetti.json");
}

const NUOVO = {
  nome: "Videogioco",
  cartella: "/home/node/progetti/videogioco",
  idAmbiente: "centro",
  brief: "Un gioco di piattaforme.",
};

test("un progetto creato si ritrova nell'elenco, dal più recente", async (t) => {
  const registro = await RegistroProgetti.apri(await fileProvvisorio(t));
  const primo = await registro.crea(NUOVO, 1_000);
  const secondo = await registro.crea({ ...NUOVO, nome: "Sito", cartella: "/p/sito" }, 2_000);

  assert.deepEqual(registro.elenco().map((p) => p.nome), ["Sito", "Videogioco"]);
  assert.deepEqual(registro.trova(primo.id), primo);
  assert.notEqual(primo.id, secondo.id);
  assert.equal(registro.trova("inesistente"), undefined);
});

test("progetti e conversazioni si ritrovano dopo il riavvio", async (t) => {
  const file = await fileProvvisorio(t);
  const primo = await RegistroProgetti.apri(file);
  const progetto = await primo.crea(NUOVO);
  await primo.ricordaSessione(progetto.id, "sessione-7");

  const secondo = await RegistroProgetti.apri(file);
  assert.deepEqual(secondo.trova(progetto.id), progetto);
  assert.equal(secondo.idSessione(progetto.id), "sessione-7");
});

test("l'identificativo della conversazione non compare tra i dati del progetto e si può dimenticare", async (t) => {
  const registro = await RegistroProgetti.apri(await fileProvvisorio(t));
  const progetto = await registro.crea(NUOVO);
  await registro.ricordaSessione(progetto.id, "sessione-7");
  assert.equal("idSessione" in (registro.trova(progetto.id) ?? {}), false);

  await registro.ricordaSessione(progetto.id, "");
  assert.equal(registro.idSessione(progetto.id), undefined);
});

test("chi ascolta viene avvisato quando nasce un progetto", async (t) => {
  const registro = await RegistroProgetti.apri(await fileProvvisorio(t));
  let avvisi = 0;
  const smetti = registro.iscrivi(() => {
    avvisi += 1;
  });
  await registro.crea(NUOVO);
  smetti();
  await registro.crea({ ...NUOVO, nome: "Altro" });
  assert.equal(avvisi, 1);
});
