/**
 * Quali modelli ha un motore in questo ambiente, senza aprire una conversazione: per il menu del
 * modello, che mostra quelli di Claude e di Codex insieme (ADR 0030). Un motore senza accesso
 * (nessun abbonamento collegato) non ha modelli: nel menu non compare.
 *
 * Le sonde non spendono nulla: avviano il programma del motore, gli chiedono l'elenco e lo chiudono.
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import { tmpdir } from "node:os";
import { ambientePerHarness, fonteConfigurata } from "../harness/autenticazione.ts";
import type { ModelloDisponibile, Motore } from "../protocollo/impostazioni.ts";
import { ClienteAppServer } from "./codex/cliente.ts";
import { modelliDiCodex } from "./codex/conversazione-codex.ts";

/** I modelli di un motore; undefined se in questo ambiente il motore non ha un accesso. */
export type SondaDeiModelli = (motore: Motore) => Promise<ModelloDisponibile[] | undefined>;

export const sondaVera: SondaDeiModelli = (motore) => (motore === "codex" ? sondaCodex() : sondaClaude());

async function sondaClaude(): Promise<ModelloDisponibile[] | undefined> {
  let lascia!: () => void;
  const fermo = new Promise<void>((risolvi) => (lascia = risolvi));
  // Un ingresso che non manda nulla: il processo parte, risponde alle domande di controllo e basta.
  async function* nulla(): AsyncGenerator<never> {
    await fermo;
  }
  const sessione = query({
    prompt: nulla(),
    options: { cwd: tmpdir(), env: ambientePerHarness(fonteConfigurata()), settingSources: [] },
  });
  try {
    const conto = await sessione.accountInfo();
    const collegato =
      conto.subscriptionType !== undefined ||
      conto.email !== undefined ||
      (conto.tokenSource !== undefined && conto.tokenSource !== "none") ||
      (conto.apiKeySource !== undefined && conto.apiKeySource !== "none");
    if (!collegato) return undefined;
    return (await sessione.supportedModels()).map((modello) => ({
      valore: modello.value,
      nome: modello.displayName,
      descrizione: modello.description,
      ...(modello.supportedEffortLevels === undefined ? {} : { impegni: modello.supportedEffortLevels }),
    }));
  } finally {
    lascia();
    sessione.close();
  }
}

async function sondaCodex(): Promise<ModelloDisponibile[] | undefined> {
  const cliente = await ClienteAppServer.avvia({
    cwd: tmpdir(),
    alNotificato: () => {},
    allaRichiesta: async () => ({ errore: "Shinka sta solo leggendo i modelli." }),
    allaFine: () => {},
  });
  try {
    const conto = (await cliente.richiedi("account/read", {}, 20_000)) as { account?: unknown; requiresOpenaiAuth?: unknown };
    if ((conto.account === null || conto.account === undefined) && conto.requiresOpenaiAuth !== false) return undefined;
    return modelliDiCodex(await cliente.richiedi("model/list", {}, 20_000));
  } finally {
    cliente.chiudi();
  }
}

/**
 * Ciò che questo processo sa dei modelli di ciascun motore: quelli che una conversazione ha
 * riferito, o quelli che una sonda ha letto. Ogni motore si sonda una volta sola.
 */
export class ModelliDeiMotori {
  readonly #sonda: SondaDeiModelli;
  readonly #noti = new Map<Motore, ModelloDisponibile[] | undefined>();
  readonly #inCorso = new Map<Motore, Promise<ModelloDisponibile[] | undefined>>();

  constructor(sonda: SondaDeiModelli = sondaVera) {
    this.#sonda = sonda;
  }

  /** Una conversazione del motore ha detto i suoi modelli: sono i più freschi. */
  ricorda(motore: Motore, modelli: ModelloDisponibile[]): void {
    this.#noti.set(motore, modelli);
  }

  /** I modelli già noti del motore: undefined se non si sanno ancora o se il motore non ha accesso. */
  noti(motore: Motore): ModelloDisponibile[] | undefined {
    return this.#noti.get(motore);
  }

  /** I modelli del motore, sondandolo la prima volta. Se la sonda fallisce, il motore non ha modelli. */
  leggi(motore: Motore): Promise<ModelloDisponibile[] | undefined> {
    if (this.#noti.has(motore)) return Promise.resolve(this.#noti.get(motore));
    let inCorso = this.#inCorso.get(motore);
    if (inCorso === undefined) {
      inCorso = this.#sonda(motore)
        .catch(() => undefined)
        .then((modelli) => {
          if (!this.#noti.has(motore)) this.#noti.set(motore, modelli);
          this.#inCorso.delete(motore);
          return this.#noti.get(motore);
        });
      this.#inCorso.set(motore, inCorso);
    }
    return inCorso;
  }

  /** Gli accessi sono cambiati: alla prossima occasione i motori si sondano di nuovo. */
  dimentica(): void {
    this.#noti.clear();
  }
}

/** Quelli di questo processo. */
export const modelliDeiMotori = new ModelliDeiMotori();
