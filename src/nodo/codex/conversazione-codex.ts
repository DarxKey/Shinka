/**
 * Una conversazione di Shinka che lavora con Codex invece che con Claude Code: un thread
 * dell'app-server di Codex, tenuto aperto tra un messaggio e l'altro. Fa ciò che fa la
 * conversazione con Claude, attraverso la stessa porta: il centro non vede la differenza.
 *
 * Testo, ragionamento, azioni, permessi nei quattro modi, interruzione, ripresa, token, limiti
 * del piano, modelli ed effort; gli strumenti di Shinka e le domande; le funzioni della chat:
 * ripartire da un messaggio, un ramo, la domanda a parte, le modifiche dei turni, le cose da fare
 * e la compattazione (docs/motore-codex.md). Le attività in sfondo di Claude qui non ci sono.
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { eImmagine, nomeSicuro, type Allegato } from "../../protocollo/allegati.ts";
import type {
  AnteprimaRiavvolgimento,
  DecisionePermesso,
  EsitoBiforcazione,
  EventoConversazione,
  PortaConversazione,
  RispostaAParte,
  ScambioDellaStoria,
} from "../../protocollo/eventi.ts";
import type { EsitoAnnullamento, VersioniDiUnFile } from "../../protocollo/modifiche.ts";
import { RegistroModifiche } from "../modifiche.ts";
import { fileToccato, leggiDiffDelTurno, versionePrima } from "./diff-del-turno.ts";
import { IMPEGNI, type ComandoDisponibile, type Impegno, type ImpostazioniConversazione, type ModelloDisponibile, type ModoPermessi, type Motore, type StatoConversazione } from "../../protocollo/impostazioni.ts";
import { istruzioniDelloStile } from "../../protocollo/stili.ts";
import type { ConfigurazioneConversazione } from "../conversazione.ts";
import { ClienteAppServer, type RispostaAlServer } from "./cliente.ts";
import { DomandeInSospeso } from "../domande.ts";
import { StrumentiPerCodex } from "./strumenti.ts";
import type { Domanda, RispostaAlleDomande } from "../../protocollo/eventi.ts";
import { limitiDi, TraduzioneCodex } from "./traduzione.ts";

const INATTIVITA_PREDEFINITA_MS = 15 * 60 * 1000;
/** Quanto aspettare la risposta a una domanda a parte. */
const ATTESA_A_PARTE_MS = 3 * 60 * 1000;
/** Il comando con cui l'interfaccia chiede di compattare la conversazione. */
const COMPATTA = "/compact";
const LAVORA = "Codex sta lavorando: aspetta che finisca, o fermalo.";
/** Il solo comando di Codex che Shinka esegue da sé: gli altri del menu "/" sono le sue skill. */
const COMANDO_COMPATTA: ComandoDisponibile = { nome: "compact", descrizione: "Riassume la conversazione fin qui, per liberare contesto" };
/** Quanto può essere lunga la descrizione di una skill nel menu "/". */
const DESCRIZIONE_MASSIMA = 160;

/** Una skill come la elenca Codex. */
interface SkillDiCodex {
  name?: unknown;
  description?: unknown;
  shortDescription?: unknown;
  path?: unknown;
  enabled?: unknown;
  interface?: { shortDescription?: unknown } | null;
}

/**
 * Le skill accese che Codex elenca, per il menu "/" e per chiamarle: nome, descrizione in breve e
 * il percorso che Codex vuole insieme al nome.
 */
export function skillDiCodex(risposta: unknown): { comando: ComandoDisponibile; percorso: string }[] {
  const gruppi = (risposta as { data?: { skills?: SkillDiCodex[] }[] } | undefined)?.data;
  if (!Array.isArray(gruppi)) return [];
  const viste = new Set<string>();
  const lette: { comando: ComandoDisponibile; percorso: string }[] = [];
  for (const skill of gruppi.flatMap((gruppo) => (Array.isArray(gruppo.skills) ? gruppo.skills : []))) {
    if (typeof skill.name !== "string" || typeof skill.path !== "string" || skill.enabled === false) continue;
    if (!/^[\w:.-]+$/.test(skill.name) || viste.has(skill.name) || skill.name === COMANDO_COMPATTA.nome) continue;
    viste.add(skill.name);
    const descrizione = [skill.interface?.shortDescription, skill.shortDescription, skill.description].find((testo): testo is string => typeof testo === "string" && testo.trim() !== "") ?? "";
    const breve = descrizione.replace(/\s+/g, " ").trim();
    lette.push({
      comando: { nome: skill.name, descrizione: breve.length > DESCRIZIONE_MASSIMA ? `${breve.slice(0, DESCRIZIONE_MASSIMA - 1)}…` : breve, argomenti: "[che cosa fare]" },
      percorso: skill.path,
    });
  }
  return lette;
}

/** I turni di un thread, ciascuno con i messaggi del proprietario che contiene, come li ha marcati Shinka. */
interface TurnoDelThread {
  id: string;
  messaggi: string[];
}

/** I turni di un thread come li dà `thread/read`. */
export function turniDelThread(letti: unknown): TurnoDelThread[] {
  if (!Array.isArray(letti)) return [];
  return (letti as { id?: unknown; items?: unknown }[]).flatMap((turno) => {
    if (typeof turno?.id !== "string") return [];
    const voci = Array.isArray(turno.items) ? (turno.items as { type?: unknown; clientId?: unknown }[]) : [];
    const messaggi = voci.flatMap((voce) => (voce.type === "userMessage" && typeof voce.clientId === "string" ? [voce.clientId] : []));
    return [{ id: turno.id, messaggi }];
  });
}

/**
 * Come Codex chiede, per ciascuno dei quattro modi dei permessi di Shinka. Il sandbox di Codex non
 * si usa: Shinka non aggiunge confinamento (sezione 4.7), e in un container spesso non parte. Le
 * modifiche libere le lascia passare Shinka stessa, quando restano nella cartella.
 */
export function politicaDi(modo: ModoPermessi): { approvalPolicy: string; sandbox: string; sandboxPolicy: Record<string, unknown> } {
  const senzaSandbox = { sandbox: "danger-full-access", sandboxPolicy: { type: "dangerFullAccess" } };
  switch (modo) {
    case "chiedi":
    case "modifiche-libere":
      // Ogni comando e ogni modifica chiedono; nelle modifiche libere quelle nella cartella le approva Shinka.
      return { approvalPolicy: "untrusted", ...senzaSandbox };
    case "automatico":
      // Codex decide da sé, e chiede solo quando gli pare che serva.
      return { approvalPolicy: "on-request", ...senzaSandbox };
    case "senza-permessi":
      return { approvalPolicy: "never", ...senzaSandbox };
  }
}

