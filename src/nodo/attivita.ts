/**
 * Le attività di una conversazione, come l'harness le racconta: comandi in background e agenti.
 * Si tengono quelle in corso e le ultime finite, con il file in cui l'harness scrive la loro uscita.
 */

import { open, stat } from "node:fs/promises";
import { ATTIVITA_FINITE_TENUTE, USCITA_MOSTRATA, type Attivita, type StatoAttivita } from "../protocollo/attivita.ts";

/** I messaggi dell'harness che parlano di un'attività, nella parte che serve qui. */
export type MessaggioAttivita =
  | {
      subtype: "task_started";
      task_id: string;
      description: string;
      tool_use_id?: string;
      task_type?: string;
      subagent_type?: string;
      is_backgrounded?: boolean;
      parent_task_id?: string;
      skip_transcript?: boolean;
      ambient?: boolean;
    }
  | { subtype: "task_progress"; task_id: string; description: string; subagent_type?: string; usage: { tool_uses: number; duration_ms: number }; last_tool_name?: string; summary?: string }
  | { subtype: "task_updated"; task_id: string; patch: { status?: string; description?: string; error?: string; is_backgrounded?: boolean } }
  | {
      subtype: "task_notification";
      task_id: string;
      status: "completed" | "failed" | "stopped";
      output_file: string;
      summary: string;
      usage?: { tool_uses: number; duration_ms: number };
      ambient?: boolean;
    };

const STATI_DELL_HARNESS: Record<string, StatoAttivita> = {
  pending: "in-corso",
  running: "in-corso",
  paused: "in-corso",
  completed: "finita",
  failed: "fallita",
  killed: "fermata",
  stopped: "fermata",
};

export class RegistroAttivita {
  readonly #attivita = new Map<string, Attivita>();
  readonly #uscite = new Map<string, string>();
  /** Quelle che non sono lavoro (osservatori, pulizie): l'harness le segnala, qui si ignorano. */
  readonly #ignorate = new Set<string>();
  /** I comandi lanciati da Claude, per azione: un'attività nata da un'azione ne prende il comando. */
  readonly #comandi = new Map<string, string>();
  /** L'attività nata da ciascuna azione. */
  readonly #perAzione = new Map<string, string>();

