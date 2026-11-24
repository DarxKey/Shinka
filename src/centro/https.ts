/**
 * L'HTTPS del centro: se è acceso, con quali nomi, e i certificati con cui parla. Si accende con
 * SHINKA_HTTPS=1 oppure dalla pagina del vault, che scrive `https.json` tra i dati; i nomi si danno
 * con SHINKA_HTTPS_NOMI (separati da virgole) o dalla stessa pagina. Un certificato proprio si
 * indica con SHINKA_HTTPS_CERTIFICATO e SHINKA_HTTPS_CHIAVE, file in PEM.
 *
 * I certificati stanno in `https/` tra i dati: la CA di Shinka e il certificato del server. Si
 * creano al primo avvio e si riusano; il certificato del server si rifà se cambiano i nomi o se sta
 * per scadere, la CA solo se non può firmare i nomi nuovi.
 */

import { X509Certificate } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import { hostname, networkInterfaces } from "node:os";
import { join } from "node:path";
import { caCopre, impronta, indirizzoPrivato, nuovaCa, nuovoServer } from "./certificato.ts";
import type { StatoHttps } from "../protocollo/https.ts";

export interface ConfigurazioneHttps {
  attivo: boolean;
  /** I nomi in più dati dal proprietario: gli indirizzi da cui apre Shinka. */
  nomi: string[];
  /** Vero per mandare all'HTTPS chi apre l'interfaccia in HTTP. Nodi, gateway e guardiano restano in HTTP. */
  reindirizza: boolean;
  /** Un certificato proprio, al posto di quello di Shinka. */
  proprio?: { certificato: string; chiave: string };
}

/** Ciò che il proprietario sceglie dalla pagina: finisce in `https.json`. */
export interface SceltaHttps {
  attivo: boolean;
  nomi: string[];
  reindirizza: boolean;
}

const FILE = "https.json";
const NOMI_MASSIMI = 10;

/**
 * Un nome valido per il certificato: un indirizzo della rete di casa o un nome di macchina. Un
 * indirizzo pubblico, o 0.0.0.0, la CA di Shinka non lo può firmare: il certificato verrebbe
 * rifiutato da ogni browser.
 */
export function nomeValido(nome: string): boolean {
  if (isIP(nome) !== 0) return indirizzoPrivato(nome);
  return /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i.test(nome);
}

function nomiDa(testo: unknown): string[] {
  const voci = Array.isArray(testo) ? testo : typeof testo === "string" ? testo.split(",") : [];
  return voci
    .filter((voce): voce is string => typeof voce === "string")
    .map((voce) => voce.trim())
    .filter((voce) => voce !== "" && nomeValido(voce))
    .slice(0, NOMI_MASSIMI);
}

/** La configurazione: le variabili d'ambiente valgono sopra il file. */
export function leggiConfigurazioneHttps(dati: string, ambiente: NodeJS.ProcessEnv = process.env): ConfigurazioneHttps {
  let letta: Partial<SceltaHttps> = {};
  try {
    letta = JSON.parse(readFileSync(join(dati, FILE), "utf8")) as Partial<SceltaHttps>;
  } catch {
    // Nessun file: si decide con le variabili, e altrimenti l'HTTPS resta spento.
  }
  const acceso = ambiente.SHINKA_HTTPS;
  const certificato = ambiente.SHINKA_HTTPS_CERTIFICATO;
  const chiave = ambiente.SHINKA_HTTPS_CHIAVE;
  return {
    attivo: acceso === "1" ? true : acceso === "0" ? false : letta.attivo === true,
    nomi: [...new Set([...nomiDa(ambiente.SHINKA_HTTPS_NOMI), ...nomiDa(letta.nomi)])],
    reindirizza: ambiente.SHINKA_HTTPS_REINDIRIZZA === "1" ? true : ambiente.SHINKA_HTTPS_REINDIRIZZA === "0" ? false : letta.reindirizza === true,
    ...(certificato !== undefined && certificato !== "" && chiave !== undefined && chiave !== "" ? { proprio: { certificato, chiave } } : {}),
  };
}

