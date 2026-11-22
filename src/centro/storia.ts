/**
 * Ciò che si ricava dalla storia archiviata di una conversazione: una trascrizione leggibile,
 * i file che vi sono stati scritti, l'ultimo resoconto, lo stato del progetto, e la ricerca tra più storie.
 * Serve alla Home per ritrovare ciò che è stato fatto e per riferire dei progetti.
 */

import type { EventoArchiviato } from "../protocollo/eventi.ts";

type Storia = readonly EventoArchiviato[];

/** Un file scritto durante una conversazione, con l'ultimo contenuto che gli è stato dato. */
export interface FileScritto {
  /** Nome dell'ambiente, quando il file è stato scritto con uno strumento che lo indica. */
  ambiente?: string;
  percorso: string;
  /** Manca se il file è stato solo modificato: la storia ne conserva i ritocchi, non il testo intero. */
  contenuto?: string;
}

const STRUMENTO_SCRIVI = "mcp__shinka__scrivi_file";

function campo(ingresso: unknown, nome: string): string | undefined {
  if (typeof ingresso !== "object" || ingresso === null) return undefined;
  const valore = (ingresso as Record<string, unknown>)[nome];
  return typeof valore === "string" ? valore : undefined;
}

/** I file scritti con successo, ciascuno una volta sola e con il contenuto più recente. */
export function fileScritti(storia: Storia): FileScritto[] {
  const iniziate = new Map<string, { strumento: string; ingresso: unknown }>();
  const scritti = new Map<string, FileScritto>();
  for (const { evento } of storia) {
    if (evento.tipo === "azione-iniziata") {
      iniziate.set(evento.idAzione, { strumento: evento.strumento, ingresso: evento.ingresso });
      continue;
    }
    if (evento.tipo !== "azione-conclusa" || evento.errore) continue;
    const azione = iniziate.get(evento.idAzione);
    if (azione === undefined) continue;
    let file: FileScritto | undefined;
    if (azione.strumento === "Write" || azione.strumento === "Edit") {
      const percorso = campo(azione.ingresso, "file_path");
      const contenuto = azione.strumento === "Write" ? campo(azione.ingresso, "content") : undefined;
      if (percorso !== undefined) file = { percorso, ...(contenuto === undefined ? {} : { contenuto }) };
    } else if (azione.strumento === STRUMENTO_SCRIVI) {
      // L'esito riporta il percorso completo, che l'ingresso può aver dato solo in parte.
      const completo = /^File scritto(?: in "[^"]*")?: (.+)$/m.exec(evento.esito)?.[1]?.trim();
      const percorso = completo ?? campo(azione.ingresso, "percorso");
      const ambiente = campo(azione.ingresso, "ambiente");
      const contenuto = campo(azione.ingresso, "contenuto");
      if (percorso !== undefined) {
        file = {
          percorso,
          ...(ambiente === undefined ? {} : { ambiente }),
          ...(contenuto === undefined ? {} : { contenuto }),
        };
      }
    }
    if (file === undefined) continue;
    const chiave = `${file.ambiente ?? ""}\n${file.percorso}`;
    const prima = scritti.get(chiave);
    // Una modifica successiva non cancella il testo intero scritto prima: avvisa solo che è cambiato.
    if (prima?.contenuto !== undefined && file.contenuto === undefined) continue;
    scritti.set(chiave, file);
  }
  return [...scritti.values()];
}

function taglia(testo: string, massimo: number): string {
  return testo.length <= massimo ? testo : `${testo.slice(0, massimo)}… [tagliato]`;
}

/** L'ultimo testo scritto da Claude: di solito dice a che punto è il lavoro. */
export function ultimoResoconto(storia: Storia): string | undefined {
  for (let i = storia.length - 1; i >= 0; i -= 1) {
    const evento = storia[i]?.evento;
    if (evento?.tipo === "testo-concluso" && evento.testo.trim() !== "") return evento.testo.trim();
  }
  return undefined;
}

/** Lo stato del progetto come il progetto lo ha scritto l'ultima volta, e quando è arrivato. */
export function statoDelProgetto(storia: Storia): { testo: string; quando: string } | undefined {
  for (let i = storia.length - 1; i >= 0; i -= 1) {
    const archiviato = storia[i];
    if (archiviato?.evento.tipo === "stato-progetto") return { testo: archiviato.evento.testo, quando: archiviato.quando };
  }
  return undefined;
}

/** L'ultimo messaggio scritto dal proprietario. */
export function ultimaRichiesta(storia: Storia): string | undefined {
  for (let i = storia.length - 1; i >= 0; i -= 1) {
    const evento = storia[i]?.evento;
    if (evento?.tipo === "messaggio-proprietario" && evento.testo.trim() !== "") return evento.testo.trim();
  }
  return undefined;
}

