/**
 * La copia delle skill di Shinka che un nodo tiene nel suo ambiente: la stessa cartella che
 * il centro ha come repository, senza la storia. Le conversazioni dell'ambiente la caricano
 * come plugin di Claude Code. Il centro la manda intera ogni volta che cambia.
 */

import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FILE_SKILL, MANIFESTO_PLUGIN, NOME_SKILL, type SkillDistribuita } from "../protocollo/skill.ts";

/** Fa in modo che la cartella sia un plugin valido, anche prima che arrivi la prima skill. */
export async function preparaCartellaSkill(cartella: string): Promise<void> {
  await mkdir(join(cartella, ".claude-plugin"), { recursive: true });
  await mkdir(join(cartella, "skills"), { recursive: true });
  await writeFile(join(cartella, ".claude-plugin", "plugin.json"), MANIFESTO_PLUGIN);
}

/** Rende la cartella uguale all'elenco ricevuto: scrive le skill che ci sono, toglie le altre. */
export async function scriviSkill(cartella: string, skill: readonly SkillDistribuita[]): Promise<void> {
  await preparaCartellaSkill(cartella);
  // Il nome diventa una cartella: uno che non ha la forma attesa non si scrive.
  const valide = skill.filter(({ nome }) => NOME_SKILL.test(nome));
  const nomi = new Set(valide.map(({ nome }) => nome));
  for (const presente of await readdir(join(cartella, "skills"))) {
    if (!nomi.has(presente)) await rm(join(cartella, "skills", presente), { recursive: true, force: true });
  }
  for (const { nome, file } of valide) {
    await mkdir(join(cartella, "skills", nome), { recursive: true });
    await writeFile(join(cartella, "skills", nome, FILE_SKILL), file);
  }
}
