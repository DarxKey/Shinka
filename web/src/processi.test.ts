import assert from "node:assert/strict";
import { test } from "node:test";
import type { ProcessoDiShinka } from "../../src/protocollo/risorse.ts";
import { cheCosE, processiPerProgetto } from "./processi.ts";

const p = (pid: number, genitore: number, altro: Partial<ProcessoDiShinka> = {}): ProcessoDiShinka => ({ pid, genitore, nome: `p${pid}`, cpu: 1, memoria: 100, ...altro });

test("i processi vanno ai loro progetti, con i figli sotto; gli altri sono di Shinka", () => {
  const progetti = [
    { id: "a", nome: "Blog", cartella: "/home/node/progetti/blog" },
    { id: "b", nome: "Gioco", cartella: "C:\\Users\\mario\\Desktop\\Gioco" },
  ];
  const gruppi = processiPerProgetto(
    [
      p(10, 0, { nome: "claude", cartella: "/home/node/progetti/blog" }),
      p(11, 10, { nome: "bash", comando: "bash -c npm run dev" }),
      p(12, 11, { nome: "node", cpu: 30 }),
      p(13, 10, { nome: "codegraph", comando: "codegraph serve --mcp" }),
      p(20, 0, { nome: "powershell", comando: "powershell -File C:\\Users\\mario\\Desktop\\gioco\\avvia.ps1" }),
      p(30, 0, { nome: "llama-server", comando: "H:\\llama\\llama-server.exe -m modello.gguf" }),
    ],
    progetti,
  );
  assert.deepEqual(
    gruppi.map((gruppo) => [gruppo.progetto?.nome ?? "Shinka", gruppo.righe.map((riga) => `${riga.processo.pid}:${riga.livello}`)]),
    [
      ["Blog", ["10:0", "11:1", "12:2", "13:1"]],
      ["Gioco", ["20:0"]],
      ["Shinka", ["30:0"]],
    ],
  );
  assert.equal(gruppi[0]?.cpu, 33);
  assert.equal(cheCosE(p(1, 0, { nome: "llama-server" })), "modello locale");
  assert.equal(cheCosE(p(1, 0, { nome: "node", comando: "node /x/codegraph/dist/bin/codegraph.js serve --mcp" })), "CodeGraph");
  assert.equal(cheCosE(p(1, 0, { nome: "bash" })), "shell");
  assert.equal(cheCosE(p(1, 0, { nome: "python" })), undefined);
});