/** Scrive la scelta del proprietario. Vale dal prossimo avvio del centro. */
export function salvaSceltaHttps(dati: string, scelta: SceltaHttps): SceltaHttps {
  const pulita: SceltaHttps = { attivo: scelta.attivo, nomi: nomiDa(scelta.nomi), reindirizza: scelta.reindirizza };
  const provvisorio = join(dati, `${FILE}.nuovo`);
  writeFileSync(provvisorio, `${JSON.stringify(pulita, null, 2)}\n`);
  renameSync(provvisorio, join(dati, FILE));
  return pulita;
}

/** I nomi che il certificato deve avere: quelli dati, la macchina stessa e i suoi indirizzi. */
export function nomiDelCertificato(
  dati: readonly string[],
  macchina: { nome: string; indirizzi: string[] } = {
    nome: hostname(),
    indirizzi: Object.values(networkInterfaces())
      .flat()
      .filter((voce) => voce !== undefined && !voce.internal && voce.family === "IPv4")
      .map((voce) => voce?.address ?? ""),
  },
): string[] {
  const tutti = [...dati, "localhost", "127.0.0.1", "::1", macchina.nome, ...macchina.indirizzi];
  return [...new Set(tutti.map((voce) => voce.trim().toLowerCase()).filter((voce) => voce !== "" && nomeValido(voce)))];
}

export interface DatiDelCertificato {
  impronta: string;
  scadeIl: string;
}

/** I certificati pronti per il server, e ciò che il proprietario deve sapere di loro. */
export interface CertificatiPronti {
  chiave: string;
  /** Il certificato del server seguito da quello della CA, che il server manda insieme. */
  catena: string;
  nomi: string[];
  server: DatiDelCertificato;
  /** La CA di Shinka, da installare sui dispositivi. Manca con un certificato proprio. */
  ca?: DatiDelCertificato & { pem: string; der: Buffer };
  proprio: boolean;
  /** Ciò che è cambiato a questo avvio, in parole per il proprietario. */
  avvisi: string[];
}

const GIORNO_MS = 24 * 60 * 60 * 1000;

function leggiSeEsiste(file: string): string | undefined {
  return existsSync(file) ? readFileSync(file, "utf8") : undefined;
}

function scriviSegreto(file: string, contenuto: string): void {
  writeFileSync(file, contenuto, { mode: 0o600 });
}

function dati(certificato: X509Certificate): DatiDelCertificato {
  return { impronta: impronta(certificato), scadeIl: new Date(certificato.validTo).toISOString() };
}

