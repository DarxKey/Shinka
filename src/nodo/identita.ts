/**
 * L'identità di un nodo: un identificativo e un segreto, creati al primo avvio
 * e conservati sulla macchina. Il centro ne conosce solo l'impronta.
 *
 * Un segreto che è passato su un collegamento in chiaro il nodo lo cambia, appena il collegamento
 * è cifrato (ADR 0040): ne propone uno nuovo al centro, e lo tiene accanto a quello di prima finché
 * il centro non conferma di averlo preso.
 */

import { randomBytes, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface Identita {
  idNodo: string;
  segreto: string;
  /** Il segreto proposto al centro al posto di quello di adesso, finché il centro non lo conferma. */
  segretoProssimo?: string;
  /** Vero se il segreto di adesso non è mai passato su un collegamento in chiaro. */
  maiInChiaro?: boolean;
}

function nuovoSegreto(): string {
  return randomBytes(32).toString("base64url");
}

export async function leggiOCreaIdentita(file: string): Promise<Identita> {
  try {
    const letta = JSON.parse(await readFile(file, "utf8")) as Partial<Identita>;
    if (typeof letta.idNodo === "string" && typeof letta.segreto === "string") {
      return {
        idNodo: letta.idNodo,
        segreto: letta.segreto,
        ...(typeof letta.segretoProssimo === "string" ? { segretoProssimo: letta.segretoProssimo } : {}),
        // Un'identità di prima di questa versione ha parlato in chiaro: il campo le manca.
        ...(letta.maiInChiaro === true ? { maiInChiaro: true } : {}),
      };
    }
    throw new Error(`Il file dell'identità del nodo è rovinato: ${file}`);
  } catch (errore) {
    if (!(errore instanceof Error && "code" in errore && errore.code === "ENOENT")) throw errore;
  }
  const identita: Identita = { idNodo: randomUUID(), segreto: nuovoSegreto(), maiInChiaro: true };
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(identita, null, 2), { mode: 0o600 });
  return identita;
}

/** Ciò che il collegamento chiede a chi custodisce il segreto del nodo. */
export interface CustodiaDelSegreto {
  /** Il segreto sta per passare su un collegamento in chiaro: da qui va cambiato. */
  passaInChiaro(): void;
  /** Il segreto da proporre al centro al posto di quello di adesso, se quello è passato in chiaro. */
  prossimo(): string | undefined;
  /** Il centro ha preso il segreto proposto: da qui è quello del nodo. */
  confermato(): void;
}

/**
 * Custodisce il segreto di un'identità nel suo file. Cambia l'oggetto `identita` sul posto: chi lo
 * usa per presentarsi vede sempre i valori di adesso. Ogni cambiamento è sul disco prima di tornare.
 */
export function custodiaDelSegreto(file: string, identita: Identita): CustodiaDelSegreto {
  const salva = (): void => writeFileSync(file, JSON.stringify(identita, null, 2), { mode: 0o600 });
  return {
    passaInChiaro() {
      if (identita.maiInChiaro !== true) return;
      delete identita.maiInChiaro;
      salva();
    },
    prossimo() {
      if (identita.maiInChiaro === true) return undefined;
      if (identita.segretoProssimo === undefined) {
        identita.segretoProssimo = nuovoSegreto();
        // Sul disco prima di dirlo al centro: se il nodo si ferma adesso, lo ritrova e lo ripropone.
        salva();
      }
      return identita.segretoProssimo;
    },
    confermato() {
      if (identita.segretoProssimo === undefined) return;
      identita.segreto = identita.segretoProssimo;
      delete identita.segretoProssimo;
      identita.maiInChiaro = true;
      salva();
    },
  };
}
