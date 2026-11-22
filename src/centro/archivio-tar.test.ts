import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { archivioTarGz } from "./archivio-tar.ts";

test("tar legge l'archivio: percorsi lunghi, testi, file vuoti e uno script da lanciare", () => {
  const cartella = mkdtempSync(join(tmpdir(), "shinka-tar-"));
  const lungo = `shinka/${"cartella-dal-nome-lungo/".repeat(6)}file.ts`;
  const archivio = archivioTarGz([
    { percorso: "shinka/LEGGIMI.md", dati: Buffer.from("Ciao, è Shinka.\n") },
    { percorso: lungo, dati: Buffer.from("export const x = 1;\n") },
    { percorso: "shinka/vuoto.txt", dati: Buffer.alloc(0) },
    { percorso: "shinka/installa.sh", dati: Buffer.from("#!/bin/sh\necho ok\n"), modo: 0o755 },
  ]);
  writeFileSync(join(cartella, "pacchetto.tar.gz"), archivio);
  execFileSync("tar", ["-xzf", "pacchetto.tar.gz"], { cwd: cartella });
  assert.equal(readFileSync(join(cartella, "shinka/LEGGIMI.md"), "utf8"), "Ciao, è Shinka.\n");
  assert.equal(readFileSync(join(cartella, lungo), "utf8"), "export const x = 1;\n");
  assert.equal(readFileSync(join(cartella, "shinka/vuoto.txt"), "utf8"), "");
  assert.equal(statSync(join(cartella, "shinka/installa.sh")).mode & 0o777, 0o755);
  assert.equal(execFileSync("sh", [join(cartella, "shinka/installa.sh")]).toString(), "ok\n");
});
