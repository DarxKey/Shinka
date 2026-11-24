/**
 * Le estensioni dell'interfaccia al centro (ADR 0054): l'elenco, con il tema e le pagine per intero,
 * le proposte che aspettano il proprietario, e chi va avvisato quando qualcosa cambia.
 */

import type { ProposteRicordate } from "./proposte-ricordate.ts";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { EstensioneInterfaccia, RichiestaInterfaccia, StatoInterfaccia } from "../protocollo/interfaccia.ts";
import type { Canale } from "./canale.ts";

/** Un'estensione com'è salvata: con l'HTML di ogni pagina. */
interface Custodita extends EstensioneInterfaccia {
  html: Record<string, string>;
}

interface Proposta {
  richiesta: RichiestaInterfaccia;
  canale: Canale;
}

export interface OpzioniInterfaccia {
  file: string;
  /** Una nota alla conversazione della Home in cui la proposta è nata, senza farla rispondere. */
  annota?(testo: string, canale: Canale): void;
  adesso?(): Date;
  /** Dove le proposte in attesa restano scritte, perché un riavvio del centro non le perda. */
  ricordate?: ProposteRicordate;
}

export class EstensioniInterfaccia {
  readonly #o: OpzioniInterfaccia;
  #estensioni: Custodita[];
  readonly #proposte = new Map<string, Proposta>();
  readonly #ascoltatori = new Set<(stato: StatoInterfaccia) => void>();
  #scritture: Promise<void> = Promise.resolve();

  private constructor(opzioni: OpzioniInterfaccia, estensioni: Custodita[]) {
    this.#o = opzioni;
    this.#estensioni = estensioni;
  }

  static async apri(opzioni: OpzioniInterfaccia): Promise<EstensioniInterfaccia> {
    let estensioni: Custodita[] = [];
    if (existsSync(opzioni.file)) {
      const letto = JSON.parse(await readFile(opzioni.file, "utf8")) as { estensioni?: Custodita[] };
      estensioni = Array.isArray(letto.estensioni) ? letto.estensioni : [];
    }
    return new EstensioniInterfaccia(opzioni, estensioni);
  }

