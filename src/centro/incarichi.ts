/**
 * Gli incarichi dei progetti (ADR 0051): chi guida un progetto affida un pezzo di lavoro a chi
 * implementa, un altro modello scelto dal proprietario, che lo svolge in una conversazione a parte
 * del progetto, nella stessa cartella e con il modo dei permessi del progetto. Le sue richieste di
 * permesso e le sue domande arrivano al proprietario nella conversazione del progetto; lì l'incarico
 * si vede come un'attività, con il modello che lo svolge e a che punto è. Alla fine chi guida
 * riceve il resoconto, i file cambiati, i token e la durata, e ogni incarico resta nel registro
 * delle misure.
 */

import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { ATTIVITA_FINITE_TENUTE, USCITA_MOSTRATA, type Attivita } from "../protocollo/attivita.ts";
import type {
  DecisionePermesso,
  EventoConversazione,
  PortaConversazione,
  RispostaAlleDomande,
  TokenDelTurno,
  UscitaAttivita,
} from "../protocollo/eventi.ts";
import { IMPEGNI, MOTORI, type Impegno, type ImpostazioniConversazione, type ModoPermessi, type Motore } from "../protocollo/impostazioni.ts";
import {
  conversazioneDellIncarico,
  descriviChiImplementa,
  DURATA_INCARICO_MASSIMA_MS,
  INCARICO_MASSIMO,
  RESOCONTO_MASSIMO,
  type ChiImplementa,
} from "../protocollo/incarichi.ts";
import type { Progetto } from "../protocollo/progetti.ts";
import type { EsitoStrumento } from "../protocollo/strumenti.ts";
import type { Esecutore } from "./esecutori.ts";

/** Ciò che chi guida scrive nell'incarico. */
export interface RichiestaIncarico {
  incarico: string;
  vincoli?: string;
  file?: string[];
  criteri: string;
  /** Un altro modello per questo incarico solo, se il proprietario lo ha chiesto. */
  modello?: string;
  impegno?: Impegno;
}

/** Com'è andato un incarico, come resta nel registro delle misure. */
export interface MisuraIncarico {
  quando: string;
  idProgetto: string;
  idIncarico: string;
  motore?: Motore;
  /** Il modello scelto, e quello che ha risposto davvero se l'harness lo ha detto. */
  modello?: string;
  modelloVero?: string;
  impegno?: Impegno;
  esito: "riuscito" | "non-riuscito" | "interrotto" | "scaduto";
  durataMs: number;
  token?: TokenDelTurno;
  azioni: number;
  file: number;
  /** Con un modello locale: il picco di memoria della scheda video mentre il server era acceso, in MB. */
  vramPiccoMb?: number;
}

export interface OpzioniIncarichi {
  /** Chi esegue nell'ambiente di un progetto. */
  esecutore(idAmbiente: string): Esecutore;
  /** Mette un evento nella conversazione del progetto: permessi e domande dell'incarico. */
  pubblica(idProgetto: string, evento: EventoConversazione): void;
  /** Le attività degli incarichi di un progetto sono cambiate. */
  attivitaCambiate(idProgetto: string): void;
  /** Le estensioni scelte per il progetto. */
  estensioni(idProgetto: string): readonly string[] | undefined;
  /** Il file in cui ogni incarico finito lascia le sue misure, una riga JSON per incarico. */
  registro?: string;
  /** Quanto può durare un incarico. Nei test meno. */
  durataMassimaMs?: number;
}

