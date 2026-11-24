/**
 * I modelli locali di un ambiente (ADR 0051): le estensioni «modello-locale» accese qui. Il server
 * di un modello si accende quando una conversazione lo sceglie, e resta acceso finché qualcuna lo
 * usa; dieci minuti dopo l'ultima si spegne, per liberare la scheda video. Se il server risponde già
 * sulla sua porta, acceso dal proprietario fuori da Shinka, lo si usa così com'è e non lo si spegne.
 * Mentre è acceso si misura quanta memoria della scheda video è occupata.
 */

import { execFile, spawn, type ChildProcess } from "node:child_process";
import type { Impegno, ModelloDisponibile } from "../protocollo/impostazioni.ts";
import {
  ATTESA_MODELLO_LOCALE_MS,
  MODELLO_LOCALE_FERMO_MS,
  estensioneDelModello,
  valoreDelModelloLocale,
  type DefinizioneEstensione,
  type EsitoProva,
  type EstensioneDistribuita,
} from "../protocollo/estensioni.ts";

export type DefinizioneModelloLocale = Extract<DefinizioneEstensione, { tipo: "modello-locale" }>;

/** Un modello locale preso da una conversazione: va lasciato quando il suo processo finisce. */
export interface PresaDelModello {
  /** Il nome con cui il server chiama il modello. */
  modello: string;
  /** L'indirizzo del server, per Claude Code. */
  indirizzo: string;
  contesto: number;
  uscita: number;
  /** Si risolve quando il server risponde; si rifiuta, con il motivo, se non parte. */
  pronto: Promise<void>;
  /** Il picco di memoria della scheda video da quando il server è acceso, in MB, se si sa. */
  vramPiccoMb(): number | undefined;
  lascia(): void;
}

/** Come si fa partire il server. Nei test, uno finto. */
export type AvviaServer = (comando: string, argomenti: string[], variabili: Record<string, string>) => ChildProcess;

/** Risponde il server sulla sua porta? */
export type Sonda = (porta: number) => Promise<boolean>;

/** Quanta memoria della scheda video è occupata adesso, in MB; nulla se non si sa. */
export type LeggiVram = () => Promise<number | undefined>;

export interface OpzioniModelliLocali {
  avvia?: AvviaServer;
  sonda?: Sonda;
  vram?: LeggiVram;
  attesaMs?: number;
  fermoMs?: number;
  /** Ogni quanto si guarda se il server risponde, mentre si carica. */
  passoMs?: number;
  /** Ogni quanto si misura la scheda video. */
  misuraMs?: number;
}

interface ServerAcceso {
  definizione: DefinizioneModelloLocale;
  impegno: Impegno;
  /** Il processo, se lo ha acceso Shinka; nulla se era già acceso. */
  processo?: ChildProcess;
  pronto: Promise<void>;
  utenti: number;
  spegnimento?: NodeJS.Timeout;
  misura?: NodeJS.Timeout;
  vramPicco?: number;
  spento: boolean;
}

const sondaVera: Sonda = async (porta) => {
  try {
    const risposta = await fetch(`http://127.0.0.1:${porta}/health`, { signal: AbortSignal.timeout(2000) });
    return risposta.ok;
  } catch {
    return false;
  }
};

const avviaVero: AvviaServer = (comando, argomenti, variabili) =>
  spawn(comando, argomenti, {
    env: { ...process.env, ...variabili },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    // Su Linux il server e ciò che avvia stanno in un gruppo, che si spegne tutto insieme.
    detached: process.platform !== "win32",
  });

const vramVera: LeggiVram = () =>
  new Promise((risolvi) => {
    execFile("nvidia-smi", ["--query-gpu=memory.used", "--format=csv,noheader,nounits"], { timeout: 5000, windowsHide: true }, (errore, uscita) => {
      if (errore !== null) return risolvi(undefined);
      const valori = uscita.split(/\r?\n/).map((riga) => Number.parseInt(riga.trim(), 10)).filter((numero) => Number.isFinite(numero));
      risolvi(valori.length === 0 ? undefined : valori.reduce((somma, uno) => somma + uno, 0));
    });
  });

