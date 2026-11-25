/**
 * Come il centro parla con il gateway. Il centro gli chiede lo stato del vault, l'uso di una
 * credenziale per nome, un'operazione del suo browser, un'operazione su uno stack di prova e il
 * registro, e gli riferisce ciò che il proprietario ha deciso di un comando in attesa: il valore
 * di una credenziale protetta non passa mai di qui, e il gateway non offre al centro alcun modo
 * per inserirne, sostituirne o rimuoverne una, né per dichiarare un host per gli stack.
 *
 * Le credenziali in chiaro (ADR 0034) sono l'eccezione scelta dal proprietario: il centro ne legge
 * il valore per Claude, e gli propone quelle che Claude vuole salvare; il gateway le tiene da parte
 * e le salva com'erano solo quando il centro riferisce il sì del proprietario.
 *
 * Due cose il centro le può soltanto chiedere, perché il sì lo raccoglie il gateway dal
 * proprietario, senza passare di qui: un comando sul server su cui gira Shinka, e una versione
 * nuova del gateway stesso.
 *
 * Dal gateway passa anche Telegram: il centro riceve ciò che il proprietario scrive al bot e gli
 * manda messaggi, ma il token del bot e la scelta di chi è il proprietario restano al gateway.
 */

import { existsSync, readFileSync } from "node:fs";
import { request as richiestaHttp } from "node:http";
import { request as richiestaHttps } from "node:https";
import { join } from "node:path";
import type { ChiaviConsegnate } from "../protocollo/estensioni.ts";
import type { EsitoStack, RichiestaStack } from "../protocollo/stack.ts";
import { ATTESA_BROWSER_MS, attesaDelloStack } from "../protocollo/strumenti.ts";
import type {
  EsitoTelegram,
  EventiTelegram,
  FileTelegram,
  MessaggioTelegram,
  StatoTelegram,
  TelegramDalCentro,
} from "../protocollo/telegram.ts";
import {
  type DecisioneApprovazione,
  type EsitoAttesa,
  SECONDI_COMANDO_SU_HOST,
  SECONDI_COMANDO_SU_HOST_MASSIMI,
  type EsitoBrowser,
  type EsitoChiavi,
  type EsitoInChiaro,
  type EsitoLettura,
  type EsitoUso,
  type RichiestaInChiaro,
  type RichiestaLettura,
  type RichiestaBrowser,
  type RichiestaChiavi,
  type RichiestaUso,
  type AmbientePerIlVault,
  type EsitoDelega,
  type UsoDelegato,
  type StatoDelGateway,
  type StatoVault,
  type VaultInBreve,
  type VoceRegistro,
} from "../protocollo/vault.ts";
import { leggiSigillo } from "../protocollo/sigillo.ts";
import type { EsitoProposta, PropostaDiVersione } from "../protocollo/versione.ts";
import { leggiDocker, type DockerDiUnHost } from "../protocollo/risorse.ts";

