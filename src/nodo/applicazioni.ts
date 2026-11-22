/**
 * Le applicazioni dei progetti di questo ambiente: il comando che serve l'anteprima di ciascuno,
 * avviato in primo piano nella cartella del progetto, con la sua uscita tenuta da parte. Vivono nel
 * processo dell'ambiente: il nodo, o il centro per l'ambiente del centro. Spegnendosi le ferma.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { stat } from "node:fs/promises";
import { connect } from "node:net";
import {
  ATTESA_AVVIO_MS,
  RIGHE_MOSTRATE,
  RIGHE_TENUTE,
  type ComandoApplicazione,
  type PortaApplicazioni,
  type RiferitoApplicazione,
  type StatoApplicazione,
} from "../protocollo/applicazioni.ts";

const diWindows = process.platform === "win32";

/** Dice se qualcosa risponde su quella porta di questa macchina. */
export type Sonda = (porta: number) => Promise<boolean>;

export const sondaVera: Sonda = async (porta) => {
  for (const host of ["127.0.0.1", "::1"]) {
    const risponde = await new Promise<boolean>((risolvi) => {
      const presa = connect({ host, port: porta });
      const fine = (esito: boolean): void => {
        presa.destroy();
        risolvi(esito);
      };
      presa.setTimeout(1500, () => fine(false));
      presa.once("connect", () => fine(true));
      presa.once("error", () => fine(false));
    });
    if (risponde) return true;
  }
  return false;
};

interface InEsecuzione {
  processo: ChildProcess;
  porta: number;
  righe: string[];
  /** Il resto di una riga non ancora finita. */
  resto: string;
  /** Presente quando il processo è finito. */
  uscito?: { codice: number | null; segnale: string | null };
  /** Vero se a fermarla è stato chiesto da qui. */
  fermata: boolean;
  finito: Promise<void>;
}

export interface OpzioniApplicazioni {
  sonda?: Sonda;
  attesaAvvioMs?: number;
  /** Ogni quanto si guarda se l'applicazione appena avviata risponde. */
  passoMs?: number;
}

export class Applicazioni implements PortaApplicazioni {
  readonly #riferisci: (messaggio: RiferitoApplicazione) => void;
  readonly #o: OpzioniApplicazioni;
  readonly #in = new Map<string, InEsecuzione>();

  constructor(riferisci: (messaggio: RiferitoApplicazione) => void, opzioni: OpzioniApplicazioni = {}) {
    this.#riferisci = riferisci;
    this.#o = opzioni;
  }

