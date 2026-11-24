/**
 * Gli ultimi scambi di una conversazione, da consegnare a chi la continua senza vederla: un motore
 * nuovo dopo un cambio di motore, o un thread nuovo di Codex quando gli strumenti di Shinka sono
 * cambiati (ADR 0061). Dal più vecchio, finché ci stanno.
 */

import type { ScambioDellaStoria } from "../protocollo/eventi.ts";

/** Quanti caratteri della conversazione passano, e quanti al massimo per messaggio. */
const PASSAGGIO_MASSIMO = 24_000;
const MESSAGGIO_MASSIMO = 3_000;

/**
 * Le righe degli ultimi scambi, ciascuna con chi parla, e se ne mancano di più vecchi. Nulla se non
 * c'è niente da passare.
 */
export function ultimiScambi(storia: readonly ScambioDellaStoria[], nomeDelMotore: string): { righe: string[]; parziale: boolean } | undefined {
  const righe: string[] = [];
  let lunghezza = 0;
  for (let i = storia.length - 1; i >= 0; i--) {
    const scambio = storia[i]!;
    const testo = scambio.testo.length > MESSAGGIO_MASSIMO ? `${scambio.testo.slice(0, MESSAGGIO_MASSIMO)}… [tagliato]` : scambio.testo;
    const riga = `${scambio.chi === "proprietario" ? "Proprietario" : nomeDelMotore}: ${testo}`;
    if (lunghezza + riga.length > PASSAGGIO_MASSIMO && righe.length > 0) break;
    righe.unshift(riga);
    lunghezza += riga.length;
  }
  return righe.length === 0 ? undefined : { righe, parziale: righe.length < storia.length };
}
