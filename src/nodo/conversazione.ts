/**
 * Una conversazione con l'harness, tenuta aperta tra un messaggio e l'altro.
 *
 * Il processo di Claude Code parte al primo bisogno e resta vivo: così le risposte
 * successive non pagano di nuovo il tempo di avvio. Dopo un periodo di inattività
 * viene chiuso, e al messaggio seguente la conversazione riprende dal suo identificativo.
 */

import {
  forkSession,
  getSessionMessages,
  query,
  type CanUseTool,
  type PermissionUpdate,
  type Options,
  type PermissionResult,
  type Query,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ambientePerHarness, ambientePerModelloLocale, fonteConfigurata, verificaFonte, type ServerDelModelloLocale } from "../harness/autenticazione.ts";
import { estensioneDelModello } from "../protocollo/estensioni.ts";
import type { FonteModelliLocali, PresaDelModello } from "./modelli-locali.ts";
import type {
  DecisionePermesso,
  EventoConversazione,
  AnteprimaRiavvolgimento,
  EsitoBiforcazione,
  PortaConversazione,
  RispostaAParte,
  RispostaAlleDomande,
  ScambioDellaStoria,
  UscitaAttivita,
} from "../protocollo/eventi.ts";
import { istruzioniDelloStile } from "../protocollo/stili.ts";
import { STRUMENTI_DI_MODIFICA, type EsitoAnnullamento, type VersioniDiUnFile } from "../protocollo/modifiche.ts";
import { RegistroModifiche } from "./modifiche.ts";
import { RegistroAttivita, type MessaggioAttivita } from "./attivita.ts";
import { eImmagine, nomeSicuro, type Allegato } from "../protocollo/allegati.ts";
import type {
  FinestraDiUtilizzo,
  ImpostazioniConversazione,
  ModoPermessi,
  StatoConversazione,
} from "../protocollo/impostazioni.ts";
import { controlloDelleDomande, DomandeInSospeso, type ChiediRisposte } from "./domande.ts";
import type { FonteEstensioni } from "./estensioni.ts";
import { nuovoStato, risultatoDiUnaNota, traduci } from "./traduzione.ts";

export interface ConfigurazioneConversazione {
  /** Cartella di lavoro della conversazione. */
  cartella: string;
  /**
   * Istruzioni di sistema: un testo nostro, oppure quelle di Claude Code.
   * Una funzione viene chiamata a ogni avvio del processo, per istruzioni che cambiano nel tempo.
   */
  istruzioni: string | "claude-code" | (() => string);
  /**
   * Un'aggiunta in coda alle istruzioni di Claude Code. Vale da ogni avvio del processo: le
   * istruzioni non si fissano alla conversazione, perché lo stile delle risposte può cambiare.
   */
  istruzioniAggiunte?: string;
  /** Strumenti che Claude ha a disposizione: un elenco, oppure tutti quelli di Claude Code. */
  strumenti: string[] | "claude-code";
  /** Tra quelli, gli strumenti che non richiedono il consenso del proprietario. */
  strumentiSenzaRichiesta: string[];
  /** Strumenti che Claude non deve avere, anche se compresi tra quelli di Claude Code. */
  strumentiVietati?: string[];
  /** Modello, impegno e modo dei permessi con cui la conversazione comincia. */
  impostazioni: ImpostazioniConversazione;
  /** Se vero, valgono impostazioni, skill e strumenti di Claude Code presenti nell'ambiente. */
  impostazioniDellAmbiente?: boolean;
  /**
   * Azioni che non richiedono il consenso del proprietario anche se l'harness lo chiederebbe:
   * dipende da che cosa fanno e dal modo dei permessi scelto, e lo decide chi configura la conversazione.
   */
  consenteDaSe?(strumento: string, ingresso: unknown, modo: ModoPermessi): boolean;
  /**
   * Crea gli strumenti nostri offerti alla conversazione, per nome del gruppo. Ogni motore aperto
   * li crea una volta per sé: un server MCP si collega a un solo client per volta, e quando il
   * proprietario cambia motore quello di prima può tenerli ancora mentre il nuovo parte.
   */
  strumentiNostri?: () => NonNullable<Options["mcpServers"]>;
  /** La cartella delle skill di Shinka in questo ambiente: l'harness la carica come plugin. */
  cartellaSkill?: string;
  /**
   * Le estensioni accese nell'ambiente in cui gira la conversazione, chieste a ogni avvio del
   * processo: i plugin partono con lui, i server gli vengono dati subito dopo, prima del primo messaggio.
   */
  estensioni?: FonteEstensioni;
  /**
   * Se vero, la conversazione può usare il browser di questa macchina attraverso l'estensione
   * di Claude che il proprietario vi ha installato. Lì ogni azione gli viene chiesta, in qualunque
   * modo dei permessi.
   */
  browserDelPc?: boolean;
  /** Identificativo da cui riprendere, se la conversazione esiste già. */
  idSessione?: string;
  /**
   * Dove tenere le versioni dei file che Claude cambia, turno per turno, per il pannello Modifiche.
   * Se manca restano in memoria finché il processo è acceso.
   */
  cartellaModifiche?: string;
  /** Dopo quanto tempo senza turni il processo viene chiuso. */
  inattivitaMs?: number;
  /**
   * I modelli locali di questo ambiente (ADR 0051): se il modello scelto è uno di quelli, il processo
   * parla con il suo server, che si accende prima del primo messaggio.
   */
  modelliLocali?: FonteModelliLocali;
  alEvento(evento: EventoConversazione): void;
  /** Chiamata quando l'harness assegna o cambia l'identificativo; stringa vuota se va dimenticato. */
  alIdSessione(id: string): void;
}

const INATTIVITA_PREDEFINITA_MS = 15 * 60 * 1000;

/**
 * Per quanto il processo resta acceso, senza turni, mentre qualcosa lavora in background: chiuderlo
 * fermerebbe quel lavoro, e Claude non saprebbe mai com'è finito. Dopo, si chiude comunque.
 */
const INATTIVITA_CON_LAVORO_IN_SFONDO_MS = 12 * 60 * 60 * 1000;

/** Quanto si aspetta che i server delle estensioni partano, prima di far lavorare la conversazione senza. */
const ATTESA_ESTENSIONI_MS = 45_000;

interface PermessoInAttesa {
  approva(sempre?: boolean): void;
  nega(motivo: string): void;
}

/** Ciò che il proprietario ha deciso di un'azione che gli è stata chiesta. */
export type Consenso = { approvato: true; sempre?: true } | { approvato: false; motivo: string };

/** Chiede al proprietario il consenso per un'azione, e aspetta la sua decisione. */
export type ChiediConsenso = (strumento: string, ingresso: unknown, idAzione: string, segnale: AbortSignal, motivo?: string, regola?: string) => Promise<Consenso>;

/**
 * Quanto l'harness aspetta il controllo che chiede al proprietario un'azione nel browser del PC.
 * Scaduto il tempo l'azione non parte: lo dice la prova `src/prove/consenso-negli-altri-modi.ts`.
 */
export const ATTESA_DEL_CONSENSO_NEL_BROWSER_S = 12 * 60 * 60;

/** Perché un'azione nel browser del PC viene chiesta anche dove il modo dei permessi non chiede nulla. */
const MOTIVO_DEL_BROWSER = "Nel browser del PC, in «Chiedi sempre» e «Modifiche libere», ogni azione passa dal proprietario.";

export interface OpzioniConversazione {
  /** Come si avvia l'harness. Nei test, uno finto. */
  avvia?: typeof query;
}