/** Ciò che il centro sa fare con il gateway. */
export interface PortaGateway {
  /** Il vault com'è adesso: chiesto al gateway ogni volta. */
  stato(): Promise<StatoVault>;
  /** Esegue un comando su un host con una credenziale. Non lancia mai: l'esito dice com'è andata. */
  usa(richiesta: RichiestaUso): Promise<EsitoUso>;
  /**
   * Riferisce al gateway che cosa il proprietario ha deciso di un comando tenuto in attesa.
   * Approvato, il gateway lo esegue com'era: `secondi` dice quanto aspettarlo. Non lancia mai.
   */
  decidi(approvazione: string, decisione: DecisioneApprovazione, secondi?: number): Promise<EsitoUso>;
  /**
   * Chiede com'è finito un comando per cui il sì lo raccoglie il gateway: se non è ancora finito
   * aspetta fino a `attesaS` secondi, e torna prima se il proprietario decide. Non lancia mai.
   */
  attendi(approvazione: string, attesaS: number): Promise<EsitoAttesa>;
  /**
   * Propone al gateway una versione nuova di sé. Il gateway guarda che cosa cambierebbe e, se
   * cambia qualcosa, chiede il sì al proprietario lui stesso. Non lancia mai.
   */
  proponiVersione(proposta: PropostaDiVersione): Promise<EsitoProposta>;
  /** Un'operazione del browser del gateway. Non lancia mai: l'esito dice com'è andata. */
  browser(richiesta: RichiestaBrowser): Promise<EsitoBrowser>;
  /** Un'operazione su uno stack di prova. Non lancia mai: l'esito dice com'è andata. */
  stack(richiesta: RichiestaStack): Promise<EsitoStack>;
  /** Le ultime righe del registro, dalla più recente; vuoto se il gateway non risponde. */
  /** Le chiavi che un'estensione dichiara, per l'ambiente in cui sta per partire: escono dal vault, e il gateway lo scrive nel registro. */
  chiaviEstensione(richiesta: RichiestaChiavi): Promise<ChiaviConsegnate>;
  registro(): Promise<VoceRegistro[]>;
  /** Il valore di una credenziale in chiaro, per un host o un sito in cui vale. Non lancia mai. */
  leggiInChiaro(richiesta: RichiestaLettura): Promise<EsitoLettura>;
  /** Propone una credenziale in chiaro: il gateway la tiene da parte finché il proprietario non decide. Non lancia mai. */
  proponiInChiaro(richiesta: RichiestaInChiaro): Promise<EsitoInChiaro>;
  /** Riferisce la decisione del proprietario su una credenziale in chiaro proposta. Non lancia mai. */
  decidiInChiaro(approvazione: string, decisione: DecisioneApprovazione): Promise<EsitoInChiaro>;
  /** I container degli host per gli stack, con le loro risorse: sola lettura. Non lancia mai. */
  contenitori(): Promise<{ host: DockerDiUnHost[] } | { motivo: string }>;
  /** Collega un ascoltatore: riceve il vault in breve com'è, poi ogni cambiamento. */
  iscrivi(ascoltatore: (breve: VaultInBreve) => void): () => void;
  /** Telegram com'è adesso. */
  telegramStato(): Promise<TelegramDalCentro>;
  /**
   * Ciò che il proprietario ha scritto o premuto nel bot dopo l'evento `dopo`: se non c'è nulla
   * aspetta fino a `attesaS` secondi. Nulla se il gateway non risponde o non ha il bot.
   */
  telegramEventi(dopo: number, attesaS: number): Promise<EventiTelegram | undefined>;
  /** Manda un messaggio al proprietario su Telegram. Non lancia mai: l'esito dice com'è andata. */
  telegramInvia(messaggio: MessaggioTelegram): Promise<EsitoTelegram>;
  /** Cambia un messaggio già mandato; senza pulsanti, quelli che aveva spariscono. Non lancia mai. */
  telegramModifica(idMessaggio: number, messaggio: MessaggioTelegram): Promise<EsitoTelegram>;
  /** Fa vedere al proprietario che Shinka sta scrivendo. */
  telegramScrive(): Promise<void>;
  /** Il contenuto di un file che il proprietario ha mandato al bot. Non lancia mai. */
  telegramScaricaFile(idFile: string): Promise<{ dati: Buffer } | { problema: string }>;
  /** Manda un file al proprietario su Telegram. Non lancia mai: l'esito dice com'è andata. */
  telegramInviaFile(file: FileTelegram, contenuto: Buffer): Promise<EsitoTelegram>;
  /** Gli ambienti che hanno una chiave per ricevere le credenziali (ADR 0062): il gateway li offre al proprietario. */
  ambientiPerIlVault?(ambienti: AmbientePerIlVault[]): Promise<void>;
  /** Le credenziali date a un ambiente, in un sigillo per la chiave del suo nodo. Non lancia mai. */
  delega?(idAmbiente: string, chiave: string): Promise<EsitoDelega>;
  /** Riferisce al gateway un comando eseguito dal nodo di un ambiente, per il registro. Non lancia mai. */
  usoDelegato?(uso: UsoDelegato): Promise<void>;
  chiudi(): void;
}

export interface ConfigurazioneGateway {
  /** Dove il centro raggiunge il gateway, per esempio `http://192.168.1.20:7851`. */
  indirizzo: string;
  /** Il gettone con cui il centro si presenta. */
  gettone: string;
  /** L'indirizzo della pagina del vault per il browser del proprietario; se manca, è `indirizzo`. */
  pagina?: string;
}

/** Quanto il centro aspetta il gateway per una richiesta breve. */
const ATTESA_MS = 8_000;

/** Ogni quanto il centro richiede lo stato del vault, per tenere aggiornata la barra laterale. */
const CONTROLLO_MS = 30_000;

/**
 * Dove sta il gateway: nelle variabili d'ambiente `SHINKA_GATEWAY`, `SHINKA_GATEWAY_GETTONE` e
 * `SHINKA_GATEWAY_PAGINA`, oppure nel file `gateway.json` tra i dati. Nulla se non è configurato.
 */
