/**
 * I progetti nella barra laterale: i fissati in cima, poi raggruppati e ordinati come sceglie il
 * proprietario. L'ordine predefinito è per ultimo messaggio: in cima quello a cui ha scritto da poco.
 */

import type { CondizioneProgetto, VoceProgetto } from "../../src/protocollo/progetti.ts";
import { condizioneInParole } from "./descrivi.ts";

export type ModoGruppi = "nessuno" | "ambiente" | "stato";
export type ModoOrdine = "ultimo-messaggio" | "creazione" | "nome";

/** Quando il progetto ha visto il proprietario l'ultima volta: l'ultimo messaggio o, se non ce n'è, la nascita. */
function ultimoUso(progetto: VoceProgetto): string {
  return progetto.ultimoMessaggioIl ?? progetto.creatoIl;
}

/** I progetti nell'ordine scelto; a parità, dal più recente. */
export function ordinaProgetti(progetti: readonly VoceProgetto[], ordine: ModoOrdine): VoceProgetto[] {
  const recenti = (a: VoceProgetto, b: VoceProgetto): number => b.creatoIl.localeCompare(a.creatoIl);
  return [...progetti].sort((a, b) => {
    if (ordine === "nome") return a.nome.localeCompare(b.nome, "it", { sensitivity: "base" }) || recenti(a, b);
    if (ordine === "ultimo-messaggio") return ultimoUso(b).localeCompare(ultimoUso(a)) || recenti(a, b);
    return recenti(a, b);
  });
}

export interface GruppoDiProgetti {
  /** Manca per l'unico gruppo, quando non si raggruppa e nessuno è fissato. */
  titolo?: string;
  progetti: VoceProgetto[];
}

const ORDINE_DEGLI_STATI: CondizioneProgetto[] = ["aspetta-te", "al-lavoro", "fermo", "ambiente-spento"];

export function raggruppaProgetti(tutti: readonly VoceProgetto[], modo: ModoGruppi, ordine: ModoOrdine = "creazione"): GruppoDiProgetti[] {
  const progetti = ordinaProgetti(tutti, ordine);
  const fissati = progetti.filter((progetto) => progetto.fissato === true);
  const altri = progetti.filter((progetto) => progetto.fissato !== true);
  const gruppi: GruppoDiProgetti[] = fissati.length === 0 ? [] : [{ titolo: "Fissati", progetti: fissati }];
  if (modo === "nessuno") {
    if (altri.length > 0) gruppi.push({ ...(fissati.length === 0 ? {} : { titolo: "Gli altri" }), progetti: altri });
    return gruppi;
  }
  const chiavi = modo === "ambiente" ? [...new Set(altri.map((progetto) => progetto.nomeAmbiente))].sort((a, b) => a.localeCompare(b, "it")) : ORDINE_DEGLI_STATI;
  for (const chiave of chiavi) {
    const dentro = altri.filter((progetto) => (modo === "ambiente" ? progetto.nomeAmbiente : progetto.condizione) === chiave);
    if (dentro.length === 0) continue;
    const titolo = modo === "ambiente" ? chiave : condizioneInParole(chiave as CondizioneProgetto);
    gruppi.push({ titolo: titolo.charAt(0).toUpperCase() + titolo.slice(1), progetti: dentro });
  }
  return gruppi;
}

const CHIAVE = "shinka.barra.gruppi";

export function leggiModoGruppi(): ModoGruppi {
  try {
    const letto = window.localStorage.getItem(CHIAVE);
    return letto === "ambiente" || letto === "stato" ? letto : "nessuno";
  } catch {
    return "nessuno";
  }
}

export function scriviModoGruppi(modo: ModoGruppi): void {
  try {
    window.localStorage.setItem(CHIAVE, modo);
  } catch {
    // Senza memoria del browser la scelta vale finché la pagina resta aperta.
  }
}

const CHIAVE_ORDINE = "shinka.barra.ordine";

/** L'ordine scelto su questo browser; se non ne ha scelto uno, per ultimo messaggio. */
export function leggiModoOrdine(): ModoOrdine {
  try {
    const letto = window.localStorage.getItem(CHIAVE_ORDINE);
    return letto === "creazione" || letto === "nome" ? letto : "ultimo-messaggio";
  } catch {
    return "ultimo-messaggio";
  }
}

export function scriviModoOrdine(ordine: ModoOrdine): void {
  try {
    window.localStorage.setItem(CHIAVE_ORDINE, ordine);
  } catch {
    // Senza memoria del browser la scelta vale finché la pagina resta aperta.
  }
}
