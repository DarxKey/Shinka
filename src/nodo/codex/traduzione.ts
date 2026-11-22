/**
 * Traduce le notifiche dell'app-server di Codex negli eventi di conversazione di Shinka. Le voci di
 * Codex prendono i nomi degli strumenti che l'interfaccia già conosce: un comando è "Bash", una
 * modifica "Edit", uno strumento di Shinka "mcp__shinka__…". Tiene lo stato che le serve tra una
 * notifica e l'altra: i testi a frammenti, i riassunti del ragionamento, le voci in corso.
 */

import type { EventoConversazione, TokenDelTurno } from "../../protocollo/eventi.ts";
import type { FinestraDiUtilizzo, StatoConversazione } from "../../protocollo/impostazioni.ts";
import { LIMITE_ESITO } from "../traduzione.ts";

type Voce = Record<string, unknown> & { type?: unknown; id?: unknown };

/** Lo strumento con cui l'interfaccia mostra le cose da fare: lo stesso di Claude. */
const STRUMENTO_PIANO = "TodoWrite";

/** Il comando come lo ha scritto Codex, senza la shell che lo avvolge: `/bin/bash -lc 'ls -la'` diventa `ls -la`. */
export function comandoLeggibile(comando: string): string {
  const avvolto = /^(?:\/bin\/)?(?:bash|sh|zsh) -l?c (.*)$/s.exec(comando.trim());
  if (avvolto?.[1] === undefined) return comando;
  const interno = avvolto[1].trim();
  if (interno.length >= 2 && interno.startsWith("'") && interno.endsWith("'")) return interno.slice(1, -1).replace(/'\\''/g, "'");
  if (interno.length >= 2 && interno.startsWith('"') && interno.endsWith('"')) return interno.slice(1, -1).replace(/\\"/g, '"');
  return interno;
}

/** Lo strumento e l'ingresso con cui una voce di Codex si mostra in Shinka; nulla se non è un'azione. */
export function azioneDi(voce: Voce): { strumento: string; ingresso: unknown } | undefined {
  switch (voce.type) {
    case "commandExecution":
      return { strumento: "Bash", ingresso: { command: comandoLeggibile(String(voce.command ?? "")), ...(typeof voce.cwd === "string" ? { cwd: voce.cwd } : {}) } };
    case "fileChange": {
      const cambi = Array.isArray(voce.changes) ? (voce.changes as { path?: unknown; kind?: unknown; diff?: unknown }[]) : [];
      const percorsi = cambi.map((cambio) => String(cambio.path ?? ""));
      const nuovo = cambi.length === 1 && JSON.stringify(cambi[0]?.kind ?? "").includes("add");
      return {
        strumento: nuovo ? "Write" : "Edit",
        ingresso: { file_path: percorsi.join(", "), diff: cambi.map((cambio) => String(cambio.diff ?? "")).join("\n") },
      };
    }
    case "webSearch":
      return { strumento: "WebSearch", ingresso: { query: String(voce.query ?? "") } };
    case "mcpToolCall":
      return { strumento: `mcp__${String(voce.server ?? "")}__${String(voce.tool ?? "")}`, ingresso: voce.arguments ?? {} };
    case "dynamicToolCall":
      return { strumento: `mcp__${String(voce.namespace ?? "shinka")}__${String(voce.tool ?? "")}`, ingresso: voce.arguments ?? {} };
    case "collabAgentToolCall":
      return { strumento: "Agent", ingresso: { description: String(voce.prompt ?? "").slice(0, 200) } };
    case "imageView":
      return { strumento: "Read", ingresso: { file_path: String(voce.path ?? "") } };
    default:
      return undefined;
  }
}

/** Com'è finita un'azione: il testo dell'esito e se è un errore. */
function esitoDi(voce: Voce): { esito: string; errore: boolean } {
  const taglia = (testo: string): string => (testo.length > LIMITE_ESITO ? `${testo.slice(0, LIMITE_ESITO)}…` : testo);
  switch (voce.type) {
    case "commandExecution": {
      const uscita = String(voce.aggregatedOutput ?? "");
      const codice = typeof voce.exitCode === "number" ? voce.exitCode : undefined;
      const errore = voce.status === "failed" || voce.status === "declined" || (codice !== undefined && codice !== 0);
      return { esito: taglia(voce.status === "declined" ? "Il comando non è partito." : uscita === "" && codice !== undefined ? `Codice di uscita: ${codice}` : uscita), errore };
    }
    case "fileChange":
      return { esito: voce.status === "completed" ? "Fatto." : voce.status === "declined" ? "La modifica non è stata fatta." : String(voce.status ?? ""), errore: voce.status !== "completed" };
    case "mcpToolCall": {
      const risultato = voce.result as { content?: { type?: string; text?: string }[] } | null;
      const errore = voce.error as { message?: string } | null;
      if (errore !== null && errore !== undefined) return { esito: taglia(String(errore.message ?? "Errore")), errore: true };
      return { esito: taglia((risultato?.content ?? []).map((parte) => parte.text ?? "").join("\n")), errore: false };
    }
    case "dynamicToolCall": {
      const parti = Array.isArray(voce.contentItems) ? (voce.contentItems as { type?: string; text?: string }[]) : [];
      return { esito: taglia(parti.map((parte) => parte.text ?? "").join("\n")), errore: voce.success === false };
    }
    default:
      return { esito: "", errore: voce.status === "failed" };
  }
}

/** Una finestra dei limiti del piano di Codex, come la chiama Shinka. */
function finestra(letta: unknown): { durata: number | undefined; finestra: FinestraDiUtilizzo } | undefined {
  if (typeof letta !== "object" || letta === null) return undefined;
  const { usedPercent, windowDurationMins, resetsAt } = letta as Record<string, unknown>;
  if (typeof usedPercent !== "number") return undefined;
  return {
    durata: typeof windowDurationMins === "number" ? windowDurationMins : undefined,
    finestra: { percento: Math.round(usedPercent), ...(typeof resetsAt === "number" ? { azzeraIl: new Date(resetsAt * 1000).toISOString() } : {}) },
  };
}

/** I limiti del piano di ChatGPT, nelle due finestre che Shinka mostra: quella breve e la settimanale. */
export function limitiDi(snapshot: unknown): StatoConversazione["limiti"] | undefined {
  if (typeof snapshot !== "object" || snapshot === null) return undefined;
  const { primary, secondary } = snapshot as Record<string, unknown>;
  const limiti: NonNullable<StatoConversazione["limiti"]> = {};
  for (const letta of [finestra(primary), finestra(secondary)]) {
    if (letta === undefined) continue;
    if (letta.durata !== undefined && letta.durata >= 24 * 60) limiti.setteGiorni = letta.finestra;
    else limiti.cinqueOre = letta.finestra;
  }
  return Object.keys(limiti).length === 0 ? undefined : limiti;
}

export class TraduzioneCodex {
  readonly #testi = new Map<string, string>();
  readonly #ragionamenti = new Map<string, string>();
  /** Le voci iniziate e non ancora concluse, per mostrarle in una richiesta di permesso. */
  readonly #voci = new Map<string, Voce>();
  #token: TokenDelTurno | undefined;

  /** L'azione di una voce in corso, per una richiesta di permesso. */
  azioneInCorso(idVoce: string): { strumento: string; ingresso: unknown } | undefined {
    const voce = this.#voci.get(idVoce);
    return voce === undefined ? undefined : azioneDi(voce);
  }

  /** I file di una modifica in corso. */
  percorsiInCorso(idVoce: string): string[] {
    const voce = this.#voci.get(idVoce);
    if (voce?.type !== "fileChange" || !Array.isArray(voce.changes)) return [];
    return (voce.changes as { path?: unknown }[]).map((cambio) => String(cambio.path ?? ""));
  }

  /** Comincia un turno nuovo: i token sono i suoi. */
  turnoNuovo(): void {
    this.#token = undefined;
  }

  notifica(metodo: string, parametri: Record<string, unknown>): EventoConversazione[] {
    switch (metodo) {
      case "item/started": {
        const voce = parametri.item as Voce | undefined;
        if (voce === undefined || typeof voce.id !== "string") return [];
        this.#voci.set(voce.id, voce);
        if (voce.type === "agentMessage") {
          this.#testi.set(voce.id, "");
          return [{ tipo: "testo-iniziato", idTesto: voce.id }];
        }
        const azione = azioneDi(voce);
        return azione === undefined ? [] : [{ tipo: "azione-iniziata", idAzione: voce.id, ...azione }];
      }
      case "item/agentMessage/delta": {
        const idTesto = String(parametri.itemId ?? "");
        const frammento = String(parametri.delta ?? "");
        if (!this.#testi.has(idTesto)) {
          this.#testi.set(idTesto, frammento);
          return [{ tipo: "testo-iniziato", idTesto }, { tipo: "testo-frammento", idTesto, frammento }];
        }
        this.#testi.set(idTesto, (this.#testi.get(idTesto) ?? "") + frammento);
        return frammento === "" ? [] : [{ tipo: "testo-frammento", idTesto, frammento }];
      }
      case "item/reasoning/summaryTextDelta": {
        const id = String(parametri.itemId ?? "");
        this.#ragionamenti.set(id, (this.#ragionamenti.get(id) ?? "") + String(parametri.delta ?? ""));
        return [];
      }
      case "item/reasoning/summaryPartAdded": {
        const id = String(parametri.itemId ?? "");
        const finora = this.#ragionamenti.get(id);
        if (finora !== undefined && finora !== "") this.#ragionamenti.set(id, `${finora}\n\n`);
        return [];
      }
      case "item/completed": {
        const voce = parametri.item as Voce | undefined;
        if (voce === undefined || typeof voce.id !== "string") return [];
        this.#voci.delete(voce.id);
        if (voce.type === "agentMessage") {
          const iniziato = this.#testi.has(voce.id);
          this.#testi.delete(voce.id);
          return [...(iniziato ? [] : [{ tipo: "testo-iniziato" as const, idTesto: voce.id }]), { tipo: "testo-concluso", idTesto: voce.id, testo: String(voce.text ?? "") }];
        }
        if (voce.type === "reasoning") {
          const riassunto = Array.isArray(voce.summary) ? (voce.summary as unknown[]).map(String).join("\n\n") : "";
          const testo = (riassunto !== "" ? riassunto : (this.#ragionamenti.get(voce.id) ?? "")).trim();
          this.#ragionamenti.delete(voce.id);
          return testo === "" ? [] : [{ tipo: "ragionamento", idRagionamento: voce.id, testo }];
        }
        if (voce.type === "contextCompaction") return [{ tipo: "nota", testo: "La conversazione è stata compattata: Codex ne tiene un riassunto." }];
        if (azioneDi(voce) === undefined) return [];
        return [{ tipo: "azione-conclusa", idAzione: voce.id, ...esitoDi(voce) }];
      }
      case "thread/tokenUsage/updated": {
        const uso = parametri.tokenUsage as { last?: Record<string, number>; modelContextWindow?: number | null } | undefined;
        const ultimo = uso?.last;
        if (ultimo === undefined) return [];
        const ingresso = (ultimo.inputTokens ?? 0) + (ultimo.cacheWriteInputTokens ?? 0);
        this.#token = { ingresso: (this.#token?.ingresso ?? 0) + ingresso, uscita: (this.#token?.uscita ?? 0) + (ultimo.outputTokens ?? 0) };
        const massimo = uso?.modelContextWindow;
        if (typeof massimo !== "number" || massimo <= 0) return [];
        // Ciò che occupa il contesto è l'ultima richiesta mandata al modello.
        const usati = ingresso + (ultimo.outputTokens ?? 0);
        return [{ tipo: "stato", stato: { contesto: { usati, massimo, percento: Math.round((usati / massimo) * 100) } } }];
      }
      case "turn/plan/updated": {
        // Il piano di Codex è la lista delle cose da fare: si mostra come quella di Claude, una scheda per turno.
        const passi = Array.isArray(parametri.plan) ? (parametri.plan as { step?: unknown; status?: unknown }[]) : [];
        const todos = passi
          .filter((passo) => typeof passo.step === "string" && passo.step.trim() !== "")
          .map((passo) => ({
            content: String(passo.step),
            activeForm: String(passo.step),
            status: passo.status === "completed" ? "completed" : passo.status === "inProgress" ? "in_progress" : "pending",
          }));
        if (todos.length === 0) return [];
        return [{ tipo: "azione-iniziata", idAzione: `piano-${String(parametri.turnId ?? "")}`, strumento: STRUMENTO_PIANO, ingresso: { todos } }];
      }
      case "account/rateLimits/updated": {
        const limiti = limitiDi(parametri.rateLimits);
        return limiti === undefined ? [] : [{ tipo: "stato", stato: { limiti } }];
      }
      case "turn/completed": {
        const turno = parametri.turn as { status?: string; error?: { message?: string } | null; durationMs?: number | null } | undefined;
        const chiusi = [...this.#testi.entries()].map(([idTesto, testo]): EventoConversazione => ({ tipo: "testo-concluso", idTesto, testo }));
        this.#testi.clear();
        const interrotto = turno?.status === "interrupted";
        const riuscito = turno?.status === "completed" || interrotto;
        const errore = turno?.error?.message;
        const token = this.#token;
        this.#token = undefined;
        return [
          ...chiusi,
          {
            tipo: "turno-concluso",
            riuscito,
            durataMs: turno?.durationMs ?? 0,
            ...(interrotto ? { interrotto: true } : {}),
            ...(!riuscito && errore !== undefined ? { errore } : !riuscito ? { errore: "Codex non ha finito il turno." } : {}),
            ...(token === undefined ? {} : { token }),
          },
        ];
      }
      case "error": {
        const errore = parametri.error as { message?: string } | undefined;
        if (parametri.willRetry === true) return [];
        return [{ tipo: "errore", messaggio: `Codex: ${errore?.message ?? "errore"}` }];
      }
      default:
        return [];
    }
  }
}
