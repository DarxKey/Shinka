/**
 * Il registro degli ambienti al centro: quali nodi il proprietario ha accettato,
 * quali sono collegati in questo momento e quali aspettano il suo consenso.
 */

import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { codiceDiVerifica, improntaDelSegreto } from "../protocollo/codice.ts";
import {
  SILENZIO_MASSIMO_MS,
  type AggiornamentoDelNodo,
  type Ambiente,
  type ComandoPerNodo,
  type MessaggioCentro,
  type MessaggioNodo,
  type RichiestaCollegamento,
  type RiferitoDalNodo,
  type StatoAmbienti,
} from "../protocollo/nodi.ts";
import type { DecisionePermesso } from "../protocollo/eventi.ts";
import { inBreve } from "../protocollo/versione.ts";

/** Quanti nodi sconosciuti possono aspettare insieme il consenso del proprietario. */
export const RICHIESTE_MASSIME = 5;

/** Identificativo dell'ambiente in cui gira il centro. */
export const ID_AMBIENTE_DEL_CENTRO = "centro";

type Presentazione = Extract<MessaggioNodo, { tipo: "presentazione" }>;

/** Il collegamento con un nodo, visto dal registro. */
export interface CanaleNodo {
  invia(messaggio: MessaggioCentro): void;
  chiudi(): void;
  /** L'indirizzo da cui il nodo si è collegato, visto dal centro: senza il prefisso IPv4 dentro IPv6. */
  indirizzo?: string;
  /** Vero se il collegamento arriva al centro cifrato (ADR 0040). */
  cifrato?: boolean;
}

interface NodoRegistrato {
  id: string;
  nome: string;
  descrizione: string;
  sistema: string;
  radiceProgetti: string;
  improntaSegreto: string;
  registratoIl: string;
  /** L'indirizzo con cui il nodo raggiunge il centro, come l'ha detto l'ultima volta. */
  indirizzoDelCentro?: string;
  /** La porta del ponte, se il proprietario lo ha acceso (ADR 0058). */
  ponte?: number;
}

/** Ciò che un nodo dice della sua versione quando si presenta. */
export interface VersioneDelNodo {
  /** La versione di Shinka che sta eseguendo, per intero; manca se il nodo non la dice. */
  versione?: string;
  /** Vero se sa cambiare versione da solo. */
  siAggiorna: boolean;
  /** Su Windows: se parte a ogni accesso; manca se il nodo non lo dice. */
  avvioConWindows?: boolean;
}

interface NodoCollegato extends VersioneDelNodo {
  canale: CanaleNodo;
  ultimoBattito: number;
  cifrato: boolean;
  /** I progetti con lavoro fatto offline che il nodo ha detto di dover consegnare (ADR 0056). */
  offline?: string[];
  /** Com'è andato il ponte l'ultima volta che il nodo lo ha detto. */
  ponte?: { porta?: number; motivo?: string };
}

interface NodoInAttesa extends VersioneDelNodo {
  canale: CanaleNodo;
  richiesta: RichiestaCollegamento;
  improntaSegreto: string;
  radiceProgetti: string;
  indirizzoDelCentro?: string;
}

export interface AmbienteDelCentro {
  nome: string;
  descrizione: string;
  sistema: string;
  radiceProgetti: string;
  /** La versione di Shinka in funzione al centro, per intero; manca se non è scritta. */
  versione?: string;
}

function versioneDichiarata(presentazione: Presentazione): VersioneDelNodo {
  return {
    ...(presentazione.versione === undefined ? {} : { versione: presentazione.versione }),
    siAggiorna: presentazione.siAggiorna === true,
    ...(presentazione.avvioConWindows === undefined ? {} : { avvioConWindows: presentazione.avvioConWindows }),
  };
}