/** Il modello da chiedere a Codex: un nome di Claude, scelto prima che la conversazione passasse a Codex, non vale. */
export function modelloPerCodex(modello: string | undefined): string | undefined {
  if (modello === undefined) return undefined;
  return /^(claude|sonnet|opus|haiku|fable|default)\b/i.test(modello.trim()) ? undefined : modello;
}

/** L'effort da chiedere a Codex, che non ha il livello massimo di Claude. */
export function effortPerCodex(impegno: Impegno | undefined): string | undefined {
  return impegno === "max" ? "xhigh" : impegno;
}

/** Vero se tutti i file della modifica stanno nella cartella della conversazione. */
export function nellaCartella(percorsi: readonly string[], cartella: string): boolean {
  const radice = resolve(cartella);
  return percorsi.length > 0 && percorsi.every((percorso) => {
    const dentro = relative(radice, resolve(radice, percorso));
    return dentro !== "" && !dentro.startsWith("..") && !isAbsolute(dentro);
  });
}

export interface OpzioniCodex {
  /** Il comando che avvia l'app-server; nei test, uno finto. */
  comando?: string[];
  env?: NodeJS.ProcessEnv;
}

interface PermessoInAttesa {
  risolvi(risposta: RispostaAlServer): void;
  /** Ciò che si risponde a Codex con un sì e con un no. */
  si: unknown;
  no: unknown;
}

export class ConversazioneCodex implements PortaConversazione {
  readonly #cfg: ConfigurazioneConversazione;
  readonly #o: OpzioniCodex;
  #impostazioni: ImpostazioniConversazione;
  #idThread: string | undefined;
  #cliente: Promise<ClienteAppServer> | undefined;
  #traduzione = new TraduzioneCodex();
  /** Il turno di Codex in corso, se c'è. */
  #turno: string | undefined;
  /** Vero da quando Shinka ha aperto un turno, prima ancora che Codex dica il suo identificativo. */
  #inTurno = false;
  /** Le note per Claude che aspettano il prossimo messaggio: Codex non ha messaggi che non chiedano risposta. */
  readonly #note: string[] = [];
  readonly #permessi = new Map<string, PermessoInAttesa>();
  readonly #domande: DomandeInSospeso;
  /** Le domande in attesa si annullano quando il turno finisce. */
  #fineDelTurno = new AbortController();
  /** Gli strumenti di Shinka, collegati una volta per tutta la vita della conversazione. */
  #strumenti: Promise<StrumentiPerCodex> | undefined;
  #modelliRiferiti = false;
  /** Le skill che Codex ha elencato, per nome, con il loro percorso: sono i comandi del menu "/". */
  readonly #skill = new Map<string, string>();
  /** Vero finché l'elenco dei comandi non è stato detto, o va ridetto perché le skill sono cambiate. */
  #comandiDaRiferire = true;
  /** I comandi letti all'avvio, finché non sono stati detti. */
  #comandiLetti: ComandoDisponibile[] | undefined;
  /** L'ultimo messaggio in viaggio verso Codex: il successivo aspetta che sia arrivato, per sapere in quale turno entra. */
  #invio: Promise<void> | undefined;
  /** Il modello predefinito di Codex, per quando quello scelto è di Claude. */
  #predefinito: string | undefined;
  #timerInattivita: NodeJS.Timeout | undefined;
  /** Le versioni dei file cambiati nei turni, per il pannello Modifiche: un turno di Shinka è un turno di Codex. */
  readonly #modifiche: RegistroModifiche;
  /** L'ultimo diff del turno in corso, e i file (assoluti) che le sue modifiche hanno toccato. */
  #diffDelTurno: string | undefined;
  readonly #toccati = new Set<string>();

