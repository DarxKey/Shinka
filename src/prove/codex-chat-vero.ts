/**
 * Una prova sull'app-server vero di Codex, con l'accesso ChatGPT di questo ambiente, delle
 * funzioni della chat: le modifiche di un turno con la versione di prima, ripartire da un
 * messaggio riportando i file, un ramo, una domanda a parte e la compattazione. Poche risposte brevi.
 *
 *   node src/prove/codex-chat-vero.ts
 */

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConversazioneCodex } from "../nodo/codex/conversazione-codex.ts";
import type { EventoConversazione } from "../protocollo/eventi.ts";

const cartella = mkdtempSync(join(tmpdir(), "shinka-codex-chat-"));
writeFileSync(join(cartella, "a.txt"), "uno\ndue\ntre\n");
const eventi: EventoConversazione[] = [];
const conversazione = new ConversazioneCodex({
  cartella,
  istruzioni: "claude-code",
  istruzioniAggiunte: "Rispondi in italiano, in breve.",
  strumenti: "claude-code",
  strumentiSenzaRichiesta: [],
  impostazioni: { permessi: "senza-permessi", impegno: "low" },
  alEvento: (evento) => eventi.push(evento),
  alIdSessione: () => {},
});
const conclusi = () => eventi.filter((evento) => evento.tipo === "turno-concluso").length;
const attendi = async (condizione: () => boolean) => {
  for (const fine = Date.now() + 240_000; !condizione() && Date.now() < fine; ) await new Promise((fatto) => setTimeout(fatto, 300));
};
const messaggi = () => eventi.flatMap((evento) => (evento.tipo === "messaggio-proprietario" ? [evento.id] : []));
const esiti: [string, boolean][] = [];

conversazione.invia("Ricorda la parola LAMPONE. Rispondi solo 'ok'.");
await attendi(() => conclusi() >= 1);
conversazione.invia("Con apply_patch, in a.txt sostituisci la riga 'due' con 'DUE' e crea b.txt con la riga 'nuovo'. Rispondi solo 'fatto'.");
await attendi(() => eventi.some((evento) => evento.tipo === "modifiche"));
const modifiche = eventi.find((evento) => evento.tipo === "modifiche");
console.log("modifiche:", JSON.stringify(modifiche));
const idTurno = modifiche?.tipo === "modifiche" ? modifiche.idTurno : "";
const versioni = await conversazione.versioniModificate(idTurno, "a.txt");
console.log("versioni di a.txt:", JSON.stringify(versioni));
esiti.push(["modifiche con la versione di prima", "prima" in versioni && versioni.prima === "uno\ndue\ntre\n"]);

const secondo = messaggi()[1] ?? "";
console.log("anteprima:", JSON.stringify(await conversazione.anteprimaRiavvolgimento(secondo)));
const aParte = await conversazione.chiediAParte("Quale parola ti ho chiesto di ricordare?");
console.log("domanda a parte:", JSON.stringify(aParte));
esiti.push(["domanda a parte", "testo" in aParte && /LAMPONE/i.test(aParte.testo)]);
const ramo = await conversazione.biforca(secondo);
console.log("ramo:", JSON.stringify(ramo));
esiti.push(["ramo", ramo.riuscita && ramo.idSessione !== undefined]);
const ripresa = await conversazione.riprendiDa(secondo, { file: true });
console.log("ripresa:", ripresa ?? "fatta", JSON.stringify(eventi.at(-1)));
esiti.push(["file riportati", readFileSync(join(cartella, "a.txt"), "utf8") === "uno\ndue\ntre\n" && !existsSync(join(cartella, "b.txt"))]);
const storia = await conversazione.storia();
console.log("storia dopo:", JSON.stringify(storia));
esiti.push(["storia tagliata", storia.length === 2]);

conversazione.invia("/compact");
await attendi(() => eventi.some((evento) => evento.tipo === "nota" && evento.testo.includes("compattata")) || conclusi() >= 3);
esiti.push(["compattazione", eventi.some((evento) => evento.tipo === "nota" && evento.testo.includes("compattata"))]);
conversazione.chiudi();
console.log(esiti.map(([nome, ok]) => `${ok ? "OK " : "NO "} ${nome}`).join("\n"));
process.exit(esiti.every(([, ok]) => ok) ? 0 : 1);
