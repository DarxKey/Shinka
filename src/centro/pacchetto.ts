/**
 * Il pacchetto con cui il centro passa a un nodo la versione di Shinka che ha in funzione: il
 * codice e ciò che serve per scaricare le dipendenze, letti dalla cartella da cui il centro gira.
 * Non ci sono i test, l'interfaccia né le dipendenze: quelle il nodo le scarica per il suo sistema.
 *
 * Per il gateway il pacchetto è più piccolo: solo i file che il gateway carica davvero, trovati
 * seguendo ciò che importa a partire dal suo avvio. Così una versione che non tocca nulla di ciò
 * che il gateway usa non gli chiede di cambiare, e al proprietario non viene chiesto nulla.
 */

import { readdir, readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import {
  CARTELLA_DEL_CODICE,
  FILE_IN_CIMA,
  FILE_MASSIMI,
  FILE_VERSIONE,
  PESO_MASSIMO,
  percorsoDelGatewayValido,
  percorsoDiVersioneValido,
  type FileDiVersione,
} from "../protocollo/versione.ts";

/** Da dove parte il gateway, e la cartella della sua pagina, che non è importata ma servita. */
const AVVIO_DEL_GATEWAY = "src/gateway/avvio.ts";
const PAGINA_DEL_GATEWAY = "src/gateway/pagina";

/** Ciò che un file importa da un altro file di Shinka: `from "./x.ts"`, `import "./x.ts"`, `import("./x.ts")`. */
const IMPORTATO = /(?:\bfrom\s*|\bimport\s*\(?\s*)["'](\.{1,2}\/[^"']+)["']/g;

async function percorsiDelCodice(installata: string, relativa: string): Promise<string[]> {
  const voci = await readdir(join(installata, relativa), { withFileTypes: true });
  const trovati: string[] = [];
  for (const voce of voci.sort((a, b) => a.name.localeCompare(b.name))) {
    const percorso = `${relativa}/${voce.name}`;
    if (voce.isDirectory()) trovati.push(...(await percorsiDelCodice(installata, percorso)));
    else if (voce.isFile() && !voce.name.endsWith(".test.ts")) trovati.push(percorso);
  }
  return trovati;
}

/**
 * Legge dalla cartella della versione in funzione ciò che serve a un nodo. Lancia se manca il file
 * della versione, se un nome non è di quelli che un pacchetto può portare, o se pesa troppo.
 */
export async function pacchettoDellaVersione(installata: string): Promise<FileDiVersione[]> {
  const percorsi = [...FILE_IN_CIMA, ...(await percorsiDelCodice(installata, CARTELLA_DEL_CODICE))];
  if (percorsi.length > FILE_MASSIMI) throw new Error(`La versione ha ${percorsi.length} file: troppi per passarla a un nodo.`);
  const file: FileDiVersione[] = [];
  let peso = 0;
  for (const percorso of percorsi) {
    if (!percorsoDiVersioneValido(percorso)) throw new Error(`Il file ${percorso} ha un nome che non si può passare a un nodo.`);
    let dati: string;
    try {
      dati = (await readFile(join(installata, percorso))).toString("base64");
    } catch (errore) {
      // Senza il file della versione il nodo non saprebbe dire a che versione è: gli altri in cima possono mancare.
      if (percorso !== FILE_VERSIONE && percorso !== "package.json" && (FILE_IN_CIMA as readonly string[]).includes(percorso)) continue;
      throw errore;
    }
    peso += dati.length;
    if (peso > PESO_MASSIMO) throw new Error("La versione pesa troppo per passarla a un nodo.");
    file.push({ percorso, dati });
  }
  return file;
}

/**
 * I file che il gateway carica: quello da cui parte, tutto ciò che importa, direttamente o no, e
 * la sua pagina. Lancia se un file importato esce da ciò che un pacchetto per il gateway può portare.
 */
async function percorsiDelGateway(installata: string): Promise<string[]> {
  const visti = new Set<string>();
  const daLeggere = [AVVIO_DEL_GATEWAY];
  while (daLeggere.length > 0) {
    const percorso = daLeggere.pop() as string;
    if (visti.has(percorso)) continue;
    if (!percorsoDelGatewayValido(percorso)) throw new Error(`Il gateway importa ${percorso}, che non fa parte di ciò che gli si può passare.`);
    visti.add(percorso);
    const testo = await readFile(join(installata, percorso), "utf8");
    for (const trovato of testo.matchAll(IMPORTATO)) {
      daLeggere.push(posix.normalize(posix.join(posix.dirname(percorso), trovato[1] as string)));
    }
  }
  return [...visti, ...(await percorsiDelCodice(installata, PAGINA_DEL_GATEWAY))].sort();
}

/**
 * Legge dalla cartella di una versione ciò che serve al gateway. Lancia se manca il file della
 * versione, se un nome non è di quelli che il pacchetto può portare, o se pesa troppo.
 */
export async function pacchettoDelGateway(installata: string): Promise<FileDiVersione[]> {
  const file: FileDiVersione[] = [];
  let peso = 0;
  for (const percorso of [...FILE_IN_CIMA, ...(await percorsiDelGateway(installata))]) {
    let dati: string;
    try {
      dati = (await readFile(join(installata, percorso))).toString("base64");
    } catch (errore) {
      if (percorso !== FILE_VERSIONE && percorso !== "package.json" && (FILE_IN_CIMA as readonly string[]).includes(percorso)) continue;
      throw errore;
    }
    peso += dati.length;
    if (peso > PESO_MASSIMO) throw new Error("La parte del gateway pesa troppo per passargliela.");
    file.push({ percorso, dati });
  }
  return file;
}

/** Vero se tra due versioni cambia qualcosa di ciò che il gateway carica. Il nome della versione non conta. */
export async function cambiaLaParteDelGateway(prima: string, dopo: string): Promise<boolean> {
  const [vecchio, nuovo] = await Promise.all([pacchettoDelGateway(prima), pacchettoDelGateway(dopo)]);
  const senzaNome = (file: FileDiVersione[]): string =>
    JSON.stringify(file.filter((uno) => uno.percorso !== FILE_VERSIONE).map((uno) => [uno.percorso, uno.dati]));
  return senzaNome(vecchio) !== senzaNome(nuovo);
}
