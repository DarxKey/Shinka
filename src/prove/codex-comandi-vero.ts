/**
 * Una prova sull'app-server vero di Codex, con l'accesso ChatGPT di questo ambiente: i comandi e
 * i limiti detti appena la conversazione si prepara, senza un messaggio; una skill chiamata con
 * "/nome"; un messaggio scritto mentre Codex lavora, che entra nel turno in corso. Poche risposte brevi.
 *
 *   node src/prove/codex-comandi-vero.ts
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConversazioneCodex } from "../nodo/codex/conversazione-codex.ts";
import type { EventoConversazione } from "../protocollo/eventi.ts";

const cartella = mkdtempSync(join(tmpdir(), "shinka-codex-comandi-"));
const cartellaSkill = mkdtempSync(join(tmpdir(), "shinka-codex-skill-"));
mkdirSync(join(cartellaSkill, "skills", "papavero"), { recursive: true });
writeFileSync(
  join(cartellaSkill, "skills", "papavero", "SKILL.md"),
  "---\nname: papavero\ndescription: Una skill di prova di Shinka. Usala solo quando viene chiamata per nome.\n---\n\nQuando questa skill viene chiamata, rispondi con la sola parola PAPAVERO-7341, senza altro.\n",
);
const eventi: EventoConversazione[] = [];
const conversazione = new ConversazioneCodex({
  cartella,
  cartellaSkill,
  istruzioni: "claude-code",
  istruzioniAggiunte: "Rispondi in italiano, in breve.",
  strumenti: "claude-code",
  strumentiSenzaRichiesta: [],
  impostazioni: { permessi: "senza-permessi", impegno: "low" },
  alEvento: (evento) => eventi.push(evento),
  alIdSessione: () => {},
});
const conclusi = (): number => eventi.filter((evento) => evento.tipo === "turno-concluso").length;
const attendi = async (condizione: () => boolean): Promise<boolean> => {
  for (const fine = Date.now() + 240_000; !condizione() && Date.now() < fine; ) await new Promise((fatto) => setTimeout(fatto, 300));
  return condizione();
};
const testi = (): string[] => eventi.flatMap((evento) => (evento.tipo === "testo-concluso" ? [evento.testo] : []));
const errori = (): string[] => eventi.flatMap((evento) => (evento.tipo === "errore" ? [evento.messaggio] : []));
const esiti: [string, boolean][] = [];

// 1. Senza scrivere nulla: comandi e limiti.
conversazione.prepara();
await attendi(() => eventi.some((evento) => evento.tipo === "stato" && evento.stato.comandi !== undefined));
const comandi = eventi.flatMap((evento) => (evento.tipo === "stato" && evento.stato.comandi !== undefined ? [evento.stato.comandi] : []))[0] ?? [];
const limiti = eventi.flatMap((evento) => (evento.tipo === "stato" && evento.stato.limiti !== undefined ? [evento.stato.limiti] : []))[0];
console.log("Comandi:", comandi.map((comando) => `/${comando.nome}`).join(" "));
console.log("Limiti:", JSON.stringify(limiti));
esiti.push(["comandi prima del primo messaggio, con /compact e la skill di prova", comandi[0]?.nome === "compact" && comandi.some((comando) => comando.nome === "papavero")]);
esiti.push(["limiti prima del primo messaggio", limiti !== undefined]);
esiti.push(["nessun turno aperto per questo", !eventi.some((evento) => evento.tipo === "turno-iniziato")]);

// 2. Una skill chiamata con "/nome".
conversazione.invia("/papavero");
await attendi(() => conclusi() === 1);
console.log("Skill:", JSON.stringify(testi().at(-1)));
esiti.push(["la skill chiamata con /papavero risponde", (testi().at(-1) ?? "").includes("PAPAVERO-7341")]);

// 3. Un messaggio a turno in corso.
conversazione.invia("Esegui il comando `sleep 12` nella shell, poi rispondi con la parola FINITO.");
await attendi(() => eventi.some((evento) => evento.tipo === "azione-iniziata") || conclusi() === 2);
conversazione.invia("Aggiunta: nella risposta finale scrivi anche la parola GIRASOLE.");
await attendi(() => conclusi() >= 2);
// Se il messaggio non fosse entrato nel turno ne avrebbe aperto un altro: si aspetta un momento per vederlo.
await new Promise((fatto) => setTimeout(fatto, 3000));
console.log("A turno in corso:", JSON.stringify(testi().at(-1)), "errori:", JSON.stringify(errori()));
esiti.push(["il messaggio a turno in corso non dà errore", errori().length === 0]);
esiti.push(["ed entra nello stesso turno", eventi.filter((evento) => evento.tipo === "turno-iniziato").length === 2]);
esiti.push(["Codex ne tiene conto", (testi().at(-1) ?? "").includes("GIRASOLE")]);

conversazione.chiudi();
for (const [che, riuscito] of esiti) console.log(`${riuscito ? "ok  " : "NO  "} ${che}`);
console.log(esiti.every(([, riuscito]) => riuscito) ? "RIUSCITA" : "FALLITA");
process.exit(esiti.every(([, riuscito]) => riuscito) ? 0 : 1);
