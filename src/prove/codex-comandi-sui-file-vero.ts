/**
 * Una prova sull'app-server vero di Codex, con l'accesso ChatGPT di questo ambiente: Codex cambia
 * dei file con un comando della shell, e le modifiche del turno devono dirli, «da un comando», con
 * la versione di prima; riportati com'erano, tornano identici. Usa una risposta breve.
 *
 *   node src/prove/codex-comandi-sui-file-vero.ts
 */

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConversazioneCodex } from "../nodo/codex/conversazione-codex.ts";
import type { EventoConversazione } from "../protocollo/eventi.ts";

const cartella = mkdtempSync(join(tmpdir(), "shinka-codex-comandi-"));
const dati = mkdtempSync(join(tmpdir(), "shinka-codex-comandi-dati-"));
writeFileSync(join(cartella, "conti.txt"), "mele 3\npere 2\n");
writeFileSync(join(cartella, "vecchio.txt"), "da togliere\n");
const eventi: EventoConversazione[] = [];
const conversazione = new ConversazioneCodex({
  cartella,
  cartellaModifiche: dati,
  istruzioni: "claude-code",
  istruzioniAggiunte: "Rispondi in italiano, in breve.",
  strumenti: "claude-code",
  strumentiSenzaRichiesta: [],
  impostazioni: { permessi: "senza-permessi", impegno: "low" },
  alEvento: (evento) => eventi.push(evento),
  alIdSessione: () => {},
});
conversazione.invia(
  "Esegui nella shell, in un comando solo, senza usare apply_patch e senza altri passi: sed -i 's/mele 3/mele 9/' conti.txt && echo generato > generato.txt && rm vecchio.txt. Poi rispondi 'fatto'.",
);
const arrivate = () => eventi.find((evento) => evento.tipo === "modifiche");
for (const fine = Date.now() + 240_000; arrivate() === undefined && Date.now() < fine; ) await new Promise((fatto) => setTimeout(fatto, 300));
for (const fine = Date.now() + 30_000; !eventi.some((evento) => evento.tipo === "turno-concluso") && Date.now() < fine; ) await new Promise((fatto) => setTimeout(fatto, 300));
const modifiche = arrivate();
console.log("azioni:", JSON.stringify(eventi.flatMap((evento) => (evento.tipo === "azione-iniziata" ? [evento.strumento] : []))));
console.log("modifiche:", JSON.stringify(modifiche));
console.log("stato:", JSON.stringify(eventi.flatMap((evento) => (evento.tipo === "stato" && evento.stato.fileDeiComandi !== undefined ? [evento.stato.fileDeiComandi] : []))));
const turno = modifiche?.tipo === "modifiche" ? modifiche : undefined;
const versioni = turno === undefined ? undefined : await conversazione.versioniModificate(turno.idTurno, "conti.txt");
console.log("versioni di conti.txt:", JSON.stringify(versioni));
const riportate = turno === undefined ? undefined : await conversazione.annullaModifiche(turno.idTurno);
console.log("riportate:", JSON.stringify(riportate));
conversazione.chiudi();
const file = turno?.file.map((voce) => `${voce.percorso}:${voce.stato}:${voce.daComando === true ? "comando" : "strumento"}`).sort() ?? [];
const ok =
  JSON.stringify(file) === JSON.stringify(["conti.txt:cambiato:comando", "generato.txt:nuovo:comando", "vecchio.txt:tolto:comando"]) &&
  readFileSync(join(cartella, "conti.txt"), "utf8") === "mele 3\npere 2\n" &&
  !existsSync(join(cartella, "generato.txt")) &&
  readFileSync(join(cartella, "vecchio.txt"), "utf8") === "da togliere\n";
console.log(ok ? "RIUSCITA" : "NON RIUSCITA");
process.exit(0);
