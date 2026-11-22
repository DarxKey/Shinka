/**
 * Una prova sull'harness vero: come far passare dal proprietario uno strumento anche nei modi dei
 * permessi in cui l'harness non chiede nulla ("automatico" e "senza permessi"). Per ogni modo
 * guarda tre controlli messi prima dello strumento: uno che risponde "chiedi", uno che aspetta e
 * poi nega, uno che aspetta e poi consente. Dice se la richiesta di consenso arriva, e se lo
 * strumento parte. Usa l'abbonamento del proprietario per poche risposte brevi.
 *
 *   node src/prove/consenso-negli-altri-modi.ts
 */

import { createSdkMcpServer, query, tool, type Options, type PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ambientePerHarness, fonteConfigurata } from "../harness/autenticazione.ts";

type Controllo = "chiedi" | "aspetta-e-nega" | "aspetta-e-consente" | "oltre-il-tempo" | "attesa-lunga";
const ATTESA_MS = 4000;

async function giro(modo: PermissionMode, controllo: Controllo): Promise<void> {
  let partito = 0;
  let consensoChiesto = 0;
  let controlloChiamato = 0;
  /** Dopo quanti millisecondi l'harness ha annullato il controllo, se lo ha fatto. */
  let annullatoDopoMs: number | undefined;
  const server = createSdkMcpServer({
    name: "prova",
    version: "1.0.0",
    tools: [
      tool("tocca", "Tocca il campanello di prova e dice che ha suonato.", {}, async () => {
        partito += 1;
        return { content: [{ type: "text", text: "Il campanello ha suonato." }] };
      }),
    ],
  });
  const fonte = fonteConfigurata();
  const opzioni: Options = {
    cwd: mkdtempSync(join(tmpdir(), "shinka-consenso-")),
    env: ambientePerHarness(fonte),
    systemPrompt: { type: "custom", prompt: "Quando ti viene chiesto, usa lo strumento tocca una volta sola, poi rispondi con una parola.", snapshot: false },
    tools: [],
    model: "haiku",
    settingSources: [],
    strictMcpConfig: true,
    mcpServers: { prova: server },
    permissionMode: modo,
    ...(modo === "bypassPermissions" ? { allowDangerouslySkipPermissions: true } : {}),
    canUseTool: async (_strumento, ingresso) => {
      consensoChiesto += 1;
      return { behavior: "allow", updatedInput: ingresso };
    },
    hooks: {
      PreToolUse: [
        {
          matcher: "mcp__prova__.*",
          onFailure: "block",
          // Nell'ultimo controllo l'attesa supera il tempo concesso: si vede se lo strumento parte lo stesso.
          // In "attesa-lunga" il tempo concesso è di dodici ore, e l'attesa supera il minuto che l'harness dà di suo.
          timeout: controllo === "oltre-il-tempo" ? 2 : controllo === "attesa-lunga" ? 43_200 : 60,
          hooks: [
            async (_ingresso, _idAzione, { signal }) => {
              controlloChiamato += 1;
              const chiamato = Date.now();
              signal.addEventListener("abort", () => (annullatoDopoMs = Date.now() - chiamato), { once: true });
              const attesa = controllo === "oltre-il-tempo" ? 8000 : controllo === "attesa-lunga" ? 75_000 : ATTESA_MS;
              if (controllo !== "chiedi") await new Promise((fatto) => setTimeout(fatto, attesa));
              return {
                hookSpecificOutput: {
                  hookEventName: "PreToolUse",
                  permissionDecision: controllo === "chiedi" ? ("ask" as const) : controllo === "aspetta-e-nega" ? ("deny" as const) : ("allow" as const),
                  permissionDecisionReason: "Prova: qui ogni azione passa dal proprietario.",
                },
              };
            },
          ],
        },
      ],
    },
  };
  const inizio = Date.now();
  let esito = "nessun risultato";
  try {
    for await (const messaggio of query({ prompt: "Tocca il campanello.", options: opzioni })) {
      if (messaggio.type === "result") esito = `${messaggio.subtype}${"result" in messaggio ? `: ${String(messaggio.result).slice(0, 80)}` : ""}`;
    }
  } catch (errore) {
    esito = `errore: ${errore instanceof Error ? errore.message : String(errore)}`;
  }
  console.log(
    JSON.stringify({ modo, controllo, controlloChiamato, consensoChiesto, strumentoPartito: partito, annullatoDopoMs, ms: Date.now() - inizio, esito }),
  );
}

// Con SOLO=<controllo> si prova un controllo soltanto; i modi si possono scrivere dopo il nome del file.
const SOLO = process.env.SOLO as Controllo | undefined;
const modi: PermissionMode[] = process.argv.slice(2).length > 0 ? (process.argv.slice(2) as PermissionMode[]) : ["bypassPermissions", "auto"];
for (const modo of modi) {
  for (const controllo of ["chiedi", "aspetta-e-nega", "aspetta-e-consente", "oltre-il-tempo", "attesa-lunga"] as const) {
    if (SOLO !== undefined && controllo !== SOLO) continue;
    await giro(modo, controllo);
  }
}
process.exit(0);
