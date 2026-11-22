/**
 * Ciò che il centro ricorda della Home tra un avvio e l'altro: come è impostata.
 * Da dove riprende lo ricorda ogni argomento per sé; qui resta solo ciò che è stato
 * salvato prima che gli argomenti esistessero, per ereditarlo.
 */

import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import {
  applicaModifica,
  leggiImpostazioni,
  type ImpostazioniConversazione,
  type ModificaImpostazioni,
} from "../protocollo/impostazioni.ts";

export class StatoHome {
  readonly #file: string;
  #idSessione: string | undefined;
  #impostazioni: ImpostazioniConversazione;

  private constructor(file: string, idSessione: string | undefined, impostazioni: ImpostazioniConversazione) {
    this.#file = file;
    this.#idSessione = idSessione;
    this.#impostazioni = impostazioni;
  }

  /** Legge il file, se c'è. Le impostazioni mai scelte dal proprietario sono quelle predefinite. */
  static apri(file: string, predefinite: ImpostazioniConversazione): StatoHome {
    let letto: { idSessione?: unknown; impostazioni?: unknown; versione?: unknown } = {};
    try {
      letto = JSON.parse(readFileSync(file, "utf8")) as typeof letto;
    } catch {
      // Primo avvio, o file illeggibile: si riparte dai valori predefiniti.
    }
    const idSessione = typeof letto.idSessione === "string" && letto.idSessione !== "" ? letto.idSessione : undefined;
    let impostazioni = leggiImpostazioni(letto.impostazioni) ?? predefinite;
    // Prima degli argomenti la Home nasceva con il modello più piccolo, e quella scelta veniva
    // salvata anche se il proprietario non l'aveva mai fatta: ora vale il modello di partenza nuovo.
    if (letto.versione === undefined && impostazioni.modello === "haiku") {
      const { modello: _vecchio, ...resto } = impostazioni;
      impostazioni = { ...resto, ...(predefinite.modello === undefined ? {} : { modello: predefinite.modello }) };
    }
    return new StatoHome(file, idSessione, impostazioni);
  }

  /** La conversazione della Home di prima degli argomenti, se c'era: la eredita il primo argomento. */
  get idSessioneEreditata(): string | undefined {
    return this.#idSessione;
  }

  get impostazioni(): ImpostazioniConversazione {
    return this.#impostazioni;
  }

  async cambia(modifica: ModificaImpostazioni): Promise<ImpostazioniConversazione> {
    this.#impostazioni = applicaModifica(this.#impostazioni, modifica);
    await this.#salva();
    return this.#impostazioni;
  }

  async #salva(): Promise<void> {
    const dati = { versione: 2, impostazioni: this.#impostazioni };
    await writeFile(this.#file, JSON.stringify(dati, null, 2));
  }
}
