/**
 * Il centro: serve l'interfaccia, controlla l'accesso del proprietario, fa da tramite
 * tra il browser e la conversazione della Home e accoglie i nodi degli ambienti.
 */

import { leggiConsegnaOffline } from "../protocollo/offline.ts";
import { POLITICA_PAGINA_ESTENSIONE, rottaEsclusa } from "../protocollo/interfaccia.ts";
import { conLaLibreria } from "../protocollo/ponte-delle-pagine.ts";
import type { EstensioniInterfaccia } from "./interfaccia.ts";
import type { StatoEstensioniDelProgetto } from "../protocollo/progetti.ts";
import { tipoInParole } from "../protocollo/estensioni.ts";
import { AvvioConWindows } from "./avvio-con-windows.ts";
import type { PrimoAvvio } from "./primo-avvio.ts";
import { pacchettoDiInstallazione } from "./installazione-nuova.ts";
import { InvitiDegliAmbienti, PERCORSO_PACCHETTO_NODO, PERCORSO_PREPARAZIONE, pacchettoDelNodo, scriptDiPreparazione } from "./ambiente-nuovo.ts";
import { leggiEsitoAccessi, leggiRichiestaAccessi, type AccessiDiUnAmbiente, type EsitoAccessi, type ImpostazioniViste } from "../protocollo/accessi.ts";
import type { AccessiNegliAmbienti } from "./accessi.ts";
import { DESCRIZIONE_AMBIENTE_MASSIMA, NOME_AMBIENTE_MASSIMO, type ImpostazioniDellInstallazione, type ModificaDellInstallazione } from "./impostazioni-installazione.ts";
import { motoreConfigurato } from "../nodo/motore.ts";
import fastifyCookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { createReadStream, existsSync } from "node:fs";
import { leggiAllegati, type Allegato } from "../protocollo/allegati.ts";
import { leggiRiferitoAnteprima } from "../protocollo/anteprima.ts";
import { leggiRiferitoApplicazione } from "../protocollo/applicazioni.ts";
import { genereDelFile, leggiRiferitoFile } from "../protocollo/file-progetto.ts";
import type { FileDeiProgetti } from "./file-progetto.ts";
import type { ApplicazioniDeiProgetti } from "./applicazioni.ts";
import { leggiDalBrowser, leggiRiferitoTerminale } from "../protocollo/terminale.ts";
import { leggiEsito } from "../protocollo/azioni.ts";
import { leggiEsitiPreparazione, SKILL_DI_PARTENZA } from "../protocollo/avvio-progetto.ts";
import { azioneIntera } from "./storia-leggera.ts";
import { cercaNelleConversazioni, type ConversazioneDaCercare } from "./ricerca.ts";
import { esportaInMarkdown, nomeDellEsportazione } from "./esportazione.ts";
import { FINE_STORIA, leggiAnteprimaRiavvolgimento, leggiRispostaAlleDomande, type DecisionePermesso, type EventoArchiviato, type EventoConversazione } from "../protocollo/eventi.ts";
import {
  PERCORSO_COLLEGAMENTO,
  TEMPO_PER_PRESENTARSI_MS,
  type MessaggioNodo,
} from "../protocollo/nodi.ts";
import { IMPEGNI, MODI_PERMESSI, MOTORI, type ModificaImpostazioni, type Motore, type SceltaDelProprietario } from "../protocollo/impostazioni.ts";
import { leggiChiImplementa, progettoDellaConversazione, type StatoChiImplementa } from "../protocollo/incarichi.ts";
import { DESCRIZIONE_MASSIMA, NOME_MASSIMO, sceltoDa, STILI_DI_SHINKA } from "../protocollo/stili.ts";
import { BRIEF_MASSIMO, NOME_PROGETTO_MASSIMO, type NuovoProgettoAMano } from "../protocollo/progetti.ts";
import type { Archiviazione, SpazioDiUnaVoce, Uso } from "../protocollo/uso.ts";
import { contaUso, spazioDi, type FonteDiUso } from "./uso.ts";
import { StileNonValido, type RegistroStili } from "./stili.ts";
import type { ConfermaProposta } from "../protocollo/progetti.ts";
import { LUNGHEZZA_MINIMA_PASSWORD, type Accesso } from "./accesso.ts";
import { COPIA_MASSIMA, leggiScelteDelTrasloco, type StatoCopie } from "../protocollo/copia.ts";
import { CopiaNonValida, PasswordDellaCopiaSbagliata } from "./copia-di-sicurezza.ts";
import { CopiaRifiutata, type CopieDiSicurezza } from "./copie.ts";
import { ID_AMBIENTE_DEL_CENTRO, type CanaleNodo, type RegistroAmbienti } from "./ambienti.ts";
import type { Canale } from "./canale.ts";
import { MANIFESTO, type AggiornamentiDesktop } from "./desktop.ts";
import type { CartelleCollegate } from "./cartelle-collegate.ts";
import { intervalliChiesti, piuParti } from "./intervalli.ts";
import { PROTOCOLLO_DEI_CLIENTI, type FonteDiPubblicazione, type RichiestaDiPubblicazione } from "../protocollo/desktop.ts";
import { inBreve, versioneDi } from "../protocollo/versione.ts";
import { GENERI_DISPOSITIVO, type GenereDispositivo } from "../protocollo/sicurezza.ts";
import type { AggiornamentoDeiNodi } from "./aggiornamento-nodi.ts";
import { ProgrammatoRifiutato, type LavoriProgrammati } from "./programmati.ts";
import { NotificaRifiutata, type NotificheApp } from "./notifiche-app.ts";
import { EVENTO_MASSIMO, PERCORSO_EVENTI } from "../protocollo/programmati.ts";
import { leggiRisorse } from "../protocollo/risorse.ts";
import { daDove, programmaDa, RegistroAccessi } from "./registro-accessi.ts";
import type { IdentitaPerINodi } from "./identita-per-i-nodi.ts";
import type { ChiEntra } from "./accesso.ts";
import type { RisorseDegliAmbienti } from "./risorse.ts";
import { versioneValida } from "../protocollo/versione.ts";
import type { Anteprime } from "./anteprima.ts";
import { consensoDato, type Approvazioni } from "./approvazioni.ts";
import type { RegistroArgomenti } from "./argomenti.ts";
import { AmbienteSpento } from "./esecutori.ts";
import type { PortaGateway } from "./gateway.ts";
import { CUSTODIA_HOME, type Home } from "./home.ts";
import type { CustodiaImmagini } from "./immagini.ts";
import type { Elaborati } from "./elaborati.ts";
import type { PosizioneDelProprietario } from "./posizione.ts";
import type { RequestListener } from "node:http";
import { serverPoliglotta } from "./poliglotta.ts";
import { indirizziHttps, nomeValido, paginaDelCertificato, profiloApple, salvaSceltaHttps, statoHttps, type HttpsDelCentro } from "./https.ts";
import { PERCORSO_CERTIFICATO } from "../protocollo/https.ts";
import { leggiPosizione, messaggioDellaPosizione } from "../protocollo/posizione.ts";
import { genereDi, tipoMimeDi } from "../protocollo/elaborati.ts";
import { ProgettoNonCreato, type LavoriDeiProgetti } from "./lavori.ts";
import { VoceRifiutata, type Memoria } from "./memoria.ts";
import type { RegistroSkill } from "./skill.ts";
import { chiaveDellaHome } from "./strumenti-comuni.ts";
import { VOCE_MEMORIA_MASSIMA } from "../protocollo/memoria.ts";
import type { DettaglioVault } from "../protocollo/vault.ts";
import type { Proposte } from "./proposte.ts";
import type { SviluppoDiShinka } from "./sviluppo.ts";
import type { EsitoAccensione, Estensioni } from "./estensioni.ts";
import { leggiEsitoProva, leggiEstensioniDellAmbiente } from "../protocollo/estensioni.ts";
import type { StatoHome } from "./stato-home.ts";
import type { TerminaliDeiProgetti } from "./terminali.ts";
import { ImmaginiEsterne } from "./immagini-esterne.ts";

export const COOKIE_SESSIONE = "shinka_sessione";

/** Percorsi riservati al proprietario: servono la sua sessione. */
/**
 * Le API che si usano senza essere entrati: tutte le altre chiedono la sessione del proprietario.
 * Il collegamento dei nodi ha il suo riconoscimento, con il segreto di ciascun nodo.
 */
export const PERCORSI_LIBERI = [
  "/api/stato",
  "/api/accesso",
  "/api/uscita",
  "/api/primo-avvio",
  // Un dispositivo riceve il suo gettone con la password, come un browser la sua sessione (ADR 0047).
  "/api/dispositivi",
  PERCORSO_COLLEGAMENTO,
  // Lo script e il pacchetto di un ambiente nuovo: li chiama una macchina senza sessione, e chiedono un invito valido.
  PERCORSO_PREPARAZIONE,
  PERCORSO_PACCHETTO_NODO,
  // Gli eventi degli altri sistemi: li manda chi non ha una sessione, e chiedono la chiave di un lavoro programmato.
  PERCORSO_EVENTI,
] as const;

export interface RottaRegistrata {
  metodo: string;
  percorso: string;
}

/** Le rotte di ciascun centro creato, per le prove. */
export const ROTTE_REGISTRATE = new WeakMap<object, RottaRegistrata[]>();

/** Il gettone di dispositivo di una richiesta, da `Authorization: Bearer <gettone>`. */
export function gettoneDi(autorizzazione: string | undefined): string | undefined {
  const trovato = /^Bearer\s+([A-Za-z0-9_-]{16,200})\s*$/i.exec(autorizzazione ?? "");
  return trovato?.[1];
}

/** Vero se la richiesta va a un'API del proprietario: ogni `/api/` che non sia tra quelle libere. */
export function delProprietario(url: string): boolean {
  const percorso = url.split("?")[0] ?? "";
  if (percorso !== "/api" && !percorso.startsWith("/api/")) return false;
  return !(PERCORSI_LIBERI as readonly string[]).includes(percorso.replace(/\/+$/, ""));
}

/** Da chi viene una modifica fatta dalle pagine Memoria e Skill. */
const ORIGINE_PROPRIETARIO = "Proprietario";

const CORPO_VOCE = {
  type: "object",
  required: ["testo"],
  additionalProperties: false,
  properties: { testo: { type: "string", maxLength: VOCE_MEMORIA_MASSIMA * 2 } },
} as const;

/** Ogni quanto il centro controlla se un nodo tace da troppo tempo. */
const CONTROLLO_SILENZI_MS = 5_000;

/**
 * Solo risorse nostre: niente script o immagini da altri siti, niente inclusione in altre pagine.
 * I riquadri ammessi sono gli elaborati, serviti da qui ma isolati (vedi `POLITICA_ELABORATO`), e
 * l'anteprima, che sta su un'altra porta dello stesso host;
 * il terminale usa un WebSocket verso questo stesso indirizzo, che alcuni browser non
 * riconoscono in 'self' e va quindi nominato.
 */
