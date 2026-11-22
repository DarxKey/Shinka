/**
 * Le approvazioni del proprietario per i comandi sugli host per gli stack di prova.
 *
 * Su quegli host Claude gestisce da sé soltanto gli stack creati da Shinka. Un comando libero
 * tocca i servizi del proprietario: il gateway lo tiene da parte, e il centro lo mostra nella
 * conversazione che lo ha chiesto, con il tempo che resta. Il gateway esegue il comando che ha
 * tenuto, non uno che gli arriva insieme alla decisione.
 *
 * Se il proprietario ha appena dato il consenso proprio a quel comando, dalla scheda con cui la
 * conversazione gli chiede il permesso, non gli si chiede una seconda volta: quel consenso vale
 * come approvazione, una volta sola e per poco.
 *
 * Sul server su cui gira Shinka è diverso: chi comanda lì può tutto, gateway compreso, e un sì
 * riferito dal centro non basta. Il sì lo chiede il gateway al proprietario, lui stesso; il
 * centro mostra la scheda perché si veda che cosa aspetta, lascia negare, e aspetta l'esito.
 */

import { randomUUID } from "node:crypto";
import type { DecisionePermesso, EsitoApprovazione, EventoConversazione } from "../protocollo/eventi.ts";
import { nomePerHarness } from "../protocollo/strumenti.ts";
import { APPROVAZIONE_MS, type EsitoAttesa, type EsitoInChiaro, type EsitoUso } from "../protocollo/vault.ts";
import type { Canale } from "./canale.ts";
import type { PortaGateway } from "./gateway.ts";

/** Per quanto il consenso dato dalla scheda dei permessi vale come approvazione. */
const CONSENSO_MS = 2 * 60 * 1000;

/** Il comando che aspetta, come lo ha tenuto il gateway. */
export interface ComandoInAttesa {
  /** Il nome con cui il gateway conosce questa attesa: non esce dal centro. */
  approvazione: string;
  scadeIl: string;
  credenziale: string;
  host: string;
  comando: string;
  secondi?: number;
  /** Vero se il sì lo raccoglie il gateway: il centro non lo può dare. */
  alGateway?: true;
}

/** Una credenziale in chiaro che il gateway tiene da parte: come la si mostra, senza il valore. */
export interface CredenzialeInAttesa {
  approvazione: string;
  scadeIl: string;
  nome: string;
  host: string[];
  /** Che cosa contiene, in parole per il proprietario: tipo e utente. */
  descrizione: string;
}

/** Per quanto una scheda che non passa dal gateway aspetta il proprietario. */
const ATTESA_SCHEDA_MS = APPROVAZIONE_MS;

/** Ogni quanto il centro torna a chiedere al gateway com'è finito un comando che aspetta il sì dato a lui. */
const ATTESA_AL_GATEWAY_S = 25;

export interface OpzioniApprovazioni {
  gateway: PortaGateway;
  /** Dove si pubblica ciò che riguarda una conversazione, data la sua chiave; nulla se non è aperta. */
  pubblica(chiave: string): ((evento: EventoConversazione) => void) | undefined;
  adesso?: () => number;
}

interface Attesa {
  chiave: string;
  /** Vero se da qui si può solo negare. */
  alGateway?: true;
  decidi(esito: EsitoApprovazione): void;
}

interface Consenso {
  chiave: string;
  credenziale: string;
  host: string;
  comando: string;
  finoA: number;
}

function campo(ingresso: unknown, nome: string): string | undefined {
  if (typeof ingresso !== "object" || ingresso === null) return undefined;
  const valore = (ingresso as Record<string, unknown>)[nome];
  return typeof valore === "string" ? valore : undefined;
}

/**
 * Il proprietario ha deciso di un permesso, dall'interfaccia o da Telegram: se ha dato il consenso
 * a un comando su un host, quel consenso vale anche come approvazione per quel comando esatto.
 * Va chiamato prima di riferire la decisione alla conversazione.
 */
export function consensoDato(
  approvazioni: Approvazioni | undefined,
  chiave: string,
  canale: Canale | undefined,
  idPermesso: string,
  decisione: DecisionePermesso,
): void {
  if (decisione !== "approvato" || approvazioni === undefined || canale === undefined || canale.sospesi.permessi === 0) return;
  for (let posto = canale.archiviati.length - 1; posto >= 0; posto -= 1) {
    const evento = canale.archiviati[posto]?.evento;
    if (evento?.tipo === "permesso-deciso" && evento.idPermesso === idPermesso) return;
    if (evento?.tipo === "permesso-richiesto" && evento.idPermesso === idPermesso) {
      approvazioni.consenso(chiave, evento.strumento, evento.ingresso);
      return;
    }
  }
}

