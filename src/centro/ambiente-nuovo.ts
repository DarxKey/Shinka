/**
 * Un ambiente nuovo con un comando di una riga (ADR 0033). Il proprietario sceglie dalla pagina
 * Ambienti il sistema e il nome; il centro prepara un invito che vale un'ora e il comando da
 * incollare su quella macchina. Il comando scarica dal centro lo script di preparazione, e lo
 * script scarica il pacchetto del nodo: il codice della versione in funzione e il suo guardiano.
 * Poi installa le dipendenze, fa partire il nodo con il guardiano all'accensione della macchina e
 * dice il codice di verifica. Il nodo resta sconosciuto finché il proprietario non lo approva:
 * l'invito non vale come consenso.
 *
 * Il comando porta con sé l'impronta del certificato dei nodi (ADR 0040), che il proprietario copia
 * dalla pagina di Shinka: su Linux lo script e il pacchetto si scaricano cifrati, da chi presenta
 * quel certificato e da nessun altro, e il nodo nasce ricordandolo. Su Windows lo scaricamento è
 * ancora in chiaro; il nodo riceve comunque l'impronta, e il suo collegamento è cifrato dal primo.
 */

import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { NOME_TLS_DEI_NODI } from "../protocollo/nodi.ts";
import { FILE_IN_CIMA, inBreve, versioneDi } from "../protocollo/versione.ts";
import { archivioTarGz, type VoceArchivio } from "./archivio-tar.ts";
import { DESCRIZIONE_AMBIENTE_MASSIMA, NOME_AMBIENTE_MASSIMO } from "./impostazioni-installazione.ts";

export const SISTEMI_PREPARABILI = ["linux", "windows"] as const;
export type SistemaPreparabile = (typeof SISTEMI_PREPARABILI)[number];

/** Quanto vale un invito: il tempo di aprire una finestra su quella macchina e incollare il comando. */
export const DURATA_INVITO_MS = 60 * 60 * 1000;
/** Gli inviti validi nello stesso momento: i più vecchi lasciano il posto ai nuovi. */
const INVITI_MASSIMI = 5;

/** I percorsi che il comando di una riga e lo script chiamano: liberi, perché bastano l'invito. */
export const PERCORSO_PREPARAZIONE = "/api/ambienti/preparazione";
export const PERCORSO_PACCHETTO_NODO = "/api/ambienti/preparazione/pacchetto";

export interface Invito {
  gettone: string;
  sistema: SistemaPreparabile;
  /** L'indirizzo del centro come lo raggiunge quella macchina, in HTTP: è quello che il nodo userà. */
  centro: string;
  nome: string;
  descrizione: string;
  /** Millisecondi dall'epoca. */
  scade: number;
}

/** Ciò che serve del certificato dei nodi per scrivere il comando e lo script. */
export interface CertificatoPerGliInviti {
  /** L'impronta del certificato: ciò che il nodo ricorda. */
  impronta: string;
  /** L'impronta della chiave pubblica, in base64: ciò che vuole `curl --pinnedpubkey`. */
  improntaDellaChiave: string;
}

export interface RichiestaInvito {
  sistema: string;
  centro: string;
  nome: string;
  descrizione?: string;
}

/** Ciò che la pagina mostra: il comando da incollare e fino a quando vale. */
export interface InvitoPronto {
  comando: string;
  sistema: SistemaPreparabile;
  scade: string;
}

/** Un nome o una descrizione per lo script: una riga sola, senza caratteri di controllo. */
function ripulito(testo: string, massimo: number): string {
  return testo
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim()
    .slice(0, massimo);
}

/**
 * L'indirizzo del centro per il nodo: solo schema, host e porta. Si dà in HTTP anche quando il
 * proprietario apre Shinka in HTTPS, perché i nodi si collegano in HTTP sulla stessa porta (ADR 0017).
 */
export function indirizzoPerIlNodo(centro: string): string {
  let indirizzo: URL;
  try {
    indirizzo = new URL(centro.trim());
  } catch {
    throw new Error("L'indirizzo del centro non è un indirizzo: scrivilo come http://192.168.1.10:7850.");
  }
  if (indirizzo.protocol !== "http:" && indirizzo.protocol !== "https:") throw new Error("L'indirizzo del centro deve cominciare con http://.");
  if (indirizzo.username !== "" || indirizzo.password !== "") throw new Error("L'indirizzo del centro non può contenere un nome utente.");
  if (!/^[A-Za-z0-9.\-[\]:]+$/.test(indirizzo.host)) throw new Error("L'indirizzo del centro contiene caratteri che non vanno.");
  const porta = indirizzo.port === "" ? (indirizzo.protocol === "https:" ? "443" : "80") : indirizzo.port;
  return `http://${indirizzo.hostname}:${porta}`;
}