/** I certificati del centro: quelli che ci sono, se vanno ancora bene, altrimenti nuovi. */
export function preparaCertificati(cartella: string, nomi: readonly string[], adesso: Date = new Date()): CertificatiPronti {
  mkdirSync(cartella, { recursive: true, mode: 0o700 });
  const avvisi: string[] = [];
  const percorso = (nome: string): string => join(cartella, nome);

  // La CA: si tiene se c'è, se non scade a breve e se può firmare tutti i nomi.
  let caPem = leggiSeEsiste(percorso("ca.crt"));
  let caChiave = leggiSeEsiste(percorso("ca.key"));
  let nomiDellaCa: string[] = [];
  try {
    nomiDellaCa = JSON.parse(leggiSeEsiste(percorso("ca.json")) ?? "{}").nomi ?? [];
  } catch {
    nomiDellaCa = [];
  }
  const caVecchia = caPem === undefined ? undefined : new X509Certificate(caPem);
  const caValida =
    caPem !== undefined &&
    caChiave !== undefined &&
    caVecchia !== undefined &&
    Date.parse(caVecchia.validTo) - adesso.getTime() > 90 * GIORNO_MS &&
    caCopre(nomiDellaCa, nomi);
  let caNuova = false;
  if (!caValida) {
    const ca = nuovaCa(nomi, adesso);
    caPem = ca.certificato;
    caChiave = ca.chiave;
    nomiDellaCa = [...nomi];
    scriviSegreto(percorso("ca.key"), ca.chiave);
    writeFileSync(percorso("ca.crt"), ca.certificato);
    writeFileSync(percorso("ca.json"), `${JSON.stringify({ nomi: nomiDellaCa }, null, 2)}\n`);
    caNuova = true;
    if (caVecchia !== undefined) {
      avvisi.push("La CA di Shinka è nuova, perché quella di prima non poteva firmare i nomi di adesso o stava per scadere: va installata di nuovo su iPhone e PC.");
    }
  }
  const ca = new X509Certificate(caPem ?? "");

  // Il certificato del server: si tiene se è della CA, ha gli stessi nomi e non scade entro un mese.
  let serverPem = leggiSeEsiste(percorso("server.crt"));
  let serverChiave = leggiSeEsiste(percorso("server.key"));
  let nomiDelServer: string[] = [];
  try {
    nomiDelServer = JSON.parse(leggiSeEsiste(percorso("server.json")) ?? "{}").nomi ?? [];
  } catch {
    nomiDelServer = [];
  }
  const serverVecchio = serverPem === undefined ? undefined : new X509Certificate(serverPem);
  const stessiNomi = nomiDelServer.length === nomi.length && nomi.every((nome) => nomiDelServer.includes(nome));
  const serverValido =
    !caNuova &&
    serverPem !== undefined &&
    serverChiave !== undefined &&
    serverVecchio !== undefined &&
    serverVecchio.verify(ca.publicKey) &&
    stessiNomi &&
    Date.parse(serverVecchio.validTo) - adesso.getTime() > 30 * GIORNO_MS;
  if (!serverValido) {
    const server = nuovoServer({ certificato: caPem ?? "", chiave: caChiave ?? "" }, nomi, adesso);
    serverPem = server.certificato;
    serverChiave = server.chiave;
    scriviSegreto(percorso("server.key"), server.chiave);
    writeFileSync(percorso("server.crt"), server.certificato);
    writeFileSync(percorso("server.json"), `${JSON.stringify({ nomi }, null, 2)}\n`);
    if (serverVecchio !== undefined && !caNuova && !stessiNomi) {
      avvisi.push(`Il certificato del server è stato rifatto perché i nomi sono cambiati: ora vale per ${nomi.join(", ")}. Sui dispositivi non c'è nulla da reinstallare.`);
    }
  }
  const server = new X509Certificate(serverPem ?? "");
  return {
    chiave: serverChiave ?? "",
    catena: `${serverPem ?? ""}${caPem ?? ""}`,
    nomi: [...nomi],
    server: dati(server),
    ca: { ...dati(ca), pem: caPem ?? "", der: ca.raw },
    proprio: false,
    avvisi,
  };
}

/** Un certificato proprio del proprietario, letto dai suoi file. Lancia se non va. */
export function certificatoProprio(file: { certificato: string; chiave: string }): CertificatiPronti {
  const catena = readFileSync(file.certificato, "utf8");
  const chiave = readFileSync(file.chiave, "utf8");
  const server = new X509Certificate(catena);
  const nomi = (server.subjectAltName ?? "")
    .split(", ")
    .map((voce) => voce.replace(/^(DNS|IP Address):/, ""))
    .filter((voce) => voce !== "");
  return { chiave, catena, nomi, server: dati(server), proprio: true, avvisi: [] };
}

/**
 * Il profilo che iOS installa per fidarsi della CA di Shinka. Non è firmato: iOS lo dice, e chiede
 * conferma. Dopo l'installazione la fiducia si accende a mano, in Impostazioni.
 */
