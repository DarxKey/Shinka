/**
 * Per provare Telegram in locale senza un bot vero: avvia su questa macchina un Telegram finto,
 * in ascolto solo su 127.0.0.1, a cui il gateway locale si rivolge al posto di quello vero.
 *
 * Il gateway locale va avviato con SHINKA_TELEGRAM_API che punta qui. Il token di prova viene
 * generato qui e finisce in `dati-gateway/telegram-di-prova.json`, che non entra nel repository:
 * il proprietario di prova lo legge da lì per scriverlo nella pagina del vault.
 *
 * Chi scrive al bot e chi preme i pulsanti lo decide chi prova, con tre richieste:
 *   POST /prova/scrive   { da: { id, nome }, testo }
 *   POST /prova/preme    { da: { id, nome }, messaggio, dato }
 *   GET  /prova/messaggi ciò che il bot ha mandato finora
 *
 * Variabili d'ambiente:
 *   SHINKA_GATEWAY_DATI        cartella dei dati del gateway locale (predefinita: ./dati-gateway)
 *   SHINKA_TELEGRAM_DI_PROVA   la porta su cui ascolta (predefinita: 7853)
 */

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { TelegramDiProva } from "./telegram-di-prova.ts";

const datiGateway = resolve(process.env.SHINKA_GATEWAY_DATI ?? "dati-gateway");
const porta = Number(process.env.SHINKA_TELEGRAM_DI_PROVA ?? "7853");
await mkdir(datiGateway, { recursive: true });

interface Valori {
  api: string;
  gettone: string;
  proprietario: { id: number; nome: string; utente: string };
  estraneo: { id: number; nome: string };
}

const file = join(datiGateway, "telegram-di-prova.json");
const letti = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Partial<Valori>) : {};
const valori: Valori = {
  api: `http://127.0.0.1:${porta}`,
  // Ha la forma di un token vero, ma Telegram non lo conosce: vale solo qui.
  gettone: letti.gettone ?? `7000000001:PROVA${randomBytes(24).toString("base64url")}`,
  proprietario: letti.proprietario ?? { id: 111, nome: "Proprietario di prova", utente: "proprietario_di_prova" },
  estraneo: letti.estraneo ?? { id: 222, nome: "Qualcun altro" },
};
await writeFile(file, `${JSON.stringify(valori, null, 2)}\n`, { mode: 0o600 });

const finto = await TelegramDiProva.avvia({ gettone: valori.gettone, porta });
console.log(`Telegram di prova in ascolto su ${finto.indirizzo}: non è Telegram, e nulla esce da questa macchina.`);
console.log(`Avvia il gateway locale con SHINKA_TELEGRAM_API=${finto.indirizzo}`);
console.log(`Il token di prova e chi scrive al bot stanno in ${file}`);

const spegni = (): void => {
  void finto.chiudi().then(() => process.exit(0));
};
process.on("SIGINT", spegni);
process.on("SIGTERM", spegni);
