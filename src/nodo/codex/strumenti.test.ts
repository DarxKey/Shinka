import assert from "node:assert/strict";
import { test } from "node:test";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { Conversazione } from "../conversazione.ts";
import { StrumentiPerCodex } from "./strumenti.ts";

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