export class Conversazione implements PortaConversazione {
  readonly #cfg: ConfigurazioneConversazione;
  readonly #avvia: typeof query;
  #idSessione: string | undefined;
  #impostazioni: ImpostazioniConversazione;
  /** Vero se le impostazioni sono cambiate a metà turno: il processo riparte quando il turno finisce. */
  #daRiavviare = false;
  /** Vero se le skill sono cambiate a metà turno: si rileggono quando il turno finisce. */
  #skillCambiate = false;
  #coda: Coda<SDKUserMessage> | undefined;
  #query: Query | undefined;
  #turniInCorso = 0;
  /** Il punto della storia dell'harness da cui riprendere al prossimo avvio, dopo un riavvolgimento. */
  #riprendiAl: string | undefined;
  /** I comandi e gli agenti che lavorano in background, per identificativo; non quelli che non sono lavoro. */
  #inSfondo = new Set<string>();
  /** Vero da quando il proprietario chiede di fermare il turno fino a che il turno si chiude. */
  #interruzioneRichiesta = false;
  #timerInattivita: NodeJS.Timeout | undefined;
  readonly #permessi = new Map<string, PermessoInAttesa>();
  readonly #domande: DomandeInSospeso;
  readonly #modifiche: RegistroModifiche;
  readonly #attivita = new RegistroAttivita();
  /** L'elenco delle attività va riferito: si aspetta un attimo, perché i progressi arrivano a raffica. */
  #attivitaDaRiferire: NodeJS.Timeout | undefined;

