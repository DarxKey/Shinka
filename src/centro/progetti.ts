/** L'elenco dei progetti al centro: dove vive ciascuno e da dove riprende la sua conversazione. */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { leggiImpostazioni, type ImpostazioniConversazione } from "../protocollo/impostazioni.ts";
import { leggiAvvio, type AvvioApplicazione } from "../protocollo/applicazioni.ts";
import { leggiEstensioniScelte } from "../protocollo/avvio-progetto.ts";
import type { CartellaCollegata, Progetto } from "../protocollo/progetti.ts";
import type { ProgettoNatoOffline } from "../protocollo/offline.ts";
import { leggiChiImplementa, progettoDellaConversazione, type ChiImplementa } from "../protocollo/incarichi.ts";
import { eNumeroDiChatParallela, numeroDellaChat, primoNumeroLibero, CHAT_PRINCIPALE } from "../protocollo/chat-parallele.ts";

interface ProgettoSalvato extends Progetto {
  /** Identificativo da cui l'harness riprende la conversazione del progetto. */
  idSessione?: string;
  /** Modello, impegno e permessi scelti dal proprietario; se mancano valgono quelli di un progetto nuovo. */
  impostazioni?: ImpostazioniConversazione;
  /** Le estensioni scelte nella scheda, tra quelle accese nell'ambiente; se mancano le ha tutte. */
  estensioni?: string[];
  /** Come si avvia l'applicazione del progetto, e se il proprietario la vuole accesa. */
  applicazione?: AvvioApplicazione & { voluta?: boolean };
  /** Le cartelle di altri ambienti in cui il progetto lavora anche (ADR 0050). */
  collegate?: CartellaCollegata[];
  /** Chi implementa gli incarichi del progetto, se il proprietario lo ha scelto (ADR 0051). */
  chiImplementa?: ChiImplementa;
  /** Le chat parallele aperte (ADR 0052), ciascuna con il punto da cui riprende la sua conversazione. */
  chat?: ChatSalvata[];
  /** Fin dove il centro ha preso l'archivio offline del progetto, per versione (ADR 0056). */
  offline?: { versione: string; fino: number };
}

interface ChatSalvata {
  numero: number;
  idSessione?: string;
}

/** L'applicazione di un progetto per come la ricorda il registro. */
export interface ApplicazioneRicordata {
  avvio?: AvvioApplicazione;
  /** Vero se il proprietario, o un agente per lui, l'ha avviata e non l'ha fermata: dopo un riavvio va rilanciata. */
  voluta: boolean;
}

export interface NuovoProgetto {
  nome: string;
  cartella: string;
  idAmbiente: string;
  brief: string;
  /** Vero per il progetto in cui si sviluppa Shinka stessa: ce n'è uno solo. */
  diShinka?: true;
  /** Le estensioni scelte per il progetto; senza, ha tutte quelle accese nel suo ambiente. */
  estensioni?: string[];
}

export class RegistroProgetti {
  readonly #file: string;
  readonly #progetti: Map<string, ProgettoSalvato>;
  readonly #ascoltatori = new Set<() => void>();

  private constructor(file: string, progetti: ProgettoSalvato[]) {
    this.#file = file;
    this.#progetti = new Map(progetti.map((progetto) => [progetto.id, progetto]));
    // Delle chat parallele restano quelle con un numero valido, una per numero.
    for (const progetto of this.#progetti.values()) {
      if (progetto.chat === undefined) continue;
      const valide = Array.isArray(progetto.chat) ? progetto.chat.filter((chat) => eNumeroDiChatParallela(chat?.numero)) : [];
      const uniche = valide.filter((chat, posto) => valide.findIndex((altra) => altra.numero === chat.numero) === posto);
      if (uniche.length === 0) delete progetto.chat;
      else progetto.chat = uniche;
    }
  }

  static async apri(file: string): Promise<RegistroProgetti> {
    await mkdir(dirname(file), { recursive: true });
    return new RegistroProgetti(file, leggi(file));
  }

