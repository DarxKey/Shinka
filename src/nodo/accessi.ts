/**
 * Gli accessi dei motori in questo ambiente: dice se Claude Code e Codex hanno un abbonamento
 * collegato, e li collega dal browser del proprietario (ADR 0030).
 *
 * - Codex: l'app-server comincia un accesso a codice; il proprietario apre la pagina di OpenAI e
 *   ci scrive il codice che Shinka gli mostra. L'app-server se ne accorge da sé.
 * - Claude: `claude auth login` dà l'indirizzo della pagina di Anthropic; dopo l'accesso il sito
 *   mostra un codice, che il proprietario incolla in Shinka e Shinka scrive al programma.
 *
 * Le credenziali restano dove le tiene ciascun programma: Shinka non le legge.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { ambientePerHarness, fonteConfigurata } from "../harness/autenticazione.ts";
import type { AccessoInCorso, EsitoAccessi, RichiestaAccessi, AccessoDelMotore } from "../protocollo/accessi.ts";
import type { Motore } from "../protocollo/impostazioni.ts";
import { ClienteAppServer } from "./codex/cliente.ts";

/** Il programma di Claude Code che il Claude Agent SDK usa, cercato come lo cerca lui. */
export function programmaDiClaude(): string[] {
  const richiedi = createRequire(createRequire(import.meta.url).resolve("@anthropic-ai/claude-agent-sdk"));
  const estensione = process.platform === "win32" ? ".exe" : "";
  const pacchetti =
    process.platform === "linux"
      ? [`linux-${process.arch}`, `linux-${process.arch}-musl`]
      : [`${process.platform}-${process.arch}`];
  for (const pacchetto of pacchetti) {
    try {
      const percorso = richiedi.resolve(`@anthropic-ai/claude-agent-sdk-${pacchetto}/claude${estensione}`);
      if (existsSync(percorso)) return [percorso];
    } catch {
      // Il pacchetto di questa piattaforma non c'è: si prova il prossimo.
    }
  }
  return ["claude"];
}

export interface OpzioniAccessi {
  /** Il programma di Claude Code; nei test, uno finto. */
  comandoClaude?: string[];
  /** Il programma di Codex per l'app-server; nei test, uno finto. */
  comandoCodex?: string[];
  env?: NodeJS.ProcessEnv;
  /** Quanto resta aperto un accesso cominciato. */
  attesaAccessoMs?: number;
  /** Un accesso è cambiato: chi tiene i modelli dei motori li rilegge. */
  dopoIlCambio?: () => void;
}

const ATTESA_ACCESSO_MS = 15 * 60_000;
const ATTESA_INDIRIZZO_MS = 30_000;
const ATTESA_FINE_MS = 60_000;

interface AccessoClaude {
  processo: ChildProcess;
  indirizzo: string;
  uscita: Promise<{ codice: number | null; testo: string }>;
  scadenza: NodeJS.Timeout;
}

interface AccessoCodex {
  cliente: ClienteAppServer;
  loginId: string;
  indirizzo: string;
  codice: string;
  scadenza: NodeJS.Timeout;
}

function senzaColori(testo: string): string {
  return testo.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
}

/** Le ultime righe utili di ciò che un programma ha scritto, per dire che cosa è andato storto. */
function ultimeRighe(testo: string): string {
  return senzaColori(testo)
    .split(/\r?\n/)
    .map((riga) => riga.replace(/^.*Paste code here if prompted >/, "").trim())
    // L'indirizzo e i messaggi dell'avvio dell'accesso non dicono che cosa è andato storto.
    .filter((riga) => riga !== "" && !riga.includes("https://") && !/^Opening browser/.test(riga))
    .slice(-3)
    .join(" ")
    .slice(0, 400);
}

function conMaiuscola(testo: string): string {
  return testo.charAt(0).toUpperCase() + testo.slice(1);
}

