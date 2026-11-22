/**
 * Per provare il gateway in locale con Claude vero: avvia su questa macchina tre host SSH e due
 * siti di prova, in ascolto solo su 127.0.0.1, e collega il centro locale al gateway locale.
 *
 * Il primo host esegue davvero i comandi che riceve, con una password generata qui; il secondo
 * serve a vedere che una credenziale usata fuori dal suo host non ci arriva nemmeno. Lo stesso
 * vale per i siti: nel primo si entra con una password generata qui, il secondo è quello in cui
 * quella password non deve arrivare.
 * Il terzo host fa da host per gli stack di prova: dietro ha un Docker finto, che tiene a mente
 * container e cartelle senza avviare nulla, e un servizio "del proprietario" che non è di Shinka.
 * I valori di prova finiscono in `dati-gateway/host-di-prova.json`, che non entra nel repository:
 * il proprietario di prova li legge da lì per inserirli nella pagina del vault.
 *
 * Variabili d'ambiente:
 *   SHINKA_GATEWAY_DATI   cartella dei dati del gateway locale (predefinita: ./dati-gateway)
 *   SHINKA_DATI           cartella dei dati del centro locale (predefinita: ./dati)
 */

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { PORTA_GATEWAY } from "../protocollo/vault.ts";
import { DockerDiProva } from "./docker-di-prova.ts";
import { avviaHostDiProva, eseguiDavvero } from "./host-di-prova.ts";
import { avviaSitoDiProva } from "./sito-di-prova.ts";

const PORTA_PREVISTA = 2222;
const PORTA_ALTRA = 2223;
const PORTA_STACK = 2224;
const UTENTE = "prova";
const PORTA_SITO = 8123;
const PORTA_ALTRO_SITO = 8124;

const datiGateway = resolve(process.env.SHINKA_GATEWAY_DATI ?? "dati-gateway");
const datiCentro = resolve(process.env.SHINKA_DATI ?? "dati");
await mkdir(datiGateway, { recursive: true });

const fileValori = join(datiGateway, "host-di-prova.json");
interface Valori {
  host: string;
  altroHost: string;
  /** L'host da dichiarare per gli stack di prova, con le porte e la cartella da scrivere nella pagina del vault. */
  hostStack: string;
  porteStack: { da: number; a: number };
  cartellaStack: string;
  utente: string;
  password: string;
  fraseDelVault: string;
  sito: string;
  altroSito: string;
  utenteSito: string;
  passwordSito: string;
}
/** I valori di prova restano gli stessi da un avvio all'altro, così il vault di prova continua a valere. */
const valori: Valori = {
  host: `127.0.0.1:${PORTA_PREVISTA}`,
  altroHost: `127.0.0.1:${PORTA_ALTRA}`,
  hostStack: `127.0.0.1:${PORTA_STACK}`,
  porteStack: { da: 7900, a: 7999 },
  cartellaStack: "/srv/shinka-stack",
  utente: UTENTE,
  password: `Prova-${randomBytes(15).toString("base64url")}`,
  fraseDelVault: `frase di prova ${randomBytes(9).toString("base64url")}`,
  sito: `http://127.0.0.1:${PORTA_SITO}`,
  altroSito: `http://127.0.0.1:${PORTA_ALTRO_SITO}`,
  utenteSito: "prova@esempio.it",
  passwordSito: `Sito-${randomBytes(15).toString("base64url")}`,
  // Ciò che è già stato scritto resta: così il vault di prova continua a valere.
  ...(existsSync(fileValori) ? (JSON.parse(readFileSync(fileValori, "utf8")) as Partial<Valori>) : {}),
};
await writeFile(fileValori, `${JSON.stringify(valori, null, 2)}\n`, { mode: 0o600 });

const previsto = await avviaHostDiProva({
  utente: valori.utente,
  password: valori.password,
  porta: PORTA_PREVISTA,
  esegui: (comando) => {
    console.log(`[${valori.host}] comando: ${comando}`);
    return eseguiDavvero(comando);
  },
});
const altro = await avviaHostDiProva({
  utente: valori.utente,
  password: valori.password,
  porta: PORTA_ALTRA,
  esegui: (comando) => {
    console.log(`[${valori.altroHost}] comando: ${comando}`);
    return { uscita: "questo è l'host a cui la credenziale non doveva arrivare\n" };
  },
});

