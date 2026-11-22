/**
 * L'anteprima vista dal centro: quale applicazione il proprietario sta guardando, e la strada
 * per portarle le richieste del suo browser, ovunque giri: nell'ambiente del centro o su un nodo.
 *
 * L'anteprima aperta è una sola per tutto Shinka: così l'applicazione risponde dalla radice del
 * suo indirizzo, come si aspetta, e le sue pagine non vanno riscritte.
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  percorsoValido,
  portaValida,
  type ComandoAnteprima,
  type Intestazioni,
  type PortaAnteprima,
  type RiferitoAnteprima,
  type StatoAnteprima,
} from "../protocollo/anteprima.ts";
import type { EsitoStrumento } from "../protocollo/strumenti.ts";
import { ID_AMBIENTE_DEL_CENTRO, type RegistroAmbienti } from "./ambienti.ts";
import type { RegistroProgetti } from "./progetti.ts";

/** Quanto si aspetta che l'applicazione cominci a rispondere. */
const ATTESA_RISPOSTA_MS = 60_000;

/** Quanto si aspetta per sapere se sulla porta risponde qualcosa. */
const ATTESA_SONDA_MS = 6_000;

export interface OpzioniAnteprime {
  progetti: Pick<RegistroProgetti, "trova">;
  ambienti: RegistroAmbienti;
  /** Chi fa da tramite nell'ambiente del centro: riceve dove riferire ciò che l'applicazione risponde. */
  locale(riferisci: (messaggio: RiferitoAnteprima) => void): PortaAnteprima;
  /** La porta su cui il centro serve l'anteprima; nulla se in questa installazione non la serve. */
  porta: number | null;
  /** Le porte del centro stesso: nel suo ambiente non si possono mettere in anteprima. */
  porteRiservate?: number[];
  attesaRispostaMs?: number;
  attesaSondaMs?: number;
  /**
   * Dove si ricorda quale anteprima è aperta: dopo un riavvio il proprietario la ritrova com'era.
   * Senza, al riavvio è chiusa.
   */
  file?: string;
}

/** Una richiesta del browser del proprietario, da portare all'applicazione. */
export interface RichiestaDelBrowser {
  metodo: string;
  percorso: string;
  intestazioni: Intestazioni;
  corpo?: Buffer;
}

/** Come arriva la risposta dell'applicazione. */
export interface AscoltoRichiesta {
  inizio(stato: number, intestazioni: Intestazioni): void;
  pezzo(dati: Buffer): void;
  fine(): void;
  errore(motivo: string): void;
}

/** Come arriva ciò che il server dell'applicazione manda su un WebSocket. */
export interface AscoltoCanale {
  aperto(protocollo: string): void;
  arrivo(dato: string | Buffer): void;
  chiuso(): void;
}

export interface CanaleAnteprima {
  manda(dato: string | Buffer): void;
  chiudi(): void;
}

interface Aperta {
  idProgetto: string;
  idAmbiente: string;
  porta: number;
  percorso: string;
}

export class Anteprime {
  readonly #o: OpzioniAnteprime;
  readonly #locale: PortaAnteprima;
  readonly #richieste = new Map<string, { idAmbiente: string; ascolto: AscoltoRichiesta; scadenza: NodeJS.Timeout }>();
  readonly #canali = new Map<string, { idAmbiente: string; ascolto: AscoltoCanale }>();
  readonly #ascoltatori = new Set<(stato: StatoAnteprima) => void>();
  #aperta: Aperta | undefined;

