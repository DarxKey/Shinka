import assert from "node:assert/strict";
import { test } from "node:test";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { Conversazione } from "../conversazione.ts";
import { improntaDegliStrumenti, StrumentiPerCodex, strumentiDelThread } from "./strumenti.ts";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let creati = 0;
const creaStrumenti = () => {
  creati += 1;
  return {
    shinka: createSdkMcpServer({
      name: "shinka",
      version: "1.0.0",
      tools: [tool("segreto", "Dice il segreto.", { per: z.string() }, async ({ per }) => ({ content: [{ type: "text", text: `GIRASOLE per ${per}` }] }))],
    }),
  };
};

test("un server MCP si collega a un solo client per volta: per questo ogni motore crea i suoi strumenti", async () => {
  const condivisi = creaStrumenti();
  const primo = await StrumentiPerCodex.apri(condivisi);
  await assert.rejects(StrumentiPerCodex.apri(condivisi), /Already connected/);
  // Gli strumenti creati di nuovo si collegano anche mentre quelli del motore di prima sono aperti.
  const secondo = await StrumentiPerCodex.apri(creaStrumenti());
  assert.deepEqual(await secondo.esegui("shinka", "segreto", { per: "Codex" }), { contentItems: [{ type: "inputText", text: "GIRASOLE per Codex" }], success: true });
  primo.chiudi();
  secondo.chiudi();
});

test("la conversazione con Claude crea i suoi strumenti una volta sola", () => {
  creati = 0;
  const conversazione = new Conversazione({
    cartella: process.cwd(),
    istruzioni: "claude-code",
    strumenti: "claude-code",
    strumentiSenzaRichiesta: [],
    strumentiNostri: creaStrumenti,
    impostazioni: { permessi: "chiedi" },
    alEvento: () => {},
    alIdSessione: () => {},
  });
  assert.equal(creati, 1);
  conversazione.chiudi();
});

test("l'impronta degli strumenti cambia con nomi e schemi, non con descrizioni e ordine; il file di una sessione dice i suoi", async (t) => {
  const spazio = (strumenti: { name: string; description: string; inputSchema: unknown }[]) => [{ type: "namespace", name: "shinka", description: "x", tools: strumenti.map((voce) => ({ type: "function", ...voce })) }];
  const a = { name: "ricorda", description: "Annota.", inputSchema: { type: "object", properties: { testo: { type: "string" } } } };
  const b = { name: "dimentica", description: "Toglie.", inputSchema: { properties: { voce: { type: "string" } }, type: "object" } };
  const base = improntaDegliStrumenti(spazio([a, b]));
  assert.equal(improntaDegliStrumenti(spazio([b, { ...a, description: "Altro testo." }])), base);
  assert.notEqual(improntaDegliStrumenti(spazio([a])), base);
  assert.notEqual(improntaDegliStrumenti(spazio([a, { ...b, inputSchema: { type: "object", properties: { voce: { type: "number" } } } }])), base);

  const cartella = mkdtempSync(join(tmpdir(), "shinka-sessione-codex-"));
  t.after(() => rmSync(cartella, { recursive: true, force: true }));
  const file = join(cartella, "rollout.jsonl");
  writeFileSync(file, `${JSON.stringify({ type: "session_meta", payload: { id: "t1", base_instructions: "x".repeat(600_000), dynamic_tools: spazio([a, b]) } })}\n{"type":"event"}\n`);
  assert.equal(improntaDegliStrumenti((await strumentiDelThread(file)) ?? []), base);
  writeFileSync(file, `${JSON.stringify({ type: "session_meta", payload: { id: "t2" } })}\n`);
  assert.deepEqual(await strumentiDelThread(file), []);
  assert.equal(await strumentiDelThread(join(cartella, "non-esiste.jsonl")), undefined);
  writeFileSync(file, "non è json\n");
  assert.equal(await strumentiDelThread(file), undefined);
});