export class InvitiDegliAmbienti {
  readonly #inviti = new Map<string, Invito>();
  readonly #adesso: () => number;
  readonly #certificato: CertificatoPerGliInviti | undefined;

  constructor(opzioni: { adesso?: () => number; certificato?: CertificatoPerGliInviti } = {}) {
    this.#adesso = opzioni.adesso ?? Date.now;
    this.#certificato = opzioni.certificato;
  }

  /** Il certificato dei nodi di questo centro, se ne ha uno: lo script di un invito lo porta con sé. */
  get certificato(): CertificatoPerGliInviti | undefined {
    return this.#certificato;
  }

  /** Prepara un invito e il comando che lo usa. Lancia se sistema, nome o indirizzo non vanno. */
  crea(richiesta: RichiestaInvito): InvitoPronto {
    const sistema = SISTEMI_PREPARABILI.find((uno) => uno === richiesta.sistema);
    if (sistema === undefined) throw new Error("Il sistema dev'essere Linux o Windows.");
    const nome = ripulito(richiesta.nome, NOME_AMBIENTE_MASSIMO);
    if (nome === "") throw new Error("Manca il nome dell'ambiente.");
    const centro = indirizzoPerIlNodo(richiesta.centro);
    this.#togliScaduti();
    while (this.#inviti.size >= INVITI_MASSIMI) {
      const piuVecchio = this.#inviti.keys().next().value as string;
      this.#inviti.delete(piuVecchio);
    }
    const invito: Invito = {
      gettone: randomBytes(24).toString("base64url"),
      sistema,
      centro,
      nome,
      descrizione: ripulito(richiesta.descrizione ?? "", DESCRIZIONE_AMBIENTE_MASSIMA),
      scade: this.#adesso() + DURATA_INVITO_MS,
    };
    this.#inviti.set(invito.gettone, invito);
    return { comando: comandoDiUnaRiga(invito, this.#certificato), sistema, scade: new Date(invito.scade).toISOString() };
  }

  /** L'invito con questo gettone, se c'è e non è scaduto. Si può usare più volte finché vale: lo script si può rilanciare. */
  valido(gettone: unknown): Invito | undefined {
    if (typeof gettone !== "string" || gettone.length === 0) return undefined;
    this.#togliScaduti();
    return this.#inviti.get(gettone);
  }

  #togliScaduti(): void {
    const adesso = this.#adesso();
    for (const [gettone, invito] of this.#inviti) if (invito.scade <= adesso) this.#inviti.delete(gettone);
  }
}

/**
 * Come curl raggiunge il centro cifrato, riconoscendolo dal certificato dei nodi: l'indirizzo con
 * il nome che i nodi chiedono, a chi collegarsi davvero, e l'impronta della chiave da pretendere.
 */
function stradaCifrata(centro: string, certificato: CertificatoPerGliInviti): { base: string; collega: string; chiave: string } {
  const indirizzo = new URL(centro);
  const porta = indirizzo.port === "" ? "80" : indirizzo.port;
  return {
    base: `https://${NOME_TLS_DEI_NODI}:${porta}`,
    collega: `${NOME_TLS_DEI_NODI}:${porta}:${indirizzo.hostname}:${porta}`,
    chiave: `sha256//${certificato.improntaDellaChiave}`,
  };
}

/**
 * Il comando da incollare su quella macchina: scarica lo script e lo esegue. Su Linux, se il centro
 * ha il certificato dei nodi, lo scarica cifrato e solo da chi lo presenta.
 */
export function comandoDiUnaRiga(invito: Pick<Invito, "centro" | "gettone" | "sistema">, certificato?: CertificatoPerGliInviti): string {
  const percorso = `${PERCORSO_PREPARAZIONE}?invito=${invito.gettone}`;
  if (invito.sistema === "windows") return `irm '${invito.centro}${percorso}' | iex`;
  if (certificato === undefined) return `curl -fsSL '${invito.centro}${percorso}' | bash`;
  const strada = stradaCifrata(invito.centro, certificato);
  // -k toglie la verifica della catena, che qui non c'è: a riconoscere il centro è la chiave pretesa.
  return `curl -fsSLk --pinnedpubkey '${strada.chiave}' --connect-to '${strada.collega}' '${strada.base}${percorso}' | bash`;
}

/** Una stringa per bash tra apici singoli. */
function perBash(testo: string): string {
  return `'${testo.replace(/'/g, `'\\''`)}'`;
}

/** Una stringa per PowerShell tra apici singoli: anche gli apici tipografici chiudono la stringa. */
function perPowerShell(testo: string): string {
  return `'${testo.replace(/['‘’‚‛]/g, (apice) => apice + apice)}'`;
}

