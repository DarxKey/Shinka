/**
 * Una prova sull'harness vero: un messaggio mandato mentre Claude lavora entra nel turno in
 * corso, e l'harness chiude un turno solo. La conversazione di Shinka non deve lasciare turni
 * aperti: prima ne contava due e ne chiudeva uno, e la Home restava bloccata in attesa.
 * Usa l'abbonamento del proprietario per poche risposte brevi.
 *
 *   node src/prove/messaggi-a-turno-in-corso.ts
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Conversazione } from "../nodo/conversazione.ts";

let aperti = 0;
let iniziati = 0;
let conclusi = 0;
const testi: string[] = [];
const conversazione = new Conversazione({
  cartella: mkdtempSync(join(tmpdir(), "shinka-due-")),
  istruzioni: "claude-code",
  strumenti: ["Bash"],
  strumentiSenzaRichiesta: [],
  impostazioni: { modello: "haiku", permessi: "senza-permessi" },
  alEvento: (evento) => {
    if (evento.tipo === "turno-iniziato") {
      aperti += 1;
      iniziati += 1;
    }
    if (evento.tipo === "turno-concluso") {
      aperti -= 1;
      conclusi += 1;
    }
    if (evento.tipo === "testo-concluso") testi.push(evento.testo.replace(/\n/g, " ").slice(0, 70));
  },
  alIdSessione: () => {},
});
const attendi = (ms: number) => new Promise((fatto) => setTimeout(fatto, ms));
const finche = async (condizione: () => boolean, ms: number) => {
  for (const fine = Date.now() + ms; !condizione() && Date.now() < fine; ) await attendi(200);
};

conversazione.invia("Esegui con Bash `sleep 6; echo uno`, poi dimmi che cosa ha scritto.");
await attendi(3000);
conversazione.invia("E poi dimmi anche quanto fa 2+2.");
await finche(() => iniziati > 0 && aperti === 0, 60_000);
console.log(`dopo due messaggi: ${iniziati} turni iniziati, ${conclusi} conclusi, ${aperti} aperti`);
conversazione.invia("Adesso dimmi solo: tre.");
await finche(() => iniziati >= 2 && aperti === 0, 60_000);
console.log(`dopo il terzo: ${iniziati} turni iniziati, ${conclusi} conclusi, ${aperti} aperti`);
for (const testo of testi) console.log("  ", testo);
conversazione.chiudi();
console.log(aperti === 0 && iniziati === conclusi ? "RIUSCITA: nessun turno rimasto aperto" : "NON RIUSCITA");
process.exit(0);
