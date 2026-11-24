/**
 * Gli strumenti di Shinka per una conversazione con Codex. Sono gli stessi server MCP interni che
 * la conversazione con Claude riceve dal Claude Agent SDK: Shinka vi si collega nello stesso
 * processo, con un client MCP, e li offre a Codex come strumenti dinamici dell'app-server, uno
 * spazio per server (per esempio "shinka"). Quando Codex ne chiama uno, lo esegue Shinka.
 */

import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { open } from "node:fs/promises";

/** Uno spazio di strumenti dinamici, come lo vuole `thread/start`. */
export interface SpazioDiStrumenti {
  type: "namespace";
  name: string;
  description: string;
  tools: { type: "function"; name: string; description: string; inputSchema: unknown }[];
}

/** Ciò che torna a Codex da uno strumento: testi e immagini, e se è andato bene. */
export interface EsitoPerCodex {
  contentItems: ({ type: "inputText"; text: string } | { type: "inputImage"; imageUrl: string })[];
  success: boolean;
}

interface Collegato {
  client: Client;
  nomi: Set<string>;
}

export class StrumentiPerCodex {
  readonly #server = new Map<string, Collegato>();
  readonly spazi: SpazioDiStrumenti[];

  private constructor(spazi: SpazioDiStrumenti[]) {
    this.spazi = spazi;
  }

  /** Si collega ai server interni (quelli con un'istanza nello stesso processo) e ne legge gli strumenti. */
  static async apri(server: Record<string, McpServerConfig> | undefined): Promise<StrumentiPerCodex> {
    const spazi: SpazioDiStrumenti[] = [];
    const collegati = new Map<string, Collegato>();
    for (const [nome, configurazione] of Object.entries(server ?? {})) {
      if (configurazione.type !== "sdk" || !("instance" in configurazione)) continue;
      const [lato, latoServer] = InMemoryTransport.createLinkedPair();
      await configurazione.instance.connect(latoServer);
      const client = new Client({ name: "shinka-codex", version: "1" });
      await client.connect(lato);
      const { tools } = await client.listTools();
      collegati.set(nome, { client, nomi: new Set(tools.map((voce) => voce.name)) });
      spazi.push({
        type: "namespace",
        name: nome,
        description: nome === "shinka" ? "Gli strumenti di Shinka: memoria, skill, progetti, argomenti, ambienti, credenziali." : `Gli strumenti di ${nome}.`,
        tools: tools.map((voce) => ({ type: "function", name: voce.name, description: voce.description ?? "", inputSchema: voce.inputSchema })),
      });
    }
    const strumenti = new StrumentiPerCodex(spazi);
    for (const [nome, collegato] of collegati) strumenti.#server.set(nome, collegato);
    return strumenti;
  }

  /** Vero se lo strumento esiste in quello spazio. */
  ha(spazio: string, nome: string): boolean {
    return this.#server.get(spazio)?.nomi.has(nome) === true;
  }

  async esegui(spazio: string, nome: string, argomenti: unknown): Promise<EsitoPerCodex> {
    const collegato = this.#server.get(spazio);
    if (collegato === undefined || !collegato.nomi.has(nome)) {
      return { contentItems: [{ type: "inputText", text: `Lo strumento ${spazio}.${nome} non esiste.` }], success: false };
    }
    try {
      const esito = (await collegato.client.callTool({ name: nome, arguments: (argomenti ?? {}) as Record<string, unknown> }, undefined, { timeout: 24 * 60 * 60 * 1000 })) as {
        content?: { type?: string; text?: string; data?: string; mimeType?: string }[];
        isError?: boolean;
      };
      const contentItems = (esito.content ?? []).flatMap((parte): EsitoPerCodex["contentItems"] => {
        if (parte.type === "text" && typeof parte.text === "string") return [{ type: "inputText", text: parte.text }];
        if (parte.type === "image" && typeof parte.data === "string") return [{ type: "inputImage", imageUrl: `data:${parte.mimeType ?? "image/png"};base64,${parte.data}` }];
        return [];
      });
      return { contentItems: contentItems.length === 0 ? [{ type: "inputText", text: "" }] : contentItems, success: esito.isError !== true };
    } catch (errore) {
      return { contentItems: [{ type: "inputText", text: errore instanceof Error ? errore.message : String(errore) }], success: false };
    }
  }

  chiudi(): void {
    for (const { client } of this.#server.values()) void client.close().catch(() => {});
    this.#server.clear();
  }
}

/** Un valore in JSON con le chiavi in ordine: due schemi uguali danno lo stesso testo. */
function stabile(valore: unknown): string {
  return JSON.stringify(valore, (_chiave, dentro: unknown) =>
    typeof dentro === "object" && dentro !== null && !Array.isArray(dentro)
      ? Object.fromEntries(Object.entries(dentro).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : dentro,
  );
}

/**
 * L'impronta di un elenco di strumenti dinamici: gli spazi, e in ciascuno i nomi degli strumenti con
 * i loro schemi, in ordine. Le descrizioni non contano: cambiarle non chiede un thread nuovo.
 */
export function improntaDegliStrumenti(spazi: readonly unknown[]): string {
  const letti = spazi.flatMap((spazio) => {
    if (typeof spazio !== "object" || spazio === null) return [];
    const { name, tools } = spazio as { name?: unknown; tools?: unknown };
    const strumenti = (Array.isArray(tools) ? tools : [])
      .flatMap((voce: unknown) => (typeof voce === "object" && voce !== null ? [voce as { name?: unknown; inputSchema?: unknown }] : []))
      .map((voce) => [String(voce.name), voce.inputSchema ?? null] as const)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return [[String(name), strumenti] as const];
  });
  return stabile(letti.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** Quanto si legge al massimo della prima riga di una sessione di Codex: istruzioni e strumenti stanno lì. */
const PRIMA_RIGA_MASSIMA = 16 * 1024 * 1024;

/**
 * Gli strumenti dinamici con cui è nato un thread di Codex, dal file della sessione: Codex li scrive
 * nella sua prima riga (`session_meta`) e li tiene per tutta la vita del thread. Undefined se il file
 * non si legge o non li dice; un elenco vuoto se il thread è nato senza.
 */
export async function strumentiDelThread(percorso: string): Promise<unknown[] | undefined> {
  let file;
  try {
    file = await open(percorso, "r");
  } catch {
    return undefined;
  }
  try {
    const pezzi: Buffer[] = [];
    let letti = 0;
    for (;;) {
      const pezzo = Buffer.alloc(256 * 1024);
      const { bytesRead } = await file.read(pezzo, 0, pezzo.length, letti);
      if (bytesRead === 0) break;
      const usato = pezzo.subarray(0, bytesRead);
      const fine = usato.indexOf(10);
      pezzi.push(fine < 0 ? usato : usato.subarray(0, fine));
      letti += bytesRead;
      if (fine >= 0 || letti >= PRIMA_RIGA_MASSIMA) break;
    }
    const riga = JSON.parse(Buffer.concat(pezzi).toString("utf8")) as { type?: unknown; payload?: { dynamic_tools?: unknown } };
    if (riga.type !== "session_meta") return undefined;
    const strumenti = riga.payload?.dynamic_tools;
    return strumenti === undefined || strumenti === null ? [] : Array.isArray(strumenti) ? strumenti : undefined;
  } catch {
    return undefined;
  } finally {
    await file.close();
  }
}
