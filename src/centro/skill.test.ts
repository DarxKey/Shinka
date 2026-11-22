import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { scomponiSkill } from "../protocollo/skill.ts";
import { RegistroSkill, SkillRifiutata } from "./skill.ts";

async function registroDiProva(t: TestContext): Promise<RegistroSkill> {
  const cartella = await mkdtemp(join(tmpdir(), "shinka-skill-"));
  t.after(() => rm(cartella, { recursive: true, force: true, maxRetries: 3 }));
  return RegistroSkill.apri(join(cartella, "skill"));
}

const BACKUP = {
  nome: "backup-foto",
  descrizione: "Quando il proprietario chiede di salvare le foto del telefono sul NAS.",
  contenuto: "1. Collega il telefono.\n2. Copia la cartella DCIM in /mnt/foto.",
  motivo: "Il backup di oggi è riuscito al primo colpo",
};

test("una skill creata è un file che Claude Code sa leggere, dentro un plugin", async (t) => {
  const registro = await registroDiProva(t);
  assert.deepEqual(registro.elenco(), []);
  assert.equal(await registro.salva(BACKUP, "Home"), "creata");

  const file = await readFile(join(registro.cartella, "skills", "backup-foto", "SKILL.md"), "utf8");
  assert.ok(file.startsWith('---\nname: backup-foto\ndescription: "Quando il proprietario chiede'));
  assert.deepEqual(scomponiSkill(file), { descrizione: BACKUP.descrizione, contenuto: BACKUP.contenuto });
  assert.deepEqual(JSON.parse(await readFile(join(registro.cartella, ".claude-plugin", "plugin.json"), "utf8")).name, "shinka");

  assert.partialDeepStrictEqual(registro.elenco(), [
    { nome: "backup-foto", descrizione: BACKUP.descrizione, modifiche: 1 },
  ]);
  assert.deepEqual(await registro.daDistribuire(), [{ nome: "backup-foto", file }]);

  // Riaperto, il registro ritrova skill e storia.
  const riaperto = await RegistroSkill.apri(registro.cartella);
  assert.equal(riaperto.elenco().length, 1);
});

test("ogni modifica è nella storia, con il motivo e da dove viene, e si vede com'era prima", async (t) => {
  const registro = await registroDiProva(t);
  const stati: number[] = [];
  registro.ascolta((stato) => stati.push(stato.skill[0]?.modifiche ?? 0));
  await registro.salva(BACKUP, "Home");
  const migliorata = { ...BACKUP, contenuto: `${BACKUP.contenuto}\n3. Controlla che il numero dei file coincida.`, motivo: "Mancava la verifica" };
  assert.equal(await registro.salva(migliorata, 'Progetto "Archivio foto"'), "modificata");
  // Salvata uguale, non lascia traccia.
  assert.equal(await registro.salva(migliorata, "Home"), "invariata");
  assert.deepEqual(stati, [1, 2]);

  const dettaglio = await registro.leggi("backup-foto");
  assert.ok(dettaglio);
  assert.equal(dettaglio.contenuto, migliorata.contenuto);
  assert.partialDeepStrictEqual(dettaglio.storia, [
    { tipo: "modificata", motivo: "Mancava la verifica", origine: 'Progetto "Archivio foto"' },
    { tipo: "creata", motivo: BACKUP.motivo, origine: "Home" },
  ]);

  const [modifica, creazione] = dettaglio.storia;
  assert.ok(modifica !== undefined && creazione !== undefined);
  assert.deepEqual(await registro.versioni("backup-foto", modifica.id), {
    prima: { descrizione: BACKUP.descrizione, contenuto: BACKUP.contenuto },
    dopo: { descrizione: BACKUP.descrizione, contenuto: migliorata.contenuto },
  });
  assert.deepEqual(await registro.versioni("backup-foto", creazione.id), {
    dopo: { descrizione: BACKUP.descrizione, contenuto: BACKUP.contenuto },
  });
  // Una modifica che non è di quella skill non si guarda.
  assert.equal(await registro.versioni("altra-skill", modifica.id), undefined);
  assert.equal(await registro.versioni("backup-foto", "HEAD"), undefined);
});

test("annullare una modifica riporta la skill a com'era, e annullare la creazione la toglie", async (t) => {
  const registro = await registroDiProva(t);
  await registro.salva(BACKUP, "Home");
  await registro.salva({ ...BACKUP, contenuto: "Tutto sbagliato.", motivo: "Riscritta" }, "Home");
  const storia = (await registro.leggi("backup-foto"))?.storia ?? [];
  const [modifica, creazione] = storia;
  assert.ok(modifica !== undefined && creazione !== undefined);

  assert.equal(await registro.annulla("backup-foto", modifica.id, "Proprietario"), true);
  const tornata = await registro.leggi("backup-foto");
  assert.equal(tornata?.contenuto, BACKUP.contenuto);
  // L'annullamento è a sua volta nella storia: nulla si perde.
  assert.partialDeepStrictEqual(tornata?.storia[0], { tipo: "annullata", origine: "Proprietario" });
  assert.equal(tornata?.storia.length, 3);

  assert.equal(await registro.annulla("backup-foto", "0".repeat(40), "Proprietario"), false);
  assert.equal(await registro.annulla("backup-foto", creazione.id, "Proprietario"), true);
  assert.deepEqual(registro.elenco(), []);
  assert.equal(await registro.leggi("backup-foto"), undefined);
  assert.equal(existsSync(join(registro.cartella, "skills", "backup-foto")), false);
});

test("una skill dal nome strano, vuota o con un segreto non viene salvata", async (t) => {
  const registro = await registroDiProva(t);
  for (const rifiutata of [
    { ...BACKUP, nome: "Backup Foto" },
    { ...BACKUP, nome: "../fuori" },
    { ...BACKUP, descrizione: "  " },
    { ...BACKUP, contenuto: "" },
    { ...BACKUP, contenuto: "Entra con password: Fritz!2024 e copia." },
  ]) {
    await assert.rejects(() => registro.salva(rifiutata, "Home"), SkillRifiutata, JSON.stringify(rifiutata));
  }
  assert.deepEqual(registro.elenco(), []);
});
