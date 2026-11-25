/**
 * Il Chrome dei PC del proprietario, guidato da Claude con l'estensione Claude in Chrome (ADR 0063):
 * che cosa c'è in un ambiente, e le conversazioni con cui la Home lo usa.
 */

/** L'identificativo dell'estensione Claude in Chrome nel Chrome Web Store. */
export const ESTENSIONE_CLAUDE_IN_CHROME = "fcoeoabgfenejglbffodgkkbkcdhcgfn";
/** Il programma con cui l'estensione parla con Claude Code (native messaging). */
export const HOST_CLAUDE_IN_CHROME = "com.anthropic.claude_browser_extension";

/** Che cosa c'è in un ambiente per guidare il suo Chrome. */
export interface StatoChrome {
  /** Chrome è installato. */
  chrome: boolean;
  /** L'estensione Claude in Chrome è in almeno un profilo. */
  estensione: boolean;
  /** Il collegamento dell'estensione con Claude Code è registrato (lo scrive Claude Code al primo uso). */
  collegamento: boolean;
}

export function leggiStatoChrome(valore: unknown): StatoChrome | undefined {
  if (typeof valore !== "object" || valore === null) return undefined;
  const { chrome, estensione, collegamento } = valore as Record<string, unknown>;
  return typeof chrome === "boolean" && typeof estensione === "boolean" && typeof collegamento === "boolean" ? { chrome, estensione, collegamento } : undefined;
}

/** In parole, per la pagina Ambienti e per la Home. */
export function chromeInParole(stato: StatoChrome | undefined, acceso: boolean): string {
  if (stato === undefined) return "Chrome: il nodo non lo sa dire.";
  if (!stato.chrome) return "Chrome non è installato.";
  if (!stato.estensione) return "C'è Chrome, ma senza l'estensione Claude in Chrome: va installata dal Chrome Web Store.";
  return acceso ? "Chrome con Claude in Chrome: acceso per Claude." : "Chrome con Claude in Chrome: si può accendere per Claude.";
}

const SEGNO_BROWSER = "browser-del-pc~";

/** La conversazione con cui la Home fa un lavoro nel Chrome di un ambiente: una per ogni lavoro. */
export function conversazioneNelBrowser(id: string): string {
  return `${SEGNO_BROWSER}${id}`;
}

export function eNelBrowser(idConversazione: string): boolean {
  return idConversazione.startsWith(SEGNO_BROWSER);
}
