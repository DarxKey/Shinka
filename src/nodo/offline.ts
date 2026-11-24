/**
 * Il lavoro offline di un nodo (ADR 0056). Il centro gli dice quali progetti ha il suo ambiente e
 * come riprenderli; quando il centro non c'è, chi sta su questa macchina (Shinka Desktop, dallo
 * sportello) può lavorarci lo stesso. La conversazione la apre il nodo, e i suoi eventi vanno in un
 * archivio come quelli del centro. Quando il centro torna, il nodo gli consegna tutto, progetto per
 * progetto, e toglie ciò che il centro ha preso.
 */

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Canale } from "../centro/canale.ts";
import { fileDellaVersione } from "../centro/indice-archivio.ts";
import type { Allegato } from "../protocollo/allegati.ts";
import type { DecisionePermesso, EventoConversazione, PortaConversazione, RispostaAlleDomande } from "../protocollo/eventi.ts";
import { applicaModifica, type ImpostazioniConversazione, type ModificaImpostazioni, type Motore } from "../protocollo/impostazioni.ts";
import type { RiferitoDalNodo } from "../protocollo/nodi.ts";
import {
  ANNOTATO_OFFLINE,
  PEZZO_OFFLINE,
  SENZA_CENTRO,
  STRUMENTI_DA_ANNOTARE,
  type ProgettoAlloSportello,
  type ProgettoDelNodo,
  type StrumentoAnnotato,
} from "../protocollo/offline.ts";
import { nomeCartellaDa } from "../protocollo/progetti.ts";
import { FILE_SKILL, GRUPPO_SKILL, scomponiSkill } from "../protocollo/skill.ts";
import type { ChiamaStrumento, EsitoStrumento } from "../protocollo/strumenti.ts";
import { creaCartellaProgetto } from "./cartelle.ts";
import { IMPOSTAZIONI_DI_PROGETTO } from "./profili.ts";

/** Un progetto come lo tiene il nodo: quello che dice il centro, e se è nato qui senza centro. */
interface ProgettoTenuto extends ProgettoDelNodo {
  /** Nato offline: il centro non lo conosce finché non è consegnato. */
  nuovo?: true;
}

interface FileProgetti {
  progetti: ProgettoTenuto[];
  motorePredefinito?: Motore;
}

/** Come si apre la conversazione di un progetto: la sa aprire il lavoro del nodo, come per il centro. */
export type ApriPerOffline = (
  progetto: ProgettoDelNodo,
  motorePredefinito: Motore | undefined,
  alEvento: (evento: EventoConversazione) => void,
  alIdSessione: (idSessione: string) => void,
  chiama: ChiamaStrumento,
) => PortaConversazione;

export interface OpzioniOffline {
  /** La cartella tra i dati del nodo in cui sta tutto il lavoro offline. */
  cartella: string;
  /** Il nome dell'ambiente, per la nota nella storia del centro. */
  nome: string;
  radiceProgetti: string;
  apri: ApriPerOffline;
  /** Manda al centro: vale solo mentre il nodo è collegato. */
  riferisci(messaggio: RiferitoDalNodo): void;
  /** La copia delle skill di Shinka di questo ambiente, se c'è. */
  cartellaSkill?: string;
  /** Come nasce la cartella di un progetto nuovo. Nei test se ne mette una finta. */
  creaCartella?: (radice: string, nomeCartella: string, brief: string) => Promise<{ percorso: string }>;
}

/** Il progetto chiesto allo sportello non c'è, o non si può usare offline. */
export class ProgettoOfflineRifiutato extends Error {
  readonly stato: number;
  constructor(stato: number, messaggio: string) {
    super(messaggio);
    this.stato = stato;
  }
}