const docker = new DockerDiProva();
const perGliStack = await avviaHostDiProva({
  utente: valori.utente,
  password: valori.password,
  porta: PORTA_STACK,
  esegui: (comando, ingresso) => {
    console.log(`[${valori.hostStack}] comando: ${comando}`);
    return docker.esegui(comando, ingresso);
  },
});

const altroSito = await avviaSitoDiProva({
  utente: valori.utenteSito,
  password: valori.passwordSito,
  porta: PORTA_ALTRO_SITO,
  nome: "L'altro sito",
});
const sito = await avviaSitoDiProva({
  utente: valori.utenteSito,
  password: valori.passwordSito,
  porta: PORTA_SITO,
  altroSito: altroSito.origine,
});

// Il centro locale trova il gateway locale: indirizzo e gettone, senza scriverli a schermo.
const fileGettone = join(datiGateway, "gettone.txt");
if (existsSync(fileGettone) && existsSync(datiCentro)) {
  const indirizzo = `http://127.0.0.1:${PORTA_GATEWAY}`;
  await writeFile(
    join(datiCentro, "gateway.json"),
    `${JSON.stringify({ indirizzo, gettone: readFileSync(fileGettone, "utf8").trim(), pagina: indirizzo }, null, 2)}\n`,
    { mode: 0o600 },
  );
  console.log(`Il centro locale è collegato al gateway locale (${join(datiCentro, "gateway.json")}): riavvialo.`);
} else {
  console.log("Il gateway locale non è ancora partito una volta: avvialo con `npm run gateway`, poi rilancia questo script.");
}

console.log(`Host di prova su ${valori.host} (esegue davvero i comandi) e su ${valori.altroHost}.`);
console.log(`Host per gli stack di prova su ${valori.hostStack}: dietro c'è un Docker finto, con un servizio "plex" che non è di Shinka.`);
console.log(`Siti di prova su ${valori.sito} (ci si entra dalla pagina /entra) e su ${valori.altroSito}.`);
console.log(`Utenti, password e frase di prova del vault sono in ${fileValori}.`);

// Ogni tentativo di entrare si vede: sull'altro host non deve comparirne nessuno.
let visti = { previsto: 0, altro: 0, sito: 0, altroSito: 0, inviati: 0, container: "" };
setInterval(() => {
  if (previsto.tentativi !== visti.previsto || altro.tentativi !== visti.altro) {
    visti = { ...visti, previsto: previsto.tentativi, altro: altro.tentativi };
    console.log(`Tentativi di accesso: ${visti.previsto} su ${valori.host}, ${visti.altro} su ${valori.altroHost}`);
  }
  if (sito.tentativi.length !== visti.sito || altroSito.tentativi.length !== visti.altroSito) {
    visti = { ...visti, sito: sito.tentativi.length, altroSito: altroSito.tentativi.length };
    // Aprire la pagina di accesso conta come una visita; di una password si dice solo se è arrivata
    // e se era quella giusta, mai il valore. All'altro sito non ne deve arrivare nessuna.
    const giuste = sito.tentativi.filter((tentativo) => tentativo.password === valori.passwordSito).length;
    const arrivateAllAltro = altroSito.tentativi.filter((tentativo) => tentativo.password !== "").length;
    console.log(
      `Pagina di accesso: ${visti.sito} visite su ${valori.sito} (${giuste} con la password giusta), ` +
        `${visti.altroSito} su ${valori.altroSito} (${arrivateAllAltro} con una password)`,
    );
  }
  const container = docker.container.map((uno) => `${uno.nome} (${uno.stato})`).join(", ");
  if (container !== visti.container) {
    visti = { ...visti, container };
    console.log(`Container sull'host per gli stack: ${container}`);
  }
  if (sito.inviati.length !== visti.inviati) {
    visti = { ...visti, inviati: sito.inviati.length };
    console.log(`Moduli inviati al sito, oltre all'accesso: ${sito.inviati.join(", ")}`);
  }
}, 1_000);

async function spegni(): Promise<void> {
  await Promise.all([previsto.chiudi(), altro.chiudi(), perGliStack.chiudi(), sito.chiudi(), altroSito.chiudi()]);
  process.exit(0);
}
process.on("SIGINT", () => void spegni());
process.on("SIGTERM", () => void spegni());
