/**
 * Le domande che Claude pone al proprietario con lo strumento dell'harness (AskUserQuestion),
 * mostrate da Shinka con la sua scheda. Le risposte arrivano dalla scheda, dall'interfaccia o da
 * Telegram, oppure con un messaggio in chat; un controllo messo prima dello strumento le dà
 * all'harness, così vale in ogni modo dei permessi.
 */

import type { Options } from "@anthropic-ai/claude-agent-sdk";
import type { Domanda, EventoConversazione, RispostaAlleDomande } from "../protocollo/eventi.ts";

/** Il nome che l'harness dà al suo strumento per porre domande al proprietario. */
export const STRUMENTO_DELLE_DOMANDE = "AskUserQuestion";

/** Come il proprietario ha risposto alle domande di Claude, per come lo si dice all'harness. */
export type RisposteRaccolte =
  | { esito: "risposte"; risposte: string[] }
  | { esito: "in-chat"; testo: string }
  | { esito: "saltate" | "annullate" };

/** Mostra al proprietario le domande di Claude e aspetta le sue risposte. */
export type ChiediRisposte = (domande: Domanda[], idDomande: string, segnale: AbortSignal) => Promise<RisposteRaccolte>;

/** Le domande di una conversazione che aspettano il proprietario. */
export class DomandeInSospeso {
  readonly #alEvento: (evento: EventoConversazione) => void;
  readonly #inAttesa = new Map<string, (raccolte: RisposteRaccolte) => void>();

  constructor(alEvento: (evento: EventoConversazione) => void) {
    this.#alEvento = alEvento;
  }

  get inAttesa(): boolean {
    return this.#inAttesa.size > 0;
  }