export function politicaContenuti(host: string | undefined, portaAnteprima: number | null): string {
  // Un host scritto in modo strano non entra nell'intestazione: valgono le regole più strette.
  const valido = host !== undefined && /^(\[[0-9a-fA-F:]+\]|[A-Za-z0-9.-]+)(:\d{1,5})?$/.test(host) ? host : undefined;
  const nome = valido?.replace(/:\d{1,5}$/, "");
  return [
    "default-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    valido === undefined ? "connect-src 'self'" : `connect-src 'self' ws://${valido} wss://${valido}`,
    nome === undefined || portaAnteprima === null ? "frame-src 'self'" : `frame-src 'self' ${nome}:${portaAnteprima}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join("; ");
}

/**
 * Un elaborato è scritto da Claude, e una pagina HTML, come una mappa, ha bisogno di script e di
 * risorse da altri siti. Il centro lo serve in un recinto: con `sandbox` la pagina ha un'origine
 * sua, opaca, e non vede né il cookie del proprietario né le API di Shinka; può stare solo in un
 * riquadro della nostra interfaccia. Vale per ogni elaborato, anche se lo si apre da solo.
 */
export const POLITICA_ELABORATO = [
  "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox",
  "default-src * data: blob: 'unsafe-inline' 'unsafe-eval'",
  "frame-ancestors 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const BATTITO_MS = 25_000;

const ERRORI_PASSAGGIO = {
  occupata: "La Home sta ancora lavorando: aspetta che finisca, oppure interrompila.",
  "non-trovato": "Argomento non trovato tra quelli archiviati.",
} as const;

/** Un messaggio può portare allegati: serve più spazio di quello di una richiesta qualunque. */
const CORPO_MASSIMO_MESSAGGIO = 16 * 1024 * 1024;

/** Un nodo riferisce anche le immagini prodotte dalle azioni di Claude. */
const MESSAGGIO_MASSIMO_NODO = 16 * 1024 * 1024;

const CORPO_MESSAGGIO = {
  type: "object",
  required: ["testo"],
  additionalProperties: false,
  properties: {
    testo: { type: "string", maxLength: 20_000 },
    allegati: {
      type: "array",
      items: {
        type: "object",
        required: ["nome", "tipo", "dati"],
        additionalProperties: false,
        properties: { nome: { type: "string" }, tipo: { type: "string" }, dati: { type: "string" } },
      },
    },
  },
} as const;

/** Senza registro degli stili si sceglie tra quelli di Shinka. */
const STILI_DI_RISERVA = STILI_DI_SHINKA;

const CORPO_IMPOSTAZIONI = {
  type: "object",
  additionalProperties: false,
  properties: {
    motore: { enum: [...MOTORI, null] },
    modello: { type: ["string", "null"], maxLength: 100 },
    impegno: { enum: [...IMPEGNI, null] },
    permessi: { enum: [...MODI_PERMESSI] },
    stile: { type: ["string", "null"], maxLength: 100 },
    tuttoIlPc: { type: ["boolean", "null"] },
  },
} as const;

interface CorpoMessaggio {
  testo: string;
  allegati?: unknown;
}

/** Legge un messaggio del proprietario; un testo d'errore se non si può accettare. */
function leggiMessaggio(corpo: CorpoMessaggio): { testo: string; allegati: Allegato[] } | string {
  const allegati = leggiAllegati(corpo.allegati);
  if (allegati === undefined) return "Gli allegati sono troppi, troppo pesanti o non leggibili.";
  const testo = corpo.testo.trim();
  if (testo === "" && allegati.length === 0) return "Il messaggio è vuoto.";
  return { testo, allegati };
}

export interface OpzioniCentro {
  accesso: Accesso;
  home: Home;
  argomenti: RegistroArgomenti;
  ambienti: RegistroAmbienti;
  lavori: LavoriDeiProgetti;
  proposte: Proposte;
  /** La memoria del proprietario, che lui vede, corregge e cancella. */
  memoria: Memoria;
  /** Le skill di Shinka, con la loro storia. */
  skill: RegistroSkill;
  /** Il gateway, che custodisce il vault. Se manca, l'interfaccia dice che non è configurato. */
  gateway?: PortaGateway;
  /** Le approvazioni dei comandi sugli host per gli stack. Se mancano, in questa installazione non ci sono. */
  approvazioni?: Approvazioni;
  /** L'aggiornamento dei nodi alla versione del centro. Se manca, in questa installazione non c'è. */
  aggiornamenti?: AggiornamentoDeiNodi;
  /** I lavori programmati. Se mancano, in questa installazione non ci sono. */
  programmati?: LavoriProgrammati;
  /** Le notifiche dell'app. Se mancano, in questa installazione non ci sono. */
  notifiche?: NotificheApp;
  /** Le risorse degli ambienti, per la loro pagina. Se mancano, la pagina non c'è. */
  risorse?: RisorseDegliAmbienti;
  /** Il registro degli accessi. Se manca, il centro ne tiene uno solo in memoria. */
  registroAccessi?: RegistroAccessi;
  /** Il certificato con cui il centro si fa riconoscere dai nodi: con questo il loro collegamento è cifrato. */
  perINodi?: IdentitaPerINodi;
  /** Lo sviluppo di Shinka da dentro Shinka. Se manca, in questa installazione non c'è. */
  sviluppo?: SviluppoDiShinka;
  /** Le estensioni di Shinka. Se mancano, in questa installazione non ci sono. */
  estensioni?: Estensioni;
  /** Le estensioni dell'interfaccia (ADR 0054). */
  interfaccia?: EstensioniInterfaccia;
  /** Gli elaborati degli argomenti della Home. Se mancano, il pannello dice che non ci sono. */
  elaborati?: Elaborati;
  /**
   * L'HTTPS del centro. Con i certificati il centro parla HTTPS e HTTP sulla stessa porta; senza,
   * solo HTTP, e la pagina permette di accenderlo.
   */
  https?: HttpsDelCentro;
  /** Le copie di sicurezza dei dati; senza, la pagina Impostazioni non le offre. */
  copie?: CopieDiSicurezza;
  /** Gli stili di risposta. Se mancano, valgono solo quelli di Shinka e non se ne creano altri. */
  stili?: RegistroStili;
  /** Le scelte della pagina Impostazioni. Se mancano, valgono solo le variabili d'ambiente. */
  impostazioni?: ImpostazioniDellInstallazione;
  /** Gli accessi dei motori negli ambienti. Se mancano, la pagina Impostazioni non li mostra. */
  accessi?: AccessiNegliAmbienti;
  /** Dove sta la posizione che il proprietario condivide. Se manca, il browser non la può mandare. */
  posizione?: PosizioneDelProprietario;
  /** I terminali dei progetti. Se mancano, in questa installazione il terminale non c'è. */
  terminali?: TerminaliDeiProgetti;
  /** L'anteprima delle applicazioni dei progetti. Se manca, in questa installazione non c'è. */
  anteprime?: Anteprime;
  /** Le applicazioni dei progetti: avviarle e fermarle dal pulsante dell'anteprima. */
  applicazioni?: ApplicazioniDeiProgetti;
  /** I file dei progetti, per il pannello File. Se mancano, il pannello dice che non ci sono. */
  file?: FileDeiProgetti;
  /** Gli aggiornamenti di Shinka Desktop che il centro serve (ADR 0049). */
  desktop?: AggiornamentiDesktop;
  /** Le cartelle collegate ai progetti in altri ambienti (ADR 0050). */
  collegate?: CartelleCollegate;
  /** Cartella con l'interfaccia già costruita. Se manca, il centro serve solo le API. */
  cartellaWeb?: string;
  /** Il primo avvio guidato: c'è finché la password del proprietario non è stata scelta. */
  primoAvvio?: PrimoAvvio;
  /** La cartella della versione in funzione: da lì nasce il pacchetto per un'installazione nuova, e quello di un nodo nuovo. */
  installata?: string;
  /** Gli inviti per preparare un ambiente nuovo. Se mancano, il centro ne tiene di suoi. */
  inviti?: InvitiDegliAmbienti;
  /** Ciò che il centro ricorda della Home: qui interessano le sue impostazioni. */
  statoHome: StatoHome;
  /** Dove stanno le immagini delle conversazioni. */
  immagini: CustodiaImmagini;
  /** Le immagini che le risposte scrivono nel testo con un indirizzo https: le scarica il centro. Se mancano, il centro ne tiene di sue. */
  immaginiEsterne?: Pick<ImmaginiEsterne, "leggi">;
  /** Vero quando l'interfaccia è servita in HTTPS: il cookie viaggia solo cifrato. */
  cookieSicuro: boolean;
}

export async function creaCentro(opzioni: OpzioniCentro): Promise<FastifyInstance> {
  const { accesso, home, argomenti, ambienti, lavori, proposte, statoHome, immagini, memoria, skill } = opzioni;
  // Allo spegnimento le connessioni ancora aperte, come i flussi di eventi, vengono chiuse:
  // altrimenti il centro resterebbe ad aspettare che i browser se ne vadano da soli.
  const certificati = opzioni.https?.certificati;
  const perINodi = opzioni.perINodi;
  const app = fastify({
    bodyLimit: 256 * 1024,
    forceCloseConnections: true,
    // Le chat parallele della Home (ADR 0052) usano le rotte della Home, con il numero della chat.
    rewriteUrl: (richiesta) => indirizzoDellaChat(richiesta.url ?? "/"),
    // Con l'HTTPS la stessa porta parla anche HTTP: nodi, gateway e guardiano restano come sono.
    // Il certificato dei nodi c'è anche senza HTTPS: il loro collegamento è cifrato comunque.
    ...(certificati === undefined && perINodi === undefined
      ? {}
      : {
          serverFactory: (gestore: RequestListener) =>
            serverPoliglotta(
              gestore,
              certificati === undefined ? undefined : { chiave: certificati.chiave, catena: certificati.catena },
              perINodi === undefined ? undefined : { chiave: perINodi.chiave, catena: perINodi.certificato },
            ),
        }),
  });
  // Le rotte registrate, per la prova che controlla che nessuna API del proprietario resti scoperta.
  const rotte: RottaRegistrata[] = [];
  app.addHook("onRoute", (rotta) => {
    for (const metodo of [rotta.method].flat()) rotte.push({ metodo, percorso: rotta.url });
  });
  ROTTE_REGISTRATE.set(app, rotte);
  await app.register(fastifyCookie);
  // I nodi riferiscono anche testi interi di Claude: serve più spazio di un saluto.
  await app.register(fastifyWebsocket, { options: { maxPayload: MESSAGGIO_MASSIMO_NODO } });

  const controlloSilenzi = setInterval(() => ambienti.controllaSilenzi(), CONTROLLO_SILENZI_MS);
  controlloSilenzi.unref();
  app.addHook("onClose", async () => clearInterval(controlloSilenzi));

  const haWeb = opzioni.cartellaWeb !== undefined && existsSync(opzioni.cartellaWeb);
  if (haWeb && opzioni.cartellaWeb !== undefined) {
    await app.register(fastifyStatic, { root: opzioni.cartellaWeb });
  }

  // Il registro degli accessi: chi entra, da dove, e ciò che arriva senza una sessione.
  const registroAccessi = opzioni.registroAccessi ?? new RegistroAccessi();
  const chiDi = (richiesta: FastifyRequest): ChiEntra => ({ da: daDove(richiesta.ip, richiesta.headers["x-forwarded-for"]), programma: programmaDa(richiesta.headers["user-agent"]) });

  // Chi cerca una pagina che non c'è: da fuori casa, di solito, qualcuno che prova indirizzi a caso.
  app.addHook("onResponse", async (richiesta, risposta) => {
    if (risposta.statusCode === 404 && !richiesta.url.startsWith("/api/")) registroAccessi.annota("pagina-inesistente", chiDi(richiesta), { percorso: richiesta.url });
  });

  app.addHook("onRequest", async (richiesta, risposta) => {
    // Chi apre l'interfaccia in HTTP va all'HTTPS, se il proprietario lo ha scelto. Le API, il
    // collegamento dei nodi e la pagina del certificato restano raggiungibili anche in HTTP.
    if (
      certificati !== undefined &&
      opzioni.https?.configurazione.reindirizza === true &&
      richiesta.protocol === "http" &&
      (richiesta.method === "GET" || richiesta.method === "HEAD") &&
      !richiesta.url.startsWith("/api/") &&
      !richiesta.url.startsWith(PERCORSO_CERTIFICATO) &&
      richiesta.headers.host !== undefined &&
      /^[A-Za-z0-9.\-[\]:]+$/.test(richiesta.headers.host)
    ) {
      return risposta.redirect(`https://${richiesta.headers.host}${richiesta.url}`, 308);
    }
    // Le richieste che cambiano qualcosa devono arrivare dalla nostra stessa interfaccia.
    if (richiesta.method !== "GET" && richiesta.method !== "HEAD") {
      const origine = richiesta.headers.origin;
      if (origine !== undefined && hostDi(origine) !== richiesta.headers.host) {
        registroAccessi.annota("origine-rifiutata", chiDi(richiesta), { percorso: richiesta.url, dettaglio: `da ${origine.slice(0, 120)}` });
        return risposta.code(403).send({ errore: "Origine non ammessa." });
      }
    }
    const riservata = delProprietario(richiesta.url);
    // Un dispositivo, come Shinka Desktop, entra con il suo gettone al posto del cookie (ADR 0047).
    // Con il gettone vale solo il gettone: uno sbagliato risponde 401 e non conta tra i tentativi della password.
    const gettone = gettoneDi(richiesta.headers.authorization);
    if (riservata && gettone !== undefined) {
      if (!accesso.validaDispositivo(gettone)) {
        registroAccessi.annota("dispositivo-rifiutato", chiDi(richiesta), { percorso: richiesta.url });
        return risposta.code(401).send({ errore: "Questo dispositivo non può più entrare: serve di nuovo la password." });
      }
      accesso.segnaDispositivo(gettone, chiDi(richiesta));
    } else if (riservata && !accesso.valida(richiesta.cookies[COOKIE_SESSIONE])) {
      registroAccessi.annota("senza-sessione", chiDi(richiesta), { percorso: richiesta.url });
      return risposta.code(401).send({ errore: "Accesso richiesto." });
    }
    // Di ogni sessione si ricorda l'ultima volta che è stata usata, e da dove.
    if (riservata && gettone === undefined) accesso.segna(richiesta.cookies[COOKIE_SESSIONE], chiDi(richiesta));
    // Una richiesta che l'interfaccia fa per un'estensione (ADR 0057): entra nel registro con il suo
    // nome, e le rotte che a un'estensione restano chiuse si rifiutano anche qui.
    const estensione = nomeDellEstensione(richiesta.headers["x-shinka-estensione"]);
    if (riservata && estensione !== undefined) {
      const percorso = richiesta.url.split("?")[0] ?? richiesta.url;
      if (rottaEsclusa(richiesta.method, percorso)) {
        registroAccessi.annota("richiesta-estensione-rifiutata", chiDi(richiesta), { percorso, dettaglio: `«${estensione}» ${richiesta.method} ${percorso}` });
        return risposta.code(403).send({ errore: "Questa rotta a un'estensione dell'interfaccia resta chiusa." });
      }
      registroAccessi.annota("richiesta-estensione", chiDi(richiesta), { percorso, dettaglio: `«${estensione}» ${richiesta.method} ${percorso.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ":id")}` });
    }
    // Un WebSocket si apre anche da un'altra origine, e il cookie viaggia verso ogni porta di questo
    // host: quello del proprietario si accetta solo dalla nostra interfaccia, non dall'anteprima.
    // Un gettone invece non viaggia da solo, e un browser non lo può aggiungere a un WebSocket: chi
    // lo manda è un programma, che di solito non dice l'origine.
    if (riservata && richiesta.headers.upgrade?.toLowerCase() === "websocket") {
      const origine = richiesta.headers.origin;
      const ammessa = origine === undefined ? gettone !== undefined : hostDi(origine) === richiesta.headers.host;
      if (!ammessa) {
        return risposta.code(403).send({ errore: "Origine non ammessa." });
      }
    }
  });


  const portaAnteprima = opzioni.anteprime?.stato().porta ?? null;
  app.addHook("onSend", async (richiesta, risposta) => {
    risposta.header("X-Content-Type-Options", "nosniff");
    risposta.header("Referrer-Policy", "no-referrer");
    // Un elaborato porta già la sua politica, più libera ma in un recinto: non va sostituita.
    if (!risposta.hasHeader("Content-Security-Policy")) {
      risposta.header("Content-Security-Policy", politicaContenuti(richiesta.headers.host, portaAnteprima));
    }
  });

  const daiSessione = (richiesta: FastifyRequest, risposta: FastifyReply, esito: { token: string; durataMs: number }): void => {
    risposta.setCookie(COOKIE_SESSIONE, esito.token, {
      httpOnly: true,
      sameSite: "strict",
      // Entrando in HTTPS il cookie viaggia solo cifrato.
      secure: opzioni.cookieSicuro || richiesta.protocol === "https",
      path: "/",
      maxAge: Math.floor(esito.durataMs / 1000),
    });
  };

  // La versione in funzione, che `/api/stato` dice a chiunque insieme al protocollo dei clienti.
  const versioneInFunzione = opzioni.installata === undefined ? undefined : await versioneDi(opzioni.installata);
  app.get("/api/stato", async (richiesta) => ({
    // Per i clienti come Shinka Desktop: se il protocollo è più alto del loro, si aggiornano (ADR 0049).
    protocollo: PROTOCOLLO_DEI_CLIENTI,
    ...(versioneInFunzione === undefined ? {} : { versione: inBreve(versioneInFunzione) }),
    configurato: accesso.configurato,
    autenticato:
      gettoneDi(richiesta.headers.authorization) === undefined
        ? accesso.valida(richiesta.cookies[COOKIE_SESSIONE])
        : accesso.validaDispositivo(gettoneDi(richiesta.headers.authorization)),
    ...(opzioni.primoAvvio?.attivo === true ? { primoAvvio: true } : {}),
  }));

  // Il primo avvio: la prima password, con il codice che il centro ha scritto tra i dati e nel registro.
  app.post<{ Body: { codice: string; password: string } }>(
    "/api/primo-avvio",
    {
      schema: {
        body: {
          type: "object",
          required: ["codice", "password"],
          additionalProperties: false,
          properties: { codice: { type: "string", minLength: 1, maxLength: 40 }, password: { type: "string", minLength: 1, maxLength: 1024 } },
        },
      },
    },
    async (richiesta, risposta) => {
      const esito = (await opzioni.primoAvvio?.imposta(richiesta.body.codice, richiesta.body.password, Date.now(), chiDi(richiesta))) ?? { esito: "non-serve" as const };
      if (esito.esito === "ok") registroAccessi.annota("primo-avvio", chiDi(richiesta));
      else if (esito.esito === "rifiutato" || esito.esito === "troppi-tentativi") registroAccessi.annota("primo-avvio-fallito", chiDi(richiesta));
      switch (esito.esito) {
        case "ok":
          daiSessione(richiesta, risposta, esito);
          return { autenticato: true };
        case "non-serve":
          return risposta.code(409).send({ errore: "La password c'è già: entra con quella." });
        case "password-corta":
          return risposta.code(400).send({ errore: `La password deve avere almeno ${LUNGHEZZA_MINIMA_PASSWORD} caratteri.` });
        case "troppi-tentativi":
          return risposta.code(429).send({ errore: `Troppi codici sbagliati: riprova tra ${Math.ceil(esito.riprovaTraMs / 1000)} secondi.` });
        case "rifiutato":
          return risposta.code(403).send({ errore: "Il codice non è giusto. Lo trovi alla fine di installa.sh, o nel registro del centro." });
      }
    },
  );

  // Il pacchetto da cui nasce un'altra installazione di Shinka: il codice di questa versione.
  app.get("/api/installazione/pacchetto", async (_richiesta, risposta) => {
    if (opzioni.installata === undefined) return risposta.code(404).send({ errore: "Questa installazione non sa preparare il pacchetto." });
    try {
      const pacchetto = await pacchettoDiInstallazione(opzioni.installata);
      return risposta
        .header("Content-Type", "application/gzip")
        .header("Content-Disposition", `attachment; filename="${pacchetto.nome}"`)
        .header("Cache-Control", "no-store")
        .send(pacchetto.dati);
    } catch (errore) {
      return risposta.code(409).send({ errore: errore instanceof Error ? errore.message : String(errore) });
    }
  });

  app.post<{ Body: { password: string } }>(
    "/api/accesso",
    {
      schema: {
        body: {
          type: "object",
          required: ["password"],
          additionalProperties: false,
          properties: { password: { type: "string", minLength: 1, maxLength: 1024 } },
        },
      },
    },
    async (richiesta, risposta) => {
      const esito = await accesso.entra(richiesta.body.password, Date.now(), chiDi(richiesta));
      registroAccessi.annota(esito.esito === "ok" ? "entrata" : esito.esito === "rifiutato" ? "entrata-fallita" : "entrata-frenata", chiDi(richiesta));
      if (esito.esito === "troppi-tentativi") {
        return risposta.code(429).send({
          errore: "Troppi tentativi falliti.",
          riprovaTraSecondi: Math.ceil(esito.riprovaTraMs / 1000),
        });
      }
      if (esito.esito === "rifiutato") {
        return risposta.code(401).send({ errore: "Password non valida." });
      }
      daiSessione(richiesta, risposta, esito);
      return { autenticato: true };
    },
  );

  // Un dispositivo, come Shinka Desktop, riceve il suo gettone con la password: con lo stesso limite
  // ai tentativi dell'entrata. Il gettone si vede solo in questa risposta (ADR 0047).
  app.post<{ Body: { password: string; nome: string; genere: GenereDispositivo } }>(
    "/api/dispositivi",
    {
      schema: {
        body: {
          type: "object",
          required: ["password", "nome", "genere"],
          additionalProperties: false,
          properties: {
            password: { type: "string", minLength: 1, maxLength: 1024 },
            nome: { type: "string", minLength: 1, maxLength: 60 },
            genere: { type: "string", enum: [...GENERI_DISPOSITIVO] },
          },
        },
      },
    },
    async (richiesta, risposta) => {
      const nome = richiesta.body.nome.replace(/[\u0000-\u001f\u007f]/g, "").trim();
      if (nome === "") return risposta.code(400).send({ errore: "Serve un nome per il dispositivo." });
      const esito = await accesso.aggiungiDispositivo(richiesta.body.password, { nome, genere: richiesta.body.genere }, Date.now(), chiDi(richiesta));
      registroAccessi.annota(esito.esito === "ok" ? "dispositivo-aggiunto" : esito.esito === "rifiutato" ? "dispositivo-non-aggiunto" : "entrata-frenata", chiDi(richiesta), {
        dettaglio: `«${nome.slice(0, 60)}»`,
      });
      if (esito.esito === "troppi-tentativi") {
        return risposta.code(429).send({ errore: "Troppi tentativi falliti.", riprovaTraSecondi: Math.ceil(esito.riprovaTraMs / 1000) });
      }
      if (esito.esito === "rifiutato") return risposta.code(401).send({ errore: "Password non valida." });
      return risposta.code(201).send({ id: esito.id, token: esito.token });
    },
  );

  // Il dispositivo esce da questo centro: il suo gettone non vale più.
  app.post("/api/dispositivi/chiusura", async (richiesta, risposta) => {
    const gettone = gettoneDi(richiesta.headers.authorization);
    if (gettone === undefined) return risposta.code(400).send({ errore: "Serve il gettone del dispositivo da chiudere." });
    if (await accesso.esciDalDispositivo(gettone)) registroAccessi.annota("dispositivo-tolto", chiDi(richiesta), { dettaglio: "uscito da sé" });
    return { chiuso: true };
  });

  // La password si cambia dalla pagina Impostazioni, con quella attuale. Le altre sessioni si
  // chiudono; questo browser ne riceve subito una nuova.
  app.post<{ Body: { attuale: string; nuova: string } }>(
    "/api/impostazioni/password",
    {
      schema: {
        body: {
          type: "object",
          required: ["attuale", "nuova"],
          additionalProperties: false,
          properties: { attuale: { type: "string", minLength: 1, maxLength: 1024 }, nuova: { type: "string", minLength: 1, maxLength: 1024 } },
        },
      },
    },
    async (richiesta, risposta) => {
      if (richiesta.body.nuova.length < LUNGHEZZA_MINIMA_PASSWORD) {
        return risposta.code(400).send({ errore: `La password nuova deve avere almeno ${LUNGHEZZA_MINIMA_PASSWORD} caratteri.` });
      }
      const esito = await accesso.cambiaPassword(richiesta.body.attuale, richiesta.body.nuova, Date.now(), chiDi(richiesta));
      registroAccessi.annota(esito.esito === "ok" ? "password-cambiata" : "password-non-cambiata", chiDi(richiesta));
      if (esito.esito === "troppi-tentativi") {
        return risposta.code(429).send({ errore: `Troppi tentativi falliti: riprova tra ${Math.ceil(esito.riprovaTraMs / 1000)} secondi.` });
      }
      if (esito.esito === "rifiutato") return risposta.code(403).send({ errore: "La password attuale non è giusta." });
      daiSessione(richiesta, risposta, esito);
      return { cambiata: true };
    },
  );

  app.post("/api/uscita", async (richiesta, risposta) => {
    if (accesso.valida(richiesta.cookies[COOKIE_SESSIONE])) registroAccessi.annota("uscita", chiDi(richiesta));
    await accesso.esci(richiesta.cookies[COOKIE_SESSIONE]);
    risposta.clearCookie(COOKIE_SESSIONE, { path: "/" });
    return { autenticato: false };
  });

  /** La chat della Home a cui va la richiesta: la principale, o la chat parallela indicata (ADR 0052). */
  const homeDi = (richiesta: FastifyRequest): Home | undefined => {
    const numero = numeroDellaChatNellIndirizzo(richiesta.url);
    return numero === undefined ? home : home.chat(numero);
  };
  const CHAT_NON_APERTA = { errore: "Questa chat non è aperta." };

  app.post<{ Body: CorpoMessaggio }>(
    "/api/home/messaggi",
    { bodyLimit: CORPO_MASSIMO_MESSAGGIO, schema: { body: CORPO_MESSAGGIO } },
    async (richiesta, risposta) => {
      const messaggio = leggiMessaggio(richiesta.body);
      if (typeof messaggio === "string") return risposta.code(400).send({ errore: messaggio });
      const casa = homeDi(richiesta);
      if (casa === undefined) return risposta.code(404).send(CHAT_NON_APERTA);
      casa.invia(messaggio.testo, messaggio.allegati);
      return risposta.code(202).send({ accettato: true });
    },
  );

  // Il proprietario manda alla Home la posizione che il browser gli ha dato, dopo averlo permesso.
  app.post<{ Body: unknown }>(
    "/api/home/posizione",
    {
      schema: {
        body: {
          type: "object",
          required: ["lat", "lon", "quando"],
          additionalProperties: false,
          properties: {
            lat: { type: "number", minimum: -90, maximum: 90 },
            lon: { type: "number", minimum: -180, maximum: 180 },
            precisioneM: { type: "number", minimum: 0 },
            quando: { type: "string", maxLength: 40 },
          },
        },
      },
    },
    async (richiesta, risposta) => {
      const posizione = leggiPosizione(richiesta.body, "browser");
      if (opzioni.posizione === undefined) return risposta.code(404).send({ errore: "In questa installazione la posizione non si può mandare." });
      if (posizione === undefined) return risposta.code(400).send({ errore: "La posizione non è valida." });
      opzioni.posizione.registra(posizione);
      (homeDi(richiesta) ?? home).invia(messaggioDellaPosizione(posizione));
      return risposta.code(202).send({ accettato: true });
    },
  );

  // Il proprietario cambia modello, impegno o permessi della Home: la scelta resta salvata.
  /** La scelta del proprietario con lo stile intero al posto del suo identificativo; undefined se lo stile non c'è. */
  const conLoStile = (scelta: SceltaDelProprietario): ModificaImpostazioni | undefined => {
    const { stile, ...resto } = scelta;
    if (stile === undefined || stile === null) return { ...resto, ...(stile === null ? { stile: null } : {}) };
    const trovato = opzioni.stili?.trova(stile) ?? STILI_DI_RISERVA.find((voce) => voce.id === stile);
    return trovato === undefined ? undefined : { ...resto, stile: sceltoDa(trovato) };
  };
  const STILE_NON_TROVATO = { errore: "Questo stile non c'è più: scegline un altro." };

  app.post<{ Body: SceltaDelProprietario }>(
    "/api/home/impostazioni",
    { schema: { body: CORPO_IMPOSTAZIONI } },
    async (richiesta, risposta) => {
      const modifica = conLoStile(richiesta.body);
      if (modifica === undefined) return risposta.code(400).send(STILE_NON_TROVATO);
      const impostazioni = await statoHome.cambia(modifica);
      home.imposta(impostazioni);
      return { impostazioni };
    },
  );

  // Gli stili di risposta tra cui scegliere: quelli di Shinka e quelli del proprietario.
  app.get("/api/stili", async () => ({ stili: opzioni.stili?.elenco() ?? STILI_DI_RISERVA, siCreano: opzioni.stili !== undefined }));

  // Uno stile nuovo, da un nome e da una descrizione: le istruzioni le scrive Claude.
  app.post<{ Body: { nome: string; descrizione: string } }>(
    "/api/stili",
    {
      schema: {
        body: {
          type: "object",
          required: ["nome", "descrizione"],
          additionalProperties: false,
          properties: {
            nome: { type: "string", minLength: 1, maxLength: NOME_MASSIMO },
            descrizione: { type: "string", minLength: 1, maxLength: DESCRIZIONE_MASSIMA },
          },
        },
      },
    },
    async (richiesta, risposta) => {
      if (opzioni.stili === undefined) return risposta.code(404).send({ errore: "In questa installazione non si creano stili." });
      try {
        return risposta.code(201).send({ stile: await opzioni.stili.crea(richiesta.body.nome, richiesta.body.descrizione) });
      } catch (errore) {
        const messaggio = errore instanceof Error ? errore.message : String(errore);
        return risposta.code(errore instanceof StileNonValido ? 400 : 502).send({ errore: messaggio });
      }
    },
  );

  app.delete<{ Params: { id: string } }>("/api/stili/:id", async (richiesta, risposta) => {
    if ((await opzioni.stili?.rimuovi(richiesta.params.id)) !== true) return risposta.code(404).send({ errore: "Stile non trovato, o di Shinka." });
    return { rimosso: true };
  });

  // Le chat parallele di un progetto (ADR 0052): si aprono e si chiudono qui; per il resto usano le
  // rotte del progetto, con l'identificativo della loro conversazione al posto di quello del progetto.
  app.post<{ Params: { id: string } }>("/api/progetti/:id/chat", async (richiesta, risposta) => {
    const esito = await lavori.apriChat(richiesta.params.id);
    if ("motivo" in esito) return risposta.code(409).send({ errore: esito.motivo });
    return esito;
  });
  app.delete<{ Params: { id: string; numero: string } }>("/api/progetti/:id/chat/:numero", async (richiesta, risposta) => {
    if (!(await lavori.chiudiChat(richiesta.params.id, Number(richiesta.params.numero)))) {
      return risposta.code(404).send({ errore: "Questa chat non è aperta." });
    }
    return { chiusa: true };
  });

  // Un'immagine scritta nel testo di una risposta: la chiede il centro al suo sito, con le sue regole
  // (ADR 0043). Arriva con una politica che non lascia girare nulla, nel caso il browser la apra da sola.
  const immaginiEsterne = opzioni.immaginiEsterne ?? new ImmaginiEsterne();
  app.get<{ Querystring: { indirizzo?: string } }>("/api/immagine-esterna", async (richiesta, risposta) => {
    const indirizzo = richiesta.query.indirizzo;
    if (typeof indirizzo !== "string" || indirizzo.length > 4000) return risposta.code(400).send({ errore: "Manca l'indirizzo dell'immagine." });
    const esito = await immaginiEsterne.leggi(indirizzo);
    if (!("dati" in esito)) return risposta.code(404).header("Cache-Control", "private, max-age=600").send({ errore: esito.motivo });
    return risposta
      .header("Content-Type", esito.tipo)
      .header("Cache-Control", "private, max-age=86400")
      .header("Content-Security-Policy", "sandbox; default-src 'none'")
      .send(esito.dati);
  });

  app.get<{ Params: { id: string } }>("/api/home/immagini/:id", (richiesta, risposta) =>
    mandaImmagine(risposta, immagini.trova(CUSTODIA_HOME, richiesta.params.id)),
  );

  // Il proprietario risponde alle domande che Claude gli ha posto, dalla scheda nella conversazione.
  app.post<{ Params: { id: string }; Body: { risposta?: unknown } }>("/api/home/domande/:id", async (richiesta, risposta) => {
    const letta = leggiRispostaAlleDomande(richiesta.body?.risposta);
    if (letta === undefined) return risposta.code(400).send({ errore: "Risposta alle domande non valida." });
    if (homeDi(richiesta)?.rispondiDomande(richiesta.params.id, letta) !== true) {
      return risposta.code(404).send({ errore: "Queste domande non aspettano più una risposta." });
    }
    return { risposto: true };
  });

  app.post<{ Params: { id: string }; Body: { decisione: DecisionePermesso } }>(
    "/api/home/permessi/:id",
    {
      schema: {
        body: {
          type: "object",
          required: ["decisione"],
          additionalProperties: false,
          properties: { decisione: { type: "string", enum: ["approvato", "negato"] } },
        },
      },
    },
    async (richiesta, risposta) => {
      const casa = homeDi(richiesta);
      if (casa === undefined) return risposta.code(404).send(CHAT_NON_APERTA);
      consensoDato(opzioni.approvazioni, chiaveDellaHome(casa.idArgomentoAperto), casa.canale, richiesta.params.id, richiesta.body.decisione);
      const trovato = casa.decidiPermesso(richiesta.params.id, richiesta.body.decisione);
      if (!trovato) {
        return risposta.code(404).send({ errore: "Questo permesso non è più in attesa." });
      }
      return { deciso: true };
    },
  );

  // Il proprietario approva o nega un comando su un host per gli stack di prova, dalla scheda
  // nella conversazione: il comando è quello che il gateway ha tenuto da parte.
  app.post<{ Params: { id: string }; Body: { decisione: "approvata" | "negata" } }>(
    "/api/approvazioni/:id",
    {
      schema: {
        body: {
          type: "object",
          required: ["decisione"],
          additionalProperties: false,
          properties: { decisione: { type: "string", enum: ["approvata", "negata"] } },
        },
      },
    },
    async (richiesta, risposta) => {
      if (opzioni.approvazioni?.decidi(richiesta.params.id, richiesta.body.decisione) !== true) {
        return risposta.code(404).send({ errore: "Questa approvazione non è più in attesa: è scaduta, oppure è già stata decisa." });
      }
      return { deciso: true };
    },
  );

  // Il proprietario conferma o annulla una proposta di sviluppo di Shinka: confermata, la richiesta
  // passa al progetto Shinka.
  app.post<{ Params: { id: string }; Body: { esito: "confermata" | "annullata" } & ModificaImpostazioni }>(
    "/api/sviluppo/proposte/:id",
    {
      schema: {
        body: {
          type: "object",
          required: ["esito"],
          additionalProperties: false,
          properties: {
            esito: { type: "string", enum: ["confermata", "annullata"] },
            // Le impostazioni scelte nella scheda, solo per questo lavoro. `null` torna al predefinito.
            motore: { enum: [...MOTORI, null] },
            modello: { type: ["string", "null"], maxLength: 100 },
            impegno: { enum: [...IMPEGNI, null] },
            permessi: { enum: [...MODI_PERMESSI] },
          },
        },
      },
    },
    async (richiesta, risposta) => {
      const nonInAttesa = { errore: "Questa proposta non è più in attesa." };
      if (richiesta.body.esito === "annullata") {
        if (opzioni.sviluppo?.annulla(richiesta.params.id) !== true) return risposta.code(404).send(nonInAttesa);
        return { annullata: true };
      }
      let idProgetto: string | undefined;
      try {
        const { motore, modello, impegno, permessi } = richiesta.body;
        idProgetto = opzioni.sviluppo?.conferma(richiesta.params.id, {
          ...(motore === undefined ? {} : { motore }),
          ...(modello === undefined ? {} : { modello }),
          ...(impegno === undefined ? {} : { impegno }),
          ...(permessi === undefined ? {} : { permessi }),
        });
      } catch (errore) {
        // La richiesta non è passata al progetto: la proposta resta lì.
        return risposta.code(409).send({ errore: errore instanceof Error ? errore.message : String(errore) });
      }
      if (idProgetto === undefined) return risposta.code(404).send(nonInAttesa);
      return { idProgetto };
    },
  );

  // Il proprietario approva o nega l'installazione di una versione di Shinka che ha passato le prove.
  app.post<{ Params: { id: string }; Body: { decisione: "approvata" | "negata" } }>(
    "/api/sviluppo/installazioni/:id",
    {
      schema: {
        body: {
          type: "object",
          required: ["decisione"],
          additionalProperties: false,
          properties: { decisione: { type: "string", enum: ["approvata", "negata"] } },
        },
      },
    },
    async (richiesta, risposta) => {
      if (opzioni.sviluppo?.decidi(richiesta.params.id, richiesta.body.decisione) !== true) {
        return risposta.code(404).send({ errore: "Questa installazione non è più in attesa: è scaduta, oppure è già stata decisa." });
      }
      return { deciso: true };
    },
  );

  // Il proprietario conferma o annulla la proposta di un'estensione. Confermata, l'ambiente la
  // avvia una volta: la risposta arriva quando la prova è finita, e dice se è stata accesa.
  app.post<{ Params: { id: string }; Body: { esito: "confermata" | "annullata" } }>(
    "/api/estensioni/proposte/:id",
    {
      schema: {
        body: {
          type: "object",
          required: ["esito"],
          additionalProperties: false,
          properties: { esito: { type: "string", enum: ["confermata", "annullata"] } },
        },
      },
    },
    async (richiesta, risposta) => {
      const nonInAttesa = { errore: "Questa proposta non è più in attesa." };
      if (richiesta.body.esito === "annullata") {
        if (opzioni.estensioni?.annulla(richiesta.params.id) !== true) return risposta.code(404).send(nonInAttesa);
        return { annullata: true };
      }
      const esito = await opzioni.estensioni?.conferma(richiesta.params.id);
      if (esito === undefined) return risposta.code(404).send(nonInAttesa);
      return rispostaAccensione(esito, risposta);
    },
  );

  // La pagina Estensioni: accendere in un ambiente un'estensione che è già nell'elenco (anche lì
  // viene provata prima), spegnerla, toglierla, e guardare che cosa un ambiente ha già di suo.
  app.post<{ Params: { id: string; idAmbiente: string }; Body: { accesa: boolean } }>(
    "/api/estensioni/:id/ambienti/:idAmbiente",
    {
      schema: {
        body: { type: "object", required: ["accesa"], additionalProperties: false, properties: { accesa: { type: "boolean" } } },
      },
    },
    async (richiesta, risposta) => {
      const { id, idAmbiente } = richiesta.params;
      const nonTrovata = { errore: "Questa estensione non c'è più, o lì non è accesa." };
      if (!richiesta.body.accesa) {
        if ((await opzioni.estensioni?.spegni(id, idAmbiente)) !== true) return risposta.code(404).send(nonTrovata);
        return { stato: "spenta" };
      }
      const esito = await opzioni.estensioni?.accendi(id, idAmbiente);
      if (esito === undefined) return risposta.code(404).send(nonTrovata);
      return rispostaAccensione(esito, risposta);
    },
  );

  // La risposta massima di un modello locale: decide quanto contesto Claude Code tiene da parte per la compattazione.
  app.post<{ Params: { id: string }; Body: { uscita: number } }>(
    "/api/estensioni/:id/uscita",
    { schema: { body: { type: "object", required: ["uscita"], additionalProperties: false, properties: { uscita: { type: "integer" } } } } },
    async (richiesta, risposta) => {
      if (opzioni.estensioni === undefined) return risposta.code(404).send({ errore: "In questa installazione le estensioni non ci sono." });
      const motivo = await opzioni.estensioni.impostaUscita(richiesta.params.id, richiesta.body.uscita);
      if (motivo !== undefined) return risposta.code(409).send({ errore: motivo });
      return { uscita: richiesta.body.uscita };
    },
  );

  // Un modello locale in rete (ADR 0053): con un indirizzo lo usano anche le conversazioni degli altri
  // ambienti, raggiungendolo lì; senza, torna solo per la sua macchina.
  app.post<{ Params: { id: string; idAmbiente: string }; Body: { indirizzo: string | null } }>(
    "/api/estensioni/:id/ambienti/:idAmbiente/rete",
    {
      schema: {
        body: {
          type: "object",
          required: ["indirizzo"],
          additionalProperties: false,
          properties: { indirizzo: { anyOf: [{ type: "string", minLength: 1, maxLength: 255 }, { type: "null" }] } },
        },
      },
    },
    async (richiesta, risposta) => {
      if (opzioni.estensioni === undefined) return risposta.code(404).send({ errore: "In questa installazione le estensioni non ci sono." });
      const { id, idAmbiente } = richiesta.params;
      const motivo = await opzioni.estensioni.impostaInRete(id, idAmbiente, richiesta.body.indirizzo ?? undefined);
      if (motivo !== undefined) return risposta.code(409).send({ errore: motivo });
      return { inRete: richiesta.body.indirizzo !== null };
    },
  );

  // Le estensioni dell'interfaccia (ADR 0054). Una pagina si serve chiusa nel suo recinto, anche se la
  // si apre da sola; quella di una proposta, per l'anteprima dalla scheda, allo stesso modo.
  const mandaPagina = (risposta: FastifyReply, html: string | undefined): FastifyReply => {
    if (html === undefined) return risposta.code(404).send({ errore: "Pagina non trovata." });
    return risposta
      .header("Content-Type", "text/html; charset=utf-8")
      .header("Content-Security-Policy", POLITICA_PAGINA_ESTENSIONE)
      .header("Cache-Control", "no-store")
      .header("X-Content-Type-Options", "nosniff")
      // In cima la libreria del ponte (ADR 0057): la pagina la trova in window.shinka.
      .send(conLaLibreria(html));
  };
  app.get<{ Params: { id: string; idPagina: string } }>("/api/interfaccia/:id/pagine/:idPagina", async (richiesta, risposta) =>
    mandaPagina(risposta, opzioni.interfaccia?.pagina(richiesta.params.id, richiesta.params.idPagina)),
  );
  app.get<{ Params: { id: string; idPagina: string } }>("/api/interfaccia/proposte/:id/pagine/:idPagina", async (richiesta, risposta) =>
    mandaPagina(risposta, opzioni.interfaccia?.paginaProposta(richiesta.params.id, richiesta.params.idPagina)),
  );
  app.post<{ Params: { id: string }; Body: { esito: "confermata" | "annullata" } }>(
    "/api/interfaccia/proposte/:id",
    { schema: { body: { type: "object", required: ["esito"], additionalProperties: false, properties: { esito: { type: "string", enum: ["confermata", "annullata"] } } } } },
    async (richiesta, risposta) => {
      const fatto =
        richiesta.body.esito === "confermata"
          ? await opzioni.interfaccia?.conferma(richiesta.params.id)
          : opzioni.interfaccia?.annulla(richiesta.params.id);
      if (fatto !== true) return risposta.code(404).send({ errore: "Questa proposta non aspetta più una decisione." });
      return { deciso: true };
    },
  );
  app.post<{ Params: { id: string }; Body: { accesa: boolean } }>(
    "/api/interfaccia/:id",
    { schema: { body: { type: "object", required: ["accesa"], additionalProperties: false, properties: { accesa: { type: "boolean" } } } } },
    async (richiesta, risposta) => {
      if ((await opzioni.interfaccia?.accendi(richiesta.params.id, richiesta.body.accesa)) !== true) return risposta.code(404).send({ errore: "Estensione non trovata." });
      return { accesa: richiesta.body.accesa };
    },
  );
  app.delete<{ Params: { id: string } }>("/api/interfaccia/:id", async (richiesta, risposta) => {
    if ((await opzioni.interfaccia?.togli(richiesta.params.id)) !== true) return risposta.code(404).send({ errore: "Estensione non trovata." });
    return { tolta: true };
  });

  app.post<{ Params: { id: string } }>("/api/estensioni/:id/rimozione", async (richiesta, risposta) => {
    if ((await opzioni.estensioni?.rimuovi(richiesta.params.id)) !== true) {
      return risposta.code(404).send({ errore: "Questa estensione non c'è più." });
    }
    return { rimossa: true };
  });

  app.post<{ Params: { idAmbiente: string } }>("/api/estensioni/ambienti/:idAmbiente/sguardo", async (richiesta, risposta) => {
    if (opzioni.estensioni === undefined) return risposta.code(404).send({ errore: "In questa installazione le estensioni non ci sono." });
    try {
      return await opzioni.estensioni.guarda(richiesta.params.idAmbiente);
    } catch (errore) {
      return risposta.code(409).send({ errore: errore instanceof Error ? errore.message : String(errore) });
    }
  });

  app.post("/api/home/interrompi", async (richiesta) => {
    await homeDi(richiesta)?.interrompi();
    return { interrotto: true };
  });

  // Le chat parallele della Home (ADR 0052): se ne apre una con un argomento nuovo, e chiuderla
  // archivia il suo argomento, con titolo e riassunto, alla fine del turno.
  app.post("/api/home/chat", async (_richiesta, risposta) => {
    const numero = await home.apriChat();
    if (numero === undefined) return risposta.code(409).send({ errore: "Le chat della Home sono già tutte aperte: chiudine una." });
    return { numero };
  });
  app.delete<{ Params: { numero: string } }>("/api/home/chat/:numero", async (richiesta, risposta) => {
    const rifiuto = await home.chiudiChat(Number(richiesta.params.numero));
    if (rifiuto === "non-trovato") return risposta.code(404).send(CHAT_NON_APERTA);
    if (rifiuto !== undefined) return risposta.code(409).send({ errore: "Claude sta lavorando in questa chat: aspetta che finisca, o fermalo." });
    return risposta.code(202).send({ accettato: true });
  });

  // Flusso in tempo reale: prima tutta la storia dell'argomento aperto, poi gli eventi nuovi.
  // Quando l'argomento cambia arriva "azzera", seguito dalla storia di quello nuovo. Dopo ogni
  // storia arriva "storia": l'interfaccia la mostra tutta insieme, senza scorrerla davanti al proprietario.
  // Con `dopo` e `versione` chi ha già una copia della storia riprende da lì (ADR 0046).
  app.get<{ Querystring: RichiestaDiStoria }>("/api/home/eventi", (richiesta, risposta) => {
    const casa = homeDi(richiesta);
    if (casa === undefined) {
      void risposta.code(404).send(CHAT_NON_APERTA);
      return;
    }
    const flusso = apriFlusso(richiesta, risposta);
    flusso.allaChiusura(
      casa.segui(
        flusso.manda,
        () => flusso.manda({}, "azzera"),
        (indice) => flusso.manda(indice, FINE_STORIA),
        daDoveRiprendere(richiesta.query),
      ),
    );
    // Il proprietario ha aperto la Home: avviamo l'harness prima che scriva.
    casa.prepara();
  });

  // La ricerca nel testo di tutte le conversazioni: Home, argomenti archiviati e progetti.
  app.get<{ Querystring: { q?: string } }>("/api/cerca", async (richiesta) => {
    const cercato = (richiesta.query.q ?? "").slice(0, 200);
    const archiviati = await home.cercabili();
    const conversazioni: ConversazioneDaCercare[] = [
      { dove: { tipo: "home" }, titolo: "Home", storia: home.canale.archiviati },
      ...archiviati.map((voce) => ({ dove: { tipo: "argomento" as const, id: voce.id }, titolo: voce.titolo, storia: voce.storia })),
      ...lavori.stato().progetti.flatMap((progetto) => {
        const canale = lavori.canale(progetto.id);
        return canale === undefined ? [] : [{ dove: { tipo: "progetto" as const, id: progetto.id }, titolo: progetto.nome, storia: canale.archiviati }];
      }),
    ];
    return { risultati: cercaNelleConversazioni(conversazioni, cercato) };
  });

  // Una conversazione esportata in Markdown, da scaricare.
  const esporta = (risposta: FastifyReply, titolo: string, storia: readonly EventoArchiviato[]) =>
    risposta
      .type("text/markdown; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="${nomeDellEsportazione(titolo)}"`)
      .send(esportaInMarkdown(titolo, storia));
  app.get("/api/home/esporta", async (richiesta, risposta) => esporta(risposta, "Home", (homeDi(richiesta) ?? home).canale.archiviati));
  app.get<{ Params: { id: string } }>("/api/argomenti/:id/esporta", async (richiesta, risposta) => {
    const canale = await home.canaleDi(richiesta.params.id);
    const titolo = home.archiviati().find((voce) => voce.id === richiesta.params.id)?.titolo ?? "Argomento";
    return canale === undefined ? risposta.code(404).send({ errore: "Argomento non trovato." }) : esporta(risposta, titolo, canale.archiviati);
  });
  app.get<{ Params: { id: string } }>("/api/progetti/:id/esporta", async (richiesta, risposta) => {
    const canale = lavori.canale(richiesta.params.id);
    const nome = lavori.stato().progetti.find((progetto) => progetto.id === richiesta.params.id)?.nome ?? "Progetto";
    return canale === undefined ? risposta.code(404).send({ errore: "Progetto non trovato." }) : esporta(risposta, nome, canale.archiviati);
  });

  // Modificare un messaggio già mandato: prima si guarda quali file tornerebbero com'erano, poi si riparte da lì.
  const corpoModifica = {
    schema: {
      body: {
        type: "object",
        required: ["testo", "file"],
        additionalProperties: false,
        properties: { testo: { type: "string", minLength: 1, maxLength: 100_000 }, file: { type: "boolean" } },
      },
    },
  } as const;
  app.get<{ Params: { id: string } }>("/api/home/messaggi/:id/riavvolgimento", async (richiesta) =>
    (homeDi(richiesta) ?? home).anteprimaRiavvolgimento(richiesta.params.id),
  );
  app.post<{ Params: { id: string }; Body: { testo: string; file: boolean } }>("/api/home/messaggi/:id/modifica", corpoModifica, async (richiesta, risposta) => {
    const testo = richiesta.body.testo.trim();
    if (testo === "") return risposta.code(400).send({ errore: "Il messaggio è vuoto." });
    const casa = homeDi(richiesta);
    if (casa === undefined) return risposta.code(404).send(CHAT_NON_APERTA);
    const motivo = await casa.modifica(richiesta.params.id, testo, { file: richiesta.body.file });
    if (motivo !== undefined) return risposta.code(409).send({ errore: motivo });
    return risposta.code(202).send({ accettato: true });
  });
  // La scheda della sessione: la parte finale dell'uscita di un'attività, nella Home o in un progetto.
  app.get<{ Params: { idAttivita: string } }>("/api/home/attivita/:idAttivita/uscita", async (richiesta, risposta) => {
    const esito = await (homeDi(richiesta) ?? home).uscitaAttivita(richiesta.params.idAttivita);
    return "motivo" in esito ? risposta.code(409).send({ errore: esito.motivo }) : esito;
  });
  app.get<{ Params: { id: string; idAttivita: string } }>("/api/progetti/:id/attivita/:idAttivita/uscita", async (richiesta, risposta) => {
    const esito = await lavori.uscitaAttivita(richiesta.params.id, richiesta.params.idAttivita);
    return "motivo" in esito ? risposta.code(409).send({ errore: esito.motivo }) : esito;
  });

  // Il pannello Modifiche: le due versioni di un file cambiato in un turno, e le decisioni del proprietario.
  app.get<{ Params: { id: string; idTurno: string }; Querystring: { percorso?: string } }>(
    "/api/progetti/:id/modifiche/:idTurno/versioni",
    async (richiesta, risposta) => {
      const percorso = richiesta.query.percorso ?? "";
      if (percorso === "") return risposta.code(400).send({ errore: "Manca il file." });
      const esito = await lavori.versioniModificate(richiesta.params.id, richiesta.params.idTurno, percorso);
      return "motivo" in esito ? risposta.code(409).send({ errore: esito.motivo }) : esito;
    },
  );
  const corpoPercorsi = {
    schema: {
      body: {
        type: "object",
        additionalProperties: false,
        properties: { percorsi: { type: "array", maxItems: 1000, items: { type: "string", minLength: 1, maxLength: 4000 } } },
      },
    },
  } as const;
  app.post<{ Params: { id: string; idTurno: string }; Body: { percorsi?: string[] } }>(
    "/api/progetti/:id/modifiche/:idTurno/annulla",
    corpoPercorsi,
    async (richiesta, risposta) => {
      const esito = await lavori.annullaModifiche(richiesta.params.id, richiesta.params.idTurno, richiesta.body?.percorsi);
      return "motivo" in esito ? risposta.code(409).send({ errore: esito.motivo }) : esito;
    },
  );

  // Il messaggio modificato parte in un argomento nuovo, che ha la storia fino a lì; quello aperto viene archiviato.
  app.post<{ Params: { id: string }; Body: { testo: string } }>(
    "/api/home/messaggi/:id/ramo",
    {
      schema: {
        body: {
          type: "object",
          required: ["testo"],
          additionalProperties: false,
          properties: { testo: { type: "string", minLength: 1, maxLength: 100_000 } },
        },
      },
    },
    async (richiesta, risposta) => {
      const testo = richiesta.body.testo.trim();
      if (testo === "") return risposta.code(400).send({ errore: "Il messaggio è vuoto." });
      const casa = homeDi(richiesta);
      if (casa === undefined) return risposta.code(404).send(CHAT_NON_APERTA);
      const motivo = await casa.ramoDa(richiesta.params.id, testo);
      if (motivo !== undefined) return risposta.code(409).send({ errore: motivo });
      return risposta.code(202).send({ accettato: true });
    },
  );
  app.get<{ Params: { id: string; idMessaggio: string } }>("/api/progetti/:id/messaggi/:idMessaggio/riavvolgimento", async (richiesta) =>
    lavori.anteprimaRiavvolgimento(richiesta.params.id, richiesta.params.idMessaggio),
  );
  app.post<{ Params: { id: string; idMessaggio: string }; Body: { testo: string; file: boolean } }>(
    "/api/progetti/:id/messaggi/:idMessaggio/modifica",
    corpoModifica,
    async (richiesta, risposta) => {
      const testo = richiesta.body.testo.trim();
      if (testo === "") return risposta.code(400).send({ errore: "Il messaggio è vuoto." });
      const motivo = await lavori.modifica(richiesta.params.id, richiesta.params.idMessaggio, testo, { file: richiesta.body.file });
      if (motivo !== undefined) return risposta.code(409).send({ errore: motivo });
      return risposta.code(202).send({ accettato: true });
    },
  );

  // Un'azione per intero: nella storia l'interfaccia ne ha solo un riassunto, e la chiede quando il proprietario la apre.
  app.get<{ Params: { idAzione: string } }>("/api/home/azioni/:idAzione", async (richiesta, risposta) => {
    const intera = azioneIntera((homeDi(richiesta) ?? home).canale.archiviati, richiesta.params.idAzione);
    return intera ?? risposta.code(404).send({ errore: "Azione non trovata." });
  });

  // Il proprietario chiude l'argomento aperto e ne comincia uno nuovo.
  app.post("/api/home/argomento-nuovo", async (richiesta, risposta) => {
    const casa = homeDi(richiesta);
    if (casa === undefined) return risposta.code(404).send(CHAT_NON_APERTA);
    const rifiuto = await casa.nuovoArgomento();
    if (rifiuto !== undefined) return risposta.code(409).send({ errore: ERRORI_PASSAGGIO[rifiuto] });
    return risposta.code(202).send({ accettato: true });
  });

  // La storia di un argomento, anche archiviato: si rilegge, non ci si scrive.
  app.get<{ Params: { id: string }; Querystring: RichiestaDiStoria }>("/api/argomenti/:id/eventi", async (richiesta, risposta) => {
    const canale = await home.canaleDi(richiesta.params.id);
    if (canale === undefined) return risposta.code(404).send({ errore: "Argomento non trovato." });
    seguiDaDove(canale, apriFlusso(richiesta, risposta), daDoveRiprendere(richiesta.query));
    return risposta;
  });

  // Un pezzo della storia di un argomento, aperto o archiviato, dopo un evento: per chi ne tiene una
  // copia. Di sola lettura: non prepara nulla e non conta come pagina che segue (ADR 0046).
  app.get<{ Params: { id: string }; Querystring: RichiestaDiStoria }>("/api/argomenti/:id/storia", async (richiesta, risposta) => {
    const canale = await home.canaleDi(richiesta.params.id);
    if (canale === undefined) return risposta.code(404).send({ errore: "Argomento non trovato." });
    return canale.storiaDopo(pezzoChiesto(richiesta.query));
  });

  app.get<{ Params: { id: string; idAzione: string } }>("/api/argomenti/:id/azioni/:idAzione", async (richiesta, risposta) => {
    const canale = await home.canaleDi(richiesta.params.id);
    const intera = canale === undefined ? undefined : azioneIntera(canale.archiviati, richiesta.params.idAzione);
    return intera ?? risposta.code(404).send({ errore: "Azione non trovata." });
  });

  app.get<{ Params: { id: string; idImmagine: string } }>(
    "/api/argomenti/:id/immagini/:idImmagine",
    (richiesta, risposta) => mandaImmagine(risposta, immagini.trova(CUSTODIA_HOME, richiesta.params.idImmagine)),
  );

  // ── HTTPS ─────────────────────────────────────────────────────────────────

  // Il certificato da installare su iPhone e PC, con le istruzioni: si legge prima dell'accesso.
  const ca = certificati?.ca;
  app.get(PERCORSO_CERTIFICATO, async (richiesta, risposta) =>
    risposta.type("text/html; charset=utf-8").send(paginaDelCertificato(ca, opzioni.https === undefined ? [] : indirizziHttps(opzioni.https, richiesta.headers.host))),
  );
  app.get(`${PERCORSO_CERTIFICATO}/shinka-ca.crt`, async (_richiesta, risposta) => {
    if (ca === undefined) return risposta.code(404).send({ errore: "In questa installazione Shinka non ha una sua CA." });
    return risposta
      .header("Content-Type", "application/x-x509-ca-cert")
      .header("Content-Disposition", 'attachment; filename="shinka-ca.crt"')
      .send(ca.der);
  });
  app.get(`${PERCORSO_CERTIFICATO}/shinka.mobileconfig`, async (_richiesta, risposta) => {
    if (ca === undefined) return risposta.code(404).send({ errore: "In questa installazione Shinka non ha una sua CA." });
    return risposta
      .header("Content-Type", "application/x-apple-aspen-config")
      .header("Content-Disposition", 'attachment; filename="shinka.mobileconfig"')
      .send(profiloApple(ca));
  });

  // Com'è l'HTTPS, e la scelta per il prossimo avvio.
  app.get("/api/https", async (richiesta, risposta) => {
    if (opzioni.https === undefined) return risposta.code(404).send({ errore: "In questa installazione l'HTTPS non si gestisce da qui." });
    return statoHttps(opzioni.https, richiesta.headers.host);
  });
  app.post<{ Body: { attivo: boolean; nomi: string[]; reindirizza: boolean; riparti?: boolean } }>(
    "/api/https",
    {
      schema: {
        body: {
          type: "object",
          required: ["attivo", "nomi", "reindirizza"],
          additionalProperties: false,
          properties: {
            attivo: { type: "boolean" },
            nomi: { type: "array", maxItems: 10, items: { type: "string", maxLength: 253 } },
            reindirizza: { type: "boolean" },
            riparti: { type: "boolean" },
          },
        },
      },
    },
    async (richiesta, risposta) => {
      const https = opzioni.https;
      if (https === undefined) return risposta.code(404).send({ errore: "In questa installazione l'HTTPS non si gestisce da qui." });
      const sbagliati = richiesta.body.nomi.map((nome) => nome.trim()).filter((nome) => nome !== "" && !nomeValido(nome));
      if (sbagliati.length > 0) {
        return risposta.code(400).send({
          errore:
            `Non vanno nel certificato: ${sbagliati.join(", ")}. Scrivi l'indirizzo del server nella rete di casa, ` +
            "quello che apri nel browser (per esempio 192.168.1.20), o il nome della macchina. " +
            "0.0.0.0 e gli indirizzi pubblici non possono starci.",
        });
      }
      https.scelta = salvaSceltaHttps(https.dati, richiesta.body);
      const riparte = richiesta.body.riparti === true && https.riavvia !== undefined;
      if (riparte) {
        // Prima la risposta, poi la ripartenza: il guardiano la riaccende con la scelta nuova.
        risposta.raw.once("finish", () => setTimeout(() => https.riavvia?.(), 300));
      }
      return { ...statoHttps(https, richiesta.headers.host), riparte };
    },
  );

  // Gli elaborati definitivi di tutti gli argomenti: quelli che la Home ha mostrato al proprietario.
  app.get("/api/elaborati", async () => ({ elaborati: (await opzioni.elaborati?.consegnati()) ?? [] }));

  // Gli elaborati di un argomento, aperto o archiviato, ambiente per ambiente.
  app.get<{ Params: { id: string } }>("/api/argomenti/:id/elaborati", async (richiesta, risposta) => {
    if (opzioni.elaborati === undefined) return { idArgomento: richiesta.params.id, ambienti: [] };
    const elenco = await opzioni.elaborati.elenca(richiesta.params.id);
    if (elenco === undefined) return risposta.code(404).send({ errore: "Argomento non trovato." });
    return elenco;
  });

  // Un elaborato così com'è, per il pannello: un'immagine, un testo, una pagina in un riquadro.
  app.get<{ Params: { id: string }; Querystring: { ambiente?: string; percorso?: string; scarica?: string } }>(
    "/api/argomenti/:id/elaborati/file",
    async (richiesta, risposta) => {
      const { ambiente, percorso, scarica } = richiesta.query;
      if (opzioni.elaborati === undefined) return risposta.code(404).send({ errore: "Elaborato non trovato." });
      if (typeof ambiente !== "string" || typeof percorso !== "string") {
        return risposta.code(400).send({ errore: "Servono l'ambiente e il percorso." });
      }
      const letto = await opzioni.elaborati.leggi(richiesta.params.id, ambiente, percorso);
      if (!("dati" in letto)) return risposta.code(letto.codice).send({ errore: letto.problema });
      const nome = percorso.split("/").pop() ?? "elaborato";
      const daScaricare = scarica !== undefined || genereDi(percorso) === "altro";
      return risposta
        .header("Content-Type", tipoMimeDi(percorso))
        .header("Content-Security-Policy", POLITICA_ELABORATO)
        .header("Cache-Control", "private, no-cache")
        .header(
          "Content-Disposition",
          `${daScaricare ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(nome)}`,
        )
        .send(letto.dati);
    },
  );

  // Un elaborato vivo si rifà con il suo comando, quando il proprietario preme "Aggiorna".
  const corpoElaborato = {
    schema: {
      body: {
        type: "object",
        required: ["ambiente", "percorso"],
        additionalProperties: false,
        properties: {
          ambiente: { type: "string", minLength: 1, maxLength: 200 },
          percorso: { type: "string", minLength: 1, maxLength: 1000 },
          contenuto: { type: "string", maxLength: 2_000_000 },
        },
      },
    },
  } as const;
  app.post<{ Params: { id: string }; Body: { ambiente: string; percorso: string } }>(
    "/api/argomenti/:id/elaborati/aggiorna",
    corpoElaborato,
    async (richiesta, risposta) => {
      if (opzioni.elaborati === undefined) return risposta.code(404).send({ errore: "Elaborato non trovato." });
      const esito = await opzioni.elaborati.aggiorna(richiesta.params.id, richiesta.body.ambiente, richiesta.body.percorso);
      return "problema" in esito ? risposta.code(esito.codice).send({ errore: esito.problema }) : esito;
    },
  );

  // Il proprietario riscrive a mano un elaborato di testo.
  app.put<{ Params: { id: string }; Body: { ambiente: string; percorso: string; contenuto?: string } }>(
    "/api/argomenti/:id/elaborati/file",
    { ...corpoElaborato, bodyLimit: 2_500_000 },
    async (richiesta, risposta) => {
      if (opzioni.elaborati === undefined) return risposta.code(404).send({ errore: "Elaborato non trovato." });
      const { ambiente, percorso, contenuto } = richiesta.body;
      if (contenuto === undefined) return risposta.code(400).send({ errore: "Manca il testo." });
      const problema = await opzioni.elaborati.scrivi(richiesta.params.id, ambiente, percorso, contenuto);
      return problema === undefined ? { salvato: true } : risposta.code(problema.codice).send({ errore: problema.problema });
    },
  );

  // Il proprietario riprende un argomento archiviato: quello aperto viene archiviato al suo posto.
  app.post<{ Params: { id: string } }>("/api/argomenti/:id/riapertura", async (richiesta, risposta) => {
    const rifiuto = await home.riapri(richiesta.params.id);
    if (rifiuto === "non-trovato") return risposta.code(404).send({ errore: ERRORI_PASSAGGIO[rifiuto] });
    if (rifiuto !== undefined) return risposta.code(409).send({ errore: ERRORI_PASSAGGIO[rifiuto] });
    return risposta.code(202).send({ accettato: true });
  });

  // Flusso del quadro: ambienti, progetti e argomenti come stanno ora, poi ogni cambiamento.
  // Uno solo per tutti, perché un browser tiene aperti pochi collegamenti verso lo stesso sito.
  app.get("/api/quadro/eventi", (richiesta, risposta) => {
    const flusso = apriFlusso(richiesta, risposta);
    flusso.allaChiusura(ambienti.iscrivi((stato) => flusso.manda(stato, "ambienti")));
    flusso.allaChiusura(lavori.iscrivi((stato) => flusso.manda(stato, "progetti")));
    // Gli argomenti e la Home con l'indice dei loro archivi (ADR 0046).
    const mandaArgomenti = (): void => flusso.manda(home.conIndici(argomenti.stato()), "argomenti");
    // La condizione della Home e quella delle sue chat parallele: si rimanda solo quando cambia.
    let ultimaHome = "";
    const mandaHome = (): void => {
      const chat = home.condizioniDelleChat();
      const vista = {
        condizione: home.condizione,
        complessiva: home.condizioneComplessiva,
        argomento: { id: home.idArgomentoAperto, ...home.canale.indice },
        ...(chat.length === 0 ? {} : { chat }),
      };
      const testo = JSON.stringify(vista);
      if (testo === ultimaHome) return;
      ultimaHome = testo;
      flusso.manda(vista, "home");
    };
    flusso.allaChiusura(argomenti.iscrivi(mandaArgomenti));
    // Anche la Home dice se lavora o se aspetta il proprietario, come i progetti nella barra laterale.
    flusso.allaChiusura(home.iscriviCondizione(mandaHome));
    flusso.allaChiusura(home.suiCambi(mandaHome));
    // Un passaggio di argomento cambia gli archivi dopo che l'elenco è già partito: si rimanda.
    flusso.allaChiusura(
      home.dopoIPassaggi(() => {
        mandaArgomenti();
        mandaHome();
      }),
    );
    flusso.allaChiusura(memoria.iscrivi((stato) => flusso.manda(stato, "memoria")));
    flusso.allaChiusura(skill.iscrivi((stato) => flusso.manda(stato, "skill")));
    if (opzioni.estensioni !== undefined) {
      flusso.allaChiusura(opzioni.estensioni.iscrivi((stato) => flusso.manda(stato, "estensioni")));
    }
    if (opzioni.interfaccia !== undefined) {
      flusso.allaChiusura(opzioni.interfaccia.iscrivi((stato) => flusso.manda(stato, "interfaccia")));
    }
    if (opzioni.gateway !== undefined) {
      flusso.allaChiusura(opzioni.gateway.iscrivi((breve) => flusso.manda(breve, "vault")));
    }
    if (opzioni.anteprime !== undefined) {
      flusso.allaChiusura(opzioni.anteprime.iscrivi((stato) => flusso.manda(stato, "anteprima")));
    }
  });

  // Il vault: il centro riferisce ciò che il gateway gli dice, cioè nomi, host e registro.
  // Frase di sblocco e valori non passano di qui: il proprietario li scrive nella pagina del gateway.
  app.get("/api/vault", async (): Promise<DettaglioVault> => {
    if (opzioni.gateway === undefined) return { gateway: "non-configurato", credenziali: [], registro: [] };
    const [stato, registro, telegram] = await Promise.all([
      opzioni.gateway.stato(),
      opzioni.gateway.registro(),
      opzioni.gateway.telegramStato(),
    ]);
    return { ...stato, registro, telegram };
  });

  // La memoria: il proprietario aggiunge, corregge e cancella le voci. L'elenco arriva dal flusso del quadro.
  const rispostaVoce = async (
    risposta: FastifyReply,
    lavoro: () => Promise<unknown>,
  ): Promise<unknown> => {
    try {
      const voce = await lavoro();
      if (voce === undefined) return await risposta.code(404).send({ errore: "Questa voce non c'è più." });
      return { voce };
    } catch (errore) {
      if (errore instanceof VoceRifiutata) return risposta.code(400).send({ errore: errore.message });
      throw errore;
    }
  };

  app.post<{ Body: { testo: string } }>("/api/memoria", { schema: { body: CORPO_VOCE } }, (richiesta, risposta) =>
    rispostaVoce(risposta, () => memoria.annota(richiesta.body.testo)),
  );

  app.post<{ Params: { id: string }; Body: { testo: string } }>(
    "/api/memoria/:id",
    { schema: { body: CORPO_VOCE } },
    (richiesta, risposta) => rispostaVoce(risposta, () => memoria.correggi(richiesta.params.id, richiesta.body.testo)),
  );

  app.post<{ Params: { id: string } }>("/api/memoria/:id/cancellazione", async (richiesta, risposta) => {
    if (!(await memoria.cancella(richiesta.params.id))) {
      return risposta.code(404).send({ errore: "Questa voce non c'è più." });
    }
    return { cancellata: true };
  });

  // Le skill: il proprietario ne vede il testo e la storia, e annulla una modifica.
  app.get<{ Params: { nome: string } }>("/api/skill/:nome", async (richiesta, risposta) => {
    const dettaglio = await skill.leggi(richiesta.params.nome);
    if (dettaglio === undefined) return risposta.code(404).send({ errore: "Skill non trovata." });
    return dettaglio;
  });

  app.get<{ Params: { nome: string; id: string } }>("/api/skill/:nome/modifiche/:id", async (richiesta, risposta) => {
    const versioni = await skill.versioni(richiesta.params.nome, richiesta.params.id);
    if (versioni === undefined) return risposta.code(404).send({ errore: "Modifica non trovata." });
    return versioni;
  });

  app.post<{ Params: { nome: string; id: string } }>(
    "/api/skill/:nome/modifiche/:id/annullamento",
    async (richiesta, risposta) => {
      const annullata = await skill.annulla(richiesta.params.nome, richiesta.params.id, ORIGINE_PROPRIETARIO);
      if (!annullata) return risposta.code(404).send({ errore: "Modifica non trovata." });
      return { annullata: true };
    },
  );

  app.post<{ Params: { id: string }; Body: { decisione: DecisionePermesso } }>(
    "/api/ambienti/richieste/:id",
    {
      schema: {
        body: {
          type: "object",
          required: ["decisione"],
          additionalProperties: false,
          properties: { decisione: { type: "string", enum: ["approvato", "negato"] } },
        },
      },
    },
    async (richiesta, risposta) => {
      const trovata = await ambienti.decidi(richiesta.params.id, richiesta.body.decisione);
      if (!trovata) {
        return risposta.code(404).send({ errore: "Questa richiesta non è più in attesa." });
      }
      return { deciso: true };
    },
  );

  // I lavori programmati: li crea, li cambia, li ferma e li toglie il proprietario, dalla loro pagina.
  // Il browser dice ogni volta il suo fuso: gli orari valgono lì.
  const conIProgrammati = async (risposta: FastifyReply, lavoro: (programmati: LavoriProgrammati) => unknown): Promise<unknown> => {
    if (opzioni.programmati === undefined) return risposta.code(404).send({ errore: "In questa installazione di Shinka i lavori programmati non ci sono." });
    try {
      const esito = await lavoro(opzioni.programmati);
      if (esito === undefined) return await risposta.code(404).send({ errore: "Questo lavoro programmato non c'è più." });
      return esito;
    } catch (errore) {
      if (errore instanceof ProgrammatoRifiutato) return risposta.code(400).send({ errore: errore.message });
      throw errore;
    }
  };
  const CORPO_PROGRAMMATO = { type: "object", additionalProperties: true, properties: { fuso: { type: "string", maxLength: 64 } } } as const;

  app.get<{ Querystring: { fuso?: string } }>("/api/programmati", (richiesta, risposta) =>
    conIProgrammati(risposta, (programmati) => {
      programmati.impostaFuso(richiesta.query.fuso);
      return programmati.stato();
    }),
  );

  app.post<{ Body: Record<string, unknown> }>("/api/programmati", { schema: { body: CORPO_PROGRAMMATO } }, (richiesta, risposta) =>
    conIProgrammati(risposta, (programmati) => {
      programmati.impostaFuso(richiesta.body.fuso);
      return { lavoro: programmati.crea(richiesta.body, ORIGINE_PROPRIETARIO) };
    }),
  );

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>("/api/programmati/:id", { schema: { body: CORPO_PROGRAMMATO } }, (richiesta, risposta) =>
    conIProgrammati(risposta, (programmati) => {
      programmati.impostaFuso(richiesta.body.fuso);
      const lavoro = programmati.cambia(richiesta.params.id, richiesta.body);
      return lavoro === undefined ? undefined : { lavoro };
    }),
  );

  app.post<{ Params: { id: string } }>("/api/programmati/:id/esecuzione", (richiesta, risposta) =>
    conIProgrammati(risposta, async (programmati) => {
      const motivo = await programmati.eseguiAdesso(richiesta.params.id);
      if (motivo !== undefined) throw new ProgrammatoRifiutato(motivo);
      return { avviato: true };
    }),
  );

  app.post<{ Params: { id: string } }>("/api/programmati/:id/rimozione", (richiesta, risposta) =>
    conIProgrammati(risposta, (programmati) => (programmati.togli(richiesta.params.id) ? { rimosso: true } : undefined)),
  );

  // Le notifiche dell'app: ogni dispositivo si iscrive dalla pagina Impostazioni, con la chiave
  // pubblica del centro; da lì si prova, si toglie un dispositivo, si cambia il contatto dichiarato.
  const conLeNotifiche = async (risposta: FastifyReply, lavoro: (notifiche: NotificheApp) => unknown): Promise<unknown> => {
    if (opzioni.notifiche === undefined) return risposta.code(404).send({ errore: "In questa installazione di Shinka le notifiche dell'app non ci sono." });
    try {
      return await lavoro(opzioni.notifiche);
    } catch (errore) {
      if (errore instanceof NotificaRifiutata) return risposta.code(400).send({ errore: errore.message });
      throw errore;
    }
  };
  const CORPO_LIBERO = { type: "object", additionalProperties: true } as const;

  app.get("/api/notifiche", (_richiesta, risposta) => conLeNotifiche(risposta, (notifiche) => notifiche.stato()));

  app.post<{ Body: { iscrizione?: unknown; nome?: unknown } }>("/api/notifiche/iscrizioni", { bodyLimit: 8192, schema: { body: CORPO_LIBERO } }, (richiesta, risposta) =>
    conLeNotifiche(risposta, (notifiche) => ({ dispositivo: notifiche.iscrivi(richiesta.body.iscrizione, richiesta.body.nome) })),
  );

  app.post<{ Body: { endpoint?: unknown } }>("/api/notifiche/iscrizioni/rimozione", { bodyLimit: 4096, schema: { body: CORPO_LIBERO } }, (richiesta, risposta) =>
    conLeNotifiche(risposta, (notifiche) => ({ rimosso: notifiche.togli(richiesta.body.endpoint) })),
  );

  app.post<{ Body: { contatto?: unknown } }>("/api/notifiche/contatto", { bodyLimit: 4096, schema: { body: CORPO_LIBERO } }, (richiesta, risposta) =>
    conLeNotifiche(risposta, (notifiche) => {
      notifiche.impostaContatto(richiesta.body.contatto);
      return notifiche.stato();
    }),
  );

  // La pagina Sicurezza: le sessioni aperte e il registro di chi è entrato o ci ha provato.
  app.get<{ Querystring: { solo?: string } }>("/api/sicurezza", async (richiesta) => ({
    questa: accesso.idDi(richiesta.cookies[COOKIE_SESSIONE]),
    dispositivi: accesso.dispositivi(),
    ...(accesso.idDelDispositivo(gettoneDi(richiesta.headers.authorization)) === undefined
      ? {}
      : { questoDispositivo: accesso.idDelDispositivo(gettoneDi(richiesta.headers.authorization)) }),
    nodi: { soloCifrati: ambienti.soloCifrati, ...(perINodi === undefined ? {} : { impronta: perINodi.impronta }) },
    sessioni: accesso.sessioni(),
    voci: registroAccessi.ultime(300, richiesta.query.solo === "da-guardare"),
  }));

  // Chiudere una sessione fa uscire quel browser: dovrà rientrare con la password.
  app.post<{ Params: { id: string } }>("/api/sicurezza/sessioni/:id/chiusura", async (richiesta, risposta) => {
    if (!(await accesso.chiudiSessione(richiesta.params.id))) return risposta.code(404).send({ errore: "Questa sessione non c'è più." });
    registroAccessi.annota("sessione-chiusa", chiDi(richiesta), { dettaglio: "una, dalla pagina Sicurezza" });
    return { chiusa: true };
  });

  // Togliere un dispositivo: il suo gettone non vale più, e dovrà rientrare con la password.
  app.post<{ Params: { id: string } }>("/api/sicurezza/dispositivi/:id/chiusura", async (richiesta, risposta) => {
    if (!(await accesso.togliDispositivo(richiesta.params.id))) return risposta.code(404).send({ errore: "Questo dispositivo non c'è più." });
    registroAccessi.annota("dispositivo-tolto", chiDi(richiesta), { dettaglio: "dalla pagina Sicurezza" });
    return { tolto: true };
  });

  app.post("/api/sicurezza/chiusura-delle-altre", async (richiesta) => {
    const chiuse = await accesso.chiudiLeAltre(richiesta.cookies[COOKIE_SESSIONE]);
    if (chiuse > 0) registroAccessi.annota("sessione-chiusa", chiDi(richiesta), { dettaglio: `tutte le altre (${chiuse})` });
    return { chiuse };
  });

  // Che cosa arriva come notifica dell'app, e che cosa su Telegram.
  app.post<{ Body: { scelte?: unknown } }>("/api/notifiche/scelte", { bodyLimit: 4096, schema: { body: CORPO_LIBERO } }, (richiesta, risposta) =>
    conLeNotifiche(risposta, (notifiche) => {
      notifiche.impostaScelte(richiesta.body.scelte);
      return notifiche.stato();
    }),
  );

  // Una notifica di prova: a un dispositivo, o a tutti. Dice com'è andata con ciascuno.
  app.post<{ Body: { endpoint?: unknown } }>("/api/notifiche/prova", { bodyLimit: 4096, schema: { body: CORPO_LIBERO } }, (richiesta, risposta) =>
    conLeNotifiche(risposta, async (notifiche) => ({
      esiti: await notifiche.manda(
        { titolo: "Shinka", corpo: "Prova riuscita: le notifiche arrivano su questo dispositivo." },
        typeof richiesta.body.endpoint === "string" ? richiesta.body.endpoint : undefined,
      ),
    })),
  );

  // Gli eventi in ingresso: un altro sistema (il server, il firewall, un monitor) manda un avviso
  // all'indirizzo di un lavoro programmato, con la sua chiave. Qualunque cosa mandi è testo da
  // leggere: il centro non lo interpreta, e alla conversazione arriva come materiale.
  await app.register(async (ambito) => {
    ambito.removeAllContentTypeParsers();
    ambito.addContentTypeParser("*", { parseAs: "string", bodyLimit: EVENTO_MASSIMO * 4 }, (_richiesta, corpo, fatto) => fatto(null, corpo));
    const ricevi = async (richiesta: FastifyRequest<{ Querystring: { chiave?: string } }>, risposta: FastifyReply): Promise<unknown> => {
      if (opzioni.programmati === undefined) return risposta.code(404).send({ errore: "Indirizzo sconosciuto." });
      const intestazione = richiesta.headers.authorization;
      const chiave = richiesta.query.chiave ?? (intestazione?.startsWith("Bearer ") === true ? intestazione.slice(7) : undefined);
      const esito = opzioni.programmati.ricevi(chiave, typeof richiesta.body === "string" ? richiesta.body : "");
      // La chiave sta nell'indirizzo: nel registro va solo il percorso.
      registroAccessi.annota(esito === "accolto" ? "evento-accolto" : "evento-rifiutato", chiDi(richiesta), esito === "accolto" ? {} : { dettaglio: { sconosciuto: "indirizzo sconosciuto", "in-pausa": "lavoro in pausa", troppi: "troppi eventi" }[esito] });
      if (esito === "accolto") return risposta.code(202).send({ accolto: true });
      if (esito === "troppi") return risposta.code(429).send({ errore: "Troppi eventi: riprova più tardi." });
      if (esito === "in-pausa") return risposta.code(409).send({ errore: "Questo lavoro è in pausa: l'evento non è stato accolto." });
      return risposta.code(404).send({ errore: "Indirizzo sconosciuto." });
    };
    ambito.post<{ Querystring: { chiave?: string } }>(PERCORSO_EVENTI, { bodyLimit: EVENTO_MASSIMO * 4 }, ricevi);
    ambito.put<{ Querystring: { chiave?: string } }>(PERCORSO_EVENTI, { bodyLimit: EVENTO_MASSIMO * 4 }, ricevi);
  });

  // La pagina di un ambiente: come stanno le sue risorse adesso. La pagina lo chiede ogni pochi secondi, finché è aperta.
  app.get<{ Params: { id: string } }>("/api/ambienti/:id/risorse", async (richiesta, risposta) => {
    if (opzioni.risorse === undefined) return risposta.code(404).send({ errore: "In questa installazione di Shinka la pagina degli ambienti non c'è." });
    if (!ambienti.stato().ambienti.some((ambiente) => ambiente.id === richiesta.params.id)) return risposta.code(404).send({ errore: "Ambiente non trovato." });
    return opzioni.risorse.leggi(richiesta.params.id);
  });

  // Un processo acceso da Shinka in un ambiente, bloccato: il proprietario lo termina dalla pagina dell'ambiente.
  app.post<{ Params: { id: string; pid: string } }>("/api/ambienti/:id/processi/:pid/termina", async (richiesta, risposta) => {
    if (opzioni.risorse === undefined) return risposta.code(404).send({ errore: "In questa installazione di Shinka la pagina degli ambienti non c'è." });
    const pid = Number(richiesta.params.pid);
    if (!Number.isInteger(pid) || pid <= 0) return risposta.code(400).send({ errore: "Il processo non è indicato bene." });
    const esito = await opzioni.risorse.termina(richiesta.params.id, pid);
    return esito.riuscita ? esito : risposta.code(409).send({ errore: esito.testo });
  });

  // Il proprietario chiede a un nodo rimasto indietro di passare alla versione del centro.
  app.post<{ Params: { id: string } }>("/api/ambienti/:id/aggiornamento", async (richiesta, risposta) => {
    if (opzioni.aggiornamenti === undefined) {
      return risposta.code(404).send({ errore: "In questa installazione di Shinka i nodi non si aggiornano dal centro." });
    }
    const esito = await opzioni.aggiornamenti.aggiorna(richiesta.params.id);
    if (!esito.avviato) return risposta.code(409).send({ errore: esito.motivo });
    return { avviato: true };
  });

  // Un nodo Windows parte a ogni accesso, oppure no: lo sceglie il proprietario dalla pagina degli ambienti.
  const avvioConWindows = new AvvioConWindows(ambienti);
  app.post<{ Params: { id: string }; Body: { attivo: boolean } }>(
    "/api/ambienti/:id/avvio-con-windows",
    { schema: { body: { type: "object", required: ["attivo"], additionalProperties: false, properties: { attivo: { type: "boolean" } } } } },
    async (richiesta, risposta) => {
      const esito = await avvioConWindows.imposta(richiesta.params.id, richiesta.body.attivo);
      return "motivo" in esito ? risposta.code(409).send({ errore: esito.motivo }) : esito;
    },
  );

  // Il ponte di un ambiente per le macchine che non vedono il centro (ADR 0058): lo accende e lo spegne il proprietario.
  ambienti.iscriviRiferiti((idNodo, messaggio) => {
    if (messaggio.tipo === "ponte-esito") ambienti.segnaPonte(idNodo, { ...(messaggio.porta === undefined ? {} : { porta: messaggio.porta }), ...(messaggio.motivo === undefined ? {} : { motivo: messaggio.motivo }) });
  });
  app.post<{ Params: { id: string }; Body: { porta: number | null } }>(
    "/api/ambienti/:id/ponte",
    { schema: { body: { type: "object", required: ["porta"], additionalProperties: false, properties: { porta: { type: ["integer", "null"], minimum: 1024, maximum: 65535 } } } } },
    async (richiesta, risposta) => {
      if (richiesta.params.id === ID_AMBIENTE_DEL_CENTRO) return risposta.code(409).send({ errore: "Il centro non fa da ponte a sé stesso: il ponte lo fa un nodo." });
      const fatto = await ambienti.impostaPonte(richiesta.params.id, richiesta.body.porta ?? undefined);
      if (!fatto) return risposta.code(404).send({ errore: "Ambiente non trovato." });
      return { porta: richiesta.body.porta };
    },
  );

  // Un ambiente nuovo con un comando di una riga: il proprietario sceglie sistema e nome, il centro dà il comando.
  const inviti = opzioni.inviti ?? new InvitiDegliAmbienti(perINodi === undefined ? {} : { certificato: perINodi });
  app.post<{ Body: { sistema: string; centro: string; nome: string; descrizione?: string } }>(
    "/api/ambienti/inviti",
    {
      schema: {
        body: {
          type: "object",
          required: ["sistema", "centro", "nome"],
          additionalProperties: false,
          properties: {
            sistema: { type: "string", enum: ["linux", "windows"] },
            centro: { type: "string", maxLength: 300 },
            nome: { type: "string", maxLength: 200 },
            descrizione: { type: "string", maxLength: 1000 },
          },
        },
      },
    },
    async (richiesta, risposta) => {
      if (opzioni.installata === undefined) return risposta.code(404).send({ errore: "Questa installazione non sa preparare un ambiente." });
      try {
        return inviti.crea(richiesta.body);
      } catch (errore) {
        return risposta.code(400).send({ errore: errore instanceof Error ? errore.message : String(errore) });
      }
    },
  );

  // Lo script che il comando di una riga scarica ed esegue: vale con un invito non scaduto.
  app.get<{ Querystring: { invito?: string } }>(PERCORSO_PREPARAZIONE, async (richiesta, risposta) => {
    const invito = inviti.valido(richiesta.query.invito);
    if (invito === undefined) registroAccessi.annota("invito-rifiutato", chiDi(richiesta));
    else registroAccessi.annota("ambiente-preparato", chiDi(richiesta), { dettaglio: `«${invito.nome}»` });
    if (invito === undefined) {
      const avviso = "L'invito non vale più: prepara un comando nuovo dalla pagina Ambienti di Shinka.";
      // Il testo arriva a bash o a PowerShell, che lo eseguono: deve solo dire che cosa fare. Con un
      // codice di errore curl e irm non lo mostrerebbero.
      return risposta.header("Content-Type", "text/plain; charset=utf-8").send(`echo "${avviso}"\n`);
    }
    return risposta
      .header("Content-Type", "text/plain; charset=utf-8")
      .header("Cache-Control", "no-store")
      .send(await scriptDiPreparazione(invito, inviti.certificato));
  });

  // Il nodo e il suo guardiano, per lo script: la versione in funzione al centro.
  app.get<{ Querystring: { invito?: string } }>(PERCORSO_PACCHETTO_NODO, async (richiesta, risposta) => {
    if (inviti.valido(richiesta.query.invito) === undefined) return risposta.code(403).send({ errore: "L'invito non vale più." });
    if (opzioni.installata === undefined) return risposta.code(404).send({ errore: "Questa installazione non sa preparare un ambiente." });
    try {
      const pacchetto = await pacchettoDelNodo(opzioni.installata);
      return risposta
        .header("Content-Type", "application/gzip")
        .header("Content-Disposition", `attachment; filename="${pacchetto.nome}"`)
        .header("Cache-Control", "no-store")
        .send(pacchetto.dati);
    } catch (errore) {
      return risposta.code(409).send({ errore: errore instanceof Error ? errore.message : String(errore) });
    }
  });

  app.post<{ Params: { id: string } }>("/api/ambienti/:id/rimozione", async (richiesta, risposta) => {
    const trovato = await ambienti.rimuovi(richiesta.params.id);
    if (!trovato) return risposta.code(404).send({ errore: "Ambiente non trovato." });
    return { rimosso: true };
  });

  // Il proprietario decide su una proposta della Home. Solo con la conferma nasce il progetto.
  app.post<{ Params: { id: string }; Body: { esito: "confermata" | "annullata" } & ConfermaProposta }>(
    "/api/proposte/:id",
    {
      schema: {
        body: {
          type: "object",
          required: ["esito"],
          additionalProperties: false,
          properties: {
            esito: { type: "string", enum: ["confermata", "annullata"] },
            nome: { type: "string", minLength: 1, maxLength: 60 },
            idAmbiente: { type: "string", minLength: 1, maxLength: 64 },
            portaFile: { type: "boolean" },
            cartellaEsistente: { type: "string", maxLength: 1000 },
            motore: { enum: [...MOTORI, null] },
            modello: { type: ["string", "null"], maxLength: 100 },
            impegno: { enum: [...IMPEGNI, null] },
            permessi: { enum: [...MODI_PERMESSI] },
            estensioni: { type: "array", maxItems: 50, uniqueItems: true, items: { type: "string", minLength: 1, maxLength: 64 } },
            skillDiPartenza: { enum: [...SKILL_DI_PARTENZA, null] },
          },
        },
      },
    },
    async (richiesta, risposta) => {
      const { esito, nome, idAmbiente, portaFile, cartellaEsistente, motore, modello, impegno, permessi, estensioni, skillDiPartenza } = richiesta.body;
      if (esito === "annullata") {
        if (!proposte.annulla(richiesta.params.id)) {
          return risposta.code(404).send({ errore: "Questa proposta non è più in attesa." });
        }
        return { annullata: true };
      }
      try {
        const progetto = await proposte.conferma(richiesta.params.id, {
          ...(nome === undefined ? {} : { nome }),
          ...(idAmbiente === undefined ? {} : { idAmbiente }),
          ...(portaFile === undefined ? {} : { portaFile }),
          ...(cartellaEsistente === undefined ? {} : { cartellaEsistente }),
          ...(motore === undefined ? {} : { motore }),
          ...(modello === undefined ? {} : { modello }),
          ...(impegno === undefined ? {} : { impegno }),
          ...(permessi === undefined ? {} : { permessi }),
          ...(estensioni === undefined ? {} : { estensioni }),
          ...(skillDiPartenza === undefined ? {} : { skillDiPartenza }),
        });
        if (progetto === undefined) {
          return risposta.code(404).send({ errore: "Questa proposta non è più in attesa." });
        }
        return { idProgetto: progetto.id };
      } catch (errore) {
        // Il progetto non è nato: la proposta resta lì, e il proprietario può correggerla.
        if (errore instanceof ProgettoNonCreato || errore instanceof AmbienteSpento) {
          return risposta.code(409).send({ errore: errore.message });
        }
        throw errore;
      }
    },
  );

  // Il proprietario crea un progetto da sé, senza passare dalla Home: la scheda con ciò che può
  // scegliere, e la creazione. Sono le stesse scelte della scheda di una proposta.
  app.get("/api/nuovo-progetto", async () => proposte.schedaNuovoProgetto());

  app.post<{ Body: NuovoProgettoAMano }>(
    "/api/nuovo-progetto",
    {
      schema: {
        body: {
          type: "object",
          required: ["nome", "idAmbiente", "brief"],
          additionalProperties: false,
          properties: {
            nome: { type: "string", minLength: 1, maxLength: 60 },
            idAmbiente: { type: "string", minLength: 1, maxLength: 64 },
            brief: { type: "string", minLength: 1, maxLength: BRIEF_MASSIMO },
            cartellaEsistente: { type: "string", maxLength: 1000 },
            motore: { enum: [...MOTORI, null] },
            modello: { type: ["string", "null"], maxLength: 100 },
            impegno: { enum: [...IMPEGNI, null] },
            permessi: { enum: [...MODI_PERMESSI] },
            estensioni: { type: "array", maxItems: 50, uniqueItems: true, items: { type: "string", minLength: 1, maxLength: 64 } },
            skillDiPartenza: { enum: [...SKILL_DI_PARTENZA, null] },
          },
        },
      },
    },
    async (richiesta, risposta) => {
      try {
        const progetto = await proposte.creaAMano(richiesta.body);
        return { idProgetto: progetto.id };
      } catch (errore) {
        if (errore instanceof ProgettoNonCreato || errore instanceof AmbienteSpento) return risposta.code(409).send({ errore: errore.message });
        throw errore;
      }
    },
  );

  app.get<{ Params: { id: string; idAzione: string } }>("/api/progetti/:id/azioni/:idAzione", async (richiesta, risposta) => {
    const canale = lavori.canale(richiesta.params.id);
    const intera = canale === undefined ? undefined : azioneIntera(canale.archiviati, richiesta.params.idAzione);
    return intera ?? risposta.code(404).send({ errore: "Azione non trovata." });
  });

  app.get<{ Params: { id: string }; Querystring: RichiestaDiStoria }>("/api/progetti/:id/eventi", (richiesta, risposta) => {
    const canale = lavori.canale(richiesta.params.id);
    if (canale === undefined) {
      void risposta.code(404).send({ errore: "Progetto non trovato." });
      return;
    }
    seguiDaDove(canale, apriFlusso(richiesta, risposta), daDoveRiprendere(richiesta.query));
    lavori.prepara(richiesta.params.id);
  });

  // Un pezzo della storia di un progetto dopo un evento, di sola lettura: non prepara il motore (ADR 0046).
  app.get<{ Params: { id: string }; Querystring: RichiestaDiStoria }>("/api/progetti/:id/storia", async (richiesta, risposta) => {
    const canale = lavori.canale(richiesta.params.id);
    if (canale === undefined) return risposta.code(404).send({ errore: "Progetto non trovato." });
    return canale.storiaDopo(pezzoChiesto(richiesta.query));
  });

  // La pagina Uso: i token degli ultimi giorni, per giorno e per conversazione, e i limiti del piano.
  // La pagina Impostazioni: il motore predefinito delle conversazioni nuove.
  const impostazioniViste = (): ImpostazioniViste => {
    const scelte = opzioni.impostazioni?.scelte ?? {};
    const delCentro = opzioni.ambienti.stato().ambienti.find((ambiente) => ambiente.delCentro);
    return {
      motore: { ...(scelte.motore === undefined ? {} : { scelto: scelte.motore }), variabile: motoreConfigurato() },
      ambiente: {
        nome: delCentro?.nome ?? "",
        descrizione: delCentro?.descrizione ?? "",
        sistema: delCentro?.sistema ?? "",
        radiceProgetti: delCentro?.radiceProgetti ?? "",
        nomeScelto: scelte.ambiente?.nome !== undefined,
        descrizioneScelta: scelte.ambiente?.descrizione !== undefined,
      },
    };
  };
  app.get("/api/impostazioni", async (): Promise<ImpostazioniViste> => impostazioniViste());

  app.put<{ Body: ModificaDellInstallazione }>(
    "/api/impostazioni",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            motore: { enum: [...MOTORI, null] },
            soloNodiCifrati: { type: "boolean" },
            ambiente: {
              type: "object",
              additionalProperties: false,
              properties: {
                nome: { type: ["string", "null"], maxLength: NOME_AMBIENTE_MASSIMO },
                descrizione: { type: ["string", "null"], maxLength: DESCRIZIONE_AMBIENTE_MASSIMA },
              },
            },
          },
        },
      },
    },
    async (richiesta, risposta) => {
      if (opzioni.impostazioni === undefined) return risposta.code(409).send({ errore: "Questa installazione non ha la pagina Impostazioni." });
      const scelte = await opzioni.impostazioni.cambia(richiesta.body);
      if (richiesta.body.soloNodiCifrati !== undefined) ambienti.accettaSoloCifrati(scelte.soloNodiCifrati === true);
      return impostazioniViste();
    },
  );

  // La copia di sicurezza dei dati (ADR 0042): prepararla e scaricarla, caricarne una, aprirla
  // con la sua password, e poi portare qui memoria e skill oppure ripristinare tutto.
  const conLeCopie = async (risposta: FastifyReply, lavoro: (copie: CopieDiSicurezza) => Promise<unknown>): Promise<unknown> => {
    if (opzioni.copie === undefined) return risposta.code(404).send({ errore: "In questa installazione di Shinka le copie di sicurezza non ci sono." });
    try {
      return await lavoro(opzioni.copie);
    } catch (errore) {
      if (errore instanceof PasswordDellaCopiaSbagliata) return risposta.code(403).send({ errore: "La password non apre questa copia." });
      if (errore instanceof CopiaNonValida) return risposta.code(400).send({ errore: errore.message });
      if (errore instanceof CopiaRifiutata) return risposta.code(409).send({ errore: errore.message });
      throw errore;
    }
  };
  const CORPO_CON_PASSWORD = {
    type: "object",
    required: ["password"],
    additionalProperties: false,
    properties: { password: { type: "string", minLength: 1, maxLength: 1024 } },
  } as const;

  app.get("/api/copie", (_richiesta, risposta) => conLeCopie(risposta, (copie): Promise<StatoCopie> => copie.stato()));

  app.post<{ Body: { password: string } }>("/api/copie/preparazione", { schema: { body: CORPO_CON_PASSWORD } }, (richiesta, risposta) =>
    conLeCopie(risposta, async (copie) => {
      const pronta = await copie.prepara(richiesta.body.password);
      registroAccessi.annota("copia-preparata", chiDi(richiesta), { dettaglio: `${pronta.file} file` });
      return pronta;
    }),
  );

  app.get<{ Params: { id: string } }>("/api/copie/scaricamento/:id", (richiesta, risposta) =>
    conLeCopie(risposta, async (copie) => {
      const pronta = copie.daScaricare(richiesta.params.id);
      if (pronta === undefined) return risposta.code(404).send({ errore: "Questa copia non c'è più: preparane un'altra." });
      return risposta
        .header("Content-Disposition", `attachment; filename="${pronta.nome}"`)
        .header("Content-Length", pronta.byte)
        .header("Cache-Control", "no-store")
        .type("application/octet-stream")
        .send(createReadStream(pronta.percorso));
    }),
  );

  // La copia arriva com'è, senza passare per la memoria: è un file che può pesare molto.
  await app.register(async (ambito) => {
    ambito.removeAllContentTypeParsers();
    ambito.addContentTypeParser("*", (_richiesta, corpo, fatto) => fatto(null, corpo));
    ambito.post("/api/copie/caricata", { bodyLimit: COPIA_MASSIMA }, (richiesta, risposta) =>
      conLeCopie(risposta, async (copie) => {
        const caricata = await copie.ricevi(richiesta.body as AsyncIterable<Buffer>);
        registroAccessi.annota("copia-caricata", chiDi(richiesta), { dettaglio: `fatta il ${caricata.quando.slice(0, 10)}` });
        return caricata;
      }),
    );
  });

  app.post<{ Body: { password: string } }>("/api/copie/apertura", { schema: { body: CORPO_CON_PASSWORD } }, (richiesta, risposta) =>
    conLeCopie(risposta, (copie) => copie.apri(richiesta.body.password)),
  );

  app.post<{ Body: unknown }>("/api/copie/trasloco", { schema: { body: { type: "object", additionalProperties: true } } }, (richiesta, risposta) =>
    conLeCopie(risposta, async (copie) => {
      const scelte = leggiScelteDelTrasloco(richiesta.body);
      if (scelte === undefined) return risposta.code(400).send({ errore: "Va detto che cosa portare: la memoria, e quali skill." });
      const esito = await copie.trasloca(scelte);
      registroAccessi.annota("trasloco", chiDi(richiesta), { dettaglio: `${esito.memoria} voci di memoria, ${esito.skillCreate.length + esito.skillCambiate.length} skill` });
      return esito;
    }),
  );

  // Il ripristino cambia tutti i dati: va confermato con la password di Shinka, quella di adesso.
  app.post<{ Body: { password: string } }>("/api/copie/ripristino", { schema: { body: CORPO_CON_PASSWORD } }, (richiesta, risposta) =>
    conLeCopie(risposta, async (copie) => {
      const conferma = await accesso.conferma(richiesta.body.password);
      if (conferma !== "ok") {
        registroAccessi.annota("ripristino-rifiutato", chiDi(richiesta));
        if (conferma.esito === "troppi-tentativi") {
          return risposta.code(429).send({ errore: `Troppi tentativi falliti: riprova tra ${Math.ceil(conferma.riprovaTraMs / 1000)} secondi.` });
        }
        return risposta.code(403).send({ errore: "La password di Shinka non è giusta." });
      }
      const riparte = await copie.chiediRipristino();
      registroAccessi.annota("ripristino-chiesto", chiDi(richiesta));
      return { riparte };
    }),
  );

  app.delete("/api/copie/caricata", (_richiesta, risposta) =>
    conLeCopie(risposta, async (copie) => {
      await copie.scarta();
      return copie.stato();
    }),
  );

  app.delete("/api/copie/dati-di-prima", (_richiesta, risposta) =>
    conLeCopie(risposta, async (copie) => {
      await copie.eliminaDatiDiPrima();
      return copie.stato();
    }),
  );

  // Gli accessi di Claude e Codex in ogni ambiente acceso, chiesti a tutti insieme.
  app.get("/api/impostazioni/accessi", async (): Promise<{ ambienti: AccessiDiUnAmbiente[] }> => {
    const elenco = opzioni.ambienti.stato().ambienti;
    const ambienti = await Promise.all(
      elenco.map(async (ambiente): Promise<AccessiDiUnAmbiente> => {
        const base = { id: ambiente.id, nome: ambiente.nome, attivo: ambiente.attivo, delCentro: ambiente.delCentro };
        if (!ambiente.attivo || opzioni.accessi === undefined) return base;
        return { ...base, esito: await opzioni.accessi.esegui(ambiente.id, { tipo: "stato" }) };
      }),
    );
    return { ambienti };
  });

  app.post<{ Params: { id: string }; Body: unknown }>(
    "/api/impostazioni/accessi/:id",
    { bodyLimit: 4096 },
    async (richiesta, risposta): Promise<EsitoAccessi> => {
      const letta = leggiRichiestaAccessi(richiesta.body);
      if (letta === undefined) return risposta.code(400).send({ errore: "Richiesta non valida." });
      if (opzioni.accessi === undefined) return risposta.code(409).send({ errore: "Questa installazione non sa gestire gli accessi." });
      if (!opzioni.ambienti.stato().ambienti.some((ambiente) => ambiente.id === richiesta.params.id)) {
        return risposta.code(404).send({ errore: "Ambiente sconosciuto." });
      }
      return opzioni.accessi.esegui(richiesta.params.id, letta);
    },
  );

  app.get("/api/uso", async (): Promise<Uso> => {
    const fonti: FonteDiUso[] = [
      { genere: "home", id: home.idArgomentoAperto, nome: "Home, argomento aperto", storia: home.canale.archiviati },
      ...(await home.cercabili()).map((voce) => ({ genere: "home" as const, id: voce.id, nome: `Home: ${voce.titolo}`, storia: voce.storia })),
      ...lavori.stato().progetti.map((progetto) => ({ genere: "progetto" as const, id: progetto.id, nome: progetto.nome, storia: lavori.canale(progetto.id)?.archiviati ?? [] })),
    ];
    const ricordato = home.canale.ricordato("stato");
    const limiti = ricordato?.tipo === "stato" ? ricordato.stato.limiti : undefined;
    return { ...contaUso(fonti), ...(limiti === undefined ? {} : { limiti }) };
  });

  // La pagina Archiviazione: quanto occupano argomenti e progetti tra i dati di Shinka.
  app.get("/api/archiviazione", async (): Promise<Archiviazione> => {
    let perDifetto = false;
    const misura = async (percorso: string | undefined): Promise<number> => {
      if (percorso === undefined) return 0;
      const spazio = await spazioDi(percorso);
      perDifetto ||= spazio.perDifetto;
      return spazio.byte;
    };
    const voci: SpazioDiUnaVoce[] = [];
    voci.push({
      genere: "argomento",
      id: home.idArgomentoAperto,
      nome: "Argomento aperto della Home",
      byteStoria: await misura(home.archivioDellArgomento(home.idArgomentoAperto)),
      byteFile: await misura(home.cartellaAperta),
      eliminabile: false,
    });
    for (const voce of home.archiviati()) {
      voci.push({
        genere: "argomento",
        id: voce.id,
        nome: voce.titolo,
        byteStoria: await misura(home.archivioDellArgomento(voce.id)),
        byteFile: await misura(home.cartellaDellArgomento(voce.id)),
        eliminabile: true,
        quando: voce.archiviatoIl,
      });
    }
    for (const progetto of lavori.stato().progetti) {
      voci.push({
        genere: "progetto",
        id: progetto.id,
        nome: progetto.nome,
        byteStoria: await misura(lavori.archivioDelProgetto(progetto.id)),
        byteFile: await misura(immagini.cartellaDi(progetto.id)),
        eliminabile: progetto.diShinka !== true,
        quando: progetto.creatoIl,
      });
    }
    voci.sort((a, b) => b.byteStoria + b.byteFile - (a.byteStoria + a.byteFile));
    return { voci, perDifetto };
  });

  // Il proprietario elimina un argomento archiviato: la sua storia e la sua cartella al centro.
  app.delete<{ Params: { id: string } }>("/api/argomenti/:id", async (richiesta, risposta) => {
    const motivo = await home.eliminaArchiviato(richiesta.params.id);
    if (motivo !== undefined) return risposta.code(409).send({ errore: motivo });
    return { eliminato: true };
  });

  // La barra laterale: il proprietario rinomina un progetto, lo fissa in cima, o lo elimina.
  app.post<{ Params: { id: string }; Body: { nome: string } }>(
    "/api/progetti/:id/nome",
    {
      schema: {
        body: { type: "object", required: ["nome"], additionalProperties: false, properties: { nome: { type: "string", minLength: 1, maxLength: NOME_PROGETTO_MASSIMO } } },
      },
    },
    async (richiesta, risposta) => {
      const nome = richiesta.body.nome.replace(/\s+/g, " ").trim();
      if (nome === "") return risposta.code(400).send({ errore: "Il nome è vuoto." });
      if (!(await opzioni.lavori.rinomina(richiesta.params.id, nome))) return risposta.code(404).send({ errore: "Progetto non trovato." });
      return { nome };
    },
  );
  app.post<{ Params: { id: string }; Body: { fissato: boolean } }>(
    "/api/progetti/:id/fissato",
    { schema: { body: { type: "object", required: ["fissato"], additionalProperties: false, properties: { fissato: { type: "boolean" } } } } },
    async (richiesta, risposta) => {
      if (!(await opzioni.lavori.fissa(richiesta.params.id, richiesta.body.fissato))) return risposta.code(404).send({ errore: "Progetto non trovato." });
      return { fissato: richiesta.body.fissato };
    },
  );
  app.delete<{ Params: { id: string }; Querystring: { cartella?: string } }>("/api/progetti/:id", async (richiesta, risposta) => {
    const progetto = opzioni.lavori.progetto(richiesta.params.id);
    if (progetto === undefined) return risposta.code(404).send({ errore: "Progetto non trovato." });
    if (progetto.diShinka === true) return risposta.code(409).send({ errore: "Il progetto Shinka non si elimina: è quello in cui Shinka sviluppa sé stessa." });
    // Prima ciò che il progetto ha acceso nel suo ambiente: l'applicazione, l'anteprima, il terminale.
    if (opzioni.applicazioni !== undefined) await opzioni.applicazioni.ferma(progetto.id).catch(() => undefined);
    opzioni.anteprime?.chiudi(progetto.id);
    opzioni.terminali?.spegni(progetto);
    // Con ?cartella=si se ne va anche la cartella con i file, nel suo ambiente.
    const esito = await opzioni.lavori.elimina(progetto.id, { cartella: richiesta.query.cartella === "si" });
    if ("motivo" in esito) return risposta.code(409).send({ errore: esito.motivo });
    return { eliminato: true, ...(esito.cartella === undefined ? {} : { cartella: esito.cartella }) };
  });

  app.post<{ Params: { id: string }; Body: SceltaDelProprietario }>(
    "/api/progetti/:id/impostazioni",
    { schema: { body: CORPO_IMPOSTAZIONI } },
    async (richiesta, risposta) => {
      const modifica = conLoStile(richiesta.body);
      if (modifica === undefined) return risposta.code(400).send(STILE_NON_TROVATO);
      const impostazioni = await lavori.cambiaImpostazioni(richiesta.params.id, modifica);
      if (impostazioni === undefined) return risposta.code(404).send({ errore: "Progetto non trovato." });
      return { impostazioni };
    },
  );

  app.get<{ Params: { id: string; idImmagine: string } }>(
    "/api/progetti/:id/immagini/:idImmagine",
    (richiesta, risposta) =>
      // Le immagini di una chat parallela stanno con quelle del suo progetto.
      mandaImmagine(risposta, immagini.trova(progettoDellaConversazione(richiesta.params.id), richiesta.params.idImmagine)),
  );

  app.post<{ Params: { id: string }; Body: CorpoMessaggio }>(
    "/api/progetti/:id/messaggi",
    { bodyLimit: CORPO_MASSIMO_MESSAGGIO, schema: { body: CORPO_MESSAGGIO } },
    async (richiesta, risposta) => {
      const messaggio = leggiMessaggio(richiesta.body);
      if (typeof messaggio === "string") return risposta.code(400).send({ errore: messaggio });
      if (lavori.canale(richiesta.params.id) === undefined) {
        return risposta.code(404).send({ errore: "Progetto non trovato." });
      }
      try {
        lavori.invia(richiesta.params.id, messaggio.testo, messaggio.allegati);
      } catch (errore) {
        if (errore instanceof AmbienteSpento) {
          return risposta.code(409).send({ errore: errore.message });
        }
        throw errore;
      }
      return risposta.code(202).send({ accettato: true });
    },
  );

  app.post<{ Params: { id: string; idDomande: string }; Body: { risposta?: unknown } }>(
    "/api/progetti/:id/domande/:idDomande",
    async (richiesta, risposta) => {
      const letta = leggiRispostaAlleDomande(richiesta.body?.risposta);
      if (letta === undefined) return risposta.code(400).send({ errore: "Risposta alle domande non valida." });
      if (!lavori.rispondiDomande(richiesta.params.id, richiesta.params.idDomande, letta)) {
        return risposta.code(404).send({ errore: "Queste domande non aspettano più una risposta." });
      }
      return { risposto: true };
    },
  );

  app.post<{ Params: { id: string; idPermesso: string }; Body: { decisione: DecisionePermesso; sempre?: boolean } }>(
    "/api/progetti/:id/permessi/:idPermesso",
    { schema: {
        body: {
          type: "object",
          required: ["decisione"],
          additionalProperties: false,
          // Con `sempre` un consenso vale anche per le prossime volte, in questo progetto.
          properties: { decisione: { type: "string", enum: ["approvato", "negato"] }, sempre: { type: "boolean" } },
        },
      } },
    async (richiesta, risposta) => {
      const { id, idPermesso } = richiesta.params;
      // Le approvazioni sono del progetto, anche quando il permesso viene da una sua chat parallela.
      consensoDato(opzioni.approvazioni, progettoDellaConversazione(id), lavori.canale(id), idPermesso, richiesta.body.decisione);
      if (!lavori.decidiPermesso(id, idPermesso, richiesta.body.decisione, richiesta.body.sempre === true)) {
        return risposta.code(404).send({ errore: "Questo permesso non è più in attesa." });
      }
      return { deciso: true };
    },
  );

  app.post<{ Params: { id: string } }>("/api/progetti/:id/interrompi", async (richiesta) => {
    await lavori.interrompi(richiesta.params.id);
    return { interrotto: true };
  });

  // Il terminale del progetto: il browser lo apre, ci scrive e ne riceve l'uscita su un WebSocket.
  // Il terminale vive nell'ambiente del progetto e resta acceso quando questo collegamento si chiude.
  // Con ?scheda=N il terminale di un'altra scheda del progetto: ciascuna ha la sua shell.
  app.get<{ Params: { id: string }; Querystring: { scheda?: string } }>("/api/progetti/:id/terminale", { websocket: true }, (socket, richiesta) => {
    const scheda = richiesta.query.scheda === undefined ? 1 : Number(richiesta.query.scheda);
    const collegamento = opzioni.terminali?.collega(
      richiesta.params.id,
      (messaggio) => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(messaggio));
      },
      scheda,
    );
    if (collegamento === undefined) {
      socket.close(1008, "Terminale non disponibile.");
      return;
    }
    socket.on("message", (dati) => {
      const messaggio = leggiDalBrowser(dati.toString());
      if (messaggio !== undefined) collegamento.ricevi(messaggio);
    });
    socket.on("close", () => collegamento.scollega());
    socket.on("error", () => socket.close());
  });

  // Il proprietario apre l'anteprima di un progetto su una porta del suo ambiente: prende il posto
  // di quella aperta prima. Le pagine arrivano poi dalla porta dell'anteprima, non da qui.
  app.post<{ Params: { id: string }; Body: { porta: number; percorso?: string } }>(
    "/api/progetti/:id/anteprima",
    {
      schema: {
        body: {
          type: "object",
          required: ["porta"],
          additionalProperties: false,
          properties: { porta: { type: "integer" }, percorso: { type: "string", maxLength: 2000 } },
        },
      },
    },
    async (richiesta, risposta) => {
      if (opzioni.anteprime === undefined) {
        return risposta.code(409).send({ errore: "In questa installazione di Shinka l'anteprima non è accesa." });
      }
      const motivo = await opzioni.anteprime.apri(richiesta.params.id, richiesta.body.porta, richiesta.body.percorso ?? "/");
      if (motivo !== undefined) return risposta.code(409).send({ errore: motivo });
      return { aperta: true };
    },
  );

  app.post<{ Params: { id: string } }>("/api/progetti/:id/anteprima/chiusura", async (richiesta) => ({
    chiusa: opzioni.anteprime?.chiudi(richiesta.params.id) ?? false,
  }));

  // L'applicazione del progetto: come si avvia, com'è, e il pulsante per avviarla e fermarla.
  const senzaApplicazioni = { errore: "In questa installazione di Shinka l'anteprima non è accesa." };
  // Il pannello File: una cartella, una ricerca per nome, un file per l'anteprima. Solo lettura.
  const senzaFile = { errore: "In questa installazione il pannello File non c'è." };
  app.get<{ Params: { id: string }; Querystring: { percorso?: string } }>("/api/progetti/:id/file", async (richiesta, risposta) => {
    if (opzioni.file === undefined) return risposta.code(404).send(senzaFile);
    const esito = await opzioni.file.elenca(richiesta.params.id, richiesta.query.percorso ?? "");
    return "motivo" in esito ? risposta.code(409).send({ errore: esito.motivo }) : esito;
  });
  app.get<{ Params: { id: string }; Querystring: { q?: string } }>("/api/progetti/:id/file/cerca", async (richiesta, risposta) => {
    if (opzioni.file === undefined) return risposta.code(404).send(senzaFile);
    const esito = await opzioni.file.cerca(richiesta.params.id, richiesta.query.q ?? "");
    return "motivo" in esito ? risposta.code(409).send({ errore: esito.motivo }) : esito;
  });
  app.get<{ Params: { id: string }; Querystring: { percorso?: string } }>("/api/progetti/:id/file/contenuto", async (richiesta, risposta) => {
    if (opzioni.file === undefined) return risposta.code(404).send(senzaFile);
    const percorso = richiesta.query.percorso ?? "";
    const esito = await opzioni.file.leggi(richiesta.params.id, percorso);
    if ("motivo" in esito) return risposta.code(409).send({ errore: esito.motivo });
    const { genere, tipo } = genereDelFile(percorso);
    // Il file viene dal progetto: non deve poter agire come una pagina di Shinka. Il testo, anche
    // HTML o SVG, va sempre come testo; il resto in un recinto senza script, tranne il PDF, che il
    // browser mostra con il suo lettore e in un recinto non mostrerebbe.
    void risposta.header("Content-Type", tipo);
    void risposta.header("X-Content-Type-Options", "nosniff");
    void risposta.header("Cache-Control", "no-store");
    if (genere !== "pdf") void risposta.header("Content-Security-Policy", "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'");
    return risposta.send(Buffer.from(esito.dati, "base64"));
  });

  // Scaricare un file del progetto così com'è, o una cartella come ZIP (con il percorso vuoto, il
  // progetto intero). Arriva a flusso dall'ambiente del progetto, mentre il browser lo salva.
  app.get<{ Params: { id: string }; Querystring: { percorso?: string } }>("/api/progetti/:id/file/scarica", async (richiesta, risposta) => {
    if (opzioni.file === undefined) return risposta.code(404).send(senzaFile);
    const esito = await opzioni.file.scarica(richiesta.params.id, richiesta.query.percorso ?? "");
    if ("motivo" in esito) return risposta.code(409).send({ errore: esito.motivo });
    const ascii = esito.nome.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
    void risposta.header("Content-Type", esito.comeArchivio ? "application/zip" : "application/octet-stream");
    void risposta.header("Content-Disposition", `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(esito.nome)}`);
    void risposta.header("X-Content-Type-Options", "nosniff");
    void risposta.header("Cache-Control", "no-store");
    void risposta.header("Content-Security-Policy", "sandbox; default-src 'none'");
    if (esito.dimensione !== undefined) void risposta.header("Content-Length", String(esito.dimensione));
    // Il browser se ne va a metà: il flusso si chiude subito, e l'ambiente smette di leggere.
    risposta.raw.on("close", () => {
      if (!risposta.raw.writableFinished) esito.flusso.destroy();
    });
    return risposta.send(esito.flusso);
  });

  // Le cartelle collegate di un progetto, in altri ambienti: le vede e le cambia il proprietario (ADR 0050).
  const senzaCollegate = { errore: "In questa installazione le cartelle collegate non ci sono." };
  app.get<{ Params: { id: string } }>("/api/progetti/:id/collegate", async (richiesta, risposta) => {
    if (opzioni.collegate === undefined) return risposta.code(404).send(senzaCollegate);
    return opzioni.collegate.stato(richiesta.params.id) ?? risposta.code(404).send({ errore: "Progetto non trovato." });
  });
  app.post<{ Params: { id: string }; Body: { idAmbiente: string; cartella: string } }>(
    "/api/progetti/:id/collegate",
    {
      schema: {
        body: {
          type: "object",
          required: ["idAmbiente", "cartella"],
          additionalProperties: false,
          properties: { idAmbiente: { type: "string", minLength: 1, maxLength: 200 }, cartella: { type: "string", minLength: 1, maxLength: 1000 } },
        },
      },
    },
    async (richiesta, risposta) => {
      if (opzioni.collegate === undefined) return risposta.code(404).send(senzaCollegate);
      const esito = await opzioni.collegate.collega(richiesta.params.id, richiesta.body);
      return "motivo" in esito ? risposta.code(409).send({ errore: esito.motivo }) : esito;
    },
  );
  app.delete<{ Params: { id: string; idAmbiente: string } }>("/api/progetti/:id/collegate/:idAmbiente", async (richiesta, risposta) => {
    if (opzioni.collegate === undefined) return risposta.code(404).send(senzaCollegate);
    const esito = await opzioni.collegate.scollega(richiesta.params.id, richiesta.params.idAmbiente);
    return "motivo" in esito ? risposta.code(409).send({ errore: esito.motivo }) : esito;
  });

  // Le estensioni di un progetto, anche a progetto avviato: quelle accese nel suo ambiente, e quali ha.
  const estensioniDelProgetto = (idProgetto: string): StatoEstensioniDelProgetto | undefined => {
    const progetto = lavori.progetto(idProgetto);
    if (progetto === undefined) return undefined;
    const voci = (opzioni.estensioni?.stato().estensioni ?? [])
      .filter((una) => una.ambienti.some((dove) => dove.idAmbiente === progetto.idAmbiente && dove.accesa))
      .map((una) => ({ nome: una.nome, tipo: tipoInParole(una.definizione.tipo), descrizione: una.descrizione }));
    const scelte = lavori.estensioniScelte(idProgetto);
    return { voci, ...(scelte === undefined ? {} : { scelte }) };
  };
  app.get<{ Params: { id: string } }>("/api/progetti/:id/estensioni", async (richiesta, risposta) => {
    return estensioniDelProgetto(richiesta.params.id) ?? risposta.code(404).send({ errore: "Progetto non trovato." });
  });
  app.put<{ Params: { id: string }; Body: { scelte: string[] | null } }>(
    "/api/progetti/:id/estensioni",
    {
      schema: {
        body: {
          type: "object",
          required: ["scelte"],
          additionalProperties: false,
          properties: { scelte: { type: ["array", "null"], maxItems: 100, items: { type: "string", maxLength: 40 } } },
        },
      },
    },
    async (richiesta, risposta) => {
      const prima = estensioniDelProgetto(richiesta.params.id);
      if (prima === undefined) return risposta.code(404).send({ errore: "Progetto non trovato." });
      const scelte = richiesta.body.scelte === null ? undefined : richiesta.body.scelte.filter((nome) => prima.voci.some((voce) => voce.nome === nome));
      await lavori.cambiaEstensioni(richiesta.params.id, scelte);
      return estensioniDelProgetto(richiesta.params.id);
    },
  );

  // Chi implementa gli incarichi di un progetto: lo sceglie il proprietario, nella scheda della sessione (ADR 0051).
  app.get<{ Params: { id: string } }>("/api/progetti/:id/chi-implementa", async (richiesta, risposta) => {
    if (lavori.progetto(richiesta.params.id) === undefined) return risposta.code(404).send({ errore: "Progetto non trovato." });
    const chiImplementa = lavori.chiImplementa(richiesta.params.id);
    const stato: StatoChiImplementa = chiImplementa === undefined ? {} : { chiImplementa };
    return stato;
  });
  app.put<{ Params: { id: string }; Body: { chiImplementa: Record<string, unknown> | null } }>(
    "/api/progetti/:id/chi-implementa",
    {
      schema: {
        body: {
          type: "object",
          required: ["chiImplementa"],
          additionalProperties: false,
          properties: {
            chiImplementa: {
              type: ["object", "null"],
              additionalProperties: false,
              properties: {
                motore: { type: "string", enum: [...MOTORI] },
                modello: { type: "string", maxLength: 200 },
                impegno: { type: "string", enum: [...IMPEGNI] },
              },
            },
          },
        },
      },
    },
    async (richiesta, risposta) => {
      const scelta = richiesta.body.chiImplementa === null ? undefined : leggiChiImplementa(richiesta.body.chiImplementa);
      if (!(await lavori.cambiaChiImplementa(richiesta.params.id, scelta))) return risposta.code(404).send({ errore: "Progetto non trovato." });
      const stato: StatoChiImplementa = scelta === undefined ? {} : { chiImplementa: scelta };
      return stato;
    },
  );

  // Shinka Desktop: la versione pubblicata, la pubblicazione dalle Impostazioni, e i file che
  // electron-updater scarica, a parti se le chiede (ADR 0049).
  const senzaDesktop = { errore: "Questa installazione non serve gli aggiornamenti di Shinka Desktop." };
  // Da dove si può pubblicare: la cartella di ogni progetto, e le sue cartelle collegate.
  const fontiDiPubblicazione = (): FonteDiPubblicazione[] =>
    lavori.stato().progetti.flatMap((progetto) => [
      { idProgetto: progetto.id, nomeProgetto: progetto.nome, nomeAmbiente: progetto.nomeAmbiente, cartella: progetto.cartella },
      ...(opzioni.collegate?.stato(progetto.id)?.collegate ?? []).map((voce) => ({
        idProgetto: progetto.id,
        nomeProgetto: progetto.nome,
        idAmbiente: voce.idAmbiente,
        nomeAmbiente: voce.nomeAmbiente,
        cartella: voce.cartella,
      })),
    ]);
  const statoDesktop = (desktop: AggiornamentiDesktop) => ({ ...desktop.stato(), fonti: fontiDiPubblicazione() });
  app.get("/api/desktop", async (_richiesta, risposta) => (opzioni.desktop === undefined ? risposta.code(404).send(senzaDesktop) : statoDesktop(opzioni.desktop)));

  app.post<{ Body: RichiestaDiPubblicazione }>(
    "/api/desktop/pubblicazione",
    {
      schema: {
        body: {
          type: "object",
          required: ["idProgetto", "cartella", "password"],
          additionalProperties: false,
          properties: {
            idProgetto: { type: "string", minLength: 1, maxLength: 200 },
            idAmbiente: { type: "string", minLength: 1, maxLength: 200 },
            cartella: { type: "string", maxLength: 1000 },
            password: { type: "string", minLength: 1, maxLength: 1024 },
          },
        },
      },
    },
    async (richiesta, risposta) => {
      if (opzioni.desktop === undefined || opzioni.file === undefined) return risposta.code(404).send(senzaDesktop);
      // Pubblicare è del proprietario, dal browser con la sua password: un dispositivo non pubblica.
      if (gettoneDi(richiesta.headers.authorization) !== undefined) {
        registroAccessi.annota("desktop-non-pubblicato", chiDi(richiesta), { dettaglio: "chiesto con un gettone di dispositivo" });
        return risposta.code(403).send({ errore: "Un dispositivo non può pubblicare: si pubblica dalle Impostazioni di Shinka, nel browser." });
      }
      const conferma = await accesso.conferma(richiesta.body.password);
      if (conferma !== "ok") {
        registroAccessi.annota("desktop-non-pubblicato", chiDi(richiesta), { dettaglio: "password sbagliata" });
        if (conferma.esito === "troppi-tentativi") {
          return risposta.code(429).send({ errore: `Troppi tentativi falliti: riprova tra ${Math.ceil(conferma.riprovaTraMs / 1000)} secondi.` });
        }
        return risposta.code(403).send({ errore: "La password di Shinka non è giusta." });
      }
      const file = opzioni.file;
      const { idProgetto } = richiesta.body;
      // Da una cartella collegata del progetto, se la richiesta la indica: solo da una che lo è davvero.
      let altrove: { idAmbiente: string; cartella: string } | undefined;
      if (richiesta.body.idAmbiente !== undefined) {
        const collegata = opzioni.collegate?.stato(idProgetto)?.collegate.find((voce) => voce.idAmbiente === richiesta.body.idAmbiente);
        if (collegata === undefined) return risposta.code(409).send({ errore: "In quell'ambiente il progetto non ha una cartella collegata." });
        altrove = { idAmbiente: collegata.idAmbiente, cartella: collegata.cartella };
      }
      const cartella = richiesta.body.cartella.trim().replace(/^[/\\]+|[/\\]+$/g, "");
      const dentro = (nome: string): string => (cartella === "" ? nome : `${cartella}/${nome}`);
      const letto = await file.leggi(idProgetto, dentro(MANIFESTO), altrove);
      const esito =
        "motivo" in letto
          ? { motivo: `${MANIFESTO}: ${letto.motivo}` }
          : await opzioni.desktop.pubblica({
              manifesto: Buffer.from(letto.dati, "base64"),
              apri: async (nome) => {
                const scaricato = await file.scarica(idProgetto, dentro(nome), altrove);
                if ("motivo" in scaricato) return scaricato;
                if (scaricato.comeArchivio) {
                  scaricato.flusso.destroy();
                  return { motivo: "è una cartella." };
                }
                return scaricato.flusso;
              },
            });
      if ("motivo" in esito) {
        registroAccessi.annota("desktop-non-pubblicato", chiDi(richiesta), { dettaglio: esito.motivo.slice(0, 200) });
        return risposta.code(409).send({ errore: esito.motivo });
      }
      registroAccessi.annota("desktop-pubblicato", chiDi(richiesta), { dettaglio: `versione ${esito.versione}` });
      return statoDesktop(opzioni.desktop);
    },
  );

  app.get<{ Params: { nome: string } }>("/api/desktop/aggiornamenti/:nome", async (richiesta, risposta) => {
    const desktop = opzioni.desktop;
    if (desktop === undefined) return risposta.code(404).send(senzaDesktop);
    void risposta.header("Cache-Control", "no-store");
    void risposta.header("X-Content-Type-Options", "nosniff");
    if (richiesta.params.nome === MANIFESTO) {
      const manifesto = desktop.manifesto();
      if (manifesto === undefined) return risposta.code(404).send({ errore: "Non c'è ancora una versione di Shinka Desktop pubblicata." });
      return risposta.type("text/yaml; charset=utf-8").send(manifesto);
    }
    const trovato = desktop.file(richiesta.params.nome);
    if (trovato === undefined) return risposta.code(404).send({ errore: "Questo file non c'è tra quelli della versione pubblicata." });
    const tipo = "application/octet-stream";
    void risposta.header("Accept-Ranges", "bytes");
    void risposta.header("Content-Disposition", `attachment; filename="${richiesta.params.nome.replace(/[^\x20-\x7e]|["\\]/g, "_")}"`);
    const intervalli = intervalliChiesti(richiesta.headers.range, trovato.dimensione);
    if (intervalli === "fuori") {
      return risposta.code(416).header("Content-Range", `bytes */${trovato.dimensione}`).send({ errore: "La parte chiesta è fuori dal file." });
    }
    if (intervalli === undefined) {
      void risposta.header("Content-Length", String(trovato.dimensione));
      return risposta.type(tipo).send(createReadStream(trovato.percorso));
    }
    if (intervalli.length === 1) {
      const [solo] = intervalli as [{ inizio: number; fine: number }];
      void risposta.header("Content-Range", `bytes ${solo.inizio}-${solo.fine}/${trovato.dimensione}`);
      void risposta.header("Content-Length", String(solo.fine - solo.inizio + 1));
      return risposta.code(206).type(tipo).send(createReadStream(trovato.percorso, { start: solo.inizio, end: solo.fine }));
    }
    const parti = piuParti(trovato.percorso, intervalli, trovato.dimensione, tipo);
    void risposta.header("Content-Length", String(parti.lunghezza));
    return risposta.code(206).type(`multipart/byteranges; boundary=${parti.confine}`).send(parti.flusso);
  });

  app.get<{ Params: { id: string } }>("/api/progetti/:id/applicazione", async (richiesta, risposta) => {
    if (opzioni.applicazioni === undefined) return risposta.code(409).send(senzaApplicazioni);
    const vista = await opzioni.applicazioni.vista(richiesta.params.id);
    return vista ?? risposta.code(404).send({ errore: "Progetto non trovato." });
  });

  app.put<{ Params: { id: string }; Body: { comando: string; porta: number; percorso?: string } }>(
    "/api/progetti/:id/applicazione",
    {
      schema: {
        body: {
          type: "object",
          required: ["comando", "porta"],
          additionalProperties: false,
          properties: { comando: { type: "string", maxLength: 2000 }, porta: { type: "integer" }, percorso: { type: "string", maxLength: 2000 } },
        },
      },
    },
    async (richiesta, risposta) => {
      if (opzioni.applicazioni === undefined) return risposta.code(409).send(senzaApplicazioni);
      const motivo = await opzioni.applicazioni.imposta(richiesta.params.id, richiesta.body);
      if (motivo !== undefined) return risposta.code(400).send({ errore: motivo });
      return { impostata: true };
    },
  );

  for (const azione of ["avvia", "ferma"] as const) {
    app.post<{ Params: { id: string } }>(`/api/progetti/:id/applicazione/${azione}`, async (richiesta, risposta) => {
      if (opzioni.applicazioni === undefined) return risposta.code(409).send(senzaApplicazioni);
      // Dal pulsante l'avvio è del proprietario: insieme si apre anche l'anteprima.
      const esito =
        azione === "avvia"
          ? await opzioni.applicazioni.avvia(richiesta.params.id, { apriAnteprima: true })
          : await opzioni.applicazioni.ferma(richiesta.params.id);
      if ("motivo" in esito) return risposta.code(409).send({ errore: esito.motivo });
      return esito;
    });
  }

  // Collegamento dei nodi. Qui non c'è la sessione del proprietario: un nodo si fa
  // riconoscere dal suo segreto, e uno sconosciuto resta in attesa del consenso.
  app.get(PERCORSO_COLLEGAMENTO, { websocket: true }, (socket, richiestaDelNodo) => {
    let idNodo: string | undefined;
    const canale: CanaleNodo = {
      invia: (messaggio) => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(messaggio));
      },
      chiudi: () => socket.close(),
      // Cifrato è il collegamento arrivato al centro in TLS: con il certificato dei nodi, o con quello dell'HTTPS.
      cifrato: (richiestaDelNodo.raw.socket as { encrypted?: boolean }).encrypted === true,
      ...(richiestaDelNodo.raw.socket.remoteAddress === undefined ? {} : { indirizzo: richiestaDelNodo.raw.socket.remoteAddress.replace(/^::ffff:/, "") }),
    };
    const scadenza = setTimeout(() => {
      if (idNodo === undefined) socket.close();
    }, TEMPO_PER_PRESENTARSI_MS);

    socket.on("message", (dati) => {
      const messaggio = leggiMessaggioNodo(dati.toString());
      if (messaggio === undefined) {
        socket.close();
        return;
      }
      if (messaggio.tipo === "presentazione") {
        // Ci si presenta una volta sola per collegamento.
        if (idNodo !== undefined) {
          socket.close();
          return;
        }
        idNodo = messaggio.idNodo;
        clearTimeout(scadenza);
        const chi = chiDi(richiestaDelNodo);
        const nome = `«${String(messaggio.nome).slice(0, 60)}»`;
        ambienti
          .presenta(messaggio, canale)
          .then((esito) => {
            if (esito === "solo-cifrato") registroAccessi.annota("nodo-in-chiaro", chi, { dettaglio: nome });
            else registroAccessi.annota("nodo-presentato", chi, { dettaglio: `${nome}, ${canale.cifrato === true ? "cifrato" : "in chiaro"}${esito === "accolto" ? "" : esito === "in-attesa" ? ", in attesa del consenso" : ", rifiutato"}` });
          })
          .catch(() => socket.close());
      } else if (idNodo === undefined) {
        // Prima di presentarsi un nodo non ha altro da dire.
        socket.close();
      } else if (messaggio.tipo === "battito") {
        ambienti.battito(idNodo, canale);
      } else {
        ambienti.riferito(idNodo, canale, messaggio);
      }
    });
    socket.on("close", () => {
      clearTimeout(scadenza);
      if (idNodo !== undefined) ambienti.scollegato(idNodo, canale);
    });
    socket.on("error", () => socket.close());
  });

  app.setNotFoundHandler((richiesta, risposta) => {
    // Un file che non c'è non è una pagina: un'icona chiesta dall'iPhone deve ricevere "non trovato",
    // non la pagina dell'interfaccia al posto di un'immagine.
    const percorso = richiesta.url.split("?")[0] ?? "";
    const unFile = /\.[A-Za-z0-9]{1,12}$/.test(percorso);
    const paginaDellInterfaccia =
      haWeb && richiesta.method === "GET" && !richiesta.url.startsWith("/api/") && !unFile;
    if (paginaDellInterfaccia) return risposta.sendFile("index.html");
    return risposta.code(404).send({ errore: "Non trovato." });
  });

  return app;
}