export function profiloApple(ca: { der: Buffer; impronta: string }): string {
  const uuid = (seme: string): string => {
    const esadecimale = seme.replace(/[^0-9A-F]/gi, "").padEnd(32, "0").slice(0, 32).toUpperCase();
    return `${esadecimale.slice(0, 8)}-${esadecimale.slice(8, 12)}-${esadecimale.slice(12, 16)}-${esadecimale.slice(16, 20)}-${esadecimale.slice(20, 32)}`;
  };
  const corto = ca.impronta.replace(/:/g, "").slice(0, 12).toLowerCase();
  const base64 = (ca.der.toString("base64").match(/.{1,52}/g) ?? []).join("\n          ");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>PayloadCertificateFileName</key>
      <string>shinka-ca.cer</string>
      <key>PayloadContent</key>
      <data>
          ${base64}
      </data>
      <key>PayloadDescription</key>
      <string>Il certificato con cui Shinka si fa riconoscere in HTTPS.</string>
      <key>PayloadDisplayName</key>
      <string>Shinka CA</string>
      <key>PayloadIdentifier</key>
      <string>shinka.ca.${corto}.certificato</string>
      <key>PayloadType</key>
      <string>com.apple.security.root</string>
      <key>PayloadUUID</key>
      <string>${uuid(ca.impronta.slice(0, 47))}</string>
      <key>PayloadVersion</key>
      <integer>1</integer>
    </dict>
  </array>
  <key>PayloadDescription</key>
  <string>Fa riconoscere a questo dispositivo la connessione HTTPS di Shinka.</string>
  <key>PayloadDisplayName</key>
  <string>Shinka</string>
  <key>PayloadIdentifier</key>
  <string>shinka.ca.${corto}</string>
  <key>PayloadRemovalDisallowed</key>
  <false/>
  <key>PayloadType</key>
  <string>Configuration</string>
  <key>PayloadUUID</key>
  <string>${uuid(ca.impronta.slice(48))}</string>
  <key>PayloadVersion</key>
  <integer>1</integer>
</dict>
</plist>
`;
}

/** L'HTTPS come lo tiene il centro mentre è acceso. */
export interface HttpsDelCentro {
  /** La cartella dei dati, dove si scrive la scelta del proprietario. */
  dati: string;
  /** La configurazione con cui il centro è partito. */
  configurazione: ConfigurazioneHttps;
  /** Ciò che il proprietario ha scelto per il prossimo avvio: cambia dalla pagina. */
  scelta: SceltaHttps;
  /** Vero se SHINKA_HTTPS decide da sé l'accensione. */
  decisoDaVariabile: boolean;
  /** Presenti se il centro parla HTTPS adesso. */
  certificati?: CertificatiPronti;
  /** Perché l'HTTPS è scelto ma non è partito. */
  problema?: string;
  porta: number;
  /** Fa ripartire il centro, se lo tiene acceso il guardiano. */
  riavvia?: () => void;
}

/** Gli indirizzi da cui aprire Shinka in HTTPS: prima quello da cui il proprietario sta guardando. */
export function indirizziHttps(https: HttpsDelCentro, host: string | undefined): string[] {
  const certificati = https.certificati;
  if (certificati === undefined) return [];
  const daQui = host?.replace(/:\d+$/, "").replace(/^\[|\]$/g, "").toLowerCase();
  // Gli indirizzi della macchina stessa servono solo a chi la sta usando da lì.
  const nomi = certificati.nomi.filter((nome) => nome === daQui || (nome !== "localhost" && nome !== "127.0.0.1" && nome !== "::1"));
  const ordinati = daQui !== undefined && nomi.includes(daQui) ? [daQui, ...nomi.filter((nome) => nome !== daQui)] : nomi;
  return ordinati.map((nome) => `https://${isIP(nome) === 6 ? `[${nome}]` : nome}:${https.porta}`);
}

/** Lo stato dell'HTTPS per la pagina del vault. */
export function statoHttps(https: HttpsDelCentro, host: string | undefined): StatoHttps {
  const certificati = https.certificati;
  return {
    inFunzione: certificati !== undefined,
    scelta: https.scelta,
    decisoDaVariabile: https.decisoDaVariabile,
    indirizzi: indirizziHttps(https, host),
    nomi: certificati?.nomi ?? [],
    ...(certificati === undefined ? {} : { server: certificati.server }),
    ...(certificati?.ca === undefined ? {} : { ca: { impronta: certificati.ca.impronta, scadeIl: certificati.ca.scadeIl } }),
    proprio: certificati?.proprio ?? false,
    avvisi: certificati?.avvisi ?? [],
    ...(https.problema === undefined ? {} : { problema: https.problema }),
    ripartenza: https.riavvia !== undefined,
  };
}

