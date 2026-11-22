/**
 * Seconda prova sull'harness vero per le estensioni (ADR 0011), senza nessun turno: non consuma
 * l'abbonamento. Risponde a quattro domande:
 *   1. un processo dell'harness a cui non si scrive nulla risponde alle richieste di controllo;
 *   2. `setMcpServers` toglie i server passati all'avvio che non nomina;
 *   3. una chiave data con `setMcpServers` non compare tra gli argomenti di un processo;
 *   4. che cosa dice `reloadPlugins` dell'ambiente: plugin, server e skill, senza una conversazione.
 */

import { createSdkMcpServer, query, tool, type McpServerConfig, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ambientePerHarness, fonteConfigurata } from "../harness/autenticazione.ts";

const SERVER = join(dirname(fileURLToPath(import.meta.url)), "mcp-di-prova.ts");
const CHIAVE_FINTA = "valore-finto-di-prova-9a3d";

function serverDiProva(nome: string, altro: Record<string, string> = {}): McpServerConfig {
  return { command: process.execPath, args: [SERVER], env: { MCP_DI_PROVA_NOME: nome, ...altro } };
}

/** Una conversazione a cui nessuno scrive: resta aperta finché non la si chiude. */
async function* nessunMessaggio(fine: Promise<void>): AsyncGenerator<SDKUserMessage> {
  await fine;
}

function processiConLaChiave(): string {
  try {
    if (process.platform === "win32") {
      const uscita = execFileSync(
        "powershell.exe",
        ["-NoProfile", "-Command", `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${CHIAVE_FINTA}*' -and $_.Name -ne 'powershell.exe' } | ForEach-Object { $_.Name }`],
        { encoding: "utf8" },
      );
      return uscita.split(/\r?\n/).filter((riga) => riga.trim() !== "").join(", ") || "nessuno";
    }
    return execFileSync("sh", ["-c", `grep -l -a -- '${CHIAVE_FINTA}' /proc/[0-9]*/cmdline 2>/dev/null | wc -l`], { encoding: "utf8" }).trim();
  } catch (errore) {
    return `non letto: ${errore instanceof Error ? errore.message.split("\n")[0] : String(errore)}`;
  }
}

const cartella = mkdtempSync(join(tmpdir(), "shinka-estensioni-"));
const nostro = createSdkMcpServer({ name: "nostro", tools: [tool("eco", "Ripete.", {}, async () => ({ content: [{ type: "text", text: "eco" }] }))] });

// --- 1, 2, 3: una conversazione isolata, come la Home.
{
  let chiudi: () => void = () => {};
  const fine = new Promise<void>((fatto) => (chiudi = fatto));
  const inizio = Date.now();
  const sessione = query({
    prompt: nessunMessaggio(fine),
    options: {
      cwd: cartella,
      env: ambientePerHarness(fonteConfigurata()),
      settingSources: [],
      strictMcpConfig: true,
      mcpServers: { nostro, "da-opzioni": serverDiProva("da-opzioni") },
    },
  });
  // L'harness va letto perché lavori: qui non arriverà nessun messaggio.
  void (async () => {
    for await (const messaggio of sessione) console.log(`   [messaggio ${messaggio.type}]`);
  })().catch(() => {});

  const stato = async (titolo: string): Promise<void> => {
    const server = await sessione.mcpServerStatus();
    console.log(`== ${titolo} (${Date.now() - inizio} ms): ${server.map((uno) => `${uno.name}=${uno.status}/${uno.source ?? uno.scope ?? "-"}/${uno.tools?.length ?? "-"}${uno.error === undefined ? "" : ` errore="${uno.error.slice(0, 80)}"`}`).join("; ")}`);
  };
  await stato("Senza turni, appena partito");
  const aggiunta = await sessione.setMcpServers({ "con-chiave": serverDiProva("con-chiave", { CHIAVE_DI_PROVA: CHIAVE_FINTA }), rotto: serverDiProva("rotto", { MCP_DI_PROVA_ROTTO: "1" }) });
  console.log(`== setMcpServers senza nominare quelli dell'avvio: ${JSON.stringify(aggiunta)}`);
  await stato("Dopo");
  for (let giro = 0; giro < 20; giro += 1) {
    const server = await sessione.mcpServerStatus();
    if (!server.some((uno) => uno.status === "pending")) break;
    await new Promise((fatto) => setTimeout(fatto, 500));
  }
  await stato("Quando nessuno è più in attesa");
  console.log(`== Processi con la chiave tra gli argomenti: ${processiConLaChiave()}`);
  chiudi();
  sessione.close();
}

// --- 4: l'ambiente com'è, senza una conversazione.
{
  let chiudi: () => void = () => {};
  const fine = new Promise<void>((fatto) => (chiudi = fatto));
  const inizio = Date.now();
  const sessione = query({ prompt: nessunMessaggio(fine), options: { cwd: cartella, env: ambientePerHarness(fonteConfigurata()) } });
  void (async () => {
    for await (const messaggio of sessione) console.log(`   [messaggio ${messaggio.type}]`);
  })().catch(() => {});
  const letto = await sessione.reloadPlugins();
  console.log(`== Ambiente, da reloadPlugins (${Date.now() - inizio} ms): ${letto.plugins.length} plugin, ${letto.mcpServers.length} server, ${letto.commands.length} comandi, ${letto.agents.length} agenti, errori ${letto.error_count}`);
  console.log(`   plugin: ${letto.plugins.map((uno) => `${uno.name}${uno.version === undefined ? "" : `@${uno.version}`} [${uno.source ?? "-"}]`).join("; ")}`);
  console.log(`   server: ${letto.mcpServers.map((uno) => `${uno.name}=${uno.status}/${uno.source ?? uno.scope ?? "-"}`).join("; ")}`);
  console.log(`   comandi non di Claude Code: ${letto.commands.filter((uno) => uno.builtin !== true).length}; i primi: ${letto.commands.filter((uno) => uno.builtin !== true).slice(0, 8).map((uno) => uno.name).join(", ")}`);
  chiudi();
  sessione.close();
}
setTimeout(() => process.exit(0), 500);