  /** Claude ha lanciato uno strumento: di un comando si tiene il testo, per l'attività che ne nascerà. */
  azioneIniziata(idAzione: string, strumento: string, ingresso: unknown): void {
    if (strumento !== "Bash" && strumento !== "PowerShell") return;
    const comando = typeof ingresso === "object" && ingresso !== null ? (ingresso as Record<string, unknown>).command : undefined;
    if (typeof comando !== "string") return;
    this.#comandi.set(idAzione, comando.slice(0, 2000));
    // Non servono per sempre: si tengono gli ultimi.
    if (this.#comandi.size > 200) this.#comandi.delete(this.#comandi.keys().next().value as string);
  }

  /**
   * Lo strumento ha risposto: un comando mandato in background dice dove scrive la sua uscita, e da
   * lì la si legge mentre lavora. Vero se l'elenco è cambiato.
   */
  azioneConclusa(idAzione: string, esito: string): boolean {
    const percorso = /Output is being written to: (.+?)\.(?:\s|$)/.exec(esito)?.[1];
    if (percorso === undefined) return false;
    const id = this.#perAzione.get(idAzione) ?? /running in background with ID: (\S+?)\.(?:\s|$)/.exec(esito)?.[1];
    const attivita = id === undefined ? undefined : this.#attivita.get(id);
    if (id === undefined || attivita === undefined) return false;
    this.#uscite.set(id, percorso.trim());
    if (attivita.conUscita === true) return false;
    this.#metti({ ...attivita, conUscita: true });
    return true;
  }

  /** Riceve un messaggio dell'harness; vero se l'elenco è cambiato. */
  ricevi(messaggio: MessaggioAttivita): boolean {
    const id = messaggio.task_id;
    if (this.#ignorate.has(id)) return false;
    const prima = this.#attivita.get(id);
    switch (messaggio.subtype) {
      case "task_started": {
        if (messaggio.ambient === true || messaggio.skip_transcript === true) {
          this.#ignorate.add(id);
          return false;
        }
        const agente = messaggio.task_type === "local_agent" || messaggio.subagent_type !== undefined;
        const comando = messaggio.tool_use_id === undefined ? undefined : this.#comandi.get(messaggio.tool_use_id);
        if (messaggio.tool_use_id !== undefined) this.#perAzione.set(messaggio.tool_use_id, id);
        this.#metti({
          id,
          genere: agente ? "agente" : messaggio.task_type === "local_bash" ? "comando" : "altro",
          descrizione: messaggio.description,
          stato: "in-corso",
          inSfondo: messaggio.is_backgrounded === true,
          ...(messaggio.subagent_type === undefined ? {} : { tipoAgente: messaggio.subagent_type }),
          ...(messaggio.parent_task_id === undefined ? {} : { genitore: messaggio.parent_task_id }),
          ...(comando === undefined ? {} : { comando }),
        });
        return true;
      }
      case "task_progress": {
        if (prima === undefined) return false;
        this.#metti({
          ...prima,
          strumentiUsati: messaggio.usage.tool_uses,
          durataMs: messaggio.usage.duration_ms,
          ...(messaggio.last_tool_name === undefined ? {} : { ultimoStrumento: messaggio.last_tool_name }),
          ...(messaggio.summary === undefined ? {} : { riassunto: messaggio.summary }),
        });
        return true;
      }
      case "task_updated": {
        if (prima === undefined) return false;
        const { status, description, error, is_backgrounded } = messaggio.patch;
        const stato = status === undefined ? undefined : STATI_DELL_HARNESS[status];
        this.#metti({
          ...prima,
          ...(stato === undefined ? {} : { stato }),
          ...(description === undefined ? {} : { descrizione: description }),
          ...(error === undefined ? {} : { riassunto: error }),
          ...(is_backgrounded === undefined ? {} : { inSfondo: is_backgrounded }),
        });
        return true;
      }
      case "task_notification": {
        if (messaggio.ambient === true) return false;
        this.#uscite.set(id, messaggio.output_file);
        this.#metti({
          ...(prima ?? { id, genere: "altro", descrizione: "Attività", inSfondo: true }),
          stato: STATI_DELL_HARNESS[messaggio.status] ?? "finita",
          ...(messaggio.summary === "" ? {} : { riassunto: messaggio.summary }),
          ...(messaggio.usage === undefined ? {} : { strumentiUsati: messaggio.usage.tool_uses, durataMs: messaggio.usage.duration_ms }),
          ...(messaggio.output_file === "" ? {} : { conUscita: true }),
        });
        return true;
      }
    }
  }

  /** Il processo si è chiuso: ciò che lavorava si è fermato con lui. Vero se è cambiato qualcosa. */
  processoChiuso(): boolean {
    let cambiato = false;
    for (const attivita of this.#attivita.values()) {
      if (attivita.stato !== "in-corso") continue;
      this.#attivita.set(attivita.id, { ...attivita, stato: "fermata", riassunto: "Si è fermata con la conversazione." });
      cambiato = true;
    }
    return cambiato;
  }

  /** Prima quelle in corso, poi le finite dalla più recente. */
  elenco(): Attivita[] {
    const tutte = [...this.#attivita.values()].reverse();
    return [...tutte.filter((voce) => voce.stato === "in-corso"), ...tutte.filter((voce) => voce.stato !== "in-corso")];
  }

  /** La parte finale dell'uscita di un'attività, oppure perché non c'è. */
  async uscita(id: string): Promise<{ testo: string; troncata: boolean } | { motivo: string }> {
    const file = this.#uscite.get(id);
    if (file === undefined) return { motivo: "Di questa attività non c'è un'uscita da leggere." };
    try {
      const { size } = await stat(file);
      const inizio = Math.max(0, size - USCITA_MOSTRATA);
      const maniglia = await open(file, "r");
      try {
        const contenuto = Buffer.alloc(size - inizio);
        await maniglia.read(contenuto, 0, contenuto.length, inizio);
        return { testo: contenuto.toString("utf8"), troncata: inizio > 0 };
      } finally {
        await maniglia.close();
      }
    } catch {
      return { motivo: "L'uscita di questa attività non c'è più." };
    }
  }

  #metti(attivita: Attivita): void {
    // Rimessa in fondo: l'ordine è quello dell'ultima novità.
    this.#attivita.delete(attivita.id);
    this.#attivita.set(attivita.id, attivita);
    const finite = [...this.#attivita.values()].filter((voce) => voce.stato !== "in-corso");
    for (const vecchia of finite.slice(0, Math.max(0, finite.length - ATTIVITA_FINITE_TENUTE))) {
      this.#attivita.delete(vecchia.id);
      this.#uscite.delete(vecchia.id);
    }
  }
}
