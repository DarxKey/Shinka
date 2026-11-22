/**
 * Una prova sull'harness vero: che cosa esce quando una nota di Shinka (`shouldQuery: false`)
 * precede un messaggio, e quando arriva mentre un turno è in corso. Serve a sapere quali
 * risultati chiudono un turno e quali no. Usa l'abbonamento del proprietario per due risposte brevi.
 */

import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ambientePerHarness, fonteConfigurata } from "../harness/autenticazione.ts";

const inAttesa: ((messaggio: SDKUserMessage | undefined) => void)[] = [];
const pronti: (SDKUserMessage | undefined)[] = [];
function metti(messaggio: SDKUserMessage | undefined): void {
  const chi = inAttesa.shift();
  if (chi === undefined) pronti.push(messaggio);
  else chi(messaggio);
}
async function* coda(): AsyncGenerator<SDKUserMessage> {
  for (;;) {
    const messaggio = pronti.length > 0 ? pronti.shift() : await new Promise<SDKUserMessage | undefined>((fatto) => inAttesa.push(fatto));
    if (messaggio === undefined) return;
    yield messaggio;
  }
}
const nota = (testo: string): SDKUserMessage => ({ type: "user", message: { role: "user", content: testo }, parent_tool_use_id: null, shouldQuery: false });
const domanda = (testo: string): SDKUserMessage => ({ type: "user", message: { role: "user", content: testo }, parent_tool_use_id: null });

const fonte = fonteConfigurata();
const sessione = query({
  prompt: coda(),
  options: {
    cwd: mkdtempSync(join(tmpdir(), "shinka-nota-")),
    env: ambientePerHarness(fonte),
    systemPrompt: { type: "custom", prompt: "Rispondi con una parola sola.", snapshot: false },
    tools: [],
    model: "haiku",
    settingSources: [],
    strictMcpConfig: true,
    permissionMode: "default",
  },
});

metti(nota("[Shinka] Prima nota."));
metti(nota("[Shinka] Seconda nota."));
metti(domanda("Scrivi: uno"));

let risultati = 0;
const inizio = Date.now();
for await (const messaggio of sessione) {
  if (messaggio.type !== "result") {
    if (messaggio.type === "assistant") {
      console.log(`${Date.now() - inizio} ms assistant`);
      // Una nota che arriva a turno in corso.
      if (risultati < 3) metti(nota("[Shinka] Nota arrivata durante il turno."));
    }
    continue;
  }
  risultati += 1;
  const { subtype, is_error, num_turns, duration_ms, duration_api_ms } = messaggio;
  console.log(
    `${Date.now() - inizio} ms result ${risultati}:`,
    JSON.stringify({ subtype, is_error, num_turns, duration_ms, duration_api_ms, result: "result" in messaggio ? messaggio.result : undefined, usage: messaggio.usage?.output_tokens }),
  );
  if (risultati === 3) setTimeout(() => metti(domanda("Scrivi: due")), 1500);
  if (risultati >= 5) metti(undefined);
}
setTimeout(() => process.exit(0), 200);
setTimeout(() => metti(undefined), 60_000).unref();