/** Ciò che un incarico in corso tiene a mente. */
interface InCorso {
  id: string;
  idProgetto: string;
  idAmbiente: string;
  porta: PortaConversazione;
  impostazioni: ImpostazioniConversazione;
  nome: string;
  inizio: number;
  attivita: Attivita;
  /** I testi di chi implementa e gli strumenti che usa, in ordine: l'uscita dell'attività. */
  trascrizione: string[];
  ultimoTesto?: string;
  ultimoErrore?: string;
  modelloVero?: string;
  vramPiccoMb?: number;
  azioni: number;
  file: Map<string, string>;
  altriFile: number;
  permessi: Set<string>;
  domande: Set<string>;
  /** Le azioni che il proprietario ha visto nella conversazione del progetto, per un permesso: lì se ne vede anche la fine. */
  azioniMostrate: Set<string>;
  scadenza?: NodeJS.Timeout;
  /** Vero se a fermarlo è stato il tempo massimo. */
  scaduto: boolean;
  concludi(esito: { riuscito: boolean; durataMs: number; token?: TokenDelTurno; errore?: string; interrotto?: boolean }): void;
}

/** Legge gli argomenti di `affida_incarico`; il motivo, se non vanno. */
export function leggiRichiestaIncarico(argomenti: unknown): RichiestaIncarico | { motivo: string } {
  if (typeof argomenti !== "object" || argomenti === null) return { motivo: "Mancano l'incarico e i criteri di accettazione." };
  const campi = argomenti as Record<string, unknown>;
  const testo = (nome: string): string | undefined =>
    typeof campi[nome] === "string" && (campi[nome] as string).trim() !== "" ? (campi[nome] as string).trim() : undefined;
  const incarico = testo("incarico");
  const criteri = testo("criteri");
  if (incarico === undefined) return { motivo: "Manca l'incarico: che cosa deve fare chi implementa." };
  if (criteri === undefined) return { motivo: "Mancano i criteri di accettazione: come si sa che è fatto." };
  const vincoli = testo("vincoli");
  const file = Array.isArray(campi.file) ? campi.file.filter((voce): voce is string => typeof voce === "string" && voce.trim() !== "").map((voce) => voce.trim()) : [];
  const lunghezza = incarico.length + criteri.length + (vincoli?.length ?? 0) + file.join("\n").length;
  if (lunghezza > INCARICO_MASSIMO) return { motivo: `L'incarico è troppo lungo: al massimo ${INCARICO_MASSIMO} caratteri in tutto.` };
  const modello = testo("modello");
  const impegno = IMPEGNI.find((livello) => livello === campi.impegno);
  return {
    incarico,
    criteri,
    ...(vincoli === undefined ? {} : { vincoli }),
    ...(file.length === 0 ? {} : { file: file.slice(0, 100) }),
    ...(modello === undefined ? {} : { modello: modello.slice(0, 200) }),
    ...(impegno === undefined ? {} : { impegno }),
  };
}

/**
 * Chi svolge l'incarico: quello scelto dal proprietario per il progetto, oppure il modello che ha
 * chiesto per questo incarico solo. Nulla se non c'è né l'uno né l'altro.
 */
export function chiSvolge(scelta: ChiImplementa | undefined, richiesta: RichiestaIncarico): ChiImplementa | undefined {
  if (richiesta.modello === undefined) {
    if (scelta === undefined) return undefined;
    return { ...scelta, ...(richiesta.impegno === undefined ? {} : { impegno: richiesta.impegno }) };
  }
  // "codex:gpt-5.5" sceglie anche il motore; un modello senza motore resta su quello scelto.
  const separatore = richiesta.modello.indexOf(":");
  const motore = MOTORI.find((voce) => separatore > 0 && voce === richiesta.modello?.slice(0, separatore));
  const modello = motore === undefined ? richiesta.modello : richiesta.modello.slice(separatore + 1).trim();
  const delMotore = motore ?? scelta?.motore;
  return {
    ...(delMotore === undefined ? {} : { motore: delMotore }),
    ...(modello === "" ? {} : { modello }),
    ...(richiesta.impegno === undefined ? {} : { impegno: richiesta.impegno }),
  };
}

