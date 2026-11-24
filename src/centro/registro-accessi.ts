/**
 * Il registro degli accessi del centro (ADR 0039): chi entra, da dove, i tentativi falliti, e ciò
 * che arriva a Shinka senza una sessione. Serve al proprietario per sapere, dopo, che cosa è
 * successo: Shinka è raggiungibile anche da fuori casa. Sta in un file a righe tra i dati del
 * centro. Non tiene il contenuto delle richieste, né le chiavi che stanno negli indirizzi.
 *
 * Non è il registro del gateway, che annota l'uso delle credenziali.
 */

import { appendFileSync, existsSync, readFileSync, renameSync, statSync } from "node:fs";
import { DA_GUARDARE, type TipoAccesso, type VoceAccesso } from "../protocollo/sicurezza.ts";
import type { ChiEntra } from "./accesso.ts";

export { DA_GUARDARE, TIPI_ACCESSO, type TipoAccesso, type VoceAccesso } from "../protocollo/sicurezza.ts";

/** Ciò che si ripete a raffica: se ne scrive una riga, con quante volte è successo. */
const RIPETUTI: readonly TipoAccesso[] = ["senza-sessione", "dispositivo-rifiutato", "evento-accolto", "origine-rifiutata", "pagina-inesistente", "evento-rifiutato", "invito-rifiutato", "nodo-presentato", "nodo-in-chiaro", "entrata-frenata", "richiesta-estensione", "richiesta-estensione-rifiutata"];
/** Per quanto le ripetizioni di una stessa cosa, dallo stesso indirizzo, stanno in una riga sola. */
const FINESTRA_MS = 10 * 60 * 1000;
const VOCI_IN_MEMORIA = 2000;
const FILE_MASSIMO = 1024 * 1024;

/** Il programma che fa la richiesta, in breve, da ciò che dice di sé. */
export function programmaDa(dice: string | undefined): string {
  if (dice === undefined || dice.trim() === "") return "non lo dice";
  // L'app di Shinka per il computer, con la sua versione (ADR 0047).
  const desktop = /^ShinkaDesktop\/([0-9A-Za-z.+-]{1,24})/.exec(dice);
  if (desktop !== null) return `Shinka Desktop ${desktop[1]}`;
  const strumento = /^(curl|Wget|python-requests|Go-http-client|node|PowerShell|okhttp|Java)\b[^\s]*/i.exec(dice);
  if (strumento !== null) return strumento[0].slice(0, 40);
  const macchina = /iPhone/.test(dice) ? "iPhone" : /iPad/.test(dice) ? "iPad" : /Android/.test(dice) ? "Android" : /Windows/.test(dice) ? "PC Windows" : /Macintosh/.test(dice) ? "Mac" : /Linux/.test(dice) ? "Linux" : "";
  const browser = /Edg\//.test(dice) ? "Edge" : /Firefox\//.test(dice) ? "Firefox" : /Chrome\//.test(dice) ? "Chrome" : /Safari\//.test(dice) ? "Safari" : "";
  if (macchina === "" && browser === "") return dice.replace(/[^\x20-\x7e]/g, "").slice(0, 40);
  return [macchina, browser].filter((parte) => parte !== "").join(" · ");
}

/**
 * Da dove arriva una richiesta. `diretto` è l'indirizzo che si è collegato al centro: se è un
 * proxy, `inoltrato` è ciò che il proxy scrive nell'intestazione X-Forwarded-For, che vale quanto
 * vale il proxy: chi si collega direttamente può scriverci ciò che vuole.
 */
export function daDove(diretto: string | undefined, inoltrato: string | string[] | undefined): string {
  const pulito = (testo: string): string => testo.replace(/^::ffff:/, "").replace(/[^0-9a-fA-F:.]/g, "").slice(0, 45);
  const primo = pulito(diretto ?? "") || "sconosciuto";
  const scritto = ((Array.isArray(inoltrato) ? inoltrato[0] : inoltrato)?.split(",")[0] ?? "").trim();
  // Ciò che non ha la forma di un indirizzo non entra nel registro com'è scritto.
  const detto = scritto === "" ? "" : /^[0-9a-fA-F:.]{2,45}$/.test(scritto) ? pulito(scritto) : "un indirizzo che non si legge";
  return detto === "" || detto === primo ? primo : `${primo} (per conto di ${detto})`;
}

export class RegistroAccessi {
  readonly #file: string | undefined;
  readonly #adesso: () => number;
  #voci: VoceAccesso[] = [];
  /** Le ripetizioni in corso: la voce a cui si sommano. */
  readonly #aperte = new Map<string, VoceAccesso>();
  #timer: NodeJS.Timeout | undefined;