export class RegistroAmbienti {
  readonly #file: string;
  #delCentro: AmbienteDelCentro;
  readonly #registrati: Map<string, NodoRegistrato>;
  readonly #collegati = new Map<string, NodoCollegato>();
  readonly #inAttesa = new Map<string, NodoInAttesa>();
  /** Gli aggiornamenti chiesti ai nodi, con la versione per intero: restano anche mentre il nodo riparte. */
  readonly #aggiornamenti = new Map<string, AggiornamentoDelNodo>();
  readonly #ascoltatori = new Set<(stato: StatoAmbienti) => void>();
  readonly #ascoltatoriRiferiti = new Set<(idNodo: string, messaggio: RiferitoDalNodo) => void>();
  readonly #ascoltatoriScollegamenti = new Set<(idNodo: string) => void>();
  readonly #ascoltatoriCollegamenti = new Set<(idNodo: string) => void>();
  /** Vero se il proprietario ha scelto di accettare solo i nodi con il collegamento cifrato. */
  #soloCifrati = false;

  private constructor(file: string, delCentro: AmbienteDelCentro, registrati: NodoRegistrato[]) {
    this.#file = file;
    this.#delCentro = delCentro;
    this.#registrati = new Map(registrati.map((nodo) => [nodo.id, nodo]));
  }

  /** Nome e descrizione dell'ambiente del centro, cambiati dalla pagina Impostazioni: valgono subito. */
  rinominaDelCentro(cambio: { nome: string; descrizione: string }): void {
    this.#delCentro = { ...this.#delCentro, nome: cambio.nome, descrizione: cambio.descrizione };
    this.#avvisa();
  }

  static async apri(file: string, delCentro: AmbienteDelCentro): Promise<RegistroAmbienti> {
    await mkdir(dirname(file), { recursive: true });
    return new RegistroAmbienti(file, delCentro, leggiRegistrati(file));
  }

  get soloCifrati(): boolean {
    return this.#soloCifrati;
  }

