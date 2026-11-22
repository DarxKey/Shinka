/**
 * Il servizio del gateway. Ha due porte d'ingresso separate:
 *
 * - `/api/…` è per il centro, che si presenta con un gettone. Da qui si chiede lo stato del
 *   vault, l'uso di una credenziale per nome, un'operazione del browser del gateway, un'operazione
 *   su uno stack di prova, la decisione del proprietario su un comando in attesa e il registro.
 *   Da qui il centro propone anche una versione nuova del gateway: la può proporre, non decidere.
 *   Nessuna di queste chiamate restituisce un valore, né inserisce, sostituisce o rimuove una
 *   credenziale, né cambia quali host sono host per gli stack. Le eccezioni, scelte dal
 *   proprietario, sono due. Le chiavi delle estensioni: il centro le chiede quando un'estensione
 *   parte, e riceve solo le voci inserite come chiave di quell'estensione. Le credenziali in chiaro
 *   (ADR 0034): il centro ne legge il valore per Claude, e solo di quelle inserite così; e propone
 *   quelle che Claude vuole salvare, che il gateway tiene da parte finché il proprietario non le
 *   approva dalla scheda nella conversazione. Da qui passano anche i messaggi
 *   di Telegram: quelli del proprietario verso il centro, quelli del centro verso di lui. Il
 *   token del bot e la scelta di chi è il proprietario non si toccano da qui.
 * - `/vault/…` e la pagina sono per il proprietario, che si presenta con la frase di sblocco.
 *   Frase e valori vanno dal suo browser al gateway senza passare dal centro, dove girano
 *   le conversazioni. Nemmeno da qui un valore torna indietro. Qui il proprietario risponde anche
 *   alle domande che il gateway gli fa da sé: una versione nuova del gateway, un comando sul server.
 */

import fastifyCookie from "@fastify/cookie";
import fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OPERAZIONI_STACK, type EsitoStack, type RichiestaStack } from "../protocollo/stack.ts";
import {
  DATO_PULSANTE_MASSIMO,
  FILE_TELEGRAM_MASSIMO,
  PULSANTI_PER_RIGA,
  RIGHE_DI_PULSANTI,
  TESTO_PULSANTE_MASSIMO,
  TESTO_TELEGRAM_MASSIMO,
  type EsitoTelegram,
  type EventiTelegram,
  type MessaggioTelegram,
  type StatoTelegram,
  type TelegramInVista,
} from "../protocollo/telegram.ts";
import {
  AZIONI_NEL_SITO,
  CHIAVI_PER_ESTENSIONE,
  COMANDO_SU_HOST_MASSIMO,
  INDIRIZZO_SITO_MASSIMO,
  SECONDI_COMANDO_SU_HOST_MASSIMI,
  SEGRETO_MASSIMO,
  TESTO_NEL_SITO_MASSIMO,
  type DecisioneApprovazione,
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
  type DomandaDelGateway,
  type StatoDelGateway,
} from "../protocollo/vault.ts";
import { PESO_MASSIMO, type AggiornamentoDelGateway as StatoAggiornamento, type EsitoProposta } from "../protocollo/versione.ts";
import type { DockerDiUnHost } from "../protocollo/risorse.ts";
import type { AggiornamentoDelGateway } from "./aggiornamento.ts";
import type { PortaBrowser } from "./browser.ts";
import { consegnaChiavi } from "./chiavi.ts";
import { CredenzialiInChiaro } from "./in-chiaro.ts";
import type { DomandeAlProprietario } from "./domande.ts";
import type { Registro } from "./registro.ts";
import type { StackDiProva } from "./stack.ts";
import { TelegramRifiutato, type Telegram } from "./telegram.ts";
import type { Operazioni } from "./uso.ts";
import { CredenzialeRifiutata, VaultChiuso, type CredenzialeDaCustodire, type Vault } from "./vault.ts";

export const COOKIE_VAULT = "shinka_vault";

/** Dopo quanto tempo senza richieste il proprietario deve riscrivere la frase nella pagina. */
const SESSIONE_INATTIVA_MS = 15 * 60 * 1000;

/** Quante righe del registro si vedono in una volta. */
const RIGHE_REGISTRO = 100;

const POLITICA_CONTENUTI = [
  "default-src 'none'",
  "style-src 'self'",
  "script-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const CORPO_FRASE = {
  type: "object",
  required: ["frase"],
  additionalProperties: false,
  properties: { frase: { type: "string", minLength: 1, maxLength: 1024 } },
} as const;

const CORPO_CREDENZIALE = {
  type: "object",
  required: ["nome", "tipo", "utente", "host", "segreto"],
  additionalProperties: false,
  properties: {
    nome: { type: "string", maxLength: 100 },
    tipo: { enum: ["password", "chiave", "sito", "estensione"] },
    estensione: { type: "string", maxLength: 100 },
    utente: { type: "string", maxLength: 200 },
    host: { type: "array", maxItems: 100, items: { type: "string", maxLength: 300 } },
    segreto: { type: "string", maxLength: SEGRETO_MASSIMO * 2 },
    fraseDellaChiave: { type: "string", maxLength: 1024 },
    stack: {
      type: "object",
      required: ["porte", "radice"],
      additionalProperties: false,
      properties: {
        porte: {
          type: "object",
          required: ["da", "a"],
          additionalProperties: false,
          properties: { da: { type: "integer" }, a: { type: "integer" } },
        },
        radice: { type: "string", maxLength: 300 },
      },
    },
    server: { type: "boolean" },
    inChiaro: { type: "boolean" },
  },
} as const;

