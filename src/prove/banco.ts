/**
 * Banco di prova: monta un centro intero con conversazioni finte al posto dell'harness,
 * così i test esercitano tutto il percorso senza consumare la quota di Claude.
 */

import { EstensioniInterfaccia } from "../centro/interfaccia.ts";
import { ModelliLocali } from "../nodo/modelli-locali.ts";
import { PrimoAvvio } from "../centro/primo-avvio.ts";
import { AccessiNegliAmbienti, type PortaAccessi } from "../centro/accessi.ts";
import { ImpostazioniDellInstallazione } from "../centro/impostazioni-installazione.ts";
import { CopieDiSicurezza } from "../centro/copie.ts";
import { preparaIdentitaPerINodi } from "../centro/identita-per-i-nodi.ts";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import type { FastifyInstance } from "fastify";
import { Accesso } from "../centro/accesso.ts";
import { AggiornamentoDeiNodi, type OpzioniAggiornamentoNodi } from "../centro/aggiornamento-nodi.ts";
import { ID_AMBIENTE_DEL_CENTRO, RegistroAmbienti } from "../centro/ambienti.ts";
import { Anteprime } from "../centro/anteprima.ts";
import { RegistroArgomenti } from "../centro/argomenti.ts";
import type { Canale } from "../centro/canale.ts";
import { Home } from "../centro/home.ts";
import { COOKIE_SESSIONE, creaCentro, type OpzioniCentro } from "../centro/centro.ts";
import { CustodiaImmagini } from "../centro/immagini.ts";
import { StatoHome } from "../centro/stato-home.ts";
import type { Allegato } from "../protocollo/allegati.ts";
import type { AzioneInAmbiente, EsitoAzione } from "../protocollo/azioni.ts";
import type { ImpostazioniConversazione } from "../protocollo/impostazioni.ts";
import { EsecutoreLocale, EsecutoriRemoti, type ServiziLocali } from "../centro/esecutori.ts";
import { ApplicazioniDeiProgetti } from "../centro/applicazioni.ts";
import { CartelleCollegate } from "../centro/cartelle-collegate.ts";
import { AggiornamentiDesktop } from "../centro/desktop.ts";
import { FileDeiProgetti } from "../centro/file-progetto.ts";
import { FileDeiProgettiQui } from "../nodo/file-progetto.ts";
import { Applicazioni } from "../nodo/applicazioni.ts";
import { Estensioni, type OpzioniEstensioni } from "../centro/estensioni.ts";
import { EstensioniNegliAmbienti } from "../centro/estensioni-negli-ambienti.ts";
import { Approvazioni } from "../centro/approvazioni.ts";
import { LavoriProgrammati, type OpzioniProgrammati } from "../centro/programmati.ts";
import { NotificheApp, type AvvisoApp } from "../centro/notifiche-app.ts";
import { RisorseDegliAmbienti } from "../centro/risorse.ts";
import { CampionatoreRisorse } from "../nodo/risorse.ts";
import type { RisorseDellAmbiente } from "../protocollo/risorse.ts";
import { Elaborati } from "../centro/elaborati.ts";
import { PosizioneDelProprietario } from "../centro/posizione.ts";
import type { HttpsDelCentro } from "../centro/https.ts";
import { PonteTelegram, type OpzioniPonte } from "../centro/telegram.ts";
import { GatewayAssente, type PortaGateway } from "../centro/gateway.ts";
import { LavoriDeiProgetti } from "../centro/lavori.ts";
import { distribuisciSkill } from "../centro/distribuzione-skill.ts";
import { colLavoroOffline } from "../centro/lavoro-offline.ts";
import type { AggiornamentiDallOriginale } from "../centro/originale.ts";
import { ProposteRicordate, postiDegliArchivi } from "../centro/proposte-ricordate.ts";
import { LavoroOffline } from "../nodo/offline.ts";
import { Memoria } from "../centro/memoria.ts";
import { RegistroSkill } from "../centro/skill.ts";
import { RegistroStili } from "../centro/stili.ts";
import type { EsitoAnnullamento, VersioniDiUnFile } from "../protocollo/modifiche.ts";
import { chiaveDellaHome, chiDiUnProgetto, StrumentiComuni } from "../centro/strumenti-comuni.ts";
import { RegistroProgetti } from "../centro/progetti.ts";
import { Proposte } from "../centro/proposte.ts";
import { git } from "../centro/preparazione.ts";
import { SviluppoDiShinka, type OpzioniSviluppo } from "../centro/sviluppo.ts";
import { NOME_PROGETTO_SHINKA, nomeCartellaDa } from "../protocollo/progetti.ts";
import { TerminaliDeiProgetti } from "../centro/terminali.ts";
import { TramiteAnteprima } from "../nodo/anteprima.ts";
import { Terminali, type ShellAccesa } from "../nodo/terminali.ts";
import { PORTA_ANTEPRIMA } from "../protocollo/anteprima.ts";
import { CollegamentoAlCentro, type ConfigurazioneCollegamento, type StatoCollegamento } from "../nodo/collegamento.ts";
import type { ConfigurazioneConversazione } from "../nodo/conversazione.ts";
import { EstensioniInAmbiente } from "../nodo/estensioni.ts";
import { LavoroDelNodo, type ContestoLavoro } from "../nodo/lavoro.ts";
import type { ChiaviConsegnate } from "../protocollo/estensioni.ts";
import { harnessDiProva, type HarnessDiProva } from "./harness-di-prova.ts";
import type {
  AnteprimaRiavvolgimento,
  EsitoBiforcazione,
  RispostaAParte,
  UscitaAttivita,
  DecisionePermesso,
  RispostaAlleDomande,
  EventoConversazione,
  PortaConversazione,
} from "../protocollo/eventi.ts";

export const PASSWORD = "una-password-di-prova";
export const SEGRETO_NODO = "segreto-del-nodo-di-prova-lungo-almeno-trentadue";
export const ID_NODO = "nodo-di-prova-1";

/** Conversazione finta: registra ciò che le viene chiesto, senza harness. */
export class ConversazioneFinta implements PortaConversazione {
  /** Presente quando la conversazione è stata aperta come quella di un progetto. */
  readonly configurazione: ConfigurazioneConversazione | undefined;
  preparazioni = 0;
  inviati: string[] = [];
  /** Gli allegati dei messaggi che ne avevano, nell'ordine in cui sono arrivati. */
  allegati: Allegato[][] = [];
  /** Le impostazioni cambiate dopo l'apertura, nell'ordine in cui sono arrivate. */
  impostazioni: ImpostazioniConversazione[] = [];
  annotazioni: string[] = [];
  /** Le istruzioni di Shinka ricevute, che non compaiono come messaggi del proprietario. */
  istruzioni: string[] = [];
  decisioni: [string, DecisionePermesso][] = [];
  interruzioni = 0;
  chiusa = false;
  /** Quante volte le è stato chiesto di rileggere le skill. */
  ricariche = 0;
  /** Quante volte le è stato detto che le estensioni dell'ambiente sono cambiate. */
  ricaricheEstensioni = 0;
  permessiInAttesa = new Set<string>();
  domandeInAttesa = new Set<string>();
  /** Le risposte alle domande, nell'ordine in cui sono arrivate. */
  risposteAlleDomande: [string, RispostaAlleDomande][] = [];

