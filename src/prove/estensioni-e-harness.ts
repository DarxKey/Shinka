/**
 * Una prova sull'harness vero, prima di scrivere le estensioni (ADR 0011): che cosa succede quando
 * una conversazione riceve da Shinka un server MCP e un plugin, accanto a ciò che l'ambiente ha già.
 *
 * Risponde a cinque domande:
 *   1. i server passati dalla conversazione convivono con quelli dell'ambiente, e chi vince a parità di nome;
 *   2. che cosa l'harness dichiara all'avvio su server, plugin e skill, e con quale provenienza;
 *   3. se un server si può aggiungere e togliere a conversazione aperta;
 *   4. dove finiscono le variabili che un server locale riceve: tra gli argomenti di un processo?
 *   5. se un plugin caricato da una cartella porta con sé i suoi server MCP.
 *
 * Usa l'abbonamento del proprietario per due risposte brevi. Delle estensioni dell'ambiente stampa
 * solo nomi e provenienza.
 */

import { query, type McpServerConfig, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ambientePerHarness, fonteConfigurata } from "../harness/autenticazione.ts";

const SERVER = join(dirname(fileURLToPath(import.meta.url)), "mcp-di-prova.ts");
const CHIAVE_FINTA = "valore-finto-di-prova-7c1e";

function serverDiProva(nome: string, chiave?: string): McpServerConfig {
  return {
    command: process.execPath,
    args: [SERVER],
    env: { MCP_DI_PROVA_NOME: nome, ...(chiave === undefined ? {} : { CHIAVE_DI_PROVA: chiave }) },
  };
}

function scrivi(file: string, contenuto: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, contenuto);
}

// La cartella della conversazione ha un suo `.mcp.json`, come un progetto che ne dichiara di suoi:
// un server con lo stesso nome di quello che passa Shinka, e uno solo suo.
const cartella = mkdtempSync(join(tmpdir(), "shinka-estensioni-"));
scrivi(
  join(cartella, ".mcp.json"),
  JSON.stringify({
    mcpServers: {
      "prova-shinka": { command: process.execPath, args: [SERVER], env: { MCP_DI_PROVA_NOME: "quello-del-progetto" } },
      "solo-del-progetto": { command: process.execPath, args: [SERVER], env: { MCP_DI_PROVA_NOME: "solo-del-progetto" } },
    },
  }),
);

// Un plugin in una cartella, con una skill e un server MCP suo.
const plugin = mkdtempSync(join(tmpdir(), "shinka-plugin-"));
scrivi(
  join(plugin, ".claude-plugin", "plugin.json"),
  JSON.stringify({
    name: "plugin-di-prova",
    version: "0.0.1",
    description: "Plugin di prova",
    // Un server dichiarato nel manifesto, oltre a quello del file .mcp.json accanto.
    mcpServers: { "del-manifesto": { command: process.execPath, args: [SERVER], env: { MCP_DI_PROVA_NOME: "del-manifesto" } } },
  }),
);
scrivi(join(plugin, "skills", "saluto-di-prova", "SKILL.md"), "---\nname: saluto-di-prova\ndescription: Saluta in modo formale. Solo per prova.\n---\n\nScrivi: Buongiorno.\n");
scrivi(
  join(plugin, ".mcp.json"),
  JSON.stringify({ mcpServers: { "del-plugin": { command: process.execPath, args: [SERVER], env: { MCP_DI_PROVA_NOME: "del-plugin" } } } }),
);

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
const domanda = (testo: string): SDKUserMessage => ({ type: "user", message: { role: "user", content: testo }, parent_tool_use_id: null });

/** Quanti processi hanno la chiave finta tra i loro argomenti, e quali programmi sono. */
function processiConLaChiave(): string[] {
  try {
    if (process.platform === "win32") {
      const uscita = execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${CHIAVE_FINTA}*' -and $_.Name -ne 'powershell.exe' } | ForEach-Object { $_.Name }`,
        ],
        { encoding: "utf8" },
      );
      return uscita.split(/\r?\n/).filter((riga) => riga.trim() !== "");
    }
    const uscita = execFileSync("sh", ["-c", `grep -l -a -- '${CHIAVE_FINTA}' /proc/[0-9]*/cmdline 2>/dev/null | wc -l`], { encoding: "utf8" });
    return [`${uscita.trim()} processi`];
  } catch (errore) {
    return [`non letto: ${errore instanceof Error ? errore.message.split("\n")[0] : String(errore)}`];
  }
}