/** Il primo messaggio della conversazione dell'incarico: tutto ciò che chi implementa sa. */
export function testoDellIncarico(richiesta: RichiestaIncarico): string {
  return [
    "# Incarico",
    richiesta.incarico,
    ...(richiesta.vincoli === undefined ? [] : ["# Vincoli", richiesta.vincoli]),
    ...(richiesta.file === undefined ? [] : ["# File pertinenti", richiesta.file.map((voce) => `- ${voce}`).join("\n")]),
    "# Criteri di accettazione",
    richiesta.criteri,
    "Alla fine rispondi con il resoconto per chi guida il progetto: che cosa hai fatto, i file cambiati, i comandi di prova lanciati con il loro esito, i dubbi.",
  ].join("\n\n");
}

/** Una durata in parole: "45 s", "3 min 12 s". */
export function durataInParole(ms: number): string {
  const secondi = Math.max(0, Math.round(ms / 1000));
  if (secondi < 60) return `${secondi} s`;
  const minuti = Math.floor(secondi / 60);
  if (minuti < 60) return `${minuti} min ${secondi % 60} s`;
  return `${Math.floor(minuti / 60)} h ${minuti % 60} min`;
}

const IN_MIGLIAIA = new Intl.NumberFormat("it-IT");

/** Quanto dell'esito di un'azione dell'incarico si vede nella conversazione del progetto. */
const ESITO_MOSTRATO = 4000;

export class Incarichi {
  readonly #o: OpzioniIncarichi;
  /** Al più un incarico per volta in ogni progetto: due modelli nella stessa cartella non lavorano insieme. */
  readonly #inCorso = new Map<string, InCorso>();
  /** Le attività degli incarichi finiti, per progetto, le più recenti per ultime. */
  readonly #finiti = new Map<string, Attivita[]>();
  /** L'uscita di ogni incarico, per attività: resta finché l'attività resta. */
  readonly #uscite = new Map<string, string>();

  constructor(opzioni: OpzioniIncarichi) {
    this.#o = opzioni;
  }

