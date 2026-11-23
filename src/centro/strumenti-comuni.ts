/**
 * Ciò che fanno gli strumenti comuni di Shinka: quelli per la memoria, per le skill, per le
 * credenziali del vault, per il browser del gateway, per gli stack di prova e per proporre
 * l'anteprima. Si eseguono sempre qui al centro, da qualunque conversazione e ambiente arrivi la
 * richiesta; quelli del vault, del browser e degli stack il centro li passa al gateway, che
 * decide ed esegue.
 */

import { GRUPPO_SKILL } from "../protocollo/skill.ts";
import { eIncarico, progettoDellaConversazione } from "../protocollo/incarichi.ts";
import type { EsitoStack, RichiestaStack } from "../protocollo/stack.ts";
import { eStrumentoComune, type EsitoStrumento } from "../protocollo/strumenti.ts";
import { AZIONI_NEL_SITO, TIPI_IN_CHIARO, type AzioneNelSito, type EsitoBrowser, type TipoInChiaro } from "../protocollo/vault.ts";
import type { Approvazioni } from "./approvazioni.ts";
import { GatewayAssente, type PortaGateway } from "./gateway.ts";
import { VoceRifiutata, type Memoria } from "./memoria.ts";
import { SkillRifiutata, type RegistroSkill } from "./skill.ts";

/** La conversazione che usa uno strumento. */
export interface ChiChiama {
  /** Il nome con cui la memoria conosce la conversazione, lo stesso con cui le viene consegnata. */
  chiave: string;
  /** Da dove viene la richiesta, in parole per il proprietario: "Home", oppure `Progetto "Nome"`. */
  origine: string;
  /** Vero se chiama la conversazione di un incarico del progetto: non affida incarichi e non installa (ADR 0051). */
  daUnIncarico?: true;
}

/**
 * Chi chiama da una conversazione di progetto: il progetto stesso, oppure un suo incarico, i cui
 * strumenti valgono per il progetto (ADR 0051).
 */
export function chiDiUnProgetto(idConversazione: string, nomeDelProgetto: (idProgetto: string) => string | undefined): ChiChiama {
  const idProgetto = progettoDellaConversazione(idConversazione);
  return {
    chiave: idProgetto,
    origine: `Progetto "${nomeDelProgetto(idProgetto) ?? idProgetto}"`,
    ...(eIncarico(idConversazione) ? { daUnIncarico: true as const } : {}),
  };
}

/** La chiave della conversazione di un argomento della Home. */
export function chiaveDellaHome(idArgomento: string): string {
  return `home:${idArgomento}`;
}

function riuscito(testo: string): EsitoStrumento {
  return { testo };
}

function fallito(testo: string): EsitoStrumento {
  return { testo, errore: true };
}

function testo(argomenti: unknown, nome: string): string | undefined {
  if (typeof argomenti !== "object" || argomenti === null) return undefined;
  const valore = (argomenti as Record<string, unknown>)[nome];
  return typeof valore === "string" ? valore : undefined;
}

function vero(argomenti: unknown, nome: string): boolean {
  return typeof argomenti === "object" && argomenti !== null && (argomenti as Record<string, unknown>)[nome] === true;
}

/** Propone al proprietario l'anteprima di un progetto: controlla che sulla porta risponda qualcosa. */
export type ProponiAnteprima = (idProgetto: string, porta: unknown, percorso: unknown) => Promise<EsitoStrumento>;

/** Gli strumenti dell'applicazione di un progetto: `chiave` è chi li usa, un progetto o la Home. */
export type StrumentiApplicazione = (chiave: string, nome: string, argomenti: Record<string, unknown>) => Promise<EsitoStrumento>;

/** Gli strumenti dei lavori programmati: `chi` è la conversazione che li usa, ed è lì che il lavoro girerà. */
export type StrumentiProgrammati = (chi: ChiChiama, nome: string, argomenti: Record<string, unknown>) => Promise<EsitoStrumento>;

/** Gli strumenti delle cartelle collegate di un progetto (ADR 0050): `chiave` è il progetto che li usa. */
export type StrumentiCollegate = (chiave: string, nome: string, argomenti: Record<string, unknown>) => Promise<EsitoStrumento>;

