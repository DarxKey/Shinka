/**
 * Lo stato del collegamento con il centro, scritto tra i dati del nodo a ogni cambio: chi sta
 * sulla stessa macchina lo legge senza parlare con il nodo. Lo legge l'icona del nodo nell'area
 * di notifica di Windows (`src/guardiano/icona-windows.ps1`).
 *
 * Il file dice com'era l'ultima volta che il nodo lo ha scritto: se il nodo non c'è più resta
 * com'era, e chi lo legge guarda anche se il processo `pid` è acceso.
 */

import { rename, writeFile } from "node:fs/promises";
import type { StatoCollegamento } from "./collegamento.ts";

export const FILE_STATO_DEL_COLLEGAMENTO = "stato-del-collegamento.json";

export interface StatoDelCollegamentoSuDisco {
  stato: StatoCollegamento["stato"];
  /** Il codice di verifica, finché il centro aspetta il consenso del proprietario. */
  codice?: string;
  /** Il nome dell'ambiente, quando è attivo. */
  nome?: string;
  /** Perché il centro ha rifiutato il nodo. */
  motivo?: string;
  /** Il processo del nodo che lo ha scritto. */
  pid: number;
  quando: string;
}

/** Ciò che va sul disco: niente di più di ciò che serve a chi lo legge. */
export function statoSuDisco(stato: StatoCollegamento, pid: number, adesso: Date): StatoDelCollegamentoSuDisco {
  return {
    stato: stato.stato,
    ...(stato.stato === "in-attesa" ? { codice: stato.codice } : {}),
    ...(stato.stato === "attivo" ? { nome: stato.nome } : {}),
    ...(stato.stato === "rifiutato" ? { motivo: stato.motivo } : {}),
    pid,
    quando: adesso.toISOString(),
  };
}

/** Scrive lo stato in un file provvisorio e poi lo sposta: chi legge non trova mai un file a metà. */
export async function scriviStatoDelCollegamento(file: string, stato: StatoCollegamento, pid = process.pid, adesso = new Date()): Promise<void> {
  const provvisorio = `${file}.${pid}.tmp`;
  await writeFile(provvisorio, `${JSON.stringify(statoSuDisco(stato, pid, adesso), null, 2)}\n`);
  await rename(provvisorio, file);
}
