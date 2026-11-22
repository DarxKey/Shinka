import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { TelegramDiProva } from "../prove/telegram-di-prova.ts";
import { PREFISSO_PULSANTE_DEL_GATEWAY } from "../protocollo/telegram.ts";
import { DOMANDE_APERTE, DomandeAlProprietario, type DaChiedere } from "./domande.ts";
import { Telegram } from "./telegram.ts";

const PROPRIETARIO = { id: 111, nome: "Mario", utente: "mario" };
const ESTRANEO = { id: 222, nome: "Qualcun altro" };

const DOMANDA: DaChiedere = {
  tipo: "comando",
  titolo: "Eseguire questo comando sul server?",
  testo: "docker restart shinka",
  si: "Esegui",
  attesaMs: 60_000,
};

/** Un bot finto già abbinato al proprietario, e le domande del gateway che passano da lì. */
async function conTelegram(t: TestContext) {
  const finto = await TelegramDiProva.avvia();
  const cartella = await mkdtemp(join(tmpdir(), "shinka-domande-"));
  const telegram = await Telegram.apri({ file: join(cartella, "telegram.json"), api: finto.indirizzo, attesaSecondi: 1, pausaMs: () => 20 });
  const domande = new DomandeAlProprietario({ telegram });
  t.after(async () => {
    domande.ferma();
    telegram.ferma();
    await finto.chiudi();
    await rm(cartella, { recursive: true, force: true });
  });
  await telegram.imposta(finto.gettone);
  telegram.nuovoCodice();
  finto.scrive(PROPRIETARIO, telegram.inVista().codice?.valore ?? "");
  await finto.attendi(() => finto.messaggi.length === 1, 5000, "il bot conferma l'abbinamento");
  return { finto, telegram, domande };
}

test("il sì vale solo se lo dà il proprietario: il centro può ritirare una domanda, mai approvarla", async () => {
  const domande = new DomandeAlProprietario();
  const prima = domande.chiedi(DOMANDA);
  assert.deepEqual(
    domande.inVista().map(({ id, tipo, titolo, testo, si }) => ({ id, tipo, titolo, testo, si })),
    [{ id: prima.id, tipo: "comando", titolo: DOMANDA.titolo, testo: DOMANDA.testo, si: "Esegui" }],
  );

  // Il centro non può dire di sì, né far scadere una domanda prima del tempo.
  assert.equal(domande.decidi(prima.id, "approvata", "centro"), false);
  assert.equal(domande.decidi(prima.id, "approvata", "tempo"), false);
  assert.equal(domande.decidi(prima.id, "scaduta", "centro"), false);
  assert.equal(domande.inVista().length, 1);

  // Dalla pagina del vault sì, e una volta sola.
  assert.equal(domande.decidi(prima.id, "approvata", "pagina"), true);
  assert.equal(await prima.decisa, "approvata");
  assert.equal(domande.decidi(prima.id, "negata", "pagina"), false);
  assert.equal(domande.inVista().length, 0);

  // Il centro può ritirarne una: vale come un no.
  const seconda = domande.chiedi(DOMANDA);
  assert.notEqual(seconda.id, prima.id);
  assert.equal(domande.decidi(seconda.id, "negata", "centro"), true);
  assert.equal(await seconda.decisa, "negata");
  assert.equal(domande.decidi("non-esiste", "negata", "pagina"), false);
});

test("una domanda senza risposta scade, e allo spegnimento quelle aperte finiscono senza un sì", async () => {
  const domande = new DomandeAlProprietario();
  const breve = domande.chiedi({ ...DOMANDA, attesaMs: 30 });
  assert.equal(await breve.decisa, "scaduta");
  assert.equal(domande.inVista().length, 0);

  const aperte = Array.from({ length: DOMANDE_APERTE }, () => domande.chiedi(DOMANDA));
  assert.equal(domande.cePosto, false);
  domande.ferma();
  assert.deepEqual([...new Set(await Promise.all(aperte.map((aperta) => aperta.decisa)))], ["scaduta"]);
  assert.equal(domande.cePosto, true);
});

