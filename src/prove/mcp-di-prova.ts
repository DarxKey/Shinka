/**
 * Un server MCP piccolissimo, per le prove: parla sullo standard input e output, una riga di JSON
 * per messaggio. Offre due strumenti: `saluta`, che dice chi è, e `ha_la_chiave`, che dice se ha
 * ricevuto la variabile CHIAVE_DI_PROVA, senza mai ripeterne il valore.
 *
 * Variabili d'ambiente:
 *   MCP_DI_PROVA_NOME   il nome con cui saluta (predefinito: "mcp-di-prova")
 *   MCP_DI_PROVA_ROTTO  se vale "1", esce subito con un errore: un'estensione che non parte
 *   CHIAVE_DI_PROVA     una chiave finta
 */

import { createInterface } from "node:readline";

const nome = process.env.MCP_DI_PROVA_NOME ?? "mcp-di-prova";

if (process.env.MCP_DI_PROVA_ROTTO === "1") {
  console.error("mcp-di-prova: rotto apposta, non parto.");
  process.exit(1);
}

interface Richiesta {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

const STRUMENTI = [
  {
    name: "saluta",
    description: "Risponde con un saluto che dice quale server ha risposto.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "ha_la_chiave",
    description: "Dice se il server ha ricevuto la sua chiave, senza mostrarla.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

function rispondi(id: string | number, risultato: unknown): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result: risultato })}\n`);
}

function rifiuta(id: string | number, codice: number, messaggio: string): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code: codice, message: messaggio } })}\n`);
}

function testo(contenuto: string): unknown {
  return { content: [{ type: "text", text: contenuto }] };
}

function chiama(strumento: unknown): unknown {
  if (strumento === "saluta") return testo(`Ciao da ${nome}.`);
  if (strumento === "ha_la_chiave") {
    const chiave = process.env.CHIAVE_DI_PROVA;
    return testo(chiave === undefined || chiave === "" ? "No, nessuna chiave." : `Sì, una chiave di ${chiave.length} caratteri.`);
  }
  return { content: [{ type: "text", text: `Strumento sconosciuto: ${String(strumento)}` }], isError: true };
}

const righe = createInterface({ input: process.stdin });
righe.on("line", (riga) => {
  let richiesta: Richiesta;
  try {
    richiesta = JSON.parse(riga) as Richiesta;
  } catch {
    return;
  }
  const { id, method, params } = richiesta;
  // Una notifica non vuole risposta.
  if (id === undefined) return;
  if (method === "initialize") {
    rispondi(id, {
      protocolVersion: typeof params?.protocolVersion === "string" ? params.protocolVersion : "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: nome, version: "0.0.1" },
    });
  } else if (method === "ping") rispondi(id, {});
  else if (method === "tools/list") rispondi(id, { tools: STRUMENTI });
  else if (method === "tools/call") rispondi(id, chiama(params?.name));
  else rifiuta(id, -32601, `Metodo sconosciuto: ${method}`);
});
righe.on("close", () => process.exit(0));
