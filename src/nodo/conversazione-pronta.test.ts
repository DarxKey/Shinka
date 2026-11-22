import assert from "node:assert/strict";
import { test } from "node:test";
import type { Query } from "@anthropic-ai/claude-agent-sdk";
import type { EventoConversazione } from "../protocollo/eventi.ts";
import type { StatoConversazione } from "../protocollo/impostazioni.ts";
import { Conversazione } from "./conversazione.ts";

/** Un harness finto che è partito e risponde, ma non ha ancora ricevuto un messaggio: non dice nulla da sé. */
function harnessInAttesa(chieste: string[]): Query {
  let chiudi: () => void = () => {};
  const chiuso = new Promise<void>((fatto) => (chiudi = fatto));
  const finto = {
    [Symbol.asyncIterator]: () => ({ next: async () => (await chiuso, { value: undefined, done: true as const }) }),
    close: () => chiudi(),
    getContextUsage: async () => (chieste.push("contesto"), { model: "claude-fable-5-2", categories: [], totalTokens: 1200, maxTokens: 200000, percentage: 0.6 }),
    usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => (
      chieste.push("limiti"),
      { rate_limits: { five_hour: { utilization: 45, resets_at: "2026-11-22T18:00:00Z" }, seven_day: { utilization: 55, resets_at: "2026-11-24T19:00:00Z" } } }
    ),
    supportedCommands: async () => (chieste.push("comandi"), [{ name: "compact", description: "Compatta la conversazione", argumentHint: "" }]),
    supportedModels: async () => (chieste.push("modelli"), [{ value: "fable", displayName: "Fable", description: "Il più capace", supportedEffortLevels: ["low", "high"] }]),
  };
  return finto as unknown as Query;
}

test("aperta la conversazione, modelli, comandi, contesto e limiti arrivano prima del primo messaggio", async (t) => {
  const eventi: EventoConversazione[] = [];
  const chieste: string[] = [];
  let avvii = 0;
  const conversazione = new Conversazione(
    {
      cartella: process.cwd(),
      istruzioni: "Rispondi in breve.",
      strumenti: [],
      strumentiSenzaRichiesta: [],
      impostazioni: { permessi: "chiedi" },
      alEvento: (evento) => eventi.push(evento),
      alIdSessione: () => {},
    },
    { avvia: () => ((avvii += 1), harnessInAttesa(chieste)) },
  );
  t.after(() => conversazione.chiudi());
  conversazione.prepara();
  for (const fine = Date.now() + 5_000; Date.now() < fine && !eventi.some((evento) => evento.tipo === "stato"); ) {
    await new Promise((fatto) => setTimeout(fatto, 10));
  }
  // Nessun messaggio è partito, e nessun turno è cominciato.
  assert.deepEqual(eventi.map((evento) => evento.tipo), ["stato"]);
  const stato = (eventi[0] as { stato: StatoConversazione }).stato;
  assert.equal(stato.modello, "claude-fable-5-2");
  assert.deepEqual(stato.contesto, { usati: 1200, massimo: 200000, percento: 1 });
  assert.deepEqual(Object.keys(stato.limiti ?? {}), ["cinqueOre", "setteGiorni"]);
  assert.equal(stato.limiti?.cinqueOre?.percento, 45);
  assert.deepEqual(stato.comandi, [{ nome: "compact", descrizione: "Compatta la conversazione" }]);
  assert.deepEqual(stato.modelli, [{ valore: "fable", nome: "Fable", descrizione: "Il più capace", impegni: ["low", "high"] }]);
  assert.deepEqual(chieste, ["contesto", "limiti", "comandi", "modelli"]);

  // Preparata di nuovo, con l'harness già acceso, non richiede nulla.
  conversazione.prepara();
  await new Promise((fatto) => setTimeout(fatto, 50));
  assert.equal(avvii, 1);
  assert.equal(chieste.length, 4);
});
