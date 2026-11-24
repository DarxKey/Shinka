/** L'elenco dei progetti al centro: dove vive ciascuno e da dove riprende la sua conversazione. */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { leggiImpostazioni, type ImpostazioniConversazione } from "../protocollo/impostazioni.ts";
import { leggiAvvio, type AvvioApplicazione } from "../protocollo/applicazioni.ts";
import { leggiEstensioniScelte } from "../protocollo/avvio-progetto.ts";
import type { CartellaCollegata, Progetto } from "../protocollo/progetti.ts";
import { leggiChiImplementa, type ChiImplementa } from "../protocollo/incarichi.ts";

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

  idSessione(idProgetto: string): string | undefined {
    return this.#progetti.get(idProgetto)?.idSessione;
  }

  /** Ricorda da dove riprendere la conversazione; una stringa vuota lo fa dimenticare. */
  async ricordaSessione(idProgetto: string, idSessione: string): Promise<void> {
    const progetto = this.#progetti.get(idProgetto);
    if (progetto === undefined) return;
    if (idSessione === "") delete progetto.idSessione;
    else progetto.idSessione = idSessione;
    await this.#salva();
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
