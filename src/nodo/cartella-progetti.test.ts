import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { preparaCartellaProgetti } from "./cartella-progetti.ts";

test("la cartella dei progetti si accetta solo completa: la si crea se manca, e ci si deve poter scrivere", { skip: process.platform === "win32" ? "percorsi di Linux" : false }, async (t) => {
  const cartella = mkdtempSync(join(tmpdir(), "shinka-cartella-progetti-"));
  t.after(() => rmSync(cartella, { recursive: true, force: true }));
  const nuova = join(cartella, "Progetti", "Shinka");
  assert.deepEqual(await preparaCartellaProgetti(`  ${nuova}/ `), { percorso: nuova });
  assert.ok(existsSync(nuova));
  assert.deepEqual(readdirSync(nuova), [], "il file di prova non resta");

  assert.match(JSON.stringify(await preparaCartellaProgetti("progetti/relativi")), /percorso completo/);
  assert.match(JSON.stringify(await preparaCartellaProgetti("")), /Scrivi il percorso/);
  assert.match(JSON.stringify(await preparaCartellaProgetti("/")), /radice di un disco/);
  // Sopra un file non si crea nulla.
  assert.match(JSON.stringify(await preparaCartellaProgetti(join("/proc", "version", "sotto"))), /non si può usare/);
  // Su Windows vale la lettera del disco.
  assert.match(JSON.stringify(await preparaCartellaProgetti("/home/io", "win32")), /C:\\\\Users/);
  assert.match(JSON.stringify(await preparaCartellaProgetti("C:\\", "win32")), /radice di un disco/);
});