  constructor(cfg: ConfigurazioneConversazione, opzioni: OpzioniConversazione = {}) {
    this.#avvia = opzioni.avvia ?? query;
    // Gli strumenti si creano una volta: ogni avvio dell'harness, e il cambio delle estensioni, ripete gli stessi.
    const strumenti = cfg.strumentiNostri?.();
    this.#cfg = strumenti === undefined ? cfg : { ...cfg, strumentiNostri: () => strumenti };
    this.#modifiche = new RegistroModifiche(cfg.cartella, cfg.cartellaModifiche, {
      alStato: (fileDeiComandi) => cfg.alEvento({ tipo: "stato", stato: { fileDeiComandi } }),
    });
    this.#idSessione = cfg.idSessione === "" ? undefined : cfg.idSessione;
    this.#impostazioni = cfg.impostazioni;
    this.#domande = new DomandeInSospeso(cfg.alEvento);
  }

  prepara(): void {
    this.#assicuraAvviata();
    if (this.#turniInCorso === 0) this.#armaInattivita();
  }

  invia(testo: string, allegati: Allegato[] = []): void {
    // Mentre Claude aspetta le risposte alle sue domande, un messaggio scritto in chat è la risposta:
    // il turno è lo stesso, e Claude va avanti da lì.
    if (this.#domande.inAttesa && allegati.length === 0 && testo.trim() !== "") {
      this.#cfg.alEvento({ tipo: "messaggio-proprietario", id: randomUUID(), testo });
      this.#domande.rispondiInChat(testo);
      return;
    }
    const coda = this.#assicuraAvviata();
    this.#disarmaInattivita();
    // Mentre Claude lavora, un messaggio nuovo entra nel turno in corso: l'harness lo chiude una volta sola.
    const turnoNuovo = this.#apriTurno();
    const immagini = allegati.filter((allegato) => eImmagine(allegato.tipo));
    // Le immagini le vede Claude direttamente; gli altri file li trova nella cartella di lavoro.
    const { salvati, falliti } = this.#salvaFile(allegati.filter((allegato) => !eImmagine(allegato.tipo)));
    // Lo stesso identificativo per Shinka e per l'harness: così si può ripartire da questo messaggio.
    const id = randomUUID();
    this.#cfg.alEvento({
      tipo: "messaggio-proprietario",
      id,
      testo,
      ...(immagini.length === 0 ? {} : { immagini: immagini.map(({ tipo, dati }) => ({ tipo, dati })) }),
      ...(salvati.length === 0 ? {} : { file: salvati }),
      modificabile: true,
    });
    if (turnoNuovo) this.#cfg.alEvento({ tipo: "turno-iniziato" });
    for (const nome of falliti) {
      this.#cfg.alEvento({ tipo: "errore", messaggio: `Non sono riuscito a salvare il file allegato "${nome}".` });
    }
    const nota =
      salvati.length === 0
        ? ""
        : `[Il proprietario ha allegato questi file, salvati nella cartella di lavoro: ${salvati
            .map((nome) => `allegati/${nome}`)
            .join(", ")}]`;
    const scritto = [testo, nota].filter((parte) => parte !== "").join("\n\n");
    coda.metti({
      type: "user",
      message: {
        role: "user",
        content:
          immagini.length === 0
            ? scritto
            : [
                ...immagini.map((immagine) => ({
                  type: "image" as const,
                  source: {
                    type: "base64" as const,
                    media_type: immagine.tipo as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
                    data: immagine.dati,
                  },
                })),
                ...(scritto === "" ? [] : [{ type: "text" as const, text: scritto }]),
              ],
      },
      parent_tool_use_id: null,
      uuid: id as `${string}-${string}-${string}-${string}-${string}`,
    });
  }

  async anteprimaRiavvolgimento(idMessaggio: string): Promise<AnteprimaRiavvolgimento> {
    if (this.#turniInCorso > 0) return { motivo: "Claude sta lavorando: aspetta che finisca, o fermalo." };
    this.#assicuraAvviata();
    const sessione = this.#query;
    if (sessione === undefined) return { motivo: "La conversazione non è partita." };
    try {
      const prova = await sessione.rewindFiles(idMessaggio, { dryRun: true });
      if (!prova.canRewind) return { file: [], aggiunte: 0, tolte: 0 };
      return { file: prova.filesChanged ?? [], aggiunte: prova.insertions ?? 0, tolte: prova.deletions ?? 0 };
    } catch (errore) {
      return { motivo: testoErrore(errore) };
    } finally {
      if (this.#turniInCorso === 0) this.#armaInattivita();
    }
  }

  async riprendiDa(idMessaggio: string, opzioni: { file: boolean }): Promise<string | undefined> {
    if (this.#turniInCorso > 0) return "Claude sta lavorando: aspetta che finisca, o fermalo.";
    const trovato = await this.#puntoPrima(idMessaggio);
    if ("motivo" in trovato) return trovato.motivo;
    const { punto } = trovato;
    let fileRiportati: string[] | undefined;
    if (opzioni.file) {
      this.#assicuraAvviata();
      const sessione = this.#query;
      if (sessione === undefined) return "La conversazione non è partita.";
      try {
        const prova = await sessione.rewindFiles(idMessaggio, { dryRun: true });
        const fatto = await sessione.rewindFiles(idMessaggio);
        if (!fatto.canRewind) return `I file non si possono riportare a com'erano: ${fatto.error ?? "l'harness non lo sa fare"}.`;
        fileRiportati = prova.filesChanged ?? [];
      } catch (errore) {
        return `I file non si possono riportare a com'erano: ${testoErrore(errore)}`;
      }
    }
    // Il processo riparte da quel punto al prossimo messaggio; dal primo messaggio, da capo.
    this.chiudi();
    if (punto === null) {
      this.#idSessione = undefined;
      this.#cfg.alIdSessione("");
    } else {
      this.#riprendiAl = punto;
    }
    this.#cfg.alEvento({ tipo: "riavvolto", idMessaggio, ...(fileRiportati === undefined ? {} : { fileRiportati }) });
    return undefined;
  }

  async biforca(idMessaggio: string): Promise<EsitoBiforcazione> {
    const trovato = await this.#puntoPrima(idMessaggio);
    if ("motivo" in trovato) return { riuscita: false, motivo: trovato.motivo };
    if (trovato.punto === null || this.#idSessione === undefined) return { riuscita: true };
    try {
      const copia = await forkSession(this.#idSessione, { dir: this.#cfg.cartella, upToMessageId: trovato.punto });
      return { riuscita: true, idSessione: copia.sessionId };
    } catch (errore) {
      return { riuscita: false, motivo: `Non riesco a copiare la conversazione: ${testoErrore(errore)}` };
    }
  }

  /**
   * Il punto da cui ripartire per rifare un messaggio: l'ultima voce della storia dell'harness prima
   * di quello, oppure null se è il primo. Il motivo, se il messaggio non c'è.
   */
  async #puntoPrima(idMessaggio: string): Promise<{ punto: string | null } | { motivo: string }> {
    if (this.#idSessione === undefined) return { motivo: "La conversazione non ha ancora una storia da cui ripartire." };
    try {
      const storia = await getSessionMessages(this.#idSessione, { dir: this.#cfg.cartella });
      const posizione = storia.findIndex((voce) => voce.uuid === idMessaggio);
      if (posizione < 0) return { motivo: "Questo messaggio non è nella storia di Claude: non si può ripartire da qui." };
      return { punto: posizione === 0 ? null : (storia[posizione - 1]?.uuid ?? null) };
    } catch (errore) {
      return { motivo: `Non riesco a leggere la storia della conversazione: ${testoErrore(errore)}` };
    }
  }

  /** La storia della sessione, letta dai file di Claude Code: anche a processo spento. */
  async storia(): Promise<ScambioDellaStoria[]> {
    if (this.#idSessione === undefined) return [];
    return scambiDiClaude(await getSessionMessages(this.#idSessione, { dir: this.#cfg.cartella }));
  }

  /**
   * Una domanda a parte: un processo apposta riprende una copia della conversazione che non viene
   * salvata, senza strumenti, per una risposta sola. La conversazione vera non cambia, e può anche
   * stare lavorando.
   */
  async chiediAParte(domanda: string): Promise<RispostaAParte> {
    if (estensioneDelModello(this.#impostazioni.modello) !== undefined) return { motivo: "Con un modello locale la domanda a parte non c'è." };
    const fonte = fonteConfigurata();
    const base = opzioniHarness(this.#cfg, fonte, this.#idSessione, this.#impostazioni, async () => ({
      behavior: "deny",
      message: "In una domanda a parte non si usano strumenti.",
    }));
    const opzioni: Options = {
      cwd: base.cwd,
      env: base.env,
      systemPrompt: base.systemPrompt,
      ...(base.model === undefined ? {} : { model: base.model }),
      ...(base.effort === undefined ? {} : { effort: base.effort }),
      tools: [],
      maxTurns: 1,
      settingSources: [],
      strictMcpConfig: true,
      persistSession: false,
      ...(this.#idSessione === undefined ? {} : { resume: this.#idSessione, forkSession: true }),
      // Dopo una modifica non ancora ripartita, Claude sa solo ciò che viene prima di quel punto.
      ...(this.#riprendiAl === undefined || this.#idSessione === undefined ? {} : { resumeSessionAt: this.#riprendiAl }),
    };
    const testo =
      "[Shinka] Domanda a parte del proprietario: rispondi in breve, con ciò che sai già da questa conversazione. " +
      "Qui non hai strumenti, e né la domanda né la risposta resteranno nella conversazione.\n\n" +
      domanda;
    try {
      let risposta: string | undefined;
      let errore: string | undefined;
      for await (const messaggio of query({ prompt: testo, options: opzioni })) {
        if (messaggio.type === "system" && messaggio.subtype === "init") verificaFonte(fonte, messaggio.apiKeySource);
        if (messaggio.type !== "result") continue;
        if (messaggio.subtype === "success" && !messaggio.is_error) risposta = messaggio.result;
        else errore = messaggio.subtype === "success" ? messaggio.result : messaggio.subtype;
      }
      if (risposta !== undefined && risposta.trim() !== "") return { testo: risposta.trim() };
      return { motivo: `Claude non ha risposto${errore === undefined ? "" : `: ${errore}`}.` };
    } catch (errore) {
      return { motivo: `La domanda a parte non è partita: ${testoErrore(errore)}` };
    }
  }

  versioniModificate(idTurno: string, percorso: string): Promise<VersioniDiUnFile | { motivo: string }> {
    return this.#modifiche.versioni(idTurno, percorso);
  }

  async annullaModifiche(idTurno: string, percorsi?: readonly string[]): Promise<EsitoAnnullamento | { motivo: string }> {
    if (this.#turniInCorso > 0) return { motivo: "Claude sta lavorando: aspetta che finisca, o fermalo." };
    const esito = await this.#modifiche.annulla(idTurno, percorsi);
    if ("motivo" in esito || esito.annullati.length === 0) return esito;
    this.#cfg.alEvento({ tipo: "modifiche-decise", idTurno, percorsi: esito.annullati, esito: "annullate" });
    // Claude deve saperlo: altrimenti continuerebbe come se i file fossero quelli che ha lasciato.
    this.annota(
      `[Shinka] Il proprietario ha riportato a com'erano prima di un tuo turno questi file: ${esito.annullati.join(", ")}. ` +
        "Le modifiche che vi avevi fatto non ci sono più: se ti servono, rileggili.",
    );
    return esito;
  }

  imposta(impostazioni: ImpostazioniConversazione): void {
    this.#impostazioni = impostazioni;
    if (this.#query === undefined) return;
    if (this.#turniInCorso === 0) {
      // Il processo si chiude: al prossimo messaggio riparte, dalla stessa conversazione, con le scelte nuove.
      this.chiudi();
      return;
    }
    this.#daRiavviare = true;
    // Il modo dei permessi vale subito anche per il turno in corso, se l'harness lo consente.
    // Le azioni nel browser del PC continuano a passare dal proprietario: il loro controllo non dipende dal modo.
    const modo = MODI_DELL_HARNESS[impostazioni.permessi];
    if (modo !== "bypassPermissions") this.#query.setPermissionMode(modo).catch(() => {});
  }

  istruisci(testo: string): void {
    const coda = this.#assicuraAvviata();
    this.#disarmaInattivita();
    if (this.#apriTurno()) this.#cfg.alEvento({ tipo: "turno-iniziato" });
    coda.metti({ type: "user", message: { role: "user", content: testo }, parent_tool_use_id: null });
  }

  annota(testo: string): void {
    const coda = this.#assicuraAvviata();
    // Entra nel contesto e viene letta al prossimo turno, senza far rispondere Claude adesso.
    coda.metti({
      type: "user",
      message: { role: "user", content: testo },
      parent_tool_use_id: null,
      shouldQuery: false,
    });
    // Se l'annotazione ha fatto partire il processo, senza turni va comunque chiuso dopo l'inattività.
    if (this.#turniInCorso === 0) this.#armaInattivita();
  }

  /**
   * Le skill di Shinka sono cambiate: il processo in corso le rilegge, così una skill appena
   * creata o corretta vale senza aspettare la prossima seduta. Se il processo non c'è, le
   * leggerà quando parte.
   */
  ricaricaSkill(): void {
    if (this.#query === undefined || this.#cfg.cartellaSkill === undefined) return;
    if (this.#turniInCorso > 0) {
      this.#skillCambiate = true;
      return;
    }
    this.#skillCambiate = false;
    // Se non riesce, restano le skill di prima fino al prossimo avvio del processo.
    void this.#query.reloadPlugins().catch(() => {});
  }

  /**
   * Le estensioni accese in questo ambiente sono cambiate: il processo si chiude, e al prossimo
   * messaggio la conversazione riprende con quelle nuove. A metà turno aspetta che il turno finisca.
   */
  ricaricaEstensioni(): void {
    if (this.#query === undefined || this.#cfg.estensioni === undefined) return;
    if (this.#turniInCorso > 0) {
      this.#daRiavviare = true;
      return;
    }
    this.chiudi();
  }

  decidiPermesso(idPermesso: string, decisione: DecisionePermesso, sempre = false): boolean {
    const inAttesa = this.#permessi.get(idPermesso);
    if (inAttesa === undefined) return false;
    if (decisione === "approvato") inAttesa.approva(sempre);
    else inAttesa.nega("Il proprietario ha negato questa azione.");
    return true;
  }

  rispondiDomande(idDomande: string, risposta: RispostaAlleDomande): boolean {
    return this.#domande.rispondi(idDomande, risposta);
  }

  async interrompi(): Promise<void> {
    if (this.#query === undefined || this.#turniInCorso === 0) return;
    this.#interruzioneRichiesta = true;
    await this.#query.interrupt();
  }

  chiudi(): void {
    this.#disarmaInattivita();
    const coda = this.#coda;
    const sessione = this.#query;
    // Si dimenticano subito: un messaggio che arrivasse ora deve far partire un processo nuovo.
    this.#coda = undefined;
    this.#query = undefined;
    this.#daRiavviare = false;
    this.#skillCambiate = false;
    // Con il processo finisce anche ciò che lavorava in background.
    this.#nessunLavoroInSfondo();
    coda?.chiudi();
    sessione?.close();
  }

  /** Riferisce l'elenco delle attività: subito, oppure dopo un attimo se è solo un progresso. */
  #riferisciAttivita(subito: boolean): void {
    if (this.#attivitaDaRiferire !== undefined && !subito) return;
    if (this.#attivitaDaRiferire !== undefined) clearTimeout(this.#attivitaDaRiferire);
    const riferisci = (): void => {
      this.#attivitaDaRiferire = undefined;
      this.#cfg.alEvento({ tipo: "attivita", attivita: this.#attivita.elenco() });
    };
    if (subito) {
      this.#attivitaDaRiferire = undefined;
      riferisci();
      return;
    }
    this.#attivitaDaRiferire = setTimeout(riferisci, 1000);
    this.#attivitaDaRiferire.unref();
  }

  uscitaAttivita(idAttivita: string): Promise<UscitaAttivita | { motivo: string }> {
    return this.#attivita.uscita(idAttivita);
  }

  #nessunLavoroInSfondo(): void {
    if (this.#attivita.processoChiuso()) this.#riferisciAttivita(true);
    if (this.#inSfondo.size === 0) return;
    this.#inSfondo.clear();
    this.#cfg.alEvento({ tipo: "stato", stato: { inSfondo: 0 } });
  }

  /** Il modello locale scelto, preso per il processo che sta per partire; nulla se il modello scelto non è locale. */
  #prendiModelloLocale(): PresaDelModello | { motivo: string } | undefined {
    const modello = this.#impostazioni.modello;
    if (estensioneDelModello(modello) === undefined || modello === undefined) return undefined;
    if (this.#cfg.modelliLocali === undefined) return { motivo: "in questo ambiente non ci sono modelli locali." };
    return this.#cfg.modelliLocali.prendi(modello, this.#impostazioni.impegno, this.#cfg.cartella);
  }

  #assicuraAvviata(): Coda<SDKUserMessage> {
    if (this.#coda !== undefined) return this.#coda;

    const fonte = fonteConfigurata();
    const coda = new Coda<SDKUserMessage>();
    const estensioni = this.#cfg.estensioni;
    const locale = this.#prendiModelloLocale();
    const opzioni = {
      ...opzioniHarness(
        this.#cfg,
        fonte,
        this.#idSessione,
        this.#impostazioni,
        this.#chiediPermesso,
        estensioni?.plugin() ?? [],
        this.#aspettaIlProprietario,
        this.#domande.poni,
        { pronto: () => this.#modifiche.pronto(), prima: (percorso) => this.#modifiche.prima(percorso) },
        locale === undefined || "motivo" in locale ? undefined : locale,
      ),
      // Dopo un riavvolgimento la storia riprende da quel punto, una volta sola.
      ...(this.#riprendiAl === undefined || this.#idSessione === undefined ? {} : { resumeSessionAt: this.#riprendiAl }),
    };
    this.#riprendiAl = undefined;
    // Con le estensioni, il primo messaggio aspetta che i loro server siano stati dati al processo;
    // con un modello locale, che il suo server risponda.
    let via: () => void = () => {};
    const pronte = new Promise<void>((fatto) => (via = fatto));
    const prontoLocale = locale === undefined ? undefined : "motivo" in locale ? Promise.reject(new Error(locale.motivo)) : locale.pronto;
    const attese = [...(estensioni === undefined ? [] : [pronte]), ...(prontoLocale === undefined ? [] : [prontoLocale.catch(() => {})])];
    const sessione = this.#avvia({ prompt: attese.length === 0 ? coda : dopo(Promise.all(attese).then(() => {}), coda), options: opzioni });
    this.#coda = coda;
    this.#query = sessione;
    if (estensioni !== undefined) void this.#accendiEstensioni(sessione, estensioni).finally(via);
    // Il modello locale non parte: lo si dice, e il processo si chiude con i turni che aspettavano.
    prontoLocale?.catch((errore: unknown) => {
      if (this.#query !== sessione) return;
      this.#cfg.alEvento({ tipo: "errore", messaggio: `Il modello locale non è pronto: ${testoErrore(errore)}` });
      sessione.close();
    });
    void this.#consuma(sessione, coda, fonte, locale === undefined || "motivo" in locale ? undefined : locale);
    // L'harness dice di essere partito solo con il primo messaggio, ma risponde già: modelli,
    // comandi, contesto e limiti del piano si chiedono subito, così il proprietario li vede
    // appena apre la conversazione, prima di scrivere.
    void this.#riferisciStato(sessione, true);
    return coda;
  }

  async #consuma(
    sessione: Query,
    coda: Coda<SDKUserMessage>,
    fonte: ReturnType<typeof fonteConfigurata>,
    /** Il modello locale con cui parla il processo, se è uno di quelli: alla fine si lascia. */
    locale?: PresaDelModello,
  ): Promise<void> {
    const stato = nuovoStato();
    let avviata = false;
    try {
      for await (const messaggio of sessione) {
        if (messaggio.type === "system" && messaggio.subtype === "init") {
          avviata = true;
          // Con un modello locale il piano non c'entra: l'indirizzo del server lo ha messo Shinka.
          if (locale === undefined) verificaFonte(fonte, messaggio.apiKeySource);
          if (messaggio.session_id !== this.#idSessione) {
            this.#idSessione = messaggio.session_id;
            this.#cfg.alIdSessione(messaggio.session_id);
          }
          void this.#riferisciStato(sessione, true);
          continue;
        }
        if (
          messaggio.type === "system" &&
          (messaggio.subtype === "task_started" || messaggio.subtype === "task_progress" || messaggio.subtype === "task_updated" || messaggio.subtype === "task_notification")
        ) {
          if (this.#attivita.ricevi(messaggio as MessaggioAttivita)) this.#riferisciAttivita(messaggio.subtype !== "task_progress");
          continue;
        }
        if (messaggio.type === "system" && messaggio.subtype === "background_tasks_changed") {
          this.#lavoroInSfondo(messaggio.tasks.filter((compito) => compito.ambient !== true).map((compito) => compito.task_id));
          continue;
        }
        // L'harness dice quando lavora e quando ha finito davvero: è la fine di ogni turno, anche
        // di quelli in cui sono entrati più messaggi.
        if (messaggio.type === "system" && messaggio.subtype === "session_state_changed") {
          if (messaggio.state === "running" && this.#apriTurno()) {
            this.#disarmaInattivita();
            this.#cfg.alEvento({ tipo: "turno-iniziato" });
          }
          if (messaggio.state === "idle") this.#chiudiTurniRimasti();
          continue;
        }
        // Claude scrive senza che un turno sia aperto: è l'harness che ne ha cominciato uno da sé,
        // per esempio per dire a Claude che un lavoro in background è finito. Per Shinka è un turno come gli altri.
        if (this.#turniInCorso === 0 && (messaggio.type === "assistant" || messaggio.type === "stream_event")) {
          this.#apriTurno();
          this.#disarmaInattivita();
          this.#cfg.alEvento({ tipo: "turno-iniziato" });
        }
        // Il picco della scheda video va detto prima della fine del turno: chi aspetta un incarico chiude lì.
        if (messaggio.type === "result" && locale !== undefined && !risultatoDiUnaNota(messaggio)) {
          const vramPiccoMb = locale.vramPiccoMb();
          this.#cfg.alEvento({ tipo: "stato", stato: { modelloLocale: { modello: locale.modello, ...(vramPiccoMb === undefined ? {} : { vramPiccoMb }) } } });
        }
        for (const evento of traduci(messaggio, stato)) {
          // Le attività in background prendono dalle azioni il loro comando e dove scrivono l'uscita.
          if (evento.tipo === "azione-iniziata") this.#attivita.azioneIniziata(evento.idAzione, evento.strumento, evento.ingresso);
          if (evento.tipo === "azione-conclusa" && this.#attivita.azioneConclusa(evento.idAzione, evento.esito)) this.#riferisciAttivita(true);
          if (evento.tipo === "turno-concluso" && this.#interruzioneRichiesta) {
            // L'harness chiude un turno interrotto come se fosse fallito: per noi non è un errore.
            this.#interruzioneRichiesta = false;
            this.#cfg.alEvento({
              tipo: "turno-concluso",
              riuscito: true,
              durataMs: evento.durataMs,
              interrotto: true,
              ...(evento.token === undefined ? {} : { token: evento.token }),
            });
          } else {
            this.#cfg.alEvento(evento);
          }
        }
        if (messaggio.type === "result" && !risultatoDiUnaNota(messaggio)) {
          void this.#riferisciStato(sessione, false);
          this.#turnoFinito();
        }
      }
    } catch (errore) {
      const riprendeva = this.#idSessione !== undefined;
      if (!avviata && riprendeva) {
        // La conversazione salvata non si riesce a riaprire: la prossima partirà da capo.
        this.#idSessione = undefined;
        this.#cfg.alIdSessione("");
      }
      this.#cfg.alEvento({
        tipo: "errore",
        messaggio:
          !avviata && riprendeva
            ? "La conversazione precedente non si può riprendere: al prossimo messaggio ne comincia una nuova."
            : `Il processo dell'harness si è fermato: ${testoErrore(errore)}`,
      });
      sessione.close();
    } finally {
      locale?.lascia();
      const sostituita = this.#coda !== undefined && this.#coda !== coda;
      if (this.#coda === coda) {
        this.#coda = undefined;
        this.#query = undefined;
        this.#nessunLavoroInSfondo();
      }
      coda.chiudi();
      // Se nel frattempo è partito un processo nuovo, permessi e turni aperti sono i suoi.
      for (const inAttesa of sostituita ? [] : [...this.#permessi.values()]) {
        inAttesa.nega("La conversazione si è chiusa prima della decisione.");
      }
      if (!sostituita) this.#domande.annullaTutte();
      if (!sostituita && this.#turniInCorso > 0) this.#chiudiModifiche();
      while (!sostituita && this.#turniInCorso > 0) {
        this.#turniInCorso -= 1;
        this.#cfg.alEvento({
          tipo: "turno-concluso",
          riuscito: false,
          durataMs: 0,
          errore: "La conversazione si è chiusa prima della risposta.",
        });
      }
    }
  }

  /**
   * Dà al processo appena partito i server delle estensioni accese nell'ambiente. Passano da qui,
   * e non dalle opzioni di avvio, perché lì le loro chiavi finirebbero tra gli argomenti di un
   * processo, dove chiunque le leggerebbe. Chi non parte viene detto nella conversazione.
   */
  async #accendiEstensioni(sessione: Query, estensioni: FonteEstensioni): Promise<void> {
    const nonPartite: { nome: string; motivo: string }[] = [];
    try {
      const pronte = await conScadenza(estensioni.server(), ATTESA_ESTENSIONI_MS);
      nonPartite.push(...pronte.nonPartite);
      if (Object.keys(pronte.server).length > 0) {
        // L'harness sostituisce tutti i server che gli sono stati dati da noi: vanno ripetuti anche i nostri.
        const esito = await conScadenza(
          sessione.setMcpServers({ ...pronte.server, ...(this.#cfg.strumentiNostri?.() ?? {}) }),
          ATTESA_ESTENSIONI_MS,
        );
        for (const [nome, motivo] of Object.entries(esito.errors)) nonPartite.push({ nome, motivo });
      }
    } catch (errore) {
      // Se il processo si è già chiuso non c'è nulla da dire: lo dirà chi lo stava usando.
      if (this.#query !== sessione) return;
      nonPartite.push({ nome: "", motivo: testoErrore(errore) });
    }
    for (const { nome, motivo } of nonPartite) {
      this.#cfg.alEvento({
        tipo: "errore",
        messaggio:
          nome === ""
            ? `Le estensioni non sono partite in questa conversazione: ${motivo}`
            : `L'estensione "${nome}" non è partita in questa conversazione: ${motivo}`,
      });
    }
  }

  /** Apre un turno se non ce n'è uno in corso: vero se lo ha aperto. Un turno alla volta, come nell'harness. */
  #apriTurno(): boolean {
    if (this.#turniInCorso > 0) return false;
    this.#turniInCorso = 1;
    this.#modifiche.apriTurno();
    return true;
  }

  /** Il turno è finito: se Claude ha cambiato dei file, lo si dice, per il pannello Modifiche. */
  #chiudiModifiche(): void {
    void this.#modifiche
      .chiudiTurno()
      .then((cambiate) => {
        if (cambiate !== undefined) this.#cfg.alEvento({ tipo: "modifiche", ...cambiate });
      })
      .catch(() => {});
  }

  /** L'harness ha finito: se un turno risulta ancora aperto, si chiude qui. */
  #chiudiTurniRimasti(): void {
    if (this.#turniInCorso === 0) return;
    this.#cfg.alEvento({ tipo: "turno-concluso", riuscito: true, durataMs: 0 });
    this.#turnoFinito();
  }

  #turnoFinito(): void {
    this.#turniInCorso = Math.max(0, this.#turniInCorso - 1);
    if (this.#turniInCorso > 0) return;
    this.#chiudiModifiche();
    if (this.#daRiavviare) {
      this.chiudi();
      return;
    }
    if (this.#skillCambiate) this.ricaricaSkill();
    this.#armaInattivita();
  }

  /** Salva nella cartella di lavoro i file allegati che non sono immagini. */
  #salvaFile(file: Allegato[]): { salvati: string[]; falliti: string[] } {
    const salvati: string[] = [];
    const falliti: string[] = [];
    if (file.length === 0) return { salvati, falliti };
    const cartella = join(this.#cfg.cartella, "allegati");
    for (const allegato of file) {
      const nome = nomeSicuro(allegato.nome);
      try {
        mkdirSync(cartella, { recursive: true });
        const contenuto = Buffer.from(allegato.dati, "base64");
        let scelto = nome;
        try {
          // Un file con lo stesso nome non viene mai sovrascritto.
          writeFileSync(join(cartella, scelto), contenuto, { flag: "wx" });
        } catch (errore) {
          if (!(errore instanceof Error && "code" in errore && errore.code === "EEXIST")) throw errore;
          scelto = `${Date.now()}-${nome}`;
          writeFileSync(join(cartella, scelto), contenuto, { flag: "wx" });
        }
        salvati.push(scelto);
      } catch {
        falliti.push(nome);
      }
    }
    return { salvati, falliti };
  }

  /** Chiede all'harness come sta la conversazione e lo riferisce: modello, contesto, limiti del piano. */
  async #riferisciStato(sessione: Query, ancheModelli: boolean): Promise<void> {
    const stato: StatoConversazione = {};
    try {
      const contesto = await sessione.getContextUsage({ detail: "summary" });
      stato.modello = contesto.model;
      const parti = contesto.categories.flatMap((categoria) =>
        categoria.kind === "deferred" || categoria.tokens <= 0
          ? []
          : [{ nome: NOMI_DELLE_PARTI[categoria.id ?? ""] ?? categoria.name, token: categoria.tokens, genere: GENERI_DELLE_PARTI[categoria.kind] }],
      );
      stato.contesto = {
        usati: contesto.totalTokens,
        massimo: contesto.maxTokens,
        percento: Math.round(contesto.percentage),
        ...(parti.length === 0 ? {} : { parti }),
      };
    } catch {
      // L'harness può essersi chiuso nel frattempo: lo stato arriverà al prossimo turno.
    }
    try {
      const uso = await sessione.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({
        skipBehaviors: true,
      });
      const cinqueOre = finestra(uso.rate_limits?.five_hour);
      const setteGiorni = finestra(uso.rate_limits?.seven_day);
      if (cinqueOre !== undefined || setteGiorni !== undefined) {
        stato.limiti = {
          ...(cinqueOre === undefined ? {} : { cinqueOre }),
          ...(setteGiorni === undefined ? {} : { setteGiorni }),
        };
      }
    } catch {
      // Funzione sperimentale dell'harness: se manca, i limiti semplicemente non si vedono.
    }
    if (ancheModelli) {
      try {
        // I comandi per il menu "/" del campo di scrittura.
        stato.comandi = (await sessione.supportedCommands()).map((comando) => ({
          nome: comando.name,
          descrizione: comando.description,
          ...(comando.argumentHint === "" ? {} : { argomenti: comando.argumentHint }),
        }));
      } catch {
        // Senza elenco il menu "/" resta vuoto: i comandi si possono scrivere lo stesso.
      }
      try {
        stato.modelli = (await sessione.supportedModels()).map((modello) => ({
          valore: modello.value,
          nome: modello.displayName,
          descrizione: modello.description,
          ...(modello.supportedEffortLevels === undefined ? {} : { impegni: modello.supportedEffortLevels }),
        }));
      } catch {
        // Senza elenco l'interfaccia propone i nomi brevi dei modelli.
      }
    }
    if (Object.keys(stato).length > 0) this.#cfg.alEvento({ tipo: "stato", stato });
  }

  readonly #chiediPermesso: CanUseTool = async (strumento, ingresso, opzioni): Promise<PermissionResult> => {
    if (this.#cfg.consenteDaSe?.(strumento, ingresso, this.#impostazioni.permessi) === true) {
      return { behavior: "allow", updatedInput: ingresso };
    }
    // «Approva sempre» salva ciò che l'harness propone, ma solo regole e cartelle, e solo per questo progetto.
    const daSalvare = regoleDaSalvare(opzioni.suggestions);
    const consenso = await this.#aspettaIlProprietario(strumento, ingresso, opzioni.toolUseID, opzioni.signal, opzioni.decisionReason, regolaInParole(daSalvare));
    if (!consenso.approvato) return { behavior: "deny", message: consenso.motivo };
    return consenso.sempre === true && daSalvare.length > 0
      ? { behavior: "allow", updatedInput: ingresso, updatedPermissions: daSalvare }
      : { behavior: "allow", updatedInput: ingresso };
  };

  /**
   * Mostra al proprietario la scheda del consenso per un'azione e aspetta che decida. Finisce con
   * un no anche se la richiesta viene annullata o la conversazione si chiude.
   */
  readonly #aspettaIlProprietario: ChiediConsenso = (strumento, ingresso, idAzione, segnale, motivo, regola) =>
    new Promise<Consenso>((risolvi) => {
      const idPermesso = idAzione;
      const chiudi = (consenso: Consenso, decisione: DecisionePermesso): void => {
        if (!this.#permessi.delete(idPermesso)) return;
        const sempre = consenso.approvato && consenso.sempre === true;
        this.#cfg.alEvento({ tipo: "permesso-deciso", idPermesso, decisione, ...(sempre ? { sempre: true as const } : {}) });
        risolvi(consenso);
      };
      const inAttesa: PermessoInAttesa = {
        // «Sempre» vale solo se c'è una regola da salvare.
        approva: (sempre) => chiudi(sempre === true && regola !== undefined ? { approvato: true, sempre: true } : { approvato: true }, "approvato"),
        nega: (perche) => chiudi({ approvato: false, motivo: perche }, "negato"),
      };
      this.#permessi.set(idPermesso, inAttesa);
      this.#cfg.alEvento({
        tipo: "permesso-richiesto",
        idPermesso,
        idAzione,
        strumento,
        ingresso,
        ...(motivo === undefined ? {} : { motivo }),
        ...(regola === undefined ? {} : { regola }),
      });
      if (segnale.aborted) inAttesa.nega("Richiesta annullata.");
      else segnale.addEventListener("abort", () => inAttesa.nega("Richiesta annullata."), { once: true });
    });

  /** Cambia l'insieme dei lavori in background; finito l'ultimo, senza turni, torna l'inattività di sempre. */
  #lavoroInSfondo(compiti: string[]): void {
    const prima = this.#inSfondo.size;
    this.#inSfondo = new Set(compiti);
    if (this.#inSfondo.size !== prima) this.#cfg.alEvento({ tipo: "stato", stato: { inSfondo: this.#inSfondo.size } });
    if (this.#turniInCorso === 0 && this.#query !== undefined) this.#armaInattivita();
  }

  #armaInattivita(): void {
    this.#disarmaInattivita();
    const attesa = this.#inSfondo.size > 0 ? INATTIVITA_CON_LAVORO_IN_SFONDO_MS : (this.#cfg.inattivitaMs ?? INATTIVITA_PREDEFINITA_MS);
    this.#timerInattivita = setTimeout(() => this.chiudi(), attesa);
    this.#timerInattivita.unref();
  }

  #disarmaInattivita(): void {
    if (this.#timerInattivita !== undefined) clearTimeout(this.#timerInattivita);
    this.#timerInattivita = undefined;
  }
}

/** Le parti del contesto, con i nomi di Shinka. */
const NOMI_DELLE_PARTI: Record<string, string> = {
  system_prompt: "Istruzioni di sistema",
  system_tools: "Strumenti di Claude Code",
  mcp_tools: "Strumenti di Shinka e delle estensioni",
  mcp_instructions: "Istruzioni delle estensioni",
  custom_agents: "Agenti",
  memory_files: "File di memoria",
  skills: "Skill",
  messages: "Messaggi",
  autocompact_buffer: "Riserva per la compattazione",
  compact_buffer: "Riserva per la compattazione",
  free_space: "Spazio libero",
};

const GENERI_DELLE_PARTI = { used: "usato", free: "libero", buffer: "riserva", deferred: "usato" } as const;

/** Come l'harness chiama i nostri modi dei permessi. */
const MODI_DELL_HARNESS: Record<ModoPermessi, "default" | "acceptEdits" | "auto" | "bypassPermissions"> = {
  chiedi: "default",
  "modifiche-libere": "acceptEdits",
  automatico: "auto",
  "senza-permessi": "bypassPermissions",
};

function finestra(
  letta: { utilization: number | null; resets_at: string | null } | null | undefined,
): FinestraDiUtilizzo | undefined {
  if (letta === undefined || letta === null || letta.utilization === null) return undefined;
  return {
    percento: Math.round(letta.utilization),
    ...(letta.resets_at === null ? {} : { azzeraIl: letta.resets_at }),
  };
}

/** Come cominciano i nomi degli strumenti che l'estensione del browser offre a Claude Code. */
export const PREFISSO_BROWSER_DEL_PC = "mcp__claude-in-chrome__";

/**
 * Il controllo che precede ogni strumento del browser del PC. Lì dentro Shinka non può far valere
 * i divieti fissi come fa nel browser del gateway: per questo, in «Chiedi sempre» e in «Modifiche
 * libere», ogni azione passa dal proprietario. Il consenso lo chiede il controllo stesso, e non
 * l'harness: se non c'è modo di chiedere, o la risposta non arriva in tempo, l'azione non parte.
 * In «Automatico» e «Senza permessi» il proprietario ha scelto di non essere chiesto (ADR 0064):
 * lì le azioni del browser partono, e i divieti li fanno valere le istruzioni.
 */
function controlloDelBrowserDelPc(chiediConsenso: ChiediConsenso | undefined, permessi: ModoPermessi): NonNullable<NonNullable<Options["hooks"]>["PreToolUse"]>[number] {
  const senzaChiedere = permessi === "automatico" || permessi === "senza-permessi";
  const esito = (permissionDecision: "allow" | "deny", permissionDecisionReason: string) => ({
    hookSpecificOutput: { hookEventName: "PreToolUse" as const, permissionDecision, permissionDecisionReason },
  });
  return {
    matcher: `${PREFISSO_BROWSER_DEL_PC}.*`,
    onFailure: "block",
    timeout: ATTESA_DEL_CONSENSO_NEL_BROWSER_S,
    hooks: [
      async (ingresso, idAzione, { signal }) => {
        if (senzaChiedere && ingresso.hook_event_name === "PreToolUse") {
          return esito("allow", "In questo modo dei permessi il proprietario ha scelto di non essere chiesto per le azioni nel browser.");
        }
        if (chiediConsenso === undefined || ingresso.hook_event_name !== "PreToolUse") {
          return esito("deny", "Nel browser del PC ogni azione passa dal proprietario, e qui non c'è modo di chiederglielo.");
        }
        const consenso = await chiediConsenso(ingresso.tool_name, ingresso.tool_input, idAzione ?? ingresso.tool_use_id, signal, MOTIVO_DEL_BROWSER);
        return consenso.approvato ? esito("allow", "Il proprietario ha approvato questa azione.") : esito("deny", consenso.motivo);
      },
    ],
  };
}

/** Ciò che il registro delle modifiche vuole sapere prima di uno strumento. */
export interface PrimaDegliStrumenti {
  /** Uno strumento che può cambiare i file sta per partire: si aspetta la fotografia dei file del turno. */
  pronto: () => Promise<void>;
  /** Claude sta per cambiare questo file con un suo strumento. */
  prima: (percorso: string) => void;
}

/** Gli strumenti dell'harness che non cambiano nessun file: per loro la fotografia dei file non serve. */
const STRUMENTI_CHE_LEGGONO = new Set(["Read", "Grep", "Glob", "WebSearch", "WebFetch", "TodoWrite", "ToolSearch", "AskUserQuestion"]);

/**
 * Il controllo che precede ogni strumento, per il pannello Modifiche: prima del primo che può
 * cambiare i file aspetta la fotografia dei file del turno, e davanti a uno strumento di modifica
 * tiene la versione del file di prima. Non decide nulla: l'azione va avanti come avrebbe fatto.
 */
function versioneDiPrima(registro: PrimaDegliStrumenti): NonNullable<NonNullable<Options["hooks"]>["PreToolUse"]>[number] {
  return {
    // La prima fotografia di un progetto grande può volerci: il registro comunque non fa aspettare oltre.
    timeout: 60,
    hooks: [
      async (ingresso) => {
        if (ingresso.hook_event_name !== "PreToolUse") return { continue: true };
        if (!STRUMENTI_CHE_LEGGONO.has(ingresso.tool_name)) await registro.pronto();
        const campo = STRUMENTI_DI_MODIFICA[ingresso.tool_name];
        const percorso = campo === undefined ? undefined : (ingresso.tool_input as Record<string, unknown> | undefined)?.[campo];
        if (typeof percorso === "string") registro.prima(percorso);
        return { continue: true };
      },
    ],
  };
}

/** Le opzioni con cui l'harness viene avviato per una conversazione. */
export function opzioniHarness(
  cfg: ConfigurazioneConversazione,
  fonte: ReturnType<typeof fonteConfigurata>,
  idSessione: string | undefined,
  impostazioni: ImpostazioniConversazione,
  chiediPermesso: CanUseTool,
  /** Le cartelle dei plugin delle estensioni accese nell'ambiente. */
  pluginDelleEstensioni: string[] = [],
  /** Come chiedere al proprietario un'azione nel browser del PC; senza, lì nessuna azione parte. */
  chiediPerIlBrowser?: ChiediConsenso,
  /** Come mostrare al proprietario le domande di Claude; senza, le domande non partono. */
  chiediRisposte?: ChiediRisposte,
  /** Ciò che il registro delle modifiche fa prima di ogni strumento. */
  primaDellaModifica?: PrimaDegliStrumenti,
  /** Il server del modello locale con cui parlare al posto di Anthropic (ADR 0051). */
  locale?: ServerDelModelloLocale,
): Options {
  const plugin = [...(cfg.cartellaSkill === undefined ? [] : [cfg.cartellaSkill]), ...pluginDelleEstensioni];
  const modo = MODI_DELL_HARNESS[impostazioni.permessi];
  const stile = impostazioni.stile === undefined ? undefined : istruzioniDelloStile(impostazioni.stile);
  const aggiunte = [cfg.istruzioniAggiunte, stile].filter((parte) => parte !== undefined).join("\n\n");
  return {
    cwd: cfg.cartella,
    // Con questa l'harness dice quando lavora e quando ha finito ("running", "idle"): è la fine vera di un turno.
    env: { ...(locale === undefined ? ambientePerHarness(fonte) : ambientePerModelloLocale(locale)), CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: "1" },
    systemPrompt:
      cfg.istruzioni === "claude-code"
        ? {
            type: "preset",
            preset: "claude_code",
            ...(aggiunte === "" ? {} : { append: aggiunte }),
            // Lo stile si può cambiare in ogni momento: le istruzioni non si fissano alla conversazione.
            snapshot: false,
          }
        : // Le istruzioni nostre cambiano con le versioni di Shinka. L'harness di suo le fisserebbe
          // alla conversazione alla prima richiesta, e una conversazione ripresa seguirebbe quelle vecchie.
          {
            type: "custom",
            prompt: [typeof cfg.istruzioni === "function" ? cfg.istruzioni() : cfg.istruzioni, ...(stile === undefined ? [] : [stile])].join("\n\n"),
            snapshot: false,
          },
    tools: cfg.strumenti === "claude-code" ? { type: "preset", preset: "claude_code" } : cfg.strumenti,
    allowedTools: cfg.strumentiSenzaRichiesta,
    canUseTool: chiediPermesso,
    includePartialMessages: true,
    // Prima di ogni modifica l'harness tiene una copia dei file: così si possono riportare a com'erano.
    enableFileCheckpointing: true,
    // Il ragionamento arriva riassunto: il proprietario lo legge, se vuole, nella vista della trascrizione che lo mostra.
    thinking: { type: "adaptive", display: "summarized" },
    // Con un modello locale l'impegno lo fissa il server quando parte, e il modello è il suo.
    ...(locale !== undefined ? { model: locale.modello } : impostazioni.modello === undefined ? {} : { model: impostazioni.modello }),
    ...(impostazioni.impegno === undefined || locale !== undefined ? {} : { effort: impostazioni.impegno }),
    // La ricerca e la lettura del web passano dai server di Anthropic: con un modello locale non funzionano.
    ...(cfg.strumentiVietati === undefined && locale === undefined
      ? {}
      : { disallowedTools: [...(cfg.strumentiVietati ?? []), ...(locale === undefined ? [] : ["WebSearch", "WebFetch"])] }),
    // Il modo è sempre dichiarato, ed è quello scelto dal proprietario: lasciato a Claude Code
    // potrebbe diventare da solo quello in cui è un classificatore ad approvare le azioni.
    permissionMode: modo,
    // Senza permessi solo se il proprietario lo ha scelto: l'harness vuole che lo si dica due volte.
    ...(modo === "bypassPermissions" ? { allowDangerouslySkipPermissions: true } : {}),
    // Senza le impostazioni dell'ambiente la conversazione vede solo ciò che le diamo noi.
    ...(cfg.impostazioniDellAmbiente === true ? {} : { settingSources: [], strictMcpConfig: true }),
    // I server MCP dell'ambiente possono pesare più del contesto di un modello locale: lì valgono
    // solo quelli di Shinka e delle estensioni, come fa il profilo del proprietario con --strict-mcp-config.
    ...(locale === undefined ? {} : { strictMcpConfig: true }),
    ...(cfg.strumentiNostri === undefined ? {} : { mcpServers: cfg.strumentiNostri() }),
    // Tutto il computer come la cartella del progetto, o le cartelle in più, se il proprietario le ha scelte.
    ...(impostazioni.tuttoIlPc === true || (impostazioni.cartelleInPiu ?? []).length > 0
      ? { additionalDirectories: [...(impostazioni.tuttoIlPc === true ? radiciDiQuestaMacchina() : []), ...(impostazioni.cartelleInPiu ?? [])] }
      : {}),
    ...(plugin.length === 0 ? {} : { plugins: plugin.map((path) => ({ type: "local" as const, path })) }),
    // Claude Code collega l'estensione del browser solo se glielo si chiede all'avvio, con --chrome.
    // Alcuni suoi strumenti l'harness li lascerebbe passare da sé, e in due modi dei permessi tutti:
    // qui ognuno viene chiesto al proprietario, e se il controllo non riesce l'azione non parte.
    // Vale dove il proprietario ha acceso Chrome per l'ambiente, e solo se lo ha acceso nella sessione (ADR 0063).
    ...(cfg.browserDelPc === true && impostazioni.browserChrome === true ? { extraArgs: { chrome: null } } : {}),
    // Le domande di Claude le mostra Shinka, con la sua scheda, in ogni modo dei permessi.
    hooks: {
      PreToolUse: [
        controlloDelleDomande(chiediRisposte, ATTESA_DEL_CONSENSO_NEL_BROWSER_S),
        // Il controllo resta anche con il browser spento nella sessione: se uno strumento del browser comparisse, chiede.
        ...(cfg.browserDelPc === true ? [controlloDelBrowserDelPc(chiediPerIlBrowser, impostazioni.permessi)] : []),
        ...(primaDellaModifica === undefined ? [] : [versioneDiPrima(primaDellaModifica)]),
      ],
    },
    ...(idSessione === undefined ? {} : { resume: idSessione }),
  };
}

/** Fa partire i messaggi solo dopo che ciò che li precede è pronto. */
async function* dopo<T>(pronto: Promise<void>, messaggi: AsyncIterable<T>): AsyncGenerator<T> {
  await pronto;
  yield* messaggi;
}

function conScadenza<T>(promessa: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((risolvi, rifiuta) => {
    const sveglia = setTimeout(() => rifiuta(new Error("non hanno risposto in tempo")), ms);
    sveglia.unref();
    promessa.then(
      (valore) => {
        clearTimeout(sveglia);
        risolvi(valore);
      },
      (errore: unknown) => {
        clearTimeout(sveglia);
        rifiuta(errore instanceof Error ? errore : new Error(String(errore)));
      },
    );
  });
}

function testoErrore(errore: unknown): string {
  return errore instanceof Error ? errore.message : String(errore);
}

/** Coda asincrona: chi legge aspetta finché qualcuno non scrive, o finché la coda viene chiusa. */
class Coda<T> implements AsyncIterable<T> {
  readonly #valori: T[] = [];
  readonly #lettori: ((risultato: IteratorResult<T, undefined>) => void)[] = [];
  #chiusa = false;

  metti(valore: T): void {
    if (this.#chiusa) return;
    const lettore = this.#lettori.shift();
    if (lettore !== undefined) lettore({ value: valore, done: false });
    else this.#valori.push(valore);
  }

  chiudi(): void {
    this.#chiusa = true;
    for (const lettore of this.#lettori.splice(0)) lettore({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<T, undefined> {
    return {
      next: () => {
        const pronto = this.#valori.shift();
        if (pronto !== undefined) return Promise.resolve({ value: pronto, done: false });
        if (this.#chiusa) return Promise.resolve({ value: undefined, done: true });
        return new Promise((risolvi) => this.#lettori.push(risolvi));
      },
    };
  }
}

/**
 * I messaggi del proprietario e le risposte di Claude in una sessione di Claude Code: il testo
 * scritto, senza gli strumenti e i loro esiti.
 */
export function scambiDiClaude(messaggi: readonly { type: string; message: unknown }[]): ScambioDellaStoria[] {
  const scambi: ScambioDellaStoria[] = [];
  for (const voce of messaggi) {
    if (voce.type !== "user" && voce.type !== "assistant") continue;
    const contenuto = (voce.message as { content?: unknown } | undefined)?.content;
    const testo = (
      typeof contenuto === "string"
        ? contenuto
        : Array.isArray(contenuto)
          ? (contenuto as { type?: unknown; text?: unknown }[])
              .filter((parte) => parte.type === "text" && typeof parte.text === "string")
              .map((parte) => parte.text as string)
              .join("\n")
          : ""
    ).trim();
    if (testo !== "") scambi.push({ chi: voce.type === "user" ? "proprietario" : "motore", testo });
  }
  return scambi;
}

/** Le radici dei dischi di questa macchina: "/" fuori da Windows, le lettere dei dischi che ci sono su Windows. */
export function radiciDiQuestaMacchina(piattaforma: NodeJS.Platform = process.platform, esiste: (percorso: string) => boolean = existsSync): string[] {
  if (piattaforma !== "win32") return ["/"];
  return "CDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((lettera) => `${lettera}:\\`).filter((radice) => esiste(radice));
}

/**
 * Ciò che «Approva sempre» salva, tra le proposte dell'harness: le regole che consentono e le cartelle
 * in più, nelle impostazioni locali del progetto. Un cambio del modo dei permessi no: quello lo
 * sceglie il proprietario dai controlli.
 */
export function regoleDaSalvare(proposte: readonly PermissionUpdate[] | undefined): PermissionUpdate[] {
  return (proposte ?? []).flatMap((proposta): PermissionUpdate[] => {
    if (proposta.type === "addRules" && proposta.behavior === "allow") return [{ ...proposta, destination: "localSettings" }];
    if (proposta.type === "addDirectories") return [{ ...proposta, destination: "localSettings" }];
    return [];
  });
}

/** Le regole da salvare in parole, per il pulsante: «Bash(npm test:*)», «la cartella C:\\dati». */
export function regolaInParole(regole: readonly PermissionUpdate[]): string | undefined {
  const parti = regole.flatMap((regola) => {
    if (regola.type === "addRules") return regola.rules.map((una) => (una.ruleContent === undefined ? una.toolName : `${una.toolName}(${una.ruleContent})`));
    if (regola.type === "addDirectories") return regola.directories.map((cartella) => `la cartella ${cartella}`);
    return [];
  });
  return parti.length === 0 ? undefined : parti.join(", ").slice(0, 500);
}