  /**
   * Mostra al proprietario le domande e aspetta che risponda. Finiscono annullate se l'harness
   * smette di aspettarle, per esempio perché il turno è stato interrotto.
   */
  readonly poni: ChiediRisposte = (domande, idDomande, segnale) =>
    new Promise<RisposteRaccolte>((risolvi) => {
      this.#inAttesa.set(idDomande, (raccolte) => {
        if (!this.#inAttesa.delete(idDomande)) return;
        this.#alEvento({
          tipo: "domande-chiuse",
          idDomande,
          esito: raccolte.esito,
          ...(raccolte.esito === "risposte" ? { risposte: raccolte.risposte } : {}),
        });
        risolvi(raccolte);
      });
      this.#alEvento({ tipo: "domande-poste", idDomande, domande });
      const annulla = (): void => this.#inAttesa.get(idDomande)?.({ esito: "annullate" });
      if (segnale.aborted) annulla();
      else segnale.addEventListener("abort", annulla, { once: true });
    });

  /** Risponde dalla scheda. Restituisce false se quelle domande non aspettano più. */
  rispondi(idDomande: string, risposta: RispostaAlleDomande): boolean {
    const chiudi = this.#inAttesa.get(idDomande);
    if (chiudi === undefined) return false;
    chiudi(risposta.tipo === "risposte" ? { esito: "risposte", risposte: risposta.risposte } : { esito: "saltate" });
    return true;
  }

  /** Un messaggio scritto in chat mentre le domande aspettano: vale come risposta a tutte. */
  rispondiInChat(testo: string): void {
    for (const chiudi of [...this.#inAttesa.values()]) chiudi({ esito: "in-chat", testo });
  }

  /** La conversazione si è chiusa: nessuno aspetta più le risposte. */
  annullaTutte(): void {
    for (const chiudi of [...this.#inAttesa.values()]) chiudi({ esito: "annullate" });
  }
}

/** Le domande dell'harness nella forma di Shinka; undefined se l'ingresso non le contiene come ci si aspetta. */
export function domandeDa(ingresso: unknown): Domanda[] | undefined {
  const domande = (ingresso as { questions?: unknown } | null)?.questions;
  if (!Array.isArray(domande) || domande.length === 0) return undefined;
  const lette: Domanda[] = [];
  for (const voce of domande as unknown[]) {
    const { question, header, options, multiSelect } = (voce ?? {}) as Record<string, unknown>;
    if (typeof question !== "string" || !Array.isArray(options)) return undefined;
    const opzioni = (options as unknown[]).flatMap((opzione) => {
      const { label, description } = (opzione ?? {}) as Record<string, unknown>;
      if (typeof label !== "string") return [];
      return [{ etichetta: label, ...(typeof description === "string" && description !== "" ? { descrizione: description } : {}) }];
    });
    lette.push({ domanda: question, intestazione: typeof header === "string" ? header : "", opzioni, piuScelte: multiSelect === true });
  }
  return lette;
}

/**
 * Ciò che il controllo delle domande risponde all'harness. Le risposte vanno nell'ingresso dello
 * strumento, una per domanda; un messaggio in chat diventa la risposta a tutte. Senza risposte lo
 * strumento non parte, e il motivo dice a Claude come andare avanti. L'harness ignora invece il
 * campo "response" dell'ingresso, se lo dà un controllo: lo dice la prova `src/prove/domande-e-harness.ts`.
 */
export function esitoDelleDomande(ingresso: unknown, raccolte: RisposteRaccolte) {
  const originale = (ingresso ?? {}) as Record<string, unknown>;
  const domande = domandeDa(ingresso) ?? [];
  const consenti = (answers: Record<string, string>) => ({
    hookSpecificOutput: {
      hookEventName: "PreToolUse" as const,
      permissionDecision: "allow" as const,
      permissionDecisionReason: "Il proprietario ha risposto.",
      updatedInput: { ...originale, answers },
    },
  });
  const nega = (permissionDecisionReason: string) => ({
    hookSpecificOutput: { hookEventName: "PreToolUse" as const, permissionDecision: "deny" as const, permissionDecisionReason },
  });
  switch (raccolte.esito) {
    case "risposte":
      return consenti(Object.fromEntries(domande.map((voce, indice) => [voce.domanda, raccolte.risposte[indice] ?? ""])));
    case "in-chat": {
      // Su Telegram le domande sono numerate e le risposte hanno una lettera: la risposta può usarle.
      const testo =
        `Il proprietario ha risposto ${domande.length > 1 ? "a tutte le domande " : ""}con un messaggio: «${raccolte.testo}». ` +
        "Se indica le risposte con numeri e lettere (per esempio 1a, 2b), sono la domanda e la risposta nell'ordine in cui le hai proposte.";
      return consenti(Object.fromEntries(domande.map((voce) => [voce.domanda, testo])));
    }
    case "saltate":
      return nega("Il proprietario ha preferito non rispondere a queste domande: vai avanti con scelte ragionevoli e diglielo, oppure chiedigli in chat ciò che serve davvero.");
    case "annullate":
      return nega("Le domande sono state annullate prima che il proprietario rispondesse.");
  }
}

/**
 * Il controllo che precede lo strumento delle domande: le mostra al proprietario e dà all'harness
 * le sue risposte. Vale in tutti e quattro i modi dei permessi, perché rispondere è sempre del
 * proprietario. Senza un modo di chiedere, le domande non partono.
 */
export function controlloDelleDomande(
  chiediRisposte: ChiediRisposte | undefined,
  /** Quanto l'harness aspetta le risposte, in secondi: poi le domande non partono. */
  attesaS: number,
): NonNullable<NonNullable<Options["hooks"]>["PreToolUse"]>[number] {
  return {
    matcher: STRUMENTO_DELLE_DOMANDE,
    onFailure: "block",
    timeout: attesaS,
    hooks: [
      async (ingresso, idAzione, { signal }) => {
        if (ingresso.hook_event_name !== "PreToolUse") return {};
        const domande = domandeDa(ingresso.tool_input);
        if (chiediRisposte === undefined || domande === undefined) return esitoDelleDomande(ingresso.tool_input, { esito: "annullate" });
        const raccolte = await chiediRisposte(domande, idAzione ?? ingresso.tool_use_id, signal);
        return esitoDelleDomande(ingresso.tool_input, raccolte);
      },
    ],
  };
}

