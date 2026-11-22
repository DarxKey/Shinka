/**
 * Esegue un comando su un host via SSH con una credenziale del vault. È l'unico punto in cui
 * il valore di una credenziale lascia il gateway, e va soltanto all'host.
 */

import { createHash } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import ssh2 from "ssh2";
import type { CredenzialePerUso } from "./vault.ts";

/** Quanto dell'uscita di un comando torna indietro: l'inizio e la fine, se è più lunga. */
const USCITA_MASSIMA = 30_000;

/** Quanto si aspetta che l'host risponda e accetti l'accesso. */
const ATTESA_COLLEGAMENTO_MS = 20_000;

export interface EsitoComando {
  /** Il codice di uscita; nullo se il comando è stato fermato o chiuso da un segnale. */
  codice: number | null;
  uscita: string;
  errori: string;
  scaduto: boolean;
  /** L'impronta della chiave con cui l'host si è presentato. */
  impronta: string;
  durataMs: number;
}

/** Il comando non è stato eseguito: l'host non è quello di prima, non ha accettato l'accesso, o non risponde. */
export class ErroreSsh extends Error {
  readonly causaSsh: "impronta" | "accesso" | "collegamento";

  constructor(causaSsh: "impronta" | "accesso" | "collegamento", messaggio: string) {
    super(messaggio);
    this.causaSsh = causaSsh;
  }
}

/** Tiene l'inizio e la fine di un testo che può essere molto lungo. */
class Raccolta {
  readonly #decodifica = new StringDecoder("utf8");
  readonly #meta: number;
  #testa = "";
  #coda = "";
  #saltati = 0;

  constructor(massimo: number) {
    this.#meta = Math.floor(massimo / 2);
  }

  aggiungi(pezzo: Buffer): void {
    let testo = this.#decodifica.write(pezzo);
    if (this.#testa.length < this.#meta) {
      const spazio = this.#meta - this.#testa.length;
      this.#testa += testo.slice(0, spazio);
      testo = testo.slice(spazio);
    }
    this.#coda += testo;
    if (this.#coda.length > this.#meta * 2) {
      this.#saltati += this.#coda.length - this.#meta;
      this.#coda = this.#coda.slice(-this.#meta);
    }
  }

  testo(): string {
    let coda = this.#coda + this.#decodifica.end();
    let saltati = this.#saltati;
    if (coda.length > this.#meta) {
      saltati += coda.length - this.#meta;
      coda = coda.slice(-this.#meta);
    }
    return saltati === 0 ? this.#testa + coda : `${this.#testa}\n[… tagliati ${saltati} caratteri …]\n${coda}`;
  }
}

/** L'impronta di una chiave pubblica, scritta come la scrive OpenSSH. */
export function improntaDi(chiave: Buffer): string {
  return `SHA256:${createHash("sha256").update(chiave).digest("base64").replace(/=+$/, "")}`;
}

/**
 * Si collega all'host, esegue il comando e restituisce ciò che ha scritto. Se la credenziale
 * ricorda l'impronta dell'host e l'host si presenta con un'altra, il collegamento si chiude
 * prima che il valore della credenziale venga mandato. Se c'è un `ingresso`, il comando lo
 * legge come se fosse scritto alla tastiera, e poi trova la fine.
 */
export function eseguiSuHost(credenziale: CredenzialePerUso, comando: string, durataMs: number, ingresso?: string): Promise<EsitoComando> {
  return new Promise((risolvi, rifiuta) => {
    const cliente = new ssh2.Client();
    const inizio = Date.now();
    const uscita = new Raccolta(USCITA_MASSIMA);
    const errori = new Raccolta(USCITA_MASSIMA);
    let impronta = "";
    let improntaDiversa = false;
    let concluso = false;
    let scadenza: NodeJS.Timeout | undefined;

    const chiudi = (): boolean => {
      if (concluso) return false;
      concluso = true;
      if (scadenza !== undefined) clearTimeout(scadenza);
      cliente.end();
      return true;
    };
    const riuscito = (codice: number | null, scaduto: boolean): void => {
      if (!chiudi()) return;
      risolvi({ codice, uscita: uscita.testo(), errori: errori.testo(), scaduto, impronta, durataMs: Date.now() - inizio });
    };
    const fallito = (errore: ErroreSsh): void => {
      if (chiudi()) rifiuta(errore);
    };

    cliente.on("ready", () => {
      cliente.exec(comando, (errore, flusso) => {
        if (errore !== undefined) {
          fallito(new ErroreSsh("collegamento", `L'host non ha accettato il comando: ${errore.message}`));
          return;
        }
        scadenza = setTimeout(() => {
          flusso.close();
          riuscito(null, true);
        }, durataMs);
        flusso.on("data", (pezzo: Buffer) => uscita.aggiungi(pezzo));
        flusso.stderr.on("data", (pezzo: Buffer) => errori.aggiungi(pezzo));
        flusso.on("close", (codice: number | null) => riuscito(typeof codice === "number" ? codice : null, false));
        if (ingresso !== undefined) flusso.end(ingresso);
      });
    });
    // Alcuni host chiedono la password con una domanda invece che nel modo solito.
    cliente.on("keyboard-interactive", (_nome, _istruzioni, _lingua, domande, rispondi) => {
      rispondi(credenziale.tipo === "password" ? domande.map(() => credenziale.segreto) : []);
    });
    cliente.on("error", (errore: Error & { level?: string }) => {
      if (improntaDiversa) {
        fallito(
          new ErroreSsh(
            "impronta",
            `L'host ${credenziale.host} si è presentato con una chiave diversa da quella del primo collegamento (ora ${impronta}): ` +
              "la credenziale non è stata mandata. Se l'host è stato reinstallato, il proprietario deve sostituire la credenziale dalla pagina del vault.",
          ),
        );
      } else if (errore.level === "client-authentication") {
        fallito(new ErroreSsh("accesso", `L'host ${credenziale.host} non ha accettato la credenziale per l'utente ${credenziale.utente}.`));
      } else {
        fallito(new ErroreSsh("collegamento", `Non è stato possibile collegarsi a ${credenziale.host}:${credenziale.porta}: ${errore.message}`));
      }
    });
    cliente.on("close", () => {
      fallito(new ErroreSsh("collegamento", `Il collegamento con ${credenziale.host} si è chiuso prima della fine del comando.`));
    });

    try {
      cliente.connect({
        host: credenziale.host,
        port: credenziale.porta,
        username: credenziale.utente,
        ...(credenziale.tipo === "password"
          ? { password: credenziale.segreto, tryKeyboard: true }
          : {
              privateKey: credenziale.segreto,
              ...(credenziale.fraseDellaChiave === undefined ? {} : { passphrase: credenziale.fraseDellaChiave }),
            }),
        readyTimeout: ATTESA_COLLEGAMENTO_MS,
        hostVerifier: (chiave: Buffer): boolean => {
          impronta = improntaDi(chiave);
          improntaDiversa = credenziale.impronta !== undefined && credenziale.impronta !== impronta;
          return !improntaDiversa;
        },
      });
    } catch (errore) {
      fallito(new ErroreSsh("collegamento", errore instanceof Error ? errore.message : String(errore)));
    }
  });
}
