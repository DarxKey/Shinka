/**
 * Il collegamento di un nodo al centro. È il nodo a chiamare, mai il contrario:
 * così l'ambiente non deve accettare connessioni dall'esterno.
 *
 * Se il collegamento cade, il nodo riprova da solo con attese crescenti.
 * Se il centro lo rifiuta, si ferma: riprovare non cambierebbe la risposta.
 *
 * Il collegamento è cifrato (ADR 0040). Il nodo apre una connessione TLS chiedendo al centro il
 * certificato dei nodi, e lo riconosce dall'impronta: quella che ricorda, se ne ricorda una, e
 * allora non parla con nessun altro; altrimenti quella che vede la prima volta, che ricorda da
 * quando il centro lo ha ascoltato. Solo un nodo che non ricorda ancora nulla, davanti a un centro
 * che non sa cifrare, torna al collegamento in chiaro di prima. Con un indirizzo https il
 * certificato è quello del sito, e vale la verifica di sempre.
 */

import type { IncomingMessage } from "node:http";
import type { TLSSocket } from "node:tls";
import WebSocket from "ws";

import { eImmagine, leggiAllegati, type Immagine } from "../protocollo/allegati.ts";
import { leggiComandoAnteprima } from "../protocollo/anteprima.ts";
import { leggiComandoApplicazione } from "../protocollo/applicazioni.ts";
import { leggiComandoFile } from "../protocollo/file-progetto.ts";
import { leggiComandoTerminale } from "../protocollo/terminale.ts";
import { idArgomentoValido, leggiAzione } from "../protocollo/azioni.ts";
import { leggiChiaviConsegnate, leggiEstensioneDistribuita, type EstensioneDistribuita } from "../protocollo/estensioni.ts";
import { leggiEstensioniScelte, leggiPreparazione, type PreparazioneDelProgetto } from "../protocollo/avvio-progetto.ts";
import { DOMANDA_A_PARTE_MASSIMA, leggiRispostaAlleDomande } from "../protocollo/eventi.ts";
import { leggiRichiestaAllaConversazione } from "../protocollo/modifiche.ts";
import { eMotore, IMPEGNI, leggiImpostazioni } from "../protocollo/impostazioni.ts";
import { leggiRichiestaAccessi } from "../protocollo/accessi.ts";
import {
  INTERVALLO_BATTITO_MS,
  NOME_TLS_DEI_NODI,
  PERCORSO_COLLEGAMENTO,
  type ComandoPerNodo,
  type MessaggioCentro,
  type MessaggioNodo,
  type RiferitoDalNodo,
} from "../protocollo/nodi.ts";
import type { SkillDistribuita } from "../protocollo/skill.ts";
import { leggiFileDiVersione, versioneValida } from "../protocollo/versione.ts";
import type { CustodiaDelSegreto, Identita } from "./identita.ts";

/** L'immagine che accompagna l'esito di uno strumento, se è scritta come deve. */
function leggiImmagine(valore: unknown): Immagine | undefined {
  if (typeof valore !== "object" || valore === null) return undefined;
  const { tipo, dati } = valore as Record<string, unknown>;
  if (typeof tipo !== "string" || !eImmagine(tipo) || typeof dati !== "string" || dati === "") return undefined;
  return { tipo, dati };
}

export type StatoCollegamento =
  | { stato: "collegamento" }
  | { stato: "in-attesa"; codice: string }
  | { stato: "attivo"; nome: string }
  | { stato: "scollegato"; riprovaTraMs: number }
  /** Chi risponde all'indirizzo del centro non presenta il certificato che il nodo ricorda: il nodo non gli parla. */
  | { stato: "centro-non-riconosciuto"; riprovaTraMs: number }
  /** Il centro accetta solo collegamenti cifrati, e questo nodo non è riuscito ad aprirne uno. */
  | { stato: "solo-cifrato"; riprovaTraMs: number }
  | { stato: "rifiutato"; motivo: string };

