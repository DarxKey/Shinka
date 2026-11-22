import assert from "node:assert/strict";
import { createDecipheriv, createECDH, createPublicKey, hkdfSync, verify } from "node:crypto";
import { test } from "node:test";
import { cifraPerIlBrowser, intestazioneVapid, mandaPush, nuoveChiaviVapid, servizioConosciuto } from "./web-push.ts";

/** I valori dell'esempio della RFC 8291 (sezione 5 e appendice A). */
const RFC = {
  messaggio: "When I grow up, I want to be a watermelon",
  mittentePrivata: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  browserPubblica: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  browserPrivata: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  segreto: "BTBZMqHH6r4Tts7J_aSIgg",
  sale: "DGv6ra1nlYgDCS1FRnbzlw",
  testa: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  cifrato: "8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ",
};

test("la cifratura dà, byte per byte, il messaggio dell'esempio della RFC 8291", () => {
  const mittente = createECDH("prime256v1");
  mittente.setPrivateKey(Buffer.from(RFC.mittentePrivata, "base64url"));
  const corpo = cifraPerIlBrowser(Buffer.from(RFC.messaggio), { p256dh: RFC.browserPubblica, auth: RFC.segreto }, { sale: Buffer.from(RFC.sale, "base64url"), mittente });
  assert.equal(corpo.subarray(0, 86).toString("base64url"), RFC.testa);
  assert.equal(corpo.subarray(86).toString("base64url"), RFC.cifrato);
  // 86 byte di testata e 58 di cifrato: i 41 del testo, il byte che chiude e i 16 del sigillo.
  assert.equal(corpo.length, 144);
});

/** Ciò che fa il browser: dal corpo ricevuto, con la sua chiave privata, torna il messaggio. */
function apri(corpo: Buffer, privata: Buffer, pubblica: Buffer, segreto: Buffer): string {
  const sale = corpo.subarray(0, 16);
  const lunga = corpo.readUInt8(20);
  const delMittente = corpo.subarray(21, 21 + lunga);
  const browser = createECDH("prime256v1");
  browser.setPrivateKey(privata);
  const ikm = Buffer.from(hkdfSync("sha256", browser.computeSecret(delMittente), segreto, Buffer.concat([Buffer.from("WebPush: info\0"), pubblica, delMittente]), 32));
  const chiave = Buffer.from(hkdfSync("sha256", ikm, sale, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, sale, Buffer.from("Content-Encoding: nonce\0"), 12));
  const cifrato = corpo.subarray(21 + lunga);
  const decifra = createDecipheriv("aes-128-gcm", chiave, nonce);
  decifra.setAuthTag(cifrato.subarray(cifrato.length - 16));
  const chiaro = Buffer.concat([decifra.update(cifrato.subarray(0, cifrato.length - 16)), decifra.final()]);
  assert.equal(chiaro.at(-1), 2);
  return chiaro.subarray(0, -1).toString("utf8");
}

test("con sale e chiave a caso, il browser riapre il messaggio; ogni volta il corpo è diverso", () => {
  const browser = createECDH("prime256v1");
  browser.generateKeys();
  const segreto = Buffer.from("0123456789abcdef");
  const iscrizione = { p256dh: browser.getPublicKey().toString("base64url"), auth: segreto.toString("base64url") };
  const testo = JSON.stringify({ titolo: "Il progetto «Blog» ha finito", corpo: "Fatto: è già online. 🎉" });
  const primo = cifraPerIlBrowser(Buffer.from(testo), iscrizione);
  const secondo = cifraPerIlBrowser(Buffer.from(testo), iscrizione);
  assert.equal(apri(primo, browser.getPrivateKey(), browser.getPublicKey(), segreto), testo);
  assert.notDeepEqual(primo, secondo);
  assert.throws(() => cifraPerIlBrowser(Buffer.alloc(5000), iscrizione), /troppo lungo/);
  assert.throws(() => cifraPerIlBrowser(Buffer.from("x"), { p256dh: "AAAA", auth: iscrizione.auth }), /P-256/);
});