/** Manda al browser un'immagine in custodia. Non cambia mai: il browser può tenersela. */
/** Com'è finita la prova di un'estensione, per chi ha premuto il pulsante. */
function rispostaAccensione(esito: EsitoAccensione, risposta: FastifyReply): unknown {
  switch (esito.stato) {
    case "accesa":
      return { stato: "accesa", strumenti: esito.strumenti };
    case "non-partita":
      return { stato: "non-partita", motivo: esito.motivo };
    case "da-riprovare":
      // Manca qualcosa che il proprietario può mettere a posto: la scheda resta, e lo dice.
      return risposta.code(409).send({ errore: esito.motivo });
    case "in-prova":
      return risposta.code(409).send({ errore: "L'ambiente la sta già provando." });
  }
}

function mandaImmagine(
  risposta: FastifyReply,
  trovata: { file: string; tipo: string } | undefined,
): FastifyReply {
  if (trovata === undefined) return risposta.code(404).send({ errore: "Immagine non trovata." });
  return risposta
    .header("Content-Type", trovata.tipo)
    .header("Cache-Control", "private, max-age=31536000, immutable")
    .send(createReadStream(trovata.file));
}

function hostDi(origine: string): string | undefined {
  try {
    return new URL(origine).host;
  } catch {
    return undefined;
  }
}

