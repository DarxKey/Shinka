import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { test, type TestContext } from "node:test";
import { adottaCartella, CartellaNonCreata, creaCartellaProgetto } from "./cartelle.ts";

async function radiceProvvisoria(t: TestContext): Promise<string> {
  const cartella = await mkdtemp(join(tmpdir(), "shinka-cartelle-"));
  t.after(() => rm(cartella, { recursive: true, force: true }));
  return cartella;
}

test("la cartella nasce con il brief dentro", async (t) => {
  const radice = await radiceProvvisoria(t);
  const { percorso } = await creaCartellaProgetto(radice, "videogioco", "Un gioco di piattaforme.");
  assert.equal(percorso, join(radice, "videogioco"));
  assert.match(await readFile(join(percorso, "BRIEF.md"), "utf8"), /Un gioco di piattaforme\./);
});

test("la cartella dei progetti viene creata se non esiste ancora", async (t) => {
  const radice = join(await radiceProvvisoria(t), "non", "ancora", "esistente");
  const { percorso } = await creaCartellaProgetto(radice, "primo", "Brief.");
  assert.ok(existsSync(percorso));
});

test("una cartella che esiste già non viene riusata né toccata", async (t) => {
  const radice = await radiceProvvisoria(t);
  const { percorso } = await creaCartellaProgetto(radice, "videogioco", "Il primo brief.");
  await writeFile(join(percorso, "lavoro.txt"), "ore di lavoro");

  await assert.rejects(
    () => creaCartellaProgetto(radice, "videogioco", "Un altro brief."),
    (errore) => errore instanceof CartellaNonCreata && /esiste già/.test(errore.message),
  );
  assert.equal(await readFile(join(percorso, "lavoro.txt"), "utf8"), "ore di lavoro");
  assert.match(await readFile(join(percorso, "BRIEF.md"), "utf8"), /Il primo brief\./);
});

test("un nome che porterebbe fuori dalla cartella dei progetti viene rifiutato", async (t) => {
  const radice = await radiceProvvisoria(t);
  for (const nome of ["../fuori", "a/b", "a\\b", "", ".nascosta", "con", "Maiuscole"]) {
    await assert.rejects(
      () => creaCartellaProgetto(radice, nome, "Brief."),
      (errore) => errore instanceof CartellaNonCreata,
      nome,
    );
  }
  assert.equal(existsSync(join(radice, "..", "fuori")), false);
});

test("un progetto può nascere con una copia dei file di un'altra cartella", async (t) => {
  const radice = await radiceProvvisoria(t);
  const origine = join(radice, "_home", "argomento");
  await mkdir(join(origine, "sito"), { recursive: true });
  await mkdir(join(origine, ".git"));
  await mkdir(join(origine, "node_modules", "x"), { recursive: true });
  await writeFile(join(origine, "sito", "index.html"), "<h1>Club</h1>");
  await writeFile(join(origine, "appunti.md"), "Manca il calendario.");
  await writeFile(join(origine, "BRIEF.md"), "Un brief vecchio.");
  await writeFile(join(origine, ".git", "config"), "[core]");
  await writeFile(join(origine, "node_modules", "x", "index.js"), "x");

  const { percorso, filePortati } = await creaCartellaProgetto(radice, "sito-del-club", "Il sito del club.", origine);
  assert.equal(filePortati, 3);
  assert.equal(await readFile(join(percorso, "sito", "index.html"), "utf8"), "<h1>Club</h1>");
  assert.equal(await readFile(join(percorso, "appunti.md"), "utf8"), "Manca il calendario.");
  // Il brief del progetto vince su un file omonimo, e repository e dipendenze non si copiano.
  assert.match(await readFile(join(percorso, "BRIEF.md"), "utf8"), /Il sito del club\./);
  assert.equal(existsSync(join(percorso, ".git", "config")) && (await readFile(join(percorso, ".git", "config"), "utf8")) === "[core]", false);
  assert.equal(existsSync(join(percorso, "node_modules")), false);
  // Gli originali restano dove sono.
  assert.equal(await readFile(join(origine, "appunti.md"), "utf8"), "Manca il calendario.");

  // Una cartella di partenza che non c'è non impedisce la nascita del progetto.
  const senza = await creaCartellaProgetto(radice, "altro", "Brief.", join(radice, "_home", "mai-esistita"));
  assert.equal(senza.filePortati, 0);
});

test("una cartella che esiste già si adotta così com'è, senza scriverci nulla", async (t) => {
  const radice = await mkdtemp(join(tmpdir(), "shinka-adotta-"));
  t.after(() => rm(radice, { recursive: true, force: true }));
  const gioco = join(radice, "Rougue AFK");
  await mkdir(join(gioco, "node_modules", "x"), { recursive: true });
  await mkdir(join(gioco, ".claude"), { recursive: true });
  await writeFile(join(gioco, "README.md"), "Portaluce\n");
  const prima = (await readdir(gioco, { recursive: true })).sort();

  const adottata = await adottaCartella(`${gioco}${sep}`);
  assert.equal(adottata.percorso, await realpath(gioco));
  assert.equal(adottata.git, false);
  assert.equal(adottata.filePortati, 0);
  // Niente brief scritto, niente repository creato, niente toccato.
  assert.deepEqual((await readdir(gioco, { recursive: true })).sort(), prima);

  await mkdir(join(gioco, ".git"));
  assert.equal((await adottaCartella(gioco)).git, true);

  await assert.rejects(adottaCartella(join(radice, "non-ce")), (errore) => errore instanceof CartellaNonCreata && /non esiste/.test(errore.message));
  await assert.rejects(adottaCartella(join(gioco, "README.md")), (errore) => errore instanceof CartellaNonCreata && /non è una cartella/.test(errore.message));
  await assert.rejects(adottaCartella("Rougue AFK"), (errore) => errore instanceof CartellaNonCreata && /percorso completo/.test(errore.message));
  await assert.rejects(adottaCartella("  "), CartellaNonCreata);
});
