/** Gli aggiornamenti dall'originale di un fork di Shinka (ADR 0059), come li vede l'interfaccia. */

export interface StatoOriginale {
  /** Da dove vengono le versioni: l'indirizzo Git della copia originale. */
  originale: string;
  /** Quante versioni dell'originale qui mancano, all'ultimo controllo. */
  nuovi: number;
  /** I loro titoli, dalla più recente (al massimo trenta). */
  titoli: string[];
  /** La cima dell'originale, in breve. */
  cima?: string;
  ultimoControllo?: string;
  /** Vero se la Home le ha già proposte con la scheda di uno sviluppo. */
  proposti?: true;
  /** Perché l'ultimo controllo non è riuscito. */
  motivo?: string;
}