export class Approvazioni {
  readonly #o: OpzioniApprovazioni;
  readonly #inAttesa = new Map<string, Attesa>();
  #consensi: Consenso[] = [];

  constructor(opzioni: OpzioniApprovazioni) {
    this.#o = opzioni;
  }

  #adesso(): number {
    return this.#o.adesso?.() ?? Date.now();
  }

  /**
   * Il gateway tiene da parte un comando: lo mostra al proprietario nella conversazione `chiave`,
   * aspetta che decida o che il tempo finisca, e restituisce ciò che il gateway ne ha fatto.
   */
  async chiedi(chiave: string, comando: ComandoInAttesa): Promise<EsitoUso> {
    const { gateway } = this.#o;
    if (comando.alGateway === true) return this.#chiediAlGateway(chiave, comando);
    if (this.#consuma(chiave, comando)) return gateway.decidi(comando.approvazione, "approvata", comando.secondi);

    const pubblica = this.#o.pubblica(chiave);
    if (pubblica === undefined) {
      await gateway.decidi(comando.approvazione, "negata");
      return { esito: "rifiutato", motivo: "Questo comando chiede l'approvazione del proprietario, e in questo momento non c'è modo di chiedergliela." };
    }

    const idApprovazione = randomUUID();
    const esito = await new Promise<EsitoApprovazione>((deciso) => {
      const resta = Math.max(Date.parse(comando.scadeIl) - this.#adesso(), 0);
      const timer = setTimeout(() => chiudi("scaduta"), Number.isFinite(resta) ? resta : 0);
      timer.unref();
      const chiudi = (come: EsitoApprovazione): void => {
        if (!this.#inAttesa.delete(idApprovazione)) return;
        clearTimeout(timer);
        deciso(come);
      };
      this.#inAttesa.set(idApprovazione, { chiave, decidi: chiudi });
      pubblica({
        tipo: "approvazione-richiesta",
        idApprovazione,
        host: comando.host,
        credenziale: comando.credenziale,
        comando: comando.comando,
        scadeIl: comando.scadeIl,
      });
    });
    // La scheda cambia subito: il comando, se approvato, può durare.
    pubblica({ tipo: "approvazione-decisa", idApprovazione, esito });
    return gateway.decidi(comando.approvazione, esito, comando.secondi);
  }

  /**
   * Il sì lo raccoglie il gateway: qui si mostra che cosa aspetta, si lascia negare e si torna a
   * chiedere al gateway finché non dice com'è finita.
   */
  async #chiediAlGateway(chiave: string, comando: ComandoInAttesa): Promise<EsitoUso> {
    const { gateway } = this.#o;
    const pubblica = this.#o.pubblica(chiave);
    const idApprovazione = randomUUID();
    this.#inAttesa.set(idApprovazione, {
      chiave,
      alGateway: true,
      // Dalla scheda si può solo ritirare la richiesta: il gateway la chiude come negata.
      decidi: () => void gateway.decidi(comando.approvazione, "negata"),
    });
    pubblica?.({
      tipo: "approvazione-richiesta",
      idApprovazione,
      host: comando.host,
      credenziale: comando.credenziale,
      comando: comando.comando,
      scadeIl: comando.scadeIl,
      alGateway: true,
    });
    let detta = false;
    const di = (esito: EsitoApprovazione): void => {
      if (detta) return;
      detta = true;
      this.#inAttesa.delete(idApprovazione);
      // La scheda cambia appena il proprietario decide: il comando, se approvato, può durare.
      pubblica?.({ tipo: "approvazione-decisa", idApprovazione, esito });
    };
    // Oltre la scadenza resta il tempo del comando: poi, se il gateway non dice nulla, si smette di chiedere.
    const entro = Date.parse(comando.scadeIl) + ((comando.secondi ?? 0) + 120) * 1000;
    let esito: EsitoAttesa;
    for (;;) {
      esito = await gateway.attendi(comando.approvazione, ATTESA_AL_GATEWAY_S);
      if (esito.decisione !== undefined) di(esito.decisione);
      if (esito.esito !== "da-approvare") break;
      if (!(this.#adesso() < entro)) {
        esito = { esito: "fallito", motivo: "Il gateway non ha detto com'è finito questo comando: il proprietario lo vede nel registro della pagina Vault." };
        break;
      }
    }
    di(esito.esito === "eseguito" ? "approvata" : "scaduta");
    const { decisione: _decisione, ...uso } = esito;
    return uso as EsitoUso;
  }

  /**
   * Claude propone di salvare una credenziale in chiaro, e il gateway la tiene da parte: la si
   * mostra al proprietario nella conversazione `chiave`, e si riferisce al gateway il suo sì o il
   * suo no. Il gateway salva ciò che aveva tenuto, non ciò che passa di qui.
   */
  async chiediCredenziale(chiave: string, proposta: CredenzialeInAttesa): Promise<EsitoInChiaro> {
    const { gateway } = this.#o;
    const pubblica = this.#o.pubblica(chiave);
    if (pubblica === undefined) {
      await gateway.decidiInChiaro(proposta.approvazione, "negata");
      return { esito: "rifiutato", motivo: "Salvare una credenziale chiede il sì del proprietario, e in questo momento non c'è modo di chiederglielo." };
    }
    const idApprovazione = randomUUID();
    const esito = await new Promise<EsitoApprovazione>((deciso) => {
      const resta = Math.max(Date.parse(proposta.scadeIl) - this.#adesso(), 0);
      const timer = setTimeout(() => chiudi("scaduta"), Number.isFinite(resta) ? resta : 0);
      timer.unref();
      const chiudi = (come: EsitoApprovazione): void => {
        if (!this.#inAttesa.delete(idApprovazione)) return;
        clearTimeout(timer);
        deciso(come);
      };
      this.#inAttesa.set(idApprovazione, { chiave, decidi: chiudi });
      pubblica({
        tipo: "approvazione-richiesta",
        idApprovazione,
        genere: "credenziale",
        host: proposta.host.join(", "),
        credenziale: proposta.nome,
        comando: proposta.descrizione,
        scadeIl: proposta.scadeIl,
      });
    });
    pubblica({ tipo: "approvazione-decisa", idApprovazione, esito });
    return gateway.decidiInChiaro(proposta.approvazione, esito);
  }

  /**
   * Una conversazione propone un lavoro programmato: la scheda compare lì, e il lavoro nasce solo
   * se il proprietario la approva in tempo. Qui il gateway non c'entra.
   */
  async chiediProgrammato(chiave: string, scheda: { titolo: string; quando: string; istruzione: string }): Promise<EsitoApprovazione> {
    const pubblica = this.#o.pubblica(chiave);
    if (pubblica === undefined) return "negata";
    const idApprovazione = randomUUID();
    const scade = this.#adesso() + ATTESA_SCHEDA_MS;
    const esito = await new Promise<EsitoApprovazione>((deciso) => {
      const timer = setTimeout(() => chiudi("scaduta"), ATTESA_SCHEDA_MS);
      timer.unref();
      const chiudi = (come: EsitoApprovazione): void => {
        if (!this.#inAttesa.delete(idApprovazione)) return;
        clearTimeout(timer);
        deciso(come);
      };
      this.#inAttesa.set(idApprovazione, { chiave, decidi: chiudi });
      pubblica({
        tipo: "approvazione-richiesta",
        idApprovazione,
        genere: "programmato",
        host: scheda.quando,
        credenziale: scheda.titolo,
        comando: scheda.istruzione,
        scadeIl: new Date(scade).toISOString(),
      });
    });
    pubblica({ tipo: "approvazione-decisa", idApprovazione, esito });
    return esito;
  }

  /** Il proprietario ha deciso dalla scheda. Falso se quell'approvazione non è più in attesa, o se da qui non si può approvare. */
  decidi(idApprovazione: string, decisione: "approvata" | "negata"): boolean {
    const attesa = this.#inAttesa.get(idApprovazione);
    if (attesa === undefined) return false;
    if (attesa.alGateway === true && decisione === "approvata") return false;
    attesa.decidi(decisione);
    return true;
  }

  /**
   * Il proprietario ha dato il consenso a un'azione dalla scheda dei permessi di una
   * conversazione. Se era un comando su un host, quel consenso vale come approvazione per quel
   * comando esatto: si ricorda per poco, e si usa una volta.
   */
  consenso(chiave: string, strumento: string, ingresso: unknown): void {
    if (strumento !== nomePerHarness("esegui_su_host")) return;
    const credenziale = campo(ingresso, "credenziale");
    const host = campo(ingresso, "host");
    const comando = campo(ingresso, "comando");
    if (credenziale === undefined || host === undefined || comando === undefined) return;
    const adesso = this.#adesso();
    this.#consensi = this.#consensi.filter((consenso) => consenso.finoA > adesso);
    this.#consensi.push({ chiave, credenziale, host, comando, finoA: adesso + CONSENSO_MS });
  }

  /** Quante approvazioni aspettano il proprietario. */
  get inAttesa(): number {
    return this.#inAttesa.size;
  }

  #consuma(chiave: string, comando: ComandoInAttesa): boolean {
    const adesso = this.#adesso();
    const posto = this.#consensi.findIndex(
      (consenso) =>
        consenso.finoA > adesso &&
        consenso.chiave === chiave &&
        consenso.credenziale === comando.credenziale &&
        consenso.host === comando.host &&
        consenso.comando === comando.comando,
    );
    if (posto === -1) return false;
    this.#consensi.splice(posto, 1);
    return true;
  }
}
