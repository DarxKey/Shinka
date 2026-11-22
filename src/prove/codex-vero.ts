/**
 * Una prova sull'app-server vero di Codex, con l'accesso ChatGPT di questo ambiente: una
 * conversazione di Shinka con il motore Codex crea un file (modifiche libere), poi, chiedendo
 * sempre, fa partire un comando solo dopo il sì del proprietario. Usa poche risposte brevi.
 *
 *   node src/prove/codex-vero.ts
 */

import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConversazioneCodex } from "../nodo/codex/conversazione-codex.ts";
import type { EventoConversazione } from "../protocollo/eventi.ts";
import type { ModoPermessi } from "../protocollo/impostazioni.ts";

const cartella = mkdtempSync(join(tmpdir(), "shinka-codex-vero-"));
const eventi: EventoConversazione[] = [];
let idSessione = "";
let modo: ModoPermessi = "modifiche-libere";
const conversazione = new ConversazioneCodex({
  cartella,
  istruzioni: "claude-code",
  istruzioniAggiunte: "Rispondi in italiano, in breve.",
  strumenti: "claude-code",
  strumentiSenzaRichiesta: [],
  impostazioni: { permessi: modo, impegno: "low" },
  alEvento: (evento) => {
    eventi.push(evento);
    if (evento.tipo === "permesso-richiesto") {
      console.log("permesso chiesto:", evento.strumento, JSON.stringify(evento.ingresso).slice(0, 120));
      // Il proprietario dice di sì.
      setTimeout(() => conversazione.decidiPermesso(evento.idPermesso, "approvato"), 200);
    }
  },
  alIdSessione: (id) => (idSessione = id),
});
const conclusi = () => eventi.filter((evento) => evento.tipo === "turno-concluso").length;
const attendi = async (quanti: number) => {
  for (const fine = Date.now() + 240_000; conclusi() < quanti && Date.now() < fine; ) await new Promise((fatto) => setTimeout(fatto, 300));
};

conversazione.invia("Crea nella cartella di lavoro il file ciao.txt con la sola parola CIAO. Poi rispondi 'fatto'.");
await attendi(1);
const primo = eventi.filter((evento) => evento.tipo !== "testo-frammento");
console.log("eventi del primo turno:", primo.map((evento) => evento.tipo).join(", "));
console.log("azioni:", JSON.stringify(primo.filter((evento) => evento.tipo === "azione-iniziata" || evento.tipo === "azione-conclusa")).slice(0, 600));
console.log("fine:", JSON.stringify(primo.find((evento) => evento.tipo === "turno-concluso")));
console.log("file:", existsSync(join(cartella, "ciao.txt")) ? readFileSync(join(cartella, "ciao.txt"), "utf8").trim() : "(non c'è)", "| thread:", idSessione);

modo = "chiedi";
conversazione.imposta({ permessi: modo, impegno: "low" });
conversazione.invia("Esegui il comando `ls` nella cartella di lavoro e dimmi che cosa contiene.");
await attendi(2);
const secondo = eventi.slice(primo.length);
console.log("secondo turno:", secondo.filter((evento) => evento.tipo !== "testo-frammento").map((evento) => evento.tipo).join(", "));
console.log("risposta:", eventi.flatMap((evento) => (evento.tipo === "testo-concluso" ? [evento.testo] : [])).at(-1)?.slice(0, 200));
const stati = eventi.flatMap((evento) => (evento.tipo === "stato" ? [evento.stato] : []));
console.log("limiti:", JSON.stringify(stati.find((stato) => stato.limiti !== undefined)?.limiti), "| modelli:", stati.find((stato) => stato.modelli !== undefined)?.modelli?.map((modello) => modello.valore).join(", "));
conversazione.chiudi();
const ok = existsSync(join(cartella, "ciao.txt")) && conclusi() >= 2 && eventi.some((evento) => evento.tipo === "permesso-richiesto");
console.log(ok ? "RIUSCITA" : "NON RIUSCITA");
process.exit(0);
