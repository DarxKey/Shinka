/**
 * Una prova sull'harness vero del controllo che Shinka mette davanti al browser del PC: che in
 * ogni modo dei permessi l'azione aspetti il proprietario, parta con il suo sì e non parta con il
 * suo no. Il browser non viene toccato: al posto dei suoi strumenti c'è un campanello di prova, e
 * il controllo è quello vero, puntato sul campanello. In più, con una conversazione vera di Shinka
 * nel modo "chiedi sempre", guarda che la scheda del consenso continui a funzionare.
 * Usa l'abbonamento del proprietario per una decina di risposte brevi.
 *
 *   node src/prove/consenso-del-browser.ts
 */

import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fonteConfigurata } from "../harness/autenticazione.ts";
import { Conversazione, opzioniHarness, type ChiediConsenso } from "../nodo/conversazione.ts";
import { configurazioneDiProgetto } from "../nodo/profili.ts";
import type { EventoConversazione } from "../protocollo/eventi.ts";
import type { ModoPermessi } from "../protocollo/impostazioni.ts";

const RICHIESTA = "Usa lo strumento mcp__prova__tocca una volta sola, poi rispondi con una parola.";
/** Quanto il proprietario finto ci mette a decidere. */
const DECIDE_DOPO_MS = 3000;

function campanello(): { server: ReturnType<typeof createSdkMcpServer>; suonate: () => number } {
  let suonate = 0;
  const server = createSdkMcpServer({
    name: "prova",
    version: "1.0.0",
    tools: [
      tool("tocca", "Tocca il campanello di prova e dice che ha suonato.", {}, async () => {
        suonate += 1;
        return { content: [{ type: "text", text: "Il campanello ha suonato." }] };
      }),
    ],
  });
  return { server, suonate: () => suonate };
}

let fallite = 0;
function riferisci(che: Record<string, unknown>, bene: boolean): void {
  if (!bene) fallite += 1;
  console.log(`${bene ? "bene " : "MALE "} ${JSON.stringify(che)}`);
}

/** Il controllo vero di Shinka, davanti al campanello, in un modo dei permessi. */
async function conIlControllo(permessi: ModoPermessi, approva: boolean): Promise<void> {
  const { server, suonate } = campanello();
  let chieste = 0;
  let harnessHaChiesto = 0;
  let suonateAllaDecisione = -1;
  const chiedi: ChiediConsenso = async (_strumento, _ingresso, _idAzione, segnale) => {
    chieste += 1;
    await new Promise((fatto) => setTimeout(fatto, DECIDE_DOPO_MS));
    suonateAllaDecisione = suonate();
    if (segnale.aborted) return { approvato: false, motivo: "Richiesta annullata." };
    return approva ? { approvato: true } : { approvato: false, motivo: "Il proprietario ha negato questa azione." };
  };
  const cartella = mkdtempSync(join(tmpdir(), "shinka-consenso-"));
  const cfg = configurazioneDiProgetto(cartella, undefined, { permessi }, () => {}, () => {}, { browserDelPc: true });
  const vere = opzioniHarness(
    cfg,
    fonteConfigurata(),
    undefined,
    { permessi, modello: "haiku" },
    async (_strumento, ingresso) => {
      harnessHaChiesto += 1;
      return { behavior: "allow", updatedInput: ingresso };
    },
    [],
    chiedi,
  );
  // Tutto come in una conversazione di progetto con il browser del PC, tranne due cose: l'estensione
  // del browser non viene collegata, e il controllo guarda il campanello invece dei suoi strumenti.
  const { extraArgs: _senzaIlBrowserVero, ...opzioni } = vere;
  const controllo = vere.hooks?.PreToolUse?.[0];
  if (controllo === undefined) throw new Error("Con il browser del PC acceso il controllo dev'esserci.");
  let esito = "nessun risultato";
  for await (const messaggio of query({
    prompt: RICHIESTA,
    options: {
      ...opzioni,
      mcpServers: { ...opzioni.mcpServers, prova: server },
      hooks: { PreToolUse: [{ ...controllo, matcher: "mcp__prova__.*" }] },
    },
  })) {
    if (messaggio.type === "result") esito = messaggio.subtype;
  }
  riferisci(
    { controllo: "di Shinka", permessi, proprietario: approva ? "approva" : "nega", chieste, harnessHaChiesto, suonatePrimaDellaDecisione: suonateAllaDecisione, suonate: suonate(), esito },
    chieste === 1 && suonateAllaDecisione === 0 && suonate() === (approva ? 1 : 0) && esito === "success",
  );
}

/** Una conversazione vera di Shinka nel modo "chiedi sempre": la scheda del consenso, approvata o negata. */
async function conLaScheda(approva: boolean): Promise<void> {
  const { server, suonate } = campanello();
  const eventi: EventoConversazione[] = [];
  let finito: () => void = () => {};
  const concluso = new Promise<void>((fatto) => (finito = fatto));
  const cartella = mkdtempSync(join(tmpdir(), "shinka-consenso-"));
  const impostazioni = { permessi: "chiedi" as const, modello: "haiku" };
  let conversazione: Conversazione | undefined;
  const cfg = configurazioneDiProgetto(
    cartella,
    undefined,
    impostazioni,
    (evento) => {
      eventi.push(evento);
      if (evento.tipo === "permesso-richiesto") {
        setTimeout(() => conversazione?.decidiPermesso(evento.idPermesso, approva ? "approvato" : "negato"), DECIDE_DOPO_MS);
      }
      if (evento.tipo === "turno-concluso" || evento.tipo === "errore") finito();
    },
    () => {},
  );
  conversazione = new Conversazione({ ...cfg, strumentiNostri: () => ({ ...cfg.strumentiNostri?.(), prova: server }) });
  conversazione.invia(RICHIESTA);
  await concluso;
  conversazione.chiudi();
  const richieste = eventi.filter((evento) => evento.tipo === "permesso-richiesto");
  const decise = eventi.filter((evento) => evento.tipo === "permesso-deciso");
  const errori = eventi.filter((evento) => evento.tipo === "errore");
  riferisci(
    { controllo: "scheda del consenso", permessi: "chiedi", proprietario: approva ? "approva" : "nega", richieste: richieste.length, decise: decise.length, suonate: suonate(), errori: errori.length },
    richieste.length === 1 && decise.length === 1 && suonate() === (approva ? 1 : 0) && errori.length === 0,
  );
}

for (const permessi of ["chiedi", "modifiche-libere", "automatico", "senza-permessi"] as const) {
  await conIlControllo(permessi, true);
  await conIlControllo(permessi, false);
}
await conLaScheda(true);
await conLaScheda(false);
console.log(fallite === 0 ? "TUTTO BENE" : `${fallite} prove non sono andate come dovevano`);
process.exit(fallite === 0 ? 0 : 1);
