/**
 * L'aggiornamento di un nodo alla versione del centro.
 *
 * Il centro manda i file della versione che ha in funzione. Il nodo li scrive in una cartella
 * accanto a quella da cui gira, ci mette le dipendenze per il suo sistema e lascia scritto che
 * cosa va installato: poi si spegne, e il suo guardiano scambia le cartelle, lo riavvia e, se la
 * versione nuova non si collega al centro, rimette quella di prima.
 */

import { preparaVersioneNuova, type EsitoVersioneNuova, type OpzioniVersioneNuova } from "../guardiano/versione-nuova.ts";

export type OpzioniAggiornamento = Omit<OpzioniVersioneNuova, "riassunto" | "percorsoValido" | "ancheLaStessa">;
export type EsitoAggiornamento = EsitoVersioneNuova;

/**
 * Prepara la versione nuova accanto a quella in funzione e lascia scritto al guardiano di
 * installarla. Se qualcosa non va la cartella nuova viene tolta, e il nodo resta com'è.
 */
export function preparaAggiornamento(opzioni: OpzioniAggiornamento): Promise<EsitoAggiornamento> {
  return preparaVersioneNuova({ ...opzioni, riassunto: "Aggiornamento del nodo alla versione del centro." });
}
