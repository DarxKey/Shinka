/**
 * Il registro del gateway: una riga per ogni uso di una credenziale, riuscito, fallito o
 * rifiutato. Lo scrive il gateway con ciò che ha fatto davvero, non con ciò che una
 * conversazione dichiara. È un file a sola aggiunta, e non contiene mai il valore di una credenziale.
 */

import { existsSync, readFileSync } from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { VoceRegistro } from "../protocollo/vault.ts";

/** Quante righe recenti il gateway tiene pronte per mostrarle. */
const RIGHE_PRONTE = 500;

export class Registro {
  readonly #file: string;
  readonly #recenti: VoceRegistro[];
  #scritture: Promise<void> = Promise.resolve();

  private constructor(file: string, recenti: VoceRegistro[]) {
    this.#file = file;
    this.#recenti = recenti;
  }

  static async apri(file: string): Promise<Registro> {
    await mkdir(dirname(file), { recursive: true });
    const recenti: VoceRegistro[] = [];
    if (existsSync(file)) {
      for (const riga of readFileSync(file, "utf8").split("\n").slice(-RIGHE_PRONTE - 1)) {
        if (riga.trim() === "") continue;
        try {
          recenti.push(JSON.parse(riga) as VoceRegistro);
        } catch {
          // Una riga rovinata, per esempio da uno spegnimento a metà scrittura, si salta.
        }
      }
    }
    return new Registro(file, recenti);
  }

  /** Aggiunge una riga. Aspetta che sia sul disco: ciò che è stato eseguito deve risultare. */
  annota(voce: VoceRegistro): Promise<void> {
    this.#recenti.push(voce);
    if (this.#recenti.length > RIGHE_PRONTE) this.#recenti.splice(0, this.#recenti.length - RIGHE_PRONTE);
    const scrittura = this.#scritture.then(() => appendFile(this.#file, `${JSON.stringify(voce)}\n`, { mode: 0o600 }));
    this.#scritture = scrittura.catch(() => {});
    return scrittura;
  }

  /** Le ultime righe, dalla più recente. */
  ultime(quante: number): VoceRegistro[] {
    return this.#recenti.slice(-Math.max(0, quante)).reverse();
  }
}
