/**
 * Una conversazione con un modello locale (ADR 0051): Claude Code parla con il server di quel
 * modello, il primo messaggio aspetta che il server risponda, e alla fine il modello si lascia.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Options, Query, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { EventoConversazione } from "../protocollo/eventi.ts";
import { Conversazione } from "./conversazione.ts";
import type { ModelliLocali, PresaDelModello } from "./modelli-locali.ts";

/** Un harness finto che legge i messaggi che gli arrivano, e finisce quando lo si chiude. */
function harnessCheLegge(prompt: string | AsyncIterable<SDKUserMessage>, letti: SDKUserMessage[]): Query {
  let chiudi: () => void = () => {};
  const chiuso = new Promise<void>((fatto) => (chiudi = fatto));
  if (typeof prompt !== "string") {
    void (async () => {
      for await (const messaggio of prompt) letti.push(messaggio);
    })().catch(() => {});
  }
  const finto = {
    [Symbol.asyncIterator]: () => ({ next: async () => (await chiuso, { value: undefined, done: true as const }) }),
    close: () => chiudi(),
    getContextUsage: async () => ({ model: "qwen-prova", categories: [], totalTokens: 10, maxTokens: 98_304, percentage: 0 }),
    usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => ({}),
    supportedCommands: async () => [],
    supportedModels: async () => [],
  };
  return finto as unknown as Query;
}

function conModello(presa: PresaDelModello | { motivo: string }, chiesti: [string, string | undefined][]): ModelliLocali {
  return {
    prendi: (modello: string, impegno?: string) => (chiesti.push([modello, impegno]), presa),
    modelli: () => [],
  } as unknown as ModelliLocali;
}

async function finche(condizione: () => boolean, cosa: string): Promise<void> {
  for (const fine = Date.now() + 5_000; !condizione(); ) {
    if (Date.now() > fine) throw new Error(`Non è successo: ${cosa}`);
    await new Promise((fatto) => setTimeout(fatto, 10));
  }
}

test("con un modello locale Claude Code parla con il suo server, e il primo messaggio aspetta che risponda", async (t) => {
  let accendi: () => void = () => {};
  let lasciato = 0;
  const presa: PresaDelModello = {
    modello: "qwen-prova",
    indirizzo: "http://127.0.0.1:8080",
    contesto: 98_304,
    uscita: 32_000,
    pronto: new Promise<void>((fatto) => (accendi = fatto)),
    vramPiccoMb: () => 23_700,
    lascia: () => (lasciato += 1),
  };
  const chiesti: [string, string | undefined][] = [];
  const letti: SDKUserMessage[] = [];
  let opzioni: Options | undefined;
  const eventi: EventoConversazione[] = [];
  const conversazione = new Conversazione(
    {
      cartella: process.cwd(),
      istruzioni: "Rispondi in breve.",
      strumenti: "claude-code",
      strumentiSenzaRichiesta: [],
      impostazioni: { modello: "locale:qwen", impegno: "medium", permessi: "modifiche-libere" },
      modelliLocali: conModello(presa, chiesti),
      alEvento: (evento) => eventi.push(evento),
      alIdSessione: () => {},
    },
    { avvia: ({ prompt, options }) => ((opzioni = options), harnessCheLegge(prompt, letti)) },
  );
  t.after(() => conversazione.chiudi());
  conversazione.invia("Scrivi somma.");
  assert.deepEqual(chiesti, [["locale:qwen", "medium"]]);
  const ambiente = opzioni?.env ?? {};
  assert.equal(ambiente.ANTHROPIC_BASE_URL, "http://127.0.0.1:8080");
  assert.equal(ambiente.ANTHROPIC_MODEL, "qwen-prova");
  assert.equal(ambiente.CLAUDE_CODE_MAX_CONTEXT_TOKENS, "98304");
  assert.equal(ambiente.CLAUDE_CODE_MAX_OUTPUT_TOKENS, "32000");
  assert.equal(ambiente.ANTHROPIC_API_KEY, undefined);
  assert.equal(opzioni?.model, "qwen-prova");
  assert.equal(opzioni?.effort, undefined);
  assert.deepEqual(opzioni?.disallowedTools, ["WebSearch", "WebFetch"]);
  assert.equal(opzioni?.strictMcpConfig, true);

  await new Promise((fatto) => setTimeout(fatto, 100));
  assert.equal(letti.length, 0, "il messaggio aspetta il server");
  accendi();
  await finche(() => letti.length === 1, "il messaggio parte quando il server risponde");
  conversazione.chiudi();
  await finche(() => lasciato === 1, "chiusa la conversazione, il modello si lascia");
});

