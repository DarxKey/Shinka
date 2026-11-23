/**
 * Le richieste con `Range` (RFC 9110): una parte di un file, o più parti in una risposta
 * multipart/byteranges. Servono a electron-updater per riprendere uno scaricamento e per prendere
 * solo i blocchi cambiati dell'installer di Shinka Desktop.
 */

import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { PassThrough, type Readable } from "node:stream";

export interface Intervallo {
  inizio: number;
  /** Compreso. */
  fine: number;
}

/** Al più quante parti in una richiesta sola. */
const PARTI_MASSIME = 10_000;

/**
 * Le parti chieste da un'intestazione Range, dentro un file di `dimensione` byte. Nulla se
 * l'intestazione manca o non si capisce (si risponde con il file intero); "fuori" se nessuna parte
 * sta nel file.
 */
export function intervalliChiesti(intestazione: string | undefined, dimensione: number): Intervallo[] | "fuori" | undefined {
  if (intestazione === undefined) return undefined;
  const trovato = /^bytes=(.+)$/i.exec(intestazione.trim());
  if (trovato?.[1] === undefined) return undefined;
  const parti = trovato[1].split(",");
  if (parti.length > PARTI_MASSIME) return undefined;
  const intervalli: Intervallo[] = [];
  for (const parte of parti) {
    const pezzo = /^\s*(\d*)-(\d*)\s*$/.exec(parte);
    if (pezzo === null) return undefined;
    const [, da = "", a = ""] = pezzo;
    if (da === "" && a === "") return undefined;
    let inizio: number;
    let fine: number;
    if (da === "") {
      // Gli ultimi n byte.
      const ultimi = Number(a);
      if (ultimi === 0) continue;
      inizio = Math.max(0, dimensione - ultimi);
      fine = dimensione - 1;
    } else {
      inizio = Number(da);
      fine = a === "" ? dimensione - 1 : Math.min(Number(a), dimensione - 1);
      if (a !== "" && Number(a) < inizio) return undefined;
    }
    if (inizio >= dimensione) continue;
    intervalli.push({ inizio, fine });
  }
  return intervalli.length === 0 ? "fuori" : intervalli;
}

/** Il corpo di una risposta a più parti, con il suo confine. */
export function piuParti(file: string, intervalli: readonly Intervallo[], dimensione: number, tipo: string): { flusso: Readable; confine: string; lunghezza: number } {
  const confine = `shinka-${randomBytes(12).toString("hex")}`;
  const testa = (intervallo: Intervallo): string =>
    `--${confine}\r\nContent-Type: ${tipo}\r\nContent-Range: bytes ${intervallo.inizio}-${intervallo.fine}/${dimensione}\r\n\r\n`;
  const coda = `--${confine}--\r\n`;
  const lunghezza =
    intervalli.reduce((totale, intervallo) => totale + Buffer.byteLength(testa(intervallo)) + (intervallo.fine - intervallo.inizio + 1) + 2, 0) + Buffer.byteLength(coda);
  const flusso = new PassThrough();
  void (async () => {
    try {
      for (const intervallo of intervalli) {
        if (!flusso.write(testa(intervallo))) await new Promise((risolvi) => flusso.once("drain", risolvi));
        for await (const pezzo of createReadStream(file, { start: intervallo.inizio, end: intervallo.fine })) {
          if (flusso.destroyed) return;
          if (!flusso.write(pezzo)) await new Promise((risolvi) => flusso.once("drain", risolvi));
        }
        flusso.write("\r\n");
      }
      flusso.end(coda);
    } catch (errore) {
      flusso.destroy(errore instanceof Error ? errore : new Error(String(errore)));
    }
  })();
  return { flusso, confine, lunghezza };
}
