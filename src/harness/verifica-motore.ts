/**
 * Incremento 0: verifica del motore.
 *
 * Apre una sessione dell'harness senza strumenti, fa una domanda secca e controlla che:
 *  1. la risposta arrivi a frammenti, in tempo reale;
 *  2. la sessione usi la fonte di autenticazione configurata (di default l'abbonamento).
 *
 * Esce con codice 0 solo se entrambe le cose sono vere.
 */

import { tmpdir } from "node:os";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { ambientePerHarness, fonteConfigurata, verificaFonte } from "./autenticazione.ts";

const DOMANDA = "Rispondi in una sola frase: qual è la capitale del Giappone?";

/** Modello piccolo: è quello previsto per la Home, e la verifica consuma poca quota. */
const MODELLO = "haiku";

const SPIEGAZIONI: Record<string, string> = {
  authentication_failed:
    "Claude Code non è autenticato su questa macchina. Esegui `claude auth login` e riprova.",
  oauth_org_not_allowed: "l'organizzazione dell'account non consente questo accesso.",
  account_on_hold: "l'account è sospeso.",
  billing_error: "problema di fatturazione sull'account.",
  rate_limit: "la quota del piano è esaurita per ora.",
  overloaded: "il servizio è sovraccarico, riprova tra poco.",
  model_not_found: `il modello "${MODELLO}" non è disponibile per questo account.`,
};

async function verifica(): Promise<boolean> {
  const fonte = fonteConfigurata();
  console.log(`Fonte di autenticazione configurata: ${fonte}`);

  const inizio = Date.now();
  const sessione = query({
    prompt: DOMANDA,
    options: {
      cwd: tmpdir(),
      env: ambientePerHarness(fonte),
      model: MODELLO,
      includePartialMessages: true,
      maxTurns: 1,
      tools: [],
      settingSources: [],
      strictMcpConfig: true,
      persistSession: false,
    },
  });

  let frammenti = 0;
  let primoFrammentoMs: number | undefined;
  let riuscita = false;

  for await (const messaggio of sessione) {
    if (messaggio.type === "system" && messaggio.subtype === "init") {
      console.log(`Harness: Claude Code ${messaggio.claude_code_version}, modello ${messaggio.model}`);
      console.log(`Sorgente della chiave dichiarata dall'harness: ${messaggio.apiKeySource}`);
      verificaFonte(fonte, messaggio.apiKeySource);
      console.log("Risposta:");
    } else if (messaggio.type === "stream_event") {
      const evento = messaggio.event;
      if (evento.type === "content_block_delta" && evento.delta.type === "text_delta") {
        frammenti += 1;
        primoFrammentoMs ??= Date.now() - inizio;
        process.stdout.write(evento.delta.text);
      }
    } else if (messaggio.type === "assistant" && messaggio.error !== undefined) {
      const spiegazione = SPIEGAZIONI[messaggio.error] ?? `errore "${messaggio.error}".`;
      console.error(`\nL'harness segnala: ${spiegazione}`);
    } else if (messaggio.type === "result") {
      riuscita = messaggio.subtype === "success" && !messaggio.is_error;
      const uso = messaggio.usage;
      const inCache = uso.cache_read_input_tokens + uso.cache_creation_input_tokens;
      console.log(
        `\nEsito dell'harness: ${riuscita ? "riuscito" : "fallito"}; durata ${messaggio.duration_ms} ms; ` +
          `token in ingresso ${uso.input_tokens + inCache} (di cui ${inCache} passati dalla cache), ` +
          `in uscita ${uso.output_tokens}`,
      );
    }
  }

  console.log(
    `Frammenti di testo ricevuti: ${frammenti}` +
      (primoFrammentoMs === undefined ? "" : `; il primo dopo ${primoFrammentoMs} ms`),
  );
  return riuscita && frammenti > 0;
}

try {
  const superata = await verifica();
  console.log(superata ? "VERIFICA SUPERATA" : "VERIFICA NON SUPERATA");
  process.exitCode = superata ? 0 : 1;
} catch (errore) {
  console.error(`VERIFICA NON SUPERATA: ${errore instanceof Error ? errore.message : String(errore)}`);
  process.exitCode = 1;
}
