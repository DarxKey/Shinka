/**
 * Il browser del gateway: con questo Claude apre i siti, li legge, ci agisce, e ci entra con una
 * credenziale del vault senza vederla.
 *
 * È un Chromium che gira dentro il gateway, con un profilo su disco: cookie e sessioni restano
 * tra un uso e l'altro. Ogni conversazione ha la sua scheda. Claude vede la pagina come testo,
 * con un riferimento per ogni elemento, e se lo chiede come immagine; non può eseguire codice
 * nella pagina.
 *
 * Il valore di una credenziale entra nella pagina in un solo punto, `#inserisci`, e solo se il
 * campo sta in una cornice del sito per cui il proprietario l'ha inserita. Da qui non esce:
 * - il valore dei campi password non compare mai nel testo della pagina;
 * - ogni testo che esce (pagina, titolo, indirizzo, errori) passa da `#pulisci`, che toglie i
 *   valori del vault, comunque siano scritti;
 * - nell'immagine i campi password e i campi che contengono un valore del vault sono coperti, e
 *   se la pagina mostra un valore del vault nel suo testo l'immagine non si fa.
 *
 * Per questo il browser lavora solo a vault aperto: a vault chiuso il gateway non conosce i
 * valori da togliere.
 */

import { mkdir } from "node:fs/promises";
import { chromium, type BrowserContext, type ElementHandle, type Frame, type Locator, type Page } from "playwright-core";
import {
  INDIRIZZO_SITO_MASSIMO,
  TESTO_NEL_SITO_MASSIMO,
  type EsitoBrowser,
  type RichiestaBrowser,
  type VoceRegistro,
} from "../protocollo/vault.ts";
import { campoDiCarta, divietoNelSito } from "./divieti.ts";
import type { Registro } from "./registro.ts";
import { AL_POSTO_DEL_VALORE } from "./uso.ts";
import { UsoRifiutato, VaultChiuso, type Vault } from "./vault.ts";

export interface OpzioniBrowser {
  /** La cartella del profilo: cookie e sessioni dei siti restano qui tra un uso e l'altro. */
  profilo: string;
  /** Quale browser installato usare, per esempio "msedge" o "chrome". Se manca, il Chromium di Playwright. */
  canale?: string;
  /** Il percorso dell'eseguibile del browser, se non è dove Playwright se lo aspetta. */
  eseguibile?: string;
  /** Falso per avviare Chromium senza il suo recinto: serve dove il sistema non lo permette. */
  recinto?: boolean;
  /** Vero per vedere la finestra del browser: solo per le prove su un PC. */
  visibile?: boolean;
  /** Gli indirizzi che il browser non deve raggiungere: le pagine del gateway stesso. */
  vietato?: (indirizzo: URL) => boolean;
  /** Dopo quanto tempo senza usi la scheda di una conversazione si chiude. */
  inattivitaMs?: number;
}

/** Ciò che il servizio del gateway chiede al browser. */
export interface PortaBrowser {
  /** Esegue un'operazione per una conversazione. Non lancia mai: l'esito dice com'è andata. */
  esegui(richiesta: RichiestaBrowser): Promise<EsitoBrowser>;
  /** Chiude il browser: le pagine aperte si perdono, cookie e sessioni restano nel profilo. */
  chiudi(): Promise<void>;
}

/** Il gateway ha rifiutato l'operazione prima di toccare la pagina. */
class Rifiuto extends Error {}

/** L'operazione è stata tentata e non è riuscita. */
class NonRiuscito extends Error {}

interface Scheda {
  /** La pagina della conversazione e le finestre che ha aperto: l'ultima è quella in uso. */
  pagine: Page[];
  ultimoUso: number;
  /** Le operazioni di una conversazione si fanno una alla volta. */
  coda: Promise<unknown>;
  /** Gli avvisi che la pagina ha mostrato dall'ultima lettura. */
  avvisi: string[];
}

/** Ciò che il gateway guarda di un elemento prima di usarlo. Non contiene il valore dei campi. */
interface InfoElemento {
  tag: string;
  tipo: string;
  autocomplete: string;
  /** Nome, identificativo, etichetta e segnaposto: ciò che dice a che cosa serve. */
  descrizione: string;
  /** Le parole che il proprietario vedrebbe sull'elemento. */
  parole: string;
  modulo?: { campi: string[]; bottoni: string[]; password: number };
}

const SCHEDE_MASSIME = 6;
const FINESTRE_PER_SCHEDA = 4;
const TESTO_MASSIMO = 40_000;
const OPERAZIONE_MASSIMA_MS = 70_000;
const INATTIVITA_MS = 30 * 60 * 1000;
const NASCOSTO = "[nascosto]";

/** Com'è scritto il riferimento di un elemento nel testo della pagina: `e12`, oppure `f2e5` dentro una cornice. */
const RIFERIMENTO = /^(?:f\d+)?e\d+$/;

/** Una riga del testo della pagina che porta il valore di un campo. */
const RIGA_CON_VALORE = /^(\s*- (?:textbox|searchbox|combobox|spinbutton)\b.*\[ref=((?:f\d+)?e\d+)\](?: \[[^\]]*\])*): (.+)$/;

