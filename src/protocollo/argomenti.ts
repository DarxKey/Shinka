/** Ciò che l'interfaccia vede degli argomenti della Home. Dati semplici, serializzabili in JSON. */

/** Un argomento archiviato, come compare nell'elenco. */
export interface VoceArgomento {
  id: string;
  titolo: string;
  riassunto: string;
  apertoIl: string;
  archiviatoIl: string;
}

export interface StatoArgomenti {
  /** L'argomento aperto in questo momento nella Home. */
  idAperto: string;
  /** Gli argomenti archiviati, dal più recente. */
  archiviati: VoceArgomento[];
}