  constructor(opzioni: OpzioniAnteprime) {
    this.#o = opzioni;
    this.#aperta = this.#ricordata();
    this.#locale = opzioni.locale((messaggio) => this.#riferito(ID_AMBIENTE_DEL_CENTRO, messaggio));
    opzioni.ambienti.iscriviRiferiti((idNodo, messaggio) => {
      if (messaggio.tipo.startsWith("anteprima-")) this.#riferito(idNodo, messaggio as RiferitoAnteprima);
    });
    opzioni.ambienti.iscriviScollegamenti((idNodo) => this.#scollegato(idNodo));
  }

  stato(): StatoAnteprima {
    const aperta = this.#aperta;
    return {
      porta: this.#o.porta,
      ...(aperta === undefined
        ? {}
        : { aperta: { idProgetto: aperta.idProgetto, porta: aperta.porta, percorso: aperta.percorso } }),
    };
  }

  /** Collega un ascoltatore: riceve subito lo stato, poi ogni cambiamento. */
  iscrivi(ascoltatore: (stato: StatoAnteprima) => void): () => void {
    ascoltatore(this.stato());
    this.#ascoltatori.add(ascoltatore);
    return () => this.#ascoltatori.delete(ascoltatore);
  }

  /**
   * Il proprietario apre l'anteprima di un progetto su una porta del suo ambiente: prende il posto
   * di quella aperta prima. Restituisce il motivo se non si può, altrimenti nulla.
   */
  async apri(idProgetto: string, porta: unknown, percorso: unknown = "/"): Promise<string | undefined> {
    if (!portaValida(porta)) return "La porta è un numero tra 1 e 65535.";
    if (!percorsoValido(percorso)) return "Il percorso comincia con una barra, come /pagina.";
    const difetto = await this.#difetto(idProgetto, porta);
    if (difetto !== undefined) return difetto;
    const progetto = this.#o.progetti.trova(idProgetto);
    if (progetto === undefined) return "Progetto non trovato.";
    this.#fermaInCorso();
    this.#aperta = { idProgetto, idAmbiente: progetto.idAmbiente, porta, percorso };
    this.#ricorda();
    this.#avvisa();
    return undefined;
  }

  /** Chiude l'anteprima, se è quella di questo progetto. */
  chiudi(idProgetto: string): boolean {
    if (this.#aperta?.idProgetto !== idProgetto) return false;
    this.#fermaInCorso();
    this.#aperta = undefined;
    this.#ricorda();
    this.#avvisa();
    return true;
  }

  /** L'anteprima che era aperta prima del riavvio, se il suo progetto c'è ancora. */
  #ricordata(): Aperta | undefined {
    if (this.#o.file === undefined || !existsSync(this.#o.file)) return undefined;
    try {
      const letta = JSON.parse(readFileSync(this.#o.file, "utf8")) as Partial<Aperta>;
      const progetto = typeof letta.idProgetto === "string" ? this.#o.progetti.trova(letta.idProgetto) : undefined;
      if (progetto === undefined || !portaValida(letta.porta) || !percorsoValido(letta.percorso)) return undefined;
      return { idProgetto: progetto.id, idAmbiente: progetto.idAmbiente, porta: letta.porta, percorso: letta.percorso };
    } catch {
      return undefined;
    }
  }

  #ricorda(): void {
    if (this.#o.file === undefined) return;
    try {
      mkdirSync(dirname(this.#o.file), { recursive: true });
      const aperta = this.#aperta;
      writeFileSync(this.#o.file, JSON.stringify(aperta === undefined ? {} : { idProgetto: aperta.idProgetto, porta: aperta.porta, percorso: aperta.percorso }));
    } catch {
      // Senza memoria, al prossimo riavvio l'anteprima è chiusa: non è grave.
    }
  }

  /**
   * Claude propone al proprietario l'anteprima del progetto in cui lavora: qui si controlla solo
   * che sulla porta risponda qualcosa. Ad aprirla è il proprietario, dalla conversazione.
   */
  async proponi(idProgetto: string, porta: unknown, percorso: unknown = "/"): Promise<EsitoStrumento> {
    if (this.#o.progetti.trova(idProgetto) === undefined) {
      return { testo: "L'anteprima c'è solo nei progetti: qui non si può proporre.", errore: true };
    }
    if (!portaValida(porta)) return { testo: "La porta è un numero tra 1 e 65535.", errore: true };
    if (!percorsoValido(percorso)) return { testo: "Il percorso comincia con una barra, come /pagina.", errore: true };
    const difetto = await this.#difetto(idProgetto, porta);
    if (difetto !== undefined) {
      return {
        testo: `${difetto} Se l'applicazione non è ancora partita avviala in ascolto su localhost, controlla che risponda e proponi di nuovo.`,
        errore: true,
      };
    }
    return {
      testo:
        `Anteprima proposta: su localhost:${porta} di questo ambiente l'applicazione risponde, e nella conversazione il ` +
        "proprietario ha un pulsante per aprirla accanto alla chat. La vede attraverso Shinka: non dargli altri indirizzi da aprire.",
    };
  }

  /** Porta all'applicazione una richiesta del browser. Nulla se non c'è un'anteprima aperta. */
  richiedi(richiesta: RichiestaDelBrowser, ascolto: AscoltoRichiesta): (() => void) | undefined {
    const aperta = this.#aperta;
    if (aperta === undefined) return undefined;
    return this.#inoltra(aperta.idAmbiente, aperta.porta, richiesta, ascolto, this.#o.attesaRispostaMs ?? ATTESA_RISPOSTA_MS);
  }

  /** Apre verso il server dell'applicazione un WebSocket chiesto dal browser. Nulla se non c'è un'anteprima aperta. */
  apriCanale(percorso: string, protocolli: string[], ascolto: AscoltoCanale): CanaleAnteprima | undefined {
    const aperta = this.#aperta;
    if (aperta === undefined) return undefined;
    const idCanale = randomUUID();
    const { idAmbiente } = aperta;
    this.#canali.set(idCanale, { idAmbiente, ascolto });
    if (!this.#invia(idAmbiente, { tipo: "anteprima-ws-apri", idCanale, porta: aperta.porta, percorso, protocolli })) {
      this.#canali.delete(idCanale);
      queueMicrotask(() => ascolto.chiuso());
    }
    return {
      manda: (dato) => {
        if (!this.#canali.has(idCanale)) return;
        this.#invia(
          idAmbiente,
          typeof dato === "string"
            ? { tipo: "anteprima-ws-manda", idCanale, testo: dato }
            : { tipo: "anteprima-ws-manda", idCanale, binario: dato.toString("base64") },
        );
      },
      chiudi: () => {
        if (this.#canali.delete(idCanale)) this.#invia(idAmbiente, { tipo: "anteprima-ws-chiudi", idCanale });
      },
    };
  }

  /** Che cosa impedisce di guardare quella porta di quel progetto, se qualcosa lo impedisce. */
  async #difetto(idProgetto: string, porta: number): Promise<string | undefined> {
    const progetto = this.#o.progetti.trova(idProgetto);
    if (progetto === undefined) return "Progetto non trovato.";
    if (this.#o.porta === null) return "In questa installazione di Shinka l'anteprima non è accesa.";
    if (!this.#o.ambienti.attivo(progetto.idAmbiente)) return "L'ambiente del progetto è spento.";
    if (progetto.idAmbiente === ID_AMBIENTE_DEL_CENTRO && (this.#o.porteRiservate ?? []).includes(porta)) {
      return `La porta ${porta} è di Shinka: non è l'applicazione del progetto.`;
    }
    return this.#sonda(progetto.idAmbiente, porta);
  }

  /** Chiede la pagina iniziale e guarda solo se qualcosa risponde: il motivo, se non risponde. */
  #sonda(idAmbiente: string, porta: number): Promise<string | undefined> {
    return new Promise((risolvi) => {
      const annulla = this.#inoltra(
        idAmbiente,
        porta,
        { metodo: "GET", percorso: "/", intestazioni: [["accept", "*/*"]] },
        {
          inizio: () => {
            annulla();
            risolvi(undefined);
          },
          pezzo: () => {},
          fine: () => risolvi(undefined),
          errore: (motivo) => risolvi(motivo),
        },
        this.#o.attesaSondaMs ?? ATTESA_SONDA_MS,
      );
    });
  }

  #inoltra(
    idAmbiente: string,
    porta: number,
    richiesta: RichiestaDelBrowser,
    ascolto: AscoltoRichiesta,
    attesaMs: number,
  ): () => void {
    const idRichiesta = randomUUID();
    const togli = (): boolean => {
      const inCorso = this.#richieste.get(idRichiesta);
      if (inCorso === undefined) return false;
      clearTimeout(inCorso.scadenza);
      this.#richieste.delete(idRichiesta);
      return true;
    };
    const annulla = (): void => {
      if (togli()) this.#invia(idAmbiente, { tipo: "anteprima-annulla", idRichiesta });
    };
    const scadenza = setTimeout(() => {
      if (!togli()) return;
      this.#invia(idAmbiente, { tipo: "anteprima-annulla", idRichiesta });
      ascolto.errore(`L'applicazione sulla porta ${porta} non ha risposto in tempo.`);
    }, attesaMs);
    this.#richieste.set(idRichiesta, { idAmbiente, ascolto, scadenza });
    const inviato = this.#invia(idAmbiente, {
      tipo: "anteprima-richiesta",
      idRichiesta,
      porta,
      metodo: richiesta.metodo,
      percorso: richiesta.percorso,
      intestazioni: richiesta.intestazioni,
      ...(richiesta.corpo === undefined ? {} : { corpo: richiesta.corpo.toString("base64") }),
    });
    if (!inviato) {
      // Chi chiama deve prima ricevere il modo di annullare, poi l'errore.
      queueMicrotask(() => {
        if (togli()) ascolto.errore("L'ambiente del progetto è spento.");
      });
    }
    return annulla;
  }

  #invia(idAmbiente: string, comando: ComandoAnteprima): boolean {
    if (idAmbiente !== ID_AMBIENTE_DEL_CENTRO) return this.#o.ambienti.inviaAlNodo(idAmbiente, comando);
    this.#locale.esegui(comando);
    return true;
  }

  #riferito(idAmbiente: string, messaggio: RiferitoAnteprima): void {
    switch (messaggio.tipo) {
      case "anteprima-inizio":
      case "anteprima-pezzo":
      case "anteprima-fine":
      case "anteprima-errore": {
        const inCorso = this.#richieste.get(messaggio.idRichiesta);
        // Risponde solo l'ambiente a cui la richiesta era stata fatta.
        if (inCorso === undefined || inCorso.idAmbiente !== idAmbiente) return;
        clearTimeout(inCorso.scadenza);
        if (messaggio.tipo === "anteprima-inizio") {
          inCorso.ascolto.inizio(messaggio.stato, messaggio.intestazioni);
        } else if (messaggio.tipo === "anteprima-pezzo") {
          inCorso.ascolto.pezzo(Buffer.from(messaggio.dati, "base64"));
        } else {
          this.#richieste.delete(messaggio.idRichiesta);
          if (messaggio.tipo === "anteprima-fine") inCorso.ascolto.fine();
          else inCorso.ascolto.errore(messaggio.motivo);
        }
        return;
      }
      case "anteprima-ws-aperto":
      case "anteprima-ws-arrivo":
      case "anteprima-ws-chiuso": {
        const canale = this.#canali.get(messaggio.idCanale);
        if (canale === undefined || canale.idAmbiente !== idAmbiente) return;
        if (messaggio.tipo === "anteprima-ws-aperto") {
          canale.ascolto.aperto(messaggio.protocollo);
        } else if (messaggio.tipo === "anteprima-ws-arrivo") {
          if (messaggio.testo !== undefined) canale.ascolto.arrivo(messaggio.testo);
          else if (messaggio.binario !== undefined) canale.ascolto.arrivo(Buffer.from(messaggio.binario, "base64"));
        } else {
          this.#canali.delete(messaggio.idCanale);
          canale.ascolto.chiuso();
        }
        return;
      }
    }
  }

  /** Ferma ciò che viaggiava verso l'applicazione che si stava guardando. */
  #fermaInCorso(): void {
    for (const [idRichiesta, inCorso] of [...this.#richieste]) {
      clearTimeout(inCorso.scadenza);
      this.#richieste.delete(idRichiesta);
      this.#invia(inCorso.idAmbiente, { tipo: "anteprima-annulla", idRichiesta });
      inCorso.ascolto.errore("L'anteprima è stata chiusa.");
    }
    for (const [idCanale, canale] of [...this.#canali]) {
      this.#canali.delete(idCanale);
      this.#invia(canale.idAmbiente, { tipo: "anteprima-ws-chiudi", idCanale });
      canale.ascolto.chiuso();
    }
  }

  #scollegato(idAmbiente: string): void {
    for (const [idRichiesta, inCorso] of [...this.#richieste]) {
      if (inCorso.idAmbiente !== idAmbiente) continue;
      clearTimeout(inCorso.scadenza);
      this.#richieste.delete(idRichiesta);
      inCorso.ascolto.errore("L'ambiente del progetto si è scollegato.");
    }
    for (const [idCanale, canale] of [...this.#canali]) {
      if (canale.idAmbiente !== idAmbiente) continue;
      this.#canali.delete(idCanale);
      canale.ascolto.chiuso();
    }
  }

  #avvisa(): void {
    const stato = this.stato();
    for (const ascoltatore of this.#ascoltatori) ascoltatore(stato);
  }
}