const CORPO_IN_CHIARO = {
  type: "object",
  required: ["conversazione", "nome", "tipo", "utente", "host", "segreto"],
  additionalProperties: false,
  properties: {
    conversazione: { type: "string", maxLength: 300 },
    nome: { type: "string", maxLength: 100 },
    tipo: { enum: ["password", "chiave", "sito"] },
    utente: { type: "string", maxLength: 300 },
    host: { type: "array", minItems: 1, maxItems: 100, items: { type: "string", maxLength: 300 } },
    segreto: { type: "string", minLength: 1, maxLength: SEGRETO_MASSIMO * 2 },
    fraseDellaChiave: { type: "string", maxLength: 1024 },
  },
} as const;

const CORPO_LETTURA = {
  type: "object",
  required: ["conversazione", "credenziale", "dove"],
  additionalProperties: false,
  properties: {
    conversazione: { type: "string", maxLength: 300 },
    credenziale: { type: "string", maxLength: 100 },
    dove: { type: "string", maxLength: 300 },
  },
} as const;

const CORPO_CHIAVI = {
  type: "object",
  required: ["estensione", "ambiente", "chiavi"],
  additionalProperties: false,
  properties: {
    estensione: { type: "string", minLength: 1, maxLength: 100 },
    ambiente: { type: "string", minLength: 1, maxLength: 200 },
    chiavi: { type: "array", minItems: 1, maxItems: CHIAVI_PER_ESTENSIONE, items: { type: "string", minLength: 1, maxLength: 100 } },
  },
} as const;

const CORPO_DECISIONE = {
  type: "object",
  required: ["decisione"],
  additionalProperties: false,
  properties: { decisione: { enum: ["approvata", "negata", "scaduta"] } },
} as const;

/** Dalla pagina del vault il proprietario dice sì o no: la scadenza la decide il tempo, non lui. */
const CORPO_RISPOSTA = {
  type: "object",
  required: ["decisione"],
  additionalProperties: false,
  properties: { decisione: { enum: ["approvata", "negata"] } },
} as const;

/** Per quanto al massimo il centro aspetta, in una richiesta, che il proprietario risponda al gateway. */
const ATTESA_APPROVAZIONE_S = 50;

const CORPO_GETTONE_TELEGRAM = {
  type: "object",
  required: ["gettone"],
  additionalProperties: false,
  properties: { gettone: { type: "string", minLength: 1, maxLength: 200 } },
} as const;

/** Un messaggio del centro per il proprietario. Con i segni di formato il testo scritto è più lungo di quello letto. */
const CORPO_MESSAGGIO_TELEGRAM = {
  type: "object",
  required: ["testo"],
  additionalProperties: false,
  properties: {
    testo: { type: "string", minLength: 1, maxLength: TESTO_TELEGRAM_MASSIMO * 6 },
    html: { type: "boolean" },
    silenzioso: { type: "boolean" },
    pulsanti: {
      type: "array",
      maxItems: RIGHE_DI_PULSANTI,
      items: {
        type: "array",
        minItems: 1,
        maxItems: PULSANTI_PER_RIGA,
        items: {
          type: "object",
          required: ["testo", "dato"],
          additionalProperties: false,
          properties: {
            testo: { type: "string", minLength: 1, maxLength: TESTO_PULSANTE_MASSIMO },
            dato: { type: "string", minLength: 1, maxLength: DATO_PULSANTE_MASSIMO },
          },
        },
      },
    },
  },
} as const;

/** Quanto al massimo il centro aspetta, in una richiesta, che il proprietario scriva qualcosa. */
const ATTESA_EVENTI_TELEGRAM_S = 50;

const TELEGRAM_ASSENTE = "In questa installazione il gateway non ha il bot Telegram. Dillo al proprietario.";

/** La descrizione di uno stack la legge e la controlla `StackDiProva`: qui passa com'è. */
const CORPO_STACK = {
  type: "object",
  required: ["conversazione", "operazione"],
  additionalProperties: false,
  properties: {
    conversazione: { type: "string", maxLength: 300 },
    operazione: { enum: [...OPERAZIONI_STACK] },
    host: { type: "string", maxLength: 300 },
    nome: { type: "string", maxLength: 100 },
    righe: { type: "integer", minimum: 1, maximum: 10_000 },
    tieniDati: { type: "boolean" },
    stack: { type: "object" },
  },
} as const;

