/**
 * Una prova sull'harness vero: come rispondere allo strumento delle domande di Claude Code
 * (AskUserQuestion) da un controllo messo prima dello strumento, in ogni modo dei permessi.
 * Il controllo consente lo strumento e gli dà le risposte nell'ingresso; la prova dice se
 * l'harness chiede comunque il consenso e che cosa arriva a Claude come risultato.
 * Poi fa lo stesso con la conversazione di Shinka, nei quattro modi: risponde dalla scheda, e
 * risponde scrivendo un messaggio. Usa l'abbonamento del proprietario per poche risposte brevi.
 *
 *   node src/prove/domande-e-harness.ts [modi...]
 */

import { query, type Options, type PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ambientePerHarness, fonteConfigurata } from "../harness/autenticazione.ts";
import { Conversazione } from "../nodo/conversazione.ts";
import type { EventoConversazione } from "../protocollo/eventi.ts";
import type { ModoPermessi } from "../protocollo/impostazioni.ts";

type Risposta = "risposte" | "in-chat";

async function giro(modo: PermissionMode, risposta: Risposta): Promise<void> {
  let consensoChiesto = 0;
  let controlloChiamato = 0;
  let risultato = "";
  const opzioni: Options = {
    cwd: mkdtempSync(join(tmpdir(), "shinka-domande-")),
    env: ambientePerHarness(fonteConfigurata()),
    systemPrompt: {
      type: "custom",
      prompt:
        "Prima di rispondere usa lo strumento AskUserQuestion una volta sola, con una domanda: quale colore preferisce l'utente, con le opzioni Rosso e Blu. Poi rispondi con il colore scelto, in una parola.",
      snapshot: false,
    },
    tools: ["AskUserQuestion"],
    model: "haiku",
    settingSources: [],
    strictMcpConfig: true,
    permissionMode: modo,
    ...(modo === "bypassPermissions" ? { allowDangerouslySkipPermissions: true } : {}),
    canUseTool: async (_strumento, ingresso) => {
      consensoChiesto += 1;
      return { behavior: "allow", updatedInput: ingresso };
    },
    hooks: {
      PreToolUse: [
        {
          matcher: "AskUserQuestion",
          hooks: [
            async (ingresso) => {
              controlloChiamato += 1;
              const dato = (ingresso as { tool_input: { questions: { question: string }[] } }).tool_input;
              const prima = dato.questions[0]?.question ?? "";
              // Le risposte arrivano nell'ingresso; una risposta scritta in chat arriva come rifiuto motivato:
              // il campo "response" dell'ingresso, dato da un controllo, l'harness lo ignora.
              return {
                hookSpecificOutput:
                  risposta === "risposte"
                    ? {
                        hookEventName: "PreToolUse" as const,
                        permissionDecision: "allow" as const,
                        permissionDecisionReason: "Ha risposto il proprietario.",
                        updatedInput: { ...dato, answers: { [prima]: "Blu" } },
                      }
                    : {
                        hookEventName: "PreToolUse" as const,
                        permissionDecision: "deny" as const,
                        permissionDecisionReason: "Il proprietario non ha scelto tra le opzioni e ha risposto così: «Nessuno dei due: il verde.»",
                      },
              };
            },
          ],
        },
      ],
    },
  };
  let esito = "nessun risultato";
  try {
    for await (const messaggio of query({ prompt: "Ciao.", options: opzioni })) {
      if (messaggio.type === "user") {
        const contenuto = messaggio.message.content;
        if (Array.isArray(contenuto)) {
          for (const pezzo of contenuto) {
            if (pezzo.type === "tool_result") risultato = JSON.stringify(pezzo.content).slice(0, 300);
          }
        }
      }
      if (messaggio.type === "result") esito = `${messaggio.subtype}${"result" in messaggio ? `: ${String(messaggio.result).slice(0, 80)}` : ""}`;
    }
  } catch (errore) {
    esito = `errore: ${errore instanceof Error ? errore.message : String(errore)}`;
  }
  console.log(JSON.stringify({ modo, risposta, controlloChiamato, consensoChiesto, risultato, esito }));
}

/** La conversazione di Shinka con l'harness vero: le domande arrivano come scheda, e le risposte tornano a Claude. */
async function giroInShinka(permessi: ModoPermessi, risposta: Risposta): Promise<void> {
  const eventi: EventoConversazione[] = [];
  let conversazione: Conversazione | undefined;
  const finito = new Promise<void>((fatto) => {
    conversazione = new Conversazione({
      cartella: mkdtempSync(join(tmpdir(), "shinka-domande-")),
      istruzioni:
        "Prima di rispondere usa lo strumento AskUserQuestion una volta sola, con una domanda: quale colore preferisce l'utente, con le opzioni Rosso e Blu. Poi rispondi con il colore scelto, in una parola.",
      strumenti: ["AskUserQuestion"],
      strumentiSenzaRichiesta: [],
      impostazioni: { modello: "haiku", permessi },
      alEvento: (evento) => {
        eventi.push(evento);
        if (evento.tipo === "domande-poste") {
          setTimeout(() => {
            if (risposta === "risposte") conversazione?.rispondiDomande(evento.idDomande, { tipo: "risposte", risposte: ["Blu"] });
            else conversazione?.invia("Nessuno dei due: verde.");
          }, 500);
        }
        if (evento.tipo === "turno-concluso") fatto();
      },
      alIdSessione: () => {},
    });
    conversazione.invia("Ciao.");
  });
  await finito;
  conversazione?.chiudi();
  const poste = eventi.filter((evento) => evento.tipo === "domande-poste").length;
  const chiuse = eventi.flatMap((evento) => (evento.tipo === "domande-chiuse" ? [evento.esito] : []));
  const permessiChiesti = eventi.filter((evento) => evento.tipo === "permesso-richiesto").length;
  const testo = eventi.flatMap((evento) => (evento.tipo === "testo-concluso" ? [evento.testo] : [])).join(" ").slice(0, 80);
  console.log(JSON.stringify({ inShinka: permessi, risposta, poste, chiuse, permessiChiesti, testo }));
}

if (process.env.SOLO_SHINKA !== undefined) {
  for (const permessi of ["chiedi", "modifiche-libere", "automatico", "senza-permessi"] as const) {
    for (const risposta of ["risposte", "in-chat"] as const) await giroInShinka(permessi, risposta);
  }
  process.exit(0);
}

const modi: PermissionMode[] = process.argv.slice(2).length > 0 ? (process.argv.slice(2) as PermissionMode[]) : ["default", "acceptEdits", "auto", "bypassPermissions"];
for (const modo of modi) {
  for (const risposta of ["risposte", "in-chat"] as const) await giro(modo, risposta);
}
process.exit(0);
