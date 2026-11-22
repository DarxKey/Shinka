import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { FILE_MASSIMI, inBreve, leggiFileDiVersione, percorsoDiVersioneValido, versioneDi, versioneValida } from "./versione.ts";

const VERSIONE = "0123456789abcdef0123456789abcdef01234567";

test("una versione è scritta come nel repository, e in breve se ne mostrano otto caratteri", () => {
  assert.equal(versioneValida(VERSIONE), true);
  assert.equal(versioneValida("d8462b3"), true);
  assert.equal(versioneValida("main"), false);
  assert.equal(versioneValida("../../etc"), false);
  assert.equal(versioneValida(undefined), false);
  assert.equal(inBreve(VERSIONE), "01234567");
});

test("la versione di una cartella è quella scritta nel suo file, se è scritta bene", async (t) => {
  const cartella = await mkdtemp(join(tmpdir(), "shinka-versione-"));
  t.after(() => rm(cartella, { recursive: true, force: true }));
  assert.equal(await versioneDi(cartella), undefined);
  await writeFile(join(cartella, "versione.json"), JSON.stringify({ versione: "non una versione" }));
  assert.equal(await versioneDi(cartella), undefined);
  await writeFile(join(cartella, "versione.json"), JSON.stringify({ versione: VERSIONE }));
  assert.equal(await versioneDi(cartella), VERSIONE);
});

test("un pacchetto porta solo il codice e i file in cima previsti, senza uscire dalla cartella", () => {
  for (const buono of ["package.json", "package-lock.json", "tsconfig.json", "versione.json", "src/nodo/avvio.ts", "src/protocollo/azioni-in-parole.ts"]) {
    assert.equal(percorsoDiVersioneValido(buono), true, buono);
  }
  for (const cattivo of [
    "",
    "src",
    "src/",
    "src/../package.json",
    "src/./avvio.ts",
    "../fuori.ts",
    "/etc/passwd",
    "C:/Windows/system.ini",
    "src\\nodo\\avvio.ts",
    "node_modules/pacchetto/index.js",
    "web/src/App.tsx",
    ".env",
    "src/nodo/avvio.ts ",
    "src//avvio.ts",
    42,
    undefined,
  ]) {
    assert.equal(percorsoDiVersioneValido(cattivo), false, String(cattivo));
  }
});

test("i file di un pacchetto si leggono tutti o nessuno", () => {
  const dati = Buffer.from("ciao").toString("base64");
  assert.deepEqual(leggiFileDiVersione([{ percorso: "src/a.ts", dati, altro: 1 }]), [{ percorso: "src/a.ts", dati }]);
  assert.equal(leggiFileDiVersione([]), undefined);
  assert.equal(leggiFileDiVersione("src/a.ts"), undefined);
  assert.equal(leggiFileDiVersione([{ percorso: "src/a.ts", dati }, { percorso: "../b.ts", dati }]), undefined);
  assert.equal(leggiFileDiVersione([{ percorso: "src/a.ts", dati: 7 }]), undefined);
  // Due nomi che su Windows sono lo stesso file.
  assert.equal(leggiFileDiVersione([{ percorso: "src/a.ts", dati }, { percorso: "src/A.ts", dati }]), undefined);
  assert.equal(leggiFileDiVersione(Array.from({ length: FILE_MASSIMI + 1 }, (_, i) => ({ percorso: `src/f${i}.ts`, dati }))), undefined);
});