/** Spegne un processo con ciò che ha avviato. */
function spegniProcesso(processo: ChildProcess): void {
  if (processo.exitCode !== null || processo.pid === undefined) return;
  if (process.platform === "win32") {
    execFile("taskkill", ["/pid", String(processo.pid), "/T", "/F"], { windowsHide: true }, () => {});
    return;
  }
  try {
    process.kill(-processo.pid, "SIGTERM");
  } catch {
    processo.kill("SIGTERM");
  }
  setTimeout(() => {
    if (processo.exitCode !== null || processo.pid === undefined) return;
    try {
      process.kill(-processo.pid, "SIGKILL");
    } catch {
      processo.kill("SIGKILL");
    }
  }, 5000).unref();
}

export class ModelliLocali {
  readonly #o: OpzioniModelliLocali;
  #accese: { nome: string; definizione: DefinizioneModelloLocale }[] = [];
  readonly #server = new Map<string, ServerAcceso>();

  constructor(opzioni: OpzioniModelliLocali = {}) {
    this.#o = opzioni;
  }

  /** Le estensioni accese qui sono cambiate: si tengono quelle dei modelli locali. Un server di un'estensione tolta si spegne. */
  imposta(estensioni: readonly EstensioneDistribuita[]): void {
    this.#accese = estensioni.flatMap((una) => (una.definizione.tipo === "modello-locale" ? [{ nome: una.nome, definizione: una.definizione }] : []));
    for (const [nome, server] of this.#server) {
      const ancora = this.#accese.find((una) => una.nome === nome);
      if (ancora === undefined || JSON.stringify(ancora.definizione) !== JSON.stringify(server.definizione)) {
        if (server.utenti === 0) this.#spegni(nome);
      }
    }
  }

  /** I modelli locali accesi qui, come voci della scelta del modello. */
  modelli(): ModelloDisponibile[] {
    return this.#accese.map(({ nome, definizione }) => voceDelModello(nome, definizione));
  }

