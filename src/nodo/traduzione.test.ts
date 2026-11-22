import assert from "node:assert/strict";
import { test } from "node:test";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { EventoConversazione } from "../protocollo/eventi.ts";
import { LIMITE_ESITO, nuovoStato, risultatoDiUnaNota, traduci } from "./traduzione.ts";

/** I messaggi veri dell'SDK hanno decine di campi: qui bastano quelli che la traduzione legge. */
function messaggio(parziale: unknown): SDKMessage {
  return parziale as SDKMessage;
}

function flusso(evento: unknown): SDKMessage {
  return messaggio({ type: "stream_event", event: evento, parent_tool_use_id: null });
}

function traduciTutti(messaggi: SDKMessage[]): EventoConversazione[] {
  const stato = nuovoStato();
  return messaggi.flatMap((m) => traduci(m, stato));
}

test("un testo arriva come inizio, frammenti e conclusione con il testo intero", () => {
  const eventi = traduciTutti([
    flusso({ type: "message_start", message: { id: "msg_1" } }),
    flusso({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
    flusso({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Tokyo è " } }),
    flusso({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "la capitale." } }),
    flusso({ type: "content_block_stop", index: 0 }),
  ]);
  assert.deepEqual(eventi, [
    { tipo: "testo-iniziato", idTesto: "msg_1:0" },
    { tipo: "testo-frammento", idTesto: "msg_1:0", frammento: "Tokyo è " },
    { tipo: "testo-frammento", idTesto: "msg_1:0", frammento: "la capitale." },
    { tipo: "testo-concluso", idTesto: "msg_1:0", testo: "Tokyo è la capitale." },
  ]);
});

test("i blocchi che non sono testo non producono eventi di testo", () => {
  const eventi = traduciTutti([
    flusso({ type: "message_start", message: { id: "msg_1" } }),
    flusso({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } }),
    flusso({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "…" } }),
    flusso({ type: "content_block_stop", index: 0 }),
  ]);
  assert.deepEqual(eventi, []);
});

test("un'azione nasce dal messaggio completo, con il suo ingresso", () => {
  const eventi = traduciTutti([
    messaggio({
      type: "assistant",
      parent_tool_use_id: null,
      message: {
        id: "msg_2",
        content: [
          { type: "text", text: "Controllo." },
          { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "date" } },
        ],
      },
    }),
  ]);
  assert.deepEqual(eventi, [
    { tipo: "azione-iniziata", idAzione: "toolu_1", strumento: "Bash", ingresso: { command: "date" } },
  ]);
});

test("l'esito di un'azione arriva dal risultato dello strumento", () => {
  const eventi = traduciTutti([
    messaggio({
      type: "user",
      parent_tool_use_id: null,
      message: {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "toolu_1", content: [{ type: "text", text: "lun 10 nov" }] },
          { type: "tool_result", tool_use_id: "toolu_2", content: "permesso negato", is_error: true },
        ],
      },
    }),
  ]);
  assert.deepEqual(eventi, [
    { tipo: "azione-conclusa", idAzione: "toolu_1", esito: "lun 10 nov", errore: false },
    { tipo: "azione-conclusa", idAzione: "toolu_2", esito: "permesso negato", errore: true },
  ]);
});

test("un esito troppo lungo viene troncato", () => {
  const lungo = "x".repeat(LIMITE_ESITO + 50);
  const [evento] = traduciTutti([
    messaggio({
      type: "user",
      parent_tool_use_id: null,
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: lungo }] },
    }),
  ]);
  assert.equal(evento?.tipo, "azione-conclusa");
  assert.ok(evento.tipo === "azione-conclusa" && evento.esito.includes("troncato: 50 caratteri"));
});

test("i messaggi dei subagent non entrano nella conversazione", () => {
  const eventi = traduciTutti([
    messaggio({
      type: "assistant",
      parent_tool_use_id: "toolu_padre",
      message: { id: "m", content: [{ type: "tool_use", id: "t", name: "Read", input: {} }] },
    }),
  ]);
  assert.deepEqual(eventi, []);
});

test("un turno riuscito si conclude senza errore", () => {
  const eventi = traduciTutti([
    messaggio({ type: "result", subtype: "success", is_error: false, duration_ms: 1200, result: "ok" }),
  ]);
  assert.deepEqual(eventi, [{ tipo: "turno-concluso", riuscito: true, durataMs: 1200 }]);
});

