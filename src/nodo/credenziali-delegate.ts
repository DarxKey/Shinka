/**
 * Le credenziali per SSH che il proprietario dà all'ambiente di questo nodo (ADR 0062). Arrivano dal
 * gateway in un sigillo che solo la chiave di questo nodo apre, e restano soltanto in memoria: si
 * dimenticano quando il vault si chiude, quando il centro si scollega e quando il nodo si spegne.
 * Il nodo le usa per i comandi sugli host che il gateway non raggiunge, con le stesse regole del
 * gateway: il divieto fisso, gli host scritti nella credenziale, l'impronta dell'host.
 */

import { readFile, writeFile } from "node:fs/promises";
import type { KeyObject } from "node:crypto";
import { divietoFisso } from "../gateway/divieti.ts";
import { ErroreSsh, eseguiSuHost } from "../gateway/ssh.ts";
import { daNascondere, nascondi } from "../gateway/uso.ts";
import type { CredenzialePerUso } from "../gateway/vault.ts";
import type { EsitoSuHost } from "../protocollo/nodi.ts";
import { apriSigillo, leggiChiavePrivata, nuovaCoppia, type Sigillo } from "../protocollo/sigillo.ts";
import { COMANDO_SU_HOST_MASSIMO, hostInChiaro, leggiHost, SECONDI_COMANDO_SU_HOST_MASSIMI, type CredenzialeDelegata } from "../protocollo/vault.ts";

/** La coppia di chiavi del nodo per il vault: creata al primo avvio, la privata non lascia la macchina. */
export async function chiaveDelNodo(file: string): Promise<{ pubblica: string; privata: KeyObject }> {
  try {
    const letta = JSON.parse(await readFile(file, "utf8")) as { pubblica?: unknown; privata?: unknown };
    if (typeof letta.pubblica === "string" && typeof letta.privata === "string") return { pubblica: letta.pubblica, privata: leggiChiavePrivata(letta.privata) };
  } catch {
    // Non c'è ancora, o non si legge: se ne fa una nuova, e il proprietario dovrà ridare le credenziali.
  }
  const coppia = nuovaCoppia();
  await writeFile(file, `${JSON.stringify(coppia, null, 2)}\n`, { mode: 0o600 });
  return { pubblica: coppia.pubblica, privata: leggiChiavePrivata(coppia.privata) };
}

/** Le credenziali che un sigillo porta, se sono fatte bene; le voci malformate si lasciano fuori. */
function leggiDelegate(valore: unknown): CredenzialeDelegata[] {
  if (!Array.isArray(valore)) return [];
  return valore.flatMap((voce: unknown): CredenzialeDelegata[] => {
    if (typeof voce !== "object" || voce === null) return [];
    const { nome, tipo, utente, host, segreto, fraseDellaChiave, impronte } = voce as Record<string, unknown>;
    if (typeof nome !== "string" || (tipo !== "password" && tipo !== "chiave") || typeof utente !== "string" || typeof segreto !== "string" || !Array.isArray(host)) return [];
    return [
      {
        nome,
        tipo,
        utente,
        host: host.filter((uno): uno is string => typeof uno === "string"),
        segreto,
        ...(typeof fraseDellaChiave === "string" ? { fraseDellaChiave } : {}),
        impronte: typeof impronte === "object" && impronte !== null ? Object.fromEntries(Object.entries(impronte).filter((coppia): coppia is [string, string] => typeof coppia[1] === "string")) : {},
      },
    ];
  });
}

export interface OpzioniCredenzialiDelegate {
  privata: KeyObject;
  /** Come si esegue il comando sull'host. Nei test se ne mette uno finto. */
  esegui?: typeof eseguiSuHost;
}

export class CredenzialiDelegate {
  readonly #o: OpzioniCredenzialiDelegate;
  #credenziali: CredenzialeDelegata[] = [];

  constructor(opzioni: OpzioniCredenzialiDelegate) {
    this.#o = opzioni;
  }

  /** Il gateway manda le credenziali di adesso: prendono il posto di quelle di prima. Falso se il sigillo non si apre. */
  ricevi(sigillo: Sigillo): boolean {
    try {
      this.#credenziali = leggiDelegate(apriSigillo(sigillo, this.#o.privata));
      return true;
    } catch {
      this.#credenziali = [];
      return false;
    }
  }

  dimentica(): void {
    this.#credenziali = [];
  }

  /** I nomi delle credenziali che il nodo ha adesso. */
  nomi(): string[] {
    return this.#credenziali.map((una) => una.nome);
  }

  /** Esegue un comando sull'host con una credenziale data a questo ambiente. Non lancia: l'esito dice com'è andata. */
  async esegui(nome: string, host: string, comando: string, secondi: number): Promise<EsitoSuHost> {
    if (comando.trim() === "" || comando.length > COMANDO_SU_HOST_MASSIMO) return { esito: "rifiutato", motivo: "Il comando manca, oppure è troppo lungo." };
    const vietato = divietoFisso(comando);
    if (vietato !== undefined) return { esito: "rifiutato", motivo: `Divieto fisso: ${vietato} non si fa con una credenziale del vault.` };
    const credenziale = this.#credenziali.find((una) => una.nome === nome.trim().toLowerCase());
    if (credenziale === undefined) {
      return { esito: "rifiutato", motivo: `Questo ambiente non ha la credenziale "${nome}": il vault è chiuso, oppure il proprietario non gliel'ha data.` };
    }
    const chiesto = leggiHost(host);
    const scritto = chiesto === undefined ? undefined : hostInChiaro(chiesto);
    if (chiesto === undefined || scritto === undefined || !credenziale.host.includes(scritto)) {
      return { esito: "rifiutato", motivo: `La credenziale "${credenziale.nome}" non è prevista per l'host ${host}.` };
    }
    const impronta = credenziale.impronte[scritto];
    const perUso: CredenzialePerUso = {
      nome: credenziale.nome,
      tipo: credenziale.tipo,
      utente: credenziale.utente,
      host: chiesto.nome,
      porta: chiesto.porta,
      segreto: credenziale.segreto,
      ...(credenziale.fraseDellaChiave === undefined ? {} : { fraseDellaChiave: credenziale.fraseDellaChiave }),
      ...(impronta === undefined ? {} : { impronta }),
    };
    const valori = daNascondere(perUso);
    const durata = Math.min(Math.max(secondi, 1), SECONDI_COMANDO_SU_HOST_MASSIMI);
    try {
      const eseguito = await (this.#o.esegui ?? eseguiSuHost)(perUso, comando, durata * 1000);
      // Un host visto per la prima volta: la sua impronta vale da qui, anche prima che il gateway la ricordi.
      credenziale.impronte[scritto] ??= eseguito.impronta;
      return {
        esito: "eseguito",
        codice: eseguito.codice,
        uscita: nascondi(eseguito.uscita, valori),
        errori: nascondi(eseguito.errori, valori),
        scaduto: eseguito.scaduto,
        durataMs: eseguito.durataMs,
        impronta: eseguito.impronta,
      };
    } catch (errore) {
      const motivo = errore instanceof ErroreSsh ? errore.message : `Il comando non è stato eseguito: ${errore instanceof Error ? errore.message : String(errore)}`;
      return { esito: errore instanceof ErroreSsh && errore.causaSsh === "impronta" ? "rifiutato" : "fallito", motivo: nascondi(motivo, valori) };
    }
  }
}
