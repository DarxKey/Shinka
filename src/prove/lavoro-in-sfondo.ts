/**
 * Una prova sull'harness vero: un comando lanciato da Claude in background, che finisce dopo che
 * il turno si è chiuso. L'harness riapre da sé un turno per dirlo a Claude; la conversazione di
 * Shinka deve mostrarlo come un turno, contare il lavoro in background e non chiudere il processo
 * per inattività mentre il comando lavora (qui l'inattività è di tre secondi, il comando ne dura quindici).
 * Usa l'abbonamento del proprietario per poche risposte brevi.
 *
 *   node src/prove/lavoro-in-sfondo.ts
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Conversazione } from "../nodo/conversazione.ts";
import type { EventoConversazione } from "../protocollo/eventi.ts";

const inizio = Date.now();
const eventi: { s: string; evento: EventoConversazione }[] = [];
let conclusi = 0;
let fine: () => void = () => {};
const finita = new Promise<void>((fatto) => (fine = fatto));
const conversazione = new Conversazione({
  cartella: mkdtempSync(join(tmpdir(), "shinka-sfondo-")),
  istruzioni: "claude-code",
  strumenti: ["Bash"],
  strumentiSenzaRichiesta: [],
  impostazioni: { modello: "haiku", permessi: "senza-permessi" },
  inattivitaMs: 3000,
  alEvento: (evento) => {
    if (evento.tipo === "testo-frammento") return;
    eventi.push({ s: ((Date.now() - inizio) / 1000).toFixed(1), evento });
    if (evento.tipo === "turno-concluso" && ++conclusi === 2) fine();
  },
  alIdSessione: () => {},
});
conversazione.invia(
  "Lancia con Bash in background (run_in_background) il comando `sleep 15; echo FATTO-IN-SFONDO`, poi rispondi solo 'lanciato' e chiudi il turno. Quando il comando finisce, dimmi 'finito' e che cosa ha scritto.",
);
await Promise.race([finita, new Promise((fatto) => setTimeout(fatto, 90_000))]);
conversazione.chiudi();
for (const { s, evento } of eventi) {
  const dettaglio =
    evento.tipo === "testo-concluso" ? evento.testo.slice(0, 70) : evento.tipo === "stato" ? JSON.stringify(evento.stato).slice(0, 70) : evento.tipo === "errore" ? evento.messaggio : "";
  if (evento.tipo === "stato" && evento.stato.inSfondo === undefined) continue;
  console.log(s, evento.tipo, dettaglio);
}
console.log(conclusi === 2 ? "RIUSCITA: il turno dell'harness è arrivato come turno" : "NON RIUSCITA: il secondo turno non è arrivato");
process.exit(0);
