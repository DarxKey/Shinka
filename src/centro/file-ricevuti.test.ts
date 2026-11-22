import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { messaggioDeiFile, nomeSicuro, salvaSenzaSovrascrivere, tipoInBreve } from "./file-ricevuti.ts";

test("un nome di file va bene ovunque: senza cartelle, caratteri vietati o nomi riservati", () => {
  assert.equal(nomeSicuro("Itinerario Tokyo.pdf"), "Itinerario Tokyo.pdf");
  assert.equal(nomeSicuro("../../etc/passwd"), "passwd");
  assert.equal(nomeSicuro("C:\\Users\\x\\nota.txt"), "nota.txt");
  assert.equal(nomeSicuro('a<b>:"c|?*.txt'), "abc.txt");
  assert.equal(nomeSicuro("CON.txt"), "file-CON.txt");
  assert.equal(nomeSicuro(".bashrc"), "file-bashrc");
  assert.equal(nomeSicuro("   "), "file-ricevuto");
  assert.ok(nomeSicuro(`${"a".repeat(300)}.pdf`).endsWith(".pdf"));
});

test("un file con un nome già preso si salva accanto, senza sovrascrivere", async (t) => {
  const cartella = await mkdtemp(join(tmpdir(), "shinka-ricevuti-"));
  t.after(() => rm(cartella, { recursive: true, force: true }));
  const nomi = await Promise.all([1, 2, 3].map((n) => salvaSenzaSovrascrivere(cartella, "foto.jpg", Buffer.from(String(n)))));
  assert.deepEqual([...nomi].sort(), ["foto (2).jpg", "foto (3).jpg", "foto.jpg"]);
  assert.deepEqual((await readdir(cartella)).sort(), ["foto (2).jpg", "foto (3).jpg", "foto.jpg"]);
  const contenuti = await Promise.all(nomi.map((nome) => readFile(join(cartella, nome), "utf8")));
  assert.deepEqual([...contenuti].sort(), ["1", "2", "3"]);
});

test("la Home sa che cosa è arrivato, dove sta e che cosa ha scritto il proprietario", () => {
  const uno = messaggioDeiFile(
    [{ file: { id: "a", nome: "Itinerario.pdf", mime: "application/pdf", byte: 120_000 }, nome: "Itinerario.pdf", byte: 120_000 }],
    "/dati/_home/2026-11-13-abc",
    ["Leggilo e dimmi se va bene"],
  );
  assert.equal(
    uno,
    "📎 Ti mando un file da Telegram: «Itinerario.pdf» (PDF, 120 kB), salvato come `Itinerario.pdf`.\nSono nella cartella di questo argomento, /dati/_home/2026-11-13-abc.\nLeggilo e dimmi se va bene",
  );
  const album = messaggioDeiFile(
    [
      { file: { id: "a", nome: "foto.jpg", mime: "image/jpeg", byte: 900 }, nome: "foto.jpg", byte: 900 },
      { file: { id: "b", nome: "foto.jpg", mime: "image/jpeg", byte: 2_400_000 }, nome: "foto (2).jpg", byte: 2_400_000 },
    ],
    "/x",
    [],
  );
  assert.match(album, /^📎 Ti mando 2 file da Telegram:\n- «foto\.jpg» \(immagine JPEG, 900 byte\), salvato come `foto\.jpg`\n- «foto\.jpg» \(immagine JPEG, 2,4 MB\), salvato come `foto \(2\)\.jpg`/);
  assert.equal(tipoInBreve("application/x-sconosciuto"), "application/x-sconosciuto");
});
