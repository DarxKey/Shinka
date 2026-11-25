/**
 * Aprire il pannello di un progetto su una scheda da qualunque parte della pagina: dalla scheda della
 * sessione, dal pulsante ▶ di un comando. Chi tiene il pannello ascolta e lo apre.
 */

import type { Scheda } from "./Pannello.tsx";

/** L'evento con cui una parte della pagina chiede di aprire il pannello di un progetto su una scheda. */
const APRI_SCHEDA = "shinka:apri-scheda-del-pannello";

/** Apre il pannello del progetto sulla scheda indicata, da qualunque parte della pagina. */
export function apriSchedaDelPannello(idProgetto: string, scheda: Scheda): void {
  window.dispatchEvent(new CustomEvent(APRI_SCHEDA, { detail: { idProgetto, scheda } }));
}

/** Ascolta le richieste di aprire il pannello: chi tiene il pannello lo apre. */
export function ascoltaAperturaDelPannello(apri: (idProgetto: string, scheda: Scheda) => void): () => void {
  const ascolta = (evento: Event): void => {
    const { idProgetto, scheda } = (evento as CustomEvent<{ idProgetto: string; scheda: Scheda }>).detail;
    apri(idProgetto, scheda);
  };
  window.addEventListener(APRI_SCHEDA, ascolta);
  return () => window.removeEventListener(APRI_SCHEDA, ascolta);
}

