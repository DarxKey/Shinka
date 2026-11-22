/**
 * Un plugin di Claude Code finto, in un repository Git vero sul disco: serve ai test per prendere
 * un plugin fermo a un commit e leggerne il contenuto, senza la rete.
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { gitVero } from "../nodo/estensioni.ts";

async function git(cartella: string, ...argomenti: string[]): Promise<string> {
  const fatto = await gitVero(cartella, ["-c", "user.name=Prova", "-c", "user.email=prova@esempio.it", "-c", "commit.gpgsign=false", ...argomenti]);
  assert.equal(fatto.codice, 0, `git ${argomenti.join(" ")}: ${fatto.uscita}`);
  return fatto.uscita;
}

export interface RepositoryDiProva {
  /** La cartella del repository: fa da indirizzo. */
  repository: string;
  /** Il primo commit, con l'etichetta "v1": una skill, un comando, un aggancio e un server dichiarato. */
  primo: string;
  /** Il secondo commit, in cima al ramo "main": in più ha un agente. */
  secondo: string;
}

export async function repositoryDiProva(t: TestContext): Promise<RepositoryDiProva> {
  const base = await mkdtemp(join(tmpdir(), "shinka-plugin-"));
  t.after(() => rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const repository = join(base, "plugin-di-prova");
  await mkdir(join(repository, ".claude-plugin"), { recursive: true });
  await mkdir(join(repository, "skills", "saluta"), { recursive: true });
  await mkdir(join(repository, "commands"), { recursive: true });
  await mkdir(join(repository, "hooks"), { recursive: true });
  await writeFile(
    join(repository, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "di-prova", version: "0.1.0", description: "Un plugin per i test.", mcpServers: { interno: { command: "node" } } }),
  );
  await writeFile(join(repository, "skills", "saluta", "SKILL.md"), "---\nname: saluta\ndescription: Saluta.\n---\nSaluta.\n");
  await writeFile(join(repository, "commands", "riassumi.md"), "Riassumi.\n");
  await writeFile(
    join(repository, "hooks", "hooks.json"),
    JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "node controlla.js" }] }] } }),
  );
  await git(repository, "init", "--quiet", "--initial-branch=main");
  await git(repository, "add", "-A");
  await git(repository, "commit", "--quiet", "-m", "primo");
  const primo = await git(repository, "rev-parse", "HEAD");
  await git(repository, "tag", "v1");
  await mkdir(join(repository, "agents"), { recursive: true });
  await writeFile(join(repository, "agents", "revisore.md"), "Rivedi.\n");
  await git(repository, "add", "-A");
  await git(repository, "commit", "--quiet", "-m", "secondo");
  const secondo = await git(repository, "rev-parse", "HEAD");
  return { repository, primo, secondo };
}
