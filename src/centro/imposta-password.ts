/**
 * Imposta la password del proprietario per l'interfaccia di Shinka.
 *
 * Da terminale la chiede due volte senza mostrarla. Se l'ingresso non è un terminale,
 * legge la password dalla prima riga dell'ingresso standard.
 */

import { resolve } from "node:path";
import { text } from "node:stream/consumers";
import { Accesso, LUNGHEZZA_MINIMA_PASSWORD } from "./accesso.ts";

/**
 * Legge righe dal terminale senza mostrarle.
 * Resta in ascolto per tutta la durata: ciò che arriva dopo un Invio, per esempio
 * quando si incolla più di una riga, non va perso ma serve alla domanda successiva.
 */
class TastieraNascosta {
  #inCorso = "";
  readonly #righe: string[] = [];
  #attesa: { risolvi: (riga: string) => void; rifiuta: (errore: Error) => void } | undefined;

  constructor() {
    process.stdin.setRawMode(true);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", this.#alDato);
    process.stdin.resume();
  }

  chiedi(domanda: string): Promise<string> {
    process.stdout.write(domanda);
    return new Promise((risolvi, rifiuta) => {
      this.#attesa = {
        risolvi: (riga) => {
          process.stdout.write("\n");
          risolvi(riga);
        },
        rifiuta,
      };
      this.#consegna();
    });
  }

  chiudi(): void {
    process.stdin.off("data", this.#alDato);
    process.stdin.setRawMode(false);
    process.stdin.pause();
  }

  readonly #alDato = (dato: string): void => {
    for (const carattere of dato) {
      if (carattere === "\u0003") {
        process.stdout.write("\n");
        this.#attesa?.rifiuta(new Error("Annullato. Nulla è stato cambiato."));
        this.#attesa = undefined;
        return;
      }
      if (carattere === "\r" || carattere === "\n") {
        this.#righe.push(this.#inCorso);
        this.#inCorso = "";
      } else if (carattere === "\u007f" || carattere === "\b") {
        this.#inCorso = this.#inCorso.slice(0, -1);
      } else {
        this.#inCorso += carattere;
      }
    }
    this.#consegna();
  };

  #consegna(): void {
    if (this.#attesa === undefined) return;
    const riga = this.#righe.shift();
    if (riga === undefined) return;
    const { risolvi } = this.#attesa;
    this.#attesa = undefined;
    risolvi(riga);
  }
}

async function chiediDueVolte(): Promise<string> {
  const tastiera = new TastieraNascosta();
  try {
    const prima = await tastiera.chiedi(
      `Nuova password (almeno ${LUNGHEZZA_MINIMA_PASSWORD} caratteri): `,
    );
    const seconda = await tastiera.chiedi("Ripeti la password: ");
    if (prima !== seconda) throw new Error("Le due password non coincidono. Nulla è stato cambiato.");
    return prima;
  } finally {
    tastiera.chiudi();
  }
}

async function leggiDaIngresso(): Promise<string> {
  const [riga = ""] = (await text(process.stdin)).split(/\r?\n/);
  return riga;
}

const dati = resolve(process.env.SHINKA_DATI ?? "dati");

try {
  const password = process.stdin.isTTY ? await chiediDueVolte() : await leggiDaIngresso();
  const accesso = await Accesso.apri(dati);
  await accesso.impostaPassword(password);
  console.log(`Password impostata. Le sessioni aperte sono state chiuse. Dati in ${dati}`);
} catch (errore) {
  console.error(errore instanceof Error ? errore.message : String(errore));
  process.exitCode = 1;
}