/**
 * Apre verso il browser un flusso di eventi inviati dal server.
 * `manda` scrive un dato, con un nome quando nello stesso flusso viaggiano dati di tipo diverso;
 * `allaChiusura` registra cosa fare quando il browser se ne va.
 */
function apriFlusso(
  richiesta: FastifyRequest,
  risposta: FastifyReply,
): { manda: (dato: unknown, nome?: string) => void; allaChiusura: (azione: () => void) => void } {
  risposta.hijack();
  const flusso = risposta.raw;
  flusso.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "X-Content-Type-Options": "nosniff",
  });
  flusso.write("retry: 2000\n\n");
  const battito = setInterval(() => flusso.write(": battito\n\n"), BATTITO_MS);
  richiesta.raw.on("close", () => clearInterval(battito));
  return {
    manda: (dato, nome) => {
      const intestazione = nome === undefined ? "" : `event: ${nome}\n`;
      flusso.write(`${intestazione}data: ${JSON.stringify(dato)}\n\n`);
    },
    allaChiusura: (azione) => {
      richiesta.raw.on("close", azione);
    },
  };
}

/** Il nome dell'estensione per cui l'interfaccia fa una richiesta, come lo scrive nell'intestazione. */
function nomeDellEstensione(valore: string | string[] | undefined): string | undefined {
  const scritto = Array.isArray(valore) ? valore[0] : valore;
  if (scritto === undefined || scritto === "") return undefined;
  let nome: string;
  try {
    nome = decodeURIComponent(scritto);
  } catch {
    nome = scritto;
  }
  return nome.replace(/[^\p{L}\p{N} ._-]/gu, "").slice(0, 60) || "senza nome";
}