  constructor(configurazione?: ConfigurazioneConversazione) {
    this.configurazione = configurazione;
  }

  prepara(): void {
    this.preparazioni += 1;
  }
  annota(testo: string): void {
    this.annotazioni.push(testo);
  }
  istruisci(testo: string): void {
    this.istruzioni.push(testo);
    this.emetti({ tipo: "turno-iniziato" });
  }
  imposta(impostazioni: ImpostazioniConversazione): void {
    this.impostazioni.push(impostazioni);
  }
  invia(testo: string, allegati: Allegato[] = []): void {
    this.inviati.push(testo);
    if (allegati.length > 0) this.allegati.push(allegati);
    // Come la conversazione vera: il messaggio e l'inizio del turno diventano eventi.
    this.emetti({ tipo: "messaggio-proprietario", id: `m${this.inviati.length}`, testo, modificabile: true });
    this.emetti({ tipo: "turno-iniziato" });
  }
  /** I permessi approvati per sempre. */
  sempre: string[] = [];
  decidiPermesso(idPermesso: string, decisione: DecisionePermesso, sempre?: boolean): boolean {
    if (!this.permessiInAttesa.delete(idPermesso)) return false;
    this.decisioni.push([idPermesso, decisione]);
    if (sempre === true) this.sempre.push(idPermesso);
    this.emetti({ tipo: "permesso-deciso", idPermesso, decisione });
    return true;
  }
  /** I file che un riavvolgimento riporterebbe a com'erano, come se Claude li avesse cambiati. */
  fileCambiati: string[] = [];
  /** I riavvolgimenti chiesti: da quale messaggio, e se con i file. */
  riprese: [string, boolean][] = [];
  async anteprimaRiavvolgimento(): Promise<AnteprimaRiavvolgimento> {
    return { file: this.fileCambiati, aggiunte: this.fileCambiati.length, tolte: this.fileCambiati.length };
  }
  /** I messaggi da cui sono nati dei rami; la sessione copiata si chiama come il messaggio. */
  biforcazioni: string[] = [];
  async biforca(idMessaggio: string): Promise<EsitoBiforcazione> {
    this.biforcazioni.push(idMessaggio);
    // Come quella vera: dal primo messaggio non c'è nulla da copiare.
    return idMessaggio === "m1" ? { riuscita: true } : { riuscita: true, idSessione: `ramo-di-${idMessaggio}` };
  }
  /** Le versioni dei file cambiati, per turno e percorso; gli annullamenti chiesti. */
  versioni = new Map<string, VersioniDiUnFile>();
  annullamenti: [string, readonly string[] | undefined][] = [];
  async versioniModificate(idTurno: string, percorso: string): Promise<VersioniDiUnFile | { motivo: string }> {
    return this.versioni.get(`${idTurno}:${percorso}`) ?? { motivo: "Questo file non è tra le modifiche del turno." };
  }
  async annullaModifiche(idTurno: string, percorsi?: readonly string[]): Promise<EsitoAnnullamento | { motivo: string }> {
    this.annullamenti.push([idTurno, percorsi]);
    const annullati = percorsi === undefined ? [...this.versioni.keys()].filter((chiave) => chiave.startsWith(`${idTurno}:`)).map((chiave) => chiave.slice(idTurno.length + 1)) : [...percorsi];
    // Come quella vera: dice che cosa è tornato indietro.
    this.emetti({ tipo: "modifiche-decise", idTurno, percorsi: annullati, esito: "annullate" });
    return { annullati, nonAnnullati: [] };
  }
  /** Le uscite delle attività, per identificativo. */
  uscite = new Map<string, string>();
  async uscitaAttivita(idAttivita: string): Promise<UscitaAttivita | { motivo: string }> {
    const testo = this.uscite.get(idAttivita);
    return testo === undefined ? { motivo: "Di questa attività non c'è un'uscita da leggere." } : { testo, troncata: false };
  }
  /** Le domande a parte ricevute; la risposta è fatta da quella che segue, se c'è. */
  domandeAParte: string[] = [];
  rispostaAParte: RispostaAParte = { testo: "Risposta **a parte**." };
  async chiediAParte(domanda: string): Promise<RispostaAParte> {
    this.domandeAParte.push(domanda);
    return this.rispostaAParte;
  }
  async riprendiDa(idMessaggio: string, opzioni: { file: boolean }): Promise<string | undefined> {
    this.riprese.push([idMessaggio, opzioni.file]);
    this.emetti({ tipo: "riavvolto", idMessaggio, ...(opzioni.file ? { fileRiportati: this.fileCambiati } : {}) });
    return undefined;
  }
  rispondiDomande(idDomande: string, risposta: RispostaAlleDomande): boolean {
    if (!this.domandeInAttesa.delete(idDomande)) return false;
    this.risposteAlleDomande.push([idDomande, risposta]);
    this.emetti({ tipo: "domande-chiuse", idDomande, esito: risposta.tipo, ...(risposta.tipo === "risposte" ? { risposte: risposta.risposte } : {}) });
    return true;
  }
  async interrompi(): Promise<void> {
    this.interruzioni += 1;
  }
  chiudi(): void {
    this.chiusa = true;
  }
  ricaricaSkill(): void {
    this.ricariche += 1;
  }
  ricaricaEstensioni(): void {
    this.ricaricheEstensioni += 1;
  }

  /** Fa accadere un evento, come se venisse dall'harness. */
  emetti(evento: EventoConversazione): void {
    if (evento.tipo === "permesso-richiesto") this.permessiInAttesa.add(evento.idPermesso);
    if (evento.tipo === "domande-poste") this.domandeInAttesa.add(evento.idDomande);
    this.configurazione?.alEvento(evento);
  }
}

/** Shell finta: registra ciò che le viene scritto e lascia decidere al test che cosa ne esce. */
export class ShellFinta implements ShellAccesa {
  readonly cartella: string;
  scritti: string[] = [];
  misure: [colonne: number, righe: number][] = [];
  spenta = false;
  #uscita: ((dati: string) => void) | undefined;
  #fine: ((codice: number) => void) | undefined;

  constructor(cartella: string, colonne: number, righe: number) {
    this.cartella = cartella;
    this.misure.push([colonne, righe]);
  }

  scrivi(dati: string): void {
    this.scritti.push(dati);
  }
  misura(colonne: number, righe: number): void {
    this.misure.push([colonne, righe]);
  }
  spegni(): void {
    this.spenta = true;
  }
  allUscita(ascoltatore: (dati: string) => void): void {
    this.#uscita = ascoltatore;
  }
  allaFine(ascoltatore: (codice: number) => void): void {
    this.#fine = ascoltatore;
  }

  /** La shell scrive qualcosa. */
  emetti(dati: string): void {
    this.#uscita?.(dati);
  }
  /** La shell termina da sola. */
  finisci(codice = 0): void {
    this.#fine?.(codice);
  }
}

