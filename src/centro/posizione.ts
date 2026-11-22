/**
 * La posizione che il proprietario ha condiviso con la Home. Sta solo qui, finché il centro è
 * acceso: non va in memoria né su disco, e scade. Il messaggio con cui l'ha condivisa resta nella
 * storia dell'argomento, come ogni suo messaggio.
 *
 * Non è legata a un argomento: il messaggio con la posizione spesso apre un argomento nuovo, e lì
 * deve valere. La lega invece il tempo.
 */

import { coordinate, quantoFa, type Posizione } from "../protocollo/posizione.ts";

/** Per quanto vale una posizione condivisa una volta. */
export const POSIZIONE_VALE_MS = 2 * 60 * 60_000;

/** Quanto vale ancora l'ultimo punto di una posizione dal vivo, dopo la fine della condivisione. */
const DOPO_IL_VIVO_MS = 10 * 60_000;

export class PosizioneDelProprietario {
  #ultima: Posizione | undefined;
  readonly #adesso: () => number;

  constructor(adesso: () => number = Date.now) {
    this.#adesso = adesso;
  }

  /** Il proprietario ha condiviso la posizione. */
  registra(posizione: Posizione): void {
    this.#ultima = posizione;
  }

  /**
   * Un nuovo punto di una posizione condivisa dal vivo. Vale solo se l'ultima era dal vivo: una
   * posizione condivisa una volta non diventa un tracciamento. Vero se è stata aggiornata.
   */
  aggiorna(posizione: Posizione): boolean {
    const ultima = this.ultima();
    if (ultima === undefined || ultima.dalVivo !== true || posizione.dalVivo !== true) return false;
    if (Date.parse(posizione.quando) < Date.parse(ultima.quando)) return false;
    this.#ultima = { ...posizione, ...(posizione.finoA === undefined && ultima.finoA !== undefined ? { finoA: ultima.finoA } : {}) };
    return true;
  }

  /** L'ultima posizione condivisa, se non è scaduta. */
  ultima(): Posizione | undefined {
    const ultima = this.#ultima;
    if (ultima === undefined) return undefined;
    const scade =
      ultima.dalVivo === true && ultima.finoA !== undefined
        ? Date.parse(ultima.finoA) + DOPO_IL_VIVO_MS
        : Date.parse(ultima.quando) + POSIZIONE_VALE_MS;
    if (this.#adesso() > scade) {
      this.#ultima = undefined;
      return undefined;
    }
    return ultima;
  }
}

/** Ciò che la Home legge della posizione: il dato, da dove viene e quanto è vecchio. */
export function posizioneInParole(posizione: Posizione | undefined, adesso: number): string {
  if (posizione === undefined) {
    return (
      "Il proprietario non ha condiviso la sua posizione nelle ultime ore. Chiedigliela: da Telegram scrive /posizione al bot " +
      "e tocca «Invia la mia posizione»; dall'interfaccia preme il pulsante con il segnaposto, accanto al campo di scrittura."
    );
  }
  const fonte = posizione.fonte === "telegram" ? "da Telegram" : "dal browser";
  const precisione = posizione.precisioneM === undefined ? "precisione non indicata" : `precisione ±${posizione.precisioneM} m`;
  const vivo =
    posizione.dalVivo === true
      ? ` È condivisa dal vivo${posizione.finoA === undefined ? "" : ` fino alle ${posizione.finoA.slice(11, 16)} UTC`}: questo è l'ultimo punto arrivato.`
      : "";
  const vecchia = adesso - Date.parse(posizione.quando) > 30 * 60_000 ? " È vecchia: prima di usarla chiedi al proprietario se è ancora lì." : "";
  return (
    `Posizione del proprietario: ${coordinate(posizione)} (${precisione}), condivisa ${fonte}, presa alle ` +
    `${posizione.quando.slice(11, 16)} UTC, ${quantoFa(posizione.quando, adesso)}.${vivo}${vecchia} ` +
    "Quando la usi, di' al proprietario che parti da lì e quanto è vecchia."
  );
}