/** Controlla che la richiesta sugli stack abbia ciò che serve alla sua operazione. */
function richiestaStack(corpo: Record<string, unknown>): RichiestaStack | undefined {
  const scritto = (nome: string): boolean => typeof corpo[nome] === "string";
  switch (corpo.operazione) {
    case "elenca":
      return corpo as RichiestaStack;
    case "avvia":
      return scritto("host") && typeof corpo.stack === "object" ? (corpo as RichiestaStack) : undefined;
    case "ferma":
    case "leggi":
    case "rimuovi":
      return scritto("host") && scritto("nome") ? (corpo as RichiestaStack) : undefined;
    default:
      return undefined;
  }
}

const CORPO_USO = {
  type: "object",
  required: ["credenziale", "host", "comando", "conversazione"],
  additionalProperties: false,
  properties: {
    credenziale: { type: "string", maxLength: 100 },
    host: { type: "string", maxLength: 300 },
    comando: { type: "string", maxLength: COMANDO_SU_HOST_MASSIMO * 2 },
    secondi: { type: "integer", minimum: 1, maximum: SECONDI_COMANDO_SU_HOST_MASSIMI },
    conversazione: { type: "string", maxLength: 300 },
  },
} as const;

const CORPO_BROWSER = {
  type: "object",
  required: ["conversazione", "chiave", "operazione"],
  additionalProperties: false,
  properties: {
    conversazione: { type: "string", maxLength: 300 },
    chiave: { type: "string", minLength: 1, maxLength: 200 },
    operazione: { enum: ["apri", "leggi", "agisci", "inserisci", "chiudi"] },
    indirizzo: { type: "string", maxLength: INDIRIZZO_SITO_MASSIMO * 2 },
    immagine: { type: "boolean" },
    azione: { enum: [...AZIONI_NEL_SITO] },
    elemento: { type: "string", maxLength: 40 },
    testo: { type: "string", maxLength: TESTO_NEL_SITO_MASSIMO * 2 },
    invio: { type: "boolean" },
    credenziale: { type: "string", maxLength: 100 },
    campoUtente: { type: "string", maxLength: 40 },
    campoPassword: { type: "string", maxLength: 40 },
  },
} as const;

/** Controlla che la richiesta al browser abbia ciò che serve alla sua operazione. */
function richiestaBrowser(corpo: Record<string, unknown>): RichiestaBrowser | undefined {
  const scritto = (nome: string): boolean => typeof corpo[nome] === "string";
  switch (corpo.operazione) {
    case "apri":
      return scritto("indirizzo") ? (corpo as RichiestaBrowser) : undefined;
    case "agisci":
      return scritto("azione") ? (corpo as RichiestaBrowser) : undefined;
    case "inserisci":
      return scritto("credenziale") ? (corpo as RichiestaBrowser) : undefined;
    case "leggi":
    case "chiudi":
      return corpo as RichiestaBrowser;
    default:
      return undefined;
  }
}

/** Rallenta chi prova a indovinare la frase: dopo tre errori l'attesa raddoppia ogni volta. */
class Freno {
  #falliti = 0;
  #fino = 0;

