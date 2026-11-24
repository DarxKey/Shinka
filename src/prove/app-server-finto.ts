/**
 * Un app-server di Codex finto, per le prove: parla lo stesso JSON a righe e recita un copione.
 * Un messaggio con la parola "comando" fa chiedere l'approvazione di un comando; con "modifica"
 * cambia a.txt e crea b.txt nella cartella del thread, con il diff del turno; con "script" un
 * comando cambia a.txt e crea da-script.txt, senza che il diff del turno lo dica; con "piano" manda le
 * cose da fare; con "lento" il turno aspetta un messaggio che vi entri (`turn/steer`) e lo ripete.
 * Ogni turno finisce con i token e i limiti del piano. Tiene i turni di ogni thread,
 * per `thread/read`, `thread/revert` e `thread/fork`. Si avvia come `node app-server-finto.ts app-server`.
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

/** Il file che dice se il Codex finto ha un accesso: c'è, oppure no. */
const fileAccesso = process.env.FINTO_CODEX_ACCESSO;
/**
 * Con una cartella per le sessioni, come il Codex vero: ogni thread nato ha il suo file, la cui prima
 * riga dice gli strumenti dinamici con cui è nato, e `thread/read` ne dice il percorso. I turni di un
 * thread si leggono anche da `<id>.turni.json`, e ciò che si inietta finisce in `iniettati.json`.
 */
const cartellaSessioni = process.env.FINTO_SESSIONI;
const fileDellaSessione = (id: string): string | undefined => (cartellaSessioni === undefined ? undefined : join(cartellaSessioni, `${id}.jsonl`));
const conIlPercorso = (id: string): { path?: string } => {
  const file = fileDellaSessione(id);
  return file !== undefined && existsSync(file) ? { path: file } : {};
};
const turniSalvati = (id: string): unknown[] => {
  if (cartellaSessioni === undefined || !existsSync(join(cartellaSessioni, `${id}.turni.json`))) return [];
  return JSON.parse(readFileSync(join(cartellaSessioni, `${id}.turni.json`), "utf8")) as unknown[];
};

const scrivi = (messaggio: Record<string, unknown>): void => {
  process.stdout.write(`${JSON.stringify(messaggio)}\n`);
};
const notifica = (method: string, params: Record<string, unknown>): void => scrivi({ method, params });
let prossimaRichiesta = 900;
const risposte = new Map<number, (risultato: unknown) => void>();
const chiedi = (method: string, params: Record<string, unknown>): Promise<unknown> =>
  new Promise((risolvi) => {
    const id = prossimaRichiesta++;
    risposte.set(id, risolvi);
    scrivi({ id, method, params });
  });

let turni = 0;
const thread = { id: process.env.FINTO_THREAD ?? "thread-1" };
/** I turni di ogni thread, con i messaggi del proprietario; e la cartella di ciascuno. */
const storia = new Map<string, { id: string; items: Record<string, unknown>[] }[]>();
const cartelle = new Map<string, string>();
let copie = 0;
/** Il turno in corso, e chi aspetta un messaggio che vi entri. */
let turnoInCorso: string | undefined;
let alMessaggioNelTurno: ((testo: string) => void) | undefined;

