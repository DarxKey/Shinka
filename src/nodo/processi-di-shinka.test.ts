import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { discendenti, ProcessiDiShinka } from "./processi-di-shinka.ts";

test("i discendenti di un processo, nipoti compresi, e nessun altro", () => {
  const tutti = [
    { pid: 1, genitore: 0 },
    { pid: 10, genitore: 1 },
    { pid: 11, genitore: 10 },
    { pid: 12, genitore: 11 },
    { pid: 20, genitore: 1 },
    { pid: 13, genitore: 10 },
  ];
  assert.deepEqual(discendenti(tutti, 10), [11, 13, 12]);
  assert.deepEqual(discendenti(tutti, 99), []);
});

test("si vedono i processi accesi da qui, con la loro cartella, e si termina solo uno di questi", { skip: process.platform !== "linux" ? "legge /proc" : false }, async (t) => {
  const cartella = mkdtempSync(join(tmpdir(), "shinka-processi-"));
  t.after(() => rm(cartella, { recursive: true, force: true }));
  // Un "comando del progetto" che ne avvia un altro, nella cartella del progetto.
  const figlio = spawn(process.execPath, ["-e", "require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }); setInterval(() => {}, 1000)"], { cwd: cartella, stdio: "ignore" });
  t.after(() => figlio.kill("SIGKILL"));
  const processi = new ProcessiDiShinka();
  let elenco = await processi.leggi();
  for (let i = 0; i < 50 && !elenco.some((uno) => uno.genitore === figlio.pid); i++) {
    await new Promise((fatto) => setTimeout(fatto, 100));
    elenco = await processi.leggi();
  }
  const suo = elenco.find((uno) => uno.pid === figlio.pid);
  assert.ok(suo !== undefined, "il figlio c'è");
  assert.equal(suo.genitore, 0);
  assert.equal(suo.cartella, cartella);
  assert.match(suo.comando ?? "", /setInterval/);
  const nipote = elenco.find((uno) => uno.genitore === figlio.pid);
  assert.ok(nipote !== undefined, "il nipote c'è");

  assert.equal((await processi.termina(1)).riuscita, false);
  assert.match((await processi.termina(process.pid)).testo, /non è tra quelli accesi da Shinka/);
  const finito = new Promise((fatto) => figlio.once("exit", fatto));
  assert.equal((await processi.termina(figlio.pid ?? 0)).riuscita, true);
  await finito;
  // Anche ciò che aveva avviato se n'è andato.
  let vivo = true;
  try {
    process.kill(nipote.pid, 0);
  } catch {
    vivo = false;
  }
  assert.equal(vivo, false);
});

test("un processo condiviso, come il server di un modello locale, dice quali progetti lo usano", async () => {
  const processi = new ProcessiDiShinka({
    radice: 1,
    piattaforma: "linux",
    leggi: async () => [
      { pid: 10, genitore: 1, nome: "llama-server", memoria: 8_000, secondi: 5, comando: "llama-server --port 8080" },
      { pid: 11, genitore: 1, nome: "claude", memoria: 1_000, secondi: 1, cartella: "/progetti/videogioco" },
    ],
  });
  processi.conGliUsi(() => new Map([[10, ["/progetti/videogioco", "/progetti/appunti"]]]));
  const letti = await processi.leggi();
  assert.deepEqual(letti.find((uno) => uno.pid === 10)?.usatoDa, ["/progetti/videogioco", "/progetti/appunti"]);
  assert.equal(letti.find((uno) => uno.pid === 11)?.usatoDa, undefined);
});
