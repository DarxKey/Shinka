/**
 * Traduce i messaggi dell'Agent SDK negli eventi di conversazione di Shinka.
 * È una funzione pura: lo stato che le serve le viene passato da chi la chiama.
 *
 * Il testo di Claude viene preso dagli eventi di flusso, per averlo a frammenti.
 * Le azioni vengono prese dai messaggi completi, che portano l'ingresso per intero.
 */

import { limiteNelMessaggio, type LimiteRaggiunto } from "../protocollo/limiti.ts";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { spiegaErroreHarness } from "../harness/errori.ts";
import { eImmagine, type Immagine } from "../protocollo/allegati.ts";
import type { EventoConversazione } from "../protocollo/eventi.ts";

/** Oltre questa lunghezza l'esito di un'azione viene troncato prima di arrivare all'interfaccia. */
export const LIMITE_ESITO = 4000;

/** Quante immagini di un solo esito arrivano all'interfaccia, e quanto può pesare ciascuna in base64. */
export const IMMAGINI_MASSIME = 6;
export const PESO_MASSIMO_IMMAGINE = 6 * 1024 * 1024;

export interface StatoTraduzione {
  /** Identificativo del messaggio di Claude che sta arrivando. */
  idMessaggio: string;
  /** Blocchi di testo ancora aperti, per posizione nel messaggio. */
  testiAperti: Map<number, { idTesto: string; testo: string }>;
  /** Se l'harness ha detto che il limite del piano è esaurito, e quando si azzera. */
  limite?: LimiteRaggiunto;
}

export function nuovoStato(): StatoTraduzione {
  return { idMessaggio: "", testiAperti: new Map() };
}

/**
 * Vero se questo risultato chiude una nota e non un turno. Una nota entra nel contesto senza far
 * rispondere Claude, ma l'harness la chiude lo stesso con un risultato: riuscito, vuoto, senza
 * alcuno scambio con il modello. Contarlo come la fine di un turno farebbe credere finito il
 * lavoro che la nota precede.
 */
export function risultatoDiUnaNota(messaggio: SDKMessage): boolean {
  return (
    messaggio.type === "result" &&
    messaggio.subtype === "success" &&
    !messaggio.is_error &&
    messaggio.num_turns === 0 &&
    messaggio.duration_api_ms === 0 &&
    messaggio.result === ""
  );
}

export function traduci(messaggio: SDKMessage, stato: StatoTraduzione): EventoConversazione[] {
  switch (messaggio.type) {
    case "stream_event":
      return traduciFlusso(messaggio.event, stato);

    case "assistant": {
      if (messaggio.parent_tool_use_id !== null) return [];
      const eventi: EventoConversazione[] = [];
      if (messaggio.error !== undefined) {
        eventi.push({ tipo: "errore", messaggio: spiegaErroreHarness(messaggio.error) });
      }
      for (const [posizione, blocco] of messaggio.message.content.entries()) {
        // Il ragionamento arriva intero con il messaggio: l'interfaccia lo mostra se il proprietario lo vuole vedere.
        if (blocco.type === "thinking" && blocco.thinking.trim() !== "") {
          eventi.push({ tipo: "ragionamento", idRagionamento: `${messaggio.message.id}:${posizione}`, testo: blocco.thinking.trim() });
        }
        if (blocco.type === "tool_use") {
          eventi.push({
            tipo: "azione-iniziata",
            idAzione: blocco.id,
            strumento: blocco.name,
            ingresso: blocco.input,
          });
        }
      }
      return eventi;
    }

    case "user": {
      if (messaggio.parent_tool_use_id !== null) return [];
      const contenuto = messaggio.message.content;
      if (typeof contenuto === "string") return [];
      const eventi: EventoConversazione[] = [];
      for (const blocco of contenuto) {
        if (blocco.type === "tool_result") {
          const immagini = immaginiDi(blocco.content);
          eventi.push({
            tipo: "azione-conclusa",
            idAzione: blocco.tool_use_id,
            esito: tronca(testoDi(blocco.content)),
            errore: blocco.is_error === true,
            ...(immagini.length === 0 ? {} : { immagini }),
          });
        }
      }
      return eventi;
    }

    // L'harness dice come sta il limite del piano: se lo ha superato, il turno si fermerà per quello.
    case "rate_limit_event": {
      const { status, resetsAt } = messaggio.rate_limit_info;
      if (status === "rejected") stato.limite = typeof resetsAt === "number" ? { azzeraIl: new Date(resetsAt * 1000).toISOString() } : {};
      else delete stato.limite;
      return [];
    }

    case "result": {
      if (risultatoDiUnaNota(messaggio)) return [];
      const eventi = chiudiTestiAperti(stato);
      const riuscito = messaggio.subtype === "success" && !messaggio.is_error;
      const errore = riuscito
        ? undefined
        : messaggio.subtype === "success"
          ? messaggio.result
          : messaggio.errors.join("; ") || messaggio.subtype;
      // Un turno che non riesce per il limite del piano lo dice, con quando si azzera se si sa.
      const limite = riuscito ? undefined : (stato.limite ?? limiteNelMessaggio(errore));
      const uso = messaggio.usage as { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } | undefined;
      const token =
        uso === undefined || typeof uso.input_tokens !== "number"
          ? undefined
          : {
              ingresso: uso.input_tokens + (uso.cache_read_input_tokens ?? 0) + (uso.cache_creation_input_tokens ?? 0),
              uscita: uso.output_tokens ?? 0,
            };
      eventi.push({
        tipo: "turno-concluso",
        riuscito,
        durataMs: messaggio.duration_ms,
        ...(errore === undefined ? {} : { errore }),
        ...(token === undefined ? {} : { token }),
        ...(limite === undefined ? {} : { limite }),
      });
      return eventi;
    }

    default:
      return [];
  }
}