async function turno(threadId: string, idTurno: string, testo: string): Promise<void> {
  turnoInCorso = idTurno;
  notifica("turn/started", { threadId, turn: { id: idTurno, status: "inProgress", items: [] } });
  notifica("item/started", { threadId, turnId: idTurno, item: { type: "reasoning", id: "r1", summary: [], content: [] } });
  notifica("item/reasoning/summaryTextDelta", { threadId, turnId: idTurno, itemId: "r1", delta: "Penso a ", summaryIndex: 0 });
  notifica("item/reasoning/summaryTextDelta", { threadId, turnId: idTurno, itemId: "r1", delta: "come rispondere.", summaryIndex: 0 });
  notifica("item/completed", { threadId, turnId: idTurno, item: { type: "reasoning", id: "r1", summary: [], content: [] } });
  if (testo.includes("comando")) {
    const voce = { type: "commandExecution", id: "c1", command: "ls -la", cwd: "/progetto", status: "inProgress", aggregatedOutput: null, exitCode: null };
    notifica("item/started", { threadId, turnId: idTurno, item: voce });
    const decisione = (await chiedi("item/commandExecution/requestApproval", { threadId, turnId: idTurno, itemId: "c1", reason: "Serve elencare i file", command: "ls -la" })) as { decision?: string };
    const accettato = decisione.decision === "accept";
    notifica("item/completed", { threadId, turnId: idTurno, item: { ...voce, status: accettato ? "completed" : "declined", aggregatedOutput: accettato ? "file.txt\n" : null, exitCode: accettato ? 0 : null } });
  }
  const cartella = cartelle.get(threadId);
  if (testo.includes("modifica") && cartella !== undefined) {
    const a = join(cartella, "a.txt");
    const b = join(cartella, "b.txt");
    const voce = { type: "fileChange", id: "f1", changes: [{ path: a, kind: { type: "update", move_path: null }, diff: "" }, { path: b, kind: { type: "add" }, diff: "nuovo\n" }], status: "inProgress" };
    notifica("item/started", { threadId, turnId: idTurno, item: voce });
    writeFileSync(a, readFileSync(a, "utf8").replace("due", "DUE"));
    writeFileSync(b, "nuovo\n");
    notifica("item/completed", { threadId, turnId: idTurno, item: { ...voce, status: "completed" } });
    notifica("turn/diff/updated", {
      threadId,
      turnId: idTurno,
      diff: "diff --git a/a.txt b/a.txt\nindex 1..2\n--- a/a.txt\n+++ b/a.txt\n@@ -1,3 +1,3 @@\n uno\n-due\n+DUE\n tre\ndiff --git a/b.txt b/b.txt\nnew file mode 100644\nindex 0..3\n--- /dev/null\n+++ b/b.txt\n@@ -0,0 +1 @@\n+nuovo\n",
    });
  }
  if (testo.includes("script") && cartella !== undefined) {
    // Un comando che cambia dei file: Codex non ne dice nulla nel diff del turno.
    const voce = { type: "commandExecution", id: "c2", command: "sh sistema.sh", cwd: cartella, status: "inProgress", aggregatedOutput: null, exitCode: null };
    notifica("item/started", { threadId, turnId: idTurno, item: voce });
    const a = join(cartella, "a.txt");
    writeFileSync(a, readFileSync(a, "utf8").replace("uno", "UNO"));
    writeFileSync(join(cartella, "da-script.txt"), "scritto da un comando\n");
    notifica("item/completed", { threadId, turnId: idTurno, item: { ...voce, status: "completed", aggregatedOutput: "", exitCode: 0 } });
  }
  if (testo.includes("piano")) {
    notifica("turn/plan/updated", { threadId, turnId: idTurno, explanation: null, plan: [{ step: "Leggere i file", status: "completed" }, { step: "Scrivere la prova", status: "inProgress" }, { step: "Provare", status: "pending" }] });
  }
  let detto = "Ciao, fatto.";
  if (testo.includes("[skill ")) detto = `Ho ricevuto: ${testo}`;
  if (testo.includes("lento")) {
    const entrato = await new Promise<string>((arrivato) => {
      alMessaggioNelTurno = arrivato;
      setTimeout(() => arrivato("nulla"), 3000);
    });
    alMessaggioNelTurno = undefined;
    detto = `Nel turno è entrato: ${entrato}`;
  }
  if (testo.includes("strumento")) {
    const voce = { type: "dynamicToolCall", id: "s1", namespace: "shinka", tool: "segreto", arguments: { per: "prova" }, status: "inProgress", contentItems: null, success: null };
    notifica("item/started", { threadId, turnId: idTurno, item: voce });
    const esito = (await chiedi("item/tool/call", { threadId, turnId: idTurno, callId: "s1", namespace: "shinka", tool: "segreto", arguments: { per: "prova" } })) as { contentItems?: { text?: string }[]; success?: boolean };
    notifica("item/completed", { threadId, turnId: idTurno, item: { ...voce, status: "completed", contentItems: esito.contentItems ?? [], success: esito.success ?? false } });
    detto = `Lo strumento ha detto: ${(esito.contentItems ?? []).map((parte) => parte.text).join(" ")}`;
  }
  if (testo.includes("domanda")) {
    const risposte = (await chiedi("item/tool/requestUserInput", {
      threadId,
      turnId: idTurno,
      itemId: "d1",
      isBlocking: true,
      questions: [{ id: "colore", header: "Colore", question: "Che colore vuoi?", isOther: true, isSecret: false, options: [{ label: "Blu", description: "Il solito" }, { label: "Rosso", description: "" }] }],
    })) as { answers?: Record<string, { answers?: string[] }> };
    detto = `Hai risposto: ${JSON.stringify(risposte.answers ?? {})}`;
  }
  notifica("item/started", { threadId, turnId: idTurno, item: { type: "agentMessage", id: "m1", text: "" } });
  notifica("item/agentMessage/delta", { threadId, turnId: idTurno, itemId: "m1", delta: detto.slice(0, 6) });
  notifica("item/agentMessage/delta", { threadId, turnId: idTurno, itemId: "m1", delta: detto.slice(6) });
  notifica("item/completed", { threadId, turnId: idTurno, item: { type: "agentMessage", id: "m1", text: detto } });
  notifica("thread/tokenUsage/updated", {
    threadId,
    turnId: idTurno,
    tokenUsage: {
      total: { totalTokens: 0, inputTokens: 0, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 },
      last: { totalTokens: 1100, inputTokens: 1000, cachedInputTokens: 600, cacheWriteInputTokens: 0, outputTokens: 100, reasoningOutputTokens: 20 },
      modelContextWindow: 200000,
    },
  });
  (storia.get(threadId) ?? []).find((voce) => voce.id === idTurno)?.items.push({ type: "agentMessage", id: "m1", text: detto });
  turnoInCorso = undefined;
  notifica("turn/completed", { threadId, turn: { id: idTurno, status: "completed", items: [], error: null, durationMs: 1234 } });
}

