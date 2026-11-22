import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import { readFile } from "node:fs/promises";
import { request as richiestaHttp, type IncomingHttpHeaders } from "node:http";
import { request as richiestaHttps } from "node:https";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import WebSocket from "ws";
import { PERCORSO_COLLEGAMENTO } from "../protocollo/nodi.ts";
import { allestisci, PASSWORD, type Banco } from "../prove/banco.ts";
import { COOKIE_SESSIONE } from "./centro.ts";
import { preparaCertificati, type CertificatiPronti, type HttpsDelCentro } from "./https.ts";
import { creaServerAnteprima } from "./server-anteprima.ts";

interface Risposta {
  stato: number;
  intestazioni: IncomingHttpHeaders;
  corpo: Buffer;
}

function chiedi(
  schema: "http" | "https",
  porta: number,
  percorso: string,
  ca: string,
  opzioni: { metodo?: string; corpo?: unknown; intestazioni?: Record<string, string> } = {},
): Promise<Risposta> {
  const testo = opzioni.corpo === undefined ? undefined : JSON.stringify(opzioni.corpo);
  return new Promise((fatto, fallito) => {
    const q = (schema === "https" ? richiestaHttps : richiestaHttp)(
      {
        host: "127.0.0.1",
        port: porta,
        path: percorso,
        method: opzioni.metodo ?? "GET",
        ...(schema === "https" ? { ca } : {}),
        headers: { ...(testo === undefined ? {} : { "content-type": "application/json" }), ...opzioni.intestazioni },
      },
      (r) => {
        const pezzi: Buffer[] = [];
        r.on("data", (pezzo: Buffer) => pezzi.push(pezzo));
        r.on("end", () => fatto({ stato: r.statusCode ?? 0, intestazioni: r.headers, corpo: Buffer.concat(pezzi) }));
      },
    );
    q.on("error", fallito);
    q.end(testo);
  });
}

async function conHttps(t: TestContext, reindirizza: boolean): Promise<{ banco: Banco; porta: number; certificati: CertificatiPronti; https: HttpsDelCentro; riavvii: number[] }> {
  const riavvii: number[] = [];
  const base = await allestisci(t);
  // Un banco nuovo, con l'HTTPS acceso: i certificati stanno tra i dati del primo.
  const certificati = preparaCertificati(join(base.cartella, "https"), ["127.0.0.1", "localhost"]);
  const https: HttpsDelCentro = {
    dati: base.cartella,
    configurazione: { attivo: true, nomi: ["127.0.0.1"], reindirizza },
    scelta: { attivo: true, nomi: ["127.0.0.1"], reindirizza },
    decisoDaVariabile: false,
    certificati,
    porta: 0,
    riavvia: () => riavvii.push(Date.now()),
  };
  const banco = await allestisci(t, { https });
  await banco.centro.listen({ host: "127.0.0.1", port: 0 });
  const porta = (banco.centro.server.address() as AddressInfo).port;
  https.porta = porta;
  return { banco, porta, certificati, https, riavvii };
}

test("sulla stessa porta il centro parla HTTPS al proprietario e HTTP a nodi, gateway e guardiano", async (t) => {
  const { porta, certificati } = await conHttps(t, false);
  const ca = certificati.ca?.pem ?? "";
  for (const schema of ["http", "https"] as const) {
    const stato = await chiedi(schema, porta, "/api/stato", ca);
    assert.equal(stato.stato, 200, schema);
    assert.deepEqual(JSON.parse(stato.corpo.toString()), { configurato: true, autenticato: false });
  }
  // La politica dei contenuti ammette i WebSocket cifrati e l'anteprima, che in una pagina HTTPS è HTTPS.
  const politica = String((await chiedi("https", porta, "/api/stato", ca)).intestazioni["content-security-policy"]);
  assert.match(politica, new RegExp(`connect-src 'self' ws://127\\.0\\.0\\.1:${porta} wss://127\\.0\\.0\\.1:${porta}`));
  assert.match(politica, /frame-src 'self' 127\.0\.0\.1:\d+/);
});

test("entrando in HTTPS il cookie è sicuro, e l'origine si controlla anche in HTTPS", async (t) => {
  const { porta, certificati } = await conHttps(t, false);
  const ca = certificati.ca?.pem ?? "";
  const entra = (schema: "http" | "https", origine: string) =>
    chiedi(schema, porta, "/api/accesso", ca, { metodo: "POST", corpo: { password: PASSWORD }, intestazioni: { origin: origine } });

  const cifrato = await entra("https", `https://127.0.0.1:${porta}`);
  assert.equal(cifrato.stato, 200);
  assert.match(String(cifrato.intestazioni["set-cookie"]), /; Secure/);
  const inChiaro = await entra("http", `http://127.0.0.1:${porta}`);
  assert.equal(inChiaro.stato, 200);
  assert.doesNotMatch(String(inChiaro.intestazioni["set-cookie"]), /; Secure/);
  assert.equal((await entra("https", `https://altro.sito:${porta}`)).stato, 403);
});

