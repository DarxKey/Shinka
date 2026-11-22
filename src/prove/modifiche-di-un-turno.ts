/**
 * Una prova sull'harness vero del pannello Modifiche: in un turno Claude crea un file e ne cambia
 * un altro con i suoi strumenti; a fine turno la conversazione deve dire quali file sono cambiati,
 * con le righe aggiunte e tolte, tenerne le due versioni e saperli riportare a com'erano. In un
 * secondo turno cambia dei file con un comando: devono esserci anche quelli, detti «da un comando».
 * Usa l'abbonamento del proprietario per due risposte brevi.
 *
 *   node src/prove/modifiche-di-un-turno.ts
 */

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Conversazione } from "../nodo/conversazione.ts";
import type { EventoConversazione } from "../protocollo/eventi.ts";

const cartella = mkdtempSync(join(tmpdir(), "shinka-modifiche-vere-"));
const dati = mkdtempSync(join(tmpdir(), "shinka-modifiche-dati-"));
writeFileSync(join(cartella, "conti.txt"), "mele 3\npere 2\n");
const eventi: EventoConversazione[] = [];
const conversazione = new Conversazione({
  cartella,
  cartellaModifiche: dati,
  istruzioni: "claude-code",
  strumenti: ["Read", "Write", "Edit", "Bash"],
  strumentiSenzaRichiesta: [],
  impostazioni: { modello: "haiku", permessi: "senza-permessi" },
  alEvento: (evento) => eventi.push(evento),
  alIdSessione: () => {},
});
conversazione.invia("Con gli strumenti Edit e Write, senza Bash: nel file conti.txt sostituisci 'pere 2' con 'pere 5', e crea il file nuovo.txt con la sola riga 'ciao'. Poi rispondi 'fatto'.");
const modificheArrivate = () => eventi.find((evento) => evento.tipo === "modifiche");
for (const fine = Date.now() + 120_000; modificheArrivate() === undefined && Date.now() < fine; ) await new Promise((fatto) => setTimeout(fatto, 200));
const modifiche = modificheArrivate();
console.log("modifiche:", JSON.stringify(modifiche));
console.log("strumenti usati:", JSON.stringify(eventi.flatMap((evento) => (evento.tipo === "azione-iniziata" ? [evento.strumento] : []))));
const riuscite = modifiche?.tipo === "modifiche" ? modifiche : undefined;
const versioni = riuscite === undefined ? undefined : await conversazione.versioniModificate(riuscite.idTurno, "conti.txt");
console.log("versioni di conti.txt:", JSON.stringify(versioni));
const annullate = riuscite === undefined ? undefined : await conversazione.annullaModifiche(riuscite.idTurno);
console.log("annullate:", JSON.stringify(annullate), "| conti.txt:", JSON.stringify(readFileSync(join(cartella, "conti.txt"), "utf8")), "| nuovo.txt c'è:", existsSync(join(cartella, "nuovo.txt")));

// Secondo turno: un comando cambia un file, ne crea uno e ne toglie uno; nessuno strumento di modifica.
writeFileSync(join(cartella, "vecchio.txt"), "da togliere\n");
eventi.length = 0;
conversazione.invia("Esegui con Bash, in un comando solo e senza altri strumenti: sed -i 's/mele 3/mele 9/' conti.txt && echo generato > generato.txt && rm vecchio.txt. Poi rispondi 'fatto'.");
for (const fine = Date.now() + 120_000; modificheArrivate() === undefined && Date.now() < fine; ) await new Promise((fatto) => setTimeout(fatto, 200));
const daComandi = modificheArrivate();
console.log("modifiche dei comandi:", JSON.stringify(daComandi));
console.log("stato:", JSON.stringify(eventi.flatMap((evento) => (evento.tipo === "stato" && evento.stato.fileDeiComandi !== undefined ? [evento.stato.fileDeiComandi] : []))));
const turnoDeiComandi = daComandi?.tipo === "modifiche" ? daComandi : undefined;
for (const fine = Date.now() + 30_000; !eventi.some((evento) => evento.tipo === "turno-concluso") && Date.now() < fine; ) await new Promise((fatto) => setTimeout(fatto, 200));
const riportate = turnoDeiComandi === undefined ? undefined : await conversazione.annullaModifiche(turnoDeiComandi.idTurno);
console.log("riportate:", JSON.stringify(riportate));
const fileDeiComandi = turnoDeiComandi?.file.map((voce) => `${voce.percorso}:${voce.stato}:${voce.daComando === true ? "comando" : "strumento"}`).sort() ?? [];
const okComandi =
  JSON.stringify(fileDeiComandi) === JSON.stringify(["conti.txt:cambiato:comando", "generato.txt:nuovo:comando", "vecchio.txt:tolto:comando"]) &&
  readFileSync(join(cartella, "conti.txt"), "utf8") === "mele 3\npere 2\n" &&
  !existsSync(join(cartella, "generato.txt")) &&
  existsSync(join(cartella, "vecchio.txt"));
conversazione.chiudi();
const file = riuscite?.file.map((voce) => `${voce.percorso}:${voce.stato}:+${voce.aggiunte}-${voce.tolte}`).sort() ?? [];
const ok =
  JSON.stringify(file) === JSON.stringify(["conti.txt:cambiato:+1-1", "nuovo.txt:nuovo:+1-0"]) &&
  versioni !== undefined && "prima" in versioni && versioni.prima === "mele 3\npere 2\n" &&
  readFileSync(join(cartella, "conti.txt"), "utf8") === "mele 3\npere 2\n" && !existsSync(join(cartella, "nuovo.txt"));
console.log(ok && okComandi ? "RIUSCITA" : `NON RIUSCITA (strumenti: ${ok}, comandi: ${okComandi})`);
process.exit(0);
