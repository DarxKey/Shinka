/**
 * Le proposte che aspettano il proprietario, ricordate su disco: di progetto, di sviluppo, di
 * estensione e dell'interfaccia. Senza questo un riavvio del centro (per esempio dopo
 * un'installazione) le perdeva, e la scheda restava senza pulsanti. Di ciascuna si ricorda che cosa
 * propone e in quale conversazione è nata, perché lì va la decisione: un argomento della Home (anche
 * di una chat parallela) o una conversazione di un progetto.
 */

import { readFileSync, renameSync, writeFileSync } from "node:fs";
import type { Canale } from "./canale.ts";

export type GenereDiProposta = "progetto" | "sviluppo" | "estensione" | "interfaccia";

/** Dove è nata una proposta. */
export type DoveDellaProposta = { tipo: "home"; idArgomento: string } | { tipo: "progetto"; idConversazione: string };

interface Ricordata {
  genere: GenereDiProposta;
  id: string;
  dati: unknown;
  dove: DoveDellaProposta;
  quando: string;
}

/** Come si passa da un archivio aperto al suo posto, e viceversa: lo sanno la Home e i lavori dei progetti. */
export interface PostiDegliArchivi {
  dove(canale: Canale): DoveDellaProposta | undefined;
  canale(dove: DoveDellaProposta): Promise<Canale | undefined>;
}

export class ProposteRicordate {
  readonly #file: string;
  #ricordate: Ricordata[];
  #posti: PostiDegliArchivi | undefined;

  private constructor(file: string, ricordate: Ricordata[]) {
    this.#file = file;
    this.#ricordate = ricordate;
  }

  static apri(file: string): ProposteRicordate {
    let ricordate: Ricordata[] = [];
    try {
      const letto = JSON.parse(readFileSync(file, "utf8")) as unknown;
      if (Array.isArray(letto)) ricordate = letto.filter((una): una is Ricordata => typeof una === "object" && una !== null && typeof (una as Ricordata).id === "string");
    } catch {
      ricordate = [];
    }
    return new ProposteRicordate(file, ricordate);
  }

  /** Da qui si sa dove stanno gli archivi: va detto quando Home e progetti sono aperti. */
  collega(posti: PostiDegliArchivi): void {
    this.#posti = posti;
  }

  /** Una proposta nuova, nata nella conversazione di questo archivio. Se non si sa dove sta, vale solo fino al prossimo riavvio. */
  ricorda(genere: GenereDiProposta, id: string, dati: unknown, canale: Canale): void {
    const dove = this.#posti?.dove(canale);
    if (dove === undefined) return;
    this.#ricordate = [...this.#ricordate.filter((una) => una.id !== id), { genere, id, dati, dove, quando: new Date().toISOString() }];
    this.#salva();
  }

  /** La proposta è stata decisa: non c'è più da ricordarla. */
  dimentica(id: string): void {
    const prima = this.#ricordate.length;
    this.#ricordate = this.#ricordate.filter((una) => una.id !== id);
    if (this.#ricordate.length !== prima) this.#salva();
  }

  /**
   * Le proposte di un genere che aspettavano prima del riavvio, con l'archivio in cui stanno. Quelle
   * il cui archivio non c'è più (un argomento eliminato, un progetto tolto) si dimenticano.
   */
  async ripristina<T>(genere: GenereDiProposta): Promise<{ id: string; dati: T; canale: Canale }[]> {
    const ripristinate: { id: string; dati: T; canale: Canale }[] = [];
    for (const una of this.#ricordate.filter((ricordata) => ricordata.genere === genere)) {
      const canale = await this.#posti?.canale(una.dove).catch(() => undefined);
      if (canale === undefined) this.dimentica(una.id);
      else ripristinate.push({ id: una.id, dati: una.dati as T, canale });
    }
    return ripristinate;
  }

  #salva(): void {
    const temporaneo = `${this.#file}.tmp`;
    writeFileSync(temporaneo, `${JSON.stringify(this.#ricordate, null, 2)}\n`);
    renameSync(temporaneo, this.#file);
  }
}

/** I posti degli archivi come li sanno la Home (i suoi argomenti, anche delle chat parallele) e i progetti. */
export function postiDegliArchivi(
  home: () => { argomentoDelCanale(canale: Canale): string | undefined; canaleDi(idArgomento: string): Promise<Canale | undefined> },
  lavori: { conversazioneDelCanale(canale: Canale): string | undefined; canale(idConversazione: string): Canale | undefined },
): PostiDegliArchivi {
  return {
    dove: (canale) => {
      const idArgomento = home().argomentoDelCanale(canale);
      if (idArgomento !== undefined) return { tipo: "home", idArgomento };
      const idConversazione = lavori.conversazioneDelCanale(canale);
      return idConversazione === undefined ? undefined : { tipo: "progetto", idConversazione };
    },
    canale: async (dove) => (dove.tipo === "home" ? await home().canaleDi(dove.idArgomento) : lavori.canale(dove.idConversazione)),
  };
}