test("chi apre l'interfaccia in HTTP va all'HTTPS, se è scelto; API e certificato restano in HTTP", async (t) => {
  const { porta, certificati } = await conHttps(t, true);
  const ca = certificati.ca?.pem ?? "";
  const pagina = await chiedi("http", porta, "/?a=1", ca, { intestazioni: { host: `127.0.0.1:${porta}` } });
  assert.equal(pagina.stato, 308);
  assert.equal(pagina.intestazioni.location, `https://127.0.0.1:${porta}/?a=1`);
  assert.equal((await chiedi("http", porta, "/api/stato", ca)).stato, 200);
  assert.equal((await chiedi("http", porta, "/certificato", ca)).stato, 200);
  // Un host scritto in modo strano non diventa un indirizzo a cui mandare il browser.
  const strano = await chiedi("http", porta, "/", ca, { intestazioni: { host: "evil.example/x?" } });
  assert.notEqual(strano.stato, 308);
});

test("il certificato da installare si scarica prima dell'accesso, anche come profilo per iOS", async (t) => {
  const { porta, certificati } = await conHttps(t, false);
  const ca = certificati.ca?.pem ?? "";
  const crt = await chiedi("http", porta, "/certificato/shinka-ca.crt", ca);
  assert.equal(crt.stato, 200);
  assert.equal(crt.intestazioni["content-type"], "application/x-x509-ca-cert");
  assert.equal(new X509Certificate(crt.corpo).fingerprint256, certificati.ca?.impronta);
  const profilo = await chiedi("https", porta, "/certificato/shinka.mobileconfig", ca);
  assert.equal(profilo.intestazioni["content-type"], "application/x-apple-aspen-config");
  assert.match(profilo.corpo.toString(), /com\.apple\.security\.root/);
  const istruzioni = await chiedi("https", porta, "/certificato", ca);
  assert.match(String(istruzioni.intestazioni["content-type"]), /^text\/html/);
  assert.ok(istruzioni.corpo.toString().includes(certificati.ca?.impronta ?? "?"));
  assert.ok(istruzioni.corpo.toString().includes(`https://127.0.0.1:${porta}`));
});

test("lo stato dell'HTTPS e la scelta per il prossimo avvio sono solo del proprietario", async (t) => {
  const { banco, porta, certificati, riavvii, https } = await conHttps(t, false);
  const ca = certificati.ca?.pem ?? "";
  assert.equal((await chiedi("https", porta, "/api/https", ca)).stato, 401);
  const cookies = { [COOKIE_SESSIONE]: await banco.entra() };
  const stato = await banco.centro.inject({ method: "GET", url: "/api/https", cookies, headers: { host: `127.0.0.1:${porta}` } });
  assert.equal(stato.json().inFunzione, true);
  assert.deepEqual(stato.json().indirizzi, [`https://127.0.0.1:${porta}`]);
  assert.equal(stato.json().ca.impronta, certificati.ca?.impronta);
  assert.equal(stato.json().ripartenza, true);

  for (const nome of ["non va!", "0.0.0.0", "8.8.8.8"]) {
    const sbagliato = await banco.centro.inject({ method: "POST", url: "/api/https", cookies, payload: { attivo: true, nomi: [nome], reindirizza: false } });
    assert.equal(sbagliato.statusCode, 400, nome);
    assert.match(sbagliato.json().errore, /0\.0\.0\.0 e gli indirizzi pubblici non possono starci/);
  }
  const scelta = await banco.centro.inject({ method: "POST", url: "/api/https", cookies, payload: { attivo: true, nomi: ["192.168.1.20"], reindirizza: true, riparti: true } });
  assert.equal(scelta.statusCode, 200);
  assert.equal(scelta.json().riparte, true);
  assert.deepEqual(scelta.json().scelta, { attivo: true, nomi: ["192.168.1.20"], reindirizza: true });
  assert.deepEqual(JSON.parse(await readFile(join(https.dati, "https.json"), "utf8")), { attivo: true, nomi: ["192.168.1.20"], reindirizza: true });
  await new Promise((fatto) => setTimeout(fatto, 500));
  assert.equal(riavvii.length, 1);
});

test("i WebSocket si aprono anche cifrati, e l'anteprima parla HTTPS con lo stesso certificato", async (t) => {
  const { banco, porta, certificati } = await conHttps(t, false);
  const ca = certificati.ca?.pem ?? "";
  // Il collegamento dei nodi è un WebSocket: si apre in chiaro e cifrato.
  for (const indirizzo of [`ws://127.0.0.1:${porta}${PERCORSO_COLLEGAMENTO}`, `wss://127.0.0.1:${porta}${PERCORSO_COLLEGAMENTO}`]) {
    await new Promise<void>((fatto, fallito) => {
      const presa = new WebSocket(indirizzo, { ca });
      presa.on("open", () => {
        presa.close();
        fatto();
      });
      presa.on("error", fallito);
    });
  }

  const anteprima = await creaServerAnteprima({ accesso: banco.accesso, anteprime: banco.anteprime, tls: { chiave: certificati.chiave, catena: certificati.catena } });
  t.after(() => anteprima.close());
  await anteprima.listen({ host: "127.0.0.1", port: 0 });
  const portaAnteprima = (anteprima.server.address() as AddressInfo).port;
  for (const schema of ["http", "https"] as const) {
    const risposta = await chiedi(schema, portaAnteprima, "/", ca);
    // Senza sessione l'anteprima non mostra nulla, ma risponde: la stretta di mano è andata.
    assert.ok(risposta.stato >= 200 && risposta.stato < 500, `${schema}: ${risposta.stato}`);
  }
});
