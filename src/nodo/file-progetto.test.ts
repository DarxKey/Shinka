import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { genereDelFile, linguaggioDi, percorsoRelativoValido } from "../protocollo/file-progetto.ts";
import { cerca, elenca, leggi } from "./file-progetto.ts";

function progetto(t: { after(fn: () => Promise<void>): void }): string {
  const cartella = mkdtempSync(join(tmpdir(), "shinka-file-"));
  t.after(() => rm(cartella, { recursive: true, force: true }));
  mkdirSync(join(cartella, "src", "parti"), { recursive: true });
  mkdirSync(join(cartella, ".git"));
  mkdirSync(join(cartella, "node_modules", "pacchetto"), { recursive: true });
  writeFileSync(join(cartella, "README.md"), "# Ciao\n");
  writeFileSync(join(cartella, "src", "Gioco.ts"), "export const gioco = 1;\n");
  writeFileSync(join(cartella, "src", "parti", "gioco-test.ts"), "");
  writeFileSync(join(cartella, "node_modules", "pacchetto", "gioco.js"), "");
  return cartella;
}

test("una cartella si elenca con prima le sottocartelle, senza .git, e le dimensioni dei file", async (t) => {
  const cartella = progetto(t);
  assert.deepEqual(await elenca(cartella, ""), {
    percorso: "",
    voci: [
      { nome: "node_modules", cartella: true },
      { nome: "src", cartella: true },
      { nome: "README.md", cartella: false, dimensione: 7 },
    ],
  });
  assert.deepEqual((await elenca(cartella, "src")).voci.map((voce) => voce.nome), ["parti", "Gioco.ts"]);
});

test("la ricerca per nome salta le dipendenze e trova anche le cartelle", async (t) => {
  const cartella = progetto(t);
  assert.deepEqual(await cerca(cartella, "gioco"), { percorsi: ["src/Gioco.ts", "src/parti/gioco-test.ts"], incompleta: false });
  assert.deepEqual(await cerca(cartella, "src test"), { percorsi: ["src/parti/gioco-test.ts"], incompleta: false });
  assert.deepEqual(await cerca(cartella, "part"), { percorsi: ["src/parti/"], incompleta: false });
});

test("un file si legge per l'anteprima, ma mai fuori dal progetto, anche con un collegamento", async (t) => {
  const cartella = progetto(t);
  assert.deepEqual(await leggi(cartella, "src/Gioco.ts"), { percorso: "src/Gioco.ts", dimensione: 24, dati: Buffer.from("export const gioco = 1;\n").toString("base64") });
  await assert.rejects(leggi(cartella, "../fuori.txt"), /esce dalla cartella|non c'è|ENOENT/);
  const fuori = mkdtempSync(join(tmpdir(), "shinka-fuori-"));
  t.after(() => rm(fuori, { recursive: true, force: true }));
  writeFileSync(join(fuori, "segreto.txt"), "no");
  symlinkSync(join(fuori, "segreto.txt"), join(cartella, "scorciatoia.txt"));
  await assert.rejects(leggi(cartella, "scorciatoia.txt"), /esce dalla cartella/);
  assert.deepEqual(await leggi(cartella, "src"), { motivo: "È una cartella." });
});

test("i percorsi che risalgono o sono assoluti non valgono; il genere viene dal nome, e il testo va sempre come testo", () => {
  for (const buono of ["", "src/a.ts", "a b/c.md"]) assert.equal(percorsoRelativoValido(buono), true, buono);
  for (const cattivo of ["../a", "src/../../a", "/etc/passwd", "C:/Windows", "\\\\server\\x", "a//b"]) assert.equal(percorsoRelativoValido(cattivo), false, cattivo);
  assert.deepEqual(genereDelFile("foto.PNG"), { genere: "immagine", tipo: "image/png" });
  assert.deepEqual(genereDelFile("pagina.html"), { genere: "testo", tipo: "text/plain; charset=utf-8" });
  assert.deepEqual(genereDelFile("disegno.svg"), { genere: "testo", tipo: "text/plain; charset=utf-8" });
  assert.equal(genereDelFile("note.md").genere, "markdown");
  assert.equal(genereDelFile("film.mp4").genere, "video");
  assert.equal(genereDelFile("doc.pdf").genere, "pdf");
  assert.equal(genereDelFile("archivio.zip").genere, "altro");
  assert.equal(linguaggioDi("src/a.tsx"), "typescript");
  assert.equal(linguaggioDi("docker/Dockerfile"), "dockerfile");
  assert.equal(linguaggioDi("LICENSE"), "");
});
