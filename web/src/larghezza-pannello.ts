/**
 * La larghezza del pannello di un progetto accanto alla chat, scelta trascinando il separatore:
 * la chat resta di almeno 340 pixel, il pannello di almeno 280. Si ricorda su questo dispositivo,
 * uguale per tutti i progetti.
 */

export const CHAT_MINIMA = 340;
export const PANNELLO_MINIMO = 280;
/** Di quanto la cambiano le frecce, sul separatore. */
export const PASSO = 24;
const CHIAVE = "shinka.larghezzaPannello";

/** La larghezza possibile più vicina a quella voluta, in uno spazio largo `totale`; nulla se non c'è posto per due colonne. */
export function larghezzaConsentita(voluta: number, totale: number): number | undefined {
  const massima = totale - CHAT_MINIMA;
  if (massima < PANNELLO_MINIMO) return undefined;
  return Math.round(Math.min(Math.max(voluta, PANNELLO_MINIMO), massima));
}

export function leggiLarghezza(): number | undefined {
  try {
    const letta = Number(window.localStorage.getItem(CHIAVE));
    return Number.isFinite(letta) && letta >= PANNELLO_MINIMO ? letta : undefined;
  } catch {
    return undefined;
  }
}

/** Ricorda la larghezza; nulla torna alla proporzione predefinita. */
export function salvaLarghezza(larghezza: number | undefined): void {
  try {
    if (larghezza === undefined) window.localStorage.removeItem(CHIAVE);
    else window.localStorage.setItem(CHIAVE, String(Math.round(larghezza)));
  } catch {
    // Senza memoria del browser la larghezza vale finché la pagina è aperta.
  }
}

/** Mette la larghezza sul contenitore di chat e pannello, oppure la toglie e torna la proporzione predefinita. */
export function applicaLarghezza(contenitore: HTMLElement, larghezza: number | undefined): void {
  if (larghezza === undefined) {
    contenitore.classList.remove("misurato");
    contenitore.style.removeProperty("--larghezza-pannello");
    return;
  }
  contenitore.classList.add("misurato");
  contenitore.style.setProperty("--larghezza-pannello", `${Math.round(larghezza)}px`);
}