test("il risultato con cui l'harness chiude una nota non è la fine di un turno", () => {
  // Così esce dall'harness vero per un messaggio con shouldQuery: false, prima o dopo un turno.
  const diUnaNota = messaggio({ type: "result", subtype: "success", is_error: false, num_turns: 0, duration_ms: 5, duration_api_ms: 0, result: "" });
  assert.equal(risultatoDiUnaNota(diUnaNota), true);
  const eventi = traduciTutti([
    flusso({ type: "message_start", message: { id: "msg_9" } }),
    flusso({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
    flusso({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Sto lavorando" } }),
    diUnaNota,
  ]);
  // Il testo che sta arrivando resta aperto, e il turno pure.
  assert.deepEqual(eventi.map((evento) => evento.tipo), ["testo-iniziato", "testo-frammento"]);

  // Un turno vero, anche brevissimo o senza testo, resta un turno; e così uno fallito prima di cominciare.
  for (const vero of [
    messaggio({ type: "result", subtype: "success", is_error: false, num_turns: 1, duration_ms: 900, duration_api_ms: 700, result: "" }),
    messaggio({ type: "result", subtype: "success", is_error: true, num_turns: 0, duration_ms: 5, duration_api_ms: 0, result: "Non autenticato" }),
    messaggio({ type: "result", subtype: "error_during_execution", is_error: true, num_turns: 0, duration_ms: 5, duration_api_ms: 0, errors: [] }),
    messaggio({ type: "result", subtype: "success", is_error: false, duration_ms: 3, result: "" }),
  ]) {
    assert.equal(risultatoDiUnaNota(vero), false);
    assert.equal(traduciTutti([vero]).at(-1)?.tipo, "turno-concluso");
  }
});

test("un turno fallito porta il motivo", () => {
  const eventi = traduciTutti([
    messaggio({
      type: "result",
      subtype: "error_max_turns",
      is_error: true,
      duration_ms: 10,
      errors: ["troppi turni"],
    }),
    messaggio({ type: "result", subtype: "success", is_error: true, duration_ms: 5, result: "Non autenticato" }),
  ]);
  assert.deepEqual(eventi, [
    { tipo: "turno-concluso", riuscito: false, durataMs: 10, errore: "troppi turni" },
    { tipo: "turno-concluso", riuscito: false, durataMs: 5, errore: "Non autenticato" },
  ]);
});

test("un testo rimasto a metà viene chiuso quando il turno finisce", () => {
  const eventi = traduciTutti([
    flusso({ type: "message_start", message: { id: "msg_3" } }),
    flusso({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
    flusso({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Stavo dicendo" } }),
    messaggio({ type: "result", subtype: "success", is_error: false, duration_ms: 3, result: "" }),
  ]);
  assert.deepEqual(eventi.slice(-2), [
    { tipo: "testo-concluso", idTesto: "msg_3:0", testo: "Stavo dicendo" },
    { tipo: "turno-concluso", riuscito: true, durataMs: 3 },
  ]);
});

test("un errore dell'harness diventa un evento di errore in italiano", () => {
  const eventi = traduciTutti([
    messaggio({
      type: "assistant",
      parent_tool_use_id: null,
      error: "authentication_failed",
      message: { id: "m", content: [{ type: "text", text: "Not logged in" }] },
    }),
  ]);
  assert.equal(eventi.length, 1);
  assert.ok(eventi[0]?.tipo === "errore" && eventi[0].messaggio.includes("claude auth login"));
});

test("il ragionamento arriva con il messaggio completo; uno vuoto, come quelli nascosti, no", () => {
  const eventi = traduciTutti([
    messaggio({
      type: "assistant",
      parent_tool_use_id: null,
      message: {
        id: "msg_3",
        content: [
          { type: "thinking", thinking: "  Prima guardo la cartella.  ", signature: "x" },
          { type: "thinking", thinking: "", signature: "y" },
          { type: "tool_use", id: "toolu_2", name: "Bash", input: { command: "ls" } },
        ],
      },
    }),
  ]);
  assert.deepEqual(eventi, [
    { tipo: "ragionamento", idRagionamento: "msg_3:0", testo: "Prima guardo la cartella." },
    { tipo: "azione-iniziata", idAzione: "toolu_2", strumento: "Bash", ingresso: { command: "ls" } },
  ]);
});