test("se il modello locale non si può prendere, la conversazione lo dice e il turno finisce", async (t) => {
  const eventi: EventoConversazione[] = [];
  const conversazione = new Conversazione(
    {
      cartella: process.cwd(),
      istruzioni: "Rispondi in breve.",
      strumenti: [],
      strumentiSenzaRichiesta: [],
      impostazioni: { modello: "locale:qwen", permessi: "chiedi" },
      modelliLocali: conModello({ motivo: "Il modello locale \"qwen\" è acceso con impegno xhigh e lo sta usando un'altra conversazione: aspetta che finisca." }, []),
      alEvento: (evento) => eventi.push(evento),
      alIdSessione: () => {},
    },
    { avvia: ({ prompt }) => harnessCheLegge(prompt, []) },
  );
  t.after(() => conversazione.chiudi());
  conversazione.invia("Scrivi somma.");
  await finche(() => eventi.some((evento) => evento.tipo === "turno-concluso"), "il turno finisce");
  const errore = eventi.find((evento) => evento.tipo === "errore");
  assert.match(errore?.tipo === "errore" ? errore.messaggio : "", /^Il modello locale non è pronto: .*acceso con impegno xhigh/);
  assert.deepEqual(eventi.find((evento) => evento.tipo === "turno-concluso"), { tipo: "turno-concluso", riuscito: false, durataMs: 0, errore: "La conversazione si è chiusa prima della risposta." });
  assert.match((await conversazione.chiediAParte("Che cosa fai?") as { motivo: string }).motivo, /modello locale/);
});

test("il picco della scheda video arriva prima della fine del turno, che chiude l'incarico", async (t) => {
  const presa: PresaDelModello = {
    modello: "qwen-prova",
    indirizzo: "http://127.0.0.1:8080",
    contesto: 98_304,
    uscita: 32_000,
    pronto: Promise.resolve(),
    vramPiccoMb: () => 23_650,
    lascia: () => {},
  };
  const eventi: EventoConversazione[] = [];
  /** Un harness che, letto il primo messaggio, risponde con la fine del turno e poi resta acceso. */
  const harnessCheRisponde = (prompt: string | AsyncIterable<SDKUserMessage>): Query => {
    const uscite: unknown[] = [];
    let sveglia: () => void = () => {};
    let chiuso = false;
    if (typeof prompt !== "string") {
      void (async () => {
        for await (const _messaggio of prompt) {
          uscite.push({ type: "result", subtype: "success", is_error: false, result: "Fatto.", num_turns: 3, duration_ms: 1200, duration_api_ms: 1100, usage: { input_tokens: 900, output_tokens: 80 } });
          sveglia();
        }
      })().catch(() => {});
    }
    const finto = {
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          while (uscite.length === 0 && !chiuso) await new Promise<void>((fatto) => (sveglia = fatto));
          return chiuso ? { value: undefined, done: true as const } : { value: uscite.shift(), done: false as const };
        },
      }),
      close: () => ((chiuso = true), sveglia()),
      getContextUsage: async () => ({ model: "qwen-prova", categories: [], totalTokens: 10, maxTokens: 98_304, percentage: 0 }),
      usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => ({}),
      supportedCommands: async () => [],
      supportedModels: async () => [],
    };
    return finto as unknown as Query;
  };
  const conversazione = new Conversazione(
    {
      cartella: process.cwd(),
      istruzioni: "Rispondi in breve.",
      strumenti: [],
      strumentiSenzaRichiesta: [],
      impostazioni: { modello: "locale:qwen", permessi: "chiedi" },
      modelliLocali: conModello(presa, []),
      alEvento: (evento) => eventi.push(evento),
      alIdSessione: () => {},
    },
    { avvia: ({ prompt }) => harnessCheRisponde(prompt) },
  );
  t.after(() => conversazione.chiudi());
  conversazione.invia("Scrivi somma.");
  await finche(() => eventi.some((evento) => evento.tipo === "turno-concluso"), "il turno finisce");
  const vram = eventi.findIndex((evento) => evento.tipo === "stato" && evento.stato.modelloLocale?.vramPiccoMb === 23_650);
  const fine = eventi.findIndex((evento) => evento.tipo === "turno-concluso");
  assert.ok(vram !== -1 && vram < fine, `picco a ${vram}, fine del turno a ${fine}`);
});