export interface Banco {
  cartella: string;
  /** I file dei progetti, come li vede il centro. */
  file: FileDeiProgetti;
  /** Gli aggiornamenti di Shinka Desktop. */
  desktop: AggiornamentiDesktop;
  accesso: Accesso;
  centro: FastifyInstance;
  /** La Home vera, con conversazioni finte al posto dell'harness. */
  casa: Home;
  argomenti: RegistroArgomenti;
  /** La conversazione finta dell'argomento aperto nella Home. */
  readonly home: ConversazioneFinta;
  /** L'archivio dell'argomento aperto nella Home. */
  readonly canale: Canale;
  /** Le conversazioni aperte dalla Home, una per argomento, nell'ordine in cui sono nate. */
  conversazioniHome: ConversazioneFinta[];
  /** Cartella in cui nascono i progetti dell'ambiente del centro. */
  radiceProgetti: string;
  /** Compie davvero un'azione della Home in un ambiente, nella cartella di un argomento. */
  agisci(idAmbiente: string, idArgomento: string, azione: AzioneInAmbiente): Promise<EsitoAzione>;
  ambienti: RegistroAmbienti;
  progetti: RegistroProgetti;
  lavori: LavoriDeiProgetti;
  proposte: Proposte;
  memoria: Memoria;
  skill: RegistroSkill;
  copie: CopieDiSicurezza;
  stili: RegistroStili;
  /** Gli strumenti comuni, come li userebbe la conversazione dell'argomento aperto nella Home. */
  comuniDellaHome(nome: unknown, argomenti: unknown): ReturnType<StrumentiComuni["esegui"]>;
  statoHome: StatoHome;
  immagini: CustodiaImmagini;
  /** Le conversazioni di progetto aperte nell'ambiente del centro, nell'ordine in cui sono nate. */
  conversazioniLocali: ConversazioneFinta[];
  terminali: TerminaliDeiProgetti;
  /** Le shell finte accese nell'ambiente del centro, nell'ordine in cui sono nate. */
  shellLocali: ShellFinta[];
  anteprime: Anteprime;
  applicazioni: ApplicazioniDeiProgetti;
  /** Le approvazioni dei comandi sugli host, se il banco ha un gateway. */
  approvazioni: Approvazioni | undefined;
  /** Gli elaborati degli argomenti della Home, come li vede il pannello. */
  elaborati: Elaborati;
  /** Il ponte con Telegram, se il test lo ha acceso. */
  ponte: PonteTelegram | undefined;
  /** La posizione che il proprietario ha condiviso. */
  posizione: PosizioneDelProprietario;
  /** Lo sviluppo di Shinka, se il test lo ha acceso. */
  sviluppo: SviluppoDiShinka | undefined;
  /** L'aggiornamento dei nodi alla versione del centro. */
  aggiornamenti: AggiornamentoDeiNodi;
  /** Le notifiche dell'app, e ciò che sarebbe partito verso i dispositivi iscritti. */
  notifiche: NotificheApp;
  notificheMandate: { endpoint: string; avviso: AvvisoApp }[];
  /** I lavori programmati: nei test non guardano l'ora da soli, tocca chiamare `batti`. */
  programmati: LavoriProgrammati;
  /** Le estensioni, se il test le ha accese. */
  estensioni: Estensioni | undefined;
  /** Le estensioni dell'interfaccia (ADR 0054). */
  interfaccia: EstensioniInterfaccia;
  /** L'harness finto con cui l'ambiente del centro prova le estensioni e guarda ciò che ha già. */
  harnessEstensioni: HarnessDiProva;
  /** Quante volte lo sviluppo ha chiesto di riavviare il centro. */
  riavvii: number[];
  /** Il file in cui centro e guardiano si dicono a che punto è un'installazione. */
  fileInstallazione: string;
  /** Gli strumenti comuni, come li userebbe la conversazione di un progetto. */
  comuniDelProgetto(idProgetto: string, nome: unknown, argomenti: unknown): ReturnType<StrumentiComuni["esegui"]>;
  /** Entra con la password giusta e restituisce il token di sessione. */
  entra(): Promise<string>;
  /** Il codice di primo avvio, se il banco è nato senza password. */
  codicePrimoAvvio?: string;
}

/** Ciò che un test può chiedere al banco in più del solito. */
export interface OpzioniBanco {
  /** Un'installazione nuova: la password non c'è, e il centro aspetta il codice di primo avvio. */
  primoAvvio?: true;
  /** I dati di un altro banco: questo è lo stesso centro dopo un riavvio. */
  cartella?: string;
  /** Un fork della copia pubblica: le versioni nuove dell'originale (ADR 0059). */
  originale?: AggiornamentiDallOriginale;
  /** L'orologio e la quiete dei lavori programmati, per le prove che li fanno partire. */
  programmati?: Pick<OpzioniProgrammati, "adesso" | "quieteMs">;
  /** La cartella da cui nasce il pacchetto per un'installazione nuova. */
  installata?: string;
  /** Gli accessi dei motori nell'ambiente del centro. Senza, uno finto che dice Claude collegato. */
  accessi?: PortaAccessi;
  /** L'HTTPS del centro, per le prove che lo accendono. */
  https?: HttpsDelCentro;
  /** Dove l'anteprima ricorda quale è aperta: per provare che dopo un riavvio la si ritrova. */
  fileAnteprima?: string;
  /** Quanto si aspetta che un'applicazione avviata risponda. */
  attesaAvvioMs?: number;
  /** Come si prepara la cartella di un progetto nuovo nell'ambiente del centro, al posto di lanciare CodeGraph. */
  preparaProgetto?: NonNullable<ServiziLocali["preparaProgetto"]>;
  /** La cartella dell'interfaccia costruita, per una prova a vista in un browser. Senza, il centro non la serve. */
  cartellaWeb?: string;
  /** Il gateway a cui il centro si rivolge per le credenziali. Senza, il vault non è configurato. */
  gateway?: PortaGateway;
  /** Un centro senza il certificato dei nodi, come quelli di prima: i nodi lo raggiungono solo in chiaro. */
  senzaCertificatoDeiNodi?: boolean;
  /** La porta su cui il centro dice di servire l'anteprima. Nulla: in questa installazione non c'è. */
  portaAnteprima?: number | null;
  /** Le porte del centro, che nel suo ambiente non si mettono in anteprima. */
  porteRiservate?: number[];
  /** Le immagini scritte nel testo delle risposte: senza, il centro le chiede davvero ai siti. */
  immaginiEsterne?: OpzioniCentro["immaginiEsterne"];
  /** Accende il ponte con Telegram, con i tempi indicati: serve un gateway che abbia il bot. */
  telegram?: Partial<Pick<OpzioniPonte, "attesaEventiS" | "ritardoRichiesteMs" | "lavoroLungoMs" | "pausaMs" | "messaggioVecchioMs" | "adesso" | "attesaAlbumMs" | "immaginiEsterne">>;
  /**
   * Accende le estensioni: gli ambienti le provano con un harness finto, e le chiavi vengono dal
   * gateway del banco oppure da ciò che il test indica.
   */
  estensioni?: {
    chiavi?(estensione: string, ambiente: string, nomi: string[]): Promise<ChiaviConsegnate>;
    /** Come si guarda un plugin prima di proporlo, al posto di git. */
    esamina?: NonNullable<OpzioniEstensioni["esamina"]>;
    /** Quali repository si accettano: per usarne uno che sta sul disco. */
    accettaRepository?: NonNullable<OpzioniEstensioni["accettaRepository"]>;
    /** L'harness finto dell'ambiente del centro, se il test vuole decidere come vanno le prove. */
    harness?: HarnessDiProva;
    attesaProvaMs?: number;
    attesaSguardoMs?: number;
  };
  /**
   * Accende lo sviluppo di Shinka: tra i progetti c'è il progetto Shinka, e al posto della
   * preparazione vera di una versione c'è quella che il test indica.
   */
  sviluppo?: {
    prepara: NonNullable<OpzioniSviluppo["prepara"]>;
    /** Falso per un centro che nessun guardiano tiene acceso. Se manca, il guardiano c'è. */
    guardiano?: boolean;
    scadenzaMs?: number;
    attesaEsitoMs?: number;
    /** Come si propone la versione al gateway. Senza, il gateway non c'entra. */
    gateway?: NonNullable<OpzioniSviluppo["gateway"]>;
  };
  /** La versione in funzione al centro: i nodi collegati con un'altra risultano indietro. Senza, non è scritta. */
  versione?: string;
  /** I file che il centro passa a un nodo che si aggiorna, e i tempi dell'attesa. Senza, un file solo, finto. */
  aggiornamenti?: Partial<Pick<OpzioniAggiornamentoNodi, "pacchetto" | "attesaMs" | "finestraMs">>;
}