export function leggiConfigurazioneGateway(dati: string, ambiente: NodeJS.ProcessEnv = process.env): ConfigurazioneGateway | undefined {
  const letta: Record<string, unknown> = {};
  const file = join(dati, "gateway.json");
  if (existsSync(file)) Object.assign(letta, JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>);
  const indirizzo = ambiente.SHINKA_GATEWAY ?? letta.indirizzo;
  const gettone = ambiente.SHINKA_GATEWAY_GETTONE ?? letta.gettone;
  const pagina = ambiente.SHINKA_GATEWAY_PAGINA ?? letta.pagina;
  if (typeof indirizzo !== "string" || indirizzo === "" || typeof gettone !== "string" || gettone === "") return undefined;
  return { indirizzo, gettone, ...(typeof pagina === "string" && pagina !== "" ? { pagina } : {}) };
}

function inBreve(stato: StatoVault): VaultInBreve {
  return {
    gateway: stato.gateway,
    ...(stato.condizione === undefined ? {} : { condizione: stato.condizione }),
    quante: stato.credenziali.length,
  };
}

/** Il centro senza gateway: il vault non c'è, e gli strumenti lo dicono. */
export class GatewayAssente implements PortaGateway {
  stato(): Promise<StatoVault> {
    return Promise.resolve({ gateway: "non-configurato", credenziali: [] });
  }

  usa(): Promise<EsitoUso> {
    return Promise.resolve({
      esito: "rifiutato",
      motivo: "In questa installazione di Shinka il gateway non è configurato: non ci sono credenziali da usare. Dillo al proprietario.",
    });
  }

  decidi(): Promise<EsitoUso> {
    return this.usa();
  }

  leggiInChiaro(): Promise<EsitoLettura> {
    return Promise.resolve({ esito: "rifiutato", motivo: "In questa installazione di Shinka il gateway non è configurato: non ci sono credenziali." });
  }

  contenitori(): Promise<{ motivo: string }> {
    return Promise.resolve({ motivo: "In questa installazione di Shinka il gateway non è configurato." });
  }

  proponiInChiaro(): Promise<EsitoInChiaro> {
    return this.leggiInChiaro() as Promise<EsitoInChiaro>;
  }

  decidiInChiaro(): Promise<EsitoInChiaro> {
    return this.leggiInChiaro() as Promise<EsitoInChiaro>;
  }

  attendi(): Promise<EsitoAttesa> {
    return this.usa();
  }

  proponiVersione(): Promise<EsitoProposta> {
    return Promise.resolve({ esito: "rifiutato", motivo: "In questa installazione di Shinka il gateway non è configurato." });
  }

  browser(): Promise<EsitoBrowser> {
    return Promise.resolve({
      esito: "rifiutato",
      motivo: "In questa installazione di Shinka il gateway non è configurato: il suo browser non c'è. Dillo al proprietario.",
    });
  }

  stack(): Promise<EsitoStack> {
    return Promise.resolve({
      esito: "rifiutato",
      motivo: "In questa installazione di Shinka il gateway non è configurato: gli stack di prova non ci sono. Dillo al proprietario.",
    });
  }

  chiaviEstensione(): Promise<ChiaviConsegnate> {
    return Promise.resolve({ motivo: "in questa installazione di Shinka il gateway non è configurato, e non c'è un vault da cui prendere la chiave" });
  }

  registro(): Promise<VoceRegistro[]> {
    return Promise.resolve([]);
  }

  iscrivi(ascoltatore: (breve: VaultInBreve) => void): () => void {
    ascoltatore({ gateway: "non-configurato", quante: 0 });
    return () => {};
  }

  telegramStato(): Promise<TelegramDalCentro> {
    return Promise.resolve({ condizione: "non-disponibile" });
  }

  telegramEventi(): Promise<EventiTelegram | undefined> {
    return Promise.resolve(undefined);
  }

  telegramInvia(): Promise<EsitoTelegram> {
    return Promise.resolve({ esito: "rifiutato", motivo: "In questa installazione di Shinka il gateway non è configurato: Telegram non c'è." });
  }

  telegramModifica(): Promise<EsitoTelegram> {
    return this.telegramInvia();
  }

  telegramInviaFile(): Promise<EsitoTelegram> {
    return this.telegramInvia();
  }

  telegramScaricaFile(): Promise<{ dati: Buffer } | { problema: string }> {
    return Promise.resolve({ problema: "In questa installazione di Shinka il gateway non è configurato." });
  }

  telegramScrive(): Promise<void> {
    return Promise.resolve();
  }

