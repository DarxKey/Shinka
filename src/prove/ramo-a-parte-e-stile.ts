/**
 * Una prova sull'harness vero della seconda parte del gruppo B. Una conversazione di Shinka si fa
 * dire due cose da ricordare; una domanda a parte chiede la seconda e non deve lasciare traccia;
 * poi dal secondo messaggio nasce un ramo, che riprende in un'altra conversazione nella stessa
 * cartella e deve ricordare solo la prima. Infine uno stile scelto deve cambiare come Claude scrive.
 * Usa l'abbonamento del proprietario per poche risposte brevi.
 *
 *   node src/prove/ramo-a-parte-e-stile.ts
 */

import { getSessionMessages } from "@anthropic-ai/claude-agent-sdk";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Conversazione } from "../nodo/conversazione.ts";
import type { EventoConversazione } from "../protocollo/eventi.ts";
import type { ImpostazioniConversazione } from "../protocollo/impostazioni.ts";

const cartella = mkdtempSync(join(tmpdir(), "shinka-ramo-"));

function apri(idSessione?: string, impostazioni: ImpostazioniConversazione = { modello: "haiku", permessi: "chiedi" }) {
  const eventi: EventoConversazione[] = [];
  const stato = { idSessione: idSessione ?? "" };
  const conversazione = new Conversazione({
    cartella,
    istruzioni: "Sei un assistente di prova. Rispondi in italiano, in breve.",
    strumenti: [],
    strumentiSenzaRichiesta: [],
    impostazioni,
    ...(idSessione === undefined ? {} : { idSessione }),
    alEvento: (evento) => eventi.push(evento),
    alIdSessione: (id) => (stato.idSessione = id),
  });
  const conclusi = () => eventi.filter((evento) => evento.tipo === "turno-concluso").length;
  const turno = async (testo: string): Promise<string> => {
    const prima = conclusi();
    conversazione.invia(testo);
    for (const fine = Date.now() + 90_000; conclusi() === prima && Date.now() < fine; ) await new Promise((fatto) => setTimeout(fatto, 200));
    return eventi.flatMap((evento) => (evento.tipo === "testo-concluso" ? [evento.testo] : [])).at(-1) ?? "";
  };
  return { conversazione, eventi, stato, turno };
}

const a = apri();
await a.turno("Ricorda: il colore è ROSSO. Rispondi solo 'ok'.");
await a.turno("Ricorda: l'animale è GATTO. Rispondi solo 'ok'.");
const secondo = a.eventi.flatMap((evento) => (evento.tipo === "messaggio-proprietario" ? [evento] : []))[1];
const storiaPrima = (await getSessionMessages(a.stato.idSessione, { dir: cartella })).length;
const eventiPrima = a.eventi.length;

const inizio = Date.now();
const aParte = await a.conversazione.chiediAParte("Quale animale ti ho detto di ricordare? Una parola.");
const storiaDopo = (await getSessionMessages(a.stato.idSessione, { dir: cartella })).length;
console.log("a parte:", JSON.stringify(aParte), `in ${Date.now() - inizio} ms`, "| storia", storiaPrima, "->", storiaDopo, "| eventi nuovi:", a.eventi.slice(eventiPrima).map((evento) => evento.tipo).join(","));
// Lo stato del turno appena finito può arrivare anche dopo: conta solo ciò che entrerebbe nella conversazione.
const lasciati = a.eventi.slice(eventiPrima).filter((evento) => evento.tipo !== "stato");
const aParteRiuscita = "testo" in aParte && /gatto/i.test(aParte.testo) && storiaDopo === storiaPrima && lasciati.length === 0;

const ramo = await a.conversazione.biforca(secondo?.id ?? "");
console.log("ramo:", JSON.stringify(ramo));
a.conversazione.chiudi();
const b = apri(ramo.riuscita ? ramo.idSessione : undefined);
const nelRamo = await b.turno("Elenca, in una riga, tutte le cose che ti ho chiesto di ricordare.");
console.log("nel ramo:", nelRamo.replace(/\n/g, " ").slice(0, 200), "| sessione:", b.stato.idSessione === (ramo.riuscita ? ramo.idSessione : ""));
b.conversazione.chiudi();
const ramoRiuscito = ramo.riuscita && /rosso/i.test(nelRamo) && !/gatto/i.test(nelRamo);
// La conversazione di prima resta intera: ricorda ancora tutte e due.
const storiaOriginale = await getSessionMessages(a.stato.idSessione, { dir: cartella });
const originaleIntera = storiaOriginale.length === storiaPrima;

const c = apri(undefined, {
  modello: "haiku",
  permessi: "chiedi",
  stile: { id: "prova", nome: "Pirata", istruzioni: "Comincia ogni risposta con la parola ARRR, in maiuscolo." },
});
const conStile = await c.turno("Ciao, come stai?");
console.log("con lo stile:", conStile.replace(/\n/g, " ").slice(0, 120));
c.conversazione.chiudi();
const stileRiuscito = /^\W*ARRR/.test(conStile);

console.log({ aParteRiuscita, ramoRiuscito, originaleIntera, stileRiuscito });
console.log(aParteRiuscita && ramoRiuscito && originaleIntera && stileRiuscito ? "RIUSCITA" : "NON RIUSCITA");
process.exit(0);
