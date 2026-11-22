/**
 * La ricerca nel testo di tutte le conversazioni: la Home, i suoi argomenti archiviati e i
 * progetti. Si cerca in ciò che il proprietario ha scritto e in ciò che Claude ha risposto; ogni
 * parola cercata deve comparire nello stesso messaggio, senza badare a maiuscole e accenti.
 */

import type { EventoArchiviato } from "../protocollo/eventi.ts";

/** Dove sta una conversazione, per portarci il proprietario. */
export type DoveSiTrova = { tipo: "home" } | { tipo: "argomento"; id: string } | { tipo: "progetto"; id: string };

export interface ConversazioneDaCercare {
  dove: DoveSiTrova;
  titolo: string;
  storia: readonly EventoArchiviato[];
}

export interface Trovato {
  dove: DoveSiTrova;
  titolo: string;
  quando: string;
  chi: "proprietario" | "claude";
  /** Il pezzo di testo intorno alla prima parola trovata. */
  estratto: string;
}

/** Quanti risultati al massimo, e quanto testo intorno alla parola. */
export const RISULTATI_MASSIMI = 50;
const INTORNO = 70;

function semplice(testo: string): string {
  return testo.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function estrattoDi(testo: string, parola: string): string {
  const pulito = testo.replace(/\s+/g, " ").trim();
  const dove = semplice(pulito).indexOf(parola);
  const inizio = Math.max(0, dove - INTORNO);
  const fine = Math.min(pulito.length, dove + parola.length + INTORNO);
  return `${inizio > 0 ? "…" : ""}${pulito.slice(inizio, fine)}${fine < pulito.length ? "…" : ""}`;
}

/** Cerca le parole nelle conversazioni; dai risultati più recenti. */
export function cercaNelleConversazioni(conversazioni: readonly ConversazioneDaCercare[], cercato: string): Trovato[] {
  const parole = semplice(cercato).split(/\s+/).filter((parola) => parola.length > 0);
  if (parole.length === 0) return [];
  const trovati: Trovato[] = [];
  for (const conversazione of conversazioni) {
    for (const { quando, evento } of conversazione.storia) {
      const testo = evento.tipo === "messaggio-proprietario" ? evento.testo : evento.tipo === "testo-concluso" ? evento.testo : undefined;
      if (testo === undefined) continue;
      const confrontabile = semplice(testo);
      if (!parole.every((parola) => confrontabile.includes(parola))) continue;
      trovati.push({
        dove: conversazione.dove,
        titolo: conversazione.titolo,
        quando,
        chi: evento.tipo === "messaggio-proprietario" ? "proprietario" : "claude",
        estratto: estrattoDi(testo, parole[0] ?? ""),
      });
    }
  }
  return trovati.sort((a, b) => b.quando.localeCompare(a.quando)).slice(0, RISULTATI_MASSIMI);
}
