/**
 * Il primo avvio di un'installazione nuova (ADR 0032): finché la password del proprietario non
 * c'è, il centro tiene un codice in un file tra i dati e lo scrive nel registro. La pagina lo
 * chiede insieme alla password nuova: così la sceglie solo chi ha in mano il server, non il primo
 * che apre l'indirizzo.
 */

import { randomInt, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Accesso, ChiEntra, EsitoEntrata } from "./accesso.ts";

export const FILE_PRIMO_AVVIO = "primo-avvio.txt";

/** Senza lettere e cifre che si confondono. */
const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const TENTATIVI_MASSIMI = 5;
const FINESTRA_TENTATIVI_MS = 5 * 60 * 1000;

function codiceNuovo(): string {
  const lettere = Array.from({ length: 8 }, () => ALFABETO[randomInt(ALFABETO.length)]);
  return `${lettere.slice(0, 4).join("")}-${lettere.slice(4).join("")}`;
}

/** Come lo scrive il proprietario: maiuscole o minuscole, con o senza trattino e spazi. */
function normale(codice: string): string {
  return codice.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export type EsitoPrimoAvvio = EsitoEntrata | { esito: "non-serve" } | { esito: "password-corta" };

export class PrimoAvvio {
  readonly #file: string;
  readonly #accesso: Accesso;
  #tentativiFalliti: number[] = [];

  private constructor(file: string, accesso: Accesso) {
    this.#file = file;
    this.#accesso = accesso;
  }

  /**
   * Se la password manca prepara il codice, o tiene quello di prima, e lo restituisce perché si
   * scriva nel registro; se la password c'è, toglie il file rimasto.
   */
  static apri(dati: string, accesso: Accesso): { primoAvvio: PrimoAvvio; codice?: string } {
    const primoAvvio = new PrimoAvvio(join(dati, FILE_PRIMO_AVVIO), accesso);
    if (accesso.configurato) {
      rmSync(primoAvvio.#file, { force: true });
      return { primoAvvio };
    }
    let codice = existsSync(primoAvvio.#file) ? readFileSync(primoAvvio.#file, "utf8").trim() : "";
    if (normale(codice).length !== 8) {
      codice = codiceNuovo();
      writeFileSync(primoAvvio.#file, `${codice}\n`, { mode: 0o600 });
    }
    return { primoAvvio, codice };
  }

  /** Vero se la pagina può guidare il primo avvio: la password manca e il codice c'è. */
  get attivo(): boolean {
    return !this.#accesso.configurato && existsSync(this.#file);
  }

  /** Imposta la prima password se il codice è giusto, e apre la sessione di chi l'ha scelta. */
  async imposta(codice: string, password: string, ora: number = Date.now(), chi?: ChiEntra): Promise<EsitoPrimoAvvio> {
    if (!this.attivo) return { esito: "non-serve" };
    this.#tentativiFalliti = this.#tentativiFalliti.filter((momento) => ora - momento < FINESTRA_TENTATIVI_MS);
    const piuVecchio = this.#tentativiFalliti[0];
    if (this.#tentativiFalliti.length >= TENTATIVI_MASSIMI && piuVecchio !== undefined) {
      return { esito: "troppi-tentativi", riprovaTraMs: piuVecchio + FINESTRA_TENTATIVI_MS - ora };
    }
    const atteso = Buffer.from(normale(readFileSync(this.#file, "utf8")));
    const dato = Buffer.from(normale(codice));
    if (atteso.length !== dato.length || !timingSafeEqual(atteso, dato)) {
      this.#tentativiFalliti.push(ora);
      return { esito: "rifiutato" };
    }
    try {
      await this.#accesso.impostaPassword(password);
    } catch {
      return { esito: "password-corta" };
    }
    rmSync(this.#file, { force: true });
    return this.#accesso.entra(password, ora, chi);
  }
}