  attesaMs(ora: number): number {
    return Math.max(0, this.#fino - ora);
  }

  fallito(ora: number): void {
    this.#falliti += 1;
    if (this.#falliti >= 3) this.#fino = ora + Math.min(2 ** (this.#falliti - 3), 300) * 1000;
  }

  riuscito(): void {
    this.#falliti = 0;
    this.#fino = 0;
  }
}

/** Le sessioni del proprietario nella pagina del vault: stanno solo in memoria. */
class Sessioni {
  readonly #scadenze = new Map<string, number>();

  apri(ora: number): string {
    const gettone = randomBytes(32).toString("base64url");
    this.#scadenze.set(gettone, ora + SESSIONE_INATTIVA_MS);
    return gettone;
  }

  /** Vero se la sessione è valida; in quel caso la sua scadenza si allontana. */
  valida(gettone: string | undefined, ora: number): boolean {
    if (gettone === undefined) return false;
    const scadenza = this.#scadenze.get(gettone);
    if (scadenza === undefined) return false;
    if (scadenza < ora) {
      this.#scadenze.delete(gettone);
      return false;
    }
    this.#scadenze.set(gettone, ora + SESSIONE_INATTIVA_MS);
    return true;
  }

  chiudi(gettone: string | undefined): void {
    if (gettone !== undefined) this.#scadenze.delete(gettone);
  }

  chiudiTutte(): void {
    this.#scadenze.clear();
  }
}

function hostDi(origine: string): string | undefined {
  try {
    return new URL(origine).host;
  } catch {
    return undefined;
  }
}

function stessoTesto(a: string, b: string): boolean {
  const primo = Buffer.from(a);
  const secondo = Buffer.from(b);
  return primo.length === secondo.length && timingSafeEqual(primo, secondo);
}

export interface OpzioniGateway {
  vault: Vault;
  registro: Registro;
  operazioni: Operazioni;
  /** Gli stack di prova sugli host del lab. Se manca, le operazioni sugli stack vengono rifiutate. */
  stack?: StackDiProva;
  /** Il browser con cui Claude entra nei siti. Se manca, le operazioni del browser vengono rifiutate. */
  browser?: PortaBrowser;
  /** Il bot Telegram. Se manca, in questa installazione Telegram non c'è. */
  telegram?: Telegram;
  /** Le domande che il gateway fa al proprietario da sé. Se mancano, la pagina non ne mostra. */
  domande?: DomandeAlProprietario;
  /** Il cambio di versione del gateway. Se manca, una versione nuova si mette solo da fuori. */
  aggiornamento?: AggiornamentoDelGateway;
  /** Le credenziali in chiaro: lette e proposte da Claude. Se mancano, il gateway ne tiene di sue. */
  inChiaro?: CredenzialiInChiaro;
  /** Il gettone con cui il centro si presenta. */
  gettone: string;
  /** Vero quando la pagina è servita in HTTPS: il cookie viaggia solo cifrato. */
  cookieSicuro?: boolean;
}

export async function creaGateway(opzioni: OpzioniGateway): Promise<FastifyInstance> {
  const { vault, registro, operazioni, browser, stack, telegram, domande, aggiornamento } = opzioni;
  const app = fastify({ bodyLimit: 128 * 1024, forceCloseConnections: true });
  // Chi aspettava i messaggi di Telegram va lasciato andare prima che il servizio si chiuda.
  app.addHook("preClose", async () => {
    telegram?.ferma();
    domande?.ferma();
  });
  app.addHook("onClose", async () => {
    await browser?.chiudi();
  });
  await app.register(fastifyCookie);

  const inChiaro = opzioni.inChiaro ?? new CredenzialiInChiaro(vault, registro);
  const sessioni = new Sessioni();
  const freno = new Freno();
  /** I tentativi con la frase si fanno uno alla volta: ricavare la chiave costa memoria. */
  let tentativi: Promise<unknown> = Promise.resolve();

  const cartellaPagina = join(import.meta.dirname, "pagina");
  const pagina = {
    html: readFileSync(join(cartellaPagina, "vault.html")),
    css: readFileSync(join(cartellaPagina, "vault.css")),
    js: readFileSync(join(cartellaPagina, "vault.js")),
  };

  const dentro = (richiesta: FastifyRequest): boolean =>
    vault.condizione === "aperto" && sessioni.valida(richiesta.cookies[COOKIE_VAULT], Date.now());

  const apriSessione = (risposta: FastifyReply): void => {
    risposta.setCookie(COOKIE_VAULT, sessioni.apri(Date.now()), {
      httpOnly: true,
      sameSite: "strict",
      secure: opzioni.cookieSicuro === true,
      // Solo per i percorsi del vault: il browser non lo manda al centro, che sta sullo stesso host.
      path: "/vault",
    });
  };

  app.addHook("onRequest", async (richiesta, risposta) => {
    if (richiesta.method !== "GET" && richiesta.method !== "HEAD") {
      // Le richieste che cambiano qualcosa devono arrivare dalla pagina del gateway stesso.
      const origine = richiesta.headers.origin;
      if (origine !== undefined && hostDi(origine) !== richiesta.headers.host) {
        return risposta.code(403).send({ errore: "Origine non ammessa." });
      }
    }
    if (richiesta.url.startsWith("/api/")) {
      const intestazione = richiesta.headers.authorization ?? "";
      if (!intestazione.startsWith("Bearer ") || !stessoTesto(intestazione.slice(7), opzioni.gettone)) {
        return risposta.code(401).send({ errore: "Gettone non valido." });
      }
      return;
    }
    // Il ripristino è libero solo dove non c'è ancora un vault: lo guarda la sua rotta.
    const libero = ["/vault/stato", "/vault/frase", "/vault/sblocco", "/vault/uscita", "/vault/ripristino"].some(
      (percorso) => richiesta.url === percorso || richiesta.url.startsWith(`${percorso}?`),
    );
    if (richiesta.url.startsWith("/vault/") && !libero && !dentro(richiesta)) {
      return risposta.code(401).send({ errore: "Serve la frase di sblocco." });
    }
  });

  app.addHook("onSend", async (_richiesta, risposta) => {
    risposta.header("X-Content-Type-Options", "nosniff");
    risposta.header("Referrer-Policy", "no-referrer");
    risposta.header("Content-Security-Policy", POLITICA_CONTENUTI);
    risposta.header("Cache-Control", "no-store");
  });

  // La pagina del vault.
  app.get("/", (_richiesta, risposta) => risposta.type("text/html; charset=utf-8").send(pagina.html));
  app.get("/vault.css", (_richiesta, risposta) => risposta.type("text/css; charset=utf-8").send(pagina.css));
  app.get("/vault.js", (_richiesta, risposta) => risposta.type("text/javascript; charset=utf-8").send(pagina.js));

  // ── Per il centro ──────────────────────────────────────────────────────────

  /** Ciò che il gateway dice della propria versione: al centro, e al proprietario nella pagina. */
  const diSe = (): { versione?: string; siAggiorna?: true; aggiornamento?: StatoAggiornamento } => {
    const versione = aggiornamento?.versione;
    const stato = aggiornamento?.stato;
    return {
      ...(versione === undefined ? {} : { versione }),
      ...(aggiornamento?.colGuardiano === true ? { siAggiorna: true as const } : {}),
      ...(stato === undefined ? {} : { aggiornamento: stato }),
    };
  };

  app.get("/api/stato", async (): Promise<StatoDelGateway> => ({
    condizione: vault.condizione,
    credenziali: vault.condizione === "aperto" ? vault.elenco() : [],
    ...diSe(),
  }));

  // Il centro propone una versione nuova del gateway. Qui non si decide nulla: il gateway guarda
  // che cosa cambierebbe e, se cambia qualcosa, chiede il sì al proprietario lui stesso.
  app.post<{ Body: Record<string, unknown> }>(
    "/api/aggiornamento",
    { bodyLimit: PESO_MASSIMO + 1024 * 1024, schema: { body: { type: "object" } } },
    async (richiesta): Promise<EsitoProposta> => {
      if (aggiornamento === undefined) {
        return { esito: "rifiutato", motivo: "Questo gateway non sa cambiare versione da dentro: una versione nuova la mette chi lavora da fuori." };
      }
      const { versione, riassunto, file } = richiesta.body;
      return aggiornamento.proponi({ versione, riassunto, file });
    },
  );

  // Il centro ritira la proposta: vale come un no del proprietario.

  app.post<{ Body: RichiestaUso }>("/api/uso", { schema: { body: CORPO_USO } }, (richiesta) =>
    operazioni.usa(richiesta.body),
  );

  app.post<{ Body: Record<string, unknown> }>("/api/browser", { schema: { body: CORPO_BROWSER } }, async (richiesta): Promise<EsitoBrowser> => {
    const letta = richiestaBrowser(richiesta.body);
    if (letta === undefined) return { esito: "rifiutato", motivo: "Alla richiesta manca ciò che serve a questa operazione." };
    if (browser === undefined) {
      return { esito: "rifiutato", motivo: "In questa installazione il gateway non ha un browser. Dillo al proprietario." };
    }
    return browser.esegui(letta);
  });

  // Il proprietario ha deciso di un comando che aspettava la sua approvazione: il comando è
  // quello che il gateway aveva tenuto da parte, non uno che arriva adesso.
  app.post<{ Params: { id: string }; Body: { decisione: DecisioneApprovazione } }>(
    "/api/approvazioni/:id",
    { schema: { body: CORPO_DECISIONE } },
    (richiesta): Promise<EsitoUso> => operazioni.decidi(richiesta.params.id, richiesta.body.decisione),
  );

  // Com'è finito un comando per cui il sì lo raccoglie il gateway: il centro non lo può dare, e
  // viene qui a chiedere. Se il proprietario non ha ancora deciso, la risposta aspetta un po'.
  app.get<{ Params: { id: string }; Querystring: { attesa?: string } }>("/api/approvazioni/:id", (richiesta): Promise<EsitoUso> => {
    const attesa = Number(richiesta.query.attesa ?? "0");
    return operazioni.attendi(richiesta.params.id, Number.isFinite(attesa) ? Math.min(Math.max(attesa, 0), ATTESA_APPROVAZIONE_S) * 1000 : 0);
  });

  app.post<{ Body: Record<string, unknown> }>("/api/stack", { schema: { body: CORPO_STACK } }, async (richiesta): Promise<EsitoStack> => {
    const letta = richiestaStack(richiesta.body);
    if (letta === undefined) return { esito: "rifiutato", motivo: "Alla richiesta manca ciò che serve a questa operazione." };
    if (stack === undefined) {
      return { esito: "rifiutato", motivo: "In questa installazione il gateway non gestisce stack di prova. Dillo al proprietario." };
    }
    return stack.esegui(letta);
  });

  // I container degli host per gli stack, con le loro risorse: per la pagina con cui il proprietario
  // guarda i suoi ambienti. Sola lettura, con un comando che il centro non sceglie.
  app.get("/api/contenitori", async (): Promise<{ host: DockerDiUnHost[] } | { motivo: string }> => {
    if (stack === undefined) return { motivo: "In questa installazione il gateway non gestisce host Docker." };
    try {
      return { host: await stack.contenitori() };
    } catch (errore) {
      if (errore instanceof VaultChiuso) return { motivo: errore.message };
      throw errore;
    }
  });

  // Un'estensione sta per partire in un ambiente e chiede le sue chiavi. Escono solo le voci
  // inserite come chiave di quell'estensione e per quell'ambiente; ogni consegna va nel registro.
  app.post<{ Body: RichiestaChiavi }>(
    "/api/chiavi-estensione",
    { schema: { body: CORPO_CHIAVI } },
    (richiesta): Promise<EsitoChiavi> => consegnaChiavi(vault, registro, richiesta.body),
  );

  // Le credenziali in chiaro: Claude ne legge il valore, per un host o un sito in cui valgono, e
  // ne propone di nuove, che entrano nel vault solo con il sì del proprietario dalla scheda.
  app.post<{ Body: RichiestaLettura }>("/api/in-chiaro/lettura", { schema: { body: CORPO_LETTURA } }, (richiesta): Promise<EsitoLettura> =>
    inChiaro.leggi(richiesta.body),
  );

  app.post<{ Body: RichiestaInChiaro }>("/api/in-chiaro", { schema: { body: CORPO_IN_CHIARO } }, (richiesta): Promise<EsitoInChiaro> =>
    inChiaro.proponi(richiesta.body),
  );

  // La decisione del proprietario: si salva ciò che il gateway aveva tenuto da parte, non ciò che arriva adesso.
  app.post<{ Params: { id: string }; Body: { decisione: DecisioneApprovazione } }>(
    "/api/in-chiaro/:id",
    { schema: { body: CORPO_DECISIONE } },
    (richiesta): Promise<EsitoInChiaro> => inChiaro.decidi(richiesta.params.id, richiesta.body.decisione),
  );

  app.get("/api/registro", async () => ({ voci: registro.ultime(RIGHE_REGISTRO) }));

  // Telegram, per il centro: lo stato del bot, ciò che il proprietario ha scritto o premuto, e i
  // messaggi per lui. Il destinatario lo mette il gateway: il centro non può scrivere ad altri.
  app.get("/api/telegram", async (): Promise<StatoTelegram> => telegram?.stato ?? { condizione: "da-configurare" });

  app.get<{ Querystring: { dopo?: string; attesa?: string } }>("/api/telegram/eventi", async (richiesta): Promise<EventiTelegram> => {
    if (telegram === undefined) return { stato: { condizione: "da-configurare" }, eventi: [] };
    const dopo = Number(richiesta.query.dopo ?? "0");
    const attesa = Number(richiesta.query.attesa ?? "0");
    return telegram.eventi(
      Number.isFinite(dopo) ? dopo : 0,
      Number.isFinite(attesa) ? Math.min(Math.max(attesa, 0), ATTESA_EVENTI_TELEGRAM_S) * 1000 : 0,
    );
  });

  app.post<{ Body: MessaggioTelegram }>(
    "/api/telegram/messaggi",
    { schema: { body: CORPO_MESSAGGIO_TELEGRAM } },
    async (richiesta): Promise<EsitoTelegram> =>
      telegram === undefined ? { esito: "rifiutato", motivo: TELEGRAM_ASSENTE } : telegram.invia(richiesta.body),
  );

  app.post<{ Params: { id: string }; Body: MessaggioTelegram }>(
    "/api/telegram/messaggi/:id",
    { schema: { body: CORPO_MESSAGGIO_TELEGRAM } },
    async (richiesta): Promise<EsitoTelegram> => {
      const id = Number(richiesta.params.id);
      if (telegram === undefined) return { esito: "rifiutato", motivo: TELEGRAM_ASSENTE };
      if (!Number.isSafeInteger(id) || id <= 0) return { esito: "rifiutato", motivo: "Quel messaggio non si riconosce." };
      return telegram.modifica(id, richiesta.body);
    },
  );

  // Un file per il proprietario: il contenuto arriva così com'è, il resto nell'indirizzo. Solo qui
  // il gateway accetta un corpo così grande, e solo dopo che il centro si è presentato.
  await app.register(async (ambito) => {
    ambito.addContentTypeParser(
      "application/octet-stream",
      { parseAs: "buffer", bodyLimit: FILE_TELEGRAM_MASSIMO },
      (_richiesta, corpo, fatto) => fatto(null, corpo),
    );
    ambito.post<{ Querystring: { nome?: string; tipo?: string; didascalia?: string; foto?: string }; Body: unknown }>(
      "/api/telegram/file",
      { bodyLimit: FILE_TELEGRAM_MASSIMO },
      async (richiesta, risposta): Promise<EsitoTelegram> => {
        if (telegram === undefined) return { esito: "rifiutato", motivo: TELEGRAM_ASSENTE };
        const { nome, tipo, didascalia, foto } = richiesta.query;
        if (!Buffer.isBuffer(richiesta.body) || typeof nome !== "string" || typeof tipo !== "string") {
          void risposta.code(400);
          return { esito: "rifiutato", motivo: "Servono il file, il suo nome e il suo tipo." };
        }
        return telegram.inviaFile(
          {
            nome,
            tipo,
            ...(typeof didascalia === "string" ? { didascalia } : {}),
            ...(foto === "1" ? { comeFoto: true } : {}),
          },
          richiesta.body,
        );
      },
    );
  });

  // Il contenuto di un file che il proprietario ha mandato al bot: solo di quelli, e così com'è.
  app.get<{ Params: { id: string } }>("/api/telegram/ricevuti/:id", async (richiesta, risposta) => {
    if (telegram === undefined) return risposta.code(404).send({ errore: TELEGRAM_ASSENTE });
    if (!/^[\w-]{1,200}$/.test(richiesta.params.id)) return risposta.code(400).send({ errore: "File non riconosciuto." });
    const letto = await telegram.scaricaFile(richiesta.params.id);
    if ("problema" in letto) return risposta.code(404).send({ errore: letto.problema });
    return risposta.header("Content-Type", "application/octet-stream").send(letto.dati);
  });

  app.post("/api/telegram/scrive", async () => {
    await telegram?.scrive();
    return {};
  });

  // ── Per il proprietario ────────────────────────────────────────────────────

  // Quante domande aspettano si può dire a chiunque apra la pagina; che cosa chiedono, solo dopo la frase.
  app.get("/vault/stato", async (richiesta) => ({
    condizione: vault.condizione,
    dentro: dentro(richiesta),
    ...((domande?.inVista().length ?? 0) > 0 ? { domande: domande?.inVista().length } : {}),
  }));

  /** Prova la frase, uno alla volta e con il freno. Restituisce quanti secondi aspettare, se troppi errori. */
  const conLaFrase = async (
    risposta: FastifyReply,
    lavoro: () => Promise<boolean>,
    rifiuto: string,
  ): Promise<unknown> => {
    const attesa = freno.attesaMs(Date.now());
    if (attesa > 0) {
      return risposta.code(429).send({
        errore: `Troppi tentativi sbagliati: riprova tra ${Math.ceil(attesa / 1000)} secondi.`,
      });
    }
    const tentativo = tentativi.then(lavoro);
    tentativi = tentativo.catch(() => {});
    let riuscito: boolean;
    try {
      riuscito = await tentativo;
    } catch (errore) {
      if (errore instanceof CredenzialeRifiutata) return risposta.code(400).send({ errore: errore.message });
      throw errore;
    }
    if (!riuscito) {
      freno.fallito(Date.now());
      return risposta.code(401).send({ errore: rifiuto });
    }
    freno.riuscito();
    apriSessione(risposta);
    return { condizione: vault.condizione, dentro: true };
  };

  app.post<{ Body: { frase: string } }>("/vault/frase", { schema: { body: CORPO_FRASE } }, (richiesta, risposta) =>
    conLaFrase(
      risposta,
      async () => {
        await vault.imposta(richiesta.body.frase);
        return true;
      },
      "La frase non è stata accettata.",
    ),
  );

  app.post<{ Body: { frase: string } }>("/vault/sblocco", { schema: { body: CORPO_FRASE } }, (richiesta, risposta) =>
    conLaFrase(risposta, () => vault.sblocca(richiesta.body.frase), "La frase di sblocco non è quella."),
  );

  // La copia del vault: il file com'è, cifrato con la frase. La scarica il proprietario da qui, e
  // non passa dal centro né da una conversazione.
  app.get("/vault/copia", async (_richiesta, risposta) => {
    const copia = await vault.copia();
    if (copia === undefined) return risposta.code(404).send({ errore: "Il vault non è ancora stato impostato." });
    await registro.annota({
      quando: copia.quando,
      credenziale: "",
      host: "il vault",
      conversazione: "il proprietario, dalla pagina del vault",
      comando: "Copia del vault scaricata",
      esito: "eseguito",
    });
    return risposta
      .header("Content-Disposition", `attachment; filename="shinka-vault-${copia.quando.slice(0, 10)}.json"`)
      .type("application/json; charset=utf-8")
      .send(`${JSON.stringify(copia)}\n`);
  });

  // Una copia del vault al posto del vault: da dentro, oppure dove un vault non c'è ancora. Vale
  // solo con la frase della copia, che da allora è la frase del vault.
  app.post<{ Body: { copia: unknown; frase: string } }>(
    "/vault/ripristino",
    {
      bodyLimit: 8 * 1024 * 1024,
      schema: {
        body: {
          type: "object",
          required: ["copia", "frase"],
          additionalProperties: false,
          properties: { copia: { type: "object" }, frase: { type: "string", minLength: 1, maxLength: 1024 } },
        },
      },
    },
    async (richiesta, risposta) => {
      if (vault.condizione !== "da-impostare" && !dentro(richiesta)) return risposta.code(401).send({ errore: "Serve la frase di sblocco." });
      return conLaFrase(
        risposta,
        async () => {
          const riuscito = await vault.ripristina(richiesta.body.copia, richiesta.body.frase);
          if (!riuscito) return false;
          // Le credenziali sono altre: ciò che il browser del gateway aveva aperto con quelle di prima si chiude.
          await browser?.chiudi();
          await registro.annota({
            quando: new Date().toISOString(),
            credenziale: "",
            host: "il vault",
            conversazione: "il proprietario, dalla pagina del vault",
            comando: "Vault ripristinato da una copia",
            esito: "eseguito",
          });
          return true;
        },
        "La frase non apre questa copia.",
      );
    },
  );

  // Il proprietario lascia la pagina: il vault resta aperto, perché Claude possa usare le credenziali.
  app.post("/vault/uscita", async (richiesta, risposta) => {
    sessioni.chiudi(richiesta.cookies[COOKIE_VAULT]);
    risposta.clearCookie(COOKIE_VAULT, { path: "/vault" });
    return { condizione: vault.condizione, dentro: false };
  });

  // Il proprietario richiude il vault: finché non lo sblocca di nuovo nessuna credenziale si può usare.
  app.post("/vault/chiusura", async (_richiesta, risposta) => {
    vault.chiudi();
    // Con il vault chiuso il gateway non sa più quali valori togliere dalle pagine: il browser si chiude.
    await browser?.chiudi();
    sessioni.chiudiTutte();
    risposta.clearCookie(COOKIE_VAULT, { path: "/vault" });
    return { condizione: vault.condizione, dentro: false };
  });

  app.get("/vault/credenziali", async () => ({
    credenziali: vault.elenco(),
    registro: registro.ultime(RIGHE_REGISTRO),
  }));

  const conLaCredenziale = async (risposta: FastifyReply, lavoro: () => Promise<unknown>): Promise<unknown> => {
    try {
      const credenziale = await lavoro();
      if (credenziale === undefined) return await risposta.code(404).send({ errore: "Questa credenziale non c'è più." });
      return { credenziale };
    } catch (errore) {
      if (errore instanceof CredenzialeRifiutata) return risposta.code(400).send({ errore: errore.message });
      if (errore instanceof VaultChiuso) return risposta.code(401).send({ errore: errore.message });
      throw errore;
    }
  };

  app.post<{ Body: CredenzialeDaCustodire }>(
    "/vault/credenziali",
    { schema: { body: CORPO_CREDENZIALE } },
    (richiesta, risposta) => conLaCredenziale(risposta, () => vault.inserisci(richiesta.body)),
  );

  app.post<{ Params: { nome: string }; Body: CredenzialeDaCustodire }>(
    "/vault/credenziali/:nome",
    { schema: { body: CORPO_CREDENZIALE } },
    (richiesta, risposta) =>
      conLaCredenziale(risposta, () => vault.sostituisci(richiesta.params.nome, richiesta.body)),
  );

  // Una credenziale in chiaro diventa protetta: da qui Claude non ne legge più il valore. Il contrario non c'è.
  app.post<{ Params: { nome: string } }>("/vault/credenziali/:nome/protezione", (richiesta, risposta) =>
    conLaCredenziale(risposta, () => vault.rendiProtetta(richiesta.params.nome)),
  );

  app.post<{ Params: { nome: string } }>("/vault/credenziali/:nome/rimozione", async (richiesta, risposta) => {
    if (!(await vault.rimuovi(richiesta.params.nome))) {
      return risposta.code(404).send({ errore: "Questa credenziale non c'è più." });
    }
    return { rimossa: true };
  });

  // Le domande che il gateway fa al proprietario da sé, e ciò che il gateway dice della propria
  // versione. La risposta data qui non passa dal centro: è il proprietario, entrato con la sua frase.
  app.get("/vault/domande", async (): Promise<{ domande: DomandaDelGateway[] } & ReturnType<typeof diSe>> => ({
    domande: domande?.inVista() ?? [],
    ...diSe(),
  }));

  app.post<{ Params: { id: string }; Body: { decisione: "approvata" | "negata" } }>(
    "/vault/domande/:id",
    { schema: { body: CORPO_RISPOSTA } },
    async (richiesta, risposta) => {
      if (domande?.decidi(richiesta.params.id, richiesta.body.decisione, "pagina") !== true) {
        return risposta.code(404).send({ errore: "Questa richiesta non c'è più: è scaduta, oppure hai già risposto." });
      }
      return { domande: domande.inVista() };
    },
  );

  // Telegram, per il proprietario: il token del bot e chi è il proprietario si decidono solo da
  // qui, dopo la frase. Il token si scrive e non si rilegge.
  const conTelegram = async (risposta: FastifyReply, lavoro: (bot: Telegram) => unknown): Promise<TelegramInVista | undefined> => {
    if (telegram === undefined) return risposta.code(404).send({ errore: "In questa installazione il gateway non ha il bot Telegram." });
    try {
      await lavoro(telegram);
      return telegram.inVista();
    } catch (errore) {
      if (errore instanceof TelegramRifiutato) return risposta.code(400).send({ errore: errore.message });
      throw errore;
    }
  };

  app.get("/vault/telegram", (_richiesta, risposta) => conTelegram(risposta, () => {}));

  app.post<{ Body: { gettone: string } }>("/vault/telegram/gettone", { schema: { body: CORPO_GETTONE_TELEGRAM } }, (richiesta, risposta) =>
    conTelegram(risposta, (bot) => bot.imposta(richiesta.body.gettone)),
  );

  app.post("/vault/telegram/codice", (_richiesta, risposta) => conTelegram(risposta, (bot) => bot.nuovoCodice()));

  app.post("/vault/telegram/scollegamento", (_richiesta, risposta) => conTelegram(risposta, (bot) => bot.scollega()));

  app.post("/vault/telegram/rimozione", (_richiesta, risposta) => conTelegram(risposta, (bot) => bot.rimuovi()));

  app.post("/vault/telegram/prova", (_richiesta, risposta) =>
    conTelegram(risposta, async (bot) => {
      const esito = await bot.invia({ testo: "Prova riuscita: questo messaggio arriva da Shinka." });
      if (esito.esito !== "inviato") throw new TelegramRifiutato(esito.motivo);
    }),
  );

  return app;
}
