/**
 * «Approva sempre» (e «Accesso a tutto il computer»): la regola che l'harness propone si salva nelle
 * impostazioni locali del progetto, e tutto il computer diventa come la cartella del progetto.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { CanUseTool, Options, PermissionResult, PermissionUpdate, Query } from "@anthropic-ai/claude-agent-sdk";
import type { EventoConversazione } from "../protocollo/eventi.ts";
import { Conversazione, radiciDiQuestaMacchina, regolaInParole, regoleDaSalvare } from "./conversazione.ts";

const PROPOSTE: PermissionUpdate[] = [
  { type: "addRules", rules: [{ toolName: "Bash", ruleContent: "npm test:*" }], behavior: "allow", destination: "session" },
  { type: "addDirectories", directories: ["C:\\Users\\mario\\AppData\\Roaming\\app"], destination: "session" },
  { type: "setMode", mode: "bypassPermissions", destination: "session" },
  { type: "addRules", rules: [{ toolName: "Bash", ruleContent: "rm:*" }], behavior: "deny", destination: "session" },
];

test("si salvano solo le regole che consentono e le cartelle, nelle impostazioni locali del progetto", () => {
  const salvate = regoleDaSalvare(PROPOSTE);
  assert.deepEqual(salvate.map((una) => [una.type, una.destination]), [["addRules", "localSettings"], ["addDirectories", "localSettings"]]);
  assert.equal(regolaInParole(salvate), "Bash(npm test:*), la cartella C:\\Users\\mario\\AppData\\Roaming\\app");
  assert.equal(regolaInParole(regoleDaSalvare(undefined)), undefined);
  assert.deepEqual(radiciDiQuestaMacchina("linux"), ["/"]);
  assert.deepEqual(radiciDiQuestaMacchina("win32", (radice) => radice === "C:\\" || radice === "H:\\"), ["C:\\", "H:\\"]);
});

function harnessFinto(): Query {
  let chiudi: () => void = () => {};
  const chiuso = new Promise<void>((fatto) => (chiudi = fatto));
  return {
    [Symbol.asyncIterator]: () => ({ next: async () => (await chiuso, { value: undefined, done: true as const }) }),
    close: () => chiudi(),
    getContextUsage: async () => ({ categories: [], totalTokens: 1, maxTokens: 10, percentage: 0 }),
    usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => ({}),
    supportedCommands: async () => [],
    supportedModels: async () => [],
  } as unknown as Query;
}

test("approvato per sempre, l'harness riceve la regola da salvare; tutto il computer diventa una cartella del progetto", async (t) => {
  const eventi: EventoConversazione[] = [];
  let opzioni: Options | undefined;
  const conversazione = new Conversazione(
    {
      cartella: process.cwd(),
      istruzioni: "Rispondi in breve.",
      strumenti: "claude-code",
      strumentiSenzaRichiesta: [],
      impostazioni: { permessi: "modifiche-libere", tuttoIlPc: true },
      alEvento: (evento) => eventi.push(evento),
      alIdSessione: () => {},
    },
    { avvia: ({ options }) => ((opzioni = options), harnessFinto()) },
  );
  t.after(() => conversazione.chiudi());
  conversazione.prepara();
  assert.deepEqual(opzioni?.additionalDirectories, radiciDiQuestaMacchina());
  const chiedi = opzioni?.canUseTool as CanUseTool;
  const ingresso = { command: "npm test" };
  const risposta: Promise<PermissionResult | null> = chiedi("Bash", ingresso, { signal: new AbortController().signal, toolUseID: "toolu_1", suggestions: PROPOSTE } as Parameters<CanUseTool>[2]);
  const richiesto = eventi.find((evento) => evento.tipo === "permesso-richiesto");
  assert.ok(richiesto?.tipo === "permesso-richiesto");
  assert.equal(richiesto.regola, "Bash(npm test:*), la cartella C:\\Users\\mario\\AppData\\Roaming\\app");
  assert.equal(conversazione.decidiPermesso("toolu_1", "approvato", true), true);
  const esito = await risposta;
  assert.equal(esito?.behavior, "allow");
  assert.deepEqual(esito?.behavior === "allow" ? esito.updatedPermissions?.map((una) => una.destination) : [], ["localSettings", "localSettings"]);
  assert.deepEqual(eventi.at(-1), { tipo: "permesso-deciso", idPermesso: "toolu_1", decisione: "approvato", sempre: true });

  // Approvato una volta sola, nulla si salva.
  const seconda = chiedi("Bash", ingresso, { signal: new AbortController().signal, toolUseID: "toolu_2", suggestions: PROPOSTE } as Parameters<CanUseTool>[2]);
  conversazione.decidiPermesso("toolu_2", "approvato");
  const unaVolta = await seconda;
  assert.equal(unaVolta?.behavior === "allow" ? unaVolta.updatedPermissions : "no", undefined);
});

test("dalla chat del progetto «Approva sempre» arriva alla conversazione, anche su un nodo", async (t) => {
  const { allestisci, avviaNodoAccettato, finche, ID_NODO } = await import("../prove/banco.ts");
  const { COOKIE_SESSIONE } = await import("../centro/centro.ts");
  const banco = await allestisci(t);
  const nodo = await avviaNodoAccettato(t, banco);
  const progetto = await banco.lavori.crea("Sul nodo", ID_NODO, "Un lavoro.");
  await finche(() => nodo.conversazioni.length === 1, "il nodo apre la conversazione");
  const conversazione = nodo.conversazioni[0];
  assert.ok(conversazione !== undefined);
  conversazione.emetti({ tipo: "permesso-richiesto", idPermesso: "p1", idAzione: "p1", strumento: "Bash", ingresso: { command: "npm test" }, regola: "Bash(npm test:*)" });
  await finche(() => banco.lavori.canale(progetto.id)?.sospesi.permessi === 1, "il permesso arriva al centro");
  const risposta = await banco.centro.inject({
    method: "POST",
    url: `/api/progetti/${progetto.id}/permessi/p1`,
    cookies: { [COOKIE_SESSIONE]: await banco.entra() },
    payload: { decisione: "approvato", sempre: true },
  });
  assert.equal(risposta.statusCode, 200, risposta.body);
  await finche(() => conversazione.sempre.includes("p1"), "il nodo riceve «sempre»");
});