export class AccessiDeiMotori {
  readonly #o: OpzioniAccessi;
  #claude: AccessoClaude | undefined;
  #codex: AccessoCodex | undefined;

  constructor(opzioni: OpzioniAccessi = {}) {
    this.#o = opzioni;
  }

  async esegui(richiesta: RichiestaAccessi): Promise<EsitoAccessi> {
    try {
      switch (richiesta.tipo) {
        case "stato":
          return await this.#stato();
        case "avvia":
          if (richiesta.motore === "codex") await this.#avviaCodex();
          else await this.#avviaClaude();
          return await this.#stato();
        case "codice": {
          if (richiesta.motore !== "claude") return { ...(await this.#stato()), motivo: "Per Codex non si incolla un codice: si scrive sulla pagina di OpenAI." };
          const motivo = await this.#codiceClaude(richiesta.codice);
          return { ...(await this.#stato()), ...(motivo === undefined ? {} : { motivo }) };
        }
        case "annulla":
          this.#annulla(richiesta.motore);
          return await this.#stato();
        case "esci": {
          const motivo = await this.#esci(richiesta.motore);
          return { ...(await this.#stato()), ...(motivo === undefined ? {} : { motivo }) };
        }
      }
    } catch (errore) {
      return { motivo: errore instanceof Error ? errore.message : String(errore) };
    }
  }

  /** Chiude gli accessi lasciati a metà. */
  chiudi(): void {
    this.#annulla("claude");
    this.#annulla("codex");
  }

  async #stato(): Promise<EsitoAccessi> {
    const [claude, codex] = await Promise.all([this.#statoClaude(), this.#statoCodex()]);
    const inCorso: AccessoInCorso[] = [];
    if (this.#claude !== undefined) inCorso.push({ motore: "claude", indirizzo: this.#claude.indirizzo, chiedeCodice: true });
    if (this.#codex !== undefined) inCorso.push({ motore: "codex", indirizzo: this.#codex.indirizzo, codice: this.#codex.codice, chiedeCodice: false });
    return { accessi: { claude, codex }, ...(inCorso.length === 0 ? {} : { inCorso }) };
  }

  #ambiente(): NodeJS.ProcessEnv {
    return this.#o.env ?? (ambientePerHarness(fonteConfigurata()) as NodeJS.ProcessEnv);
  }

  /** Esegue Claude Code con quegli argomenti e ne raccoglie ciò che scrive. */
  #claudeCon(argomenti: string[], attesaMs = 20_000): Promise<{ codice: number | null; testo: string }> {
    const [programma, ...prima] = this.#o.comandoClaude ?? programmaDiClaude();
    return new Promise((risolvi) => {
      const processo = spawn(programma ?? "claude", [...prima, ...argomenti], { cwd: tmpdir(), env: this.#ambiente(), stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      let testo = "";
      processo.stdout?.on("data", (dati: Buffer) => (testo += dati.toString()));
      processo.stderr?.on("data", (dati: Buffer) => (testo += dati.toString()));
      const scadenza = setTimeout(() => processo.kill(), attesaMs);
      processo.on("error", (errore) => {
        clearTimeout(scadenza);
        risolvi({ codice: null, testo: errore.message });
      });
      processo.on("close", (codice) => {
        clearTimeout(scadenza);
        risolvi({ codice, testo });
      });
    });
  }

  async #statoClaude(): Promise<AccessoDelMotore> {
    const { codice, testo } = await this.#claudeCon(["auth", "status", "--json"]);
    let letto: { loggedIn?: unknown; authMethod?: unknown; subscriptionType?: unknown; apiProvider?: unknown };
    try {
      letto = JSON.parse(testo) as typeof letto;
    } catch {
      return { collegato: false, motivo: codice === null ? `Claude Code non parte: ${ultimeRighe(testo)}` : "Claude Code non ha detto se ha un accesso." };
    }
    if (letto.loggedIn !== true) return { collegato: false };
    if (typeof letto.subscriptionType === "string" && letto.subscriptionType !== "") return { collegato: true, descrizione: `Claude ${conMaiuscola(letto.subscriptionType)}` };
    if (letto.authMethod === "console" || letto.authMethod === "api-key" || letto.authMethod === "apiKey") return { collegato: true, descrizione: "Chiave API" };
    return { collegato: true, descrizione: typeof letto.apiProvider === "string" && letto.apiProvider !== "firstParty" ? `Claude (${letto.apiProvider})` : "Claude" };
  }

  async #clienteCodex(alNotificato: (metodo: string, parametri: Record<string, unknown>) => void = () => {}): Promise<ClienteAppServer> {
    return ClienteAppServer.avvia({
      ...(this.#o.comandoCodex === undefined ? {} : { comando: this.#o.comandoCodex }),
      ...(this.#o.env === undefined ? {} : { env: this.#o.env }),
      cwd: tmpdir(),
      alNotificato,
      allaRichiesta: async () => ({ errore: "Shinka sta solo guardando l'accesso." }),
      allaFine: () => {},
    });
  }

  async #statoCodex(): Promise<AccessoDelMotore> {
    let cliente: ClienteAppServer;
    try {
      cliente = await this.#clienteCodex();
    } catch (errore) {
      return { collegato: false, motivo: `Codex non parte: ${errore instanceof Error ? errore.message : String(errore)}` };
    }
    try {
      const letto = (await cliente.richiedi("account/read", {}, 20_000)) as { account?: { type?: unknown; planType?: unknown } | null };
      const conto = letto.account;
      if (conto === null || conto === undefined) return { collegato: false };
      if (conto.type === "chatgpt") {
        const piano = typeof conto.planType === "string" && conto.planType !== "" && conto.planType !== "unknown" ? ` ${conMaiuscola(conto.planType)}` : "";
        return { collegato: true, descrizione: `ChatGPT${piano}` };
      }
      return { collegato: true, descrizione: conto.type === "apiKey" ? "Chiave API" : "Codex" };
    } catch (errore) {
      return { collegato: false, motivo: errore instanceof Error ? errore.message : String(errore) };
    } finally {
      cliente.chiudi();
    }
  }

  async #avviaCodex(): Promise<void> {
    if (this.#codex !== undefined) return;
    let concluso: ((parametri: Record<string, unknown>) => void) | undefined;
    const cliente = await this.#clienteCodex((metodo, parametri) => {
      if (metodo === "account/login/completed") concluso?.(parametri);
    });
    try {
      const avvio = (await cliente.richiedi("account/login/start", { type: "chatgptDeviceCode" }, 30_000)) as { loginId?: unknown; verificationUrl?: unknown; userCode?: unknown };
      if (typeof avvio.loginId !== "string" || typeof avvio.verificationUrl !== "string" || typeof avvio.userCode !== "string") {
        throw new Error("Codex non ha dato il codice per l'accesso.");
      }
      const loginId = avvio.loginId;
      const scadenza = setTimeout(() => this.#annulla("codex"), this.#o.attesaAccessoMs ?? ATTESA_ACCESSO_MS);
      scadenza.unref();
      this.#codex = { cliente, loginId, indirizzo: avvio.verificationUrl, codice: avvio.userCode, scadenza };
      concluso = (parametri) => {
        if (parametri.loginId !== null && parametri.loginId !== loginId) return;
        if (this.#codex?.loginId !== loginId) return;
        clearTimeout(scadenza);
        this.#codex = undefined;
        cliente.chiudi();
        if (parametri.success === true) this.#o.dopoIlCambio?.();
      };
    } catch (errore) {
      cliente.chiudi();
      throw errore;
    }
  }

  async #avviaClaude(): Promise<void> {
    if (this.#claude !== undefined) return;
    const [programma, ...prima] = this.#o.comandoClaude ?? programmaDiClaude();
    const processo = spawn(programma ?? "claude", [...prima, "auth", "login", "--claudeai"], {
      cwd: tmpdir(),
      env: this.#ambiente(),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let testo = "";
    let trovato: ((indirizzo: string) => void) | undefined;
    const leggi = (dati: Buffer): void => {
      testo += dati.toString();
      const indirizzo = /https:\/\/\S*oauth\/authorize\S*/.exec(senzaColori(testo))?.[0];
      if (indirizzo !== undefined) trovato?.(indirizzo);
    };
    processo.stdout?.on("data", leggi);
    processo.stderr?.on("data", leggi);
    const uscita = new Promise<{ codice: number | null; testo: string }>((risolvi) => {
      processo.on("error", (errore) => risolvi({ codice: null, testo: errore.message }));
      processo.on("close", (codice) => risolvi({ codice, testo }));
    });
    const indirizzo = await Promise.race([
      new Promise<string>((risolvi) => (trovato = risolvi)),
      uscita.then(({ testo: scritto }) => {
        throw new Error(`Claude Code non ha cominciato l'accesso: ${ultimeRighe(scritto) || "nessun messaggio"}`);
      }),
      new Promise<never>((_, rifiuta) => setTimeout(() => rifiuta(new Error("Claude Code non ha dato l'indirizzo per l'accesso.")), ATTESA_INDIRIZZO_MS).unref()),
    ]).catch((errore: unknown) => {
      processo.kill();
      throw errore;
    });
    const scadenza = setTimeout(() => this.#annulla("claude"), this.#o.attesaAccessoMs ?? ATTESA_ACCESSO_MS);
    scadenza.unref();
    const accesso: AccessoClaude = { processo, indirizzo, uscita, scadenza };
    this.#claude = accesso;
    void uscita.then(() => {
      clearTimeout(scadenza);
      if (this.#claude === accesso) this.#claude = undefined;
    });
  }

  /** Scrive il codice al programma e aspetta com'è finita: il motivo, se non è andata. */
  async #codiceClaude(codice: string): Promise<string | undefined> {
    const accesso = this.#claude;
    if (accesso === undefined) return "Non c'è un accesso a Claude in corso: ricomincia.";
    accesso.processo.stdin?.write(`${codice}\n`);
    const fine = await Promise.race([
      accesso.uscita,
      new Promise<undefined>((risolvi) => setTimeout(() => risolvi(undefined), ATTESA_FINE_MS).unref()),
    ]);
    if (fine === undefined) {
      this.#annulla("claude");
      return "Claude Code non ha concluso l'accesso: ricomincia.";
    }
    if (fine.codice !== 0) return `L'accesso a Claude non è riuscito: ${(ultimeRighe(fine.testo) || "il codice non è stato accettato").replace(/\.+$/, "")}.`;
    this.#o.dopoIlCambio?.();
    return undefined;
  }

  #annulla(motore: Motore): void {
    if (motore === "claude") {
      const accesso = this.#claude;
      this.#claude = undefined;
      if (accesso !== undefined) {
        clearTimeout(accesso.scadenza);
        accesso.processo.kill();
      }
      return;
    }
    const accesso = this.#codex;
    this.#codex = undefined;
    if (accesso === undefined) return;
    clearTimeout(accesso.scadenza);
    void accesso.cliente
      .richiedi("account/login/cancel", { loginId: accesso.loginId }, 10_000)
      .catch(() => {})
      .finally(() => accesso.cliente.chiudi());
  }

  async #esci(motore: Motore): Promise<string | undefined> {
    this.#annulla(motore);
    if (motore === "claude") {
      const { codice, testo } = await this.#claudeCon(["auth", "logout"]);
      if (codice !== 0) return `Claude Code non è uscito: ${ultimeRighe(testo)}`;
    } else {
      const cliente = await this.#clienteCodex();
      try {
        await cliente.richiedi("account/logout", {}, 20_000);
      } finally {
        cliente.chiudi();
      }
    }
    this.#o.dopoIlCambio?.();
    return undefined;
  }
}
