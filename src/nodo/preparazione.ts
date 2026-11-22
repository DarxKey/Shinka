/**
 * La preparazione della cartella di un progetto nuovo, prima del suo primo messaggio: ciò che le
 * estensioni scelte per il progetto chiedono per funzionare da subito, come l'indice di CodeGraph.
 */

import { stat } from "node:fs/promises";
import {
  comandoDellaPreparazione,
  DURATA_PREPARAZIONE_MS,
  type EsitoPreparazione,
  type PreparazioneDelProgetto,
} from "../protocollo/avvio-progetto.ts";
import { esegui } from "./azioni.ts";

/** Quanto dell'uscita di una preparazione si riferisce: la fine, dove c'è com'è andata. */
const USCITA_RIFERITA = 600;

export type EseguiComando = (cartella: string, comando: string, durataMs: number) => Promise<{ riuscita: boolean; testo: string }>;

/** Prepara la cartella di un progetto, una preparazione dopo l'altra. Non lancia: ogni esito dice com'è andata. */
export async function preparaProgetto(
  cartella: string,
  preparazioni: readonly PreparazioneDelProgetto[],
  /** Come si esegue un comando. Nei test se ne mette uno finto. */
  eseguiComando: EseguiComando = esegui,
): Promise<EsitoPreparazione[]> {
  const esiti: EsitoPreparazione[] = [];
  const cartellaValida = await stat(cartella).then(
    (info) => info.isDirectory(),
    () => false,
  );
  for (const preparazione of preparazioni) {
    if (!cartellaValida) {
      esiti.push({ tipo: preparazione.tipo, riuscita: false, testo: `La cartella ${cartella} non c'è.` });
      continue;
    }
    const esito = await eseguiComando(cartella, comandoDellaPreparazione(preparazione), DURATA_PREPARAZIONE_MS);
    esiti.push({ tipo: preparazione.tipo, riuscita: esito.riuscita, testo: esito.testo.trim().slice(-USCITA_RIFERITA) });
  }
  return esiti;
}