  /** L'elenco come lo vede l'interfaccia: il tema per intero, le pagine senza il loro HTML. */
  stato(): StatoInterfaccia {
    return { estensioni: this.#estensioni.map(({ html: _html, ...resto }) => resto) };
  }

  /** Collega un ascoltatore: riceve subito lo stato, poi ogni cambiamento. */
  iscrivi(ascoltatore: (stato: StatoInterfaccia) => void): () => void {
    ascoltatore(this.stato());
    this.#ascoltatori.add(ascoltatore);
    return () => this.#ascoltatori.delete(ascoltatore);
  }

  /** L'HTML di una pagina di un'estensione accesa; nulla se non c'è. */
  pagina(id: string, idPagina: string): string | undefined {
    const estensione = this.#estensioni.find((una) => una.id === id);
    return estensione?.accesa === true ? estensione.html[idPagina] : undefined;
  }

  /** L'HTML di una pagina di una proposta in attesa, per l'anteprima dalla scheda. */
  paginaProposta(idProposta: string, idPagina: string): string | undefined {
    return this.#proposte.get(idProposta)?.richiesta.pagine.find((pagina) => pagina.id === idPagina)?.html;
  }

  /** La Home propone un'estensione: compare la scheda nella sua conversazione, e nient'altro. */
  /** Dopo un riavvio del centro: tornano le proposte che aspettavano il proprietario. */
  async ripristina(): Promise<void> {
    for (const { id, dati, canale } of (await this.#o.ricordate?.ripristina<RichiestaInterfaccia>("interfaccia")) ?? []) this.#proposte.set(id, { richiesta: dati, canale });
  }

  proponi(richiesta: RichiestaInterfaccia, canale: Canale): string {
    const idProposta = randomUUID();
    this.#proposte.set(idProposta, { richiesta, canale });
    this.#o.ricordate?.ricorda("interfaccia", idProposta, richiesta, canale);
    canale.pubblica({
      tipo: "interfaccia-proposta",
      idProposta,
      nome: richiesta.nome,
      descrizione: richiesta.descrizione,
      ...(this.#estensioni.some((una) => una.nome === richiesta.nome) ? { sostituisce: true as const } : {}),
      ...(richiesta.tema === undefined ? {} : { righeTema: richiesta.tema.split("\n").length }),
      pagine: richiesta.pagine.map(({ id, titolo, dove }) => ({ id, titolo, dove })),
      pulsanti: richiesta.pulsanti,
    });
    return idProposta;
  }

  /** Il proprietario conferma: l'estensione entra accesa, al posto di quella con lo stesso nome. Falso se la proposta non c'è più. */
  async conferma(idProposta: string): Promise<boolean> {
    const proposta = this.#proposte.get(idProposta);
    if (proposta === undefined) return false;
    this.#proposte.delete(idProposta);
    this.#o.ricordate?.dimentica(idProposta);
    const { richiesta } = proposta;
    const prima = this.#estensioni.find((una) => una.nome === richiesta.nome);
    const nuova: Custodita = {
      id: prima?.id ?? randomUUID(),
      nome: richiesta.nome,
      descrizione: richiesta.descrizione,
      accesa: true,
      aggiunta: (this.#o.adesso?.() ?? new Date()).toISOString(),
      ...(richiesta.tema === undefined ? {} : { tema: richiesta.tema }),
      pagine: richiesta.pagine.map(({ id, titolo, dove }) => ({ id, titolo, dove })),
      pulsanti: richiesta.pulsanti,
      html: Object.fromEntries(richiesta.pagine.map((pagina) => [pagina.id, pagina.html])),
    };
    this.#estensioni = [...this.#estensioni.filter((una) => una !== prima), nuova];
    await this.#cambiato();
    proposta.canale.pubblica({ tipo: "interfaccia-decisa", idProposta, esito: "confermata" });
    this.#o.annota?.(
      `[Shinka] Il proprietario ha confermato l'estensione dell'interfaccia "${richiesta.nome}"${prima === undefined ? "" : ", al posto di quella di prima"}: è accesa, e la vede da subito.`,
      proposta.canale,
    );
    return true;
  }

  /** Il proprietario annulla. Falso se la proposta non c'è più. */
  annulla(idProposta: string): boolean {
    const proposta = this.#proposte.get(idProposta);
    if (proposta === undefined) return false;
    this.#proposte.delete(idProposta);
    this.#o.ricordate?.dimentica(idProposta);
    proposta.canale.pubblica({ tipo: "interfaccia-decisa", idProposta, esito: "annullata" });
    this.#o.annota?.(`[Shinka] Il proprietario ha annullato l'estensione dell'interfaccia "${proposta.richiesta.nome}": non è entrato nulla.`, proposta.canale);
    return true;
  }

  /** Accende o spegne un'estensione. Falso se non c'è. */
  async accendi(id: string, accesa: boolean): Promise<boolean> {
    if (!this.#estensioni.some((una) => una.id === id)) return false;
    this.#estensioni = this.#estensioni.map((una) => (una.id === id ? { ...una, accesa } : una));
    await this.#cambiato();
    return true;
  }

  /** La toglie dall'elenco. Falso se non c'era. */
  async togli(id: string): Promise<boolean> {
    if (!this.#estensioni.some((una) => una.id === id)) return false;
    this.#estensioni = this.#estensioni.filter((una) => una.id !== id);
    await this.#cambiato();
    return true;
  }

  async #cambiato(): Promise<void> {
    await this.#salva();
    const stato = this.stato();
    for (const ascoltatore of this.#ascoltatori) ascoltatore(stato);
  }

  #salva(): Promise<void> {
    const scrittura = this.#scritture.then(async () => {
      await mkdir(dirname(this.#o.file), { recursive: true });
      const provvisorio = `${this.#o.file}.tmp`;
      await writeFile(provvisorio, JSON.stringify({ estensioni: this.#estensioni }, null, 2), { mode: 0o600 });
      await rename(provvisorio, this.#o.file);
    });
    this.#scritture = scrittura.catch(() => {});
    return scrittura;
  }
}