test("su Telegram la domanda arriva dal gateway, e il pulsante premuto non passa dal centro", async (t) => {
  const { finto, telegram, domande } = await conTelegram(t);
  const fatta = domande.chiedi(DOMANDA);
  await finto.attendi(() => finto.messaggi.length === 2, 5000, "il gateway manda la domanda");
  const messaggio = finto.messaggi[1];
  assert.ok(messaggio);
  assert.equal(messaggio.chat_id, PROPRIETARIO.id);
  assert.match(messaggio.text, /Eseguire questo comando sul server\?\n\ndocker restart shinka\n\nLo chiede il gateway/);
  assert.deepEqual(messaggio.pulsanti, [
    [
      { text: "Esegui", callback_data: `${PREFISSO_PULSANTE_DEL_GATEWAY}${fatta.id}:s` },
      { text: "No", callback_data: `${PREFISSO_PULSANTE_DEL_GATEWAY}${fatta.id}:n` },
    ],
  ]);

  // Un estraneo che preme non conta; nemmeno il proprietario, se preme sotto un altro messaggio.
  finto.preme(ESTRANEO, messaggio.message_id, `${PREFISSO_PULSANTE_DEL_GATEWAY}${fatta.id}:s`);
  finto.preme(PROPRIETARIO, 1, `${PREFISSO_PULSANTE_DEL_GATEWAY}${fatta.id}:s`);
  await finto.attendi(() => finto.daConsegnare === 0, 5000, "il gateway legge le pressioni");
  assert.equal(domande.inVista().length, 1);

  const pressione = finto.preme(PROPRIETARIO, messaggio.message_id, `${PREFISSO_PULSANTE_DEL_GATEWAY}${fatta.id}:s`);
  assert.equal(await fatta.decisa, "approvata");
  await finto.attendi(() => finto.risposteAiPulsanti.includes(pressione) && messaggio.modifiche === 1, 5000, "il messaggio dice com'è finita");
  assert.match(messaggio.text, /docker restart shinka\n\n✅ Hai detto di sì\.$/);
  assert.deepEqual(messaggio.pulsanti, []);

  // Al centro, che legge ciò che arriva da Telegram, di tutto questo non è arrivato nulla.
  assert.deepEqual((await telegram.eventi(0, 200)).eventi, []);

  // Il pulsante di una domanda che non c'è più non promette nulla.
  finto.preme(PROPRIETARIO, messaggio.message_id, `${PREFISSO_PULSANTE_DEL_GATEWAY}${fatta.id}:s`);
  await finto.attendi(() => messaggio.modifiche === 2, 5000, "il messaggio dice che non vale più");
  assert.match(messaggio.text, /non vale più/);
});

test("il centro non può creare i pulsanti del gateway, né riscrivere i suoi messaggi", async (t) => {
  const { finto, telegram, domande } = await conTelegram(t);
  const fatta = domande.chiedi(DOMANDA);
  await finto.attendi(() => finto.messaggi.length === 2, 5000, "il gateway manda la domanda");
  const messaggio = finto.messaggi[1];
  assert.ok(messaggio);
  const dato = `${PREFISSO_PULSANTE_DEL_GATEWAY}${fatta.id}:s`;

  // Un messaggio del centro con il pulsante del sì: rifiutato, e non parte.
  const finta = await telegram.invia({ testo: "Premi qui", pulsanti: [[{ testo: "Va bene", dato }]] });
  assert.equal(finta.esito, "rifiutato");
  assert.equal(finto.messaggi.length, 2);

  // Il centro manda un messaggio suo, e poi prova a metterci il pulsante del gateway: no.
  const suo = await telegram.invia({ testo: "Un messaggio del centro" });
  assert.ok(suo.esito === "inviato");
  assert.equal((await telegram.modifica(suo.messaggio, { testo: "Premi qui", pulsanti: [[{ testo: "Va bene", dato }]] })).esito, "rifiutato");
  // Nemmeno può cambiare il testo sopra i pulsanti del gateway.
  assert.equal((await telegram.modifica(messaggio.message_id, { testo: "Aggiornare l'orologio?" })).esito, "rifiutato");
  assert.equal(messaggio.modifiche, 0);

  // Il sì premuto sotto il messaggio del centro non vale: non è quello della domanda.
  finto.preme(PROPRIETARIO, suo.messaggio, dato);
  await finto.attendi(() => finto.daConsegnare === 0, 5000, "il gateway legge la pressione");
  assert.equal(domande.inVista().length, 1);

  finto.preme(PROPRIETARIO, messaggio.message_id, `${PREFISSO_PULSANTE_DEL_GATEWAY}${fatta.id}:n`);
  assert.equal(await fatta.decisa, "negata");
});

test("se il testo non sta per intero su Telegram, lì il sì non c'è: si decide dalla pagina del vault", async (t) => {
  const { finto, domande } = await conTelegram(t);
  const fatta = domande.chiedi({ ...DOMANDA, testo: "riga di un comando molto lungo\n".repeat(200) });
  await finto.attendi(() => finto.messaggi.length === 2, 5000, "il gateway manda la domanda");
  const messaggio = finto.messaggi[1];
  assert.ok(messaggio);
  assert.match(messaggio.text, /troppo lungo per Telegram/);
  assert.deepEqual(messaggio.pulsanti, [[{ text: "No", callback_data: `${PREFISSO_PULSANTE_DEL_GATEWAY}${fatta.id}:n` }]]);

  // Un sì arrivato lo stesso da Telegram non conta.
  finto.preme(PROPRIETARIO, messaggio.message_id, `${PREFISSO_PULSANTE_DEL_GATEWAY}${fatta.id}:s`);
  await finto.attendi(() => finto.daConsegnare === 0, 5000, "il gateway legge la pressione");
  assert.equal(domande.inVista().length, 1);
  assert.equal(domande.decidi(fatta.id, "approvata", "pagina"), true);
  assert.equal(await fatta.decisa, "approvata");
});
