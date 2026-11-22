/**
 * Gli stili di risposta che il proprietario ha aggiunto a quelli di Shinka. Ciascuno nasce da un
 * nome e da una descrizione: le istruzioni le scrive Claude, una volta sola, e restano qui, valide
 * in ogni conversazione e in ogni ambiente.
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname } from "node:path";
import { ambientePerHarness, fonteConfigurata, verificaFonte } from "../harness/autenticazione.ts";
import {
  DESCRIZIONE_MASSIMA,
  ISTRUZIONI_MASSIME,
  NOME_MASSIMO,
  STILI_DI_SHINKA,
  type StileDiRisposta,
} from "../protocollo/stili.ts";

/** Scrive le istruzioni di uno stile a partire da come il proprietario lo descrive. */
export type ScriviStile = (nome: string, descrizione: string) => Promise<string>;

export class RegistroStili {
  readonly #file: string;
  readonly #scrivi: ScriviStile;
  readonly #propri: StileDiRisposta[];

  private constructor(file: string, scrivi: ScriviStile, propri: StileDiRisposta[]) {
    this.#file = file;
    this.#scrivi = scrivi;
    this.#propri = propri;
  }

  static async apri(file: string, scrivi: ScriviStile = scriviConClaude): Promise<RegistroStili> {
    await mkdir(dirname(file), { recursive: true });
    return new RegistroStili(file, scrivi, leggi(file));
  }

  /** Quelli di Shinka, poi quelli del proprietario nell'ordine in cui sono nati. */
  elenco(): StileDiRisposta[] {
    return [...STILI_DI_SHINKA, ...this.#propri];
  }

  trova(id: string): StileDiRisposta | undefined {
    return this.elenco().find((stile) => stile.id === id);
  }

  /** Fa scrivere a Claude le istruzioni di uno stile nuovo e lo aggiunge. */
  async crea(nome: string, descrizione: string): Promise<StileDiRisposta> {
    const pulito = nome.replace(/\s+/g, " ").trim();
    const descritto = descrizione.trim();
    if (pulito === "" || pulito.length > NOME_MASSIMO) throw new StileNonValido(`Il nome va da 1 a ${NOME_MASSIMO} caratteri.`);
    if (descritto === "" || descritto.length > DESCRIZIONE_MASSIMA) throw new StileNonValido(`La descrizione va da 1 a ${DESCRIZIONE_MASSIMA} caratteri.`);
    if (this.elenco().some((stile) => stile.nome.toLowerCase() === pulito.toLowerCase())) {
      throw new StileNonValido(`C'è già uno stile che si chiama «${pulito}».`);
    }
    const istruzioni = (await this.#scrivi(pulito, descritto)).trim().slice(0, ISTRUZIONI_MASSIME);
    if (istruzioni === "") throw new Error("Claude non ha scritto le istruzioni dello stile.");
    const stile: StileDiRisposta = {
      id: `proprio-${randomBytes(4).toString("hex")}`,
      nome: pulito,
      descrizione: riga(descritto),
      istruzioni,
    };
    this.#propri.push(stile);
    await this.#salva();
    return stile;
  }

  /** Toglie uno stile del proprietario; quelli di Shinka restano. Vero se c'era. */
  async rimuovi(id: string): Promise<boolean> {
    const posizione = this.#propri.findIndex((stile) => stile.id === id);
    if (posizione < 0) return false;
    this.#propri.splice(posizione, 1);
    await this.#salva();
    return true;
  }

  async #salva(): Promise<void> {
    const provvisorio = `${this.#file}.tmp`;
    await writeFile(provvisorio, JSON.stringify({ stili: this.#propri }, null, 2));
    await rename(provvisorio, this.#file);
  }
}

/** Uno stile chiesto in un modo che non va: il messaggio è per il proprietario. */
export class StileNonValido extends Error {}

/** La descrizione in una riga sola, per l'elenco. */
function riga(testo: string): string {
  const unita = testo.replace(/\s+/g, " ").trim();
  return unita.length <= 140 ? unita : `${unita.slice(0, 137)}…`;
}

function leggi(file: string): StileDiRisposta[] {
  let letto: unknown;
  try {
    letto = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return [];
  }
  const stili = (letto as { stili?: unknown }).stili;
  if (!Array.isArray(stili)) return [];
  return stili.flatMap((voce: unknown) => {
    if (typeof voce !== "object" || voce === null) return [];
    const { id, nome, descrizione, istruzioni } = voce as Record<string, unknown>;
    if (typeof id !== "string" || typeof nome !== "string" || typeof istruzioni !== "string") return [];
    return [{ id, nome, descrizione: typeof descrizione === "string" ? descrizione : "", istruzioni }];
  });
}

const RICHIESTA = (nome: string, descrizione: string): string =>
  `Il proprietario vuole uno stile di risposta nuovo per le sue conversazioni con te. Lo ha chiamato «${nome}» e lo descrive così:\n\n` +
  `${descrizione}\n\n` +
  "Scrivi le istruzioni che verranno aggiunte alle tue istruzioni di sistema quando sceglie questo stile: in italiano, " +
  "rivolte a te in seconda persona, da tre a otto frasi concrete su come scrivere (lunghezza, tono, struttura, che cosa " +
  "mettere e che cosa evitare). Rispetta ciò che il proprietario chiede, senza aggiungere regole sue che non ha detto. " +
  "Scrivi solo il testo delle istruzioni: niente titolo, niente premesse, niente virgolette intorno.";

/** Chiede a Claude, con l'abbonamento del proprietario, le istruzioni di uno stile. */
export const scriviConClaude: ScriviStile = async (nome, descrizione) => {
  const fonte = fonteConfigurata();
  let testo: string | undefined;
  let errore: string | undefined;
  for await (const messaggio of query({
    prompt: RICHIESTA(nome, descrizione),
    options: {
      cwd: tmpdir(),
      env: ambientePerHarness(fonte),
      model: "sonnet",
      maxTurns: 1,
      tools: [],
      settingSources: [],
      strictMcpConfig: true,
      persistSession: false,
    },
  })) {
    if (messaggio.type === "system" && messaggio.subtype === "init") verificaFonte(fonte, messaggio.apiKeySource);
    if (messaggio.type !== "result") continue;
    if (messaggio.subtype === "success" && !messaggio.is_error) testo = messaggio.result;
    else errore = messaggio.subtype === "success" ? messaggio.result : messaggio.subtype;
  }
  if (testo === undefined) throw new Error(`Claude non ha scritto le istruzioni dello stile${errore === undefined ? "" : `: ${errore}`}.`);
  return testo;
};
