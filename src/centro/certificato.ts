/**
 * I certificati con cui il centro parla HTTPS. Shinka ha una sua piccola autorità (CA), che il
 * proprietario installa una volta sul telefono e sul PC, e un certificato per il server, firmato
 * da lei, con gli indirizzi da cui il proprietario apre Shinka. Se gli indirizzi cambiano si rifà
 * solo il certificato del server: la CA resta, e sui dispositivi non c'è nulla da reinstallare.
 *
 * La CA può firmare solo indirizzi privati e i nomi che le sono stati dati: se la sua chiave
 * finisse in mani altrui, non servirebbe a fingersi un sito di Internet.
 *
 * Node non sa creare certificati: qui si scrivono nel loro formato (DER), e li firma Node.
 */

import { createHash, generateKeyPairSync, randomBytes, sign, X509Certificate, type KeyObject, createPrivateKey } from "node:crypto";
import { isIP } from "node:net";

// ── Il formato DER, quanto basta ─────────────────────────────────────────────

function lunghezza(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const byte: number[] = [];
  for (let resto = n; resto > 0; resto = Math.floor(resto / 256)) byte.unshift(resto & 0xff);
  return Buffer.from([0x80 | byte.length, ...byte]);
}

function tlv(etichetta: number, contenuto: Buffer): Buffer {
  return Buffer.concat([Buffer.from([etichetta]), lunghezza(contenuto.length), contenuto]);
}

const sequenza = (...parti: Buffer[]): Buffer => tlv(0x30, Buffer.concat(parti));
const insieme = (...parti: Buffer[]): Buffer => tlv(0x31, Buffer.concat(parti));
const esplicito = (n: number, contenuto: Buffer): Buffer => tlv(0xa0 + n, contenuto);
const ottetti = (contenuto: Buffer): Buffer => tlv(0x04, contenuto);
const utf8 = (testo: string): Buffer => tlv(0x0c, Buffer.from(testo, "utf8"));
const vero = (): Buffer => Buffer.from([0x01, 0x01, 0xff]);

function intero(valore: Buffer | number): Buffer {
  let byte = typeof valore === "number" ? Buffer.from([valore]) : valore;
  while (byte.length > 1 && byte[0] === 0 && ((byte[1] ?? 0) & 0x80) === 0) byte = byte.subarray(1);
  if (((byte[0] ?? 0) & 0x80) !== 0) byte = Buffer.concat([Buffer.from([0]), byte]);
  return tlv(0x02, byte);
}

function bit(contenuto: Buffer, inutilizzati = 0): Buffer {
  return tlv(0x03, Buffer.concat([Buffer.from([inutilizzati]), contenuto]));
}

function oid(punti: string): Buffer {
  const numeri = punti.split(".").map(Number);
  const byte: number[] = [40 * (numeri[0] ?? 0) + (numeri[1] ?? 0)];
  for (const numero of numeri.slice(2)) {
    const gruppi: number[] = [];
    let resto = numero;
    do {
      gruppi.unshift(resto & 0x7f);
      resto = Math.floor(resto / 128);
    } while (resto > 0);
    gruppi.forEach((gruppo, i) => byte.push(i < gruppi.length - 1 ? gruppo | 0x80 : gruppo));
  }
  return tlv(0x06, Buffer.from(byte));
}

/** Le date come le vuole X.509: UTCTime fino al 2049, GeneralizedTime dopo. */
function data(quando: Date): Buffer {
  const iso = quando.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return quando.getUTCFullYear() < 2050 ? tlv(0x17, Buffer.from(`${iso.slice(2)}Z`)) : tlv(0x18, Buffer.from(`${iso}Z`));
}

const ECDSA_SHA256 = sequenza(oid("1.2.840.10045.4.3.2"));

function nome(comune: string): Buffer {
  return sequenza(insieme(sequenza(oid("2.5.4.10"), utf8("Shinka"))), insieme(sequenza(oid("2.5.4.3"), utf8(comune))));
}

function estensione(punti: string, critica: boolean, valore: Buffer): Buffer {
  return sequenza(oid(punti), ...(critica ? [vero()] : []), ottetti(valore));
}

/** Un indirizzo IP come lo scrive un certificato: quattro byte, o sedici. */
function byteDellIndirizzo(indirizzo: string): Buffer {
  if (isIP(indirizzo) === 4) return Buffer.from(indirizzo.split(".").map(Number));
  const [testa = "", coda = ""] = indirizzo.split("::");
  const gruppi = (parte: string): number[] => (parte === "" ? [] : parte.split(":").map((g) => Number.parseInt(g, 16)));
  const prima = gruppi(testa);
  const dopo = indirizzo.includes("::") ? gruppi(coda) : [];
  const tutti = [...prima, ...new Array(8 - prima.length - dopo.length).fill(0), ...dopo];
  return Buffer.from(tutti.flatMap((g) => [g >> 8, g & 0xff]));
}