const TASTI: Record<string, string> = {
  invio: "Enter",
  enter: "Enter",
  tab: "Tab",
  esc: "Escape",
  escape: "Escape",
  su: "ArrowUp",
  giu: "ArrowDown",
  "giù": "ArrowDown",
  sinistra: "ArrowLeft",
  destra: "ArrowRight",
  arrowup: "ArrowUp",
  arrowdown: "ArrowDown",
  arrowleft: "ArrowLeft",
  arrowright: "ArrowRight",
  paginasu: "PageUp",
  paginagiu: "PageDown",
  "paginagiù": "PageDown",
  pageup: "PageUp",
  pagedown: "PageDown",
  home: "Home",
  end: "End",
  fine: "End",
  backspace: "Backspace",
  canc: "Delete",
  delete: "Delete",
  spazio: "Space",
  space: "Space",
};

function attesa(ms: number): Promise<void> {
  return new Promise((risolvi) => setTimeout(risolvi, ms));
}

function primaRiga(errore: unknown): string {
  const testo = errore instanceof Error ? errore.message : String(errore);
  return (testo.split("\n")[0] ?? "").slice(0, 300);
}

/** Come può comparire un valore in una pagina o in un indirizzo: com'è, e nelle scritture di un modulo inviato. */
function variantiDi(valori: readonly string[]): string[] {
  const varianti = new Set<string>();
  for (const valore of valori) {
    varianti.add(valore);
    const codificato = encodeURIComponent(valore);
    varianti.add(codificato);
    varianti.add(codificato.replace(/%20/g, "+"));
    varianti.add(JSON.stringify(valore).slice(1, -1));
  }
  // Prima le più lunghe: una scrittura più corta non deve spezzarne una che la contiene.
  return [...varianti].filter((variante) => variante.length >= 4).sort((a, b) => b.length - a.length);
}

function contiene(testo: string, valori: readonly string[]): boolean {
  return valori.some((valore) => testo.includes(valore));
}

