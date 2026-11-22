/**
 * Una prova sull'harness vero: modificare un messaggio già mandato. La conversazione di Shinka
 * scrive un file in due turni; poi si guarda quali file tornerebbero com'erano riprendendo dal
 * secondo messaggio, si riparte da lì riportando i file, e si manda un messaggio nuovo: Claude non
 * deve ricordare la seconda richiesta, e il file deve essere quello del primo turno.
 * Usa l'abbonamento del proprietario per poche risposte brevi.
 *
 *   node src/prove/riprendi-da-un-messaggio.ts
 */

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Conversazione } from "../nodo/conversazione.ts";
import type { EventoConversazione } from "../protocollo/eventi.ts";

const cartella = mkdtempSync(join(tmpdir(), "shinka-riprendi-"));
const eventi: EventoConversazione[] = [];
let idSessione = "";
const conversazione = new Conversazione({
  cartella,
  istruzioni: "claude-code",
  strumenti: ["Write", "Read", "Edit"],
  strumentiSenzaRichiesta: [],
  impostazioni: { modello: "haiku", permessi: "senza-permessi" },
  alEvento: (evento) => eventi.push(evento),
  alIdSessione: (id) => (idSessione = id),
});
const conclusi = () => eventi.filter((evento) => evento.tipo === "turno-concluso").length;
const attendi = async (quanti: number) => {
  for (const fine = Date.now() + 90_000; conclusi() < quanti && Date.now() < fine; ) await new Promise((fatto) => setTimeout(fatto, 200));
};
const messaggi = () => eventi.flatMap((evento) => (evento.tipo === "messaggio-proprietario" ? [evento] : []));

conversazione.invia("Scrivi nel file nota.txt solo la parola UNO. Rispondi 'fatto'.");
await attendi(1);
conversazione.invia("Sostituisci il contenuto di nota.txt con la sola parola DUE. Rispondi 'fatto'.");
await attendi(2);
const secondo = messaggi()[1];
console.log("file dopo due turni:", readFileSync(join(cartella, "nota.txt"), "utf8").trim(), "| modificabile:", secondo?.modificabile);
console.log("anteprima:", JSON.stringify(await conversazione.anteprimaRiavvolgimento(secondo?.id ?? "")));
const motivo = await conversazione.riprendiDa(secondo?.id ?? "", { file: true });
console.log("ripresa:", motivo ?? "riuscita", "| file:", readFileSync(join(cartella, "nota.txt"), "utf8").trim(), "|", JSON.stringify(eventi.at(-1)));
const sessionePrima = idSessione;
conversazione.invia("Elenca, in una riga, tutte le richieste che ti ho fatto finora in questa conversazione.");
await attendi(3);
const risposta = eventi.flatMap((evento) => (evento.tipo === "testo-concluso" ? [evento.testo] : [])).at(-1) ?? "";
console.log("risposta:", risposta.replace(/\n/g, " ").slice(0, 200), "| stessa sessione:", sessionePrima === idSessione);
conversazione.chiudi();
console.log(!/DUE/.test(risposta) && motivo === undefined ? "RIUSCITA" : "NON RIUSCITA");
process.exit(0);