/** Quanti messaggi ha scritto il proprietario. */
export function messaggiDelProprietario(storia: Storia): number {
  return storia.filter(({ evento }) => evento.tipo === "messaggio-proprietario").length;
}

/**
 * La conversazione in righe leggibili: chi ha detto cosa e quali azioni sono state fatte.
 * Se è più lunga del massimo se ne tiene la parte finale, la più recente.
 */
export function trascrivi(storia: Storia, chi: string, massimo = 24_000): string {
  const righe: string[] = [];
  for (const { evento } of storia) {
    switch (evento.tipo) {
      case "messaggio-proprietario":
        righe.push(`Proprietario: ${taglia(evento.testo, 4_000)}`);
        break;
      case "testo-concluso":
        if (evento.testo.trim() !== "") righe.push(`${chi}: ${taglia(evento.testo.trim(), 6_000)}`);
        break;
      case "azione-iniziata": {
        const dettaglio =
          campo(evento.ingresso, "command") ??
          campo(evento.ingresso, "comando") ??
          campo(evento.ingresso, "file_path") ??
          campo(evento.ingresso, "percorso") ??
          campo(evento.ingresso, "query") ??
          campo(evento.ingresso, "url") ??
          "";
        righe.push(`[azione ${evento.strumento}${dettaglio === "" ? "" : `: ${taglia(dettaglio, 300)}`}]`);
        break;
      }
      case "proposta-progetto":
        righe.push(`[proposta di progetto "${evento.nome}"]`);
        break;
      case "proposta-decisa":
        righe.push(`[proposta ${evento.esito}]`);
        break;
      default:
        break;
    }
  }
  const tutto = righe.join("\n");
  return tutto.length <= massimo ? tutto : `[… parte precedente omessa …]\n${tutto.slice(-massimo)}`;
}

/** Una storia con ciò che serve per cercarvi dentro. */
export interface Cercabile {
  id: string;
  titolo: string;
  riassunto: string;
  storia: Storia;
}

export interface Trovato {
  id: string;
  /** Quanto corrisponde: più è alto, meglio è. */
  peso: number;
  /** Un tratto della conversazione in cui compare ciò che si cercava. */
  brano?: string;
}

/** Parole troppo comuni per distinguere una conversazione da un'altra. */
const COMUNI = new Set([
  "che", "con", "del", "della", "delle", "dei", "degli", "per", "una", "uno", "gli", "nel", "nella",
  "non", "come", "sono", "più", "piu", "the", "and", "for", "quello", "quella", "questo", "questa",
  "fare", "fatto", "fammi", "puoi", "vorrei", "dammi", "mio", "mia", "anche", "dal", "dalla", "alla",
]);

function semplifica(testo: string): string {
  return testo
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function paroleDi(testo: string): string[] {
  const parole = semplifica(testo)
    .split(/[^a-z0-9]+/)
    .filter((parola) => parola.length >= 3 && !COMUNI.has(parola));
  return [...new Set(parole)];
}

/**
 * Cerca tra più storie quelle che parlano di ciò che viene chiesto. Contano di più le parole
 * nel titolo, nel riassunto e nei nomi dei file; poi quelle dette o scritte nella conversazione.
 */
export function cerca(cercabili: Cercabile[], richiesta: string, quanti = 6): Trovato[] {
  const parole = paroleDi(richiesta);
  if (parole.length === 0) return [];
  const trovati: Trovato[] = [];
  for (const cercabile of cercabili) {
    const titolo = semplifica(cercabile.titolo);
    const riassunto = semplifica(cercabile.riassunto);
    const file = fileScritti(cercabile.storia);
    const nomi = semplifica(file.map((f) => f.percorso).join("\n"));
    const corpoOriginale = [
      ...cercabile.storia.flatMap(({ evento }) =>
        evento.tipo === "messaggio-proprietario" || evento.tipo === "testo-concluso" ? [evento.testo] : [],
      ),
      ...file.map((f) => f.contenuto ?? ""),
    ].join("\n");
    const corpo = semplifica(corpoOriginale);
    let peso = 0;
    let brano: string | undefined;
    for (const parola of parole) {
      if (titolo.includes(parola)) peso += 5;
      if (riassunto.includes(parola)) peso += 3;
      if (nomi.includes(parola)) peso += 3;
      const dove = corpo.indexOf(parola);
      if (dove >= 0) {
        peso += 1;
        // La forma semplificata ha la stessa lunghezza dell'originale solo senza accenti composti:
        // il brano è indicativo, non una citazione esatta.
        brano ??= corpoOriginale
          .slice(Math.max(0, dove - 80), dove + 160)
          .replace(/\s+/g, " ")
          .trim();
      }
    }
    if (peso > 0) trovati.push({ id: cercabile.id, peso, ...(brano === undefined ? {} : { brano }) });
  }
  return trovati.sort((a, b) => b.peso - a.peso).slice(0, quanti);
}
