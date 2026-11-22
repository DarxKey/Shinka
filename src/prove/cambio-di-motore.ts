/**
 * Una prova con i motori veri, con gli accessi di questo ambiente: una conversazione comincia con
 * Claude, passa a Codex, che deve sapere ciò che il proprietario aveva detto a Claude, e torna a
 * Claude, che riprende la sua sessione. Il menu deve avere i modelli dei due motori. Poche risposte
 * brevi.
 *
 *   node src/prove/cambio-di-motore.ts
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apriConversazione } from "../nodo/motore.ts";
import type { EventoConversazione } from "../protocollo/eventi.ts";
import type { ImpostazioniConversazione } from "../protocollo/impostazioni.ts";
import { leggiSessioni } from "../protocollo/sessioni.ts";

const cartella = mkdtempSync(join(tmpdir(), "shinka-cambio-motore-"));
const eventi: EventoConversazione[] = [];
let idSessione = "";
let impostazioni: ImpostazioniConversazione = { motore: "claude", modello: "haiku", permessi: "chiedi" };
const conversazione = apriConversazione(
  {
    cartella,
    istruzioni: "claude-code",
    istruzioniAggiunte: "Rispondi in italiano, in breve, senza usare strumenti.",
    strumenti: "claude-code",
    strumentiSenzaRichiesta: [],
    impostazioni,
    alEvento: (evento) => {
      eventi.push(evento);
      if (evento.tipo === "nota") console.log("nota:", evento.testo);
      if (evento.tipo === "errore") console.log("errore:", evento.messaggio);
    },
    alIdSessione: (id) => (idSessione = id),
  },
  { predefinito: "claude" },
);
const conclusi = () => eventi.filter((evento) => evento.tipo === "turno-concluso").length;
const attendi = async (quanti: number) => {
  for (const fine = Date.now() + 240_000; conclusi() < quanti && Date.now() < fine; ) await new Promise((fatto) => setTimeout(fatto, 300));
};
const ultimaRisposta = () => eventi.filter((evento) => evento.tipo === "testo-concluso").at(-1)?.tipo === "testo-concluso" ? (eventi.filter((evento) => evento.tipo === "testo-concluso").at(-1) as { testo: string }).testo : "";

conversazione.invia("Ricorda la parola segreta: girasole. Rispondi solo OK.");
await attendi(1);
console.log("Claude:", ultimaRisposta());

impostazioni = { ...impostazioni, motore: "codex", modello: undefined as never, impegno: "low" };
delete impostazioni.modello;
conversazione.imposta(impostazioni);
conversazione.invia("Qual è la parola segreta che ti ho detto? Una parola sola.");
await attendi(2);
const diCodex = ultimaRisposta();
console.log("Codex:", diCodex);

impostazioni = { motore: "claude", modello: "haiku", permessi: "chiedi" };
conversazione.imposta(impostazioni);
conversazione.invia("Ripeti la parola segreta e dimmi che cosa ha risposto l'altro motore. Breve.");
await attendi(3);
console.log("Claude di nuovo:", ultimaRisposta());

// I modelli dei due motori arrivano nel menu.
await new Promise((fatto) => setTimeout(fatto, 8_000));
const stati = eventi.filter((evento) => evento.tipo === "stato");
const modelli = stati.flatMap((evento) => (evento.tipo === "stato" ? (evento.stato.modelli ?? []) : []));
const motori = new Set(modelli.map((modello) => modello.motore));
console.log("motori nel menu:", [...motori].join(", "), "— modelli:", modelli.length);
console.log("sessioni:", JSON.stringify(leggiSessioni(idSessione)));
conversazione.chiudi();

const sessioni = leggiSessioni(idSessione);
const riuscita = /girasole/i.test(diCodex) && motori.has("claude") && motori.has("codex") && sessioni?.sessioni.claude !== undefined && sessioni.sessioni.codex !== undefined && sessioni.ultimo === "claude";
console.log(riuscita ? "RIUSCITA" : "NON RIUSCITA");
process.exit(riuscita ? 0 : 1);
