/**
 * Una prova sull'app-server vero di Codex: gli strumenti di Shinka arrivano a Codex come strumenti
 * dinamici, e restano dopo che la conversazione si chiude e si riprende. Lo strumento di prova
 * "parola_segreta" sta nello spazio "shinka", come gli strumenti veri, e non chiede consenso.
 * Usa poche risposte brevi, con l'accesso ChatGPT di questo ambiente.
 *
 *   node src/prove/codex-strumenti-vero.ts
 */

import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { ConversazioneCodex } from "../nodo/codex/conversazione-codex.ts";
import type { EventoConversazione } from "../protocollo/eventi.ts";

const cartella = mkdtempSync(join(tmpdir(), "shinka-codex-strumenti-"));
const eventi: EventoConversazione[] = [];
let chiamate = 0;
let idSessione = "";
const strumentiNostri = () => ({
  shinka: createSdkMcpServer({
    name: "shinka",
    version: "1.0.0",
    tools: [
      tool("parola_segreta", "Dice la parola segreta di oggi. Usalo quando il proprietario la chiede.", { per: z.string().describe("Chi la chiede") }, async () => {
        chiamate += 1;
        return { content: [{ type: "text", text: "La parola segreta è GIRASOLE." }] };
      }),
    ],
  }),
});
const apri = () =>
  new ConversazioneCodex({
    cartella,
    istruzioni: "claude-code",
    istruzioniAggiunte: "Rispondi in italiano, in breve.",
    strumenti: "claude-code",
    strumentiSenzaRichiesta: ["mcp__shinka__parola_segreta"],
    strumentiNostri,
    impostazioni: { permessi: "chiedi", impegno: "low" },
    ...(idSessione === "" ? {} : { idSessione }),
    alEvento: (evento) => eventi.push(evento),
    alIdSessione: (id) => (idSessione = id),
  });
const conclusi = () => eventi.filter((evento) => evento.tipo === "turno-concluso").length;
const attendi = async (quanti: number) => {
  for (const fine = Date.now() + 240_000; conclusi() < quanti && Date.now() < fine; ) await new Promise((fatto) => setTimeout(fatto, 300));
};
const ultimaRisposta = () => eventi.flatMap((evento) => (evento.tipo === "testo-concluso" ? [evento.testo] : [])).at(-1) ?? "";

let conversazione = apri();
conversazione.invia("Qual è la parola segreta di oggi? Usa lo strumento apposito.");
await attendi(1);
console.log("azioni:", JSON.stringify(eventi.filter((evento) => evento.tipo === "azione-iniziata" || evento.tipo === "azione-conclusa")).slice(0, 500));
console.log("risposta 1:", ultimaRisposta(), "| chiamate:", chiamate);
conversazione.chiudi();

// Ripresa: un oggetto nuovo, come dopo un riavvio, con lo stesso thread.
conversazione = apri();
conversazione.invia("Chiedi di nuovo la parola segreta con lo strumento, e dimmela.");
await attendi(2);
console.log("risposta 2:", ultimaRisposta(), "| chiamate:", chiamate, "| thread:", idSessione);
conversazione.chiudi();
console.log(chiamate >= 2 && /GIRASOLE/i.test(ultimaRisposta()) ? "RIUSCITA" : "NON RIUSCITA");
process.exit(0);