/** Chi guida un progetto affida un incarico a chi implementa, e ne aspetta la fine (ADR 0051). */
export type AffidaIncarico = (idProgetto: string, argomenti: unknown) => Promise<EsitoStrumento>;

/** Il progetto Shinka chiede di installare la versione che ha scritto: la si prepara, la si prova e si mostra la scheda. */
export type ChiediInstallazione = (idProgetto: string, riassunto: unknown) => Promise<EsitoStrumento>;

export class StrumentiComuni {
  readonly #memoria: Memoria;
  readonly #skill: RegistroSkill;
  readonly #gateway: PortaGateway;
  readonly #proponiAnteprima: ProponiAnteprima | undefined;
  readonly #approvazioni: Approvazioni | undefined;
  readonly #chiediInstallazione: ChiediInstallazione | undefined;
  readonly #aggiornaGateway: ChiediInstallazione | undefined;
  readonly #applicazioni: StrumentiApplicazione | undefined;
  readonly #programmati: StrumentiProgrammati | undefined;
  readonly #collegate: StrumentiCollegate | undefined;
  readonly #affidaIncarico: AffidaIncarico | undefined;

  constructor(
    memoria: Memoria,
    skill: RegistroSkill,
    gateway: PortaGateway = new GatewayAssente(),
    proponiAnteprima?: ProponiAnteprima,
    /** Come si chiede al proprietario di approvare un comando su un host per gli stack. */
    approvazioni?: Approvazioni,
    /** Come il progetto Shinka chiede di installare una versione. Senza, lo sviluppo di Shinka qui non c'è. */
    chiediInstallazione?: ChiediInstallazione,
    /** Come il progetto Shinka propone al gateway la versione in funzione. */
    aggiornaGateway?: ChiediInstallazione,
    /** Come si avvia, si ferma e si guarda l'applicazione di un progetto. */
    applicazioni?: StrumentiApplicazione,
    /** Come una conversazione propone, elenca e toglie i lavori programmati. */
    programmati?: StrumentiProgrammati,
    /** Come un progetto lavora nelle sue cartelle collegate. */
    collegate?: StrumentiCollegate,
    /** Come chi guida un progetto affida un incarico. */
    affidaIncarico?: AffidaIncarico,
  ) {
    this.#affidaIncarico = affidaIncarico;
    this.#collegate = collegate;
    this.#applicazioni = applicazioni;
    this.#programmati = programmati;
    this.#memoria = memoria;
    this.#skill = skill;
    this.#gateway = gateway;
    this.#proponiAnteprima = proponiAnteprima;
    this.#approvazioni = approvazioni;
    this.#chiediInstallazione = chiediInstallazione;
    this.#aggiornaGateway = aggiornaGateway;
  }

