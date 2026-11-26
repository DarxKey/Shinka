/**
 * La lista delle cose da fare di Claude. Fino alle versioni 2.0 di Claude Code era un solo
 * strumento, TodoWrite, che manda ogni volta la lista intera; dalle 2.1 sono quattro strumenti
 * Task*, che creano e aggiornano un compito per volta (TaskCreate dà il numero nel suo risultato).
 * L'interfaccia li mostra tutti come la stessa scheda.
 */

/** Lo strumento di prima, che manda la lista intera. Lo usa ancora la traduzione del piano di Codex. */
export const STRUMENTO_LISTA_INTERA = "TodoWrite";
export const CREA_COMPITO = "TaskCreate";
export const AGGIORNA_COMPITO = "TaskUpdate";
/** Gli strumenti della lista di oggi: toccano solo la lista, e non chiedono il consenso. */
export const STRUMENTI_DELLA_LISTA: readonly string[] = [CREA_COMPITO, AGGIORNA_COMPITO, "TaskList", "TaskGet"];

/** Il numero del compito creato, dal risultato di TaskCreate («Task #3 created successfully: …»). */
export function numeroDelCompito(esito: string): string | undefined {
  return /Task #(\S+?) created/.exec(esito)?.[1];
}