/** Legge un messaggio arrivato da un nodo; nulla se non è uno di quelli previsti. */
function leggiMessaggioNodo(testo: string): MessaggioNodo | undefined {
  let letto: unknown;
  try {
    letto = JSON.parse(testo);
  } catch {
    return undefined;
  }
  if (typeof letto !== "object" || letto === null || !("tipo" in letto)) return undefined;
  if (letto.tipo === "battito") return { tipo: "battito" };
  const campi = letto as Record<string, unknown>;
  const campo = (nome: string): string | undefined => {
    const valore = campi[nome];
    return typeof valore === "string" ? valore : undefined;
  };
  switch (campi.tipo) {
    case "presentazione": {
      const idNodo = campo("idNodo");
      const segreto = campo("segreto");
      const nome = campo("nome");
      const descrizione = campo("descrizione");
      const sistema = campo("sistema");
      const radiceProgetti = campo("radiceProgetti");
      if (
        idNodo === undefined ||
        segreto === undefined ||
        nome === undefined ||
        descrizione === undefined ||
        sistema === undefined ||
        radiceProgetti === undefined
      ) {
        return undefined;
      }
      const fallito = campi.aggiornamentoFallito;
      const aggiornamentoFallito =
        typeof fallito === "object" && fallito !== null && "versione" in fallito && "motivo" in fallito && versioneValida(fallito.versione) && typeof fallito.motivo === "string"
          ? { versione: fallito.versione, motivo: fallito.motivo.slice(0, 2000) }
          : undefined;
      return {
        tipo: "presentazione",
        idNodo,
        segreto,
        ...(campo("segretoProssimo") === undefined ? {} : { segretoProssimo: campo("segretoProssimo") as string }),
        nome,
        descrizione,
        sistema,
        radiceProgetti,
        // Ciò che riguarda la versione è facoltativo: un nodo di prima non lo dice.
        ...(versioneValida(campi.versione) ? { versione: campi.versione } : {}),
        ...(campi.siAggiorna === true ? { siAggiorna: true } : {}),
        ...(aggiornamentoFallito === undefined ? {} : { aggiornamentoFallito }),
        ...(typeof campi.centro === "string" && /^https?:\/\/[A-Za-z0-9.\-[\]:]+$/.test(campi.centro) ? { centro: campi.centro } : {}),
        ...(typeof campi.avvioConWindows === "boolean" ? { avvioConWindows: campi.avvioConWindows } : {}),
        ...(Array.isArray(campi.offline) ? { offline: campi.offline.filter((id): id is string => typeof id === "string" && id.length <= 64).slice(0, 1000) } : {}),
      };
    }
    case "evento": {
      const idConversazione = campo("idConversazione");
      const evento = campi.evento;
      if (idConversazione === undefined) return undefined;
      if (typeof evento !== "object" || evento === null || !("tipo" in evento)) return undefined;
      // Il nodo si è già fatto riconoscere dal suo segreto: questo è un evento del suo lavoro.
      return { tipo: "evento", idConversazione, evento: evento as EventoConversazione };
    }
    case "id-sessione": {
      const idConversazione = campo("idConversazione");
      const idSessione = campo("idSessione");
      if (idConversazione === undefined || idSessione === undefined) return undefined;
      return { tipo: "id-sessione", idConversazione, idSessione };
    }
    case "cartella-creata": {
      const idRichiesta = campo("idRichiesta");
      const percorso = campo("percorso");
      if (idRichiesta === undefined || percorso === undefined) return undefined;
      const filePortati = campi.filePortati;
      return {
        tipo: "cartella-creata",
        idRichiesta,
        percorso,
        ...(typeof filePortati === "number" && Number.isInteger(filePortati) && filePortati >= 0
          ? { filePortati }
          : {}),
        ...(typeof campi.git === "boolean" ? { git: campi.git } : {}),
      };
    }
    case "cartella-non-creata": {
      const idRichiesta = campo("idRichiesta");
      const motivo = campo("motivo");
      if (idRichiesta === undefined || motivo === undefined) return undefined;
      return { tipo: "cartella-non-creata", idRichiesta, motivo };
    }
    case "riavvolgimento-esito": {
      const idRichiesta = campo("idRichiesta");
      if (idRichiesta === undefined) return undefined;
      const anteprima = campi.anteprima === undefined ? undefined : leggiAnteprimaRiavvolgimento(campi.anteprima);
      const motivo = campo("motivo");
      return { tipo: "riavvolgimento-esito", idRichiesta, ...(anteprima === undefined ? {} : { anteprima }), ...(motivo === undefined ? {} : { motivo: motivo.slice(0, 2000) }) };
    }
    case "risposta-della-conversazione": {
      const idRichiesta = campo("idRichiesta");
      return idRichiesta === undefined ? undefined : { tipo: "risposta-della-conversazione", idRichiesta, risposta: campi.risposta };
    }
    case "a-parte-esito": {
      const idRichiesta = campo("idRichiesta");
      const risposta = campi.risposta as Record<string, unknown> | null | undefined;
      if (idRichiesta === undefined || typeof risposta !== "object" || risposta === null) return undefined;
      if (typeof risposta.testo === "string") return { tipo: "a-parte-esito", idRichiesta, risposta: { testo: risposta.testo.slice(0, 100_000) } };
      if (typeof risposta.motivo === "string") return { tipo: "a-parte-esito", idRichiesta, risposta: { motivo: risposta.motivo.slice(0, 2000) } };
      return undefined;
    }
    case "preparazione-cominciata": {
      const idRichiesta = campo("idRichiesta");
      return idRichiesta === undefined ? undefined : { tipo: "preparazione-cominciata", idRichiesta };
    }
    case "progetto-preparato": {
      const idRichiesta = campo("idRichiesta");
      const esiti = leggiEsitiPreparazione(campi.esiti);
      if (idRichiesta === undefined || esiti === undefined) return undefined;
      return { tipo: "progetto-preparato", idRichiesta, esiti };
    }
    case "accessi-esito": {
      const idRichiesta = campo("idRichiesta");
      const esito = leggiEsitoAccessi(campi.esito);
      if (idRichiesta === undefined || esito === undefined) return undefined;
      return { tipo: "accessi-esito", idRichiesta, esito };
    }
    case "risorse-esito": {
      const idRichiesta = campo("idRichiesta");
      const risorse = leggiRisorse(campi.risorse);
      if (idRichiesta === undefined || risorse === undefined) return undefined;
      return { tipo: "risorse-esito", idRichiesta, risorse };
    }
    case "azione-conclusa": {
      const idRichiesta = campo("idRichiesta");
      const esito = leggiEsito(campi.esito);
      if (idRichiesta === undefined || esito === undefined) return undefined;
      return { tipo: "azione-conclusa", idRichiesta, esito };
    }
    case "strumento": {
      const idRichiesta = campo("idRichiesta");
      const idConversazione = campo("idConversazione");
      const nome = campo("nome");
      const argomenti = campi.argomenti;
      if (idRichiesta === undefined || idConversazione === undefined || nome === undefined) return undefined;
      if (typeof argomenti !== "object" || argomenti === null || Array.isArray(argomenti)) return undefined;
      return { tipo: "strumento", idRichiesta, idConversazione, nome, argomenti: argomenti as Record<string, unknown> };
    }
    case "estensione-provata": {
      const idRichiesta = campo("idRichiesta");
      const esito = leggiEsitoProva(campi.esito);
      if (idRichiesta === undefined || esito === undefined) return undefined;
      return { tipo: "estensione-provata", idRichiesta, esito };
    }
    case "estensioni-guardate": {
      const idRichiesta = campo("idRichiesta");
      const motivo = campo("motivo");
      const viste = campi.viste === undefined ? undefined : leggiEstensioniDellAmbiente(campi.viste);
      if (idRichiesta === undefined || (campi.viste !== undefined && viste === undefined)) return undefined;
      return { tipo: "estensioni-guardate", idRichiesta, ...(viste === undefined ? {} : { viste }), ...(motivo === undefined ? {} : { motivo }) };
    }
    case "chiavi-richieste": {
      const idRichiesta = campo("idRichiesta");
      const estensione = campo("estensione");
      if (idRichiesta === undefined || estensione === undefined) return undefined;
      return { tipo: "chiavi-richieste", idRichiesta, estensione };
    }
    case "processo-terminato": {
      const idRichiesta = campo("idRichiesta");
      const testo = campo("testo");
      if (idRichiesta === undefined || testo === undefined || typeof campi.riuscita !== "boolean") return undefined;
      return { tipo: "processo-terminato", idRichiesta, riuscita: campi.riuscita, testo: testo.slice(0, 2000) };
    }
    case "modello-preso": {
      const idPresa = campo("idPresa");
      if (idPresa === undefined) return undefined;
      const motivo = campo("motivo");
      const porta = campi.porta;
      return {
        tipo: "modello-preso",
        idPresa,
        ...(typeof porta === "number" && Number.isInteger(porta) && porta > 0 && porta < 65536 ? { porta } : {}),
        ...(motivo === undefined ? {} : { motivo: motivo.slice(0, 2000) }),
      };
    }
    case "ponte-esito": {
      const porta = campi.porta;
      const motivo = campo("motivo");
      return {
        tipo: "ponte-esito",
        ...(typeof porta === "number" && Number.isInteger(porta) && porta > 0 && porta < 65536 ? { porta } : {}),
        ...(motivo === undefined ? {} : { motivo: motivo.slice(0, 500) }),
      };
    }
    case "avvio-con-windows-esito": {
      const idRichiesta = campo("idRichiesta");
      if (idRichiesta === undefined) return undefined;
      const motivo = campo("motivo");
      return {
        tipo: "avvio-con-windows-esito",
        idRichiesta,
        ...(typeof campi.attivo === "boolean" ? { attivo: campi.attivo } : {}),
        ...(motivo === undefined ? {} : { motivo: motivo.slice(0, 2000) }),
      };
    }
    case "aggiornamento-pronto": {
      const idRichiesta = campo("idRichiesta");
      return idRichiesta === undefined ? undefined : { tipo: "aggiornamento-pronto", idRichiesta };
    }
    case "aggiornamento-non-riuscito": {
      const idRichiesta = campo("idRichiesta");
      const motivo = campo("motivo");
      if (idRichiesta === undefined || motivo === undefined) return undefined;
      return { tipo: "aggiornamento-non-riuscito", idRichiesta, motivo: motivo.slice(0, 4000) };
    }
    default:
      return leggiRiferitoTerminale(campi) ?? leggiRiferitoAnteprima(campi) ?? leggiRiferitoApplicazione(campi) ?? leggiRiferitoFile(campi) ?? leggiConsegnaOffline(campi);
  }
}

