/**
 * Una prova sull'harness vero della seconda parte del gruppo C: un comando in background e un
 * agente devono comparire tra le attività, con il loro stato e, per il comando, l'uscita; lo stato
 * deve dire di che cosa è fatto il contesto; "/compact" mandato come messaggio deve compattarlo.
 * Usa l'abbonamento del proprietario per poche risposte brevi.
 *
 *   node src/prove/attivita-e-contesto.ts
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Conversazione } from "../nodo/conversazione.ts";
import type { EventoConversazione } from "../protocollo/eventi.ts";

const cartella = mkdtempSync(join(tmpdir(), "shinka-attivita-"));
const eventi: EventoConversazione[] = [];
const conversazione = new Conversazione({
  cartella,
  istruzioni: "claude-code",
  strumenti: "claude-code",
  strumentiSenzaRichiesta: [],
  impostazioni: { modello: "haiku", permessi: "senza-permessi" },
  alEvento: (evento) => eventi.push(evento),
  alIdSessione: () => {},
});
const conclusi = () => eventi.filter((evento) => evento.tipo === "turno-concluso").length;
const attendi = async (condizione: () => boolean, ms: number) => {
  for (const fine = Date.now() + ms; !condizione() && Date.now() < fine; ) await new Promise((fatto) => setTimeout(fatto, 300));
};
const ultimeAttivita = () => eventi.findLast((evento) => evento.tipo === "attivita");

conversazione.invia(
  "Fai due cose. 1) Lancia in background con Bash (run_in_background) il comando: sleep 3; echo USCITA-DI-PROVA. " +
    "2) Usa lo strumento Task (Agent) con un agente general-purpose a cui chiedi solo di rispondere con la parola PRONTO, senza usare strumenti. " +
    "Poi aspetta che il comando in background finisca e rispondi 'fatto'.",
);
await attendi(() => {
  const ultime = ultimeAttivita();
  return ultime?.tipo === "attivita" && ultime.attivita.some((voce) => voce.genere === "comando" && voce.stato !== "in-corso") && conclusi() >= 1;
}, 240_000);
const attivita = ultimeAttivita();
console.log("attività:", JSON.stringify(attivita?.tipo === "attivita" ? attivita.attivita : undefined, null, 1));
const comando = attivita?.tipo === "attivita" ? attivita.attivita.find((voce) => voce.genere === "comando") : undefined;
const agente = attivita?.tipo === "attivita" ? attivita.attivita.find((voce) => voce.genere === "agente") : undefined;
const uscita = comando === undefined ? undefined : await conversazione.uscitaAttivita(comando.id);
console.log("uscita del comando:", JSON.stringify(uscita));
const stato = eventi.filter((evento) => evento.tipo === "stato").flatMap((evento) => (evento.tipo === "stato" && evento.stato.contesto?.parti !== undefined ? [evento.stato.contesto] : [])).at(-1);
console.log("contesto:", JSON.stringify(stato));

const primaDellaCompattazione = stato?.usati ?? 0;
const turni = conclusi();
conversazione.invia("/compact");
await attendi(() => conclusi() > turni, 180_000);
await new Promise((fatto) => setTimeout(fatto, 3000));
const dopo = eventi.filter((evento) => evento.tipo === "stato").flatMap((evento) => (evento.tipo === "stato" && evento.stato.contesto !== undefined ? [evento.stato.contesto.usati] : [])).at(-1);
console.log("contesto prima e dopo /compact:", primaDellaCompattazione, dopo, "| eventi dopo:", eventi.slice(-6).map((evento) => evento.tipo).join(","));
conversazione.chiudi();
const ok = comando !== undefined && agente !== undefined && uscita !== undefined && "testo" in uscita && uscita.testo.includes("USCITA-DI-PROVA") && stato !== undefined;
console.log(ok ? "RIUSCITA" : "NON RIUSCITA", "| compattata:", dopo !== undefined && dopo < primaDellaCompattazione);
process.exit(0);