  constructor(opzioni: { file?: string; adesso?: () => number } = {}) {
    this.#file = opzioni.file;
    this.#adesso = opzioni.adesso ?? Date.now;
    if (this.#file !== undefined) {
      // Una voce riscritta con il suo conto prende il posto di quella di prima; due cose diverse
      // successe nello stesso istante restano due righe.
      const lette: VoceAccesso[] = [];
      const posto = new Map<string, number>();
      for (const file of [`${this.#file}.1`, this.#file]) {
        if (!existsSync(file)) continue;
        for (const riga of readFileSync(file, "utf8").split("\n")) {
          try {
            const voce = JSON.parse(riga) as VoceAccesso;
            if (typeof voce.quando !== "string" || typeof voce.tipo !== "string") continue;
            const chiave = `${voce.quando}|${voce.tipo}|${voce.da}|${voce.dettaglio ?? ""}`;
            const prima = posto.get(chiave);
            if (voce.volte !== undefined && prima !== undefined) lette[prima] = voce;
            else posto.set(chiave, lette.push(voce) - 1);
          } catch {
            // Una riga rovinata si salta.
          }
        }
      }
      this.#voci = lette.slice(-VOCI_IN_MEMORIA);
      this.#timer = setInterval(() => this.#chiudiLeFinestre(), 60_000);
      this.#timer.unref();
    }
  }

  /** Annota una cosa successa. Non lancia mai: un registro che non si scrive non deve fermare il centro. */
  annota(tipo: TipoAccesso, chi: ChiEntra, altro: { percorso?: string; dettaglio?: string } = {}): void {
    const adesso = this.#adesso();
    const percorso = altro.percorso?.split("?")[0]?.slice(0, 200);
    if (RIPETUTI.includes(tipo)) {
      const chiave = `${tipo}|${chi.da}|${altro.dettaglio ?? ""}`;
      const aperta = this.#aperte.get(chiave);
      if (aperta !== undefined && adesso - Date.parse(aperta.quando) < FINESTRA_MS) {
        aperta.volte = (aperta.volte ?? 1) + 1;
        aperta.finoA = new Date(adesso).toISOString();
        return;
      }
      if (aperta !== undefined) this.#chiudi(chiave, aperta);
    }
    const voce: VoceAccesso = {
      quando: new Date(adesso).toISOString(),
      tipo,
      da: chi.da,
      programma: chi.programma,
      ...(percorso === undefined ? {} : { percorso }),
      ...(altro.dettaglio === undefined ? {} : { dettaglio: altro.dettaglio.slice(0, 200) }),
    };
    this.#voci.push(voce);
    if (this.#voci.length > VOCI_IN_MEMORIA) this.#voci.splice(0, this.#voci.length - VOCI_IN_MEMORIA);
    if (RIPETUTI.includes(tipo)) this.#aperte.set(`${tipo}|${chi.da}|${altro.dettaglio ?? ""}`, voce);
    this.#scrivi(voce);
  }

  /** Le ultime voci, dalla più recente; con `soloDaGuardare`, solo ciò che qualcuno ha provato senza riuscirci. */
  ultime(quante: number, soloDaGuardare = false): VoceAccesso[] {
    const scelte = soloDaGuardare ? this.#voci.filter((voce) => DA_GUARDARE.includes(voce.tipo)) : this.#voci;
    return scelte.slice(-quante).reverse();
  }

  chiudi(): void {
    if (this.#timer !== undefined) clearInterval(this.#timer);
    for (const [chiave, voce] of [...this.#aperte]) this.#chiudi(chiave, voce);
  }

  #chiudiLeFinestre(): void {
    const adesso = this.#adesso();
    for (const [chiave, voce] of [...this.#aperte]) if (adesso - Date.parse(voce.quando) >= FINESTRA_MS) this.#chiudi(chiave, voce);
  }

  /** Una finestra si chiude: se la cosa si è ripetuta, la riga viene riscritta con il suo conto. */
  #chiudi(chiave: string, voce: VoceAccesso): void {
    this.#aperte.delete(chiave);
    if ((voce.volte ?? 1) > 1) this.#scrivi(voce);
  }

  #scrivi(voce: VoceAccesso): void {
    if (this.#file === undefined) return;
    try {
      if (existsSync(this.#file) && statSync(this.#file).size > FILE_MASSIMO) renameSync(this.#file, `${this.#file}.1`);
      appendFileSync(this.#file, `${JSON.stringify(voce)}\n`, { mode: 0o600 });
    } catch (errore) {
      console.error(`Registro degli accessi non scritto: ${errore instanceof Error ? errore.message : String(errore)}`);
    }
  }
}