  chiudi(): void {}
}

export class ClienteGateway implements PortaGateway {
  readonly #cfg: ConfigurazioneGateway;
  readonly #ascoltatori = new Set<(breve: VaultInBreve) => void>();
  readonly #controllo: NodeJS.Timeout;
  #ultimo: VaultInBreve | undefined;

  constructor(cfg: ConfigurazioneGateway) {
    this.#cfg = { ...cfg, indirizzo: cfg.indirizzo.replace(/\/+$/, "") };
    this.#controllo = setInterval(() => void this.stato(), CONTROLLO_MS);
    this.#controllo.unref();
    void this.stato();
  }

  async stato(): Promise<StatoVault> {
    const pagina = this.#cfg.pagina ?? this.#cfg.indirizzo;
    let stato: StatoVault;
    try {
      const risposta = await this.#chiedi("GET", "/api/stato", undefined, ATTESA_MS);
      const letto = risposta.dati as Partial<StatoDelGateway>;
      if (risposta.stato !== 200 || letto.condizione === undefined || !Array.isArray(letto.credenziali)) {
        throw new Error(`Il gateway ha risposto ${risposta.stato}.`);
      }
      stato = {
        gateway: "attivo",
        condizione: letto.condizione,
        credenziali: letto.credenziali,
        ...(typeof letto.versione === "string" ? { versione: letto.versione } : {}),
        ...(letto.siAggiorna === true ? { siAggiorna: true as const } : {}),
        ...(typeof letto.aggiornamento === "object" && letto.aggiornamento !== null ? { aggiornamento: letto.aggiornamento } : {}),
        pagina,
      };
    } catch {
      stato = { gateway: "irraggiungibile", credenziali: [], pagina };
    }
    this.#aggiorna(inBreve(stato));
    return stato;
  }

  async usa(richiesta: RichiestaUso): Promise<EsitoUso> {
    const secondi = Math.min(Math.max(richiesta.secondi ?? SECONDI_COMANDO_SU_HOST, 1), SECONDI_COMANDO_SU_HOST_MASSIMI);
    try {
      const risposta = await this.#chiedi("POST", "/api/uso", { ...richiesta, secondi }, secondi * 1000 + 40_000);
      const esito = risposta.dati as Partial<EsitoUso> & { errore?: unknown };
      if (risposta.stato !== 200 || esito.esito === undefined) {
        return {
          esito: "fallito",
          motivo:
            risposta.stato === 401
              ? "Il gateway non riconosce il centro: il gettone non è quello giusto. Dillo al proprietario."
              : `Il gateway non ha accettato la richiesta${typeof esito.errore === "string" ? `: ${esito.errore}` : "."}`,
        };
      }
      return esito as EsitoUso;
    } catch {
      return {
        esito: "fallito",
        motivo: "Il gateway non risponde: non è detto che il comando sia stato eseguito. Il proprietario lo vede nel registro della pagina Vault.",
      };
    } finally {
      // Un uso cambia ciò che la pagina mostra: quando la credenziale è stata usata l'ultima volta.
      void this.stato();
    }
  }