  constructor(cfg: ConfigurazioneConversazione, opzioni: OpzioniCodex = {}) {
    this.#cfg = cfg;
    this.#o = opzioni;
    this.#modifiche = new RegistroModifiche(cfg.cartella, cfg.cartellaModifiche, {
      alStato: (fileDeiComandi) => cfg.alEvento({ tipo: "stato", stato: { fileDeiComandi } }),
    });
    this.#impostazioni = cfg.impostazioni;
    this.#idThread = cfg.idSessione === "" ? undefined : cfg.idSessione;
    this.#domande = new DomandeInSospeso(cfg.alEvento);
  }

  rispondiDomande(idDomande: string, risposta: RispostaAlleDomande): boolean {
    return this.#domande.rispondi(idDomande, risposta);
  }

  /** Le skill di Shinka sono cambiate: Codex rilegge la loro cartella. */
  ricaricaSkill(): void {
    void this.#cliente
      ?.then(async (cliente) => {
        await this.#indicaLeSkill(cliente);
        this.#comandiDaRiferire = true;
        await this.#riferisciStato(cliente);
      })
      .catch(() => {});
  }

  /** Le estensioni sono cambiate: al prossimo messaggio il processo riparte con quelle nuove. */
  ricaricaEstensioni(): void {
    if (!this.#inTurno) this.chiudi();
  }

  #strumentiPronti(): Promise<StrumentiPerCodex> {
    if (this.#strumenti === undefined) {
      const apertura = StrumentiPerCodex.apri(this.#cfg.strumentiNostri?.());
      this.#strumenti = apertura;
      // Se il collegamento non riesce, il prossimo messaggio riprova con strumenti nuovi.
      apertura.catch(() => {
        if (this.#strumenti === apertura) this.#strumenti = undefined;
      });
    }
    return this.#strumenti;
  }

  async #indicaLeSkill(cliente: ClienteAppServer): Promise<void> {
    if (this.#cfg.cartellaSkill === undefined) return;
    await cliente.richiedi("skills/extraRoots/set", { extraRoots: [join(this.#cfg.cartellaSkill, "skills")] }, 20_000).catch(() => {});
  }

  /** I server delle estensioni accese, nella forma della configurazione di Codex. */
  async #serverDelleEstensioni(): Promise<Record<string, unknown>> {
    if (this.#cfg.estensioni === undefined) return {};
    const { server, nonPartite } = await this.#cfg.estensioni.server();
    for (const { nome, motivo } of nonPartite) {
      this.#cfg.alEvento({ tipo: "errore", messaggio: `L'estensione "${nome}" non è partita in questa conversazione: ${motivo}` });
    }
    const configurati: Record<string, unknown> = {};
    for (const [nome, configurazione] of Object.entries(server)) {
      if ("command" in configurazione) {
        configurati[nome] = { command: configurazione.command, args: configurazione.args ?? [], ...(configurazione.env === undefined ? {} : { env: configurazione.env }) };
      } else if ("url" in configurazione) {
        configurati[nome] = { url: configurazione.url, ...(configurazione.headers === undefined ? {} : { http_headers: configurazione.headers }) };
      }
    }
    return configurati;
  }

  prepara(): void {
    void this.#pronto().catch(() => {});
    this.#armaInattivita();
  }

  invia(testo: string, allegati: Allegato[] = []): void {
    if (testo.trim() === COMPATTA && allegati.length === 0) {
      this.#compatta();
      return;
    }
    // Mentre Codex aspetta le risposte alle sue domande, un messaggio scritto in chat è la risposta.
    if (this.#domande.inAttesa && allegati.length === 0 && testo.trim() !== "") {
      this.#cfg.alEvento({ tipo: "messaggio-proprietario", id: randomUUID(), testo });
      this.#domande.rispondiInChat(testo);
      return;
    }
    const id = randomUUID();
    const immagini = allegati.filter((allegato) => eImmagine(allegato.tipo));
    const { salvati, percorsiImmagini } = this.#salva(allegati);
    this.#cfg.alEvento({
      tipo: "messaggio-proprietario",
      id,
      testo,
      ...(immagini.length === 0 ? {} : { immagini: immagini.map(({ tipo, dati }) => ({ tipo, dati })) }),
      ...(salvati.length === 0 ? {} : { file: salvati }),
    });
    const nota = salvati.length === 0 ? "" : `[Il proprietario ha allegato questi file, salvati nella cartella di lavoro: ${salvati.map((nome) => `allegati/${nome}`).join(", ")}]`;
    const scritto = [testo.trim(), nota].filter((parte) => parte !== "").join("\n\n");
    // "/nome ..." chiama una skill di Codex, se ne ha una con quel nome.
    const comando = /^\/([\w:.-]+)(?:\s|$)/.exec(scritto)?.[1];
    this.#manda([...this.#note.splice(0), scritto].filter((parte) => parte !== ""), percorsiImmagini, id, comando);
  }

  istruisci(testo: string): void {
    this.#manda([...this.#note.splice(0), testo], [], undefined);
  }

  annota(testo: string): void {
    // Arriva con il prossimo messaggio: in Codex ogni messaggio fa rispondere.
    this.#note.push(testo);
  }

  imposta(impostazioni: ImpostazioniConversazione): void {
    // Valgono dal prossimo turno: Codex le riceve con ogni messaggio.
    this.#impostazioni = impostazioni;
  }

  /** La storia del thread, letta da Codex: se l'app-server non è acceso, se ne avvia uno apposta. */
  async storia(): Promise<ScambioDellaStoria[]> {
    if (this.#idThread === undefined) return [];
    return scambiDiCodex(await this.#leggiTurni());
  }

  /** Un app-server apposta, che non tocca la conversazione aperta: per leggere, biforcare, una domanda a parte. */
  #clienteApposta(
    alNotificato: (metodo: string, parametri: Record<string, unknown>) => void = () => {},
    allaRichiesta: (metodo: string) => Promise<RispostaAlServer> = async () => ({ errore: "Qui Shinka non esegue nulla." }),
  ): Promise<ClienteAppServer> {
    return ClienteAppServer.avvia({
      ...(this.#o.comando === undefined ? {} : { comando: this.#o.comando }),
      ...(this.#o.env === undefined ? {} : { env: this.#o.env }),
      cwd: this.#cfg.cartella,
      alNotificato,
      allaRichiesta,
      allaFine: () => {},
    });
  }

  /** I turni del thread, con quello aperto se c'è, altrimenti con un app-server apposta. */
  async #leggiTurni(): Promise<unknown> {
    if (this.#idThread === undefined) return [];
    const aperto = this.#cliente === undefined ? undefined : await this.#cliente.catch(() => undefined);
    const cliente = aperto ?? (await this.#clienteApposta());
    try {
      const letto = (await cliente.richiedi("thread/read", { threadId: this.#idThread, includeTurns: true }, 30_000)) as { thread?: { turns?: unknown } };
      return letto.thread?.turns;
    } finally {
      if (aperto === undefined) cliente.chiudi();
    }
  }

  /**
   * Il turno di Codex che un messaggio del proprietario ha aperto, e quelli che vengono dopo. Un
   * messaggio arrivato a turno in corso non apre un turno: da lì non si riparte.
   */
  async #daQuelMessaggio(idMessaggio: string): Promise<{ turni: TurnoDelThread[]; posizione: number } | { motivo: string }> {
    if (this.#idThread === undefined) return { motivo: "La conversazione non ha ancora una storia da cui ripartire." };
    let turni: TurnoDelThread[];
    try {
      turni = turniDelThread(await this.#leggiTurni());
    } catch (errore) {
      return { motivo: `Non riesco a leggere la storia della conversazione: ${errore instanceof Error ? errore.message : String(errore)}` };
    }
    const posizione = turni.findIndex((turno) => turno.messaggi.includes(idMessaggio));
    if (posizione < 0) return { motivo: "Questo messaggio non è nella storia di Codex: non si può ripartire da qui." };
    if (turni[posizione]?.messaggi[0] !== idMessaggio) {
      return { motivo: "Questo messaggio è arrivato mentre Codex lavorava: si riparte dal messaggio che ha aperto quel turno." };
    }
    return { turni, posizione };
  }

  async anteprimaRiavvolgimento(idMessaggio: string): Promise<AnteprimaRiavvolgimento> {
    if (this.#inTurno) return { motivo: LAVORA };
    const trovato = await this.#daQuelMessaggio(idMessaggio);
    if ("motivo" in trovato) return trovato;
    return this.#modifiche.insieme(trovato.turni.slice(trovato.posizione).map((turno) => turno.id));
  }

  /**
   * Riparte da prima di quel messaggio: Codex toglie dalla sua storia quel turno e quelli dopo
   * (`thread/revert`, che non tocca i file). Con `file` Shinka riporta i file a com'erano, con le
   * versioni che ha tenuto per il pannello Modifiche, comprese quelle dei file cambiati dai comandi.
   */
  async riprendiDa(idMessaggio: string, opzioni: { file: boolean }): Promise<string | undefined> {
    if (this.#inTurno) return LAVORA;
    const trovato = await this.#daQuelMessaggio(idMessaggio);
    if ("motivo" in trovato) return trovato.motivo;
    const turni = trovato.turni.slice(trovato.posizione).map((turno) => turno.id);
    try {
      const cliente = await this.#pronto();
      await cliente.richiedi("thread/revert", { threadId: this.#idThread, beforeTurnId: turni[0] }, 30_000);
    } catch (errore) {
      return `Codex non è ripartito da quel messaggio: ${errore instanceof Error ? errore.message : String(errore)}`;
    }
    let fileRiportati: string[] | undefined;
    if (opzioni.file) {
      const esito = await this.#modifiche.annullaTurni(turni);
      fileRiportati = esito.annullati;
      for (const { percorso, motivo } of esito.nonAnnullati) {
        this.#cfg.alEvento({ tipo: "errore", messaggio: `${percorso} non è tornato com'era: ${motivo}.` });
      }
    }
    this.#cfg.alEvento({ tipo: "riavvolto", idMessaggio, ...(fileRiportati === undefined ? {} : { fileRiportati }) });
    return undefined;
  }

  /** Copia il thread fino a prima di quel messaggio in un thread nuovo, con gli strumenti di questo. */
  async biforca(idMessaggio: string): Promise<EsitoBiforcazione> {
    const trovato = await this.#daQuelMessaggio(idMessaggio);
    if ("motivo" in trovato) return { riuscita: false, motivo: trovato.motivo };
    // Dal primo messaggio il ramo comincia da capo.
    if (trovato.posizione === 0) return { riuscita: true };
    const politica = politicaDi(this.#impostazioni.permessi);
    let cliente: ClienteAppServer | undefined;
    try {
      cliente = await this.#clienteApposta();
      const copia = (await cliente.richiedi(
        "thread/fork",
        {
          threadId: this.#idThread,
          beforeTurnId: trovato.turni[trovato.posizione]?.id,
          excludeTurns: true,
          cwd: this.#cfg.cartella,
          approvalPolicy: politica.approvalPolicy,
          sandbox: politica.sandbox,
        },
        60_000,
      )) as { thread?: { id?: unknown } };
      if (typeof copia.thread?.id !== "string") return { riuscita: false, motivo: "Codex non ha copiato la conversazione." };
      return { riuscita: true, idSessione: copia.thread.id };
    } catch (errore) {
      return { riuscita: false, motivo: `Non riesco a copiare la conversazione: ${errore instanceof Error ? errore.message : String(errore)}` };
    } finally {
      cliente?.chiudi();
    }
  }

  /**
   * Una domanda a parte: un app-server apposta biforca il thread in uno effimero, che non viene
   * salvato, e Codex risponde lì. Senza strumenti: i comandi girano in sola lettura, le richieste
   * si negano. La conversazione vera non cambia, e può anche stare lavorando.
   */
  async chiediAParte(domanda: string): Promise<RispostaAParte> {
    const testo =
      "[Shinka] Domanda a parte del proprietario: rispondi in breve, con ciò che sai già da questa conversazione. " +
      "Non usare strumenti né comandi, e né la domanda né la risposta resteranno nella conversazione.\n\n" +
      domanda;
    let risposta = "";
    let errore: string | undefined;
    let finito: () => void = () => {};
    const fine = new Promise<void>((risolvi) => (finito = risolvi));
    let cliente: ClienteAppServer | undefined;
    const timer = setTimeout(() => {
      errore = "il tempo è scaduto";
      finito();
    }, ATTESA_A_PARTE_MS);
    try {
      cliente = await this.#clienteApposta(
        (metodo, parametri) => {
          const voce = parametri.item as { type?: unknown; text?: unknown } | undefined;
          if (metodo === "item/completed" && voce?.type === "agentMessage" && typeof voce.text === "string") risposta = voce.text;
          if (metodo === "turn/completed") {
            const turno = parametri.turn as { status?: unknown; error?: { message?: unknown } | null } | undefined;
            if (turno?.status === "failed") errore = String(turno.error?.message ?? "il turno non è finito");
            finito();
          }
        },
        async (metodo) =>
          metodo === "item/tool/call"
            ? { risultato: { contentItems: [{ type: "inputText", text: "In una domanda a parte non si usano strumenti." }], success: false } }
            : metodo === "item/tool/requestUserInput"
              ? { risultato: { answers: {} } }
              : { risultato: { decision: "decline" } },
      );
      const sicuro = { approvalPolicy: "never", sandbox: "read-only" };
      const aperto = (await cliente.richiedi(
        this.#idThread === undefined ? "thread/start" : "thread/fork",
        { ...(this.#idThread === undefined ? {} : { threadId: this.#idThread, excludeTurns: true }), ephemeral: true, cwd: this.#cfg.cartella, ...sicuro },
        60_000,
      )) as { thread?: { id?: unknown } };
      if (typeof aperto.thread?.id !== "string") return { motivo: "Codex non ha aperto la domanda a parte." };
      await cliente.richiedi("turn/start", {
        threadId: aperto.thread.id,
        input: [{ type: "text", text: testo, text_elements: [] }],
        approvalPolicy: "never",
        sandboxPolicy: { type: "readOnly" },
        ...(await this.#modello(cliente)),
        ...(effortPerCodex(this.#impostazioni.impegno) === undefined ? {} : { effort: effortPerCodex(this.#impostazioni.impegno) }),
      });
      await fine;
      if (risposta.trim() !== "") return { testo: risposta.trim() };
      return { motivo: `Codex non ha risposto${errore === undefined ? "" : `: ${errore}`}.` };
    } catch (causa) {
      return { motivo: `La domanda a parte non è partita: ${causa instanceof Error ? causa.message : String(causa)}` };
    } finally {
      clearTimeout(timer);
      cliente?.chiudi();
    }
  }

  versioniModificate(idTurno: string, percorso: string): Promise<VersioniDiUnFile | { motivo: string }> {
    return this.#modifiche.versioni(idTurno, percorso);
  }

  async annullaModifiche(idTurno: string, percorsi?: readonly string[]): Promise<EsitoAnnullamento | { motivo: string }> {
    if (this.#inTurno) return { motivo: LAVORA };
    const esito = await this.#modifiche.annulla(idTurno, percorsi);
    if ("motivo" in esito || esito.annullati.length === 0) return esito;
    this.#cfg.alEvento({ tipo: "modifiche-decise", idTurno, percorsi: esito.annullati, esito: "annullate" });
    // Codex deve saperlo: altrimenti continuerebbe come se i file fossero quelli che ha lasciato.
    this.annota(
      `[Shinka] Il proprietario ha riportato a com'erano prima di un tuo turno questi file: ${esito.annullati.join(", ")}. ` +
        "Le modifiche che vi avevi fatto non ci sono più: se ti servono, rileggili.",
    );
    return esito;
  }

  /** Il proprietario chiede di compattare: Codex riassume la conversazione in un turno suo. */
  #compatta(): void {
    this.#cfg.alEvento({ tipo: "messaggio-proprietario", id: randomUUID(), testo: COMPATTA });
    if (this.#inTurno) {
      this.#cfg.alEvento({ tipo: "errore", messaggio: LAVORA });
      return;
    }
    void this.#pronto()
      .then((cliente) => cliente.richiedi("thread/compact/start", { threadId: this.#idThread }))
      .catch((errore: unknown) => {
        this.#cfg.alEvento({ tipo: "errore", messaggio: `Codex non ha compattato la conversazione: ${errore instanceof Error ? errore.message : String(errore)}` });
      });
  }

  /**
   * A fine turno: i file che le modifiche di Codex hanno cambiato, con la versione di prima
   * ricostruita dal diff del turno (un file che non torna con il diff non si tiene), e quelli
   * cambiati dai suoi comandi, che dice il confronto tra le fotografie dei file.
   */
  async #registraModifiche(idTurno: string): Promise<void> {
    const diff = this.#diffDelTurno;
    const toccati = [...this.#toccati];
    this.#diffDelTurno = undefined;
    this.#toccati.clear();
    if (!this.#modifiche.inCorso) {
      // Un turno che il registro non ha visto cominciare: restano solo le modifiche del diff.
      if (diff === undefined || diff.trim() === "") return;
      this.#modifiche.apriTurno(idTurno);
    }
    for (const voce of leggiDiffDelTurno(diff ?? "")) {
      const assoluto = fileToccato(voce.percorso, toccati) ?? resolve(this.#cfg.cartella, voce.percorso);
      let adesso: string | null;
      try {
        adesso = readFileSync(assoluto, "utf8");
      } catch (errore) {
        if (!(errore instanceof Error && "code" in errore && errore.code === "ENOENT")) continue;
        adesso = null;
      }
      const prima = versionePrima(adesso, voce);
      if (prima !== undefined) this.#modifiche.primaCon(assoluto, prima);
      // Se il diff non torna, per esempio perché un comando ha cambiato ancora il file, lo dirà la fotografia.
      else this.#modifiche.toccato(assoluto);
    }
    for (const assoluto of toccati) this.#modifiche.toccato(assoluto);
    // Il turno di Shinka prende il nome di quello di Codex: così si ritrova quando si riparte da un messaggio.
    const cambiate = await this.#modifiche.chiudiTurno(idTurno);
    if (cambiate !== undefined) this.#cfg.alEvento({ tipo: "modifiche", ...cambiate });
  }

  decidiPermesso(idPermesso: string, decisione: DecisionePermesso): boolean {
    const inAttesa = this.#permessi.get(idPermesso);
    if (inAttesa === undefined) return false;
    this.#permessi.delete(idPermesso);
    inAttesa.risolvi({ risultato: decisione === "approvato" ? inAttesa.si : inAttesa.no });
    this.#cfg.alEvento({ tipo: "permesso-deciso", idPermesso, decisione });
    return true;
  }

  async interrompi(): Promise<void> {
    if (this.#turno === undefined || this.#idThread === undefined || this.#cliente === undefined) return;
    const cliente = await this.#cliente;
    await cliente.richiedi("turn/interrupt", { threadId: this.#idThread, turnId: this.#turno }).catch(() => {});
  }

  chiudi(): void {
    this.#disarmaInattivita();
    const cliente = this.#cliente;
    this.#cliente = undefined;
    void cliente?.then((aperto) => aperto.chiudi()).catch(() => {});
  }

  /** Avvia l'app-server, se serve, e apre o riprende il thread. */
  #pronto(): Promise<ClienteAppServer> {
    if (this.#cliente !== undefined) return this.#cliente;
    // Vero quando l'avvio è fallito a processo partito: la sua fine non è più quella della conversazione.
    let abbandonato = false;
    const avvio = (async () => {
      const cliente = await ClienteAppServer.avvia({
        ...(this.#o.comando === undefined ? {} : { comando: this.#o.comando }),
        ...(this.#o.env === undefined ? {} : { env: this.#o.env }),
        cwd: this.#cfg.cartella,
        alNotificato: (metodo, parametri) => this.#notificato(metodo, parametri),
        allaRichiesta: (metodo, parametri) => this.#richiesto(metodo, parametri),
        allaFine: (motivo) => {
          if (!abbandonato) this.#finito(avvio, motivo);
        },
      });
      try {
        return await this.#apriIlThread(cliente);
      } catch (errore) {
        // Il processo è partito ma la conversazione no: non deve restare acceso.
        abbandonato = true;
        cliente.chiudi();
        throw errore;
      }
    })();
    this.#cliente = avvio;
    avvio.catch((errore: unknown) => {
      if (this.#cliente === avvio) this.#cliente = undefined;
      this.#cfg.alEvento({ tipo: "errore", messaggio: `Codex non è partito: ${errore instanceof Error ? errore.message : String(errore)}` });
      this.#chiudiTurno("Codex non è partito.");
    });
    return avvio;
  }

  /** Con l'app-server partito: gli strumenti, le estensioni e le skill, e il thread aperto o ripreso. */
  async #apriIlThread(cliente: ClienteAppServer): Promise<ClienteAppServer> {
    const strumenti = await this.#strumentiPronti();
    const estensioni = await this.#serverDelleEstensioni();
    await this.#indicaLeSkill(cliente);
    const politica = politicaDi(this.#impostazioni.permessi);
    const comune = {
      cwd: this.#cfg.cartella,
      ...(Object.keys(estensioni).length === 0 ? {} : { config: { mcp_servers: estensioni } }),
      approvalPolicy: politica.approvalPolicy,
      sandbox: politica.sandbox,
      ...(this.#istruzioni() === undefined ? {} : { developerInstructions: this.#istruzioni() }),
      ...(await this.#modello(cliente)),
    };
    let thread: { id?: unknown } | undefined;
    if (this.#idThread !== undefined) {
      try {
        thread = ((await cliente.richiedi("thread/resume", { threadId: this.#idThread, excludeTurns: true, ...comune })) as { thread?: { id?: unknown } }).thread;
      } catch {
        this.#cfg.alEvento({ tipo: "errore", messaggio: "La conversazione precedente non si può riprendere: ne comincia una nuova." });
        this.#idThread = undefined;
        this.#cfg.alIdSessione("");
      }
    }
    // Gli strumenti di Shinka si danno quando il thread nasce: Codex li tiene con lui.
    if (thread === undefined) {
      thread = ((await cliente.richiedi("thread/start", { ...comune, ...(strumenti.spazi.length === 0 ? {} : { dynamicTools: strumenti.spazi }) })) as { thread?: { id?: unknown } }).thread;
    }
    if (typeof thread?.id !== "string") throw new Error("Codex non ha aperto la conversazione.");
    if (thread.id !== this.#idThread) {
      this.#idThread = thread.id;
      this.#cfg.alIdSessione(thread.id);
    }
    // Le skill si leggono prima del primo messaggio: così "/nome" chiama una skill fin da subito.
    this.#comandiLetti = await this.#leggiLeSkill(cliente).catch(() => undefined);
    this.#comandiDaRiferire = true;
    void this.#riferisciStato(cliente);
    return cliente;
  }

  /** Le istruzioni che Shinka aggiunge a quelle di Codex: le sue, e lo stile scelto. */
  #istruzioni(): string | undefined {
    const proprie = this.#cfg.istruzioni === "claude-code" ? this.#cfg.istruzioniAggiunte : typeof this.#cfg.istruzioni === "function" ? this.#cfg.istruzioni() : this.#cfg.istruzioni;
    const stile = this.#impostazioni.stile === undefined ? undefined : istruzioniDelloStile(this.#impostazioni.stile);
    const tutte = [proprie, stile].filter((parte) => parte !== undefined && parte !== "").join("\n\n");
    return tutte === "" ? undefined : tutte;
  }

  /** Shinka apre un turno: da qui la conversazione è al lavoro, prima ancora che Codex dica il suo identificativo. */
  #apriTurno(): void {
    this.#inTurno = true;
    this.#traduzione.turnoNuovo();
    this.#modifiche.apriTurno();
    this.#cfg.alEvento({ tipo: "turno-iniziato" });
  }

  /**
   * Manda a Codex un messaggio: apre un turno, oppure entra in quello in corso. `comando` è il nome
   * scritto dopo "/" in testa all'ultimo testo, se c'è: se è una skill di Codex, la chiama.
   */
  #manda(testi: string[], immagini: string[], idMessaggio: string | undefined, comando?: string): void {
    this.#disarmaInattivita();
    const nuovo = !this.#inTurno;
    if (nuovo) this.#apriTurno();
    const prima = this.#invio;
    const invio = (async () => {
      // Un messaggio alla volta: quello di prima deve aver saputo il suo turno.
      await prima?.catch(() => {});
      const cliente = await this.#pronto();
      const threadId = this.#idThread;
      if (threadId === undefined) return;
      const percorsoSkill = comando === undefined ? undefined : this.#skill.get(comando);
      // Codex riconosce una skill dal suo nome con il dollaro davanti, e dal percorso.
      const scritti = percorsoSkill === undefined ? testi : testi.map((testo, posizione) => (posizione === testi.length - 1 ? `$${testo.slice(1)}` : testo));
      const input = [
        ...scritti.map((text) => ({ type: "text", text, text_elements: [] })),
        ...immagini.map((path) => ({ type: "localImage", path })),
        ...(percorsoSkill === undefined ? [] : [{ type: "skill", name: comando, path: percorsoSkill }]),
      ];
      const conId = idMessaggio === undefined ? {} : { clientUserMessageId: idMessaggio };
      if (!nuovo) {
        const turno = this.#turno;
        if (turno !== undefined) {
          try {
            // A turno in corso il messaggio entra nel turno, come con Claude: Codex vuole sapere in quale.
            await cliente.richiedi("turn/steer", { threadId, input, expectedTurnId: turno, ...conId });
            return;
          } catch (errore) {
            // Se il turno è finito in quell'istante, la notizia arriva subito dopo il rifiuto.
            await new Promise((fatto) => setTimeout(fatto, 250));
            if (this.#inTurno && this.#turno === turno) {
              // Il turno va avanti: il messaggio non è entrato, e il lavoro di Codex non si ferma per questo.
              this.#cfg.alEvento({ tipo: "errore", messaggio: `Il messaggio non è arrivato a Codex: ${errore instanceof Error ? errore.message : String(errore)}` });
              return;
            }
            // Il turno è finito proprio adesso: il messaggio ne apre uno suo.
          }
        }
        if (!this.#inTurno) this.#apriTurno();
      }
      // Codex cambia i file senza aspettare Shinka: la fotografia dei file va scattata prima che cominci.
      await this.#modifiche.pronto();
      const politica = politicaDi(this.#impostazioni.permessi);
      const risposta = (await cliente.richiedi("turn/start", {
        threadId,
        input,
        ...conId,
        approvalPolicy: politica.approvalPolicy,
        sandboxPolicy: politica.sandboxPolicy,
        ...(await this.#modello(cliente)),
        ...(effortPerCodex(this.#impostazioni.impegno) === undefined ? {} : { effort: effortPerCodex(this.#impostazioni.impegno) }),
        summary: "auto",
      })) as { turn?: { id?: unknown } };
      if (typeof risposta.turn?.id === "string" && this.#inTurno) this.#turno = risposta.turn.id;
    })();
    this.#invio = invio;
    void invio
      .catch((errore: unknown) => {
        this.#cfg.alEvento({ tipo: "errore", messaggio: `Il messaggio non è arrivato a Codex: ${errore instanceof Error ? errore.message : String(errore)}` });
        this.#chiudiTurno("Il messaggio non è arrivato a Codex.");
      })
      .finally(() => {
        if (this.#invio === invio) this.#invio = undefined;
      });
  }

  #notificato(metodo: string, parametri: Record<string, unknown>): void {
    // Ciò che riguarda un altro thread dello stesso app-server, come una copia appena nata, non è di questa conversazione.
    if (typeof parametri.threadId === "string" && this.#idThread !== undefined && parametri.threadId !== this.#idThread) return;
    if (metodo === "turn/diff/updated") {
      if (typeof parametri.diff === "string") this.#diffDelTurno = parametri.diff;
      return;
    }
    if (metodo === "item/started") {
      const voce = parametri.item as { type?: unknown; changes?: unknown } | undefined;
      if (voce?.type === "fileChange" && Array.isArray(voce.changes)) {
        for (const cambio of voce.changes as { path?: unknown }[]) if (typeof cambio.path === "string") this.#toccati.add(resolve(this.#cfg.cartella, cambio.path));
      }
    }
    if (metodo === "skills/changed") {
      // Le skill sul disco sono cambiate: l'elenco dei comandi si rilegge.
      this.#comandiDaRiferire = true;
      void this.#cliente?.then((cliente) => this.#riferisciStato(cliente)).catch(() => {});
      return;
    }
    if (metodo === "turn/started") {
      const turno = parametri.turn as { id?: unknown } | undefined;
      if (typeof turno?.id === "string") this.#turno = turno.id;
      this.#diffDelTurno = undefined;
      this.#toccati.clear();
      if (!this.#inTurno) {
        // Un turno che Codex comincia da sé: per Shinka è un turno come gli altri.
        this.#inTurno = true;
        this.#traduzione.turnoNuovo();
        this.#modifiche.apriTurno();
        void this.#modifiche.pronto();
        this.#disarmaInattivita();
        this.#cfg.alEvento({ tipo: "turno-iniziato" });
      }
      return;
    }
    for (const evento of this.#traduzione.notifica(metodo, parametri)) this.#cfg.alEvento(evento);
    if (metodo === "turn/completed") {
      const concluso = (parametri.turn as { id?: unknown } | undefined)?.id ?? this.#turno;
      if (typeof concluso === "string") void this.#registraModifiche(concluso).catch(() => {});
      this.#turno = undefined;
      this.#inTurno = false;
      this.#fineDelTurno.abort();
      this.#fineDelTurno = new AbortController();
      this.#negaTutti("Il turno è finito prima della decisione.");
      void this.#cliente?.then((cliente) => this.#riferisciStato(cliente)).catch(() => {});
      this.#armaInattivita();
    }
  }

  async #richiesto(metodo: string, parametri: Record<string, unknown>): Promise<RispostaAlServer> {
    switch (metodo) {
      case "item/commandExecution/requestApproval":
      case "item/fileChange/requestApproval":
      case "execCommandApproval":
      case "applyPatchApproval": {
        const idVoce = String(parametri.itemId ?? parametri.callId ?? randomUUID());
        const azione = this.#traduzione.azioneInCorso(idVoce) ?? (metodo.includes("ommand") ? { strumento: "Bash", ingresso: { command: String(parametri.command ?? "") } } : { strumento: "Edit", ingresso: {} });
        // Nelle modifiche libere una modifica dentro la cartella non chiede, come con Claude Code.
        const percorsi = this.#traduzione.percorsiInCorso(idVoce);
        if (metodo === "item/fileChange/requestApproval" && this.#impostazioni.permessi === "modifiche-libere" && nellaCartella(percorsi, this.#cfg.cartella)) {
          return { risultato: { decision: "accept" } };
        }
        return this.#chiedi(idVoce, String(parametri.approvalId ?? idVoce), azione, typeof parametri.reason === "string" ? parametri.reason : undefined, { decision: "accept" }, { decision: "decline" });
      }
      case "item/permissions/requestApproval": {
        const idVoce = String(parametri.itemId ?? randomUUID());
        return this.#chiedi(
          idVoce,
          `${idVoce}-permessi`,
          { strumento: "Permessi in più", ingresso: { motivo: parametri.reason, permessi: parametri.permissions } },
          typeof parametri.reason === "string" ? parametri.reason : undefined,
          { permissions: parametri.permissions, scope: "turn" },
          { permissions: {}, scope: "turn" },
        );
      }
      case "item/tool/call":
        return this.#strumento(parametri);
      case "item/tool/requestUserInput":
        return this.#domandeDiCodex(parametri);
      default:
        return { errore: `Shinka non sa rispondere a ${metodo}.` };
    }
  }

  /**
   * Codex chiama uno strumento di Shinka: lo esegue Shinka, dopo il consenso del proprietario se
   * lo strumento lo chiede, come con Claude.
   */
  async #strumento(parametri: Record<string, unknown>): Promise<RispostaAlServer> {
    const spazio = String(parametri.namespace ?? "shinka");
    const nome = String(parametri.tool ?? "");
    const argomenti = parametri.arguments ?? {};
    const idAzione = String(parametri.callId ?? randomUUID());
    const strumenti = await this.#strumentiPronti();
    const completo = `mcp__${spazio}__${nome}`;
    const libero =
      this.#impostazioni.permessi === "senza-permessi" ||
      this.#cfg.strumentiSenzaRichiesta.includes(completo) ||
      this.#cfg.consenteDaSe?.(completo, argomenti, this.#impostazioni.permessi) === true;
    if (!libero && strumenti.ha(spazio, nome)) {
      const NO = { contentItems: [{ type: "inputText", text: "Il proprietario ha negato questa azione." }], success: false };
      const deciso = await this.#chiedi(idAzione, idAzione, { strumento: completo, ingresso: argomenti }, undefined, "si", NO);
      if ("risultato" in deciso && deciso.risultato !== "si") return deciso;
    }
    return { risultato: await strumenti.esegui(spazio, nome, argomenti) };
  }

  /** Codex pone domande al proprietario: le mostra la scheda delle domande di Shinka. */
  async #domandeDiCodex(parametri: Record<string, unknown>): Promise<RispostaAlServer> {
    const lette = Array.isArray(parametri.questions) ? (parametri.questions as { id?: unknown; header?: unknown; question?: unknown; options?: unknown }[]) : [];
    const domande: Domanda[] = lette.map((voce) => ({
      domanda: String(voce.question ?? ""),
      intestazione: String(voce.header ?? "").slice(0, 40),
      opzioni: (Array.isArray(voce.options) ? (voce.options as { label?: unknown; description?: unknown }[]) : []).map((opzione) => ({
        etichetta: String(opzione.label ?? ""),
        ...(typeof opzione.description === "string" && opzione.description !== "" ? { descrizione: opzione.description } : {}),
      })),
      piuScelte: false,
    }));
    if (domande.length === 0) return { risultato: { answers: {} } };
    const raccolte = await this.#domande.poni(domande, String(parametri.itemId ?? randomUUID()), this.#fineDelTurno.signal);
    const answers: Record<string, { answers: string[] }> = {};
    lette.forEach((voce, posizione) => {
      const risposta = raccolte.esito === "risposte" ? raccolte.risposte[posizione] : raccolte.esito === "in-chat" ? raccolte.testo : undefined;
      if (risposta !== undefined) answers[String(voce.id ?? posizione)] = { answers: [risposta] };
    });
    return { risultato: { answers } };
  }

  /** Chiede il consenso al proprietario, a meno che la configurazione non lo dia da sé. */
  #chiedi(idAzione: string, idPermesso: string, azione: { strumento: string; ingresso: unknown }, motivo: string | undefined, si: unknown, no: unknown): Promise<RispostaAlServer> {
    if (this.#cfg.consenteDaSe?.(azione.strumento, azione.ingresso, this.#impostazioni.permessi) === true) return Promise.resolve({ risultato: si });
    return new Promise((risolvi) => {
      this.#permessi.set(idPermesso, { risolvi, si, no });
      this.#cfg.alEvento({ tipo: "permesso-richiesto", idPermesso, idAzione, strumento: azione.strumento, ingresso: azione.ingresso, ...(motivo === undefined ? {} : { motivo }) });
    });
  }

  #negaTutti(_motivo: string): void {
    for (const [idPermesso, inAttesa] of [...this.#permessi]) {
      this.#permessi.delete(idPermesso);
      inAttesa.risolvi({ risultato: inAttesa.no });
      this.#cfg.alEvento({ tipo: "permesso-deciso", idPermesso, decisione: "negato" });
    }
  }

  #chiudiTurno(motivo: string): void {
    this.#negaTutti(motivo);
    this.#domande.annullaTutte();
    if (!this.#inTurno) return;
    this.#inTurno = false;
    this.#turno = undefined;
    this.#cfg.alEvento({ tipo: "turno-concluso", riuscito: false, durataMs: 0, errore: motivo });
  }

  #finito(avvio: Promise<ClienteAppServer>, motivo: string): void {
    if (this.#cliente === avvio) this.#cliente = undefined;
    this.#chiudiTurno(`La conversazione si è chiusa prima della risposta. ${motivo}`.trim());
  }

  /**
   * Il modello da chiedere: quello scelto, se è di Codex; altrimenti il predefinito di Codex, detto
   * esplicitamente, perché un thread nato con un nome di Claude lo terrebbe.
   */
  async #modello(cliente: ClienteAppServer): Promise<{ model?: string }> {
    const scelto = modelloPerCodex(this.#impostazioni.modello);
    if (scelto !== undefined) return { model: scelto };
    if (this.#impostazioni.modello === undefined) return {};
    if (this.#predefinito === undefined) {
      try {
        const letti = (await cliente.richiedi("model/list", {}, 20_000)) as { data?: { model?: string; isDefault?: boolean }[] };
        this.#predefinito = (letti.data ?? []).find((modello) => modello.isDefault === true)?.model ?? letti.data?.[0]?.model;
      } catch {
        // Senza elenco resta il modello del thread.
      }
    }
    return this.#predefinito === undefined ? {} : { model: this.#predefinito };
  }

  /** Legge le skill che Codex vede in questa cartella: sono, con /compact, i comandi che riconosce. */
  async #leggiLeSkill(cliente: ClienteAppServer): Promise<ComandoDisponibile[]> {
    const lette = skillDiCodex(await cliente.richiedi("skills/list", { cwds: [this.#cfg.cartella] }, 20_000));
    this.#skill.clear();
    for (const { comando, percorso } of lette) this.#skill.set(comando.nome, percorso);
    return [COMANDO_COMPATTA, ...lette.map(({ comando }) => comando)];
  }

  /** Limiti del piano e, la prima volta, i modelli tra cui scegliere e i comandi del menu "/". */
  async #riferisciStato(cliente: ClienteAppServer): Promise<void> {
    const stato: StatoConversazione = {};
    if (this.#comandiDaRiferire) {
      this.#comandiDaRiferire = false;
      try {
        stato.comandi = this.#comandiLetti ?? (await this.#leggiLeSkill(cliente));
        this.#comandiLetti = undefined;
      } catch {
        // Senza elenco delle skill resta il comando che Shinka esegue da sé.
        stato.comandi = [COMANDO_COMPATTA];
      }
    }
    try {
      const letti = (await cliente.richiedi("account/rateLimits/read", {}, 20_000)) as { rateLimits?: unknown };
      const limiti = limitiDi(letti.rateLimits);
      if (limiti !== undefined) stato.limiti = limiti;
    } catch {
      // Senza limiti la riga dei controlli semplicemente non li mostra.
    }
    if (!this.#modelliRiferiti) {
      try {
        stato.modelli = modelliDiCodex(await cliente.richiedi("model/list", {}, 20_000));
        this.#modelliRiferiti = true;
      } catch {
        // Senza elenco l'interfaccia propone i nomi che conosce.
      }
    }
    if (Object.keys(stato).length > 0) this.#cfg.alEvento({ tipo: "stato", stato });
  }

  /** Salva i file allegati nella cartella di lavoro; le immagini Codex le legge da lì. */
  #salva(allegati: Allegato[]): { salvati: string[]; percorsiImmagini: string[] } {
    const salvati: string[] = [];
    const percorsiImmagini: string[] = [];
    if (allegati.length === 0) return { salvati, percorsiImmagini };
    const cartella = join(this.#cfg.cartella, "allegati");
    for (const allegato of allegati) {
      try {
        mkdirSync(cartella, { recursive: true });
        const nome = `${Date.now()}-${nomeSicuro(allegato.nome)}`;
        writeFileSync(join(cartella, nome), Buffer.from(allegato.dati, "base64"), { flag: "wx" });
        if (eImmagine(allegato.tipo)) percorsiImmagini.push(join(cartella, nome));
        else salvati.push(nome);
      } catch {
        this.#cfg.alEvento({ tipo: "errore", messaggio: `Non sono riuscito a salvare il file allegato "${allegato.nome}".` });
      }
    }
    return { salvati, percorsiImmagini };
  }

  #armaInattivita(): void {
    this.#disarmaInattivita();
    this.#timerInattivita = setTimeout(() => {
      if (!this.#inTurno) this.chiudi();
    }, this.#cfg.inattivitaMs ?? INATTIVITA_PREDEFINITA_MS);
    this.#timerInattivita.unref();
  }

  #disarmaInattivita(): void {
    if (this.#timerInattivita !== undefined) clearTimeout(this.#timerInattivita);
    this.#timerInattivita = undefined;
  }
}

/** I modelli di Codex come li dice `model/list`, in quelli tra cui il proprietario sceglie. */
export function modelliDiCodex(risposta: unknown): ModelloDisponibile[] {
  const letti = risposta as { data?: { model?: string; displayName?: string; description?: string; hidden?: boolean; supportedReasoningEfforts?: { reasoningEffort?: string }[] }[] } | undefined;
  return (letti?.data ?? [])
    .filter((modello) => modello.hidden !== true && typeof modello.model === "string")
    .map((modello) => {
      const impegni = (modello.supportedReasoningEfforts ?? []).map((voce) => voce.reasoningEffort).filter((voce): voce is Impegno => IMPEGNI.includes(voce as Impegno));
      return { valore: modello.model ?? "", nome: modello.displayName ?? modello.model ?? "", descrizione: modello.description ?? "", ...(impegni.length === 0 ? {} : { impegni }) };
    });
}

/** I messaggi del proprietario e le risposte di Codex nei turni di un thread. */
export function scambiDiCodex(turni: unknown): ScambioDellaStoria[] {
  if (!Array.isArray(turni)) return [];
  const scambi: ScambioDellaStoria[] = [];
  for (const turno of turni as { items?: unknown }[]) {
    if (!Array.isArray(turno?.items)) continue;
    for (const voce of turno.items as Record<string, unknown>[]) {
      if (voce.type === "userMessage" && Array.isArray(voce.content)) {
        // Ogni parte a sé: le note di Shinka arrivano in una parte loro, prima del messaggio.
        for (const parte of voce.content as { type?: unknown; text?: unknown }[]) {
          const testo = parte.type === "text" && typeof parte.text === "string" ? parte.text.trim() : "";
          if (testo !== "") scambi.push({ chi: "proprietario", testo });
        }
      } else if (voce.type === "agentMessage" && typeof voce.text === "string" && voce.text.trim() !== "") {
        scambi.push({ chi: "motore", testo: voce.text.trim() });
      }
    }
  }
  return scambi;
}

export type { Motore };

/** Il motore predefinito di questa installazione, finché non lo dicono le impostazioni: la variabile SHINKA_MOTORE. */
export function motoreConfigurato(ambiente: NodeJS.ProcessEnv = process.env): Motore {
  return ambiente.SHINKA_MOTORE?.trim().toLowerCase() === "codex" ? "codex" : "claude";
}

/** Per i tipi di chi riceve gli eventi. */
export type { EventoConversazione };