createInterface({ input: process.stdin }).on("line", (riga) => {
  const messaggio = JSON.parse(riga) as { id?: number; method?: string; params?: Record<string, unknown>; result?: unknown };
  if (messaggio.method === undefined && typeof messaggio.id === "number") {
    risposte.get(messaggio.id)?.(messaggio.result);
    risposte.delete(messaggio.id);
    return;
  }
  const { id, method, params = {} } = messaggio;
  if (id === undefined) return;
  switch (method) {
    case "skills/extraRoots/set":
      process.stderr.write(`skills ${JSON.stringify(params)}\n`);
      return scrivi({ id, result: {} });
    case "initialize":
      return scrivi({ id, result: { userAgent: "finto", codexHome: "/tmp", platformFamily: "unix", platformOs: "linux" } });
    case "thread/start": {
      process.stderr.write(`thread/start ${JSON.stringify(params)}\n`);
      const nuovo = params.ephemeral === true ? { id: `effimero-${++copie}` } : cartellaSessioni === undefined ? thread : { id: `nato-${process.pid}-${++copie}` };
      if (typeof params.cwd === "string") cartelle.set(nuovo.id, params.cwd);
      const file = params.ephemeral === true ? undefined : fileDellaSessione(nuovo.id);
      if (file !== undefined) {
        writeFileSync(file, `${JSON.stringify({ type: "session_meta", payload: { id: nuovo.id, dynamic_tools: params.dynamicTools ?? null } })}\n`);
      }
      return scrivi({ id, result: { thread: { ...nuovo, ...conIlPercorso(nuovo.id) } } });
    }
    case "thread/resume":
      if (params.threadId === "sparito") return scrivi({ id, error: { code: -1, message: "thread non trovato" } });
      if (typeof params.cwd === "string") cartelle.set(String(params.threadId), params.cwd);
      return scrivi({ id, result: { thread: { id: params.threadId } } });
    case "thread/read":
      return scrivi({ id, result: { thread: { id: params.threadId, ...conIlPercorso(String(params.threadId)), turns: storia.get(String(params.threadId)) ?? turniSalvati(String(params.threadId)) } } });
    case "thread/inject_items": {
      if (cartellaSessioni !== undefined) {
        const file = join(cartellaSessioni, "iniettati.json");
        const prima = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as unknown[]) : [];
        writeFileSync(file, JSON.stringify([...prima, params]));
      }
      return scrivi({ id, result: {} });
    }
    case "thread/revert": {
      process.stderr.write(`thread/revert ${JSON.stringify(params)}\n`);
      const tutti = storia.get(String(params.threadId)) ?? [];
      const dove = tutti.findIndex((voce) => voce.id === params.beforeTurnId);
      if (dove < 0) return scrivi({ id, error: { code: -1, message: "turno non trovato" } });
      storia.set(String(params.threadId), tutti.slice(0, dove));
      return scrivi({ id, result: { thread: { id: params.threadId, turns: [] }, turnsBackwardsCursor: null, itemsBackwardsCursor: null } });
    }
    case "thread/fork": {
      process.stderr.write(`thread/fork ${JSON.stringify(params)}\n`);
      const copia = params.ephemeral === true ? `effimero-${++copie}` : `ramo-${++copie}`;
      if (typeof params.cwd === "string") cartelle.set(copia, params.cwd);
      return scrivi({ id, result: { thread: { id: copia } } });
    }
    case "thread/compact/start": {
      scrivi({ id, result: {} });
      const threadId = String(params.threadId);
      turni += 1;
      const idTurno = `turno-${turni}`;
      notifica("turn/started", { threadId, turn: { id: idTurno, status: "inProgress", items: [] } });
      notifica("item/completed", { threadId, turnId: idTurno, item: { type: "contextCompaction", id: "k1" } });
      notifica("turn/completed", { threadId, turn: { id: idTurno, status: "completed", items: [], error: null, durationMs: 10 } });
      return;
    }
    case "account/rateLimits/read":
      return scrivi({ id, result: { rateLimits: { primary: { usedPercent: 12.4, windowDurationMins: 300, resetsAt: 1795000000 }, secondary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: 1795500000 } } } });
    case "model/list":
      return scrivi({ id, result: { data: [{ id: "gpt-5.5", model: "gpt-5.5", displayName: "GPT-5.5", description: "Il più capace", hidden: false, supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "high" }, { reasoningEffort: "minimal" }] }] } });
    case "turn/start": {
      turni += 1;
      const idTurno = `turno-${turni}`;
      scrivi({ id, result: { turn: { id: idTurno, status: "inProgress", items: [] } } });
      // Una skill chiamata arriva accanto al testo, con nome e percorso: il finto la ripete nella risposta.
      const ingresso = (params.input as { type?: string; text?: string; name?: string; path?: string }[] | undefined) ?? [];
      const testo = ingresso.map((voce) => (voce.type === "skill" ? `[skill ${voce.name} ${voce.path}]` : (voce.text ?? ""))).join(" ");
      const delThread = storia.get(String(params.threadId)) ?? [];
      delThread.push({ id: idTurno, items: [{ type: "userMessage", id: `u-${idTurno}`, clientId: params.clientUserMessageId ?? null, content: [{ type: "text", text: testo }] }] });
      storia.set(String(params.threadId), delThread);
      process.stderr.write(`turn/start ${JSON.stringify(params)}\n`);
      void turno(String(params.threadId), idTurno, testo);
      return;
    }
    case "turn/steer": {
      process.stderr.write(`turn/steer ${JSON.stringify(params)}\n`);
      // Come il Codex vero: senza il turno atteso la richiesta non è valida, e con uno che non è in corso viene rifiutata.
      if (typeof params.expectedTurnId !== "string") return scrivi({ id, error: { code: -32600, message: "Invalid request: missing field `expectedTurnId`" } });
      if (params.expectedTurnId !== turnoInCorso) return scrivi({ id, error: { code: -32600, message: "no active turn to steer" } });
      scrivi({ id, result: { turnId: turnoInCorso } });
      alMessaggioNelTurno?.(((params.input as { text?: string }[] | undefined) ?? []).map((voce) => voce.text ?? "").join(" "));
      return;
    }
    case "skills/list":
      process.stderr.write(`skills/list ${JSON.stringify(params)}\n`);
      return scrivi({
        id,
        result: {
          data: [
            {
              cwd: ((params.cwds as string[] | undefined) ?? [])[0] ?? "",
              errors: [],
              skills: [
                { name: "riassumi", description: "Riassume un testo lungo in pochi punti.", path: "/skill/riassumi/SKILL.md", scope: "user", enabled: true, pluginId: null },
                { name: "spenta", description: "Una skill spenta.", path: "/skill/spenta/SKILL.md", scope: "user", enabled: false, pluginId: null },
              ],
            },
          ],
        },
      });
    case "turn/interrupt":
      return scrivi({ id, result: {} });
    case "account/read":
      if (fileAccesso !== undefined && existsSync(fileAccesso)) return scrivi({ id, result: { account: { type: "chatgpt", email: null, planType: "plus" }, requiresOpenaiAuth: true } });
      return scrivi({ id, result: { account: null, requiresOpenaiAuth: true } });
    case "account/login/start":
      scrivi({ id, result: { type: "chatgptDeviceCode", loginId: "accesso-1", verificationUrl: "https://auth.openai.com/codex/device", userCode: "ABCD-12345" } });
      // Il proprietario scrive il codice sul sito: qui l'accesso riesce da sé, poco dopo.
      if (process.env.FINTO_CODEX_ACCEDE === "1") {
        setTimeout(() => {
          if (fileAccesso !== undefined) writeFileSync(fileAccesso, "sì");
          notifica("account/login/completed", { loginId: "accesso-1", success: true, error: null });
        }, 200);
      }
      return;
    case "account/login/cancel":
      scrivi({ id, result: { status: "canceled" } });
      return notifica("account/login/completed", { loginId: params.loginId, success: false, error: "Login was not completed" });
    case "account/logout":
      if (fileAccesso !== undefined) rmSync(fileAccesso, { force: true });
      return scrivi({ id, result: {} });
    default:
      return scrivi({ id, error: { code: -32601, message: `metodo sconosciuto ${method}` } });
  }
});
