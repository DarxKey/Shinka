import assert from "node:assert/strict";
import { test } from "node:test";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { IMMAGINI_MASSIME, nuovoStato, PESO_MASSIMO_IMMAGINE, traduci } from "./traduzione.ts";

/** Il messaggio con cui l'harness riferisce l'esito di un'azione. */
function esito(contenuto: unknown): SDKMessage {
  return {
    type: "user",
    parent_tool_use_id: null,
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: "a1", content: contenuto }] },
  } as unknown as SDKMessage;
}

function immagine(tipo: string, dati = "aGVsbG8="): unknown {
  return { type: "image", source: { type: "base64", media_type: tipo, data: dati } };
}

test("uno screenshot nell'esito di un'azione arriva come immagine, non come testo", () => {
  const [evento] = traduci(esito([{ type: "text", text: "Schermata presa." }, immagine("image/png")]), nuovoStato());
  assert.deepEqual(evento, {
    tipo: "azione-conclusa",
    idAzione: "a1",
    esito: "Schermata presa.\n[immagine]",
    errore: false,
    immagini: [{ tipo: "image/png", dati: "aGVsbG8=" }],
  });
});

test("un esito di solo testo non porta immagini", () => {
  const [evento] = traduci(esito("fatto"), nuovoStato());
  assert.deepEqual(evento, { tipo: "azione-conclusa", idAzione: "a1", esito: "fatto", errore: false });
});

test("immagini di tipo non mostrabile, troppo pesanti o troppe vengono lasciate indietro", () => {
  const pesante = immagine("image/png", "A".repeat(PESO_MASSIMO_IMMAGINE + 4));
  const [scartate] = traduci(esito([immagine("image/svg+xml"), pesante, { type: "image", source: { type: "url" } }]), nuovoStato());
  assert.ok(scartate?.tipo === "azione-conclusa" && scartate.immagini === undefined);

  const tante = Array.from({ length: IMMAGINI_MASSIME + 3 }, () => immagine("image/jpeg"));
  const [limitate] = traduci(esito(tante), nuovoStato());
  assert.ok(limitate?.tipo === "azione-conclusa" && limitate.immagini?.length === IMMAGINI_MASSIME);
});