  /** Le attività degli incarichi di un progetto: quello in corso e gli ultimi finiti. */
  attivita(idProgetto: string): Attivita[] {
    const inCorso = this.#inCorso.get(idProgetto);
    return [...(this.#finiti.get(idProgetto) ?? []), ...(inCorso === undefined ? [] : [{ ...inCorso.attivita, durataMs: Date.now() - inCorso.inizio }])];
  }

  /** Vero se nel progetto c'è un incarico in corso. */
  inCorso(idProgetto: string): boolean {
    return this.#inCorso.has(idProgetto);
  }

  /** La parte finale dell'uscita di un incarico, se l'attività è di un incarico. */
  uscita(idAttivita: string): UscitaAttivita | undefined {
    for (const inCorso of this.#inCorso.values()) {
      if (inCorso.attivita.id === idAttivita) return tagliaUscita(inCorso.trascrizione.join("\n\n"));
    }
    const testo = this.#uscite.get(idAttivita);
    return testo === undefined ? undefined : tagliaUscita(testo);
  }

  /** Decide un permesso chiesto dall'incarico del progetto. Falso se non è suo o non aspetta più. */
  decidiPermesso(idProgetto: string, idPermesso: string, decisione: DecisionePermesso, sempre?: boolean): boolean {
    const inCorso = this.#inCorso.get(idProgetto);
    if (inCorso === undefined || !inCorso.permessi.has(idPermesso)) return false;
    return inCorso.porta.decidiPermesso(idPermesso, decisione, sempre);
  }

  /** Risponde alle domande dell'incarico del progetto. Falso se non sono sue o non aspettano più. */
  rispondiDomande(idProgetto: string, idDomande: string, risposta: RispostaAlleDomande): boolean {
    const inCorso = this.#inCorso.get(idProgetto);
    if (inCorso === undefined || !inCorso.domande.has(idDomande)) return false;
    return inCorso.porta.rispondiDomande?.(idDomande, risposta) ?? false;
  }

  /** Il proprietario ferma il progetto: si ferma anche il suo incarico. */
  async interrompi(idProgetto: string): Promise<void> {
    const inCorso = this.#inCorso.get(idProgetto);
    if (inCorso === undefined) return;
    await inCorso.porta.interrompi();
  }

  /** L'ambiente si è scollegato: gli incarichi che vi lavoravano non arriveranno alla fine. */
  ambienteScollegato(idAmbiente: string): void {
    for (const inCorso of [...this.#inCorso.values()]) {
      if (inCorso.idAmbiente !== idAmbiente) continue;
      inCorso.concludi({ riuscito: false, durataMs: Date.now() - inCorso.inizio, errore: "L'ambiente si è scollegato mentre chi implementa lavorava." });
    }
  }

  /** Il progetto se ne va: il suo incarico, se ce n'è uno, si chiude, e le sue attività si dimenticano. */
  chiudiDelProgetto(idProgetto: string): void {
    const inCorso = this.#inCorso.get(idProgetto);
    inCorso?.concludi({ riuscito: false, durataMs: Date.now() - inCorso.inizio, interrotto: true, errore: "Il progetto è stato eliminato." });
    for (const finita of this.#finiti.get(idProgetto) ?? []) this.#uscite.delete(finita.id);
    this.#finiti.delete(idProgetto);
  }

  /** Chiude le conversazioni degli incarichi, per esempio allo spegnimento del centro. */
  chiudi(): void {
    for (const inCorso of [...this.#inCorso.values()]) {
      inCorso.concludi({ riuscito: false, durataMs: Date.now() - inCorso.inizio, errore: "Shinka si è spenta mentre chi implementa lavorava." });
    }
  }

  /**
   * Affida un incarico e ne aspetta la fine: la risposta per chi guida, con il resoconto di chi
   * implementa e le misure. Non lancia: ciò che va storto è nella risposta.
   */
  async affida(progetto: Progetto, scelta: ChiImplementa | undefined, permessi: ModoPermessi, argomenti: unknown): Promise<EsitoStrumento> {
    const richiesta = leggiRichiestaIncarico(argomenti);
    if ("motivo" in richiesta) return { testo: richiesta.motivo, errore: true };
    const chi = chiSvolge(scelta, richiesta);
    if (chi === undefined) {
      return {
        testo:
          "In questo progetto il proprietario non ha scelto chi implementa: il lavoro lo fai tu. Se vuole affidarlo a un altro modello, lo sceglie nella scheda della sessione del progetto.",
        errore: true,
      };
    }
    if (this.#inCorso.has(progetto.id)) {
      return { testo: "C'è già un incarico in corso in questo progetto: aspetta che finisca prima di affidarne un altro.", errore: true };
    }
    const id = randomUUID().slice(0, 8);
    const impostazioni: ImpostazioniConversazione = {
      ...(chi.motore === undefined ? {} : { motore: chi.motore }),
      ...(chi.modello === undefined ? {} : { modello: chi.modello }),
      ...(chi.impegno === undefined ? {} : { impegno: chi.impegno }),
      permessi,
    };
    const nome = descriviChiImplementa(chi);
    return new Promise<EsitoStrumento>((risolvi) => {
      const inizio = Date.now();
      let concluso = false;
      const stato: InCorso = {
        id,
        idProgetto: progetto.id,
        idAmbiente: progetto.idAmbiente,
        // Assegnata subito sotto: la conversazione nasce dopo, perché i suoi eventi trovano questo stato.
        porta: undefined as unknown as PortaConversazione,
        impostazioni,
        nome,
        inizio,
        attivita: {
          id: `incarico-${id}`,
          genere: "agente",
          descrizione: primaRiga(richiesta.incarico),
          stato: "in-corso",
          inSfondo: false,
          tipoAgente: `incarico · ${nome}`,
          riassunto: `Lo svolge ${nome}.`,
          strumentiUsati: 0,
          conUscita: true,
        },
        trascrizione: [],
        azioni: 0,
        file: new Map(),
        altriFile: 0,
        permessi: new Set(),
        domande: new Set(),
        azioniMostrate: new Set(),
        scaduto: false,
        concludi: (esito) => {
          if (concluso) return;
          concluso = true;
          risolvi(this.#concludi(stato, esito));
        },
      };
      this.#inCorso.set(progetto.id, stato);
      try {
        stato.porta = this.#o.esecutore(progetto.idAmbiente).apriConversazione(
          conversazioneDellIncarico(progetto.id, id),
          progetto.cartella,
          // Ogni incarico comincia da capo: non riprende la storia di nessuno.
          () => undefined,
          () => impostazioni,
          (evento) => this.#evento(stato, evento),
          () => {},
          () => this.#o.estensioni(progetto.id),
        );
        stato.porta.invia(testoDellIncarico(richiesta));
      } catch (errore) {
        stato.concludi({ riuscito: false, durataMs: 0, errore: `L'incarico non è partito: ${errore instanceof Error ? errore.message : String(errore)}` });
        return;
      }
      stato.scadenza = setTimeout(() => {
        stato.scaduto = true;
        void stato.porta.interrompi().catch(() => {});
        // Se la conversazione non risponde più nemmeno all'interruzione, si chiude comunque.
        setTimeout(() => stato.concludi({ riuscito: false, durataMs: Date.now() - inizio, interrotto: true }), 30_000).unref();
      }, this.#o.durataMassimaMs ?? DURATA_INCARICO_MASSIMA_MS);
      stato.scadenza.unref();
      this.#o.attivitaCambiate(progetto.id);
    });
  }

  #evento(stato: InCorso, evento: EventoConversazione): void {
    const { idProgetto } = stato;
    switch (evento.tipo) {
      case "stato": {
        if (evento.stato.modello !== undefined) stato.modelloVero = evento.stato.modello;
        const vram = evento.stato.modelloLocale?.vramPiccoMb;
        if (vram !== undefined && (stato.vramPiccoMb === undefined || vram > stato.vramPiccoMb)) stato.vramPiccoMb = vram;
        return;
      }
      case "azione-iniziata":
        stato.azioni += 1;
        stato.trascrizione.push(`→ ${nomeBreve(evento.strumento)}`);
        stato.attivita = { ...stato.attivita, ultimoStrumento: nomeBreve(evento.strumento), strumentiUsati: stato.azioni };
        this.#o.attivitaCambiate(idProgetto);
        return;
      case "testo-concluso":
        if (evento.testo.trim() === "") return;
        stato.ultimoTesto = evento.testo;
        stato.trascrizione.push(evento.testo);
        return;
      case "errore":
        stato.ultimoErrore = evento.messaggio;
        stato.trascrizione.push(`Errore: ${evento.messaggio}`);
        return;
      case "modifiche":
        for (const file of evento.file) stato.file.set(file.percorso, file.stato);
        stato.altriFile += evento.altri ?? 0;
        return;
      case "azione-conclusa":
        if (!stato.azioniMostrate.delete(evento.idAzione)) return;
        this.#o.pubblica(idProgetto, { tipo: "azione-conclusa", idAzione: evento.idAzione, errore: evento.errore, esito: evento.esito.length > ESITO_MOSTRATO ? `${evento.esito.slice(0, ESITO_MOSTRATO)}\n… [tagliato]` : evento.esito });
        return;
      case "permesso-richiesto":
        stato.permessi.add(evento.idPermesso);
        stato.azioniMostrate.add(evento.idAzione);
        // Il proprietario decide dalla conversazione del progetto, e deve sapere chi lo chiede.
        this.#o.pubblica(idProgetto, { ...evento, motivo: `Lo chiede ${stato.nome}, che svolge un incarico.${evento.motivo === undefined ? "" : ` ${evento.motivo}`}` });
        return;
      case "permesso-deciso":
        if (!stato.permessi.delete(evento.idPermesso)) return;
        this.#o.pubblica(idProgetto, evento);
        return;
      case "domande-poste":
        stato.domande.add(evento.idDomande);
        this.#o.pubblica(idProgetto, evento);
        return;
      case "domande-chiuse":
        if (!stato.domande.delete(evento.idDomande)) return;
        this.#o.pubblica(idProgetto, evento);
        return;
      case "turno-concluso":
        stato.concludi({
          riuscito: evento.riuscito,
          durataMs: Date.now() - stato.inizio,
          ...(evento.token === undefined ? {} : { token: evento.token }),
          ...(evento.errore === undefined ? {} : { errore: evento.errore }),
          ...(evento.interrotto === true ? { interrotto: true } : {}),
        });
        return;
      default:
        return;
    }
  }

  #concludi(
    stato: InCorso,
    esito: { riuscito: boolean; durataMs: number; token?: TokenDelTurno; errore?: string; interrotto?: boolean },
  ): EsitoStrumento {
    clearTimeout(stato.scadenza);
    this.#inCorso.delete(stato.idProgetto);
    try {
      stato.porta?.chiudi();
    } catch {
      // Una conversazione che non si chiude non deve fermare la risposta a chi guida.
    }
    // Ciò che l'incarico lasciava in attesa del proprietario non aspetta più.
    for (const idPermesso of stato.permessi) this.#o.pubblica(stato.idProgetto, { tipo: "permesso-deciso", idPermesso, decisione: "negato" });
    for (const idDomande of stato.domande) this.#o.pubblica(stato.idProgetto, { tipo: "domande-chiuse", idDomande, esito: "annullate" });
    for (const idAzione of stato.azioniMostrate) this.#o.pubblica(stato.idProgetto, { tipo: "azione-conclusa", idAzione, esito: "L'incarico è finito prima di quest'azione.", errore: true });

    const tipo: MisuraIncarico["esito"] = stato.scaduto ? "scaduto" : esito.interrotto === true ? "interrotto" : esito.riuscito ? "riuscito" : "non-riuscito";
    const nome = stato.modelloVero !== undefined && stato.modelloVero !== stato.impostazioni.modello ? `${stato.nome}, cioè ${stato.modelloVero}` : stato.nome;
    const file = [...stato.file.entries()].map(([percorso, comeStato]) => (comeStato === "cambiato" ? percorso : `${percorso} (${comeStato})`));
    const token = esito.token === undefined ? undefined : `${IN_MIGLIAIA.format(esito.token.ingresso)} in ingresso, ${IN_MIGLIAIA.format(esito.token.uscita)} in uscita`;
    const comeFinito =
      tipo === "riuscito"
        ? "concluso"
        : tipo === "interrotto"
          ? "fermato dal proprietario"
          : tipo === "scaduto"
            ? `fermato dopo ${durataInParole(this.#o.durataMassimaMs ?? DURATA_INCARICO_MASSIMA_MS)}, il tempo massimo`
            : "finito con un errore";

    stato.attivita = {
      ...stato.attivita,
      stato: tipo === "riuscito" ? "finita" : tipo === "non-riuscito" ? "fallita" : "fermata",
      durataMs: esito.durataMs,
      strumentiUsati: stato.azioni,
      riassunto: `${comeFinito[0]?.toUpperCase()}${comeFinito.slice(1)} da ${nome} in ${durataInParole(esito.durataMs)}${token === undefined ? "" : `; token: ${token}`}.`,
    };
    const { ultimoStrumento: _, ...finita } = stato.attivita;
    const finiti = [...(this.#finiti.get(stato.idProgetto) ?? []), finita];
    for (const tolta of finiti.splice(0, Math.max(0, finiti.length - ATTIVITA_FINITE_TENUTE))) this.#uscite.delete(tolta.id);
    this.#finiti.set(stato.idProgetto, finiti);
    this.#uscite.set(finita.id, stato.trascrizione.join("\n\n"));
    this.#o.attivitaCambiate(stato.idProgetto);

    const misura: MisuraIncarico = {
      quando: new Date().toISOString(),
      idProgetto: stato.idProgetto,
      idIncarico: stato.id,
      ...(stato.impostazioni.motore === undefined ? {} : { motore: stato.impostazioni.motore }),
      ...(stato.impostazioni.modello === undefined ? {} : { modello: stato.impostazioni.modello }),
      ...(stato.modelloVero === undefined ? {} : { modelloVero: stato.modelloVero }),
      ...(stato.impostazioni.impegno === undefined ? {} : { impegno: stato.impostazioni.impegno }),
      esito: tipo,
      durataMs: esito.durataMs,
      ...(esito.token === undefined ? {} : { token: esito.token }),
      azioni: stato.azioni,
      file: stato.file.size + stato.altriFile,
      ...(stato.vramPiccoMb === undefined ? {} : { vramPiccoMb: stato.vramPiccoMb }),
    };
    void this.#registra(misura);

    const resoconto = stato.ultimoTesto?.trim();
    const righe = [
      `Incarico ${comeFinito} da ${nome} in ${durataInParole(esito.durataMs)}, con ${stato.azioni === 1 ? "un'azione" : `${stato.azioni} azioni`}.`,
      ...(token === undefined ? [] : [`Token: ${token}.`]),
      ...(stato.vramPiccoMb === undefined ? [] : [`Scheda video: picco di ${IN_MIGLIAIA.format(stato.vramPiccoMb)} MB occupati.`]),
      file.length === 0 && stato.altriFile === 0
        ? "File cambiati: nessuno riferito."
        : `File cambiati: ${file.join(", ")}${stato.altriFile > 0 ? `${file.length > 0 ? ", e " : ""}${stato.altriFile} senza versione` : ""}.`,
      ...(esito.errore === undefined ? [] : [`Errore: ${esito.errore}`]),
      ...(stato.ultimoErrore === undefined || stato.ultimoErrore === esito.errore ? [] : [`Ultimo errore riferito: ${stato.ultimoErrore}`]),
      "",
      resoconto === undefined || resoconto === ""
        ? "Chi implementa non ha scritto un resoconto."
        : `Resoconto di chi implementa:\n${resoconto.length > RESOCONTO_MASSIMO ? `${resoconto.slice(0, RESOCONTO_MASSIMO)}\n… [tagliato]` : resoconto}`,
      "",
      "Controlla tu il lavoro (il diff, le prove) prima di dirlo fatto.",
    ];
    return { testo: righe.join("\n"), ...(tipo === "riuscito" ? {} : { errore: true as const }) };
  }

  async #registra(misura: MisuraIncarico): Promise<void> {
    if (this.#o.registro === undefined) return;
    try {
      await mkdir(dirname(this.#o.registro), { recursive: true });
      await appendFile(this.#o.registro, `${JSON.stringify(misura)}\n`);
    } catch {
      // Le misure servono ai confronti: se non si scrivono, l'incarico vale lo stesso.
    }
  }
}

/** Il nome di uno strumento senza il prefisso dei server MCP. */
function nomeBreve(strumento: string): string {
  return strumento.replace(/^mcp__[^_]+(?:_[^_]+)*?__/, "");
}

function primaRiga(testo: string): string {
  const riga = testo.split("\n").find((una) => una.trim() !== "")?.trim() ?? "Incarico";
  return riga.length > 140 ? `${riga.slice(0, 139)}…` : riga;
}

function tagliaUscita(testo: string): UscitaAttivita {
  return testo.length > USCITA_MOSTRATA ? { testo: testo.slice(-USCITA_MOSTRATA), troncata: true } : { testo, troncata: false };
}