/** Un nome nel certificato: indirizzo IP o nome di macchina. */
function nomeGenerale(voce: string): Buffer {
  return isIP(voce) === 0 ? tlv(0x82, Buffer.from(voce.toLowerCase(), "ascii")) : tlv(0x87, byteDellIndirizzo(voce));
}

/** Gli indirizzi privati che la CA può firmare: le reti di casa, la macchina stessa e le reti locali IPv6. */
const RETI_PRIVATE: [string, string][] = [
  ["10.0.0.0", "255.0.0.0"],
  ["172.16.0.0", "255.240.0.0"],
  ["192.168.0.0", "255.255.0.0"],
  ["100.64.0.0", "255.192.0.0"],
  ["127.0.0.0", "255.0.0.0"],
  ["fc00::", "fe00::"],
  ["fe80::", "ffc0::"],
  ["::1", "ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff"],
];

function chiaveDi(chiave: KeyObject): Buffer {
  return chiave.export({ type: "spki", format: "der" });
}

function identificativo(spki: Buffer): Buffer {
  return createHash("sha1").update(spki).digest();
}

interface DaFirmare {
  soggetto: string;
  emittente: string;
  chiavePubblica: KeyObject;
  chiaveDiChiFirma: KeyObject;
  /** L'identificativo della chiave di chi firma. */
  idEmittente: Buffer;
  da: Date;
  a: Date;
  estensioni: Buffer[];
}

function firma(dati: DaFirmare): Buffer {
  const seriale = randomBytes(16);
  seriale[0] = ((seriale[0] ?? 1) & 0x7f) | 0x01;
  const spki = chiaveDi(dati.chiavePubblica);
  const daFirmare = sequenza(
    esplicito(0, intero(2)),
    intero(seriale),
    ECDSA_SHA256,
    nome(dati.emittente),
    sequenza(data(dati.da), data(dati.a)),
    nome(dati.soggetto),
    spki,
    esplicito(
      3,
      sequenza(
        estensione("2.5.29.14", false, ottetti(identificativo(spki))),
        estensione("2.5.29.35", false, sequenza(tlv(0x80, dati.idEmittente))),
        ...dati.estensioni,
      ),
    ),
  );
  const firmato = sign("sha256", daFirmare, { key: dati.chiaveDiChiFirma, dsaEncoding: "der" });
  return sequenza(daFirmare, ECDSA_SHA256, bit(firmato));
}

// ── Ciò che Shinka usa ───────────────────────────────────────────────────────

/** Per quanti giorni vale il certificato del server: Apple ne accetta al massimo 825. */
export const GIORNI_DEL_SERVER = 800;
/** Per quanti anni vale la CA: si installa una volta. */
const ANNI_DELLA_CA = 10;
const GIORNO_MS = 24 * 60 * 60 * 1000;

export interface Firmato {
  /** Il certificato, in PEM. */
  certificato: string;
  /** La chiave privata, in PEM. */
  chiave: string;
}

