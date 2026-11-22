import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { AccessiDeiMotori } from "./accessi.ts";

const prove = fileURLToPath(new URL("../prove/", import.meta.url));

function prepara(codexAccede = false) {
  const cartella = mkdtempSync(join(tmpdir(), "shinka-accessi-"));
  const fileClaude = join(cartella, "claude");
  const fileCodex = join(cartella, "codex");
  let cambi = 0;
  const accessi = new AccessiDeiMotori({
    comandoClaude: [process.execPath, join(prove, "claude-finto.ts")],
    comandoCodex: [process.execPath, join(prove, "app-server-finto.ts")],
    env: { ...process.env, FINTO_CLAUDE_ACCESSO: fileClaude, FINTO_CODEX_ACCESSO: fileCodex, ...(codexAccede ? { FINTO_CODEX_ACCEDE: "1" } : {}) },
    dopoIlCambio: () => cambi++,
  });
  return { accessi, fileClaude, fileCodex, cambi: () => cambi };
}

test("senza accessi i due motori risultano scollegati", async () => {
  const { accessi } = prepara();
  assert.deepEqual(await accessi.esegui({ tipo: "stato" }), { accessi: { claude: { collegato: false }, codex: { collegato: false } } });
});

test("Claude: l'indirizzo, poi il codice incollato; un codice sbagliato lo dice", async (t) => {
  const { accessi, fileClaude, cambi } = prepara();
  t.after(() => accessi.chiudi());
  const avviato = await accessi.esegui({ tipo: "avvia", motore: "claude" });
  assert.deepEqual(avviato.inCorso, [{ motore: "claude", indirizzo: "https://claude.com/cai/oauth/authorize?code=true&state=prova", chiedeCodice: true }]);
  const sbagliato = await accessi.esegui({ tipo: "codice", motore: "claude", codice: "codice-sbagliato" });
  assert.match(sbagliato.motivo ?? "", /non è riuscito: OAuth error: Invalid code/);
  assert.equal(sbagliato.inCorso, undefined);

  await accessi.esegui({ tipo: "avvia", motore: "claude" });
  const giusto = await accessi.esegui({ tipo: "codice", motore: "claude", codice: "codice-giusto" });
  assert.equal(giusto.motivo, undefined);
  assert.deepEqual(giusto.accessi?.claude, { collegato: true, descrizione: "Claude Max" });
  assert.ok(existsSync(fileClaude));
  assert.equal(cambi(), 1);

  const uscito = await accessi.esegui({ tipo: "esci", motore: "claude" });
  assert.deepEqual(uscito.accessi?.claude, { collegato: false });
});

test("Codex: l'indirizzo e il codice da scrivere sul sito; l'accesso si conclude da sé", async (t) => {
  const { accessi, cambi } = prepara(true);
  t.after(() => accessi.chiudi());
  const avviato = await accessi.esegui({ tipo: "avvia", motore: "codex" });
  assert.deepEqual(avviato.inCorso, [{ motore: "codex", indirizzo: "https://auth.openai.com/codex/device", codice: "ABCD-12345", chiedeCodice: false }]);
  let stato = avviato;
  for (const fine = Date.now() + 5000; stato.accessi?.codex?.collegato !== true && Date.now() < fine; ) {
    await new Promise((risolvi) => setTimeout(risolvi, 100));
    stato = await accessi.esegui({ tipo: "stato" });
  }
  assert.deepEqual(stato.accessi?.codex, { collegato: true, descrizione: "ChatGPT Plus" });
  assert.equal(stato.inCorso, undefined);
  assert.equal(cambi(), 1);
});

test("Codex: un accesso annullato si chiude", async () => {
  const { accessi } = prepara();
  await accessi.esegui({ tipo: "avvia", motore: "codex" });
  const annullato = await accessi.esegui({ tipo: "annulla", motore: "codex" });
  assert.equal(annullato.inCorso, undefined);
  assert.deepEqual(annullato.accessi?.codex, { collegato: false });
});
