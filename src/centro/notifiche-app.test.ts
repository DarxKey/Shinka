import assert from "node:assert/strict";
import { createECDH } from "node:crypto";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { allestisci } from "../prove/banco.ts";
import { COOKIE_SESSIONE } from "./centro.ts";
import { CONTATTO_GENERICO, NotificaRifiutata, NotificheApp } from "./notifiche-app.ts";
import type { EsitoPush } from "./web-push.ts";

/** Un'iscrizione come la darebbe un browser. */
function iscrizione(endpoint = "https://web.push.apple.com/QAbc"): { endpoint: string; keys: { p256dh: string; auth: string } } {
  const browser = createECDH("prime256v1");
  browser.generateKeys();
  return { endpoint, keys: { p256dh: browser.getPublicKey().toString("base64url"), auth: Buffer.alloc(16, 3).toString("base64url") } };
}

test("le iscrizioni restano sul disco con le chiavi del centro; ciò che non è un'iscrizione vera viene rifiutato", () => {
  const file = join(mkdtempSync(join(tmpdir(), "shinka-notifiche-")), "notifiche.json");
  const notifiche = new NotificheApp({ file });
  const { chiave } = notifiche.stato();
  assert.equal(Buffer.from(chiave, "base64url").length, 65);
  assert.equal(notifiche.attive, false);
  assert.equal(notifiche.stato().contatto, CONTATTO_GENERICO);

  const telefono = iscrizione();
  assert.equal(notifiche.iscrivi(telefono, "  iPhone  di casa ").nome, "iPhone di casa");
  // La stessa iscrizione, rinnovata, non fa due dispositivi.
  notifiche.iscrivi(telefono, "iPhone");
  assert.deepEqual(notifiche.stato().dispositivi.map((uno) => uno.nome), ["iPhone"]);
  assert.throws(() => notifiche.iscrivi(iscrizione("https://192.168.1.20/x"), "x"), NotificaRifiutata);
  assert.throws(() => notifiche.iscrivi({ endpoint: telefono.endpoint, keys: { p256dh: "corta", auth: "corta" } }, "x"), NotificaRifiutata);
  assert.throws(() => notifiche.iscrivi("non è un'iscrizione", "x"), NotificaRifiutata);

  // Dopo un riavvio le chiavi sono le stesse: i dispositivi iscritti continuano a valere.
  const dopo = new NotificheApp({ file });
  assert.equal(dopo.stato().chiave, chiave);
  assert.equal(dopo.attive, true);
  assert.equal(statSync(file).mode & 0o077, 0);
  // Nello stato che va alla pagina non c'è la chiave privata.
  assert.ok(!JSON.stringify(dopo.stato()).includes(JSON.parse(readFileSync(file, "utf8")).chiavi.privata.d));

  dopo.impostaContatto("mailto:io@esempio.it");
  assert.equal(dopo.stato().contatto, "mailto:io@esempio.it");
  assert.throws(() => dopo.impostaContatto("telefonami"), NotificaRifiutata);
  dopo.impostaContatto("");
  assert.equal(dopo.stato().contatto, CONTATTO_GENERICO);
  assert.equal(dopo.togli(telefono.endpoint), true);
  assert.equal(dopo.togli(telefono.endpoint), false);
});

test("un avviso parte verso ogni dispositivo, nella misura giusta; un'iscrizione scaduta si toglie, un rifiuto resta scritto", async () => {
  const file = join(mkdtempSync(join(tmpdir(), "shinka-notifiche-")), "notifiche.json");
  const mandati: { endpoint: string; messaggio: string; contatto: string; urgente: boolean | undefined }[] = [];
  let rifiuta = false;
  const notifiche = new NotificheApp({
    file,
    manda: async (a, messaggio, _chiavi, contatto, opzioni): Promise<EsitoPush> => {
      mandati.push({ endpoint: a.endpoint, messaggio, contatto, urgente: opzioni?.urgente });
      if (a.endpoint.endsWith("scaduta")) return { esito: "scaduta" };
      return rifiuta ? { esito: "fallita", motivo: "Il servizio di notifiche ha risposto 403: BadJwtToken" } : { esito: "mandata" };
    },
  });
  notifiche.iscrivi(iscrizione("https://web.push.apple.com/telefono"), "iPhone");
  notifiche.iscrivi(iscrizione("https://fcm.googleapis.com/fcm/send/scaduta"), "Vecchio PC");

  const esiti = await notifiche.manda({ titolo: "Il progetto «Blog»:\n comando da approvare", corpo: "x".repeat(5000), vai: "/progetti/abc", urgente: true, distintivo: 2 });
  assert.deepEqual(esiti.map((uno) => [uno.nome, uno.esito.esito]), [["iPhone", "mandata"], ["Vecchio PC", "scaduta"]]);
  const letto = JSON.parse(mandati[0]?.messaggio ?? "{}") as { titolo: string; corpo: string; vai: string; distintivo: number };
  assert.equal(letto.titolo, "Il progetto «Blog»: comando da approvare");
  assert.ok(Buffer.byteLength(mandati[0]?.messaggio ?? "") < 3000);
  assert.ok(letto.corpo.endsWith("…"));
  assert.equal(letto.vai, "/progetti/abc");
  assert.equal(letto.distintivo, 2);
  assert.equal(mandati[0]?.urgente, true);
  assert.equal(mandati[0]?.contatto, CONTATTO_GENERICO);
  // Quella scaduta non c'è più.
  assert.deepEqual(notifiche.stato().dispositivi.map((uno) => uno.nome), ["iPhone"]);

  rifiuta = true;
  await notifiche.manda({ titolo: "Prova", corpo: "" });
  assert.match(notifiche.stato().dispositivi[0]?.problema ?? "", /BadJwtToken/);
  rifiuta = false;
  await notifiche.manda({ titolo: "Prova", corpo: "" }, "https://web.push.apple.com/telefono");
  assert.equal(notifiche.stato().dispositivi[0]?.problema, undefined);
});