/** Lo script di preparazione per il sistema dell'invito: le scelte in cima, poi il corpo fisso. */
export async function scriptDiPreparazione(invito: Invito, certificato?: CertificatoPerGliInviti): Promise<string> {
  const pacchetto = `${invito.centro}${PERCORSO_PACCHETTO_NODO}?invito=${invito.gettone}`;
  const impronta = certificato?.impronta ?? "";
  if (invito.sistema === "linux") {
    const corpo = await readFile(join(import.meta.dirname, "prepara-ambiente.sh"), "utf8");
    const strada = certificato === undefined ? undefined : stradaCifrata(invito.centro, certificato);
    return [
      "#!/usr/bin/env bash",
      `SHINKA_CENTRO=${perBash(invito.centro)}`,
      `SHINKA_PACCHETTO=${perBash(strada === undefined ? pacchetto : `${strada.base}${PERCORSO_PACCHETTO_NODO}?invito=${invito.gettone}`)}`,
      `SHINKA_IMPRONTA=${perBash(impronta)}`,
      `SHINKA_CHIAVE_DEL_CENTRO=${perBash(strada?.chiave ?? "")}`,
      `SHINKA_COLLEGA=${perBash(strada?.collega ?? "")}`,
      `SHINKA_NOME=${perBash(invito.nome)}`,
      `SHINKA_DESCRIZIONE=${perBash(invito.descrizione)}`,
      // Tra graffe bash legge tutto lo script prima di eseguirlo: arrivando da `curl | bash`, un
      // comando che legge l'ingresso non si mangia il resto.
      "{",
      corpo.replace(/^#!.*\n/, ""),
      "}",
    ].join("\n");
  }
  const corpo = await readFile(join(import.meta.dirname, "prepara-ambiente.ps1"), "utf8");
  return [
    `$SHINKA_CENTRO = ${perPowerShell(invito.centro)}`,
    `$SHINKA_PACCHETTO = ${perPowerShell(pacchetto)}`,
    `$SHINKA_IMPRONTA = ${perPowerShell(impronta)}`,
    `$SHINKA_NOME = ${perPowerShell(invito.nome)}`,
    `$SHINKA_DESCRIZIONE = ${perPowerShell(invito.descrizione)}`,
    corpo.replace(/^﻿/, ""),
  ].join("\r\n");
}

async function fileSotto(radice: string, relativa: string): Promise<string[]> {
  const voci = await readdir(join(radice, relativa), { withFileTypes: true });
  const trovati: string[] = [];
  for (const voce of voci.sort((a, b) => a.name.localeCompare(b.name))) {
    const percorso = `${relativa}/${voce.name}`;
    if (voce.isDirectory()) trovati.push(...(await fileSotto(radice, percorso)));
    else if (voce.isFile() && !voce.name.endsWith(".test.ts")) trovati.push(percorso);
  }
  return trovati;
}

export interface PacchettoDelNodo {
  nome: string;
  dati: Buffer;
}

/**
 * Il pacchetto con cui nasce un nodo: `guardiano/`, la copia del guardiano che sta fuori dalla
 * versione, e `shinka/`, la versione in funzione al centro senza test né interfaccia, come quella
 * che il centro passa a un nodo che si aggiorna. Le dipendenze le scarica lo script.
 */
export async function pacchettoDelNodo(installata: string): Promise<PacchettoDelNodo> {
  const versione = await versioneDi(installata);
  const voci: VoceArchivio[] = [];
  for (const percorso of await fileSotto(installata, "src/guardiano")) {
    voci.push({ percorso: `guardiano/${percorso.slice("src/guardiano/".length)}`, dati: await readFile(join(installata, percorso)) });
  }
  for (const percorso of [...FILE_IN_CIMA, ...(await fileSotto(installata, "src"))]) {
    let dati: Buffer;
    try {
      dati = await readFile(join(installata, percorso));
    } catch (errore) {
      if (percorso === "package-lock.json" || percorso === "tsconfig.json" || percorso === "versione.json") continue;
      throw errore;
    }
    voci.push({ percorso: `shinka/${percorso}`, dati });
  }
  if (!voci.some((voce) => voce.percorso === "shinka/src/nodo/avvio.ts")) throw new Error("In questa versione manca il nodo.");
  return { nome: `shinka-nodo-${versione === undefined ? "senza-versione" : inBreve(versione)}.tar.gz`, dati: archivioTarGz(voci) };
}