/** Ciò che si può chiedere della storia di una conversazione (ADR 0046). */
interface RichiestaDiStoria {
  dopo?: string;
  limite?: string;
  versione?: string;
}

function numeroDa(testo: string | undefined): number | undefined {
  if (testo === undefined || !/^\d{1,12}$/.test(testo)) return undefined;
  return Number(testo);
}

function pezzoChiesto(query: RichiestaDiStoria): { dopo?: number; limite?: number; versione?: string } {
  const dopo = numeroDa(query.dopo);
  const limite = numeroDa(query.limite);
  return {
    ...(dopo === undefined ? {} : { dopo }),
    ...(limite === undefined ? {} : { limite }),
    ...(query.versione === undefined ? {} : { versione: query.versione.slice(0, 64) }),
  };
}

/** Da dove riprende un flusso: solo se chi lo apre dice la versione della copia che ha. */
function daDoveRiprendere(query: RichiestaDiStoria): { dopo: number; versione: string } | undefined {
  if (query.versione === undefined) return undefined;
  return { dopo: numeroDa(query.dopo) ?? 0, versione: query.versione.slice(0, 64) };
}

/**
 * Manda la storia di un canale e poi i suoi eventi nuovi. Con `da`, se la copia di chi chiede vale,
 * solo gli eventi archiviati dopo; altrimenti prima `azzera`. Alla fine della storia, l'indice.
 */
