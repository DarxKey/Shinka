/**
 * Il canale di una conversazione al centro: archivia gli eventi e li distribuisce
 * in tempo reale a tutti i browser collegati.
 *
 * L'archivio è un file di righe JSON a cui si aggiunge in fondo. Gli eventi passeggeri, come i
 * frammenti di testo, non vengono archiviati: basta il testo intero che arriva alla fine. L'unico
 * modo di togliere qualcosa è `taglia`, che lascia la storia fino a un evento.
 *
 * Accanto all'archivio il canale tiene la sua versione (ADR 0046): resta la stessa finché si
 * aggiunge in fondo, cambia con un taglio o quando all'apertura i numeri vanno riassegnati.
 */

import { appendFileSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { analizzaArchivio, nuovaVersione, scriviIndice, sistemaArchivio, testoDellArchivio, type ArchivioLetto } from "./indice-archivio.ts";
import { storiaLeggera } from "./storia-leggera.ts";
import {
  daRicordare,
  passeggero,
  type EventoArchiviato,
  type EventoConversazione,
  type IndiceArchivio,
  type PezzoDiStoria,
} from "../protocollo/eventi.ts";

/** Quanti eventi al massimo in un pezzo di storia, se chi lo chiede non dice meno. */
export const PEZZO_MASSIMO = 1000;

type Ascoltatore = (evento: EventoArchiviato) => void;

/** Ciò che in una conversazione è cominciato e non si è ancora concluso. */
export interface Sospesi {
  turni: number;
  permessi: number;
}

export class Canale {
  readonly #file: string;
  readonly #archiviati: EventoArchiviato[];
  readonly #ascoltatori = new Set<Ascoltatore>();
  /** Testi che stanno ancora arrivando: servono a chi si collega a metà risposta. */
  readonly #testiInCorso = new Map<string, string>();
  readonly #testiAperti = new Set<string>();
  readonly #permessiAperti = new Set<string>();
  readonly #domandeAperte = new Set<string>();
  readonly #approvazioniAperte = new Set<string>();
  readonly #proposteAperte = new Set<string>();
  readonly #sviluppiAperti = new Set<string>();
  readonly #installazioniAperte = new Set<string>();
  readonly #estensioniAperte = new Set<string>();
  /** Gli eventi di cui conta solo l'ultimo, per tipo: chi si collega li riceve dopo la storia. */
  readonly #ricordati = new Map<string, EventoConversazione>();
  /** Quante pagine dell'interfaccia stanno seguendo questa conversazione. */
  #pagine = 0;
  #turniAperti = 0;
  /** Quando il proprietario ha scritto l'ultima volta in questa conversazione. */
  #ultimoMessaggioIl: string | undefined;
  #versione: string;
  /** Quanti byte ha l'archivio: il file della versione lo ricorda, per accorgersi di cambi fatti da altri. */
  #byte: number;

  private constructor(file: string, archiviati: EventoArchiviato[], versione: string, byte: number) {
    this.#file = file;
    this.#archiviati = archiviati;
    this.#versione = versione;
    this.#byte = byte;
    for (const { evento } of archiviati) this.#annota(evento);
    for (let i = archiviati.length - 1; i >= 0; i--) {
      if (archiviati[i]?.evento.tipo !== "messaggio-proprietario") continue;
      this.#ultimoMessaggioIl = archiviati[i]?.quando;
      break;
    }
  }

  /** Quando il proprietario ha scritto l'ultima volta in questa conversazione, se ha mai scritto. */
  get ultimoMessaggioIl(): string | undefined {
    return this.#ultimoMessaggioIl;
  }

  static async apri(file: string): Promise<Canale> {
    mkdirSync(dirname(file), { recursive: true });
    const letto = await leggiArchivio(file);
    // Dopo uno spegnimento brusco l'ultima riga può essere a metà, o una riga può mancare: l'archivio
    // si riscrive con i numeri giusti, così la prossima aggiunta non finisce attaccata a un pezzo, e
    // la versione cambia, perché chi ha una copia potrebbe avere numeri che non valgono più.
    const indice = sistemaArchivio(file, letto);
    const canale = new Canale(file, letto.archiviati, indice.versione, indice.byte);
    // All'apertura nessun processo sta lavorando: ciò che risultava in sospeso
    // al momento dello spegnimento va chiuso.
    canale.chiudiSospesi("Il centro è stato riavviato mentre Claude stava rispondendo.");
    return canale;
  }

  /** Riceve un evento dalla conversazione: lo archivia se serve e lo distribuisce. */
  readonly pubblica = (evento: EventoConversazione): void => {
    this.#pubblica(evento, new Date().toISOString());
  };

  /** Archivia un evento di un'altra conversazione, con il momento in cui era successo là. */
  riporta(archiviato: EventoArchiviato): void {
    this.#pubblica(archiviato.evento, archiviato.quando);
  }

  #pubblica(evento: EventoConversazione, quando: string): void {
    if (evento.tipo === "testo-iniziato") this.#testiInCorso.set(evento.idTesto, "");
    if (evento.tipo === "testo-concluso") this.#testiInCorso.delete(evento.idTesto);
    if (evento.tipo === "testo-frammento") {
      const finora = this.#testiInCorso.get(evento.idTesto) ?? "";
      this.#testiInCorso.set(evento.idTesto, finora + evento.frammento);
    }

    let archiviato: EventoArchiviato;
    if (daRicordare(evento)) {
      const prima = this.#ricordati.get(evento.tipo);
      // Lo stato arriva a pezzi: ciò che un pezzo non dice resta com'era.
      const ricordato: EventoConversazione =
        evento.tipo === "stato" && prima?.tipo === "stato"
          ? { tipo: "stato", stato: { ...prima.stato, ...evento.stato } }
          : evento;
      this.#ricordati.set(evento.tipo, ricordato);
      archiviato = { n: 0, quando, evento: ricordato };
    } else if (passeggero(evento)) {
      archiviato = { n: 0, quando, evento };
    } else {
      archiviato = { n: this.#archiviati.length + 1, quando, evento };
      this.#archiviati.push(archiviato);
      if (evento.tipo === "messaggio-proprietario") this.#ultimoMessaggioIl = quando;
      this.#annota(evento);
      const riga = `${JSON.stringify(archiviato)}\n`;
      appendFileSync(this.#file, riga);
      this.#byte += Buffer.byteLength(riga);
      this.#salvaIndice();
    }
    for (const ascoltatore of this.#ascoltatori) ascoltatore(archiviato);
  }

  /**
   * Toglie dalla storia l'evento numero `n` e tutti quelli dopo, e riscrive l'archivio. Serve
   * quando il messaggio che ha chiuso un argomento passa a quello successivo: lì ha la sua risposta,
   * e qui non deve restare. Chi segue il canale non ne riceve notizia: va fatto quando nessuno lo segue.
   */
  taglia(n: number): void {
    const resto = this.#archiviati.filter((archiviato) => archiviato.n < n);
    if (resto.length === this.#archiviati.length) return;
    const provvisorio = `${this.#file}.taglio`;
    const testo = testoDellArchivio(resto);
    writeFileSync(provvisorio, testo);
    renameSync(provvisorio, this.#file);
    this.#archiviati.length = 0;
    this.#archiviati.push(...resto);
    // Eventi già dati non ci sono più: chi ne ha una copia la deve buttare.
    this.#versione = nuovaVersione();
    this.#byte = Buffer.byteLength(testo);
    this.#salvaIndice();
    // Ciò che era aperto si ricalcola su ciò che resta.
    this.#testiInCorso.clear();
    for (const aperti of [this.#testiAperti, this.#permessiAperti, this.#domandeAperte, this.#approvazioniAperte, this.#proposteAperte, this.#sviluppiAperti, this.#installazioniAperte, this.#estensioniAperte]) {
      aperti.clear();
    }
    this.#turniAperti = 0;
    for (const { evento } of resto) this.#annota(evento);
  }

  /** Fin dove arriva l'archivio, e in quale versione. */
  get indice(): IndiceArchivio {
    return { ultimo: this.#archiviati.length, versione: this.#versione };
  }

  /**
   * Un pezzo della storia leggera, dopo l'evento `dopo`, per chi ne tiene una copia. Non ha effetti:
   * non conta come pagina che segue la conversazione. Con una `versione` che non è questa, o un
   * punto oltre la fine, il pezzo comincia dall'inizio e lo dice.
   */
  storiaDopo(richiesta: { dopo?: number; limite?: number; versione?: string }): PezzoDiStoria {
    const indice = this.indice;
    const dopo = Math.max(0, Math.floor(richiesta.dopo ?? 0));
    const daCapo = (richiesta.versione !== undefined && richiesta.versione !== indice.versione) || dopo > indice.ultimo;
    const da = daCapo ? 0 : dopo;
    const limite = Math.min(PEZZO_MASSIMO, Math.max(1, Math.floor(richiesta.limite ?? PEZZO_MASSIMO)));
    // La storia leggera si calcola sull'archivio intero: se un'azione è conclusa lo dice un evento che può venire dopo.
    const eventi = storiaLeggera(this.#archiviati).slice(da, da + limite);
    return { ...indice, eventi, altri: da + eventi.length < indice.ultimo, daCapo };
  }

  /**
   * Vero se chi ha una copia dell'archivio fino all'evento `dopo`, in quella versione, può
   * riprendere da lì senza buttarla.
   */
  riprendibile(dopo: number, versione: string): boolean {
    return versione === this.#versione && Number.isInteger(dopo) && dopo >= 0 && dopo <= this.#archiviati.length;
  }

  /**
   * Collega un ascoltatore: riceve subito tutta la storia, poi gli eventi nuovi.
   * Con `dopo` riceve della storia solo gli eventi archiviati dopo quello: chi lo chiama ha già
   * controllato con `riprendibile` che la sua copia vale. Testi in corso ed eventi ricordati
   * arrivano comunque, interi. Restituisce la funzione per scollegarlo.
   */
  iscrivi(ascoltatore: Ascoltatore, dopo = 0): () => void {
    // Chi si iscrive è l'interfaccia: delle azioni concluse le basta un riassunto, il resto lo chiede quando serve.
    for (const archiviato of storiaLeggera(this.#archiviati).slice(dopo)) ascoltatore(archiviato);
    const quando = new Date().toISOString();
    for (const [idTesto, finora] of this.#testiInCorso) {
      if (finora !== "") {
        ascoltatore({ n: 0, quando, evento: { tipo: "testo-frammento", idTesto, frammento: finora } });
      }
    }
    for (const evento of this.#ricordati.values()) ascoltatore({ n: 0, quando, evento });
    const scollega = this.ascolta(ascoltatore);
    this.#pagine += 1;
    let collegato = true;
    return () => {
      if (!collegato) return;
      collegato = false;
      this.#pagine -= 1;
      scollega();
    };
  }

  /** Vero se almeno una pagina dell'interfaccia ha questa conversazione aperta. */
  get seguito(): boolean {
    return this.#pagine > 0;
  }

  /** Collega un ascoltatore ai soli eventi nuovi, senza ripetergli la storia. */
  ascolta(ascoltatore: Ascoltatore): () => void {
    this.#ascoltatori.add(ascoltatore);
    return () => this.#ascoltatori.delete(ascoltatore);
  }

  /** L'ultimo evento ricordato di un tipo, per esempio lo stato riferito dall'harness. */
  ricordato(tipo: EventoConversazione["tipo"]): EventoConversazione | undefined {
    return this.#ricordati.get(tipo);
  }

  get archiviati(): readonly EventoArchiviato[] {
    return this.#archiviati;
  }

  /** Quanti turni sono ancora aperti, e quante richieste aspettano il proprietario: permessi e approvazioni. */
  get sospesi(): Sospesi {
    return {
      turni: this.#turniAperti,
      permessi: this.#permessiAperti.size + this.#domandeAperte.size + this.#approvazioniAperte.size + this.#installazioniAperte.size,
    };
  }

  /**
   * Chiude ciò che è rimasto in sospeso quando chi lavorava non c'è più: senza questo
   * l'interfaccia mostrerebbe per sempre una risposta in arrivo o un permesso in attesa.
   */
  chiudiSospesi(motivo: string): void {
    for (const idTesto of [...this.#testiAperti]) {
      this.pubblica({ tipo: "testo-concluso", idTesto, testo: this.#testiInCorso.get(idTesto) ?? "" });
    }
    for (const idPermesso of [...this.#permessiAperti]) {
      this.pubblica({ tipo: "permesso-deciso", idPermesso, decisione: "negato" });
    }
    for (const idDomande of [...this.#domandeAperte]) {
      this.pubblica({ tipo: "domande-chiuse", idDomande, esito: "annullate" });
    }
    for (const idApprovazione of [...this.#approvazioniAperte]) {
      this.pubblica({ tipo: "approvazione-decisa", idApprovazione, esito: "scaduta" });
    }
    for (const idInstallazione of [...this.#installazioniAperte]) {
      this.pubblica({ tipo: "installazione-decisa", idInstallazione, esito: "scaduta" });
    }
    // Le proposte no: aspettano il proprietario anche dopo un riavvio (le ricorda `ProposteRicordate`).
    while (this.#turniAperti > 0) {
      this.pubblica({ tipo: "turno-concluso", riuscito: false, durataMs: 0, errore: motivo });
    }
  }

  #salvaIndice(): void {
    scriviIndice(this.#file, { versione: this.#versione, ultimo: this.#archiviati.length, byte: this.#byte });
  }

  /** Tiene il conto di ciò che comincia e di ciò che si conclude. */
  #annota(evento: EventoConversazione): void {
    switch (evento.tipo) {
      case "testo-iniziato":
        this.#testiAperti.add(evento.idTesto);
        break;
      case "testo-concluso":
        this.#testiAperti.delete(evento.idTesto);
        break;
      case "permesso-richiesto":
        this.#permessiAperti.add(evento.idPermesso);
        break;
      case "permesso-deciso":
        this.#permessiAperti.delete(evento.idPermesso);
        break;
      case "domande-poste":
        this.#domandeAperte.add(evento.idDomande);
        break;
      case "domande-chiuse":
        this.#domandeAperte.delete(evento.idDomande);
        break;
      case "approvazione-richiesta":
        this.#approvazioniAperte.add(evento.idApprovazione);
        break;
      case "approvazione-decisa":
        this.#approvazioniAperte.delete(evento.idApprovazione);
        break;
      case "proposta-progetto":
        this.#proposteAperte.add(evento.idProposta);
        break;
      case "proposta-decisa":
        this.#proposteAperte.delete(evento.idProposta);
        break;
      case "sviluppo-proposto":
        this.#sviluppiAperti.add(evento.idProposta);
        break;
      case "sviluppo-deciso":
        this.#sviluppiAperti.delete(evento.idProposta);
        break;
      case "installazione-richiesta":
        this.#installazioniAperte.add(evento.idInstallazione);
        break;
      case "installazione-decisa":
        this.#installazioniAperte.delete(evento.idInstallazione);
        break;
      case "estensione-proposta":
        this.#estensioniAperte.add(evento.idProposta);
        break;
      case "estensione-decisa":
        this.#estensioniAperte.delete(evento.idProposta);
        break;
      case "turno-iniziato":
        this.#turniAperti += 1;
        break;
      case "turno-concluso":
        this.#turniAperti = Math.max(0, this.#turniAperti - 1);
        break;
      default:
        break;
    }
  }
}

async function leggiArchivio(file: string): Promise<ArchivioLetto> {
  try {
    return analizzaArchivio(await readFile(file, "utf8"));
  } catch (errore) {
    if (errore instanceof Error && "code" in errore && errore.code === "ENOENT") {
      return { archiviati: [], rigaSpezzata: false, rinumerati: false };
    }
    throw errore;
  }
}