  /**
   * Il proprietario sceglie se accettare solo i nodi con il collegamento cifrato. Accendendolo, i
   * nodi collegati in chiaro vengono staccati: torneranno, se sanno cifrare.
   */
  accettaSoloCifrati(soloCifrati: boolean): void {
    if (this.#soloCifrati === soloCifrati) return;
    this.#soloCifrati = soloCifrati;
    if (!soloCifrati) return;
    for (const [idNodo, collegato] of this.#collegati) {
      if (collegato.cifrato) continue;
      this.#collegati.delete(idNodo);
      this.#avvisaScollegamento(idNodo);
      collegato.canale.invia({ tipo: "solo-cifrato" });
      collegato.canale.chiudi();
    }
    for (const [idNodo, inAttesa] of this.#inAttesa) {
      if (inAttesa.canale.cifrato === true) continue;
      this.#inAttesa.delete(idNodo);
      inAttesa.canale.invia({ tipo: "solo-cifrato" });
      inAttesa.canale.chiudi();
    }
    this.#avvisa();
  }

  /** Un nodo si è collegato e dice chi è. Restituisce come è stato trattato. */
  async presenta(
    presentazione: Presentazione,
    canale: CanaleNodo,
    ora: number = Date.now(),
  ): Promise<MessaggioCentro["tipo"]> {
    // Con questa scelta un collegamento in chiaro non viene ascoltato: nemmeno il suo segreto si guarda.
    if (this.#soloCifrati && canale.cifrato !== true) {
      canale.invia({ tipo: "solo-cifrato" });
      canale.chiudi();
      return "solo-cifrato";
    }
    const difetto = difettoDi(presentazione);
    if (difetto !== undefined) return this.#rifiuta(canale, difetto);

    const impronta = improntaDelSegreto(presentazione.segreto);
    const registrato = this.#registrati.get(presentazione.idNodo);

    if (registrato !== undefined) {
      // Un segreto passato in chiaro il nodo lo cambia: il nuovo si prende solo da un collegamento
      // cifrato. Se la conferma di prima si era persa, il centro ha già il nuovo, e vale quello.
      const prossima = canale.cifrato === true && presentazione.segretoProssimo !== undefined ? improntaDelSegreto(presentazione.segretoProssimo) : undefined;
      const conIlSuo = stessaImpronta(impronta, registrato.improntaSegreto);
      const conIlProssimo = prossima !== undefined && stessaImpronta(prossima, registrato.improntaSegreto);
      if (!conIlSuo && !conIlProssimo) {
        return this.#rifiuta(canale, "Questo nodo non è quello che il proprietario ha accettato.");
      }
      if (prossima !== undefined && !conIlProssimo) {
        registrato.improntaSegreto = prossima;
        await this.#salva();
      }
      await this.#aggiornaDati(registrato, presentazione);
      this.#esitoAggiornamento(registrato.id, presentazione);
      this.#collega(registrato, canale, ora, versioneDichiarata(presentazione), prossima !== undefined, presentazione.offline);
      return "accolto";
    }

    const giaInAttesa = this.#inAttesa.get(presentazione.idNodo);
    if (giaInAttesa === undefined && this.#inAttesa.size >= RICHIESTE_MASSIME) {
      return this.#rifiuta(canale, "Troppe richieste di collegamento in attesa. Riprova più tardi.");
    }
    if (giaInAttesa !== undefined && giaInAttesa.canale !== canale) giaInAttesa.canale.chiudi();

    const codice = codiceDiVerifica(presentazione.idNodo, presentazione.segreto);
    this.#inAttesa.set(presentazione.idNodo, {
      canale,
      improntaSegreto: impronta,
      radiceProgetti: presentazione.radiceProgetti.trim(),
      ...(presentazione.centro === undefined ? {} : { indirizzoDelCentro: presentazione.centro }),
      ...versioneDichiarata(presentazione),
      richiesta: {
        id: presentazione.idNodo,
        nome: presentazione.nome.trim(),
        descrizione: presentazione.descrizione.trim(),
        sistema: presentazione.sistema.trim(),
        codice,
        quando: new Date(ora).toISOString(),
      },
    });
    canale.invia({ tipo: "in-attesa", codice });
    this.#avvisa();
    return "in-attesa";
  }

  /** Un nodo collegato si è fatto sentire. */
  battito(idNodo: string, canale: CanaleNodo, ora: number = Date.now()): void {
    const collegato = this.#collegati.get(idNodo);
    if (collegato?.canale === canale) collegato.ultimoBattito = ora;
  }

  /** Un nodo collegato riferisce qualcosa del lavoro che sta facendo. */
  riferito(idNodo: string, canale: CanaleNodo, messaggio: RiferitoDalNodo): void {
    if (this.#collegati.get(idNodo)?.canale !== canale) return;
    for (const ascoltatore of this.#ascoltatoriRiferiti) ascoltatore(idNodo, messaggio);
  }

  /** Chiede a un nodo di fare qualcosa. Falso se il suo ambiente non è attivo. */
  inviaAlNodo(idAmbiente: string, comando: ComandoPerNodo): boolean {
    const collegato = this.#collegati.get(idAmbiente);
    if (collegato === undefined) return false;
    collegato.canale.invia(comando);
    return true;
  }

  /** La versione che un nodo collegato ha dichiarato, e se sa aggiornarsi; nulla se l'ambiente è spento. */
  nodo(idAmbiente: string): VersioneDelNodo | undefined {
    const collegato = this.#collegati.get(idAmbiente);
    if (collegato === undefined) return undefined;
    return { ...(collegato.versione === undefined ? {} : { versione: collegato.versione }), siAggiorna: collegato.siAggiorna };
  }

  /** Il nodo collegato ha cambiato il suo avvio con Windows: lo si ricorda finché resta collegato. */
  /** Accende il ponte di un ambiente su una porta, o lo spegne (ADR 0058): lo ricorda, e lo dice al nodo se è collegato. */
  async impostaPonte(idAmbiente: string, porta: number | undefined): Promise<boolean> {
    const nodo = this.#registrati.get(idAmbiente);
    if (nodo === undefined) return false;
    if (porta === undefined) delete nodo.ponte;
    else nodo.ponte = porta;
    await this.#salva();
    const collegato = this.#collegati.get(idAmbiente);
    if (collegato !== undefined) delete collegato.ponte;
    this.inviaAlNodo(idAmbiente, { tipo: "ponte", porta: porta ?? null });
    this.#avvisa();
    return true;
  }

  /** Il nodo ha detto com'è il suo ponte. */
  segnaPonte(idAmbiente: string, esito: { porta?: number; motivo?: string }): void {
    const collegato = this.#collegati.get(idAmbiente);
    if (collegato === undefined) return;
    collegato.ponte = esito;
    this.#avvisa();
  }

  segnaAvvioConWindows(idAmbiente: string, attivo: boolean): void {
    const collegato = this.#collegati.get(idAmbiente);
    if (collegato === undefined || collegato.avvioConWindows === attivo) return;
    collegato.avvioConWindows = attivo;
    this.#avvisa();
  }

  /** Segna a che punto è l'aggiornamento chiesto a un nodo, con la versione per intero; nulla lo toglie. */
  segnaAggiornamento(idAmbiente: string, aggiornamento: AggiornamentoDelNodo | undefined): void {
    if (!this.#registrati.has(idAmbiente)) return;
    if (aggiornamento === undefined) this.#aggiornamenti.delete(idAmbiente);
    else this.#aggiornamenti.set(idAmbiente, aggiornamento);
    this.#avvisa();
  }

  /** Vero se l'ambiente esiste ed è attivo in questo momento. */
  attivo(idAmbiente: string): boolean {
    return idAmbiente === ID_AMBIENTE_DEL_CENTRO || this.#collegati.has(idAmbiente);
  }

  /** Ascolta ciò che i nodi riferiscono del loro lavoro. */
  iscriviRiferiti(ascoltatore: (idNodo: string, messaggio: RiferitoDalNodo) => void): () => void {
    this.#ascoltatoriRiferiti.add(ascoltatore);
    return () => this.#ascoltatoriRiferiti.delete(ascoltatore);
  }

  /** Ascolta gli ambienti che diventano attivi: chiamato subito dopo che il nodo è stato accolto. */
  iscriviCollegamenti(ascoltatore: (idNodo: string) => void): () => void {
    this.#ascoltatoriCollegamenti.add(ascoltatore);
    return () => this.#ascoltatoriCollegamenti.delete(ascoltatore);
  }

  /** Gli ambienti degli altri nodi che in questo momento sono attivi. */
  /** I progetti con lavoro offline da consegnare che il nodo ha detto collegandosi (ADR 0056). */
  offlineDichiarato(idNodo: string): readonly string[] {
    return this.#collegati.get(idNodo)?.offline ?? [];
  }

  collegati(): string[] {
    return [...this.#collegati.keys()];
  }

  /** Ascolta gli ambienti che smettono di essere attivi. */
  iscriviScollegamenti(ascoltatore: (idNodo: string) => void): () => void {
    this.#ascoltatoriScollegamenti.add(ascoltatore);
    return () => this.#ascoltatoriScollegamenti.delete(ascoltatore);
  }

  /** Il collegamento con un nodo si è chiuso. */
  scollegato(idNodo: string, canale: CanaleNodo): void {
    // Un nodo che si ricollega apre un canale nuovo: la chiusura di quello vecchio non conta.
    if (this.#collegati.get(idNodo)?.canale === canale) {
      this.#collegati.delete(idNodo);
      this.#avvisaScollegamento(idNodo);
      this.#avvisa();
    }
    if (this.#inAttesa.get(idNodo)?.canale === canale) {
      this.#inAttesa.delete(idNodo);
      this.#avvisa();
    }
  }

  /** Il proprietario accetta o rifiuta un nodo in attesa. Falso se la richiesta non c'è più. */
  async decidi(
    idRichiesta: string,
    decisione: DecisionePermesso,
    ora: number = Date.now(),
  ): Promise<boolean> {
    const inAttesa = this.#inAttesa.get(idRichiesta);
    if (inAttesa === undefined) return false;
    this.#inAttesa.delete(idRichiesta);

    if (decisione === "negato") {
      inAttesa.canale.invia({ tipo: "rifiutato", motivo: "Il proprietario ha rifiutato questo nodo." });
      inAttesa.canale.chiudi();
      this.#avvisa();
      return true;
    }

    const registrato: NodoRegistrato = {
      id: inAttesa.richiesta.id,
      nome: inAttesa.richiesta.nome,
      descrizione: inAttesa.richiesta.descrizione,
      sistema: inAttesa.richiesta.sistema,
      radiceProgetti: inAttesa.radiceProgetti,
      improntaSegreto: inAttesa.improntaSegreto,
      registratoIl: new Date(ora).toISOString(),
      ...(inAttesa.indirizzoDelCentro === undefined ? {} : { indirizzoDelCentro: inAttesa.indirizzoDelCentro }),
    };
    this.#registrati.set(registrato.id, registrato);
    await this.#salva();
    this.#collega(registrato, inAttesa.canale, ora, inAttesa);
    return true;
  }

  /** Il proprietario dimentica un ambiente: il suo nodo dovrà chiedere di nuovo il consenso. */
  async rimuovi(idAmbiente: string): Promise<boolean> {
    if (!this.#registrati.delete(idAmbiente)) return false;
    this.#aggiornamenti.delete(idAmbiente);
    await this.#salva();
    const collegato = this.#collegati.get(idAmbiente);
    if (collegato !== undefined) {
      this.#collegati.delete(idAmbiente);
      this.#avvisaScollegamento(idAmbiente);
      collegato.canale.invia({ tipo: "rifiutato", motivo: "Il proprietario ha rimosso questo ambiente." });
      collegato.canale.chiudi();
    }
    this.#avvisa();
    return true;
  }

  /** Considera spenti i nodi che tacciono da troppo tempo. */
  controllaSilenzi(ora: number = Date.now()): void {
    let cambiato = false;
    for (const [idNodo, collegato] of this.#collegati) {
      if (ora - collegato.ultimoBattito > SILENZIO_MASSIMO_MS) {
        this.#collegati.delete(idNodo);
        this.#avvisaScollegamento(idNodo);
        collegato.canale.chiudi();
        cambiato = true;
      }
    }
    if (cambiato) this.#avvisa();
  }

  stato(): StatoAmbienti {
    const delCentro: Ambiente = {
      id: ID_AMBIENTE_DEL_CENTRO,
      nome: this.#delCentro.nome,
      descrizione: this.#delCentro.descrizione,
      sistema: this.#delCentro.sistema,
      radiceProgetti: this.#delCentro.radiceProgetti,
      attivo: true,
      delCentro: true,
      ...(this.#delCentro.versione === undefined ? {} : { versione: inBreve(this.#delCentro.versione) }),
    };
    const altri = [...this.#registrati.values()]
      .map((nodo): Ambiente => {
        const collegato = this.#collegati.get(nodo.id);
        const aggiornamento = this.#aggiornamenti.get(nodo.id);
        return {
          id: nodo.id,
          nome: nodo.nome,
          descrizione: nodo.descrizione,
          sistema: nodo.sistema,
          radiceProgetti: nodo.radiceProgetti,
          attivo: collegato !== undefined,
          delCentro: false,
          ...(collegato?.versione === undefined ? {} : { versione: inBreve(collegato.versione) }),
          // Indietro si può dire solo se il centro sa a che versione è lui.
          ...(collegato !== undefined && this.#delCentro.versione !== undefined && collegato.versione !== this.#delCentro.versione
            ? { indietro: true }
            : {}),
          ...(collegato?.siAggiorna === true ? { siAggiorna: true } : {}),
          ...(collegato === undefined ? {} : { cifrato: collegato.cifrato }),
          ...(aggiornamento === undefined ? {} : { aggiornamento: { ...aggiornamento, versione: inBreve(aggiornamento.versione) } }),
          ...(nodo.indirizzoDelCentro === undefined ? {} : { indirizzoDelCentro: nodo.indirizzoDelCentro }),
          ...(collegato?.avvioConWindows === undefined ? {} : { avvioConWindows: collegato.avvioConWindows }),
          ...(collegato?.canale.indirizzo === undefined ? {} : { indirizzoDelNodo: collegato.canale.indirizzo }),
          ...(nodo.ponte === undefined
            ? {}
            : {
                ponte: {
                  porta: nodo.ponte,
                  aperto: collegato?.ponte?.porta === nodo.ponte,
                  ...(collegato === undefined ? { motivo: "L'ambiente è spento." } : collegato.ponte?.motivo === undefined ? {} : { motivo: collegato.ponte.motivo }),
                },
              }),
        };
      })
      .sort((a, b) => a.nome.localeCompare(b.nome, "it"));
    const richieste = [...this.#inAttesa.values()]
      .map((inAttesa) => inAttesa.richiesta)
      .sort((a, b) => a.quando.localeCompare(b.quando));
    return { ambienti: [delCentro, ...altri], richieste };
  }

  /** Collega un ascoltatore: riceve subito lo stato, poi ogni cambiamento. */
  iscrivi(ascoltatore: (stato: StatoAmbienti) => void): () => void {
    ascoltatore(this.stato());
    this.#ascoltatori.add(ascoltatore);
    return () => this.#ascoltatori.delete(ascoltatore);
  }

  /**
   * Il nodo si presenta dopo che gli era stato chiesto di aggiornarsi: dalla versione che dichiara
   * si capisce com'è finita. Un nodo alla versione del centro non ha più nulla in sospeso.
   */
  #esitoAggiornamento(idNodo: string, presentazione: Presentazione): void {
    const { versione } = this.#delCentro;
    if (versione !== undefined && presentazione.versione === versione) {
      this.#aggiornamenti.delete(idNodo);
      return;
    }
    const fallito = presentazione.aggiornamentoFallito;
    const chiesto = this.#aggiornamenti.get(idNodo);
    if (chiesto?.stato === "in-corso") {
      this.#aggiornamenti.set(idNodo, {
        stato: "non-riuscito",
        versione: chiesto.versione,
        motivo:
          fallito?.versione === chiesto.versione
            ? `La versione nuova non è partita (${fallito.motivo}): il nodo è tornato a quella di prima.`
            : "Il nodo si è ricollegato con la versione di prima.",
      });
    } else if (chiesto === undefined && fallito !== undefined) {
      // Il centro è ripartito nel frattempo: com'è finita lo sa solo il nodo.
      this.#aggiornamenti.set(idNodo, {
        stato: "non-riuscito",
        versione: fallito.versione,
        motivo: `La versione nuova non è partita (${fallito.motivo}): il nodo è tornato a quella di prima.`,
      });
    }
  }

  #collega(registrato: NodoRegistrato, canale: CanaleNodo, ora: number, dichiarata: VersioneDelNodo, segretoCambiato = false, offline?: string[]): void {
    const precedente = this.#collegati.get(registrato.id);
    // Lo stesso nodo si è ricollegato: il canale vecchio non serve più, e il lavoro
    // che vi passava si è fermato con lui.
    if (precedente !== undefined && precedente.canale !== canale) {
      this.#avvisaScollegamento(registrato.id);
      precedente.canale.chiudi();
    }
    this.#collegati.set(registrato.id, {
      canale,
      ultimoBattito: ora,
      ...(dichiarata.versione === undefined ? {} : { versione: dichiarata.versione }),
      siAggiorna: dichiarata.siAggiorna,
      ...(dichiarata.avvioConWindows === undefined ? {} : { avvioConWindows: dichiarata.avvioConWindows }),
      cifrato: canale.cifrato === true,
      ...(offline === undefined ? {} : { offline: offline.filter((id) => typeof id === "string").slice(0, 1000) }),
    });
    canale.invia({ tipo: "accolto", nome: registrato.nome, ...(segretoCambiato ? { segretoCambiato: true as const } : {}) });
    // Il ponte acceso dal proprietario si riapre a ogni collegamento (ADR 0058).
    if (registrato.ponte !== undefined) canale.invia({ tipo: "ponte", porta: registrato.ponte });
    for (const ascoltatore of this.#ascoltatoriCollegamenti) ascoltatore(registrato.id);
    this.#avvisa();
  }

  #rifiuta(canale: CanaleNodo, motivo: string): "rifiutato" {
    canale.invia({ tipo: "rifiutato", motivo });
    canale.chiudi();
    return "rifiutato";
  }

  /** Nome, descrizione e sistema sono quelli che il nodo dichiara oggi. */
  async #aggiornaDati(registrato: NodoRegistrato, presentazione: Presentazione): Promise<void> {
    const nome = presentazione.nome.trim();
    const descrizione = presentazione.descrizione.trim();
    const sistema = presentazione.sistema.trim();
    const radiceProgetti = presentazione.radiceProgetti.trim();
    const indirizzoDelCentro = presentazione.centro ?? registrato.indirizzoDelCentro;
    if (
      registrato.nome === nome &&
      registrato.descrizione === descrizione &&
      registrato.sistema === sistema &&
      registrato.radiceProgetti === radiceProgetti &&
      registrato.indirizzoDelCentro === indirizzoDelCentro
    ) {
      return;
    }
    if (indirizzoDelCentro !== undefined) registrato.indirizzoDelCentro = indirizzoDelCentro;
    registrato.nome = nome;
    registrato.descrizione = descrizione;
    registrato.sistema = sistema;
    registrato.radiceProgetti = radiceProgetti;
    await this.#salva();
  }

  #avvisaScollegamento(idNodo: string): void {
    for (const ascoltatore of this.#ascoltatoriScollegamenti) ascoltatore(idNodo);
  }

  #avvisa(): void {
    const stato = this.stato();
    for (const ascoltatore of this.#ascoltatori) ascoltatore(stato);
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
    await writeFile(provvisorio, JSON.stringify([...this.#registrati.values()], null, 2), {
      mode: 0o600,
    });
    await rename(provvisorio, this.#file);
  }
}

function leggiRegistrati(file: string): NodoRegistrato[] {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as NodoRegistrato[];
  } catch (errore) {
    if (errore instanceof Error && "code" in errore && errore.code === "ENOENT") return [];
    throw errore;
  }
}

