/**
 * Avvia il guardiano del gateway, che a sua volta avvia e tiene acceso il gateway di Shinka. Con
 * lui il gateway sa cambiare versione da dentro: il centro gliela propone, il gateway chiede il sì
 * al proprietario lui stesso e si spegne; il guardiano scambia le cartelle, lo riavvia e, se la
 * versione nuova non risponde, rimette quella di prima.
 *
 * Va lanciato da una copia che sta fuori dalla cartella della versione in funzione: così
 * un'installazione non lo tocca. Il guardiano del gateway, come gli altri, si cambia solo da fuori.
 *
 * Variabili d'ambiente, oltre a quelle del gateway, che gli passano così come sono:
 *   SHINKA_INSTALLATA        la cartella della versione in funzione (predefinita: ./shinka)
 *   SHINKA_GATEWAY_DATI      la cartella dei dati del gateway (predefinita: ./dati-gateway)
 *   SHINKA_GATEWAY_PORTA     la porta del gateway (predefinita: 7851)
 *   SHINKA_GUARDIANO_ATTESA  quanti secondi aspettare che una versione nuova risponda (predefiniti: 120)
 */

import { join, resolve } from "node:path";
import { FILE_INSTALLAZIONE, Guardiano } from "./guardiano.ts";

const installata = resolve(process.env.SHINKA_INSTALLATA ?? "shinka");
const dati = resolve(process.env.SHINKA_GATEWAY_DATI ?? "dati-gateway");
const porta = Number(process.env.SHINKA_GATEWAY_PORTA ?? "7851");
const attesa = Number(process.env.SHINKA_GUARDIANO_ATTESA ?? "120");

// Il gateway parte dalla cartella della versione: i suoi dati devono restare fuori, dove uno scambio non li porta via.
process.env.SHINKA_GATEWAY_DATI = dati;

const guardiano = new Guardiano({
  installata,
  fileInstallazione: join(dati, FILE_INSTALLAZIONE),
  comando: { programma: process.execPath, argomenti: ["src/gateway/avvio.ts"] },
  // La pagina del vault dice in che condizione è anche a vault chiuso: se risponde, il gateway è partito.
  indirizzoDiProva: `http://127.0.0.1:${porta}/vault/stato`,
  attesaMs: (Number.isFinite(attesa) && attesa > 0 ? attesa : 120) * 1000,
});

process.on("SIGINT", () => guardiano.spegni("SIGINT"));
process.on("SIGTERM", () => guardiano.spegni("SIGTERM"));

console.log(`[guardiano] Tengo acceso il gateway di Shinka da ${installata}.`);
process.exit(await guardiano.avvia());