export class LavoroOffline {
  readonly #o: OpzioniOffline;
  #progetti: Map<string, ProgettoTenuto>;
  #motorePredefinito: Motore | undefined;
  #memoria: string | undefined;
  #annotati: StrumentoAnnotato[];
  readonly #canali = new Map<string, Canale>();
  readonly #conversazioni = new Map<string, PortaConversazione>();
  /** Vero mentre il nodo è collegato al centro. */
  #collegato = false;
  /** I progetti la cui consegna è partita, con il pezzo che aspetta conferma. */
  readonly #inConsegna = new Map<string, number>();
  /** La memoria è già stata detta alla conversazione offline di questo progetto. */
  readonly #memoriaDetta = new Set<string>();
  readonly #ascoltatori = new Set<() => void>();

  private constructor(opzioni: OpzioniOffline, file: FileProgetti, memoria: string | undefined, annotati: StrumentoAnnotato[]) {
    this.#o = opzioni;
    this.#progetti = new Map(file.progetti.map((progetto) => [progetto.id, progetto]));
    this.#motorePredefinito = file.motorePredefinito;
    this.#memoria = memoria;
    this.#annotati = annotati;
  }

  static async apri(opzioni: OpzioniOffline): Promise<LavoroOffline> {
    await mkdir(join(opzioni.cartella, "archivi"), { recursive: true });
    const file = leggiJson<FileProgetti>(join(opzioni.cartella, "progetti.json")) ?? { progetti: [] };
    const memoria = leggiJson<{ testo?: string }>(join(opzioni.cartella, "memoria.json"))?.testo;
    const annotati = leggiJson<{ strumenti: StrumentoAnnotato[] }>(join(opzioni.cartella, "annotati.json"))?.strumenti ?? [];
    const lavoro = new LavoroOffline(opzioni, { progetti: Array.isArray(file.progetti) ? file.progetti : [] }, memoria, Array.isArray(annotati) ? annotati : []);
    if (file.motorePredefinito !== undefined) lavoro.#motorePredefinito = file.motorePredefinito;
    // Gli archivi offline rimasti da un'altra volta: si riaprono, per mostrarli e per consegnarli.
    for (const nome of await readdir(join(opzioni.cartella, "archivi"))) {
      if (!nome.endsWith(".jsonl")) continue;
      const id = nome.slice(0, -".jsonl".length);
      if (!lavoro.#progetti.has(id)) continue;
      lavoro.#aggancia(id, await Canale.apri(join(opzioni.cartella, "archivi", nome)));
    }
    return lavoro;
  }

  /** Chiamata a ogni cambiamento che lo sportello deve sapere: un progetto nuovo, una conversazione che lavora o smette. */
  ascolta(ascoltatore: () => void): () => void {
    this.#ascoltatori.add(ascoltatore);
    return () => this.#ascoltatori.delete(ascoltatore);
  }

  #avvisa(): void {
    for (const ascoltatore of this.#ascoltatori) ascoltatore();
  }

  // --- Ciò che dice il centro ---

  /** Il centro ha mandato i progetti di questo ambiente, tutti: restano anche quelli nati offline e non ancora consegnati. */
  async progetti(elenco: readonly ProgettoDelNodo[], motorePredefinito: Motore | undefined): Promise<void> {
    const nuovi = new Map<string, ProgettoTenuto>();
    for (const progetto of elenco) nuovi.set(progetto.id, { ...progetto });
    for (const tenuto of this.#progetti.values()) {
      if (!this.#daConsegnare(tenuto.id)) continue;
      // Con lavoro offline da consegnare valgono la sessione e le impostazioni di qui, che sono più recenti;
      // un progetto nato offline, che il centro ancora non conosce, resta com'è.
      const dalCentro = nuovi.get(tenuto.id);
      nuovi.set(
        tenuto.id,
        dalCentro === undefined
          ? tenuto
          : { ...dalCentro, impostazioni: tenuto.impostazioni, ...(tenuto.idSessione === undefined ? {} : { idSessione: tenuto.idSessione }) },
      );
    }
    this.#progetti = nuovi;
    this.#motorePredefinito = motorePredefinito;
    await this.#salvaProgetti();
    this.#avvisa();
  }

  async memoria(testo: string | undefined): Promise<void> {
    this.#memoria = testo;
    this.#memoriaDetta.clear();
    await writeFile(join(this.#o.cartella, "memoria.json"), `${JSON.stringify(testo === undefined ? {} : { testo })}\n`);
  }

  /** Una conversazione aperta dal centro riprende ora da questa sessione: offline si riprende da qui. */
  async sessione(idConversazione: string, idSessione: string): Promise<void> {
    const progetto = this.#progetti.get(idConversazione);
    if (progetto === undefined || progetto.idSessione === idSessione) return;
    progetto.idSessione = idSessione;
    await this.#salvaProgetti();
  }

  /** Il nodo si è collegato al centro, o il collegamento è caduto. */
  collegato(collegato: boolean): void {
    this.#collegato = collegato;
    this.#inConsegna.clear();
    if (collegato) this.#consegnaTutto();
    this.#avvisa();
  }

  get eCollegato(): boolean {
    return this.#collegato;
  }

  /** I progetti con lavoro offline da consegnare: il nodo li dice nella presentazione. */
  daConsegnare(): string[] {
    return [...this.#progetti.keys()].filter((id) => this.#daConsegnare(id));
  }

  #daConsegnare(id: string): boolean {
    const canale = this.#canali.get(id);
    return (canale !== undefined && canale.indice.ultimo > 0) || this.#progetti.get(id)?.nuovo === true;
  }

  /** Vero se la conversazione offline di questo progetto è aperta: il centro non deve aprirne un'altra. */
  aperta(id: string): boolean {
    return this.#conversazioni.has(id);
  }

  /** Il centro ha preso gli eventi di un progetto fino a `fino`: si manda il resto, o si chiude. */
  async preso(idProgetto: string, versione: string, fino: number): Promise<void> {
    const canale = this.#canali.get(idProgetto);
    // Un progetto nato offline senza ancora eventi si consegna con un pezzo vuoto, senza versione.
    if ((canale?.indice.versione ?? "") !== versione) return;
    if (fino >= (canale?.indice.ultimo ?? 0)) {
      await this.#chiudiConsegnato(idProgetto);
      return;
    }
    // Se il centro non è andato avanti, rimandare lo stesso pezzo non serve: si riprova al prossimo collegamento.
    const mandato = this.#inConsegna.get(idProgetto);
    if (mandato !== undefined && fino <= mandato) {
      this.#inConsegna.delete(idProgetto);
      return;
    }
    this.#mandaPezzo(idProgetto, fino);
  }

  async annotatiPresi(id: readonly string[]): Promise<void> {
    const presi = new Set(id);
    this.#annotati = this.#annotati.filter((annotato) => !presi.has(annotato.id));
    await this.#salvaAnnotati();
  }

  #consegnaTutto(): void {
    if (this.#annotati.length > 0) this.#o.riferisci({ tipo: "offline-annotati", strumenti: this.#annotati });
    for (const id of this.daConsegnare()) this.#consegna(id);
  }

  /** Consegna un progetto, se la sua conversazione offline non lavora e non aspetta il proprietario. */
  #consegna(id: string): void {
    if (!this.#collegato || this.#inConsegna.has(id) || this.occupato(id)) return;
    const conversazione = this.#conversazioni.get(id);
    if (conversazione !== undefined) {
      conversazione.chiudi();
      this.#conversazioni.delete(id);
    }
    this.#mandaPezzo(id, 0);
  }

  #mandaPezzo(id: string, dopo: number): void {
    const progetto = this.#progetti.get(id);
    if (progetto === undefined) return;
    const canale = this.#canali.get(id);
    const eventi = canale?.archiviati.filter((archiviato) => archiviato.n > dopo).slice(0, PEZZO_OFFLINE) ?? [];
    this.#inConsegna.set(id, dopo);
    this.#o.riferisci({
      tipo: "offline-eventi",
      idProgetto: id,
      versione: canale?.indice.versione ?? "",
      eventi,
      ultimo: canale?.indice.ultimo ?? 0,
      ambiente: this.#o.nome,
      ...(progetto.nuovo === true
        ? { nuovo: { id, nome: progetto.nome, cartella: progetto.cartella, brief: progetto.brief, creatoIl: progetto.creatoIl, impostazioni: progetto.impostazioni } }
        : {}),
      ...(progetto.idSessione === undefined ? {} : { idSessione: progetto.idSessione }),
      impostazioni: progetto.impostazioni,
    });
  }

  async #chiudiConsegnato(id: string): Promise<void> {
    this.#inConsegna.delete(id);
    const canale = this.#canali.get(id);
    this.#canali.delete(id);
    this.#memoriaDetta.delete(id);
    if (canale !== undefined) {
      const file = join(this.#o.cartella, "archivi", `${id}.jsonl`);
      await rm(file, { force: true });
      await rm(fileDellaVersione(file), { force: true });
    }
    const progetto = this.#progetti.get(id);
    if (progetto?.nuovo === true) {
      delete progetto.nuovo;
      await this.#salvaProgetti();
    }
    this.#avvisa();
  }

  // --- Ciò che chiede lo sportello ---

  elenco(): ProgettoAlloSportello[] {
    return [...this.#progetti.values()]
      .sort((a, b) => b.creatoIl.localeCompare(a.creatoIl))
      .map((progetto) => {
        const canale = this.#canali.get(progetto.id);
        return {
          id: progetto.id,
          nome: progetto.nome,
          cartella: progetto.cartella,
          creatoIl: progetto.creatoIl,
          brief: progetto.brief,
          ...(progetto.nuovo === true ? { nuovo: true as const } : {}),
          occupato: this.occupato(progetto.id),
          ...(canale === undefined ? {} : { offline: { ultimo: canale.indice.ultimo, versione: canale.indice.versione } }),
        };
      });
  }

  /** Vero se la conversazione offline del progetto lavora o aspetta il proprietario. */
  occupato(id: string): boolean {
    const sospesi = this.#canali.get(id)?.sospesi;
    return sospesi !== undefined && (sospesi.turni > 0 || sospesi.permessi > 0);
  }

  /**
   * Lo sportello lavora solo senza centro; con il centro tornato, solo per finire ciò che un progetto
   * aveva cominciato offline (un turno in corso, un permesso che aspetta).
   */
  usabile(id: string): boolean {
    return !this.#collegato || this.occupato(id);
  }

  /** L'archivio offline di un progetto, aperto se serve. */
  async canale(id: string): Promise<Canale> {
    const progetto = this.#progetti.get(id);
    if (progetto === undefined) throw new ProgettoOfflineRifiutato(404, "Progetto non trovato in questo ambiente.");
    const aperto = this.#canali.get(id);
    if (aperto !== undefined) return aperto;
    const canale = await Canale.apri(join(this.#o.cartella, "archivi", `${id}.jsonl`));
    this.#aggancia(id, canale);
    canale.pubblica({ tipo: "impostazioni", impostazioni: progetto.impostazioni });
    return canale;
  }

  /** Tiene l'archivio offline di un progetto, e lo segue: quando il lavoro offline finisce, con il centro tornato si consegna. */
  #aggancia(id: string, canale: Canale): void {
    this.#canali.set(id, canale);
    canale.ascolta(({ evento }) => {
      if (evento.tipo === "turno-concluso" || evento.tipo === "turno-iniziato" || evento.tipo === "permesso-richiesto" || evento.tipo === "permesso-deciso") {
        this.#avvisa();
        if (this.#collegato && !this.occupato(id)) setImmediate(() => this.#consegna(id));
      }
    });
  }

  /** Il canale già aperto di un progetto, senza aprirne uno: per leggere un'azione. */
  canaleAperto(id: string): Canale | undefined {
    return this.#canali.get(id);
  }

  impostazioni(id: string): ImpostazioniConversazione | undefined {
    return this.#progetti.get(id)?.impostazioni;
  }

  async #conversazione(id: string): Promise<PortaConversazione> {
    if (!this.usabile(id)) throw new ProgettoOfflineRifiutato(409, "Il nodo è collegato al centro: passa da lì.");
    const progetto = this.#progetti.get(id);
    if (progetto === undefined) throw new ProgettoOfflineRifiutato(404, "Progetto non trovato in questo ambiente.");
    const aperta = this.#conversazioni.get(id);
    if (aperta !== undefined) return aperta;
    const canale = await this.canale(id);
    const porta = this.#o.apri(
      progetto,
      this.#motorePredefinito,
      // Le attività sono di chi guarda adesso: non entrano nella storia, come al centro.
      (evento) => canale.pubblica(evento),
      (idSessione) => {
        progetto.idSessione = idSessione;
        void this.#salvaProgetti();
      },
      this.chiama(id),
    );
    this.#conversazioni.set(id, porta);
    return porta;
  }

  async invia(id: string, testo: string, allegati: Allegato[] = []): Promise<void> {
    const porta = await this.#conversazione(id);
    // La memoria si dice una volta per conversazione offline, prima del primo messaggio: la sessione
    // ripresa può averne una più vecchia, e un progetto nato offline non ne ha.
    if (this.#memoria !== undefined && !this.#memoriaDetta.has(id)) {
      porta.annota(this.#memoria);
      this.#memoriaDetta.add(id);
    }
    porta.invia(testo, allegati);
  }

  decidiPermesso(id: string, idPermesso: string, decisione: DecisionePermesso, sempre: boolean): boolean {
    return this.#conversazioni.get(id)?.decidiPermesso(idPermesso, decisione, sempre) ?? false;
  }

  rispondiDomande(id: string, idDomande: string, risposta: RispostaAlleDomande): boolean {
    return this.#conversazioni.get(id)?.rispondiDomande?.(idDomande, risposta) ?? false;
  }

  async interrompi(id: string): Promise<void> {
    await this.#conversazioni.get(id)?.interrompi();
  }

  async cambiaImpostazioni(id: string, modifica: ModificaImpostazioni): Promise<ImpostazioniConversazione> {
    const progetto = this.#progetti.get(id);
    if (progetto === undefined) throw new ProgettoOfflineRifiutato(404, "Progetto non trovato in questo ambiente.");
    if (!this.usabile(id)) throw new ProgettoOfflineRifiutato(409, "Il nodo è collegato al centro: passa da lì.");
    progetto.impostazioni = applicaModifica(progetto.impostazioni, modifica);
    await this.#salvaProgetti();
    this.#conversazioni.get(id)?.imposta(progetto.impostazioni);
    (await this.canale(id)).pubblica({ tipo: "impostazioni", impostazioni: progetto.impostazioni });
    return progetto.impostazioni;
  }

  /** Fa nascere un progetto offline: la cartella nella radice dei progetti, e il primo messaggio con il brief. */
  async creaProgetto(nome: string, brief: string): Promise<ProgettoAlloSportello> {
    if (this.#collegato) throw new ProgettoOfflineRifiutato(409, "Il nodo è collegato al centro: il progetto si crea da lì.");
    const nomePulito = nome.trim();
    if (nomePulito === "" || nomePulito.length > 60) throw new ProgettoOfflineRifiutato(400, "Il nome del progetto deve avere da 1 a 60 caratteri.");
    if (brief.trim() === "") throw new ProgettoOfflineRifiutato(400, "Il brief del progetto è vuoto.");
    const crea = this.#o.creaCartella ?? ((radice: string, nomeCartella: string, testo: string) => creaCartellaProgetto(radice, nomeCartella, testo));
    let cartella: string;
    try {
      cartella = (await crea(this.#o.radiceProgetti, nomeCartellaDa(nomePulito), brief)).percorso;
    } catch (errore) {
      throw new ProgettoOfflineRifiutato(400, errore instanceof Error ? errore.message : String(errore));
    }
    const progetto: ProgettoTenuto = {
      id: randomUUID(),
      nome: nomePulito,
      cartella,
      brief: brief.trim(),
      creatoIl: new Date().toISOString(),
      impostazioni: IMPOSTAZIONI_DI_PROGETTO,
      nuovo: true,
    };
    this.#progetti.set(progetto.id, progetto);
    await this.#salvaProgetti();
    await this.invia(progetto.id, progetto.brief);
    this.#avvisa();
    const visto = this.elenco().find((uno) => uno.id === progetto.id);
    if (visto === undefined) throw new Error("Il progetto appena nato non c'è.");
    return visto;
  }

  // --- Gli strumenti di Shinka, offline ---

  /** Come una conversazione offline usa uno strumento di Shinka: leggere le skill, annotare memoria e skill, il resto no. */
  chiama(idConversazione: string): ChiamaStrumento {
    return async (nome, argomenti): Promise<EsitoStrumento> => {
      if (nome === "leggi_skill") return await this.#leggiSkill(argomenti);
      if (STRUMENTI_DA_ANNOTARE.includes(nome)) {
        this.#annotati.push({ id: randomUUID(), idConversazione, nome, argomenti, quando: new Date().toISOString() });
        await this.#salvaAnnotati();
        return { testo: ANNOTATO_OFFLINE };
      }
      return { testo: SENZA_CENTRO, errore: true };
    };
  }

  async #leggiSkill(argomenti: Record<string, unknown>): Promise<EsitoStrumento> {
    const cartella = this.#o.cartellaSkill;
    if (cartella === undefined) return { testo: SENZA_CENTRO, errore: true };
    const chiesto = typeof argomenti.nome === "string" ? argomenti.nome.trim().replace(new RegExp(`^${GRUPPO_SKILL}:`), "") : "";
    const leggi = async (nome: string): Promise<{ descrizione: string; contenuto: string } | undefined> => {
      try {
        return scomponiSkill(await readFile(join(cartella, "skills", nome, FILE_SKILL), "utf8"));
      } catch {
        return undefined;
      }
    };
    if (chiesto === "") {
      let nomi: string[] = [];
      try {
        nomi = (await readdir(join(cartella, "skills"))).sort();
      } catch {
        nomi = [];
      }
      const voci: string[] = [];
      for (const nome of nomi) {
        const skill = await leggi(nome);
        if (skill !== undefined) voci.push(`- ${nome}: ${skill.descrizione}`);
      }
      return { testo: voci.length === 0 ? "Non c'è ancora nessuna skill di Shinka." : voci.join("\n") };
    }
    if (!/^[a-z0-9-]{2,48}$/.test(chiesto)) return { testo: `Non esiste una skill di nome "${chiesto}".`, errore: true };
    const skill = await leggi(chiesto);
    if (skill === undefined) return { testo: `Non esiste una skill di nome "${chiesto}". Usa leggi_skill senza nome per l'elenco.`, errore: true };
    return { testo: `Skill "${chiesto}"\nDescrizione: ${skill.descrizione}\n\n${skill.contenuto}` };
  }

  /** Il nodo si spegne: le conversazioni offline si chiudono, gli archivi restano. */
  chiudiTutto(): void {
    for (const conversazione of this.#conversazioni.values()) conversazione.chiudi();
    this.#conversazioni.clear();
  }

  async #salvaProgetti(): Promise<void> {
    const file: FileProgetti = { progetti: [...this.#progetti.values()], ...(this.#motorePredefinito === undefined ? {} : { motorePredefinito: this.#motorePredefinito }) };
    await scriviSicuro(join(this.#o.cartella, "progetti.json"), file);
  }

  async #salvaAnnotati(): Promise<void> {
    await scriviSicuro(join(this.#o.cartella, "annotati.json"), { strumenti: this.#annotati });
  }
}

function leggiJson<T>(file: string): T | undefined {
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

/** Scrive un file JSON passando da uno temporaneo: uno spegnimento a metà non lascia un file rotto. */
async function scriviSicuro(file: string, dati: unknown): Promise<void> {
  const temporaneo = `${file}.${process.pid}.tmp`;
  await writeFile(temporaneo, `${JSON.stringify(dati, null, 2)}\n`);
  await rename(temporaneo, file);
}