function stessaImpronta(a: string, b: string): boolean {
  const primo = Buffer.from(a, "hex");
  const secondo = Buffer.from(b, "hex");
  return primo.length === secondo.length && timingSafeEqual(primo, secondo);
}

/** Dice che cosa non va in una presentazione, oppure nulla se è ben formata. */
function difettoDi(presentazione: Presentazione): string | undefined {
  const testo = (valore: unknown, minimo: number, massimo: number): boolean =>
    typeof valore === "string" && valore.trim().length >= minimo && valore.length <= massimo;
  if (!testo(presentazione.idNodo, 8, 64)) return "Identificativo del nodo non valido.";
  if (!testo(presentazione.segreto, 32, 256)) return "Segreto del nodo non valido.";
  if (presentazione.segretoProssimo !== undefined && !testo(presentazione.segretoProssimo, 32, 256)) return "Segreto del nodo non valido.";
  if (!testo(presentazione.nome, 1, 60)) return "Il nome dell'ambiente deve avere da 1 a 60 caratteri.";
  if (!testo(presentazione.descrizione, 0, 200)) return "La descrizione supera i 200 caratteri.";
  if (!testo(presentazione.sistema, 1, 60)) return "Il sistema dell'ambiente non è indicato.";
  if (!testo(presentazione.radiceProgetti, 1, 400)) return "La cartella dei progetti non è indicata.";
  if (presentazione.idNodo === ID_AMBIENTE_DEL_CENTRO) return "Identificativo del nodo non valido.";
  return undefined;
}