function inHtml(testo: string): string {
  return testo.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** La pagina da cui si scarica la CA di Shinka, con le istruzioni per iPhone e per Windows. */
export function paginaDelCertificato(ca: DatiDelCertificato | undefined, indirizzi: string[]): string {
  const corpo =
    ca === undefined
      ? "<p>In questa installazione Shinka non ha una sua CA: l'HTTPS è spento, oppure usa un certificato proprio.</p>"
      : `<p>Shinka parla HTTPS con un certificato firmato da una sua piccola autorità, la <b>CA di Shinka</b>. Un dispositivo che la installa si fida di Shinka, e solo di Shinka: la CA può firmare soltanto indirizzi della rete di casa e i nomi di questa macchina.</p>
<p class="impronta">Impronta SHA-256 della CA:<br><code>${inHtml(ca.impronta)}</code><br>Scade il ${inHtml(ca.scadeIl.slice(0, 10))}.</p>
<h2>iPhone e iPad</h2>
<ol>
<li>Apri questa pagina con <b>Safari</b> e tocca <a class="pulsante" href="/certificato/shinka.mobileconfig">Scarica il profilo</a>. Conferma con «Consenti».</li>
<li>Apri <b>Impostazioni</b>: in cima c'è «Profilo scaricato». Toccalo e scegli <b>Installa</b>. iOS dice che non è firmato: è normale.</li>
<li>Vai in <b>Impostazioni › Generali › Info › Attendibilità certificati</b> e accendi <b>Shinka CA</b>.</li>
<li>Apri Shinka da ${indirizzi[0] === undefined ? "un indirizzo https" : `<a href="${inHtml(indirizzi[0])}">${inHtml(indirizzi[0])}</a>`}. Per averla come app: Condividi › «Aggiungi alla schermata Home».</li>
</ol>
<h2>PC Windows</h2>
<ol>
<li>Scarica <a class="pulsante" href="/certificato/shinka-ca.crt">il certificato della CA</a> e aprilo.</li>
<li>Scegli <b>Installa certificato…</b>, poi «Utente corrente», poi «Colloca tutti i certificati nel seguente archivio» e scegli <b>Autorità di certificazione radice attendibili</b>.</li>
<li>Conferma l'avviso di Windows, controllando che l'impronta sia quella qui sopra, e riapri il browser.</li>
</ol>
<p>Firefox usa un elenco suo: in Impostazioni › Privacy e sicurezza › Certificati › Mostra certificati › Autorità, importa lo stesso file e spunta «Questa CA è attendibile per identificare siti web».</p>`;
  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<link rel="icon" href="/icona-piccola.svg" type="image/svg+xml">
<title>Il certificato di Shinka</title>
<style>
  body { margin: 0 auto; max-width: 40rem; padding: 1.2rem; font: 16px/1.5 system-ui, -apple-system, sans-serif; color: #1d1c1a; background: #f7f6f3; }
  h1 { font-size: 1.4rem; } h2 { font-size: 1.1rem; margin-top: 1.6rem; }
  code { font-size: .8rem; word-break: break-all; }
  li { margin: .4rem 0; }
  a.pulsante { display: inline-block; padding: .2rem .6rem; border-radius: 8px; background: #2f5fd0; color: #fff; text-decoration: none; }
  .impronta { padding: .6rem .8rem; border-radius: 10px; background: #efede8; }
  @media (prefers-color-scheme: dark) { body { color: #ecebe8; background: #151517; } .impronta { background: #2a2a2f; } a { color: #7ea2ff; } a.pulsante { color: #0d1220; background: #7ea2ff; } }
</style>
</head>
<body>
<h1>Il certificato di Shinka</h1>
${corpo}
</body>
</html>
`;
}
