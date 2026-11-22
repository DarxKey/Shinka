/**
 * Avvia il guardiano di un nodo, che a sua volta avvia e tiene acceso il nodo di Shinka su questa
 * macchina. Con lui il nodo sa passare da solo alla versione del centro, quando il centro glielo
 * chiede: il guardiano scambia le cartelle, lo riavvia e, se la versione nuova non si collega al
 * centro, rimette quella di prima.
 *
 * Va lanciato da una copia che sta fuori dalla cartella della versione in funzione: così un
 * aggiornamento non lo tocca. Ciò che segue il nome del file passa al nodo così com'è:
 *
 *   node guardiano/avvio-nodo.ts --centro http://192.168.1.20:7850 --nome "PC Windows"
 *
 * Variabili d'ambiente, oltre a quelle del nodo:
 *   SHINKA_INSTALLATA        la cartella della versione in funzione (predefinita: ./shinka)
 *   SHINKA_DATI_NODO         la cartella dei dati del nodo (predefinita: ./dati-nodo)
 *   SHINKA_GUARDIANO_ATTESA  quanti secondi aspettare che una versione nuova si colleghi (predefiniti: 180)
 */

import { join, resolve } from "node:path";
import { FILE_COLLEGATO, FILE_INSTALLAZIONE, Guardiano, leggiInstallazione, nodoCollegato } from "./guardiano.ts";

const installata = resolve(process.env.SHINKA_INSTALLATA ?? "shinka");
const dati = resolve(process.env.SHINKA_DATI_NODO ?? "dati-nodo");
const attesa = Number(process.env.SHINKA_GUARDIANO_ATTESA ?? "180");
const fileInstallazione = join(dati, FILE_INSTALLAZIONE);

// Il nodo parte dalla cartella della versione: i suoi dati devono restare fuori, dove uno scambio non li porta via.
process.env.SHINKA_DATI_NODO = dati;

const guardiano = new Guardiano({
  installata,
  fileInstallazione,
  comando: { programma: process.execPath, argomenti: ["src/nodo/avvio.ts", ...process.argv.slice(2)] },
  // Una versione nuova vale come partita quando il nodo scrive di essersi collegato al centro con quella.
  risponde: async () => nodoCollegato(join(dati, FILE_COLLEGATO), leggiInstallazione(fileInstallazione)?.versione),
  attesaMs: (Number.isFinite(attesa) && attesa > 0 ? attesa : 180) * 1000,
});

process.on("SIGINT", () => guardiano.spegni("SIGINT"));
process.on("SIGTERM", () => guardiano.spegni("SIGTERM"));

console.log(`[guardiano] Tengo acceso il nodo di Shinka da ${installata}.`);
process.exit(await guardiano.avvia());
