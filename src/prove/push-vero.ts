/**
 * Una prova delle notifiche dell'app con un servizio di notifiche vero, senza un browser: questo
 * programma si collega al servizio di Mozilla come farebbe Firefox, si fa dare un indirizzo, e gli
 * manda una notifica con il codice di Shinka. Riesce se il servizio accetta la firma del centro e
 * la notifica torna indietro e si riapre uguale. Non manda nulla che riguardi il proprietario.
 *
 *   node src/prove/push-vero.ts
 */

import { createDecipheriv, createECDH, hkdfSync, randomBytes, randomUUID } from "node:crypto";
import WebSocket from "ws";
import { CONTATTO_GENERICO } from "../centro/notifiche-app.ts";
import { mandaPush, nuoveChiaviVapid } from "../centro/web-push.ts";

interface Messaggio {
  messageType: string;
  status?: number;
  pushEndpoint?: string;
  data?: string;
  channelID?: string;
  version?: string;
}

const chiavi = nuoveChiaviVapid();
const browser = createECDH("prime256v1");
browser.generateKeys();
const segreto = randomBytes(16);

const collegamento = new WebSocket("wss://push.services.mozilla.com/");
const inAttesa = new Map<string, (messaggio: Messaggio) => void>();
const prossimo = (tipo: string): Promise<Messaggio | undefined> =>
  new Promise((arrivato) => {
    inAttesa.set(tipo, arrivato);
    setTimeout(() => arrivato(undefined), 20_000).unref();
  });
collegamento.on("message", (dati) => {
  const messaggio = JSON.parse(String(dati)) as Messaggio;
  inAttesa.get(messaggio.messageType)?.(messaggio);
  inAttesa.delete(messaggio.messageType);
});
const finisci = (riuscita: boolean, perche: string): never => {
  console.log(`${riuscita ? "RIUSCITA" : "FALLITA"}: ${perche}`);
  collegamento.close();
  process.exit(riuscita ? 0 : 1);
};
collegamento.on("error", (errore) => finisci(false, `il servizio non si raggiunge (${errore.message})`));
await new Promise((aperto) => collegamento.once("open", aperto));

collegamento.send(JSON.stringify({ messageType: "hello", use_webpush: true, broadcasts: {} }));
if ((await prossimo("hello"))?.status !== 200) finisci(false, "il servizio non ha accolto il collegamento");
const canale = randomUUID();
collegamento.send(JSON.stringify({ messageType: "register", channelID: canale, key: chiavi.pubblica }));
const registrato = await prossimo("register");
if (registrato?.pushEndpoint === undefined) finisci(false, "il servizio non ha dato un indirizzo");
const endpoint = registrato?.pushEndpoint ?? "";
console.log(`Indirizzo ricevuto da ${new URL(endpoint).host}.`);

const testo = JSON.stringify({ titolo: "Shinka", corpo: "Prova riuscita: è arrivata. àèìòù" });
const arrivo = prossimo("notification");
const esito = await mandaPush({ endpoint, p256dh: browser.getPublicKey().toString("base64url"), auth: segreto.toString("base64url") }, testo, chiavi, CONTATTO_GENERICO, { urgente: true });
if (esito.esito !== "mandata") finisci(false, esito.esito === "fallita" ? esito.motivo : "l'iscrizione risulta scaduta");
const notifica = await arrivo;
if (notifica?.data === undefined) finisci(false, "il servizio ha accettato la notifica, ma non è arrivata in venti secondi");

// Ciò che fa il browser: riapre il messaggio con la sua chiave privata.
const corpo = Buffer.from(notifica?.data ?? "", "base64url");
const sale = corpo.subarray(0, 16);
const delMittente = corpo.subarray(21, 21 + corpo.readUInt8(20));
const ikm = Buffer.from(hkdfSync("sha256", browser.computeSecret(delMittente), segreto, Buffer.concat([Buffer.from("WebPush: info\0"), browser.getPublicKey(), delMittente]), 32));
const chiave = Buffer.from(hkdfSync("sha256", ikm, sale, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
const nonce = Buffer.from(hkdfSync("sha256", ikm, sale, Buffer.from("Content-Encoding: nonce\0"), 12));
const cifrato = corpo.subarray(21 + delMittente.length);
const decifra = createDecipheriv("aes-128-gcm", chiave, nonce);
decifra.setAuthTag(cifrato.subarray(cifrato.length - 16));
const chiaro = Buffer.concat([decifra.update(cifrato.subarray(0, cifrato.length - 16)), decifra.final()]).subarray(0, -1).toString("utf8");
collegamento.send(JSON.stringify({ messageType: "ack", updates: [{ channelID: notifica?.channelID, version: notifica?.version, code: 100 }] }));
collegamento.send(JSON.stringify({ messageType: "unregister", channelID: canale }));
await new Promise((fatto) => setTimeout(fatto, 500));
finisci(chiaro === testo, chiaro === testo ? "la notifica è arrivata e si riapre uguale" : "la notifica è arrivata, ma riaperta è diversa");
