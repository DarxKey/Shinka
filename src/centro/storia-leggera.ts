/**
 * La storia che l'interfaccia riceve quando apre una conversazione, alleggerita. Il grosso di una
 * conversazione lunga sono i dettagli delle azioni: i file scritti, le uscite dei comandi. Di
 * un'azione conclusa la chat mostra una riga; il dettaglio intero lo chiede quando il proprietario
 * la apre. Così si manda solo un riassunto: l'archivio resta intero.
 */

import type { EventoArchiviato } from "../protocollo/eventi.ts";

/** Quanto resta di un testo nel riassunto di un'azione conclusa. */
export const LUNGHEZZA_RIASSUNTO = 120;
/** Quante voci restano di un elenco. */
const VOCI_RIASSUNTO = 20;

/** Accorcia un valore qualunque: i testi lunghi, gli elenchi lunghi. Dice se ha accorciato qualcosa. */
function accorcia(valore: unknown): { valore: unknown; accorciato: boolean } {
  if (typeof valore === "string") {
    return valore.length <= LUNGHEZZA_RIASSUNTO ? { valore, accorciato: false } : { valore: `${valore.slice(0, LUNGHEZZA_RIASSUNTO)}…`, accorciato: true };
  }
  if (Array.isArray(valore)) {
    let accorciato = valore.length > VOCI_RIASSUNTO;
    const voci = valore.slice(0, VOCI_RIASSUNTO).map((voce) => {
      const fatto = accorcia(voce);
      accorciato ||= fatto.accorciato;
      return fatto.valore;
    });
    return { valore: voci, accorciato };
  }
  if (typeof valore === "object" && valore !== null) {
    let accorciato = false;
    const campi = Object.fromEntries(
      Object.entries(valore).map(([chiave, voce]) => {
        const fatto = accorcia(voce);
        accorciato ||= fatto.accorciato;
        return [chiave, fatto.valore];
      }),
    );
    return { valore: campi, accorciato };
  }
  return { valore, accorciato: false };
}

/**
 * La storia alleggerita: delle azioni concluse restano un riassunto della richiesta e dell'esito,
 * segnati come accorciati. Un'azione ancora in corso, o che aspetta un permesso, resta intera.
 */
export function storiaLeggera(archiviati: readonly EventoArchiviato[]): EventoArchiviato[] {
  const concluse = new Set<string>();
  for (const { evento } of archiviati) if (evento.tipo === "azione-conclusa") concluse.add(evento.idAzione);
  return archiviati.map((archiviato) => {
    const { evento } = archiviato;
    if (evento.tipo === "azione-iniziata" && concluse.has(evento.idAzione)) {
      const fatto = accorcia(evento.ingresso);
      return fatto.accorciato ? { ...archiviato, evento: { ...evento, ingresso: fatto.valore, accorciato: true } } : archiviato;
    }
    if (evento.tipo === "azione-conclusa" && evento.esito.length > LUNGHEZZA_RIASSUNTO) {
      return { ...archiviato, evento: { ...evento, esito: `${evento.esito.slice(0, LUNGHEZZA_RIASSUNTO)}…`, accorciato: true } };
    }
    return archiviato;
  });
}

/** Un'azione per intero, ritrovata nell'archivio: la richiesta e, se è conclusa, l'esito. */
export interface AzioneIntera {
  ingresso: unknown;
  esito?: string;
}

export function azioneIntera(archiviati: readonly EventoArchiviato[], idAzione: string): AzioneIntera | undefined {
  let ingresso: unknown;
  let trovata = false;
  let esito: string | undefined;
  for (const { evento } of archiviati) {
    if (evento.tipo === "azione-iniziata" && evento.idAzione === idAzione) {
      ingresso = evento.ingresso;
      trovata = true;
    }
    if (evento.tipo === "azione-conclusa" && evento.idAzione === idAzione) esito = evento.esito;
  }
  return trovata ? { ingresso, ...(esito === undefined ? {} : { esito }) } : undefined;
}