type EventoFlusso = Extract<SDKMessage, { type: "stream_event" }>["event"];

function traduciFlusso(evento: EventoFlusso, stato: StatoTraduzione): EventoConversazione[] {
  switch (evento.type) {
    case "message_start": {
      const eventi = chiudiTestiAperti(stato);
      stato.idMessaggio = evento.message.id;
      return eventi;
    }

    case "content_block_start": {
      if (evento.content_block.type !== "text") return [];
      const idTesto = `${stato.idMessaggio}:${evento.index}`;
      const iniziale = evento.content_block.text;
      stato.testiAperti.set(evento.index, { idTesto, testo: iniziale });
      const eventi: EventoConversazione[] = [{ tipo: "testo-iniziato", idTesto }];
      if (iniziale !== "") eventi.push({ tipo: "testo-frammento", idTesto, frammento: iniziale });
      return eventi;
    }

    case "content_block_delta": {
      if (evento.delta.type !== "text_delta") return [];
      const aperto = stato.testiAperti.get(evento.index);
      if (aperto === undefined) return [];
      aperto.testo += evento.delta.text;
      return [{ tipo: "testo-frammento", idTesto: aperto.idTesto, frammento: evento.delta.text }];
    }

    case "content_block_stop": {
      const aperto = stato.testiAperti.get(evento.index);
      if (aperto === undefined) return [];
      stato.testiAperti.delete(evento.index);
      return [{ tipo: "testo-concluso", idTesto: aperto.idTesto, testo: aperto.testo }];
    }

    default:
      return [];
  }
}

/** Un turno interrotto può lasciare un testo a metà: lo chiudiamo con quello che è arrivato. */
function chiudiTestiAperti(stato: StatoTraduzione): EventoConversazione[] {
  const eventi: EventoConversazione[] = [];
  for (const aperto of stato.testiAperti.values()) {
    eventi.push({ tipo: "testo-concluso", idTesto: aperto.idTesto, testo: aperto.testo });
  }
  stato.testiAperti.clear();
  return eventi;
}

function testoDi(contenuto: unknown): string {
  if (contenuto === undefined || contenuto === null) return "";
  if (typeof contenuto === "string") return contenuto;
  if (!Array.isArray(contenuto)) return JSON.stringify(contenuto);
  return contenuto
    .map((parte: unknown) => {
      if (typeof parte === "object" && parte !== null && "type" in parte) {
        if (parte.type === "text" && "text" in parte && typeof parte.text === "string") {
          return parte.text;
        }
        return parte.type === "image" ? "[immagine]" : `[${String(parte.type)}]`;
      }
      return String(parte);
    })
    .join("\n");
}

/** Le immagini contenute nell'esito di un'azione, per esempio uno screenshot o un file immagine letto. */
function immaginiDi(contenuto: unknown): Immagine[] {
  if (!Array.isArray(contenuto)) return [];
  const immagini: Immagine[] = [];
  for (const parte of contenuto as unknown[]) {
    if (immagini.length >= IMMAGINI_MASSIME) break;
    if (typeof parte !== "object" || parte === null || !("type" in parte) || parte.type !== "image") continue;
    const sorgente = "source" in parte ? parte.source : undefined;
    if (typeof sorgente !== "object" || sorgente === null) continue;
    const { type, media_type: tipo, data: dati } = sorgente as Record<string, unknown>;
    if (type !== "base64" || typeof tipo !== "string" || typeof dati !== "string") continue;
    if (!eImmagine(tipo) || dati.length > PESO_MASSIMO_IMMAGINE) continue;
    immagini.push({ tipo, dati });
  }
  return immagini;
}

function tronca(testo: string): string {
  if (testo.length <= LIMITE_ESITO) return testo;
  return `${testo.slice(0, LIMITE_ESITO)}\n… (troncato: ${testo.length - LIMITE_ESITO} caratteri in più)`;
}
