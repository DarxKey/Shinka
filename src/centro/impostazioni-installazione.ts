/**
 * Le impostazioni dell'installazione che si scelgono dalla pagina Impostazioni (ADR 0030), in un
 * file tra i dati. Le variabili d'ambiente restano i valori di partenza: ciò che è scritto nel
 * file vale sopra di loro.
 */

import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { eMotore, type Motore } from "../protocollo/impostazioni.ts";

export const FILE_IMPOSTAZIONI = "impostazioni.json";

export interface ScelteDellInstallazione {
  /** Il motore delle conversazioni nuove. Se manca vale la variabile SHINKA_MOTORE. */
  motore?: Motore;
  /** Nome e descrizione dell'ambiente del centro. Se mancano valgono le variabili, o il nome della macchina. */
  ambiente?: { nome?: string; descrizione?: string };
  /** Vero se il centro accetta solo i nodi con il collegamento cifrato (ADR 0040). */
  soloNodiCifrati?: true;
  /**
   * L'indirizzo da cui i nodi raggiungono il centro da Internet (ADR 0065), scelto dalla pagina
   * Sicurezza; vuoto se il proprietario non ne vuole nessuno. Se manca vale SHINKA_NODI_DA_FUORI.
   */
  nodiDaFuori?: string;
}

/** Che cosa si può cambiare: `null` torna al valore di partenza. */
export interface ModificaDellInstallazione {
  motore?: Motore | null;
  ambiente?: { nome?: string | null; descrizione?: string | null };
  soloNodiCifrati?: boolean;
  /** Un indirizzo già controllato, vuoto per nessuno, o `null` per tornare alla variabile. */
  nodiDaFuori?: string | null;
}

export const NOME_AMBIENTE_MASSIMO = 60;
export const DESCRIZIONE_AMBIENTE_MASSIMA = 300;

export class ImpostazioniDellInstallazione {
  readonly #file: string;
  #scelte: ScelteDellInstallazione;
  /** Chi deve sapere che una scelta è cambiata. */
  readonly #alCambio: (scelte: ScelteDellInstallazione) => void;

  private constructor(file: string, scelte: ScelteDellInstallazione, alCambio: (scelte: ScelteDellInstallazione) => void) {
    this.#file = file;
    this.#scelte = scelte;
    this.#alCambio = alCambio;
  }

  /** Legge il file, se c'è; un file rovinato vale come vuoto. Chi ascolta riceve subito le scelte. */
  static apri(dati: string, alCambio: (scelte: ScelteDellInstallazione) => void = () => {}): ImpostazioniDellInstallazione {
    const file = join(dati, FILE_IMPOSTAZIONI);
    let scelte: ScelteDellInstallazione = {};
    if (existsSync(file)) {
      try {
        scelte = leggiScelte(JSON.parse(readFileSync(file, "utf8")));
      } catch {
        scelte = {};
      }
    }
    alCambio(scelte);
    return new ImpostazioniDellInstallazione(file, scelte, alCambio);
  }

  get scelte(): ScelteDellInstallazione {
    return structuredClone(this.#scelte);
  }

  /** Cambia le voci nominate; `null` torna al valore della variabile. */
  async cambia(modifica: ModificaDellInstallazione): Promise<ScelteDellInstallazione> {
    const prossime: ScelteDellInstallazione = { ...this.#scelte };
    if (modifica.motore === null) delete prossime.motore;
    else if (modifica.motore !== undefined) prossime.motore = modifica.motore;
    if (modifica.soloNodiCifrati === true) prossime.soloNodiCifrati = true;
    else if (modifica.soloNodiCifrati === false) delete prossime.soloNodiCifrati;
    if (modifica.nodiDaFuori === null) delete prossime.nodiDaFuori;
    else if (modifica.nodiDaFuori !== undefined) prossime.nodiDaFuori = modifica.nodiDaFuori;
    if (modifica.ambiente !== undefined) {
      const ambiente = { ...prossime.ambiente };
      for (const voce of ["nome", "descrizione"] as const) {
        const valore = modifica.ambiente[voce];
        if (valore === undefined) continue;
        if (valore === null || valore.trim() === "") delete ambiente[voce];
        else ambiente[voce] = valore.trim();
      }
      if (Object.keys(ambiente).length === 0) delete prossime.ambiente;
      else prossime.ambiente = ambiente;
    }
    await mkdir(dirname(this.#file), { recursive: true });
    const provvisorio = `${this.#file}.${process.pid}.tmp`;
    await writeFile(provvisorio, `${JSON.stringify(prossime, null, 2)}\n`, { mode: 0o600 });
    await rename(provvisorio, this.#file);
    this.#scelte = prossime;
    this.#alCambio(this.scelte);
    return this.scelte;
  }
}

function leggiScelte(valore: unknown): ScelteDellInstallazione {
  if (typeof valore !== "object" || valore === null) return {};
  const { motore, ambiente, soloNodiCifrati, nodiDaFuori } = valore as Record<string, unknown>;
  const scelte: ScelteDellInstallazione = eMotore(motore) ? { motore } : {};
  if (soloNodiCifrati === true) scelte.soloNodiCifrati = true;
  if (typeof nodiDaFuori === "string" && nodiDaFuori.length <= 300) scelte.nodiDaFuori = nodiDaFuori;
  if (typeof ambiente === "object" && ambiente !== null) {
    const { nome, descrizione } = ambiente as Record<string, unknown>;
    const letto = {
      ...(typeof nome === "string" && nome.trim() !== "" ? { nome: nome.trim().slice(0, NOME_AMBIENTE_MASSIMO) } : {}),
      ...(typeof descrizione === "string" && descrizione.trim() !== "" ? { descrizione: descrizione.trim().slice(0, DESCRIZIONE_AMBIENTE_MASSIMA) } : {}),
    };
    if (Object.keys(letto).length > 0) scelte.ambiente = letto;
  }
  return scelte;
}