function pem(der: Buffer, etichetta: string): string {
  const righe = der.toString("base64").match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${etichetta}-----\n${righe.join("\n")}\n-----END ${etichetta}-----\n`;
}

/** I nomi della macchina e quelli dati dal proprietario che la CA potrà firmare, oltre agli indirizzi privati. */
function nomiConsentiti(nomi: readonly string[]): string[] {
  return [...new Set(["localhost", ...nomi.filter((voce) => isIP(voce) === 0).map((voce) => voce.toLowerCase())])];
}

/** Una CA nuova, che può firmare gli indirizzi privati e i nomi indicati. */
export function nuovaCa(nomi: readonly string[], adesso: Date = new Date()): Firmato {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const spki = chiaveDi(publicKey);
  const consentiti = [
    ...RETI_PRIVATE.map(([rete, maschera]) => sequenza(tlv(0x87, Buffer.concat([byteDellIndirizzo(rete), byteDellIndirizzo(maschera)])))),
    ...nomiConsentiti(nomi).map((voce) => sequenza(tlv(0x82, Buffer.from(voce, "ascii")))),
  ];
  const der = firma({
    soggetto: "Shinka CA",
    emittente: "Shinka CA",
    chiavePubblica: publicKey,
    chiaveDiChiFirma: privateKey,
    idEmittente: identificativo(spki),
    da: new Date(adesso.getTime() - GIORNO_MS),
    a: new Date(adesso.getTime() + ANNI_DELLA_CA * 365 * GIORNO_MS),
    estensioni: [
      estensione("2.5.29.19", true, sequenza(vero(), intero(0))),
      estensione("2.5.29.15", true, bit(Buffer.from([0x06]), 1)),
      estensione("2.5.29.30", true, sequenza(tlv(0xa0, Buffer.concat(consentiti)))),
    ],
  });
  return { certificato: pem(der, "CERTIFICATE"), chiave: privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
}

/** Il certificato del server per questi nomi, firmato dalla CA. */
export function nuovoServer(ca: Firmato, nomi: readonly string[], adesso: Date = new Date()): Firmato {
  if (nomi.length === 0) throw new Error("Il certificato del server ha bisogno di almeno un nome.");
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const chiaveCa = createPrivateKey(ca.chiave);
  const certificatoCa = new X509Certificate(ca.certificato);
  const der = firma({
    // I nomi veri stanno tra i nomi alternativi: il nome comune è solo un'etichetta.
    soggetto: "Shinka",
    emittente: "Shinka CA",
    chiavePubblica: publicKey,
    chiaveDiChiFirma: chiaveCa,
    idEmittente: identificativo(chiaveDi(certificatoCa.publicKey)),
    da: new Date(adesso.getTime() - GIORNO_MS),
    a: new Date(adesso.getTime() + (GIORNI_DEL_SERVER - 1) * GIORNO_MS),
    estensioni: [
      estensione("2.5.29.19", true, sequenza()),
      estensione("2.5.29.15", true, bit(Buffer.from([0x80]), 7)),
      estensione("2.5.29.37", false, sequenza(oid("1.3.6.1.5.5.7.3.1"))),
      estensione("2.5.29.17", false, sequenza(...nomi.map(nomeGenerale))),
    ],
  });
  return { certificato: pem(der, "CERTIFICATE"), chiave: privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
}

/** Per quanti anni vale il certificato dei nodi: i nodi lo riconoscono dall'impronta, e non deve cambiare. */
const ANNI_DEL_CERTIFICATO_DEI_NODI = 30;

/**
 * Il certificato con cui il centro si fa riconoscere dai nodi (ADR 0040): firmato da sé, con il
 * solo nome che i nodi chiedono. Non passa da nessuna CA: un nodo lo riconosce dall'impronta.
 */
export function nuovoCertificatoDeiNodi(nomeTls: string, adesso: Date = new Date()): Firmato {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const der = firma({
    soggetto: "Shinka, collegamento dei nodi",
    emittente: "Shinka, collegamento dei nodi",
    chiavePubblica: publicKey,
    chiaveDiChiFirma: privateKey,
    idEmittente: identificativo(chiaveDi(publicKey)),
    da: new Date(adesso.getTime() - GIORNO_MS),
    a: new Date(adesso.getTime() + ANNI_DEL_CERTIFICATO_DEI_NODI * 365 * GIORNO_MS),
    estensioni: [
      estensione("2.5.29.19", true, sequenza()),
      estensione("2.5.29.15", true, bit(Buffer.from([0x80]), 7)),
      estensione("2.5.29.37", false, sequenza(oid("1.3.6.1.5.5.7.3.1"))),
      estensione("2.5.29.17", false, sequenza(nomeGenerale(nomeTls))),
    ],
  });
  return { certificato: pem(der, "CERTIFICATE"), chiave: privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
}

/**
 * Vero se una CA che conosce `nomiDellaCa` può firmare tutti questi nomi: gli indirizzi privati
 * sempre, gli altri nomi solo se sono tra i suoi.
 */
export function caCopre(nomiDellaCa: readonly string[], nomi: readonly string[]): boolean {
  const conosciuti = new Set(nomiConsentiti(nomiDellaCa));
  return nomi.every((voce) => (isIP(voce) !== 0 ? indirizzoPrivato(voce) : conosciuti.has(voce.toLowerCase())));
}

/** I nomi che non sono indirizzi: quelli che la CA deve conoscere per nome. */
export { nomiConsentiti };

/** Vero per un indirizzo che la CA di Shinka può firmare. */
export function indirizzoPrivato(indirizzo: string): boolean {
  if (isIP(indirizzo) === 0) return false;
  const byte = byteDellIndirizzo(indirizzo);
  return RETI_PRIVATE.some(([rete, maschera]) => {
    const r = byteDellIndirizzo(rete);
    const m = byteDellIndirizzo(maschera);
    return r.length === byte.length && [...byte].every((b, i) => (b & (m[i] ?? 0)) === (r[i] ?? 0));
  });
}

/** L'impronta SHA-256 di un certificato, come la mostrano i dispositivi: coppie esadecimali separate da due punti. */
export function impronta(certificato: X509Certificate): string {
  return certificato.fingerprint256;
}