test("dalla pagina: ci si iscrive, si prova, si toglie; senza sessione nulla", async (t) => {
  const banco = await allestisci(t);
  assert.equal((await banco.centro.inject({ method: "GET", url: "/api/notifiche" })).statusCode, 401);
  const cookies = { [COOKIE_SESSIONE]: await banco.entra() };
  const stato = await banco.centro.inject({ method: "GET", url: "/api/notifiche", cookies });
  assert.equal(stato.statusCode, 200);
  assert.deepEqual(stato.json<{ dispositivi: unknown[] }>().dispositivi, []);

  const telefono = iscrizione();
  const iscritto = await banco.centro.inject({ method: "POST", url: "/api/notifiche/iscrizioni", cookies, payload: { iscrizione: telefono, nome: "iPhone" } });
  assert.equal(iscritto.statusCode, 200, iscritto.body);
  const rifiutato = await banco.centro.inject({ method: "POST", url: "/api/notifiche/iscrizioni", cookies, payload: { iscrizione: iscrizione("https://esempio.it/x"), nome: "x" } });
  assert.equal(rifiutato.statusCode, 400);

  const prova = await banco.centro.inject({ method: "POST", url: "/api/notifiche/prova", cookies, payload: { endpoint: telefono.endpoint } });
  assert.deepEqual(prova.json(), { esiti: [{ nome: "iPhone", esito: { esito: "mandata" } }] });
  assert.equal(banco.notificheMandate[0]?.avviso.titolo, "Shinka");

  const tolto = await banco.centro.inject({ method: "POST", url: "/api/notifiche/iscrizioni/rimozione", cookies, payload: { endpoint: telefono.endpoint } });
  assert.deepEqual(tolto.json(), { rimosso: true });
  assert.equal(banco.notifiche.attive, false);
});

test("che cosa arriva dove: le scelte restano sul disco, e su Telegram valgono solo se un dispositivo riceve le notifiche", () => {
  const file = join(mkdtempSync(join(tmpdir(), "shinka-notifiche-")), "notifiche.json");
  const notifiche = new NotificheApp({ file });
  // All'inizio tutto arriva dappertutto.
  assert.equal(notifiche.vuole("telegram", "lavori"), true);
  assert.equal(notifiche.vuole("app", "lavori"), true);

  notifiche.impostaScelte({ telegram: { lavori: false, programmati: false }, app: { richieste: "forse" }, inventato: { x: true } });
  assert.deepEqual(notifiche.stato().scelte, {
    app: { richieste: true, lavori: true, programmati: true },
    telegram: { richieste: true, lavori: false, programmati: false },
  });
  // Senza dispositivi iscritti Telegram riceve tutto lo stesso: il proprietario non resta senza avvisi.
  assert.equal(notifiche.vuole("telegram", "lavori"), true);
  notifiche.iscrivi(iscrizione(), "iPhone");
  assert.equal(notifiche.vuole("telegram", "lavori"), false);
  assert.equal(notifiche.vuole("telegram", "richieste"), true);

  // Una scelta alla volta non tocca le altre, e dopo un riavvio sono quelle.
  notifiche.impostaScelte({ app: { programmati: false } });
  const dopo = new NotificheApp({ file });
  assert.equal(dopo.vuole("app", "programmati"), false);
  assert.equal(dopo.vuole("telegram", "lavori"), false);

  // Un indirizzo email scritto così com'è diventa il contatto.
  assert.equal(dopo.stato().contattoGenerico, true);
  dopo.impostaContatto(" io@esempio.it ");
  assert.equal(dopo.stato().contatto, "mailto:io@esempio.it");
  assert.equal(dopo.stato().contattoGenerico, false);
});
