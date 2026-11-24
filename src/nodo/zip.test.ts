import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import test, { type TestContext } from "node:test";
import { vociDellaCartella, zipDellaCartella } from "./zip.ts";

const conPython = (() => {
  try {
    execFileSync("python3", ["-I", "-c", "import zipfile"]);
    return true;
  } catch {
    return false;
  }
})();

function cartellaProvvisoria(t: TestContext): string {
  const cartella = mkdtempSync(join(tmpdir(), "shinka-zip-"));
  t.after(() => rmSync(cartella, { recursive: true, force: true }));
  return cartella;
}

async function scriviZip(radice: string, base: string, file: string): Promise<void> {
  await pipeline(Readable.from(zipDellaCartella(radice, base)), createWriteStream(file));
}

/** Python legge l'archivio, controlla ogni CRC e dice nomi e contenuti. */
function leggiConPython(file: string): { nomi: string[]; contenuti: Record<string, string>; difettoso: string | null; zip64: boolean } {
  const codice = `
import json, sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
    difettoso = z.testzip()
    nomi = z.namelist()
    contenuti = {n: z.read(n).hex() for n in nomi if not n.endswith("/") and z.getinfo(n).file_size < 100000}
    print(json.dumps({"nomi": nomi, "contenuti": contenuti, "difettoso": difettoso, "zip64": len(nomi) >= 65535}))
`;
  return JSON.parse(execFileSync("python3", ["-I", "-c", codice, file], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
}

test("una cartella diventa uno ZIP che Python legge, con i CRC giusti, i nomi in UTF-8 e le cartelle vuote", { skip: conPython ? false : "manca python3" }, async (t) => {
  const qui = cartellaProvvisoria(t);
  const radice = join(qui, "gioco");
  mkdirSync(join(radice, "src", "livelli"), { recursive: true });
  mkdirSync(join(radice, "vuota"));
  mkdirSync(join(radice, ".git"));
  writeFileSync(join(radice, "LEGGIMI.md"), "# Il gioco\n".repeat(500));
  writeFileSync(join(radice, "src", "salto.ts"), "export const salto = 3;\n");
  writeFileSync(join(radice, "src", "livelli", "città.json"), '{"nome":"città"}');
  writeFileSync(join(radice, ".git", "HEAD"), "ref: refs/heads/main\n");
  writeFileSync(join(radice, "foto.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]));
  writeFileSync(join(radice, "vuoto.txt"), "");
  // Un collegamento a un file dentro entra; uno che porta fuori no; uno a una cartella non si segue.
  writeFileSync(join(qui, "segreto.txt"), "fuori");
  symlinkSync(join(radice, "src", "salto.ts"), join(radice, "collegato.ts"));
  symlinkSync(join(qui, "segreto.txt"), join(radice, "fuori.txt"));
  symlinkSync(join(radice, "src"), join(radice, "giro"));

  const file = join(qui, "gioco.zip");
  await scriviZip(radice, "gioco", file);
  const letto = leggiConPython(file);
  assert.equal(letto.difettoso, null);
  assert.deepEqual(letto.nomi.sort(), [
    "gioco/.git/HEAD",
    "gioco/LEGGIMI.md",
    "gioco/collegato.ts",
    "gioco/foto.png",
    "gioco/src/livelli/città.json",
    "gioco/src/salto.ts",
    "gioco/vuota/",
    "gioco/vuoto.txt",
  ]);
  const testo = (nome: string): string => Buffer.from(letto.contenuti[nome] ?? "", "hex").toString("utf8");
  assert.equal(testo("gioco/LEGGIMI.md"), "# Il gioco\n".repeat(500));
  assert.equal(testo("gioco/collegato.ts"), "export const salto = 3;\n");
  assert.equal(testo("gioco/src/livelli/città.json"), '{"nome":"città"}');
  assert.equal(letto.contenuti["gioco/foto.png"], "89504e4700010203");
  assert.equal(testo("gioco/vuoto.txt"), "");
});

// Crea oltre 65.535 file e ci mette una ventina di secondi: gira nelle prove dell'installazione
// (CI=1) e quando lo si chiede con SHINKA_PROVE_LENTE, non nelle prove mirate di chi sviluppa.
const lenteAccese = process.env.CI !== undefined || process.env.SHINKA_PROVE_LENTE !== undefined;

test("oltre i 65.535 file l'archivio passa a ZIP64", { skip: !conPython ? "manca python3" : lenteAccese ? false : "prova lenta: gira con CI o SHINKA_PROVE_LENTE", timeout: 120_000 }, async (t) => {
  const qui = cartellaProvvisoria(t);
  const radice = join(qui, "tanti");
  for (let cartella = 0; cartella < 66; cartella++) {
    mkdirSync(join(radice, `c${cartella}`), { recursive: true });
    for (let numero = 0; numero < 1000; numero++) writeFileSync(join(radice, `c${cartella}`, `${numero}.txt`), `${cartella}-${numero}`);
  }
  assert.equal((await vociDellaCartella(radice, "tanti")).length, 66_000);
  const file = join(qui, "tanti.zip");
  await scriviZip(radice, "tanti", file);
  const letto = leggiConPython(file);
  assert.equal(letto.difettoso, null);
  assert.equal(letto.nomi.length, 66_000);
  assert.equal(Buffer.from(letto.contenuti["tanti/c65/999.txt"] ?? "", "hex").toString(), "65-999");
});

test("una cartella vuota è un archivio con la sola cartella", { skip: conPython ? false : "manca python3" }, async (t) => {
  const qui = cartellaProvvisoria(t);
  mkdirSync(join(qui, "niente"));
  const file = join(qui, "niente.zip");
  await scriviZip(join(qui, "niente"), "niente", file);
  assert.deepEqual(leggiConPython(file).nomi, ["niente/"]);
});