export interface ConfigurazioneCollegamento {
  /** Indirizzo del centro, per esempio http://192.168.1.20:7850 */
  centro: string;
  identita: Identita;
  /** Chi tiene il segreto sul disco: con lui un segreto passato in chiaro viene cambiato. */
  segreto?: CustodiaDelSegreto;
  /** L'impronta del certificato dei nodi del centro, se il nodo la ricorda: allora parla solo con chi lo presenta. */
  impronta?: string;
  /** Il nodo ha riconosciuto il centro per la prima volta: l'impronta va ricordata. */
  alImpronta?(impronta: string): void;
  /** Vero quando il collegamento con il centro è cifrato, falso quando è in chiaro: detto a ogni collegamento riuscito. */
  alCifrato?(cifrato: boolean): void;
  nome: string;
  descrizione: string;
  sistema: string;
  /** Cartella in cui nascono le cartelle dei progetti nuovi. */
  radiceProgetti: string;
  /** La versione di Shinka che questo nodo sta eseguendo, se è scritta nella sua cartella. */
  versione?: string;
  /** Vero se il nodo è tenuto acceso dal suo guardiano, e quindi sa cambiare versione da solo. */
  siAggiorna?: boolean;
  /** L'ultimo aggiornamento, se non è partito: chiesto ogni volta che il nodo si presenta. */
  aggiornamentoFallito?(): { versione: string; motivo: string } | undefined;
  /** Su Windows: se il nodo parte a ogni accesso, chiesto quando si presenta; nulla dove non si sa. */
  avvioConWindows?(): boolean | undefined;
  alCambio(stato: StatoCollegamento): void;
  /** Il centro chiede di fare qualcosa in questo ambiente. */
  alComando?(comando: ComandoPerNodo): void;
  /** Attesa prima del primo nuovo tentativo; raddoppia fino al massimo. */
  attesaInizialeMs?: number;
  attesaMassimaMs?: number;
}

const ATTESA_INIZIALE_MS = 1_000;
const ATTESA_MASSIMA_MS = 30_000;
/** Quante volte un nodo che non ricorda il centro prova il collegamento cifrato prima di tornare a quello in chiaro. */
const PROVE_CIFRATE = 2;

/** Come il nodo apre il collegamento. */
type Modo =
  /** Indirizzo https: il certificato del sito, verificato come fa un browser. */
  | "sito"
  /** Il nodo ricorda il centro: TLS, e solo con quel certificato. */
  | "riconosciuto"
  /** Il nodo non ricorda ancora il centro: TLS, e ricorda il certificato che vede. */
  | "primo-incontro"
  /** Il centro non sa cifrare: come prima di questa versione. */
  | "in-chiaro";

/** L'impronta di un certificato come la tengono i nodi: esadecimale minuscolo, senza due punti. */
export function improntaPulita(impronta: string): string {
  return impronta.replace(/[^0-9a-fA-F]/g, "").toLowerCase();
}

/** Vero per un errore che dice che dall'altra parte qualcuno risponde, ma non in TLS: non che il centro è spento. */
function nonParlaTls(errore: unknown): boolean {
  const codice = typeof errore === "object" && errore !== null && "code" in errore ? String(errore.code) : "";
  const messaggio = errore instanceof Error ? errore.message : "";
  return codice === "EPROTO" || codice.startsWith("ERR_SSL") || codice.startsWith("ERR_TLS") || /wrong version number|Unexpected server response/i.test(messaggio);
}

export class CollegamentoAlCentro {
  readonly #cfg: ConfigurazioneCollegamento;
  #socket: WebSocket | undefined;
  #battito: NodeJS.Timeout | undefined;
  #nuovoTentativo: NodeJS.Timeout | undefined;
  #attesaMs: number;
  #fermato = false;
  /** L'impronta che il nodo ricorda del centro. */
  #impronta: string | undefined;
  /** Le prove del collegamento cifrato andate male di seguito, per un nodo che non ricorda il centro. */
  #proveFallite = 0;

  constructor(cfg: ConfigurazioneCollegamento) {
    this.#cfg = cfg;
    this.#attesaMs = cfg.attesaInizialeMs ?? ATTESA_INIZIALE_MS;
    this.#impronta = cfg.impronta === undefined || improntaPulita(cfg.impronta) === "" ? undefined : improntaPulita(cfg.impronta);
  }