  get #sonda(): Sonda {
    return this.#o.sonda ?? sondaVera;
  }

  esegui(comando: ComandoApplicazione): void {
    const fatto =
      comando.tipo === "applicazione-avvia"
        ? this.avvia(comando.idApplicazione, comando.cartella, comando.comando, comando.porta)
        : comando.tipo === "applicazione-ferma"
          ? this.ferma(comando.idApplicazione)
          : this.stato(comando.idApplicazione, comando.porta);
    void fatto
      .catch((errore: unknown): StatoApplicazione => ({ condizione: "fallita", righe: [], motivo: errore instanceof Error ? errore.message : String(errore) }))
      .then((stato) => this.#riferisci({ tipo: "applicazione-esito", idRichiesta: comando.idRichiesta, stato }));
  }

  /**
   * Avvia l'applicazione, se non è già accesa, e aspetta che risponda sulla sua porta. Se sulla
   * porta risponde già qualcosa che non ha avviato Shinka non ne avvia una seconda: lo dice.
   */
  async avvia(id: string, cartella: string, comando: string, porta: number): Promise<StatoApplicazione> {
    const accesa = this.#in.get(id);
    if (accesa !== undefined && accesa.uscito === undefined) return this.#aspetta(accesa);
    if (await this.#sonda(porta)) {
      return {
        condizione: "fuori-da-shinka",
        righe: [],
        motivo: `Sulla porta ${porta} risponde già qualcosa che Shinka non ha avviato: non ne avvio un'altra. Se va fermata, fermala da dove è stata avviata.`,
      };
    }
    const eCartella = await stat(cartella).then(
      (info) => info.isDirectory(),
      () => false,
    );
    if (!eCartella) return { condizione: "fallita", righe: [], motivo: `La cartella del progetto ${cartella} non c'è.` };

    const [programma, argomenti] = diWindows
      ? ["powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", comando]]
      : ["bash", ["-c", comando]];
    const processo = spawn(programma, argomenti, {
      cwd: cartella,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      // Un gruppo suo: fermarla ferma anche ciò che il comando ha avviato, come il server dietro `npm run dev`.
      detached: !diWindows,
      // Molti server di sviluppo prendono la porta da qui.
      env: { ...process.env, PORT: String(porta) },
    });
    let uscita: () => void = () => {};
    const voce: InEsecuzione = {
      processo,
      porta,
      righe: [],
      resto: "",
      fermata: false,
      finito: new Promise((fatto) => (uscita = fatto)),
    };
    this.#in.set(id, voce);
    const raccogli = (dati: Buffer): void => this.#aggiungi(voce, dati.toString("utf8"));
    processo.stdout?.on("data", raccogli);
    processo.stderr?.on("data", raccogli);
    processo.on("error", (errore) => {
      this.#aggiungi(voce, `\n${errore.message}\n`);
      voce.uscito ??= { codice: null, segnale: null };
      uscita();
    });
    processo.on("close", (codice, segnale) => {
      if (voce.resto !== "") this.#aggiungi(voce, "\n");
      voce.uscito = { codice, segnale };
      uscita();
    });
    return this.#aspetta(voce);
  }

  /** Ferma l'applicazione e ciò che ha avviato. Se non è accesa, è già ferma. */
  async ferma(id: string): Promise<StatoApplicazione> {
    const voce = this.#in.get(id);
    if (voce === undefined || voce.uscito !== undefined) return { condizione: "ferma", righe: voce?.righe.slice(-RIGHE_MOSTRATE) ?? [] };
    voce.fermata = true;
    termina(voce.processo, false);
    const fermata = await Promise.race([voce.finito.then(() => true), attendi(4000).then(() => false)]);
    if (!fermata) {
      termina(voce.processo, true);
      await Promise.race([voce.finito, attendi(3000)]);
    }
    return { condizione: "ferma", righe: voce.righe.slice(-RIGHE_MOSTRATE) };
  }

  async stato(id: string, porta: number): Promise<StatoApplicazione> {
    const voce = this.#in.get(id);
    if (voce !== undefined) return this.#condizione(voce);
    return (await this.#sonda(porta)) ? { condizione: "fuori-da-shinka", righe: [] } : { condizione: "ferma", righe: [] };
  }

  /** Il processo dell'ambiente si spegne: con lui le applicazioni che ha avviato. */
  spegniTutte(): void {
    for (const voce of this.#in.values()) {
      if (voce.uscito !== undefined) continue;
      voce.fermata = true;
      termina(voce.processo, true);
    }
  }

  /** Aspetta che l'applicazione risponda, che si fermi, o che passi il tempo dell'avvio. */
  async #aspetta(voce: InEsecuzione): Promise<StatoApplicazione> {
    const scade = Date.now() + (this.#o.attesaAvvioMs ?? ATTESA_AVVIO_MS);
    while (voce.uscito === undefined && Date.now() < scade) {
      if (await this.#sonda(voce.porta)) break;
      await Promise.race([voce.finito, attendi(this.#o.passoMs ?? 500)]);
    }
    return this.#condizione(voce);
  }

  async #condizione(voce: InEsecuzione): Promise<StatoApplicazione> {
    const righe = voce.righe.slice(-RIGHE_MOSTRATE);
    if (voce.uscito !== undefined) {
      if (voce.fermata) return { condizione: "ferma", righe };
      const { codice, segnale } = voce.uscito;
      return {
        condizione: "fallita",
        righe,
        motivo:
          codice === 0
            ? "Il comando è finito da solo: deve restare in primo piano mentre serve l'applicazione, non avviarla in background."
            : `Il comando si è fermato${codice === null ? (segnale === null ? "" : ` (${segnale})`) : ` con il codice ${codice}`}.`,
      };
    }
    return (await this.#sonda(voce.porta))
      ? { condizione: "attiva", righe }
      : { condizione: "in-avvio", righe, motivo: `Il comando gira, ma sulla porta ${voce.porta} non risponde ancora nulla.` };
  }

  #aggiungi(voce: InEsecuzione, testo: string): void {
    const parti = (voce.resto + testo).replace(/\r\n/g, "\n").split("\n");
    voce.resto = parti.pop() ?? "";
    // Toglie i colori e i ritorni a capo dei terminali: qui l'uscita si legge come testo.
    for (const riga of parti) voce.righe.push(riga.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/.*\r/, ""));
    if (voce.righe.length > RIGHE_TENUTE) voce.righe.splice(0, voce.righe.length - RIGHE_TENUTE);
  }
}

function attendi(ms: number): Promise<void> {
  return new Promise((fatto) => setTimeout(fatto, ms).unref());
}

/** Ferma il processo e i suoi figli: con garbo, oppure subito. */
function termina(processo: ChildProcess, subito: boolean): void {
  const pid = processo.pid;
  if (pid === undefined) return;
  if (diWindows) {
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }).on("error", () => {});
    return;
  }
  try {
    process.kill(-pid, subito ? "SIGKILL" : "SIGTERM");
  } catch {
    // Già finito.
  }
}
