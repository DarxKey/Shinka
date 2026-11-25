import assert from "node:assert/strict";
import { test } from "node:test";
import { comandoDaEseguire, eUnComando, mandaAlTerminale, registraTerminale } from "./comandi-eseguibili.ts";

test("i blocchi di shell sono comandi, gli altri no", () => {
  for (const linguaggio of ["bash", "sh", "shell", "zsh", "console", "powershell", "pwsh", "ps1", "ps", "cmd", "bat", "Bash"]) assert.equal(eUnComando(linguaggio), true, linguaggio);
  for (const linguaggio of ["", "ts", "python", "json", "text", "yaml"]) assert.equal(eUnComando(linguaggio), false, linguaggio);
});

test("in un blocco console si tengono i comandi senza il prompt, e l'uscita resta fuori", () => {
  assert.equal(comandoDaEseguire("$ npm test\n> shinka@0.0.0 test\nok\n$ git status\n", "console"), "npm test\nshinka@0.0.0 test\ngit status");
  assert.equal(comandoDaEseguire("$ ls -la\ntotale 8\n", "console"), "ls -la");
  assert.equal(comandoDaEseguire("PS C:\\Users\\io> Get-Process\n", "console"), "Get-Process");
  // Senza prompt il blocco va com'è; negli altri linguaggi il "$" resta.
  assert.equal(comandoDaEseguire("npm ci\nnpm test\n\n", "console"), "npm ci\nnpm test");
  assert.equal(comandoDaEseguire("echo $HOME\r\n", "bash"), "echo $HOME");
});

test("un comando aspetta il terminale che si apre, e arriva una volta sola", async () => {
  const arrivati: string[] = [];
  const presto = mandaAlTerminale("p1", "uname -a");
  const smetti = registraTerminale("p1", (testo) => arrivati.push(testo));
  assert.equal(await presto, true);
  assert.equal(await mandaAlTerminale("p1", "ls"), true);
  assert.deepEqual(arrivati, ["uname -a", "ls"]);
  smetti();
  // Nessun terminale che si apre: dopo l'attesa, falso.
  assert.equal(await mandaAlTerminale("p2", "ls", 20), false);
  assert.equal(await mandaAlTerminale("p1", "ls", 20), false);
});