const chiamate: string[] = [];
const sessione = query({
  prompt: coda(),
  options: {
    cwd: cartella,
    env: ambientePerHarness(fonteConfigurata()),
    model: "haiku",
    tools: { type: "preset", preset: "claude_code" },
    permissionMode: "default",
    canUseTool: async (strumento, ingresso) => {
      chiamate.push(strumento);
      return { behavior: "allow", updatedInput: ingresso };
    },
    // Come un progetto di Shinka: valgono le impostazioni dell'ambiente, più ciò che passa Shinka.
    mcpServers: { "prova-shinka": serverDiProva("quello-di-shinka", CHIAVE_FINTA) },
    plugins: [{ type: "local", path: plugin }],
  },
});

async function stato(titolo: string): Promise<void> {
  const server = await sessione.mcpServerStatus();
  console.log(`\n== ${titolo}: ${server.length} server`);
  for (const uno of server) {
    console.log(`   ${uno.name}: ${uno.status}, scope=${uno.scope ?? "-"}, source=${uno.source ?? "-"}, strumenti=${uno.tools?.length ?? "-"}${uno.error === undefined ? "" : `, errore=${uno.error.slice(0, 120)}`}`);
  }
}

metti(
  domanda(
    "Fai tre cose e poi rispondi in una riga per ciascuna con il testo esatto ricevuto: " +
      "1) chiama lo strumento saluta del server MCP prova-shinka; 2) chiama ha_la_chiave dello stesso server; " +
      "3) chiama saluta del server del plugin (del-plugin), se c'è.",
  ),
);

let risultati = 0;
for await (const messaggio of sessione) {
  if (messaggio.type === "system" && messaggio.subtype === "init") {
    console.log(`== Avvio: Claude Code ${messaggio.claude_code_version}`);
    console.log(`   server: ${messaggio.mcp_servers.map((uno) => `${uno.name} (${uno.status}, ${uno.source ?? "-"})`).join("; ")}`);
    console.log(`   plugin: ${messaggio.plugins.map((uno) => uno.name).join(", ")}`);
    if (messaggio.plugin_errors !== undefined && messaggio.plugin_errors.length > 0) console.log(`   errori dei plugin: ${JSON.stringify(messaggio.plugin_errors).slice(0, 400)}`);
    console.log(`   skill: ${messaggio.skills.length} in tutto; di prova: ${messaggio.skills.filter((nome) => nome.includes("prova")).join(", ") || "nessuna"}`);
    console.log(`   strumenti dei server di prova: ${messaggio.tools.filter((nome) => /prova|plugin/.test(nome) && nome.startsWith("mcp__")).join(", ") || "nessuno tra quelli caricati subito"}`);
    await stato("Stato dei server all'avvio");
    if (process.env.SOLO_AVVIO === "1") {
      await new Promise((fatto) => setTimeout(fatto, 4000));
      await stato("Quattro secondi dopo");
      process.exit(0);
    }
    console.log(`\n== Processi con la chiave finta tra gli argomenti: ${processiConLaChiave().join(", ") || "nessuno"}`);
    continue;
  }
  if (messaggio.type !== "result") continue;
  risultati += 1;
  console.log(`\n== Risposta ${risultati} (${messaggio.subtype}):\n${"result" in messaggio ? messaggio.result : ""}`);
  console.log(`   strumenti chiesti finora: ${chiamate.join(", ")}`);
  if (risultati === 1) {
    // A conversazione aperta: se ne aggiunge uno, lasciando quello che c'era.
    const esito = await sessione.setMcpServers({
      "prova-shinka": serverDiProva("quello-di-shinka", CHIAVE_FINTA),
      "aggiunto-dopo": serverDiProva("aggiunto-dopo"),
    });
    console.log(`\n== Aggiunta a conversazione aperta: ${JSON.stringify(esito)}`);
    await stato("Dopo l'aggiunta");
    metti(domanda("Chiama lo strumento saluta del server MCP aggiunto-dopo e riporta il testo esatto."));
  } else {
    const esito = await sessione.setMcpServers({ "prova-shinka": serverDiProva("quello-di-shinka", CHIAVE_FINTA) });
    console.log(`\n== Tolto a conversazione aperta: ${JSON.stringify(esito)}`);
    await stato("Dopo averlo tolto");
    metti(undefined);
  }
}
setTimeout(() => process.exit(0), 300);