  /**
   * Prende il modello locale scelto da una conversazione, accendendo il server se serve. Il motivo, se
   * non si può: il modello non c'è qui, o il server è acceso con un altro impegno e un'altra
   * conversazione lo sta usando.
   */
  prendi(modello: string, impegno?: Impegno): PresaDelModello | { motivo: string } {
    const nome = estensioneDelModello(modello);
    const acceso = this.#accese.find((una) => una.nome === nome);
    if (nome === undefined || acceso === undefined) {
      return { motivo: `Il modello locale "${nome ?? modello}" non è acceso in questo ambiente: va acceso dall'elenco delle estensioni.` };
    }
    const { definizione } = acceso;
    const voluto = impegno ?? definizione.impegni[0] ?? "medium";
    if (!definizione.impegni.includes(voluto)) {
      return { motivo: `Il modello locale "${nome}" accetta questi impegni: ${definizione.impegni.join(", ")}.` };
    }
    let server = this.#server.get(nome);
    if (server !== undefined && (server.impegno !== voluto || JSON.stringify(server.definizione) !== JSON.stringify(definizione))) {
      if (server.utenti > 0) {
        return { motivo: `Il modello locale "${nome}" è acceso con impegno ${server.impegno} e lo sta usando un'altra conversazione: aspetta che finisca.` };
      }
      this.#spegni(nome);
      server = undefined;
    }
    if (server === undefined) server = this.#accendi(nome, definizione, voluto);
    const preso = server;
    preso.utenti += 1;
    if (preso.spegnimento !== undefined) clearTimeout(preso.spegnimento);
    preso.spegnimento = undefined;
    let lasciato = false;
    return {
      modello: definizione.modello,
      indirizzo: `http://127.0.0.1:${definizione.porta}`,
      contesto: definizione.contesto,
      uscita: definizione.uscita,
      pronto: preso.pronto,
      vramPiccoMb: () => preso.vramPicco,
      lascia: () => {
        if (lasciato) return;
        lasciato = true;
        preso.utenti -= 1;
        if (preso.utenti > 0 || preso.spento) return;
        preso.spegnimento = setTimeout(() => {
          if (preso.utenti === 0 && this.#server.get(nome) === preso) this.#spegni(nome);
        }, this.#o.fermoMs ?? MODELLO_LOCALE_FERMO_MS);
        preso.spegnimento.unref();
      },
    };
  }

  /**
   * La prova di un'estensione «modello-locale», prima di accenderla: il server parte, risponde, e
   * dice il suo modello. Poi si spegne, se lo ha acceso la prova.
   */
  async prova(definizione: DefinizioneModelloLocale): Promise<EsitoProva> {
    const nome = `prova-${Date.now()}`;
    const server = this.#accendi(nome, definizione, definizione.impegni[0] ?? "medium");
    try {
      await server.pronto;
      return { riuscita: true, strumenti: [definizione.modello] };
    } catch (errore) {
      return { riuscita: false, motivo: errore instanceof Error ? errore.message : String(errore) };
    } finally {
      this.#spegni(nome);
    }
  }

  /** Spegne tutti i server accesi da Shinka, per esempio quando il nodo si ferma. */
  chiudi(): void {
    for (const nome of [...this.#server.keys()]) this.#spegni(nome);
  }

  #accendi(nome: string, definizione: DefinizioneModelloLocale, impegno: Impegno): ServerAcceso {
    const server: ServerAcceso = { definizione, impegno, pronto: Promise.resolve(), utenti: 0, spento: false };
    server.pronto = this.#parti(server);
    // Chi non aspetta il server non deve vedere il suo rifiuto come un errore non raccolto.
    server.pronto.catch(() => {
      if (this.#server.get(nome) === server) this.#spegni(nome);
    });
    this.#server.set(nome, server);
    return server;
  }

  async #parti(server: ServerAcceso): Promise<void> {
    const { definizione } = server;
    const sonda = this.#o.sonda ?? sondaVera;
    // Già acceso fuori da Shinka: lo si usa così com'è, con l'impegno con cui è partito.
    if (await sonda(definizione.porta)) {
      this.#misura(server);
      return;
    }
    const argomenti = definizione.argomenti.map((uno) => uno.replaceAll("{impegno}", server.impegno));
    let processo: ChildProcess;
    try {
      processo = (this.#o.avvia ?? avviaVero)(definizione.comando, argomenti, definizione.variabili);
    } catch (errore) {
      throw new Error(`Il server del modello non è partito: ${errore instanceof Error ? errore.message : String(errore)}`);
    }
    server.processo = processo;
    let uscita = "";
    const tieni = (dati: Buffer | string): void => {
      uscita = (uscita + dati.toString()).slice(-4000);
    };
    processo.stdout?.on("data", tieni);
    processo.stderr?.on("data", tieni);
    let finito: string | undefined;
    processo.on("error", (errore) => (finito = errore.message));
    processo.on("exit", (codice) => {
      finito ??= `si è fermato (codice ${codice ?? "?"})`;
      server.spento = true;
      if (server.misura !== undefined) clearInterval(server.misura);
    });
    const scade = Date.now() + (this.#o.attesaMs ?? ATTESA_MODELLO_LOCALE_MS);
    for (;;) {
      if (finito !== undefined) {
        const righe = uscita.trim().split(/\r?\n/).slice(-6).join("\n");
        throw new Error(`Il server del modello ${finito}.${righe === "" ? "" : `\n${righe}`}`);
      }
      if (await sonda(definizione.porta)) break;
      if (Date.now() > scade) throw new Error(`Il server del modello non ha risposto su 127.0.0.1:${definizione.porta} entro ${Math.round((this.#o.attesaMs ?? ATTESA_MODELLO_LOCALE_MS) / 1000)} secondi.`);
      await new Promise((fatto) => setTimeout(fatto, this.#o.passoMs ?? 1000));
    }
    this.#misura(server);
  }

  #misura(server: ServerAcceso): void {
    const leggi = this.#o.vram ?? vramVera;
    const una = (): void => {
      void leggi().then((mb) => {
        if (mb !== undefined && (server.vramPicco === undefined || mb > server.vramPicco)) server.vramPicco = mb;
      });
    };
    una();
    server.misura = setInterval(una, this.#o.misuraMs ?? 5000);
    server.misura.unref();
  }

  #spegni(nome: string): void {
    const server = this.#server.get(nome);
    if (server === undefined) return;
    this.#server.delete(nome);
    server.spento = true;
    if (server.spegnimento !== undefined) clearTimeout(server.spegnimento);
    if (server.misura !== undefined) clearInterval(server.misura);
    if (server.processo !== undefined) spegniProcesso(server.processo);
  }

  /** Vero se il server di quel modello è acceso adesso. Per le prove. */
  acceso(nome: string): boolean {
    return this.#server.has(nome);
  }
}

/** Un modello locale come voce della scelta del modello. */
export function voceDelModello(nome: string, definizione: DefinizioneModelloLocale): ModelloDisponibile {
  return {
    valore: valoreDelModelloLocale(nome),
    nome: `${definizione.modello} (locale)`,
    descrizione: `Gira su questa macchina, con ${Math.round(definizione.contesto / 1024)}K token di contesto: si accende quando serve.`,
    impegni: definizione.impegni,
    motore: "claude",
  };
}
