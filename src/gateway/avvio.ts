/**
 * Avvia il gateway di Shinka: il processo separato che custodisce il vault, esegue le
 * operazioni che usano una credenziale, gestisce gli stack di prova sugli host del lab,
 * tiene il bot Telegram e scrive il registro.
 *
 * Deve girare dove le conversazioni di Claude non arrivano: un altro container, o almeno un
 * altro utente, con la cartella dei dati che il centro e i nodi non possono leggere.
 *
 * Variabili d'ambiente:
 *   SHINKA_GATEWAY_DATI           cartella dei dati (predefinita: ./dati-gateway)
 *   SHINKA_GATEWAY_INDIRIZZO      indirizzo di ascolto (predefinito: 127.0.0.1)
 *   SHINKA_GATEWAY_PORTA          porta di ascolto (predefinita: 7851)
 *   SHINKA_GATEWAY_COOKIE_SICURO  "1" se la pagina del vault è servita in HTTPS
 *   SHINKA_GATEWAY_PAGINA         gli indirizzi a cui il proprietario apre la pagina del vault, separati
 *                                 da virgole: il browser del gateway non li raggiunge
 *   SHINKA_BROWSER_CANALE         il browser installato da usare, per esempio "msedge" o "chrome"
 *                                 (predefinito: "msedge" su Windows, altrove il Chromium di Playwright)
 *   SHINKA_BROWSER_ESEGUIBILE     il percorso dell'eseguibile del browser, se non è al suo posto
 *   SHINKA_BROWSER_RECINTO        "0" per avviare Chromium senza il suo recinto (sandbox)
 *   SHINKA_BROWSER_VISIBILE       "1" per vedere la finestra del browser, nelle prove su un PC
 *   SHINKA_TELEGRAM_API           dove risponde Telegram: si indica solo nelle prove, con un Telegram finto
 *
 * Se a tenerlo acceso è il suo guardiano (src/guardiano/avvio-gateway.ts), il gateway sa anche
 * cambiare versione da dentro: il centro gliela propone, il sì lo chiede il gateway al proprietario.
 */

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { hostname, networkInterfaces } from "node:os";
import { join, resolve } from "node:path";
import { CODICE_RIAVVIO, FILE_INSTALLAZIONE } from "../guardiano/guardiano.ts";
import { leggiSito, PORTA_GATEWAY } from "../protocollo/vault.ts";
import { inBreve } from "../protocollo/versione.ts";
import { AggiornamentoDelGateway } from "./aggiornamento.ts";
import { BrowserDelGateway } from "./browser.ts";
import { DomandeAlProprietario } from "./domande.ts";
import { Registro } from "./registro.ts";
import { creaGateway } from "./servizio.ts";
import { StackDiProva } from "./stack.ts";
import { Telegram } from "./telegram.ts";
import { Operazioni } from "./uso.ts";
import { Vault } from "./vault.ts";

const dati = resolve(process.env.SHINKA_GATEWAY_DATI ?? "dati-gateway");
const indirizzo = process.env.SHINKA_GATEWAY_INDIRIZZO ?? "127.0.0.1";
const porta = Number(process.env.SHINKA_GATEWAY_PORTA ?? String(PORTA_GATEWAY));

if (!Number.isInteger(porta) || porta < 1 || porta > 65535) {
  throw new Error(`SHINKA_GATEWAY_PORTA non è una porta valida: ${process.env.SHINKA_GATEWAY_PORTA}`);
}

await mkdir(dati, { recursive: true, mode: 0o700 });

/** Il gettone con cui il centro si presenta: nasce al primo avvio e resta in un file. */
const fileGettone = join(dati, "gettone.txt");
if (!existsSync(fileGettone)) {
  await writeFile(fileGettone, `${randomBytes(32).toString("base64url")}\n`, { mode: 0o600, flag: "wx" });
}
const gettone = readFileSync(fileGettone, "utf8").trim();
if (gettone.length < 32) throw new Error(`Il gettone in ${fileGettone} è troppo corto: cancella il file e riavvia.`);

const vault = await Vault.apri(join(dati, "vault.json"));
const registro = await Registro.apri(join(dati, "registro.jsonl"));

