/**
 * Il sigillo con cui il gateway manda le credenziali a un nodo (ADR 0062): cifrate per la chiave
 * X25519 di quel nodo, così il centro, che le passa, non le può leggere. Una chiave effimera per ogni
 * sigillo, HKDF-SHA256 e AES-256-GCM.
 */

import { createCipheriv, createDecipheriv, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes, type KeyObject } from "node:crypto";

export interface Sigillo {
  /** La chiave pubblica effimera, in SPKI e base64. */
  effimera: string;
  nonce: string;
  cifrato: string;
  etichetta: string;
}

const CONTESTO = "shinka: credenziali per un nodo";

function chiaveSimmetrica(privata: KeyObject, pubblica: KeyObject, sale: Buffer): Buffer {
  const comune = diffieHellman({ privateKey: privata, publicKey: pubblica });
  return Buffer.from(hkdfSync("sha256", comune, sale, CONTESTO, 32));
}

/** La chiave pubblica scritta come la dice il nodo: SPKI in base64. Lancia se non è una X25519. */
export function leggiChiavePubblica(testo: string): KeyObject {
  const chiave = createPublicKey({ key: Buffer.from(testo, "base64"), format: "der", type: "spki" });
  if (chiave.asymmetricKeyType !== "x25519") throw new Error("La chiave del nodo non è una chiave X25519.");
  return chiave;
}

/** Una coppia nuova per un nodo: la privata resta lì, la pubblica va al gateway. */
export function nuovaCoppia(): { pubblica: string; privata: string } {
  const { publicKey, privateKey } = generateKeyPairSync("x25519");
  return {
    pubblica: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
    privata: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
  };
}

export function leggiChiavePrivata(testo: string): KeyObject {
  return createPrivateKey({ key: Buffer.from(testo, "base64"), format: "der", type: "pkcs8" });
}

/** Sigilla un valore per il nodo che ha quella chiave pubblica. */
export function sigilla(valore: unknown, chiavePubblica: string): Sigillo {
  const destinatario = leggiChiavePubblica(chiavePubblica);
  const { publicKey, privateKey } = generateKeyPairSync("x25519");
  const effimera = publicKey.export({ format: "der", type: "spki" });
  const chiave = chiaveSimmetrica(privateKey, destinatario, effimera);
  const nonce = randomBytes(12);
  const cifratore = createCipheriv("aes-256-gcm", chiave, nonce);
  const cifrato = Buffer.concat([cifratore.update(JSON.stringify(valore), "utf8"), cifratore.final()]);
  chiave.fill(0);
  return { effimera: effimera.toString("base64"), nonce: nonce.toString("base64"), cifrato: cifrato.toString("base64"), etichetta: cifratore.getAuthTag().toString("base64") };
}

/** Apre un sigillo con la chiave privata del nodo. Lancia se non è per lui o se è stato toccato. */
export function apriSigillo(sigillo: Sigillo, chiavePrivata: KeyObject): unknown {
  const effimera = Buffer.from(sigillo.effimera, "base64");
  const chiave = chiaveSimmetrica(chiavePrivata, createPublicKey({ key: effimera, format: "der", type: "spki" }), effimera);
  const decifratore = createDecipheriv("aes-256-gcm", chiave, Buffer.from(sigillo.nonce, "base64"));
  decifratore.setAuthTag(Buffer.from(sigillo.etichetta, "base64"));
  try {
    return JSON.parse(Buffer.concat([decifratore.update(Buffer.from(sigillo.cifrato, "base64")), decifratore.final()]).toString("utf8")) as unknown;
  } finally {
    chiave.fill(0);
  }
}

/** Un sigillo arrivato da fuori, se è fatto bene. */
export function leggiSigillo(valore: unknown): Sigillo | undefined {
  if (typeof valore !== "object" || valore === null) return undefined;
  const { effimera, nonce, cifrato, etichetta } = valore as Record<string, unknown>;
  const testo = (campo: unknown): campo is string => typeof campo === "string" && campo.length > 0 && campo.length < 2_000_000;
  return testo(effimera) && testo(nonce) && testo(cifrato) && testo(etichetta) ? { effimera, nonce, cifrato, etichetta } : undefined;
}