/** Ciò che l'ambiente del centro dice delle sue risorse, nelle prove. */
export const RISORSE_DI_PROVA: RisorseDellAmbiente = {
  sistema: { nome: "Linux 6.12", macchina: "banco", nuclei: 4, accesoDa: 3600 },
  campione: { quando: "2026-11-22T10:00:00.000Z", cpu: 12.5, memoria: { usata: 4_000_000_000, totale: 16_000_000_000 }, carico: 0.4, disco: { usato: 50_000_000_000, totale: 100_000_000_000 } },
  processi: [{ pid: 1, nome: "node", cpu: 3.2, memoria: 200_000_000, comando: "node src/centro/avvio.ts" }],
  quantiProcessi: 30,
  inContenitore: true,
  docker: { stato: "assente", contenitori: [] },
};

export async function allestisci(t: TestContext, opzioni: OpzioniBanco = {}): Promise<Banco> {
  const cartella = opzioni.cartella ?? (await mkdtemp(join(tmpdir(), "shinka-centro-")));
  const ricordate = ProposteRicordate.apri(join(cartella, "proposte-in-attesa.json"));
  const accesso = await Accesso.apri(cartella);
  if (opzioni.primoAvvio !== true) await accesso.impostaPassword(PASSWORD);
  const { primoAvvio, codice: codicePrimoAvvio } = PrimoAvvio.apri(cartella, accesso);
  const radiceProgetti = join(cartella, "progetti");
  const ambienti = await RegistroAmbienti.apri(join(cartella, "ambienti.json"), {
    nome: "Unraid",
    descrizione: "Linux",
    sistema: "Linux",
    radiceProgetti,
    ...(opzioni.versione === undefined ? {} : { versione: opzioni.versione }),
  });
  const progetti = await RegistroProgetti.apri(join(cartella, "progetti.json"));
  const conversazioniLocali: ConversazioneFinta[] = [];
  const immagini = new CustodiaImmagini(join(cartella, "immagini"));
  const statoHome = StatoHome.apri(join(cartella, "home.json"), { modello: "haiku", permessi: "chiedi" });
  const memoria = await Memoria.apri(join(cartella, "memoria.md"));
  const skill = await RegistroSkill.apri(join(cartella, "skill"));
  // Le istruzioni di uno stile nuovo, senza chiederle a Claude.
  const stili = await RegistroStili.apri(join(cartella, "stili.json"), async (nome, descrizione) => `Scrivi come «${nome}»: ${descrizione}`);
  const shellLocali: ShellFinta[] = [];
  const terminali = new TerminaliDeiProgetti({
    progetti,
    ambienti,
    locale: (riferisci) => {
      const qui = new Terminali(riferisci, {
        controlloMs: 0,
        raccoltaMs: 1,
        accendi: async (dove, colonne, righe) => {
          const shell = new ShellFinta(dove, colonne, righe);
          shellLocali.push(shell);
          return shell;
        },
      });
      t.after(() => qui.spegniTutti());
      return qui;
    },
  });
  const anteprime = new Anteprime({
    progetti,
    ambienti,
    locale: (riferisci) => {
      const tramite = new TramiteAnteprima(riferisci);
      t.after(() => tramite.chiudiTutto());
      return tramite;
    },
    porta: opzioni.portaAnteprima === undefined ? PORTA_ANTEPRIMA : opzioni.portaAnteprima,
    ...(opzioni.porteRiservate === undefined ? {} : { porteRiservate: opzioni.porteRiservate }),
    attesaSondaMs: 2_000,
    attesaRispostaMs: 2_000,
    ...(opzioni.fileAnteprima === undefined ? {} : { file: opzioni.fileAnteprima }),
  });
  // Le applicazioni dell'ambiente del centro sono vere: processi di questa macchina, con tempi brevi.
  const applicazioni = new ApplicazioniDeiProgetti({
    progetti,
    ambienti,
    locale: (riferisci) => {
      const qui = new Applicazioni(riferisci, { passoMs: 100, attesaAvvioMs: opzioni.attesaAvvioMs ?? 10_000 });
      t.after(() => qui.spegniTutte());
      return qui;
    },
    apriAnteprima: (idProgetto, porta, percorso) => anteprime.apri(idProgetto, porta, percorso),
    chiudiAnteprima: (idProgetto) => void anteprime.chiudi(idProgetto),
    attesaAvvioMs: opzioni.attesaAvvioMs ?? 10_000,
  });
  const file = new FileDeiProgetti({ progetti, ambienti, locale: (riferisci) => new FileDeiProgettiQui(riferisci) });
  const desktop = new AggiornamentiDesktop(join(cartella, "desktop"));
  // Come nel centro vero: la scheda di approvazione compare nella conversazione che ha chiesto il comando.
  const PREFISSO_HOME = chiaveDellaHome("");
  const pubblicaLeSchede = (chiave: string): ((evento: EventoConversazione) => void) | undefined => {
    if (!chiave.startsWith(PREFISSO_HOME)) return lavori.canale(chiave)?.pubblica;
    return chiave === chiaveDellaHome(casa.idArgomentoAperto) ? casa.canale.pubblica : undefined;
  };
  const approvazioni = opzioni.gateway === undefined ? undefined : new Approvazioni({ gateway: opzioni.gateway, pubblica: pubblicaLeSchede });
  // Le schede dei lavori programmati non passano dal gateway: ci sono anche senza.
  const schede = approvazioni ?? new Approvazioni({ gateway: new GatewayAssente(), pubblica: pubblicaLeSchede });
  // Le risorse degli ambienti: quelle della macchina del centro, nelle prove, sono sempre queste.
  const gatewayDelBanco = opzioni.gateway;
  // I processi di Shinka nell'ambiente del centro: una conversazione del primo progetto, con un suo comando.
  const processiTerminati: number[] = [];
  const risorse = new RisorseDegliAmbienti({
    ambienti,
    locale: {
      leggi: async () => {
        const primo = progetti.elenco().find((progetto) => progetto.idAmbiente === ID_AMBIENTE_DEL_CENTRO);
        return {
          ...RISORSE_DI_PROVA,
          processiDiShinka: [
            ...(primo === undefined
              ? []
              : [
                  { pid: 4100, genitore: 0, nome: "claude", cpu: 2.5, memoria: 300_000_000, comando: "claude --output-format stream-json", cartella: primo.cartella },
                  { pid: 4101, genitore: 4100, nome: "node", cpu: 95, memoria: 120_000_000, comando: "node server.js", cartella: primo.cartella },
                ]),
            { pid: 4200, genitore: 0, nome: "bash", cpu: 0, memoria: 4_000_000, comando: "bash" },
          ].filter((uno) => !processiTerminati.includes(uno.pid)),
        };
      },
    },
    processiLocali: { termina: async (pid) => (processiTerminati.push(pid), { riuscita: true, testo: `Il processo ${pid} è stato terminato.` }) },
    ...(gatewayDelBanco === undefined ? {} : { contenitori: () => gatewayDelBanco.contenitori() }),
    contenitoriOgniMs: 0,
    attesaMs: 2_000,
  });
  let ponteDeiProgrammati: PonteTelegram | undefined;
  // Le notifiche dell'app, con un servizio finto: ciò che partirebbe resta in `notificheMandate`.
  const notificheMandate: { endpoint: string; avviso: AvvisoApp }[] = [];
  const notifiche = new NotificheApp({
    file: join(cartella, "notifiche.json"),
    manda: async (iscrizione, messaggio) => {
      notificheMandate.push({ endpoint: iscrizione.endpoint, avviso: JSON.parse(messaggio) as AvvisoApp });
      return iscrizione.endpoint.includes("scaduta") ? { esito: "scaduta" } : { esito: "mandata" };
    },
  });
  const programmati = new LavoriProgrammati({
    file: join(cartella, "programmati.json"),
    home: () => casa,
    progetti: {
      progetto: (id) => lavori.progetto(id),
      canale: (id) => lavori.canale(id),
      invia: (id, testo) => lavori.invia(id, testo),
      ascolta: (ascoltatore) => lavori.ascolta(ascoltatore),
    },
    conferma: (chiave, scheda) => schede.chiediProgrammato(chiave, scheda),
    allaFine: ({ lavoro, testo, errore }) =>
      ponteDeiProgrammati?.annunciaProgrammato({
        titolo: lavoro.titolo,
        conversazione: lavoro.dove.tipo === "home" ? "home" : lavoro.dove.id,
        dove: lavoro.dove.tipo === "home" ? "Home" : (lavoro.nomeProgetto ?? "progetto"),
        testo,
        ...(errore === undefined ? {} : { errore }),
      }),
    battitoMs: 0,
    fusoDiPartenza: "Europe/Rome",
    ...opzioni.programmati,
  });
  let sviluppo: SviluppoDiShinka | undefined;
  const riavvii: number[] = [];
  const fileInstallazione = join(cartella, "installazione.json");
  const comuni = new StrumentiComuni(
    memoria,
    skill,
    opzioni.gateway,
    (idProgetto, porta, percorso) => anteprime.proponi(idProgetto, porta, percorso),
    approvazioni,
    async (idProgetto, riassunto) =>
      sviluppo === undefined
        ? { testo: "In questa installazione di Shinka lo sviluppo di Shinka non è acceso.", errore: true }
        : sviluppo.chiediInstallazione(idProgetto, riassunto),
    async (idProgetto, riassunto) =>
      sviluppo === undefined
        ? { testo: "In questa installazione di Shinka lo sviluppo di Shinka non è acceso.", errore: true }
        : sviluppo.aggiornaGateway(idProgetto, riassunto),
    (chiave, nome, argomenti) => applicazioni.strumento(chiave, nome, argomenti),
    (chi, nome, argomenti) => programmati.strumento(chi, nome, argomenti),
    (chiave, nome, argomenti) => collegate.strumento(chiave, nome, argomenti),
    (idProgetto, argomenti) => lavori.affidaIncarico(idProgetto, argomenti),
  );
  const strumentoDiProgetto = (idConversazione: string, nome: unknown, argomenti: unknown) =>
    comuni.esegui(chiDiUnProgetto(idConversazione, (id) => progetti.trova(id)?.nome), nome, argomenti);
  // Come nel centro vero: l'elenco nasce dopo, ma gli ambienti lo chiedono solo quando serve.
  const harnessEstensioni = opzioni.estensioni?.harness ?? harnessDiProva();
  let estensioni: Estensioni | undefined;
  const elencoEstensioni = (): Estensioni => {
    assert.ok(estensioni, "le estensioni sono pronte");
    return estensioni;
  };
  const conEstensioni = opzioni.estensioni;
  const estensioniDelCentro: EstensioniInAmbiente | undefined =
    conEstensioni === undefined
      ? undefined
      : new EstensioniInAmbiente({
          cartella: join(cartella, "estensioni"),
          radiceProgetti,
          apriHarness: harnessEstensioni.apri,
          modelliLocali: new ModelliLocali({ passoMs: 50, fermoMs: 200, vram: async () => undefined }),
          chiavi: (nome) => estensioniNegliAmbienti?.chiavi(nome, ID_AMBIENTE_DEL_CENTRO) ?? Promise.resolve({ motivo: "non c'è un vault" }),
          alCambio: () => {
            casa.ricaricaEstensioni();
            lavori.ricaricaEstensioni();
          },
        });
  const estensioniNegliAmbienti: EstensioniNegliAmbienti | undefined =
    conEstensioni === undefined || estensioniDelCentro === undefined
      ? undefined
      : new EstensioniNegliAmbienti({
          ambienti,
          locale: estensioniDelCentro,
          estensioni: elencoEstensioni,
          chiavi: (nome, idAmbiente, nomi) => {
            const ambiente = ambienti.stato().ambienti.find((uno) => uno.id === idAmbiente)?.nome ?? idAmbiente;
            if (conEstensioni.chiavi !== undefined) return conEstensioni.chiavi(nome, ambiente, nomi);
            return opzioni.gateway?.chiaviEstensione({ estensione: nome, ambiente, chiavi: nomi }) ?? Promise.resolve({ motivo: "in questo banco non c'è un vault" });
          },
          ...(conEstensioni.attesaProvaMs === undefined ? {} : { attesaProvaMs: conEstensioni.attesaProvaMs }),
          ...(conEstensioni.attesaSguardoMs === undefined ? {} : { attesaSguardoMs: conEstensioni.attesaSguardoMs }),
        });
  const locale = new EsecutoreLocale(
    radiceProgetti,
    (configurazione) => {
      const conversazione = new ConversazioneFinta(configurazione);
      conversazioniLocali.push(conversazione);
      return conversazione;
    },
    {
      strumento: strumentoDiProgetto,
      cartellaSkill: skill.cartella,
      diShinka: (idProgetto) => progetti.trova(idProgetto)?.diShinka === true,
      ...(estensioniDelCentro === undefined ? {} : { estensioni: estensioniDelCentro, modelliLocali: estensioniDelCentro.modelliLocali }),
      ...(opzioni.preparaProgetto === undefined ? {} : { preparaProgetto: opzioni.preparaProgetto }),
    },
  );
  const remoti = new EsecutoriRemoti(ambienti, 2_000, 2_000, strumentoDiProgetto);
  const lavori = await LavoriDeiProgetti.apri({
    progetti,
    ambienti,
    cartellaConversazioni: join(cartella, "conversazioni", "progetti"),
    cartellaModifiche: join(cartella, "modifiche"),
    immagini,
    locale,
    remoti,
    registroIncarichi: join(cartella, "incarichi.jsonl"),
    notaPrimaDelMessaggio: (idProgetto) => {
      const note = [sviluppo?.notaPerIlProgetto(idProgetto), memoria.daConsegnare(idProgetto)].filter((nota) => nota !== undefined);
      return note.length === 0 ? undefined : note.join("\n\n");
    },
  });
  // Le cartelle che il proprietario collega a un progetto in altri ambienti (ADR 0050).
  const collegate = new CartelleCollegate({
    progetti,
    ambienti,
    esecutore: (idAmbiente) => lavori.esecutore(idAmbiente),
    annota: (idProgetto, testo) => lavori.annota(idProgetto, testo),
  });
  const aggiornamenti = new AggiornamentoDeiNodi({
    ambienti,
    installata: join(cartella, "shinka"),
    versione: opzioni.versione,
    occupato: (idAmbiente) =>
      lavori
        .stato()
        .progetti.some((progetto) => progetto.idAmbiente === idAmbiente && (progetto.condizione === "al-lavoro" || progetto.condizione === "aspetta-te")),
    pacchetto: async () => [{ percorso: "versione.json", dati: Buffer.from(JSON.stringify({ versione: opzioni.versione ?? null })).toString("base64") }],
    ...opzioni.aggiornamenti,
  });
  t.after(() => aggiornamenti.chiudi());
  if (opzioni.sviluppo !== undefined) {
    // La cartella del progetto Shinka c'è già ed è un repository: non serve copiarne uno.
    const cartellaShinka = join(radiceProgetti, nomeCartellaDa(NOME_PROGETTO_SHINKA));
    await mkdir(cartellaShinka, { recursive: true });
    await git(cartellaShinka, ["init", "--quiet"]);
    sviluppo = await SviluppoDiShinka.apri({
      repository: join(cartella, "repository.git"),
      radiceProgetti,
      installata: join(cartella, "shinka"),
      fileInstallazione,
      guardiano: opzioni.sviluppo.guardiano ?? true,
      lavori,
      canaleHome: () => casa.canale,
      annotaHome: (testo) => casa.annota(testo),
      riavvia: () => void riavvii.push(Date.now()),
      nodi: () => aggiornamenti.daAggiornare(),
      propaga: (idNodi) => aggiornamenti.propaga(idNodi),
      ricordate,
      prepara: opzioni.sviluppo.prepara,
      attesaRiavvioMs: 10,
      ...(opzioni.sviluppo.attesaEsitoMs === undefined ? {} : { attesaEsitoMs: opzioni.sviluppo.attesaEsitoMs }),
      ...(opzioni.sviluppo.gateway === undefined ? {} : { gateway: opzioni.sviluppo.gateway }),
    });
    assert.ok(sviluppo, "il progetto Shinka deve potersi aprire");
  }
  const argomenti = await RegistroArgomenti.apri(join(cartella, "argomenti.json"));
  const conversazioniHome: ConversazioneFinta[] = [];
  const casa = await Home.apri({
    argomenti,
    immagini,
    cartellaArchivi: join(cartella, "conversazioni", "argomenti"),
    radiceProgetti,
    impostazioni: () => statoHome.impostazioni,
    notaPrimaDelMessaggio: (idArgomento) => memoria.daConsegnare(chiaveDellaHome(idArgomento)),
    apri: (apertura) => {
      const conversazione = new ConversazioneFinta({
        cartella: apertura.cartella,
        istruzioni: "istruzioni di prova",
        strumenti: [],
        strumentiSenzaRichiesta: [],
        impostazioni: statoHome.impostazioni,
        ...(apertura.idSessione === undefined ? {} : { idSessione: apertura.idSessione }),
        alEvento: apertura.alEvento,
        alIdSessione: apertura.alIdSessione,
      });
      conversazioniHome.push(conversazione);
      return conversazione;
    },
  });
  const laConversazione = (): ConversazioneFinta => {
    const ultima = conversazioniHome.at(-1);
    assert.ok(ultima, "la Home apre sempre la conversazione dell'argomento aperto");
    return ultima;
  };
  const posizione = new PosizioneDelProprietario();
  const elaborati = new Elaborati({
    ambienti: () => ambienti.stato().ambienti,
    storia: async (idArgomento) => (await casa.canaleDi(idArgomento))?.archiviati,
    cartellaAlCentro: (idArgomento) => casa.cartellaDellArgomento(idArgomento),
    argomenti: () => [{ id: argomenti.aperto.id }, ...argomenti.archiviati().map((voce) => ({ id: voce.id, titolo: voce.titolo }))],
    agisci: (idAmbiente, idArgomento, azione) =>
      (idAmbiente === ID_AMBIENTE_DEL_CENTRO ? locale : remoti.per(idAmbiente)).agisci(idArgomento, azione),
  });
  const proposte = new Proposte({
    canaleHome: () => casa.canale,
    annotaHome: (testo) => casa.annota(testo),
    argomentoAperto: () => ({ idArgomento: casa.idArgomentoAperto, cartellaAlCentro: casa.cartellaAperta }),
    lavori,
    ambienti,
    ...(conEstensioni === undefined ? {} : { estensioniPerProgetto: () => estensioni?.perProgetto() ?? {} }),
    ricordate,
  });
  if (conEstensioni !== undefined && estensioniNegliAmbienti !== undefined) {
    const negliAmbienti = estensioniNegliAmbienti;
    estensioni = await Estensioni.apri({
      file: join(cartella, "estensioni.json"),
      ambienti: () => ambienti.stato().ambienti,
      inAmbiente: (idAmbiente) => negliAmbienti.per(idAmbiente),
      canaleHome: () => casa.canale,
      annotaHome: (testo) => casa.annota(testo),
      ricordate,
      ...(conEstensioni.esamina === undefined ? {} : { esamina: conEstensioni.esamina }),
      ...(conEstensioni.accettaRepository === undefined ? {} : { accettaRepository: conEstensioni.accettaRepository }),
    });
    await negliAmbienti.avvia();
  }
  distribuisciSkill(skill, ambienti, () => {
    casa.ricaricaSkill();
    lavori.ricaricaSkill();
  });
  // Il lavoro offline dei nodi (ADR 0056), come al centro vero.
  colLavoroOffline({ ambienti, lavori, progetti, memoria, strumento: strumentoDiProgetto });
  // Come al centro vero, il nome scelto per l'ambiente del centro vale subito.
  const impostazioniInstallazione = ImpostazioniDellInstallazione.apri(cartella, (scelte) =>
    ambienti.rinominaDelCentro({ nome: scelte.ambiente?.nome ?? "Unraid", descrizione: scelte.ambiente?.descrizione ?? "Linux" }),
  );
  const accessiNegliAmbienti = new AccessiNegliAmbienti(
    ambienti,
    opzioni.accessi ?? { esegui: async () => ({ accessi: { claude: { collegato: true, descrizione: "Claude Pro" }, codex: { collegato: false } } }) },
  );
  const perINodi = opzioni.senzaCertificatoDeiNodi === true ? undefined : preparaIdentitaPerINodi(join(cartella, "collegamento-nodi"));
  // Le copie di sicurezza: la chiave si ricava in fretta, e un riavvio chiesto resta solo annotato.
  const copie = new CopieDiSicurezza({ dati: cartella, memoria, skill, versione: "versione-di-prova", costo: 2 ** 10, riavvia: () => void riavvii.push(Date.now()) });
  const interfaccia = await EstensioniInterfaccia.apri({ file: join(cartella, "interfaccia.json"), annota: (testo) => casa.annota(testo), ricordate });
  // Come al centro vero: le proposte che aspettavano prima del riavvio tornano.
  ricordate.collega(postiDegliArchivi(() => casa, lavori));
  await proposte.ripristina();
  await sviluppo?.ripristina();
  await estensioni?.ripristina();
  await interfaccia.ripristina();
  const centro = await creaCentro({
    interfaccia,
    ...(opzioni.originale === undefined ? {} : { originale: opzioni.originale }),
    accesso,
    primoAvvio,
    ...(perINodi === undefined ? {} : { perINodi }),
    ...(opzioni.installata === undefined ? {} : { installata: opzioni.installata }),
    home: casa,
    programmati,
    notifiche,
    risorse,
    approvazioni: schede,
    memoria,
    skill,
    copie,
    stili,
    impostazioni: impostazioniInstallazione,
    accessi: accessiNegliAmbienti,
    ...(opzioni.gateway === undefined ? {} : { gateway: opzioni.gateway }),
    ...(approvazioni === undefined ? {} : { approvazioni }),
    argomenti,
    ambienti,
    lavori,
    proposte,
    aggiornamenti,
    ...(sviluppo === undefined ? {} : { sviluppo }),
    ...(estensioni === undefined ? {} : { estensioni }),
    terminali,
    anteprime,
    applicazioni,
    file,
    desktop,
    collegate,
    statoHome,
    immagini,
    ...(opzioni.immaginiEsterne === undefined ? {} : { immaginiEsterne: opzioni.immaginiEsterne }),
    cookieSicuro: false,
    elaborati,
    posizione,
    ...(opzioni.https === undefined ? {} : { https: opzioni.https }),
    ...(opzioni.cartellaWeb === undefined ? {} : { cartellaWeb: opzioni.cartellaWeb }),
  });
  const ponte =
    opzioni.telegram === undefined || opzioni.gateway === undefined
      ? undefined
      : new PonteTelegram({
          gateway: opzioni.gateway,
          home: casa,
          lavori,
          elaborati,
          posizione,
          approvazioni: schede,
          programmati,
          vuole: (canale, genere) => notifiche.vuole(canale, genere),
          avvisa: (avviso) =>
            void notifiche.manda({ titolo: avviso.titolo, corpo: avviso.corpo, vai: avviso.conversazione === "home" ? "/" : `/progetti/${avviso.conversazione}`, urgente: avviso.urgente }),
          ...(sviluppo === undefined ? {} : { sviluppo }),
          ...(estensioni === undefined ? {} : { estensioni }),
          ...opzioni.telegram,
        });
  ponteDeiProgrammati = ponte;
  programmati.avvia();
  t.after(() => programmati.chiudi());
  ponte?.avvia();
  t.after(async () => {
    ponte?.chiudi();
    sviluppo?.chiudi();
    await centro.close();
    // Su Windows un file scritto mentre il centro si chiude può far trovare la cartella non vuota: si riprova.
    await rm(cartella, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  const entra = async (): Promise<string> => {
    const risposta = await centro.inject({
      method: "POST",
      url: "/api/accesso",
      payload: { password: PASSWORD },
    });
    const cookie = risposta.cookies.find((c) => c.name === COOKIE_SESSIONE);
    assert.ok(cookie, "il centro deve rilasciare il cookie di sessione");
    return cookie.value;
  };
  return {
    desktop,
    file,
    cartella,
    stili,
    accesso,
    centro,
    casa,
    argomenti,
    get home() {
      return laConversazione();
    },
    get canale() {
      return casa.canale;
    },
    conversazioniHome,
    radiceProgetti,
    agisci: (idAmbiente, idArgomento, azione) =>
      (idAmbiente === ID_AMBIENTE_DEL_CENTRO ? locale : remoti.per(idAmbiente)).agisci(idArgomento, azione),
    ambienti,
    progetti,
    lavori,
    proposte,
    memoria,
    skill,
    programmati,
    notifiche,
    notificheMandate,
    comuniDellaHome: (nome, argomenti) =>
      comuni.esegui({ chiave: chiaveDellaHome(casa.idArgomentoAperto), origine: "Home" }, nome, argomenti),
    statoHome,
    immagini,
    conversazioniLocali,
    terminali,
    shellLocali,
    anteprime,
    applicazioni,
    approvazioni,
    sviluppo,
    elaborati,
    ponte,
    posizione,
    aggiornamenti,
    estensioni,
    interfaccia,
    harnessEstensioni,
    riavvii,
    copie,
    fileInstallazione,
    comuniDelProgetto: strumentoDiProgetto,
    entra,
    ...(codicePrimoAvvio === undefined ? {} : { codicePrimoAvvio }),
  };
}

/** Aspetta che una condizione diventi vera, entro un tempo massimo. */
export async function finche(
  condizione: () => boolean,
  descrizione: string,
  massimoMs = 3_000,
): Promise<void> {
  const scadenza = Date.now() + massimoMs;
  while (!condizione()) {
    if (Date.now() > scadenza) throw new Error(`non è successo in tempo: ${descrizione}`);
    await new Promise((risolvi) => setTimeout(risolvi, 20));
  }
}

export interface NodoInProva {
  collegamento: CollegamentoAlCentro;
  stati: StatoCollegamento[];
  /** Cartella in cui questo nodo crea i progetti. */
  radiceProgetti: string;
  /** Le conversazioni aperte su questo nodo, nell'ordine in cui sono nate. */
  conversazioni: ConversazioneFinta[];
  /** Dove questo nodo tiene la copia delle skill di Shinka. */
  cartellaSkill: string;
  /** Le shell finte accese su questo nodo, nell'ordine in cui sono nate. */
  shell: ShellFinta[];
  /** Il lavoro del nodo: per fermarlo come quando il nodo si spegne. */
  lavoro: LavoroDelNodo;
  /** L'harness finto con cui questo nodo prova le estensioni e guarda ciò che ha già. */
  harness: HarnessDiProva;
  /** Il lavoro offline del nodo, se la prova lo ha chiesto (ADR 0056). */
  offline?: LavoroOffline;
}

/** Avvia un nodo vero verso il centro in prova, con conversazioni finte, e ne raccoglie gli stati. */
export async function avviaNodo(
  t: TestContext,
  banco: Pick<Banco, "centro" | "cartella">,
  /**
   * `senzaEstensioni`: un nodo di una versione che non le conosce. `versione`: quella che il nodo
   * dichiara. `aggiorna`: che cosa fa quando il centro gli chiede di cambiarla; con quello il nodo
   * dice di sapersi aggiornare, come quando è tenuto acceso dal suo guardiano.
   */
  opzioni: {
    senzaEstensioni?: boolean;
    harness?: HarnessDiProva;
    versione?: string;
    aggiorna?: NonNullable<ContestoLavoro["aggiorna"]>;
    aggiornamentoFallito?: { versione: string; motivo: string };
    /** Gli accessi dei motori in questo ambiente. Senza, il nodo non li sa dire, come uno di una versione precedente. */
    accessi?: NonNullable<ContestoLavoro["accessi"]>;
    /** Come il nodo prepara la cartella di un progetto, al posto di lanciare CodeGraph. */
    preparaProgetto?: NonNullable<ContestoLavoro["preparaProgetto"]>;
    /** Un nodo di una versione che non sa preparare un progetto: quel comando lo ignora. */
    senzaPreparazione?: boolean;
    /** Come le applicazioni del nodo guardano la loro porta e quanto aspettano. */
    applicazioni?: NonNullable<ContestoLavoro["applicazioni"]>;
    /** Ciò che riguarda il collegamento cifrato: l'identità con la sua custodia, l'impronta ricordata, e chi ascolta. */
    collegamento?: Partial<Pick<ConfigurazioneCollegamento, "identita" | "segreto" | "impronta" | "alImpronta" | "alCifrato">>;
    /** Con il lavoro offline: i suoi dati stanno in questa cartella, che resta tra un avvio e l'altro del nodo. */
    offline?: string;
    /** L'indirizzo con cui il nodo raggiunge il centro, se non è quello diretto: per esempio un ponte. */
    centro?: string;
    /** Il ponte del nodo per le macchine che non vedono il centro (ADR 0058). */
    ponte?: NonNullable<ContestoLavoro["ponte"]>;
  } = {},
): Promise<NodoInProva> {
  if (!banco.centro.server.listening) await banco.centro.listen({ host: "127.0.0.1", port: 0 });
  const { port } = banco.centro.server.address() as AddressInfo;
  const stati: StatoCollegamento[] = [];
  const conversazioni: ConversazioneFinta[] = [];
  const radiceProgetti = join(banco.cartella, "progetti-del-nodo");
  const cartellaSkill = join(banco.cartella, "skill-del-nodo");
  const shell: ShellFinta[] = [];
  const harness = opzioni.harness ?? harnessDiProva();
  const lavoro = new LavoroDelNodo({
    radiceProgetti,
    cartellaSkill,
    ...(opzioni.accessi === undefined ? {} : { accessi: opzioni.accessi }),
    // Le risorse le legge davvero, su questa macchina; Docker, nelle prove, non c'è.
    risorse: new CampionatoreRisorse({ radiceProgetti, esegui: async () => ({ codice: null, uscita: "", errori: "", assente: true }) }),
    ...(opzioni.senzaEstensioni === true
      ? {}
      : {
          estensioni: (chiavi, alCambio) =>
            new EstensioniInAmbiente({ cartella: join(banco.cartella, "estensioni-del-nodo"), radiceProgetti, chiavi, alCambio, apriHarness: harness.apri }),
        }),
    accendiShell: async (dove, colonne, righe) => {
      const accesa = new ShellFinta(dove, colonne, righe);
      shell.push(accesa);
      return accesa;
    },
    riferisci: (messaggio) => collegamento.riferisci(messaggio),
    ...(opzioni.aggiorna === undefined ? {} : { aggiorna: opzioni.aggiorna }),
    ...(opzioni.preparaProgetto === undefined ? {} : { preparaProgetto: opzioni.preparaProgetto }),
    ...(opzioni.applicazioni === undefined ? {} : { applicazioni: opzioni.applicazioni }),
    ...(opzioni.ponte === undefined ? {} : { ponte: opzioni.ponte }),
    apriConversazione: (configurazione) => {
      const conversazione = new ConversazioneFinta(configurazione);
      conversazioni.push(conversazione);
      return conversazione;
    },
  });
  const offline =
    opzioni.offline === undefined
      ? undefined
      : await LavoroOffline.apri({
          cartella: opzioni.offline,
          nome: "PC Windows",
          radiceProgetti,
          cartellaSkill,
          apri: lavoro.apriPerOffline,
          riferisci: (messaggio) => collegamento.riferisci(messaggio),
        });
  if (offline !== undefined) lavoro.usaOffline(offline);
  const collegamento: CollegamentoAlCentro = new CollegamentoAlCentro({
    centro: opzioni.centro ?? `http://127.0.0.1:${port}`,
    identita: { idNodo: ID_NODO, segreto: SEGRETO_NODO },
    ...opzioni.collegamento,
    nome: "PC Windows",
    descrizione: "Unity, Blender",
    sistema: "Windows 11",
    radiceProgetti,
    ...(opzioni.versione === undefined ? {} : { versione: opzioni.versione }),
    ...(opzioni.aggiorna === undefined ? {} : { siAggiorna: true }),
    ...(opzioni.aggiornamentoFallito === undefined ? {} : { aggiornamentoFallito: () => opzioni.aggiornamentoFallito }),
    alComando: (comando) => {
      if (opzioni.senzaPreparazione === true && comando.tipo === "prepara-progetto") return;
      lavoro.esegui(comando);
    },
    ...(offline === undefined ? {} : { offline: () => offline.daConsegnare() }),
    alCambio: (stato) => {
      if (stato.stato !== "collegamento" && stato.stato !== "in-attesa" && stato.stato !== "attivo") {
        lavoro.chiudiTutto();
        if (offline?.eCollegato === true) offline.collegato(false);
      }
      if (stato.stato === "attivo" && offline?.eCollegato === false) offline.collegato(true);
      stati.push(stato);
    },
    attesaInizialeMs: 50,
  });
  t.after(() => {
    lavoro.spegni();
    collegamento.ferma();
  });
  collegamento.avvia();
  return { collegamento, stati, radiceProgetti, conversazioni, cartellaSkill, shell, lavoro, harness, ...(offline === undefined ? {} : { offline }) };
}

/** Avvia un nodo e lo fa accettare dal proprietario: il suo ambiente è attivo. */
export async function avviaNodoAccettato(t: TestContext, banco: Banco, opzioni: Parameters<typeof avviaNodo>[2] = {}): Promise<NodoInProva> {
  const nodo = await avviaNodo(t, banco, opzioni);
  await finche(() => nodo.stati.some((s) => s.stato === "in-attesa"), "il nodo resta in attesa");
  assert.equal(await banco.ambienti.decidi(ID_NODO, "approvato"), true);
  await finche(() => nodo.stati.some((s) => s.stato === "attivo"), "il nodo viene accolto");
  return nodo;
}

/**
 * Usa uno strumento di Shinka come farebbe Claude dentro una conversazione di progetto:
 * passa dal gruppo di strumenti che la conversazione ha ricevuto, e quindi da tutta la strada
 * che porta al centro. Restituisce il testo della risposta, se è un errore, e quante immagini porta.
 */
export async function usaStrumento(
  conversazione: ConversazioneFinta,
  nome: string,
  argomenti: Record<string, unknown>,
): Promise<{ testo: string; errore: boolean; immagini: number }> {
  const gruppo = conversazione.configurazione?.strumentiNostri?.().shinka;
  assert.ok(gruppo !== undefined && gruppo.type === "sdk", "la conversazione ha gli strumenti di Shinka");
  // L'harness terrebbe per sé questa strada: nei test la si percorre a mano.
  const registrati = (gruppo.instance as unknown as { _registeredTools: Record<string, { handler: unknown }> })
    ._registeredTools;
  const handler = registrati[nome]?.handler as
    | ((argomenti: unknown, extra: unknown) => Promise<{ content: { type: string; text?: string }[]; isError?: boolean }>)
    | undefined;
  assert.ok(handler, `lo strumento ${nome} esiste`);
  const risposta = await handler(argomenti, {});
  return {
    testo: risposta.content.filter((parte) => parte.type === "text").map((parte) => parte.text).join("\n"),
    errore: risposta.isError === true,
    immagini: risposta.content.filter((parte) => parte.type === "image").length,
  };
}