  #modo(): Modo {
    if (new URL(this.#cfg.centro).protocol === "https:") return "sito";
    if (this.#impronta !== undefined) return "riconosciuto";
    return this.#proveFallite >= PROVE_CIFRATE ? "in-chiaro" : "primo-incontro";
  }

  avvia(): void {
    this.#fermato = false;
    this.#collega();
  }

  /** Riferisce al centro ciò che accade nell'ambiente. Se il collegamento è caduto, va perso. */
  riferisci(messaggio: RiferitoDalNodo): void {
    this.#manda(messaggio);
  }

  ferma(): void {
    this.#fermato = true;
    clearTimeout(this.#nuovoTentativo);
    clearInterval(this.#battito);
    this.#socket?.close();
  }

  #collega(): void {
    this.#cfg.alCambio({ stato: "collegamento" });
    const modo = this.#modo();
    const indirizzo = indirizzoDelCollegamento(this.#cfg.centro, modo !== "in-chiaro");
    // Il certificato dei nodi non passa da una CA: lo si chiede per nome e lo si riconosce dall'impronta, qui sotto.
    const perINodi: WebSocket.ClientOptions & { servername: string } = { handshakeTimeout: 20_000, servername: NOME_TLS_DEI_NODI, rejectUnauthorized: false };
    const socket = new WebSocket(indirizzo, modo === "riconosciuto" || modo === "primo-incontro" ? perINodi : { handshakeTimeout: 20_000 });
    this.#socket = socket;
    /** L'impronta del certificato visto in questa connessione. */
    let vista: string | undefined;
    /** Perché il nodo ha chiuso da sé, se lo ha fatto. */
    let chiuso: "centro-non-riconosciuto" | "solo-cifrato" | undefined;
    /** Vero da quando il centro ha risposto alla presentazione. */
    let ascoltato = false;
    let nonTls = false;

    // Prima di dire qualunque cosa: chi risponde deve presentare il certificato del centro.
    socket.on("upgrade", (risposta: IncomingMessage) => {
      if (modo !== "riconosciuto" && modo !== "primo-incontro") return;
      const certificato = (risposta.socket as TLSSocket).getPeerCertificate?.();
      vista = typeof certificato?.fingerprint256 === "string" ? improntaPulita(certificato.fingerprint256) : undefined;
      if (vista === undefined || vista === "" || (modo === "riconosciuto" && vista !== this.#impronta)) {
        chiuso = "centro-non-riconosciuto";
        socket.terminate();
        return;
      }
      // Al primo incontro si ricorda solo un certificato dei nodi. Un centro di prima con l'HTTPS
      // acceso presenta quello dei browser, che cambia: ricordarlo lascerebbe fuori il nodo. Lì vale
      // come un centro che non sa cifrare.
      if (modo === "primo-incontro" && !String(certificato.subjectaltname ?? "").split(/,\s*/).includes(`DNS:${NOME_TLS_DEI_NODI}`)) {
        vista = undefined;
        nonTls = true;
        socket.terminate();
      }
    });

    socket.on("open", () => {
      const cifrato = modo !== "in-chiaro";
      let segretoProssimo: string | undefined;
      try {
        if (cifrato) segretoProssimo = this.#cfg.segreto?.prossimo();
        else this.#cfg.segreto?.passaInChiaro();
      } catch {
        // Se il file dell'identità non si scrive, il segreto resta quello di adesso.
      }
      const fallito = this.#cfg.aggiornamentoFallito?.();
      const avvioConWindows = this.#cfg.avvioConWindows?.();
      this.#manda({
        tipo: "presentazione",
        idNodo: this.#cfg.identita.idNodo,
        segreto: this.#cfg.identita.segreto,
        ...(segretoProssimo === undefined ? {} : { segretoProssimo }),
        nome: this.#cfg.nome,
        descrizione: this.#cfg.descrizione,
        sistema: this.#cfg.sistema,
        radiceProgetti: this.#cfg.radiceProgetti,
        ...(this.#cfg.versione === undefined ? {} : { versione: this.#cfg.versione }),
        ...(this.#cfg.siAggiorna === true ? { siAggiorna: true } : {}),
        ...(fallito === undefined ? {} : { aggiornamentoFallito: fallito }),
        // L'indirizzo con cui il nodo raggiunge il centro: per reinstallarlo con lo stesso.
        centro: this.#cfg.centro,
        ...(avvioConWindows === undefined ? {} : { avvioConWindows }),
      });
      this.#battito = setInterval(() => this.#manda({ tipo: "battito" }), INTERVALLO_BATTITO_MS);
    });

    /** Il centro ha ascoltato il nodo: il certificato visto al primo incontro è il suo, e si ricorda. */
    const riconosci = (): void => {
      ascoltato = true;
      this.#proveFallite = 0;
      if (modo === "primo-incontro" && vista !== undefined && this.#impronta !== vista) {
        this.#impronta = vista;
        try {
          this.#cfg.alImpronta?.(vista);
        } catch {
          // Se non si scrive, il nodo la ricorda finché resta acceso.
        }
      }
    };

    socket.on("message", (dati: WebSocket.RawData, binario: boolean) => {
      const messaggio = binario ? undefined : leggiMessaggioCentro(dati.toString());
      if (messaggio === undefined) return;
      if (messaggio.tipo === "accolto") {
        riconosci();
        if (messaggio.segretoCambiato === true) {
          try {
            this.#cfg.segreto?.confermato();
          } catch {
            // Resta proposto: alla prossima presentazione il centro lo riconosce e lo riconferma.
          }
        }
        this.#attesaMs = this.#cfg.attesaInizialeMs ?? ATTESA_INIZIALE_MS;
        this.#cfg.alCifrato?.(modo !== "in-chiaro");
        this.#cfg.alCambio({ stato: "attivo", nome: messaggio.nome });
      } else if (messaggio.tipo === "in-attesa") {
        riconosci();
        this.#cfg.alCambio({ stato: "in-attesa", codice: messaggio.codice });
      } else if (messaggio.tipo === "rifiutato") {
        ascoltato = true;
        this.#fermato = true;
        this.#cfg.alCambio({ stato: "rifiutato", motivo: messaggio.motivo });
      } else if (messaggio.tipo === "solo-cifrato") {
        // Il centro non ascolta i collegamenti in chiaro: si torna a provare quello cifrato.
        chiuso = "solo-cifrato";
        this.#proveFallite = 0;
      } else {
        this.#cfg.alComando?.(messaggio);
      }
    });

    socket.on("close", () => {
      clearInterval(this.#battito);
      if (this.#socket === socket) this.#socket = undefined;
      if (this.#fermato) return;
      // Al primo incontro, se chi risponde non parla TLS, dopo qualche prova si torna al collegamento in chiaro.
      if (modo === "primo-incontro" && !ascoltato && nonTls) this.#proveFallite += 1;
      const attesa = this.#attesaMs;
      this.#attesaMs = Math.min(attesa * 2, this.#cfg.attesaMassimaMs ?? ATTESA_MASSIMA_MS);
      this.#cfg.alCambio({ stato: chiuso ?? "scollegato", riprovaTraMs: attesa });
      this.#nuovoTentativo = setTimeout(() => this.#collega(), attesa);
    });

    // Un errore è sempre seguito dalla chiusura, che decide se riprovare.
    socket.on("error", (errore: unknown) => {
      if (nonParlaTls(errore)) nonTls = true;
    });
  }

  #manda(messaggio: MessaggioNodo): void {
    const socket = this.#socket;
    if (socket !== undefined && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(messaggio));
    }
  }
}

/**
 * Dall'indirizzo del centro a quello del collegamento: https diventa wss; http diventa wss se il
 * collegamento è cifrato, sulla stessa porta, altrimenti ws.
 */
export function indirizzoDelCollegamento(centro: string, cifrato = false): string {
  const indirizzo = new URL(PERCORSO_COLLEGAMENTO, centro);
  if (indirizzo.protocol === "http:") {
    // La porta va detta: cambiando schema, quella sottintesa non sarebbe più la stessa.
    const porta = indirizzo.port === "" ? "80" : indirizzo.port;
    indirizzo.protocol = cifrato ? "wss:" : "ws:";
    indirizzo.port = porta;
  } else if (indirizzo.protocol === "https:") indirizzo.protocol = "wss:";
  else throw new Error(`L'indirizzo del centro deve cominciare con http o https: ${centro}`);
  return indirizzo.toString();
}

function leggiMessaggioCentro(dati: unknown): MessaggioCentro | undefined {
  if (typeof dati !== "string") return undefined;
  let letto: unknown;
  try {
    letto = JSON.parse(dati);
  } catch {
    return undefined;
  }
  if (typeof letto !== "object" || letto === null || !("tipo" in letto)) return undefined;
  const campi = letto as Record<string, unknown>;
  if (campi.tipo === "accolto" && typeof campi.nome === "string") {
    return { tipo: "accolto", nome: campi.nome, ...(campi.segretoCambiato === true ? { segretoCambiato: true as const } : {}) };
  }
  if (campi.tipo === "solo-cifrato") return { tipo: "solo-cifrato" };
  if (campi.tipo === "in-attesa" && typeof campi.codice === "string") {
    return { tipo: "in-attesa", codice: campi.codice };
  }
  if (campi.tipo === "rifiutato" && typeof campi.motivo === "string") {
    return { tipo: "rifiutato", motivo: campi.motivo };
  }
  return leggiComando(campi);
}

/** Riconosce un comando del centro, controllando che abbia i campi che gli servono. */
export function leggiComando(campi: Record<string, unknown>): ComandoPerNodo | undefined {
  const testo = (nome: string): string | undefined => {
    const valore = campi[nome];
    return typeof valore === "string" ? valore : undefined;
  };
  const idConversazione = testo("idConversazione");
  switch (campi.tipo) {
    case "crea-cartella": {
      const idRichiesta = testo("idRichiesta");
      const nomeCartella = testo("nomeCartella");
      const brief = testo("brief");
      if (idRichiesta === undefined || nomeCartella === undefined || brief === undefined) return undefined;
      const daArgomento = campi.daArgomento;
      return {
        tipo: "crea-cartella",
        idRichiesta,
        nomeCartella,
        brief,
        ...(idArgomentoValido(daArgomento) ? { daArgomento } : {}),
      };
    }
    case "prepara-progetto": {
      const idRichiesta = testo("idRichiesta");
      const cartella = testo("cartella");
      const elenco = Array.isArray(campi.preparazioni) ? (campi.preparazioni as unknown[]) : undefined;
      const preparazioni = elenco?.map(leggiPreparazione);
      if (idRichiesta === undefined || cartella === undefined || cartella.length > 1000 || preparazioni === undefined) return undefined;
      if (preparazioni.length > 10 || preparazioni.some((una) => una === undefined)) return undefined;
      return { tipo: "prepara-progetto", idRichiesta, cartella, preparazioni: preparazioni as PreparazioneDelProgetto[] };
    }
    case "adotta-cartella": {
      const idRichiesta = testo("idRichiesta");
      const percorso = testo("percorso");
      if (idRichiesta === undefined || percorso === undefined || percorso.length > 1000) return undefined;
      return { tipo: "adotta-cartella", idRichiesta, percorso };
    }
    case "apri-conversazione": {
      const cartella = testo("cartella");
      const idSessione = testo("idSessione");
      const impostazioni = leggiImpostazioni(campi.impostazioni);
      const estensioni = campi.estensioni === undefined ? undefined : leggiEstensioniScelte(campi.estensioni);
      if (idConversazione === undefined || cartella === undefined || impostazioni === undefined) return undefined;
      // Un elenco malformato non apre la conversazione con tutte le estensioni: non la apre.
      if (campi.estensioni !== undefined && estensioni === undefined) return undefined;
      return {
        tipo: "apri-conversazione",
        idConversazione,
        cartella,
        ...(idSessione === undefined ? {} : { idSessione }),
        impostazioni,
        ...(estensioni === undefined ? {} : { estensioni }),
        ...(eMotore(campi.motorePredefinito) ? { motorePredefinito: campi.motorePredefinito } : {}),
      };
    }
    case "accessi": {
      const idRichiesta = testo("idRichiesta");
      const richiesta = leggiRichiestaAccessi(campi.richiesta);
      if (idRichiesta === undefined || richiesta === undefined) return undefined;
      return { tipo: "accessi", idRichiesta, richiesta };
    }
    case "risorse": {
      const idRichiesta = testo("idRichiesta");
      return idRichiesta === undefined ? undefined : { tipo: "risorse", idRichiesta };
    }
    case "imposta": {
      const impostazioni = leggiImpostazioni(campi.impostazioni);
      if (idConversazione === undefined || impostazioni === undefined) return undefined;
      return { tipo: "imposta", idConversazione, impostazioni };
    }
    case "messaggio": {
      const messaggio = testo("testo");
      const allegati = leggiAllegati(campi.allegati);
      if (idConversazione === undefined || messaggio === undefined || allegati === undefined) return undefined;
      return {
        tipo: "messaggio",
        idConversazione,
        testo: messaggio,
        ...(allegati.length === 0 ? {} : { allegati }),
      };
    }
    case "annota": {
      const annotazione = testo("testo");
      if (idConversazione === undefined || annotazione === undefined) return undefined;
      return { tipo: "annota", idConversazione, testo: annotazione };
    }
    case "esito-strumento": {
      const idRichiesta = testo("idRichiesta");
      const esito = testo("testo");
      if (idRichiesta === undefined || esito === undefined) return undefined;
      const immagine = leggiImmagine(campi.immagine);
      return {
        tipo: "esito-strumento",
        idRichiesta,
        testo: esito,
        ...(campi.errore === true ? { errore: true } : {}),
        ...(immagine === undefined ? {} : { immagine }),
      };
    }
    case "skill": {
      if (!Array.isArray(campi.skill)) return undefined;
      const skill: SkillDistribuita[] = [];
      for (const voce of campi.skill as unknown[]) {
        if (typeof voce !== "object" || voce === null) return undefined;
        const { nome, file } = voce as Record<string, unknown>;
        if (typeof nome !== "string" || typeof file !== "string") return undefined;
        skill.push({ nome, file });
      }
      return { tipo: "skill", skill };
    }
    case "estensioni": {
      if (!Array.isArray(campi.estensioni)) return undefined;
      const estensioni: EstensioneDistribuita[] = [];
      for (const voce of campi.estensioni as unknown[]) {
        const letta = leggiEstensioneDistribuita(voce);
        if (letta === undefined) return undefined;
        estensioni.push(letta);
      }
      return { tipo: "estensioni", estensioni };
    }
    case "prova-estensione": {
      const idRichiesta = testo("idRichiesta");
      const estensione = leggiEstensioneDistribuita(campi.estensione);
      if (idRichiesta === undefined || estensione === undefined) return undefined;
      return { tipo: "prova-estensione", idRichiesta, estensione };
    }
    case "guarda-estensioni": {
      const idRichiesta = testo("idRichiesta");
      return idRichiesta === undefined ? undefined : { tipo: "guarda-estensioni", idRichiesta };
    }
    case "chiavi-consegnate": {
      const idRichiesta = testo("idRichiesta");
      const chiavi = leggiChiaviConsegnate(campi.chiavi);
      if (idRichiesta === undefined || chiavi === undefined) return undefined;
      return { tipo: "chiavi-consegnate", idRichiesta, chiavi };
    }
    case "aggiorna": {
      const idRichiesta = testo("idRichiesta");
      const versione = campi.versione;
      const file = leggiFileDiVersione(campi.file);
      if (idRichiesta === undefined || !versioneValida(versione) || file === undefined) return undefined;
      return { tipo: "aggiorna", idRichiesta, versione, file };
    }
    case "decidi-permesso": {
      const idPermesso = testo("idPermesso");
      const decisione = campi.decisione;
      if (idConversazione === undefined || idPermesso === undefined) return undefined;
      if (decisione !== "approvato" && decisione !== "negato") return undefined;
      return { tipo: "decidi-permesso", idConversazione, idPermesso, decisione, ...(campi.sempre === true ? { sempre: true as const } : {}) };
    }
    case "termina-processo": {
      const idRichiesta = testo("idRichiesta");
      const pid = campi.pid;
      if (idRichiesta === undefined || typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return undefined;
      return { tipo: "termina-processo", idRichiesta, pid };
    }
    case "avvio-con-windows": {
      const idRichiesta = testo("idRichiesta");
      if (idRichiesta === undefined || typeof campi.attivo !== "boolean") return undefined;
      return { tipo: "avvio-con-windows", idRichiesta, attivo: campi.attivo };
    }
    case "prendi-modello": {
      const idPresa = testo("idPresa");
      const modello = testo("modello");
      if (idPresa === undefined || modello === undefined) return undefined;
      const impegno = IMPEGNI.find((uno) => uno === campi.impegno);
      return { tipo: "prendi-modello", idPresa, modello, ...(impegno === undefined ? {} : { impegno }) };
    }
    case "lascia-modello": {
      const idPresa = testo("idPresa");
      return idPresa === undefined ? undefined : { tipo: "lascia-modello", idPresa };
    }
    case "riavvolgi": {
      const idRichiesta = testo("idRichiesta");
      const idMessaggio = testo("idMessaggio");
      if (idConversazione === undefined || idRichiesta === undefined || idMessaggio === undefined) return undefined;
      return { tipo: "riavvolgi", idRichiesta, idConversazione, idMessaggio, prova: campi.prova === true, file: campi.file === true };
    }
    case "alla-conversazione": {
      const idRichiesta = testo("idRichiesta");
      const richiesta = leggiRichiestaAllaConversazione(campi.richiesta);
      if (idConversazione === undefined || idRichiesta === undefined || richiesta === undefined) return undefined;
      return { tipo: "alla-conversazione", idRichiesta, idConversazione, richiesta };
    }
    case "a-parte": {
      const idRichiesta = testo("idRichiesta");
      const domanda = campi.domanda;
      if (idConversazione === undefined || idRichiesta === undefined) return undefined;
      if (typeof domanda !== "string" || domanda.trim() === "" || domanda.length > DOMANDA_A_PARTE_MASSIMA) return undefined;
      return { tipo: "a-parte", idRichiesta, idConversazione, domanda };
    }
    case "rispondi-domande": {
      const idDomande = testo("idDomande");
      const risposta = leggiRispostaAlleDomande(campi.risposta);
      if (idConversazione === undefined || idDomande === undefined || risposta === undefined) return undefined;
      return { tipo: "rispondi-domande", idConversazione, idDomande, risposta };
    }
    case "interrompi":
    case "chiudi-conversazione":
      if (idConversazione === undefined) return undefined;
      return { tipo: campi.tipo, idConversazione };
    case "azione": {
      const idRichiesta = testo("idRichiesta");
      const idArgomento = campi.idArgomento;
      const azione = leggiAzione(campi.azione);
      if (idRichiesta === undefined || !idArgomentoValido(idArgomento) || azione === undefined) return undefined;
      return { tipo: "azione", idRichiesta, idArgomento, azione };
    }
    case "azione-in-cartella": {
      const idRichiesta = testo("idRichiesta");
      const cartella = typeof campi.cartella === "string" && campi.cartella.length > 0 && campi.cartella.length <= 1000 ? campi.cartella : undefined;
      const azione = leggiAzione(campi.azione);
      if (idRichiesta === undefined || cartella === undefined || azione === undefined) return undefined;
      return { tipo: "azione-in-cartella", idRichiesta, cartella, azione };
    }
    default:
      return leggiComandoTerminale(campi) ?? leggiComandoAnteprima(campi) ?? leggiComandoApplicazione(campi) ?? leggiComandoFile(campi);
  }
}