function seguiDaDove(
  canale: Canale,
  flusso: { manda: (dati: unknown, nome?: string) => void; allaChiusura: (fai: () => void) => void },
  da: { dopo: number; versione: string } | undefined,
): void {
  const riprende = da !== undefined && canale.riprendibile(da.dopo, da.versione);
  if (da !== undefined && !riprende) flusso.manda({}, "azzera");
  flusso.allaChiusura(canale.iscrivi(flusso.manda, riprende ? da.dopo : 0));
  flusso.manda(canale.indice, FINE_STORIA);
}

/**
 * Le rotte di una chat parallela della Home (ADR 0052): `/api/home/chat/N/…` diventa `/api/home/…`
 * con `chat=N` tra i parametri. Gli altri indirizzi restano come sono.
 */
export function indirizzoDellaChat(indirizzo: string): string {
  const trovato = /^\/api\/home\/chat\/(\d+)(\/[^?]*)(\?.*)?$/.exec(indirizzo);
  if (trovato === null) return indirizzo;
  const [, numero, resto, parametri] = trovato;
  return `/api/home${resto}${parametri === undefined ? "?" : `${parametri}&`}chat=${numero}`;
}

/** Il numero della chat parallela indicato in un indirizzo della Home; nulla per la principale. */
export function numeroDellaChatNellIndirizzo(indirizzo: string): number | undefined {
  const domanda = indirizzo.indexOf("?");
  if (domanda < 0) return undefined;
  const valore = new URLSearchParams(indirizzo.slice(domanda + 1)).get("chat");
  if (valore === null) return undefined;
  const numero = Number(valore);
  return Number.isInteger(numero) ? numero : -1;
}