  /** Esegue uno strumento per conto di una conversazione. Non lancia mai: l'errore è nella risposta. */
  async esegui(chi: ChiChiama, nome: unknown, argomenti: unknown): Promise<EsitoStrumento> {
    if (!eStrumentoComune(nome)) return fallito("Questo strumento non esiste.");
    // Chi svolge un incarico lavora per chi guida: a affidare, installare e proporre versioni è lui.
    if (chi.daUnIncarico === true && (nome === "affida_incarico" || nome === "chiedi_installazione" || nome === "aggiorna_gateway")) {
      return fallito("Chi svolge un incarico non lo può fare: scrivilo nel resoconto, e lo farà chi guida il progetto.");
    }
    try {
      switch (nome) {
        case "ricorda":
          return await this.#ricorda(chi, argomenti);
        case "correggi_memoria":
          return await this.#correggi(chi, argomenti);
        case "dimentica":
          return await this.#dimentica(chi, argomenti);
        case "leggi_skill":
          return await this.#leggiSkill(argomenti);
        case "salva_skill":
          return await this.#salvaSkill(chi, argomenti);
        case "elenca_credenziali":
          return await this.#elencaCredenziali();
        case "esegui_su_host":
          return await this.#eseguiSuHost(chi, argomenti);
        case "leggi_credenziale":
          return await this.#leggiCredenziale(chi, argomenti);
        case "salva_credenziale_in_chiaro":
          return await this.#salvaInChiaro(chi, argomenti);
        case "apri_sito": {
          const indirizzo = testo(argomenti, "indirizzo");
          if (indirizzo === undefined) return fallito("Manca l'indirizzo del sito.");
          return this.#delBrowser(await this.#gateway.browser({ ...this.#perIlBrowser(chi), operazione: "apri", indirizzo }));
        }
        case "leggi_sito":
          return this.#delBrowser(
            await this.#gateway.browser({ ...this.#perIlBrowser(chi), operazione: "leggi", immagine: vero(argomenti, "immagine") }),
          );
        case "agisci_nel_sito": {
          const azione = testo(argomenti, "azione");
          if (azione === undefined || !(AZIONI_NEL_SITO as readonly string[]).includes(azione)) {
            return fallito(`L'azione è una tra: ${AZIONI_NEL_SITO.join(", ")}.`);
          }
          const elemento = testo(argomenti, "elemento");
          const scritto = testo(argomenti, "testo");
          return this.#delBrowser(
            await this.#gateway.browser({
              ...this.#perIlBrowser(chi),
              operazione: "agisci",
              azione: azione as AzioneNelSito,
              ...(elemento === undefined ? {} : { elemento }),
              ...(scritto === undefined ? {} : { testo: scritto }),
              ...(vero(argomenti, "invio") ? { invio: true } : {}),
            }),
          );
        }
        case "inserisci_credenziale": {
          const credenziale = testo(argomenti, "credenziale");
          if (credenziale === undefined) return fallito("Manca il nome della credenziale.");
          const campoUtente = testo(argomenti, "campo_utente");
          const campoPassword = testo(argomenti, "campo_password");
          return this.#delBrowser(
            await this.#gateway.browser({
              ...this.#perIlBrowser(chi),
              operazione: "inserisci",
              credenziale,
              ...(campoUtente === undefined ? {} : { campoUtente }),
              ...(campoPassword === undefined ? {} : { campoPassword }),
            }),
          );
        }
        case "chiudi_sito":
          return this.#delBrowser(await this.#gateway.browser({ ...this.#perIlBrowser(chi), operazione: "chiudi" }));
        case "elenca_stack": {
          const host = testo(argomenti, "host");
          return this.#delloStack({ conversazione: chi.origine, operazione: "elenca", ...(host === undefined || host.trim() === "" ? {} : { host }) });
        }
        case "avvia_stack": {
          const host = testo(argomenti, "host");
          if (host === undefined) return fallito("Manca l'host su cui avviare lo stack: elenca_stack dice quali sono gli host per gli stack.");
          const campi = argomenti as Record<string, unknown>;
          // La descrizione passa com'è: a leggerla e a tenerla nel recinto è il gateway.
          return this.#delloStack({
            conversazione: chi.origine,
            operazione: "avvia",
            host,
            stack: { nome: campi.nome, servizi: campi.servizi, ...(campi.file === undefined ? {} : { file: campi.file }) },
          });
        }
        case "leggi_stack":
        case "ferma_stack":
        case "rimuovi_stack": {
          const host = testo(argomenti, "host");
          const stack = testo(argomenti, "nome");
          if (host === undefined || stack === undefined) return fallito("Servono l'host e il nome dello stack.");
          const base = { conversazione: chi.origine, host, nome: stack };
          if (nome === "ferma_stack") return this.#delloStack({ ...base, operazione: "ferma" });
          if (nome === "rimuovi_stack") return this.#delloStack({ ...base, operazione: "rimuovi", ...(vero(argomenti, "tieni_dati") ? { tieniDati: true } : {}) });
          const righe = (argomenti as Record<string, unknown>).righe;
          return this.#delloStack({ ...base, operazione: "leggi", ...(typeof righe === "number" && Number.isFinite(righe) ? { righe: Math.round(righe) } : {}) });
        }
        case "proponi_anteprima": {
          if (this.#proponiAnteprima === undefined) {
            return fallito("In questa installazione di Shinka l'anteprima non è accesa.");
          }
          const campi = typeof argomenti === "object" && argomenti !== null ? (argomenti as Record<string, unknown>) : {};
          // La chiave di un progetto è il suo identificativo: per la Home non corrisponde a nessun progetto.
          return await this.#proponiAnteprima(chi.chiave, campi.porta, campi.percorso ?? "/");
        }
        case "imposta_anteprima":
        case "avvia_anteprima":
        case "ferma_anteprima":
        case "stato_anteprima": {
          if (this.#applicazioni === undefined) return fallito("In questa installazione di Shinka l'anteprima non è accesa.");
          const campi = typeof argomenti === "object" && argomenti !== null ? (argomenti as Record<string, unknown>) : {};
          return await this.#applicazioni(chi.chiave, nome, campi);
        }
        case "chiedi_installazione": {
          if (this.#chiediInstallazione === undefined) {
            return fallito("In questa installazione di Shinka lo sviluppo di Shinka non è acceso.");
          }
          // La chiave di un progetto è il suo identificativo: a dire se è il progetto Shinka è chi installa.
          return await this.#chiediInstallazione(chi.chiave, testo(argomenti, "riassunto"));
        }
        case "programma_lavoro":
        case "elenca_programmati":
        case "togli_programmato": {
          if (this.#programmati === undefined) return fallito("In questa installazione di Shinka i lavori programmati non ci sono.");
          const campi = typeof argomenti === "object" && argomenti !== null ? (argomenti as Record<string, unknown>) : {};
          return await this.#programmati(chi, nome, campi);
        }
        case "cartelle_collegate":
        case "esegui_nella_collegata":
        case "leggi_nella_collegata":
        case "scrivi_nella_collegata":
        case "modifica_nella_collegata": {
          if (this.#collegate === undefined) return fallito("In questa installazione di Shinka le cartelle collegate non ci sono.");
          const campi = typeof argomenti === "object" && argomenti !== null ? (argomenti as Record<string, unknown>) : {};
          return await this.#collegate(chi.chiave, nome, campi);
        }
        case "affida_incarico": {
          if (this.#affidaIncarico === undefined) return fallito("In questa installazione di Shinka gli incarichi non ci sono.");
          return await this.#affidaIncarico(chi.chiave, argomenti);
        }
        case "aggiorna_gateway": {
          if (this.#aggiornaGateway === undefined) {
            return fallito("In questa installazione di Shinka lo sviluppo di Shinka non è acceso.");
          }
          return await this.#aggiornaGateway(chi.chiave, testo(argomenti, "riassunto"));
        }
      }
    } catch (errore) {
      if (errore instanceof VoceRifiutata || errore instanceof SkillRifiutata) return fallito(errore.message);
      return fallito(`Non è stato possibile: ${errore instanceof Error ? errore.message : String(errore)}`);
    }
  }

  async #ricorda(chi: ChiChiama, argomenti: unknown): Promise<EsitoStrumento> {
    const daAnnotare = testo(argomenti, "testo");
    if (daAnnotare === undefined) return fallito("Manca il testo della voce.");
    const quante = this.#memoria.voci().length;
    const voce = await this.#memoria.annota(daAnnotare, Date.now(), chi.chiave);
    return riuscito(
      this.#memoria.voci().length === quante
        ? `Era già in memoria: [${voce.id}] ${voce.testo}`
        : `Annotato in memoria: [${voce.id}] ${voce.testo}\nVale da adesso in ogni conversazione, e il proprietario lo vede nella pagina Memoria.`,
    );
  }

  async #correggi(chi: ChiChiama, argomenti: unknown): Promise<EsitoStrumento> {
    const id = testo(argomenti, "voce");
    const nuovo = testo(argomenti, "testo");
    if (id === undefined || nuovo === undefined) return fallito("Servono l'identificativo della voce e il testo nuovo.");
    const voce = await this.#memoria.correggi(this.#idVoce(id), nuovo, Date.now(), chi.chiave);
    return voce === undefined ? fallito(this.#voceSconosciuta(id)) : riuscito(`Voce corretta: [${voce.id}] ${voce.testo}`);
  }

  async #dimentica(chi: ChiChiama, argomenti: unknown): Promise<EsitoStrumento> {
    const id = testo(argomenti, "voce");
    if (id === undefined) return fallito("Manca l'identificativo della voce.");
    return (await this.#memoria.cancella(this.#idVoce(id), chi.chiave))
      ? riuscito("Voce cancellata dalla memoria.")
      : fallito(this.#voceSconosciuta(id));
  }

  /** L'identificativo come lo scrive un modello: a volte con le parentesi quadre intorno. */
  #idVoce(scritto: string): string {
    return scritto.trim().replace(/^\[/, "").replace(/\]$/, "").trim().toLowerCase();
  }

  #voceSconosciuta(id: string): string {
    const voci = this.#memoria.voci();
    return (
      `Nessuna voce della memoria ha l'identificativo "${id}". ` +
      (voci.length === 0
        ? "La memoria è vuota."
        : `Le voci sono:\n${voci.map((voce) => `- [${voce.id}] ${voce.testo}`).join("\n")}`)
    );
  }

  /** Ogni conversazione ha la sua scheda nel browser del gateway, riconosciuta dalla sua chiave. */
  #perIlBrowser(chi: ChiChiama): { conversazione: string; chiave: string } {
    return { conversazione: chi.origine, chiave: chi.chiave };
  }

  #delBrowser(esito: EsitoBrowser): EsitoStrumento {
    if (esito.esito !== "fatto") {
      return fallito(`${esito.esito === "rifiutato" ? "Rifiutato dal gateway" : "Non riuscito"}: ${esito.motivo}`);
    }
    return {
      testo: esito.testo,
      ...(esito.immagine === undefined ? {} : { immagine: { tipo: "image/jpeg", dati: esito.immagine } }),
    };
  }

  async #delloStack(richiesta: RichiestaStack): Promise<EsitoStrumento> {
    const esito: EsitoStack = await this.#gateway.stack(richiesta);
    if (esito.esito === "fatto") return riuscito(esito.testo);
    return fallito(`${esito.esito === "rifiutato" ? "Rifiutato dal gateway" : "Non riuscito"}: ${esito.motivo}`);
  }

  async #elencaCredenziali(): Promise<EsitoStrumento> {
    const stato = await this.#gateway.stato();
    if (stato.gateway === "non-configurato") {
      return riuscito("In questa installazione di Shinka il gateway non è configurato: non ci sono credenziali da usare.");
    }
    if (stato.gateway === "irraggiungibile") {
      return fallito("Il gateway non risponde: in questo momento nessuna credenziale si può usare. Dillo al proprietario.");
    }
    if (stato.condizione === "da-impostare") {
      return riuscito(
        "Il vault non è ancora stato impostato: il proprietario deve scegliere la frase di sblocco e inserire le credenziali dalla pagina Vault.",
      );
    }
    if (stato.condizione === "chiuso") {
      return riuscito(
        "Il vault è chiuso: finché il proprietario non lo sblocca dalla pagina Vault con la sua frase, nessuna credenziale si può usare né elencare.",
      );
    }
    if (stato.credenziali.length === 0) {
      return riuscito("Il vault è aperto ma vuoto: il proprietario inserisce le credenziali dalla pagina Vault.");
    }
    return riuscito(
      "Credenziali del vault. Le usi per nome, e solo dove indicato. Di quelle protette il valore non lo vedi mai; di quelle in chiaro lo leggi con leggi_credenziale. " +
        "Quelle per gli host si usano con esegui_su_host; quelle per i siti con inserisci_credenziale, nella pagina aperta con apri_sito.\n" +
        stato.credenziali
          .map((c) =>
            (c.inChiaro === true ? "[IN CHIARO: il valore si legge con leggi_credenziale] " : "[protetta] ") +
            (c.tipo === "sito"
              ? `- nome: "${c.nome}"; per i siti: ${c.host.join(", ")}; utente: ${c.utente}; tipo: accesso a un sito`
              : `- nome: "${c.nome}"; utente: ${c.utente}; host: ${c.host.join(", ")}; tipo: ${c.tipo === "chiave" ? "chiave SSH" : "password"}` +
                (c.server === true
                  ? "; è il server su cui gira Shinka: ogni comando con esegui_su_host aspetta il sì del proprietario, che lo dà al gateway (su Telegram o nella pagina del vault)"
                  : "") +
                (c.stack === undefined
                  ? ""
                  : `; host per gli stack di prova (porte ${c.stack.porte.da}-${c.stack.porte.a}): lì gli stack si gestiscono con avvia_stack e gli altri strumenti degli stack, e un comando con esegui_su_host aspetta l'approvazione del proprietario`)),
          )
          .join("\n"),
    );
  }

  /** Il valore di una credenziale in chiaro: lo dà il gateway, e solo per un host o un sito in cui vale. */
  async #leggiCredenziale(chi: ChiChiama, argomenti: unknown): Promise<EsitoStrumento> {
    const credenziale = testo(argomenti, "credenziale");
    const dove = testo(argomenti, "dove");
    if (credenziale === undefined || dove === undefined) return fallito("Servono il nome della credenziale e l'host o il sito in cui la userai.");
    const esito = await this.#gateway.leggiInChiaro({ credenziale, dove, conversazione: chi.origine });
    if (esito.esito !== "letta") return fallito(`Rifiutato dal gateway: ${esito.motivo}`);
    return riuscito(
      [
        `Credenziale in chiaro "${esito.nome}" (${esito.tipo === "sito" ? "accesso a un sito" : esito.tipo === "chiave" ? "chiave SSH" : "password"}), valida per ${esito.host.join(", ")}.`,
        `Utente: ${esito.utente}`,
        esito.tipo === "chiave" ? `Chiave privata:\n${esito.segreto}` : `Password: ${esito.segreto}`,
        ...(esito.fraseDellaChiave === undefined ? [] : [`Frase della chiave: ${esito.fraseDellaChiave}`]),
        "Usala solo lì. Non scriverla in memoria, nelle skill o in file che non servono al lavoro.",
      ].join("\n"),
    );
  }

  /**
   * Claude propone una credenziale in chiaro: il gateway la controlla e la tiene da parte, e la
   * scheda nella conversazione chiede il sì al proprietario. Il gateway salva ciò che aveva tenuto.
   */
  async #salvaInChiaro(chi: ChiChiama, argomenti: unknown): Promise<EsitoStrumento> {
    const nome = testo(argomenti, "nome");
    const tipo = testo(argomenti, "tipo");
    const utente = testo(argomenti, "utente");
    const segreto = testo(argomenti, "segreto");
    const frase = testo(argomenti, "frase_della_chiave");
    const elenco = typeof argomenti === "object" && argomenti !== null ? (argomenti as Record<string, unknown>).host : undefined;
    const host = Array.isArray(elenco) ? elenco.filter((voce): voce is string => typeof voce === "string") : [];
    if (nome === undefined || tipo === undefined || utente === undefined || segreto === undefined || host.length === 0) {
      return fallito("Servono il nome, il tipo, l'utente, il valore e almeno un host o un sito.");
    }
    if (!(TIPI_IN_CHIARO as readonly string[]).includes(tipo)) return fallito("Il tipo è password, chiave oppure sito.");
    if (this.#approvazioni === undefined) return fallito("In questa installazione di Shinka non c'è modo di chiedere al proprietario di approvarla.");
    const proposta = await this.#gateway.proponiInChiaro({
      conversazione: chi.origine,
      nome,
      tipo: tipo as TipoInChiaro,
      utente,
      host,
      segreto,
      ...(frase === undefined || frase === "" ? {} : { fraseDellaChiave: frase }),
    });
    if (proposta.esito === "rifiutato") return fallito(`Rifiutato dal gateway: ${proposta.motivo}`);
    if (proposta.esito === "salvata") return riuscito(`Credenziale in chiaro "${proposta.credenziale.nome}" salvata.`);
    const vista = proposta.credenziale;
    const esito = await this.#approvazioni.chiediCredenziale(chi.chiave, {
      approvazione: proposta.approvazione,
      scadeIl: proposta.scadeIl,
      nome: vista.nome,
      host: vista.host,
      descrizione: `${vista.tipo === "sito" ? "Accesso a un sito" : vista.tipo === "chiave" ? "Chiave SSH" : "Password"}, utente ${vista.utente}.`,
    });
    if (esito.esito !== "salvata") return fallito(`Non salvata: ${esito.esito === "rifiutato" ? esito.motivo : "il gateway non l'ha accettata."}`);
    return riuscito(
      `Credenziale in chiaro "${esito.credenziale.nome}" salvata nel vault, con il sì del proprietario: vale per ${esito.credenziale.host.join(", ")}. ` +
        "La leggi con leggi_credenziale e la usi per nome con esegui_su_host o inserisci_credenziale.",
    );
  }

  async #eseguiSuHost(chi: ChiChiama, argomenti: unknown): Promise<EsitoStrumento> {
    const credenziale = testo(argomenti, "credenziale");
    const host = testo(argomenti, "host");
    const comando = testo(argomenti, "comando");
    if (credenziale === undefined || host === undefined || comando === undefined) {
      return fallito("Servono il nome della credenziale, l'host e il comando.");
    }
    const secondi = typeof argomenti === "object" && argomenti !== null ? (argomenti as Record<string, unknown>).secondi : undefined;
    const durata = typeof secondi === "number" && Number.isFinite(secondi) ? { secondi: Math.round(secondi) } : {};
    let esito = await this.#gateway.usa({ credenziale, host, comando, conversazione: chi.origine, ...durata });
    if (esito.esito === "da-approvare") {
      // Un host per gli stack: il gateway tiene il comando da parte finché il proprietario non lo approva.
      const attesa = {
        approvazione: esito.approvazione,
        scadeIl: esito.scadeIl,
        credenziale,
        host,
        comando,
        ...durata,
        ...(esito.alGateway === true ? { alGateway: true as const } : {}),
      };
      esito =
        this.#approvazioni === undefined
          ? await this.#gateway.decidi(esito.approvazione, "negata")
          : await this.#approvazioni.chiedi(chi.chiave, attesa);
    }
    if (esito.esito === "da-approvare") return fallito("Il gateway non ha deciso di questo comando: non è stato eseguito.");
    if (esito.esito !== "eseguito") {
      return fallito(`${esito.esito === "rifiutato" ? "Rifiutato dal gateway" : "Non riuscito"}: ${esito.motivo}`);
    }
    const parti = [
      esito.scaduto
        ? "Il comando è stato fermato perché durava troppo: ciò che segue è quello che aveva scritto fino a quel momento."
        : `Codice di uscita: ${esito.codice ?? "sconosciuto"}`,
      esito.uscita.trimEnd(),
      esito.errori.trim() === "" ? "" : `[errori]\n${esito.errori.trimEnd()}`,
    ].filter((parte) => parte !== "");
    const scritto = parti.join("\n");
    return esito.scaduto || esito.codice !== 0 ? fallito(scritto) : riuscito(scritto);
  }

  async #leggiSkill(argomenti: unknown): Promise<EsitoStrumento> {
    const nome = testo(argomenti, "nome")?.trim().replace(new RegExp(`^${GRUPPO_SKILL}:`), "");
    if (nome === undefined || nome === "") {
      const elenco = this.#skill.elenco();
      return riuscito(
        elenco.length === 0
          ? "Non c'è ancora nessuna skill di Shinka."
          : elenco.map((voce) => `- ${voce.nome}: ${voce.descrizione}`).join("\n"),
      );
    }
    const skill = await this.#skill.leggi(nome);
    if (skill === undefined) return fallito(`Non esiste una skill di nome "${nome}". Usa leggi_skill senza nome per l'elenco.`);
    return riuscito(`Skill "${skill.nome}"\nDescrizione: ${skill.descrizione}\n\n${skill.contenuto}`);
  }

  async #salvaSkill(chi: ChiChiama, argomenti: unknown): Promise<EsitoStrumento> {
    const nome = testo(argomenti, "nome")?.trim().replace(new RegExp(`^${GRUPPO_SKILL}:`), "");
    const descrizione = testo(argomenti, "descrizione");
    const contenuto = testo(argomenti, "contenuto");
    const motivo = testo(argomenti, "motivo") ?? "";
    if (nome === undefined || descrizione === undefined || contenuto === undefined) {
      return fallito("Servono il nome, la descrizione e il contenuto della skill.");
    }
    const esito = await this.#skill.salva({ nome, descrizione, contenuto, motivo }, chi.origine);
    if (esito === "invariata") return riuscito(`La skill "${nome}" era già così: non è cambiato nulla.`);
    return riuscito(
      `Skill "${nome}" ${esito === "creata" ? "creata" : "aggiornata"}: da adesso si usa con lo strumento Skill come "${GRUPPO_SKILL}:${nome}", ` +
        "in ogni conversazione e in ogni ambiente. Il proprietario la vede nella pagina Skill e può annullare la modifica. " +
        "Diglielo in una riga nella risposta.",
    );
  }
}
