/**
 * L'identità con cui il centro si fa riconoscere dai nodi sul collegamento cifrato (ADR 0040): una
 * chiave e un certificato firmato da sé, creati una volta e tenuti tra i dati. Un nodo ricorda
 * l'impronta del certificato e da lì in poi parla solo con chi lo presenta: per questo non si
 * rifà, nemmeno quando cambiano gli indirizzi o la CA dell'HTTPS.
 */

import { createHash, createPrivateKey, X509Certificate } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NOME_TLS_DEI_NODI } from "../protocollo/nodi.ts";
import { nuovoCertificatoDeiNodi } from "./certificato.ts";

export interface IdentitaPerINodi {
  /** La chiave privata, in PEM. */
  chiave: string;
  /** Il certificato, in PEM. */
  certificato: string;
  /** L'impronta SHA-256 del certificato, in esadecimale minuscolo: ciò che un nodo ricorda. */
  impronta: string;
  /** L'impronta SHA-256 della chiave pubblica, in base64: ciò che vuole `curl --pinnedpubkey`. */
  improntaDellaChiave: string;
}

/** L'impronta di un certificato come la tengono i nodi: esadecimale minuscolo, senza due punti. */
export function improntaInBreve(certificato: X509Certificate): string {
  return certificato.fingerprint256.replace(/:/g, "").toLowerCase();
}

function descritta(chiave: string, certificato: string): IdentitaPerINodi {
  const letto = new X509Certificate(certificato);
  return {
    chiave,
    certificato,
    impronta: improntaInBreve(letto),
    improntaDellaChiave: createHash("sha256").update(letto.publicKey.export({ type: "spki", format: "der" })).digest("base64"),
  };
}

/** L'identità che c'è, oppure una nuova. Una che non si legge o è scaduta viene rifatta, e lo dice. */
export function preparaIdentitaPerINodi(cartella: string, adesso: Date = new Date(), avvisa: (testo: string) => void = () => {}): IdentitaPerINodi {
  mkdirSync(cartella, { recursive: true, mode: 0o700 });
  const fileChiave = join(cartella, "nodi.key");
  const fileCertificato = join(cartella, "nodi.crt");
  if (existsSync(fileChiave) && existsSync(fileCertificato)) {
    try {
      const identita = descritta(readFileSync(fileChiave, "utf8"), readFileSync(fileCertificato, "utf8"));
      const letto = new X509Certificate(identita.certificato);
      if (letto.checkPrivateKey(createPrivateKey(identita.chiave)) && Date.parse(letto.validTo) > adesso.getTime()) return identita;
      avvisa("Il certificato dei nodi non vale più: ne nasce uno nuovo, e i nodi che ricordano quello di prima vanno preparati di nuovo.");
    } catch {
      avvisa("Il certificato dei nodi non si legge: ne nasce uno nuovo, e i nodi che ricordano quello di prima vanno preparati di nuovo.");
    }
  }
  const nuovo = nuovoCertificatoDeiNodi(NOME_TLS_DEI_NODI, adesso);
  writeFileSync(fileChiave, nuovo.chiave, { mode: 0o600 });
  chmodSync(fileChiave, 0o600);
  writeFileSync(fileCertificato, nuovo.certificato);
  return descritta(nuovo.chiave, nuovo.certificato);
}
