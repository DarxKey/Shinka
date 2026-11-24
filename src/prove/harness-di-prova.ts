/**
 * Harness finto per le estensioni: sta al posto di Claude Code quando un ambiente prova
 * un'estensione o guarda ciò che ha già. I server "partono" secondo ciò che il test decide, e
 * tutto ciò che gli viene chiesto resta annotato. Non parte nessun processo.
 */

import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { basename } from "node:path";
import type { AperturaHarness, ApriHarness, HarnessSenzaTurni } from "../nodo/estensioni.ts";

type Stato = Awaited<ReturnType<HarnessSenzaTurni["mcpServerStatus"]>>[number];
type Ambiente = Awaited<ReturnType<HarnessSenzaTurni["reloadPlugins"]>>;

/** Ciò che un ambiente di prova ha già di suo: un server del proprietario, un plugin suo e uno dell'harness. */
export const AMBIENTE_DI_PROVA: Ambiente = {
  plugins: [
    { name: "del-proprietario", path: "/casa/.claude/plugins/del-proprietario", source: "del-proprietario@raccolta", version: "1.2.0" },
    { name: "incluso", path: "/harness/incluso", source: "incluso@builtin" },
  ],
  mcpServers: [
    { name: "appunti", scope: "user", source: "user" },
    { name: "shinka", source: "sdk" },
  ],
  commands: [
    { name: "compact", builtin: true },
    { name: "del-proprietario:riassumi" },
    { name: "mia-skill" },
  ],
  error_count: 0,
};

export interface HarnessDiProva {
  apri: ApriHarness;
  /** Come l'harness è stato aperto, ogni volta. */
  aperture: AperturaHarness[];
  /** I server che gli sono stati dati da avviare, ogni volta, con la loro configurazione per intero. */
  avviati: Record<string, McpServerConfig>[];
  /** Quante volte è stato chiuso. */
  chiusi: number;
}

/**
 * Di suo un server parte e offre due strumenti; non parte se il suo comando è "non-parte", e
 * vuole un accesso con il browser se il suo indirizzo contiene "oauth". Il test può decidere altro.
 */
/** Quanti token pesano gli strumenti di un server, per l'harness finto. */
export const PESO_DI_PROVA = 1234;

export function harnessDiProva(
  opzioni: { stato?(nome: string, configurazione: McpServerConfig): Omit<Stato, "name"> | undefined; ambiente?: Ambiente } = {},
): HarnessDiProva {
  const banco: HarnessDiProva = {
    aperture: [],
    avviati: [],
    chiusi: 0,
    apri: (apertura) => {
      banco.aperture.push(apertura);
      let server: Record<string, McpServerConfig> = {};
      const statoDi = (nome: string, configurazione: McpServerConfig): Omit<Stato, "name"> => {
        const deciso = opzioni.stato?.(nome, configurazione);
        if (deciso !== undefined) return deciso;
        if ("command" in configurazione && configurazione.command === "non-parte") return { status: "failed", error: "Connection closed" };
        if ("url" in configurazione && configurazione.url.includes("oauth")) return { status: "needs-auth" };
        return { status: "connected", tools: [{ name: "saluta" }, { name: "ha_la_chiave" }] };
      };
      return {
        setMcpServers: async (dati) => {
          banco.avviati.push(dati);
          server = dati;
          const errors: Record<string, string> = {};
          for (const [nome, configurazione] of Object.entries(dati)) {
            const stato = statoDi(nome, configurazione);
            if (stato.status === "failed") errors[nome] = stato.error ?? "non è partito";
          }
          return { errors };
        },
        mcpServerStatus: async () => Object.entries(server).map(([nome, configurazione]) => ({ name: nome, ...statoDi(nome, configurazione) })),
        // Come l'harness vero misura gli strumenti di un server collegato: qui un peso fisso.
        pesoDegliStrumenti: async (nome) => (server[nome] === undefined ? undefined : PESO_DI_PROVA),
        reloadPlugins: async () =>
          apertura.isolata
            ? { plugins: (apertura.plugin ?? []).map((cartella) => ({ name: basename(cartella), path: cartella })), mcpServers: [], commands: [], error_count: 0 }
            : (opzioni.ambiente ?? AMBIENTE_DI_PROVA),
        close: () => {
          banco.chiusi += 1;
        },
      };
    },
  };
  return banco;
}