test("il centro si presenta con un gettone firmato dalla sua chiave, per quel servizio, senza dire chi è il proprietario", () => {
  const chiavi = nuoveChiaviVapid();
  assert.equal(Buffer.from(chiavi.pubblica, "base64url").length, 65);
  const adesso = Date.parse("2026-11-22T10:00:00Z");
  const intestazione = intestazioneVapid("https://web.push.apple.com/QAbc123", chiavi, "mailto:notifiche@shinka.invalid", adesso);
  const trovato = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(intestazione);
  assert.ok(trovato !== null, intestazione);
  const [, testa, corpo, firma, chiave] = trovato as unknown as [string, string, string, string, string];
  assert.equal(chiave, chiavi.pubblica);
  assert.deepEqual(JSON.parse(Buffer.from(testa, "base64url").toString()), { typ: "JWT", alg: "ES256" });
  assert.deepEqual(JSON.parse(Buffer.from(corpo, "base64url").toString()), { aud: "https://web.push.apple.com", exp: adesso / 1000 + 43200, sub: "mailto:notifiche@shinka.invalid" });
  const pubblica = createPublicKey({ key: { kty: "EC", crv: "P-256", x: chiavi.privata.x, y: chiavi.privata.y }, format: "jwk" });
  assert.equal(verify("sha256", Buffer.from(`${testa}.${corpo}`), { key: pubblica, dsaEncoding: "ieee-p1363" }, Buffer.from(firma, "base64url")), true);
});

test("le notifiche vanno solo ai servizi dei browser, in HTTPS", () => {
  assert.equal(servizioConosciuto("https://web.push.apple.com/QAbc"), true);
  assert.equal(servizioConosciuto("https://fcm.googleapis.com/fcm/send/abc"), true);
  assert.equal(servizioConosciuto("https://updates.push.services.mozilla.com/wpush/v2/abc"), true);
  assert.equal(servizioConosciuto("http://web.push.apple.com/QAbc"), false);
  assert.equal(servizioConosciuto("https://192.168.1.20:7851/api/stato"), false);
  assert.equal(servizioConosciuto("https://push.apple.com.evil.example/x"), false);
  assert.equal(servizioConosciuto("https://evilfcm.googleapis.com/x"), false);
  assert.equal(servizioConosciuto("non è un indirizzo"), false);
});

test("mandare: riuscita, iscrizione scaduta, rifiuto del servizio, indirizzo non ammesso", async () => {
  const browser = createECDH("prime256v1");
  browser.generateKeys();
  const iscrizione = { endpoint: "https://web.push.apple.com/QAbc", p256dh: browser.getPublicKey().toString("base64url"), auth: Buffer.alloc(16, 7).toString("base64url") };
  const chiavi = nuoveChiaviVapid();
  const viste: { url: string; intestazioni: Record<string, string>; corpo: Buffer }[] = [];
  const finto = (stato: number, testo = ""): typeof fetch =>
    (async (url: unknown, opzioni: { headers: Record<string, string>; body: Buffer }) => {
      viste.push({ url: String(url), intestazioni: opzioni.headers, corpo: Buffer.from(opzioni.body) });
      return new Response(testo, { status: stato });
    }) as unknown as typeof fetch;

  assert.deepEqual(await mandaPush(iscrizione, "ciao", chiavi, "mailto:x@shinka.invalid", { manda: finto(201), urgente: true }), { esito: "mandata" });
  assert.equal(viste[0]?.url, iscrizione.endpoint);
  assert.equal(viste[0]?.intestazioni["Content-Encoding"], "aes128gcm");
  assert.equal(viste[0]?.intestazioni.Urgency, "high");
  assert.match(viste[0]?.intestazioni.Authorization ?? "", /^vapid t=/);
  assert.equal(apri(viste[0]?.corpo ?? Buffer.alloc(0), browser.getPrivateKey(), browser.getPublicKey(), Buffer.alloc(16, 7)), "ciao");
  assert.deepEqual(await mandaPush(iscrizione, "ciao", chiavi, "mailto:x@shinka.invalid", { manda: finto(410) }), { esito: "scaduta" });
  assert.deepEqual(await mandaPush(iscrizione, "ciao", chiavi, "mailto:x@shinka.invalid", { manda: finto(403, '{"reason":"BadJwtToken"}') }), {
    esito: "fallita",
    motivo: 'Il servizio di notifiche ha risposto 403: {"reason":"BadJwtToken"}',
  });
  const altrove = await mandaPush({ ...iscrizione, endpoint: "https://192.168.1.254/x" }, "ciao", chiavi, "mailto:x@shinka.invalid", { manda: finto(201) });
  assert.equal(altrove.esito, "fallita");
  assert.equal(viste.length, 3);
});