  async decidi(approvazione: string, decisione: DecisioneApprovazione, secondi: number = SECONDI_COMANDO_SU_HOST): Promise<EsitoUso> {
    const durata = Math.min(Math.max(secondi, 1), SECONDI_COMANDO_SU_HOST_MASSIMI);
    try {
      const risposta = await this.#chiedi(
        "POST",
        `/api/approvazioni/${encodeURIComponent(approvazione)}`,
        { decisione },
        decisione === "approvata" ? durata * 1000 + 40_000 : ATTESA_MS,
      );
      const esito = risposta.dati as Partial<EsitoUso>;
      if (risposta.stato !== 200 || esito.esito === undefined) {
        return { esito: "fallito", motivo: `Il gateway non ha accettato la decisione (risposta ${risposta.stato}): il comando non è stato eseguito.` };
      }
      return esito as EsitoUso;
    } catch {
      return {
        esito: "fallito",
        motivo:
          decisione === "approvata"
            ? "Il gateway non risponde: non è detto che il comando sia stato eseguito. Il proprietario lo vede nel registro della pagina Vault."
            : "Il gateway non risponde: il comando non è stato eseguito.",
      };
    } finally {
      void this.stato();
    }
  }

  async ambientiPerIlVault(ambienti: AmbientePerIlVault[]): Promise<void> {
    try {
      await this.#chiedi("POST", "/api/ambienti", { ambienti }, ATTESA_MS);
    } catch {
      // Il gateway non risponde: glieli si dice al prossimo giro.
    }
  }

  async delega(idAmbiente: string, chiave: string): Promise<EsitoDelega> {
    try {
      const risposta = await this.#chiedi("POST", "/api/delega", { idAmbiente, chiave }, ATTESA_MS);
      if (risposta.stato === 404) return { motivo: "Il gateway installato non sa ancora dare le credenziali a un ambiente: va aggiornato." };
      const esito = risposta.dati as Partial<{ credenziali: number; sigillo: unknown; motivo: string }>;
      if (risposta.stato !== 200) return { motivo: `Il gateway non ha dato le credenziali (risposta ${risposta.stato}).` };
      if (typeof esito.motivo === "string") return { motivo: esito.motivo };
      const sigillo = leggiSigillo(esito.sigillo);
      return { credenziali: typeof esito.credenziali === "number" ? esito.credenziali : 0, ...(sigillo === undefined ? {} : { sigillo }) };
    } catch {
      return { motivo: "Il gateway non risponde." };
    }
  }

  async usoDelegato(uso: UsoDelegato): Promise<void> {
    try {
      await this.#chiedi("POST", "/api/uso/delegato", uso, ATTESA_MS);
    } catch {
      // Il registro di questo comando resta senza la voce: l'esito torna comunque a chi lo ha chiesto.
    }
  }

  async leggiInChiaro(richiesta: RichiestaLettura): Promise<EsitoLettura> {
    try {
      const risposta = await this.#chiedi("POST", "/api/in-chiaro/lettura", richiesta, ATTESA_MS);
      const esito = risposta.dati as Partial<EsitoLettura>;
      if (risposta.stato === 404) return { esito: "rifiutato", motivo: "Il gateway installato non conosce ancora le credenziali in chiaro: va aggiornato." };
      if (risposta.stato !== 200 || esito.esito === undefined) return { esito: "rifiutato", motivo: `Il gateway non ha dato la credenziale (risposta ${risposta.stato}).` };
      return esito as EsitoLettura;
    } catch {
      return { esito: "rifiutato", motivo: "Il gateway non risponde: in questo momento nessuna credenziale si può leggere." };
    } finally {
      void this.stato();
    }
  }

  async contenitori(): Promise<{ host: DockerDiUnHost[] } | { motivo: string }> {
    try {
      const risposta = await this.#chiedi("GET", "/api/contenitori", undefined, 60_000);
      if (risposta.stato === 404) return { motivo: "Il gateway installato non sa ancora leggere i container: va aggiornato." };
      const dati = risposta.dati as { host?: unknown; motivo?: unknown };
      if (risposta.stato !== 200) return { motivo: `Il gateway non ha dato i container (risposta ${risposta.stato}).` };
      if (typeof dati.motivo === "string") return { motivo: dati.motivo.slice(0, 500) };
      const elenco = Array.isArray(dati.host) ? (dati.host as unknown[]) : [];
      return {
        host: elenco.flatMap((voce) => {
          const nome = (voce as { host?: unknown } | null)?.host;
          return typeof nome === "string" ? [{ host: nome.slice(0, 260), ...leggiDocker(voce) }] : [];
        }),
      };
    } catch {
      return { motivo: "Il gateway non risponde." };
    }
  }

  async proponiInChiaro(richiesta: RichiestaInChiaro): Promise<EsitoInChiaro> {
    return this.#inChiaro("/api/in-chiaro", richiesta);
  }

  async decidiInChiaro(approvazione: string, decisione: DecisioneApprovazione): Promise<EsitoInChiaro> {
    return this.#inChiaro(`/api/in-chiaro/${encodeURIComponent(approvazione)}`, { decisione });
  }

  async #inChiaro(percorso: string, corpo: unknown): Promise<EsitoInChiaro> {
    try {
      const risposta = await this.#chiedi("POST", percorso, corpo, ATTESA_MS);
      const esito = risposta.dati as Partial<EsitoInChiaro>;
      if (risposta.stato === 404) return { esito: "rifiutato", motivo: "Il gateway installato non conosce ancora le credenziali in chiaro: va aggiornato." };
      if (risposta.stato !== 200 || esito.esito === undefined) return { esito: "rifiutato", motivo: `Il gateway non ha accettato la richiesta (risposta ${risposta.stato}).` };
      return esito as EsitoInChiaro;
    } catch {
      return { esito: "rifiutato", motivo: "Il gateway non risponde: la credenziale non è stata salvata." };
    } finally {
      void this.stato();
    }
  }

  async attendi(approvazione: string, attesaS: number): Promise<EsitoAttesa> {
    try {
      const risposta = await this.#chiedi("GET", `/api/approvazioni/${encodeURIComponent(approvazione)}?attesa=${attesaS}`, undefined, attesaS * 1000 + ATTESA_MS);
      const esito = risposta.dati as Partial<EsitoAttesa>;
      if (risposta.stato !== 200 || esito.esito === undefined) {
        return { esito: "fallito", motivo: `Il gateway non dice com'è finito il comando (risposta ${risposta.stato}): il proprietario lo vede nel registro della pagina Vault.` };
      }
      return esito as EsitoAttesa;
    } catch {
      return { esito: "fallito", motivo: "Il gateway non risponde: non è detto che il comando sia stato eseguito. Il proprietario lo vede nel registro della pagina Vault." };
    }
  }

  async proponiVersione(proposta: PropostaDiVersione): Promise<EsitoProposta> {
    try {
      const risposta = await this.#chiedi("POST", "/api/aggiornamento", proposta, 60_000);
      const esito = risposta.dati as Partial<EsitoProposta> & { errore?: unknown };
      if (risposta.stato === 404) {
        return { esito: "rifiutato", motivo: "Il gateway installato non sa ancora cambiare versione da dentro: questa volta lo deve aggiornare da fuori chi ha accesso al server." };
      }
      if (risposta.stato !== 200 || esito.esito === undefined) {
        return { esito: "rifiutato", motivo: `Il gateway non ha accettato la proposta${typeof esito.errore === "string" ? `: ${esito.errore}` : ` (risposta ${risposta.stato}).`}` };
      }
      return esito as EsitoProposta;
    } catch {
      return { esito: "rifiutato", motivo: "Il gateway non risponde: la versione non gli è stata proposta." };
    } finally {
      void this.stato();
    }
  }

  async stack(richiesta: RichiestaStack): Promise<EsitoStack> {
    try {
      const risposta = await this.#chiedi("POST", "/api/stack", richiesta, attesaDelloStack(richiesta.operazione === "avvia") + 10_000);
      const esito = risposta.dati as Partial<EsitoStack> & { errore?: unknown };
      if (risposta.stato !== 200 || esito.esito === undefined) {
        return {
          esito: "fallito",
          motivo:
            risposta.stato === 401
              ? "Il gateway non riconosce il centro: il gettone non è quello giusto. Dillo al proprietario."
              : risposta.stato === 404
                ? "Il gateway installato non gestisce ancora gli stack di prova: va aggiornato. Dillo al proprietario."
                : `Il gateway non ha accettato la richiesta${typeof esito.errore === "string" ? `: ${esito.errore}` : "."}`,
        };
      }
      return esito as EsitoStack;
    } catch {
      return { esito: "fallito", motivo: "Il gateway non risponde: non è detto che l'operazione sia stata fatta. Controlla con elenca_stack." };
    } finally {
      void this.stato();
    }
  }

  async browser(richiesta: RichiestaBrowser): Promise<EsitoBrowser> {
    try {
      const risposta = await this.#chiedi("POST", "/api/browser", richiesta, ATTESA_BROWSER_MS + 10_000);
      const esito = risposta.dati as Partial<EsitoBrowser> & { errore?: unknown };
      if (risposta.stato !== 200 || esito.esito === undefined) {
        return {
          esito: "fallito",
          motivo:
            risposta.stato === 401
              ? "Il gateway non riconosce il centro: il gettone non è quello giusto. Dillo al proprietario."
              : risposta.stato === 404
                ? "Il gateway installato non ha ancora il browser: va aggiornato. Dillo al proprietario."
                : `Il gateway non ha accettato la richiesta${typeof esito.errore === "string" ? `: ${esito.errore}` : "."}`,
        };
      }
      return esito as EsitoBrowser;
    } catch {
      return { esito: "fallito", motivo: "Il gateway non risponde: non è detto che l'operazione sia stata fatta. Rileggi la pagina con leggi_sito." };
    } finally {
      if (richiesta.operazione === "inserisci") void this.stato();
    }
  }

  async chiaviEstensione(richiesta: RichiestaChiavi): Promise<ChiaviConsegnate> {
    try {
      const risposta = await this.#chiedi("POST", "/api/chiavi-estensione", richiesta, ATTESA_MS);
      const esito = risposta.dati as Partial<EsitoChiavi> & { errore?: unknown; valori?: unknown; motivo?: unknown };
      if (risposta.stato === 200 && esito.esito === "consegnate" && typeof esito.valori === "object" && esito.valori !== null) {
        return { valori: esito.valori as Record<string, string> };
      }
      if (risposta.stato === 200 && typeof esito.motivo === "string") return { motivo: esito.motivo };
      return {
        motivo:
          risposta.stato === 401
            ? "il gateway non riconosce il centro: il gettone non è quello giusto"
            : risposta.stato === 404
              ? "il gateway installato non consegna ancora le chiavi delle estensioni: va aggiornato"
              : `il gateway non ha accettato la richiesta${typeof esito.errore === "string" ? `: ${esito.errore}` : ""}`,
      };
    } catch {
      return { motivo: "il gateway non risponde, e la chiave sta nel suo vault" };
    } finally {
      // Una consegna cambia ciò che la pagina mostra: quando la chiave è stata usata l'ultima volta.
      void this.stato();
    }
  }

  async registro(): Promise<VoceRegistro[]> {
    try {
      const risposta = await this.#chiedi("GET", "/api/registro", undefined, ATTESA_MS);
      const voci = (risposta.dati as { voci?: unknown }).voci;
      return risposta.stato === 200 && Array.isArray(voci) ? (voci as VoceRegistro[]) : [];
    } catch {
      return [];
    }
  }

  iscrivi(ascoltatore: (breve: VaultInBreve) => void): () => void {
    if (this.#ultimo !== undefined) ascoltatore(this.#ultimo);
    this.#ascoltatori.add(ascoltatore);
    // Chi apre l'interfaccia vede il vault com'è adesso, non com'era all'ultimo controllo.
    void this.stato();
    return () => this.#ascoltatori.delete(ascoltatore);
  }

  async telegramStato(): Promise<TelegramDalCentro> {
    try {
      const risposta = await this.#chiedi("GET", "/api/telegram", undefined, ATTESA_MS);
      const stato = risposta.dati as Partial<StatoTelegram>;
      if (risposta.stato === 200 && typeof stato.condizione === "string") return stato as StatoTelegram;
    } catch {
      // Un gateway che non risponde non ha Telegram da mostrare.
    }
    return { condizione: "non-disponibile" };
  }

  async telegramEventi(dopo: number, attesaS: number): Promise<EventiTelegram | undefined> {
    try {
      const risposta = await this.#chiedi("GET", `/api/telegram/eventi?dopo=${dopo}&attesa=${attesaS}`, undefined, attesaS * 1000 + ATTESA_MS);
      const letto = risposta.dati as Partial<EventiTelegram>;
      if (risposta.stato !== 200 || letto.stato === undefined || !Array.isArray(letto.eventi)) return undefined;
      return letto as EventiTelegram;
    } catch {
      return undefined;
    }
  }

  telegramInvia(messaggio: MessaggioTelegram): Promise<EsitoTelegram> {
    return this.#telegram("/api/telegram/messaggi", messaggio);
  }

  telegramModifica(idMessaggio: number, messaggio: MessaggioTelegram): Promise<EsitoTelegram> {
    return this.#telegram(`/api/telegram/messaggi/${idMessaggio}`, messaggio);
  }

  async telegramScrive(): Promise<void> {
    await this.#chiedi("POST", "/api/telegram/scrive", {}, ATTESA_MS).catch(() => {});
  }

  async telegramScaricaFile(idFile: string): Promise<{ dati: Buffer } | { problema: string }> {
    try {
      const risposta = await this.#chiedi("GET", `/api/telegram/ricevuti/${encodeURIComponent(idFile)}`, undefined, 180_000, true);
      if (risposta.stato === 200 && Buffer.isBuffer(risposta.dati)) return { dati: risposta.dati };
      const errore = (risposta.dati as { errore?: unknown }).errore;
      if (risposta.stato === 404 && errore === undefined) return { problema: "Il gateway installato non sa ancora ricevere file da Telegram: va aggiornato." };
      return { problema: typeof errore === "string" ? errore : `Il gateway non ha dato il file (${risposta.stato}).` };
    } catch {
      return { problema: "Il gateway non risponde." };
    }
  }

  async telegramInviaFile(file: FileTelegram, contenuto: Buffer): Promise<EsitoTelegram> {
    const domanda = new URLSearchParams({ nome: file.nome, tipo: file.tipo });
    if (file.didascalia !== undefined) domanda.set("didascalia", file.didascalia);
    if (file.comeFoto === true) domanda.set("foto", "1");
    try {
      // Mandare un file grosso a Telegram dura: il gateway può anche riprovare una volta.
      const risposta = await this.#chiedi("POST", `/api/telegram/file?${domanda.toString()}`, contenuto, 400_000);
      const esito = risposta.dati as Partial<EsitoTelegram>;
      if (risposta.stato === 404) {
        return { esito: "fallito", motivo: "Il gateway installato non sa ancora mandare file su Telegram: va aggiornato." };
      }
      if (esito.esito === undefined) return { esito: "fallito", motivo: `Il gateway non ha accettato il file (${risposta.stato}).` };
      return esito as EsitoTelegram;
    } catch {
      return { esito: "fallito", motivo: "Il gateway non risponde." };
    }
  }

  async #telegram(percorso: string, messaggio: MessaggioTelegram): Promise<EsitoTelegram> {
    try {
      // Il gateway può riprovare da sé, dopo l'attesa che Telegram gli chiede.
      const risposta = await this.#chiedi("POST", percorso, messaggio, 60_000);
      const esito = risposta.dati as Partial<EsitoTelegram> & { errore?: unknown };
      if (risposta.stato !== 200 || esito.esito === undefined) {
        return {
          esito: "fallito",
          motivo:
            risposta.stato === 404
              ? "Il gateway installato non ha ancora Telegram: va aggiornato."
              : `Il gateway non ha accettato il messaggio${typeof esito.errore === "string" ? `: ${esito.errore}` : "."}`,
        };
      }
      return esito as EsitoTelegram;
    } catch {
      return { esito: "fallito", motivo: "Il gateway non risponde." };
    }
  }

  chiudi(): void {
    clearInterval(this.#controllo);
  }

  #aggiorna(breve: VaultInBreve): void {
    const prima = this.#ultimo;
    if (prima?.gateway === breve.gateway && prima.condizione === breve.condizione && prima.quante === breve.quante) return;
    this.#ultimo = breve;
    for (const ascoltatore of this.#ascoltatori) ascoltatore(breve);
  }

  /**
   * Una richiesta al gateway. Non usa `fetch`, che smette di aspettare la risposta dopo cinque
   * minuti: un comando su un host può durare di più.
   */
  #chiedi(
    metodo: "GET" | "POST",
    percorso: string,
    corpo: unknown,
    attesaMs: number,
    /** Vero per avere il contenuto così com'è quando la risposta va bene, invece che letto come JSON. */
    grezzo = false,
  ): Promise<{ stato: number; dati: unknown }> {
    return new Promise((risolvi, rifiuta) => {
      const indirizzo = new URL(`${this.#cfg.indirizzo}${percorso}`);
      // Un file viaggia così com'è; tutto il resto in JSON.
      const binario = Buffer.isBuffer(corpo);
      const testo = corpo === undefined ? undefined : binario ? corpo : JSON.stringify(corpo);
      const richiesta = (indirizzo.protocol === "https:" ? richiestaHttps : richiestaHttp)(
        indirizzo,
        {
          method: metodo,
          headers: {
            authorization: `Bearer ${this.#cfg.gettone}`,
            ...(testo === undefined
              ? {}
              : {
                  "content-type": binario ? "application/octet-stream" : "application/json",
                  "content-length": Buffer.byteLength(testo),
                }),
          },
        },
        (risposta) => {
          const pezzi: Buffer[] = [];
          risposta.on("data", (pezzo: Buffer) => pezzi.push(pezzo));
          risposta.on("error", rifiuta);
          risposta.on("end", () => {
            if (grezzo && risposta.statusCode === 200) return risolvi({ stato: 200, dati: Buffer.concat(pezzi) });
            let dati: unknown = {};
            try {
              dati = JSON.parse(Buffer.concat(pezzi).toString("utf8"));
            } catch {
              // Una risposta che non è JSON vale come vuota: conta lo stato.
            }
            risolvi({ stato: risposta.statusCode ?? 0, dati: typeof dati === "object" && dati !== null ? dati : {} });
          });
        },
      );
      richiesta.setTimeout(attesaMs, () => richiesta.destroy(new Error("Il gateway non ha risposto in tempo.")));
      richiesta.on("error", rifiuta);
      richiesta.end(testo);
    });
  }
}

/** Il gateway configurato tra i dati del centro, oppure quello assente. */
export function apriGateway(dati: string, ambiente: NodeJS.ProcessEnv = process.env): PortaGateway {
  const cfg = leggiConfigurazioneGateway(dati, ambiente);
  return cfg === undefined ? new GatewayAssente() : new ClienteGateway(cfg);
}
