/**
 * Avvia il guardiano, che a sua volta avvia e tiene acceso il centro di Shinka.
 *
 * Va lanciato da una copia che sta fuori dalla cartella della versione in funzione: così
 * un'installazione non lo tocca.
 *
 * Variabili d'ambiente, oltre a quelle del centro, che gli passano così come sono:
 *   SHINKA_INSTALLATA        la cartella della versione in funzione (predefinita: ./shinka)
 *   SHINKA_DATI              la cartella dei dati del centro (predefinita: ./dati)
 *   SHINKA_PORTA             la porta del centro (predefinita: 7850)
 *   SHINKA_GUARDIANO_ATTESA  quanti secondi aspettare che una versione nuova risponda (predefiniti: 120)
 */

import { join, resolve } from "node:path";
import { FILE_INSTALLAZIONE, Guardiano } from "./guardiano.ts";

const installata = resolve(process.env.SHINKA_INSTALLATA ?? "shinka");
const dati = resolve(process.env.SHINKA_DATI ?? "dati");
const porta = Number(process.env.SHINKA_PORTA ?? "7850");
const attesa = Number(process.env.SHINKA_GUARDIANO_ATTESA ?? "120");

const guardiano = new Guardiano({
  installata,
  fileInstallazione: join(dati, FILE_INSTALLAZIONE),
  comando: { programma: process.execPath, argomenti: ["src/centro/avvio.ts"] },
  indirizzoDiProva: `http://127.0.0.1:${porta}/api/stato`,
  attesaMs: (Number.isFinite(attesa) && attesa > 0 ? attesa : 120) * 1000,
});

process.on("SIGINT", () => guardiano.spegni("SIGINT"));
process.on("SIGTERM", () => guardiano.spegni("SIGTERM"));

console.log(`[guardiano] Tengo acceso il centro di Shinka da ${installata}.`);
process.exit(await guardiano.avvia());