/** Le pagine del gateway stesso: il suo browser non deve poterle aprire. */
const nomiDiQuestaMacchina = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "[::1]",
  hostname().toLowerCase(),
  ...Object.values(networkInterfaces())
    .flat()
    .map((scheda) => (scheda === undefined ? "" : scheda.family === "IPv6" ? `[${scheda.address}]` : scheda.address)),
]);
const pagineDelGateway = new Set(
  (process.env.SHINKA_GATEWAY_PAGINA ?? "")
    .split(",")
    .map((scritta) => leggiSito(scritta))
    .filter((origine) => origine !== undefined),
);
const canale = process.env.SHINKA_BROWSER_CANALE ?? (process.platform === "win32" ? "msedge" : "");
const eseguibile = process.env.SHINKA_BROWSER_ESEGUIBILE ?? "";
const browser = new BrowserDelGateway(vault, registro, {
  profilo: join(dati, "browser"),
  ...(canale === "" ? {} : { canale }),
  ...(eseguibile === "" ? {} : { eseguibile }),
  recinto: process.env.SHINKA_BROWSER_RECINTO !== "0",
  visibile: process.env.SHINKA_BROWSER_VISIBILE === "1",
  vietato: (indirizzo) => {
    if (pagineDelGateway.has(indirizzo.origin)) return true;
    const nome = indirizzo.hostname.toLowerCase();
    const suaPorta = Number(indirizzo.port === "" ? (indirizzo.protocol === "https:" ? 443 : 80) : indirizzo.port);
    return suaPorta === porta && (nomiDiQuestaMacchina.has(nome) || nome.endsWith(".localhost"));
  },
});

// Il token del bot sta in un file a parte, fuori dal vault cifrato: Telegram funziona anche a vault chiuso.
const apiDiTelegram = process.env.SHINKA_TELEGRAM_API ?? "";
const telegram = await Telegram.apri({
  file: join(dati, "telegram.json"),
  ...(apiDiTelegram === "" ? {} : { api: apiDiTelegram }),
});

// Le domande che il gateway fa al proprietario da sé: il sì a una sua versione nuova, e a un comando sul server.
const domande = new DomandeAlProprietario({ telegram });
const aggiornamento = await AggiornamentoDelGateway.apri({
  // Il gateway gira dalla cartella della sua versione: è lì che il guardiano l'ha avviato.
  installata: process.cwd(),
  fileInstallazione: join(dati, FILE_INSTALLAZIONE),
  colGuardiano: process.env.SHINKA_GUARDIANO === "1",
  domande,
  telegram,
  registro,
  riavvia: () => void spegni(CODICE_RIAVVIO),
});

const gateway = await creaGateway({
  vault,
  registro,
  operazioni: new Operazioni(vault, registro, undefined, domande),
  stack: new StackDiProva(vault, registro),
  browser,
  telegram,
  domande,
  aggiornamento,
  gettone,
  cookieSicuro: process.env.SHINKA_GATEWAY_COOKIE_SICURO === "1",
});
await gateway.listen({ host: indirizzo, port: porta });

console.log(`Gateway di Shinka in ascolto su http://${indirizzo}:${porta}`);
console.log(`Dati in ${dati}; il gettone per il centro è in ${fileGettone}`);
console.log(
  vault.condizione === "da-impostare"
    ? "Il vault non è ancora impostato: il proprietario sceglie la frase di sblocco dalla pagina."
    : "Il vault è chiuso: il proprietario lo sblocca dalla pagina con la sua frase.",
);
console.log(
  {
    "da-configurare": "Telegram non è configurato: il proprietario scrive il token del bot dalla pagina del vault.",
    "da-abbinare": "Telegram: il bot c'è ma non è abbinato; il proprietario lo abbina dalla pagina del vault.",
    attivo: "Telegram: il bot è abbinato al proprietario e ascolta solo lui.",
    errore: "Telegram: il bot è configurato ma c'è un problema; la pagina del vault dice quale.",
  }[telegram.stato.condizione],
);
if (apiDiTelegram !== "") console.log(`Telegram di prova: il bot parla con ${apiDiTelegram}, non con Telegram.`);
console.log(
  (aggiornamento.versione === undefined ? "Versione non scritta nella cartella. " : `Versione ${inBreve(aggiornamento.versione)}. `) +
    (aggiornamento.colGuardiano
      ? "Il gateway è tenuto acceso dal suo guardiano: sa cambiare versione, con il sì del proprietario."
      : "Il gateway non è sotto il suo guardiano: una versione nuova si mette solo da fuori."),
);
// Se è appena ripartito dopo un'installazione, il gateway dice al proprietario com'è finita.
void aggiornamento.riferisci();

async function spegni(codice = 0): Promise<void> {
  domande.ferma();
  telegram.ferma();
  await browser.spegni();
  vault.chiudi();
  await gateway.close();
  process.exit(codice);
}
process.on("SIGINT", () => void spegni());
process.on("SIGTERM", () => void spegni());