  /** Tutti i progetti, dal più recente. */
  elenco(): Progetto[] {
    return [...this.#progetti.values()]
      .map(soloProgetto)
      .sort((a, b) => b.creatoIl.localeCompare(a.creatoIl));
  }

  trova(id: string): Progetto | undefined {
    const progetto = this.#progetti.get(id);
    return progetto === undefined ? undefined : soloProgetto(progetto);
  }

  async crea(nuovo: NuovoProgetto, ora: number = Date.now()): Promise<Progetto> {
    const progetto: ProgettoSalvato = {
      id: randomUUID(),
      nome: nuovo.nome,
      cartella: nuovo.cartella,
      idAmbiente: nuovo.idAmbiente,
      brief: nuovo.brief,
      creatoIl: new Date(ora).toISOString(),
      ...(nuovo.diShinka === true ? { diShinka: true as const } : {}),
      ...(nuovo.estensioni === undefined ? {} : { estensioni: [...nuovo.estensioni] }),
    };
    this.#progetti.set(progetto.id, progetto);
    await this.#salva();
    this.#avvisa();
    return soloProgetto(progetto);
  }

  /**
   * Registra un progetto nato offline in un ambiente (ADR 0056): con l'identificativo, la cartella e
   * la data che ha avuto là. Se c'è già, resta com'è.
   */
  async adottaNatoOffline(nato: ProgettoNatoOffline, idAmbiente: string): Promise<Progetto> {
    const esistente = this.#progetti.get(nato.id);
    if (esistente !== undefined) return soloProgetto(esistente);
    const progetto: ProgettoSalvato = {
      id: nato.id,
      nome: nato.nome,
      cartella: nato.cartella,
      idAmbiente,
      brief: nato.brief,
      creatoIl: nato.creatoIl,
      impostazioni: nato.impostazioni,
    };
    this.#progetti.set(progetto.id, progetto);
    await this.#salva();
    this.#avvisa();
    return soloProgetto(progetto);
  }

  /** Fin dove il centro ha preso l'archivio offline di un progetto, se quella versione è quella che ha preso. */
  offlinePreso(idProgetto: string, versione: string): number {
    const preso = this.#progetti.get(idProgetto)?.offline;
    return preso?.versione === versione ? preso.fino : 0;
  }

  async ricordaOfflinePreso(idProgetto: string, versione: string, fino: number): Promise<void> {
    const progetto = this.#progetti.get(idProgetto);
    if (progetto === undefined) return;
    progetto.offline = { versione, fino };
    await this.#salva();
  }

  /** Da dove riprende una conversazione del progetto: la principale o una chat parallela. */
  idSessione(idConversazione: string): string | undefined {
    const progetto = this.#progetti.get(progettoDellaConversazione(idConversazione));
    const numero = numeroDellaChat(idConversazione);
    if (numero === CHAT_PRINCIPALE) return progetto?.idSessione;
    return progetto?.chat?.find((chat) => chat.numero === numero)?.idSessione;
  }

  /** Ricorda da dove riprendere una conversazione del progetto; una stringa vuota lo fa dimenticare. */
  async ricordaSessione(idConversazione: string, idSessione: string): Promise<void> {
    const progetto = this.#progetti.get(progettoDellaConversazione(idConversazione));
    if (progetto === undefined) return;
    const numero = numeroDellaChat(idConversazione);
    const dove: { idSessione?: string } | undefined =
      numero === CHAT_PRINCIPALE ? progetto : progetto.chat?.find((chat) => chat.numero === numero);
    if (dove === undefined) return;
    if (idSessione === "") delete dove.idSessione;
    else dove.idSessione = idSessione;
    await this.#salva();
  }

  /** I numeri delle chat parallele aperte nel progetto, in ordine. */
  chatParallele(idProgetto: string): number[] {
    return (this.#progetti.get(idProgetto)?.chat ?? []).map((chat) => chat.numero).sort((a, b) => a - b);
  }

  /** Apre una chat parallela e ne restituisce il numero; nulla se il progetto non c'è o le chat sono già tutte aperte. */
  async apriChat(idProgetto: string): Promise<number | undefined> {
    const progetto = this.#progetti.get(idProgetto);
    if (progetto === undefined) return undefined;
    const numero = primoNumeroLibero(this.chatParallele(idProgetto));
    if (numero === undefined) return undefined;
    progetto.chat = [...(progetto.chat ?? []), { numero }];
    await this.#salva();
    this.#avvisa();
    return numero;
  }

  /** Dimentica una chat parallela. Falso se non c'era. */
  async chiudiChat(idProgetto: string, numero: number): Promise<boolean> {
    const progetto = this.#progetti.get(idProgetto);
    if (progetto?.chat?.some((chat) => chat.numero === numero) !== true) return false;
    progetto.chat = progetto.chat.filter((chat) => chat.numero !== numero);
    if (progetto.chat.length === 0) delete progetto.chat;
    await this.#salva();
    this.#avvisa();
    return true;
  }

  /** Le estensioni scelte per il progetto; nulla se ha tutte quelle accese nel suo ambiente. */
  estensioni(idProgetto: string): string[] | undefined {
    return leggiEstensioniScelte(this.#progetti.get(idProgetto)?.estensioni);
  }

  /** Ricorda le estensioni scelte per il progetto; nulla perché abbia tutte quelle accese nel suo ambiente. */
  async ricordaEstensioni(idProgetto: string, scelte: readonly string[] | undefined): Promise<boolean> {
    const progetto = this.#progetti.get(idProgetto);
    if (progetto === undefined) return false;
    if (scelte === undefined) delete progetto.estensioni;
    else progetto.estensioni = [...new Set(scelte)];
    await this.#salva();
    return true;
  }

  /** Come si avvia l'applicazione del progetto, e se è voluta accesa. */
  applicazione(idProgetto: string): ApplicazioneRicordata {
    const salvata = this.#progetti.get(idProgetto)?.applicazione;
    const avvio = leggiAvvio(salvata);
    return { ...(avvio === undefined ? {} : { avvio }), voluta: avvio !== undefined && salvata?.voluta === true };
  }

  /** Ricorda come si avvia l'applicazione; senza, la dimentica, e con lei la voglia di tenerla accesa. */
  async ricordaAvvio(idProgetto: string, avvio: AvvioApplicazione | undefined): Promise<void> {
    const progetto = this.#progetti.get(idProgetto);
    if (progetto === undefined) return;
    if (avvio === undefined) delete progetto.applicazione;
    else progetto.applicazione = { ...avvio, ...(progetto.applicazione?.voluta === true ? { voluta: true } : {}) };
    await this.#salva();
  }

  /** Ricorda se l'applicazione è voluta accesa. */
  async ricordaVoluta(idProgetto: string, voluta: boolean): Promise<void> {
    const applicazione = this.#progetti.get(idProgetto)?.applicazione;
    if (applicazione === undefined || (applicazione.voluta === true) === voluta) return;
    if (voluta) applicazione.voluta = true;
    else delete applicazione.voluta;
    await this.#salva();
  }

  /** Le impostazioni scelte per il progetto; nulla se il proprietario non le ha mai toccate. */
  impostazioni(idProgetto: string): ImpostazioniConversazione | undefined {
    return leggiImpostazioni(this.#progetti.get(idProgetto)?.impostazioni);
  }

  async ricordaImpostazioni(idProgetto: string, impostazioni: ImpostazioniConversazione): Promise<void> {
    const progetto = this.#progetti.get(idProgetto);
    if (progetto === undefined) return;
    progetto.impostazioni = impostazioni;
    await this.#salva();
  }

  /** Avvisa quando l'elenco cambia. */
  /** Cambia il nome di un progetto: la cartella resta com'è. Falso se il progetto non c'è. */
  async rinomina(idProgetto: string, nome: string): Promise<boolean> {
    const progetto = this.#progetti.get(idProgetto);
    if (progetto === undefined) return false;
    progetto.nome = nome;
    await this.#salva();
    this.#avvisa();
    return true;
  }

  /** Tiene il progetto in cima alla barra laterale, o lo rimette al suo posto. */
  async fissa(idProgetto: string, fissato: boolean): Promise<boolean> {
    const progetto = this.#progetti.get(idProgetto);
    if (progetto === undefined) return false;
    if (fissato) progetto.fissato = true;
    else delete progetto.fissato;
    await this.#salva();
    this.#avvisa();
    return true;
  }

  /** Le cartelle di altri ambienti collegate al progetto. */
  collegate(idProgetto: string): CartellaCollegata[] {
    return (this.#progetti.get(idProgetto)?.collegate ?? []).map((voce) => ({ ...voce }));
  }

  /** Ricorda le cartelle collegate al progetto. Falso se il progetto non c'è. */
  async ricordaCollegate(idProgetto: string, collegate: readonly CartellaCollegata[]): Promise<boolean> {
    const progetto = this.#progetti.get(idProgetto);
    if (progetto === undefined) return false;
    if (collegate.length === 0) delete progetto.collegate;
    else progetto.collegate = collegate.map((voce) => ({ idAmbiente: voce.idAmbiente, cartella: voce.cartella }));
    await this.#salva();
    return true;
  }

  /** Chi implementa gli incarichi del progetto; nulla se il proprietario non lo ha scelto. */
  chiImplementa(idProgetto: string): ChiImplementa | undefined {
    const salvato = this.#progetti.get(idProgetto)?.chiImplementa;
    return salvato === undefined ? undefined : leggiChiImplementa(salvato);
  }

  /** Ricorda chi implementa, o con nulla che non c'è più nessuno. Falso se il progetto non c'è. */
  async ricordaChiImplementa(idProgetto: string, scelta: ChiImplementa | undefined): Promise<boolean> {
    const progetto = this.#progetti.get(idProgetto);
    if (progetto === undefined) return false;
    if (scelta === undefined) delete progetto.chiImplementa;
    else progetto.chiImplementa = { ...scelta };
    await this.#salva();
    return true;
  }

  /** Toglie il progetto dal registro. La sua cartella non si tocca. */
  async togli(idProgetto: string): Promise<boolean> {
    if (!this.#progetti.delete(idProgetto)) return false;
    await this.#salva();
    this.#avvisa();
    return true;
  }

  iscrivi(ascoltatore: () => void): () => void {
    this.#ascoltatori.add(ascoltatore);
    return () => this.#ascoltatori.delete(ascoltatore);
  }

  #avvisa(): void {
    for (const ascoltatore of this.#ascoltatori) ascoltatore();
  }

  /** Le scritture si fanno una alla volta: due insieme si contenderebbero il file provvisorio. */
  #scritture: Promise<void> = Promise.resolve();

  #salva(): Promise<void> {
    const scrittura = this.#scritture.then(() => this.#scrivi());
    this.#scritture = scrittura.catch(() => {});
    return scrittura;
  }

  async #scrivi(): Promise<void> {
    const provvisorio = `${this.#file}.tmp`;
    await writeFile(provvisorio, JSON.stringify([...this.#progetti.values()], null, 2));
    await rename(provvisorio, this.#file);
  }
}

function soloProgetto(salvato: ProgettoSalvato): Progetto {
  return {
    id: salvato.id,
    nome: salvato.nome,
    cartella: salvato.cartella,
    idAmbiente: salvato.idAmbiente,
    creatoIl: salvato.creatoIl,
    brief: salvato.brief,
    ...(salvato.diShinka === true ? { diShinka: true as const } : {}),
    ...(salvato.fissato === true ? { fissato: true as const } : {}),
  };
}

function leggi(file: string): ProgettoSalvato[] {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as ProgettoSalvato[];
  } catch (errore) {
    if (errore instanceof Error && "code" in errore && errore.code === "ENOENT") return [];
    throw errore;
  }
}