/** L'origine di una cornice. Una cornice senza indirizzo suo ha quella della cornice che la contiene. */
function origineDi(cornice: Frame | null): string | undefined {
  for (let corrente = cornice; corrente !== null; corrente = corrente.parentFrame()) {
    const scritto = corrente.url();
    if (scritto === "" || scritto === "about:blank" || scritto.startsWith("about:srcdoc")) continue;
    try {
      const indirizzo = new URL(scritto);
      return indirizzo.protocol === "https:" || indirizzo.protocol === "http:" ? indirizzo.origin : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** Eseguita dentro la pagina: descrive un elemento senza leggere il valore dei suoi campi. */
function descriviElemento(elemento: Element): InfoElemento {
  const attributo = (di: Element, nome: string): string => di.getAttribute(nome) ?? "";
  const descrivi = (di: Element): string =>
    [attributo(di, "name"), di.id, attributo(di, "placeholder"), attributo(di, "aria-label"), attributo(di, "autocomplete")]
      .filter((parte) => parte !== "")
      .join(" ")
      .slice(0, 300);
  const parole = (di: Element): string => {
    const campo = di as HTMLInputElement;
    const tipo = (campo.type ?? "").toLowerCase();
    // Di un campo il valore è ciò che ci è scritto dentro, e non si legge; di un bottone è la sua scritta.
    const scritta = di.tagName === "INPUT" ? (["submit", "button", "reset", "image"].includes(tipo) ? campo.value : "") : ((di as HTMLElement).innerText ?? "");
    return [scritta, attributo(di, "aria-label"), attributo(di, "title"), attributo(di, "alt")]
      .filter((parte) => parte !== "")
      .join(" ")
      .replace(/\s+/g, " ")
      .slice(0, 300);
  };
  const campo = elemento as HTMLInputElement;
  const modulo = campo.form ?? elemento.closest("form");
  return {
    tag: elemento.tagName.toLowerCase(),
    tipo: (campo.type ?? "").toLowerCase(),
    autocomplete: attributo(elemento, "autocomplete").toLowerCase(),
    descrizione: descrivi(elemento),
    parole: parole(elemento),
    ...(modulo === null
      ? {}
      : {
          modulo: {
            campi: Array.from(modulo.querySelectorAll("input, select, textarea")).slice(0, 200).map(descrivi),
            bottoni: Array.from(modulo.querySelectorAll("button, input[type=submit], input[type=image], [role=button]"))
              .slice(0, 50)
              .map(parole),
            password: Array.from(modulo.querySelectorAll('input[type="password"]')).filter(
              (trovato) => (trovato as HTMLElement).offsetParent !== null,
            ).length,
          },
        }),
  };
}

/** Eseguita dentro la pagina: l'elemento che ha il fuoco, anche dentro una radice nascosta, descritto. */
function descriviFuoco(): { tag: string; tipo: string } | null {
  let attivo = document.activeElement;
  while (attivo?.shadowRoot?.activeElement) attivo = attivo.shadowRoot.activeElement;
  if (attivo === null || attivo === document.body || attivo.tagName === "IFRAME" || attivo.tagName === "FRAME") return null;
  return { tag: attivo.tagName.toLowerCase(), tipo: ((attivo as HTMLInputElement).type ?? "").toLowerCase() };
}

/** Eseguita dentro la pagina: a partire dal campo password, il campo del nome utente che gli sta accanto. */
function campoUtenteAccanto(password: Element): Element | null {
  const campo = password as HTMLInputElement;
  const dove = campo.form ?? (password.getRootNode() as Document | ShadowRoot);
  const candidati = Array.from(dove.querySelectorAll("input")).filter((trovato) => {
    const tipo = (trovato.type ?? "").toLowerCase();
    return ["text", "email", "tel", ""].includes(tipo) && trovato.offsetParent !== null && !trovato.disabled && !trovato.readOnly;
  });
  const prima = candidati.filter((trovato) => (trovato.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0);
  const dichiarato = prima.find((trovato) => /\b(?:username|email)\b/i.test(trovato.getAttribute("autocomplete") ?? ""));
  return dichiarato ?? prima.at(-1) ?? null;
}

const CAMPI_UTENTE = [
  'input[autocomplete~="username" i]',
  'input[type="email"]',
  'input[name*="user" i]',
  'input[name*="login" i]',
  'input[name*="email" i]',
  'input[id*="user" i]',
  'input[id*="login" i]',
  'input[id*="email" i]',
]
  .map((selettore) => `${selettore}:visible`)
  .join(", ");

export class BrowserDelGateway implements PortaBrowser {
  readonly #vault: Vault;
  readonly #registro: Registro;
  readonly #opzioni: OpzioniBrowser;
  readonly #schede = new Map<string, Scheda>();
  readonly #pulizia: NodeJS.Timeout;
  #contesto: BrowserContext | undefined;
  #avvio: Promise<BrowserContext> | undefined;

  constructor(vault: Vault, registro: Registro, opzioni: OpzioniBrowser) {
    this.#vault = vault;
    this.#registro = registro;
    this.#opzioni = opzioni;
    this.#pulizia = setInterval(() => void this.#chiudiInattive(), 60_000);
    this.#pulizia.unref();
  }

  async esegui(richiesta: RichiestaBrowser): Promise<EsitoBrowser> {
    if (this.#vault.condizione !== "aperto") {
      await this.chiudi();
      return {
        esito: "rifiutato",
        motivo:
          "Il browser del gateway lavora solo a vault aperto, anche per i siti che non chiedono una credenziale: " +
          "il proprietario deve sbloccare il vault dalla pagina Vault con la sua frase.",
      };
    }
    const scheda = this.#scheda(richiesta.chiave);
    const lavoro = scheda.coda.then(() => this.#entroIlTempo(this.#fai(scheda, richiesta)));
    scheda.coda = lavoro.catch(() => {});
    try {
      return await lavoro;
    } catch (errore) {
      if (errore instanceof Rifiuto || errore instanceof UsoRifiutato || errore instanceof VaultChiuso) {
        return { esito: "rifiutato", motivo: this.#pulisci(errore.message) };
      }
      if (errore instanceof NonRiuscito) return { esito: "fallito", motivo: this.#pulisci(errore.message) };
      return { esito: "fallito", motivo: this.#pulisci(`Il browser non ci è riuscito: ${primaRiga(errore)}`) };
    }
  }

  async chiudi(): Promise<void> {
    this.#schede.clear();
    const contesto = this.#contesto ?? (await this.#avvio?.catch(() => undefined));
    this.#contesto = undefined;
    await contesto?.close().catch(() => {});
  }

  /** Ferma anche il controllo periodico: da chiamare quando il gateway si spegne. */
  async spegni(): Promise<void> {
    clearInterval(this.#pulizia);
    await this.chiudi();
  }

  // ── Le operazioni ──────────────────────────────────────────────────────────

  async #fai(scheda: Scheda, richiesta: RichiestaBrowser): Promise<EsitoBrowser> {
    scheda.ultimoUso = Date.now();
    switch (richiesta.operazione) {
      case "chiudi":
        await this.#chiudiScheda(richiesta.chiave);
        return {
          esito: "fatto",
          testo: "Pagina chiusa. Nei siti in cui eri entrato la sessione resta: la prossima volta potresti trovarti già dentro.",
        };
      case "apri":
        return this.#apri(scheda, richiesta.indirizzo);
      case "leggi":
        this.#paginaAperta(scheda);
        return this.#descrivi(scheda, { immagine: richiesta.immagine === true });
      case "agisci":
        return this.#agisci(scheda, richiesta);
      case "inserisci":
        return this.#inserisci(scheda, richiesta);
    }
  }

  async #apri(scheda: Scheda, scritto: string): Promise<EsitoBrowser> {
    const indirizzo = this.#indirizzo(scritto);
    const contesto = await this.#avvia();
    let pagina = this.#corrente(scheda);
    if (pagina === undefined) {
      pagina = await contesto.newPage();
      this.#segui(scheda, pagina);
    }
    try {
      await pagina.goto(indirizzo.href, { waitUntil: "domcontentloaded" });
    } catch (errore) {
      throw new NonRiuscito(`La pagina non si è aperta: ${primaRiga(errore)}`);
    }
    return this.#descrivi(scheda, {});
  }

  async #agisci(scheda: Scheda, richiesta: Extract<RichiestaBrowser, { operazione: "agisci" }>): Promise<EsitoBrowser> {
    const pagina = this.#paginaAperta(scheda);
    const origine = origineDi(pagina.mainFrame()) ?? pagina.url();
    /** Un divieto fisso: si rifiuta, e resta nel registro perché il proprietario lo veda. */
    const vieta = async (motivo: string, che: string): Promise<never> => {
      await this.#annota({
        quando: new Date().toISOString(),
        credenziale: "",
        host: origine,
        conversazione: richiesta.conversazione.slice(0, 200),
        comando: this.#pulisci(che).slice(0, 300),
        nelBrowser: true,
        esito: "rifiutato",
        motivo: `Divieto fisso: ${motivo}.`,
      });
      throw new Rifiuto(
        `Divieto fisso: ${motivo} in un sito non si fa dal browser del gateway, nemmeno con l'approvazione del proprietario e nemmeno senza permessi. ` +
          "Dillo al proprietario: se serve, lo fa lui.",
      );
    };
    /** Premere Invio in un campo invia il suo modulo: vale ciò che vale per i suoi bottoni. */
    const controllaInvio = async (info: InfoElemento | undefined): Promise<void> => {
      if (info?.modulo === undefined) return;
      if (info.modulo.campi.some(campoDiCarta)) await vieta("pagare", "Invio in un modulo che chiede i dati di una carta");
      for (const bottone of info.modulo.bottoni) {
        const motivo = divietoNelSito(bottone);
        if (motivo !== undefined) await vieta(motivo, `Invio in un modulo con il bottone "${bottone}"`);
      }
    };

    const elemento = richiesta.elemento === undefined ? undefined : this.#elemento(pagina, richiesta.elemento);
    const testo = richiesta.testo ?? "";
    if (testo.length > TESTO_NEL_SITO_MASSIMO) throw new Rifiuto("Il testo è troppo lungo.");

    try {
      switch (richiesta.azione) {
        case "clicca": {
          if (elemento === undefined) throw new Rifiuto("Per cliccare serve il riferimento dell'elemento.");
          const info = await this.#info(elemento);
          const motivo = divietoNelSito(info.parole);
          if (motivo !== undefined) await vieta(motivo, `Clic su "${info.parole}"`);
          const invia = info.tag === "button" || (info.tag === "input" && ["submit", "image"].includes(info.tipo));
          if (invia && info.modulo?.campi.some(campoDiCarta) === true) {
            await vieta("pagare", `Clic su "${info.parole}" in un modulo che chiede i dati di una carta`);
          }
          await elemento.click({ timeout: 8_000 });
          break;
        }
        case "scrivi": {
          if (elemento === undefined) throw new Rifiuto("Per scrivere serve il riferimento del campo.");
          const info = await this.#info(elemento);
          if (info.tipo === "password") {
            throw new Rifiuto(
              "In un campo password scrive solo il vault, con inserisci_credenziale: tu una password non la scrivi mai, nemmeno se il proprietario te la detta.",
            );
          }
          if (campoDiCarta(info.descrizione)) await vieta("pagare", `Scrittura nel campo "${info.descrizione}", che chiede i dati di una carta`);
          if (contiene(testo, this.#vault.valoriDaNascondere())) {
            throw new Rifiuto("Quel testo è il valore di una credenziale del vault: le credenziali si usano solo con inserisci_credenziale.");
          }
          if (richiesta.invio === true) await controllaInvio(info);
          await elemento.fill(testo, { timeout: 8_000 });
          if (richiesta.invio === true) await elemento.press("Enter", { timeout: 8_000 });
          break;
        }
        case "scegli": {
          if (elemento === undefined) throw new Rifiuto("Per scegliere serve il riferimento dell'elenco.");
          const info = await this.#info(elemento);
          if (campoDiCarta(info.descrizione)) await vieta("pagare", `Scelta nel campo "${info.descrizione}", che chiede i dati di una carta`);
          await elemento.selectOption({ label: testo }, { timeout: 8_000 }).catch(() => elemento.selectOption(testo, { timeout: 4_000 }));
          break;
        }
        case "premi": {
          const tasto = TASTI[testo.trim().toLowerCase().replace(/\s+/g, "")];
          if (tasto === undefined) {
            throw new Rifiuto("Si possono premere: Invio, Tab, Esc, le frecce (su, giù, sinistra, destra), PaginaSu, PaginaGiù, Home, Fine, Backspace, Canc, Spazio.");
          }
          if (tasto === "Enter") {
            if (elemento !== undefined) await controllaInvio(await this.#info(elemento));
            else {
              for (const cornice of pagina.frames()) {
                const fuoco = cornice.locator(":focus").first();
                if ((await cornice.evaluate(descriviFuoco).catch(() => null)) === null) continue;
                await controllaInvio(await fuoco.evaluate(descriviElemento, undefined, { timeout: 3_000 }).catch(() => undefined));
              }
            }
          }
          if (elemento === undefined) await pagina.keyboard.press(tasto);
          else await elemento.press(tasto, { timeout: 8_000 });
          break;
        }
        case "indietro":
          await pagina.goBack({ waitUntil: "domcontentloaded" });
          break;
        case "scorri":
          await pagina.mouse.wheel(0, /^su$/i.test(testo.trim()) ? -700 : 700);
          break;
      }
    } catch (errore) {
      if (errore instanceof Rifiuto) throw errore;
      throw new NonRiuscito(
        /timeout/i.test(primaRiga(errore))
          ? "L'elemento non c'è più oppure non si lascia usare: rileggi la pagina con leggi_sito e riprova con il riferimento che trovi."
          : `L'azione non è riuscita: ${primaRiga(errore)}`,
      );
    }
    return this.#descrivi(scheda, {});
  }

  /**
   * Scrive nome utente e password di una credenziale nei campi di accesso della pagina.
   * È l'unico punto in cui un valore del vault entra in una pagina.
   */
  async #inserisci(scheda: Scheda, richiesta: Extract<RichiestaBrowser, { operazione: "inserisci" }>): Promise<EsitoBrowser> {
    const pagina = this.#paginaAperta(scheda);
    const base = {
      quando: new Date().toISOString(),
      credenziale: richiesta.credenziale.trim().toLowerCase().slice(0, 100),
      conversazione: richiesta.conversazione.slice(0, 200),
      nelBrowser: true as const,
    };
    let dove = origineDi(pagina.mainFrame()) ?? "";
    const rifiuta = async (motivo: string, esito: "rifiutato" | "fallito" = "rifiutato"): Promise<never> => {
      await this.#annota({ ...base, host: dove, comando: "Inserimento di nome utente e password", esito, motivo: this.#pulisci(motivo) });
      throw esito === "rifiutato" ? new Rifiuto(motivo) : new NonRiuscito(motivo);
    };

    // Quali campi.
    let campoPassword = richiesta.campoPassword === undefined ? undefined : await this.#maniglia(pagina, richiesta.campoPassword);
    let campoUtente = richiesta.campoUtente === undefined ? undefined : await this.#maniglia(pagina, richiesta.campoUtente);
    if (campoPassword === undefined && campoUtente === undefined) {
      const password = await this.#visibili(pagina, 'input[type="password"]:visible');
      if (password.length > 1) {
        return rifiuta(
          "In questa pagina ci sono più campi password: indica quello di accesso con campo_password, usando il suo riferimento. " +
            "Se è una pagina di registrazione o di cambio password, fermati: non si fa.",
        );
      }
      campoPassword = password[0];
      if (campoPassword === undefined) {
        const utenti = await this.#visibili(pagina, CAMPI_UTENTE);
        if (utenti.length !== 1) {
          return rifiuta(
            "In questa pagina non trovo da solo i campi di accesso: indica campo_utente o campo_password con il riferimento che leggi nella pagina. " +
              "Se il sito chiede prima il nome utente e poi la password, usa inserisci_credenziale due volte.",
          );
        }
        campoUtente = utenti[0];
      }
    }
    if (campoPassword !== undefined && campoUtente === undefined) {
      campoUtente = (await campoPassword.evaluateHandle(campoUtenteAccanto).catch(() => undefined))?.asElement() ?? undefined;
    }

    // In quale sito: conta l'origine della cornice che contiene il campo, non ciò che la pagina dice di sé.
    const origini = new Set<string>();
    for (const campo of [campoUtente, campoPassword]) {
      if (campo === undefined) continue;
      const origine = origineDi(await campo.ownerFrame());
      if (origine === undefined) return rifiuta("Il campo sta in una parte della pagina che non appartiene a un sito riconoscibile.");
      origini.add(origine);
    }
    dove = [...origini].join(", ");
    let credenziale: { nome: string; utente: string; segreto: string } | undefined;
    for (const origine of origini) {
      try {
        credenziale = this.#vault.perSito(richiesta.credenziale, origine);
      } catch (errore) {
        if (errore instanceof UsoRifiutato || errore instanceof VaultChiuso) return rifiuta(errore.message);
        throw errore;
      }
    }
    if (credenziale === undefined) return rifiuta("Non c'è un campo in cui inserire.");

    // In quali campi: la password va solo in un campo password di accesso, mai dove se ne sceglie una nuova.
    if (campoPassword !== undefined) {
      const info = await campoPassword.evaluate(descriviElemento).catch(() => undefined);
      if (info === undefined || info.tag !== "input" || info.tipo !== "password") {
        return rifiuta("Il campo indicato per la password non è un campo password: lì la password si vedrebbe, e non la scrivo.");
      }
      if (info.autocomplete.includes("new-password") || (info.modulo?.password ?? 1) > 1) {
        return rifiuta(
          "Divieto fisso: questo modulo serve a scegliere o cambiare una password, non a entrare. Dillo al proprietario: se serve, lo fa lui.",
        );
      }
    }
    if (campoUtente !== undefined) {
      const info = await campoUtente.evaluate(descriviElemento).catch(() => undefined);
      if (info === undefined || info.tag !== "input" || !["text", "email", "tel", "search", ""].includes(info.tipo) || campoDiCarta(info.descrizione)) {
        return rifiuta("Il campo indicato per il nome utente non è un campo di testo adatto.");
      }
    }

    try {
      if (campoUtente !== undefined) await campoUtente.fill(credenziale.utente, { timeout: 8_000 });
      if (campoPassword !== undefined) await campoPassword.fill(credenziale.segreto, { timeout: 8_000 });
    } catch {
      // Il messaggio del browser non si riporta: potrebbe citare ciò che stava scrivendo.
      return rifiuta("I campi non si sono lasciati riempire: rileggi la pagina con leggi_sito e riprova.", "fallito");
    }
    await this.#vault.annotaUsoNelSito(credenziale.nome);
    const inserito = campoPassword === undefined ? "il nome utente" : campoUtente === undefined ? "la password" : "nome utente e password";
    await this.#annota({ ...base, credenziale: credenziale.nome, host: dove, comando: `Inserimento: ${inserito}`, esito: "eseguito" });
    return this.#descrivi(scheda, {
      premessa:
        `Il gateway ha inserito ${inserito} della credenziale "${credenziale.nome}" nel sito ${dove}. Il valore non lo vedi. ` +
        (campoPassword === undefined
          ? "Vai avanti nel sito, e quando compare il campo della password usa di nuovo inserisci_credenziale."
          : "Ora premi il bottone di accesso con agisci_nel_sito."),
    });
  }

  // ── La pagina com'è, senza i valori ────────────────────────────────────────

  async #descrivi(scheda: Scheda, opzioni: { premessa?: string; immagine?: boolean }): Promise<EsitoBrowser> {
    let pagina = this.#paginaAperta(scheda);
    await this.#assesta(pagina);
    // Un clic può aver aperto una finestra nuova: da qui in poi la pagina è quella.
    pagina = this.#paginaAperta(scheda);
    const valori = variantiDi(this.#vault.valoriDaNascondere());

    let albero: string;
    try {
      albero = await this.#testoDellaPagina(pagina);
    } catch {
      // La pagina stava cambiando proprio adesso: un secondo tentativo dopo che si è fermata.
      await this.#assesta(pagina);
      albero = await this.#testoDellaPagina(pagina).catch(() => "(la pagina non si lascia leggere in questo momento: riprova con leggi_sito)");
    }
    const avvisi = scheda.avvisi.splice(0).map((avviso) => `Avviso della pagina, chiuso dal gateway: ${avviso}`);
    const parti = [
      opzioni.premessa ?? "",
      `Pagina: ${await pagina.title().catch(() => "")}`,
      `Indirizzo: ${pagina.url()}`,
      ...avvisi,
    ].filter((parte) => parte !== "");

    let immagine: string | undefined;
    if (opzioni.immagine === true) {
      const fatta = await this.#immagine(pagina, valori);
      if (typeof fatta === "string") parti.push(fatta);
      else immagine = fatta.toString("base64");
    }

    let testo = this.#pulisci(`${parti.join("\n")}\n\n${albero}`, valori);
    if (testo.length > TESTO_MASSIMO) {
      testo = `${testo.slice(0, TESTO_MASSIMO)}\n[…la pagina continua: qui c'è solo l'inizio]`;
    }
    return { esito: "fatto", testo, ...(immagine === undefined ? {} : { immagine }) };
  }

  /** La pagina in testo, con i riferimenti degli elementi e senza il valore dei campi password. */
  async #testoDellaPagina(pagina: Page): Promise<string> {
    const righe = (await pagina.ariaSnapshot({ mode: "ai", timeout: 10_000 })).split("\n");
    for (const [posto, riga] of righe.entries()) {
      const trovato = RIGA_CON_VALORE.exec(riga);
      if (trovato?.[1] === undefined || trovato[2] === undefined) continue;
      // Se non si riesce a sapere che campo è, il suo valore non si mostra.
      const password = await pagina
        .getByRef(trovato[2])
        .evaluate((elemento) => elemento.tagName === "INPUT" && (elemento as HTMLInputElement).type === "password", undefined, { timeout: 2_000 })
        .catch(() => true);
      if (password) righe[posto] = `${trovato[1]}: ${NASCOSTO}`;
    }
    let testo = righe.join("\n");
    // Seconda difesa: ciò che sta scritto in un campo password non compare in nessun punto del testo.
    for (const valore of await this.#neiCampiPassword(pagina)) testo = testo.split(valore).join(NASCOSTO);
    return testo;
  }

  async #neiCampiPassword(pagina: Page): Promise<string[]> {
    const valori = new Set<string>();
    for (const cornice of pagina.frames()) {
      const letti = await cornice
        .locator('input[type="password"]')
        .evaluateAll((campi) => campi.map((campo) => (campo as HTMLInputElement).value))
        .catch(() => []);
      for (const valore of letti) if (valore.length >= 4) valori.add(valore);
    }
    return [...valori].sort((a, b) => b.length - a.length);
  }

  /** L'immagine della pagina, oppure il motivo per cui non si fa. I campi con un valore da nascondere sono coperti. */
  async #immagine(pagina: Page, valori: readonly string[]): Promise<Buffer | string> {
    const guarda = async (): Promise<{ scoperto: boolean; campi: string; maschere: Locator[] }> => {
      const maschere: Locator[] = [];
      const campi: string[] = [];
      let scoperto = false;
      for (const [numero, cornice] of pagina.frames().entries()) {
        maschere.push(cornice.locator('input[type="password"]'));
        const tutti = cornice.locator("input, textarea");
        const scritti = await tutti.evaluateAll((trovati) => trovati.map((campo) => (campo as HTMLInputElement).value ?? "")).catch(() => []);
        for (const [posto, scritto] of scritti.entries()) {
          if (!contiene(scritto, valori)) continue;
          maschere.push(tutti.nth(posto));
          campi.push(`${numero}:${posto}`);
        }
        const visibile = await cornice.locator("body").innerText({ timeout: 3_000 }).catch(() => "");
        if (contiene(visibile, valori)) scoperto = true;
      }
      return { scoperto, campi: campi.join(","), maschere };
    };
    const rifiuto = "Immagine non fatta: la pagina mostra il valore di una credenziale del vault, e in un'immagine si leggerebbe.";
    const prima = await guarda();
    if (prima.scoperto) return rifiuto;
    let immagine: Buffer;
    try {
      immagine = await pagina.screenshot({
        type: "jpeg",
        quality: 60,
        mask: prima.maschere,
        maskColor: "#000000",
        animations: "disabled",
        caret: "hide",
        timeout: 15_000,
      });
    } catch (errore) {
      return `Immagine non fatta: ${primaRiga(errore)}`;
    }
    // Se mentre si faceva l'immagine la pagina è cambiata proprio lì, l'immagine si butta.
    const dopo = await guarda();
    return dopo.scoperto || dopo.campi !== prima.campi ? rifiuto : immagine;
  }

  /** Toglie da un testo che esce dal gateway i valori del vault, comunque siano scritti. */
  #pulisci(testo: string, valori: readonly string[] = variantiDi(this.#vault.valoriDaNascondere())): string {
    let pulito = testo;
    for (const valore of valori) pulito = pulito.split(valore).join(AL_POSTO_DEL_VALORE);
    return pulito;
  }

  // ── Elementi ───────────────────────────────────────────────────────────────

  #elemento(pagina: Page, riferimento: string): Locator {
    const pulito = riferimento.trim().replace(/^\[?ref=/, "").replace(/\]$/, "");
    if (!RIFERIMENTO.test(pulito)) {
      throw new Rifiuto(`"${riferimento.slice(0, 40)}" non è un riferimento: è quello scritto tra parentesi quadre nel testo della pagina, per esempio e12.`);
    }
    return pagina.getByRef(pulito);
  }

  async #info(elemento: Locator): Promise<InfoElemento> {
    try {
      return await elemento.evaluate(descriviElemento, undefined, { timeout: 5_000 });
    } catch {
      throw new Rifiuto("Quell'elemento non c'è più: rileggi la pagina con leggi_sito e usa il riferimento che trovi.");
    }
  }

  async #maniglia(pagina: Page, riferimento: string): Promise<ElementHandle<Element>> {
    const maniglia = await this.#elemento(pagina, riferimento)
      .elementHandle({ timeout: 5_000 })
      .catch(() => null);
    if (maniglia === null) throw new Rifiuto("Quel campo non c'è più: rileggi la pagina con leggi_sito e usa il riferimento che trovi.");
    return maniglia as ElementHandle<Element>;
  }

  async #visibili(pagina: Page, selettore: string): Promise<ElementHandle<Element>[]> {
    const trovati: ElementHandle<Element>[] = [];
    for (const cornice of pagina.frames()) {
      trovati.push(...((await cornice.locator(selettore).elementHandles().catch(() => [])) as ElementHandle<Element>[]));
    }
    return trovati;
  }

  // ── Schede e avvio ─────────────────────────────────────────────────────────

  #indirizzo(scritto: string): URL {
    const pulito = scritto.trim();
    if (pulito === "" || pulito.length > INDIRIZZO_SITO_MASSIMO) throw new Rifiuto("L'indirizzo manca, oppure è troppo lungo.");
    let indirizzo: URL;
    try {
      indirizzo = new URL(/^[a-z][a-z0-9+.-]*:/i.test(pulito) ? pulito : `https://${pulito}`);
    } catch {
      throw new Rifiuto(`"${pulito.slice(0, 200)}" non è un indirizzo che si capisce.`);
    }
    if (indirizzo.protocol !== "https:" && indirizzo.protocol !== "http:") {
      throw new Rifiuto("Il browser del gateway apre solo indirizzi che cominciano con https:// o http://.");
    }
    if (indirizzo.username !== "" || indirizzo.password !== "" || contiene(pulito, variantiDi(this.#vault.valoriDaNascondere()))) {
      throw new Rifiuto("Nell'indirizzo non si scrivono credenziali: per entrare in un sito si usa inserisci_credenziale.");
    }
    if (this.#opzioni.vietato?.(indirizzo) === true) {
      throw new Rifiuto("Quella è una pagina del gateway: ci entra solo il proprietario, dal suo browser.");
    }
    return indirizzo;
  }

  #scheda(chiave: string): Scheda {
    let scheda = this.#schede.get(chiave);
    if (scheda === undefined) {
      scheda = { pagine: [], ultimoUso: Date.now(), coda: Promise.resolve(), avvisi: [] };
      this.#schede.set(chiave, scheda);
      // Troppe schede aperte: si chiude quella che non si usa da più tempo.
      if (this.#schede.size > SCHEDE_MASSIME) {
        const vecchia = [...this.#schede.entries()].filter(([nome]) => nome !== chiave).sort((a, b) => a[1].ultimoUso - b[1].ultimoUso)[0];
        if (vecchia !== undefined) void this.#chiudiScheda(vecchia[0]);
      }
    }
    return scheda;
  }

  #corrente(scheda: Scheda): Page | undefined {
    return scheda.pagine.findLast((pagina) => !pagina.isClosed());
  }

  #paginaAperta(scheda: Scheda): Page {
    const pagina = this.#corrente(scheda);
    if (pagina === undefined) throw new Rifiuto("In questa conversazione non c'è una pagina aperta: comincia con apri_sito.");
    return pagina;
  }

  /** Tiene d'occhio una pagina della conversazione: le finestre che apre, gli avvisi che mostra. */
  #segui(scheda: Scheda, pagina: Page): void {
    scheda.pagine.push(pagina);
    pagina.on("popup", (nuova) => {
      if (scheda.pagine.filter((aperta) => !aperta.isClosed()).length >= FINESTRE_PER_SCHEDA) void nuova.close().catch(() => {});
      else this.#segui(scheda, nuova);
    });
    pagina.on("close", () => {
      scheda.pagine = scheda.pagine.filter((aperta) => aperta !== pagina);
    });
    pagina.on("dialog", (avviso) => {
      scheda.avvisi.push(`${avviso.message().slice(0, 300)}`);
      // Una domanda della pagina riceve sempre "annulla"; solo l'uscita da una pagina viene lasciata passare.
      void (avviso.type() === "beforeunload" ? avviso.accept() : avviso.dismiss()).catch(() => {});
    });
  }

  async #chiudiScheda(chiave: string): Promise<void> {
    const scheda = this.#schede.get(chiave);
    if (scheda === undefined) return;
    this.#schede.delete(chiave);
    for (const pagina of scheda.pagine.splice(0)) await pagina.close().catch(() => {});
  }

  async #chiudiInattive(): Promise<void> {
    const limite = Date.now() - (this.#opzioni.inattivitaMs ?? INATTIVITA_MS);
    // Si chiudono le schede, non il browser: finché resta acceso valgono anche le sessioni che
    // un sito non fa durare oltre la chiusura del browser.
    for (const [chiave, scheda] of this.#schede) if (scheda.ultimoUso < limite) await this.#chiudiScheda(chiave);
  }

  /** Aspetta che la pagina si fermi dopo un'azione, senza aspettarla per sempre. */
  async #assesta(pagina: Page): Promise<void> {
    await attesa(250);
    await pagina.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => {});
    await pagina.waitForLoadState("networkidle", { timeout: 2_500 }).catch(() => {});
  }

  async #entroIlTempo<T>(lavoro: Promise<T>): Promise<T> {
    let scadenza: NodeJS.Timeout | undefined;
    const tempo = new Promise<never>((_risolvi, rifiuta) => {
      scadenza = setTimeout(
        () => rifiuta(new NonRiuscito("La pagina non ha risposto in tempo: riprova, oppure rileggila con leggi_sito.")),
        OPERAZIONE_MASSIMA_MS,
      );
    });
    try {
      return await Promise.race([lavoro, tempo]);
    } finally {
      clearTimeout(scadenza);
      lavoro.catch(() => {});
    }
  }

  #avvia(): Promise<BrowserContext> {
    if (this.#contesto !== undefined) return Promise.resolve(this.#contesto);
    this.#avvio ??= (async () => {
      const { profilo, canale, eseguibile, vietato } = this.#opzioni;
      await mkdir(profilo, { recursive: true, mode: 0o700 });
      let contesto: BrowserContext;
      try {
        contesto = await chromium.launchPersistentContext(profilo, {
          headless: this.#opzioni.visibile !== true,
          chromiumSandbox: this.#opzioni.recinto !== false,
          viewport: { width: 1280, height: 800 },
          locale: "it-IT",
          acceptDownloads: false,
          ...(canale === undefined ? {} : { channel: canale }),
          ...(eseguibile === undefined ? {} : { executablePath: eseguibile }),
        });
      } catch (errore) {
        throw new NonRiuscito(`Il gateway non riesce ad avviare il suo browser: ${primaRiga(errore).replace(/[.\s]+$/, "")}. Dillo al proprietario.`);
      }
      contesto.setDefaultTimeout(10_000);
      contesto.setDefaultNavigationTimeout(30_000);
      if (vietato !== undefined) {
        await contesto.route(
          (indirizzo) => vietato(indirizzo),
          (richiesta) => richiesta.abort("blockedbyclient"),
        );
      }
      contesto.on("close", () => {
        if (this.#contesto === contesto) this.#contesto = undefined;
        this.#schede.clear();
      });
      this.#contesto = contesto;
      return contesto;
    })().finally(() => {
      this.#avvio = undefined;
    });
    return this.#avvio;
  }

  async #annota(voce: VoceRegistro): Promise<void> {
    try {
      await this.#registro.annota(voce);
    } catch (errore) {
      console.error(`Registro non scritto (${voce.quando}, ${voce.esito}): ${errore instanceof Error ? errore.message : String(errore)}`);
    }
  }
}
