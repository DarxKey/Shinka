import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { erroreNelFormato, TelegramDiProva } from "../prove/telegram-di-prova.ts";
import { senzaFormato, testoPerTelegram } from "../protocollo/telegram.ts";
import { Registro } from "./registro.ts";
import { COOKIE_VAULT, creaGateway } from "./servizio.ts";
import { Telegram, TelegramRifiutato } from "./telegram.ts";
import { Operazioni } from "./uso.ts";
import { Vault } from "./vault.ts";

const PROPRIETARIO = { id: 111, nome: "Mario", utente: "mario" };
const ESTRANEO = { id: 222, nome: "Qualcun altro" };

interface Banco {
  finto: TelegramDiProva;
  telegram: Telegram;
  file: string;
  cartella: string;
  /** Riapre il bot dallo stesso file, come dopo un riavvio del gateway. */
  riapri(): Promise<Telegram>;
  /** Sposta in avanti l'orologio del gateway. */
  passano(ms: number): void;
}

async function banco(t: TestContext): Promise<Banco> {
  const finto = await TelegramDiProva.avvia();
  const cartella = await mkdtemp(join(tmpdir(), "shinka-telegram-"));
  const file = join(cartella, "telegram.json");
  let avanti = 0;
  const aperti: Telegram[] = [];
  const riapri = async (): Promise<Telegram> => {
    const telegram = await Telegram.apri({
      file,
      api: finto.indirizzo,
      attesaSecondi: 1,
      pausaMs: () => 20,
      adesso: () => Date.now() + avanti,
    });
    aperti.push(telegram);
    return telegram;
  };
  const telegram = await riapri();
  t.after(async () => {
    for (const aperto of aperti) aperto.ferma();
    await finto.chiudi();
    await rm(cartella, { recursive: true, force: true });
  });
  return { finto, telegram, file, cartella, riapri, passano: (ms) => (avanti += ms) };
}

/** Aspetta che il gateway abbia letto tutto ciò che è stato scritto al bot. */
async function letto(finto: TelegramDiProva): Promise<void> {
  await finto.attendi(() => finto.daConsegnare === 0, 5000, "il gateway legge i messaggi");
}

async function finche(condizione: () => boolean, cosa: string, ms = 5000): Promise<void> {
  const scadenza = Date.now() + ms;
  while (!condizione()) {
    if (Date.now() > scadenza) throw new Error(`Dopo ${ms} ms non è successo: ${cosa}.`);
    await new Promise((fatto) => setTimeout(fatto, 10));
  }
}

async function abbina({ finto, telegram }: Pick<Banco, "finto" | "telegram">): Promise<void> {
  await telegram.imposta(finto.gettone);
  telegram.nuovoCodice();
  const codice = telegram.inVista().codice?.valore;
  assert.ok(codice);
  finto.scrive(PROPRIETARIO, codice);
  await finto.attendi(() => finto.messaggi.length === 1, 5000, "il bot conferma l'abbinamento");
  assert.equal(telegram.stato.condizione, "attivo");
}

test("il token viene provato con Telegram prima di essere tenuto, e non torna mai indietro", async (t) => {
  const { finto, telegram, file } = await banco(t);
  assert.deepEqual(telegram.stato, { condizione: "da-configurare" });
  assert.deepEqual(await telegram.invia({ testo: "ciao" }), { esito: "rifiutato", motivo: "Telegram non è configurato: manca il token del bot." });

  await assert.rejects(telegram.imposta("non è un token"), TelegramRifiutato);
  await assert.rejects(telegram.imposta(`123456:${"A".repeat(35)}`), /non riconosce questo token/);
  assert.equal(existsSync(file), false);

  await telegram.imposta(`  ${finto.gettone}\n`);
  assert.deepEqual(telegram.stato, { condizione: "da-abbinare", bot: "shinka_prova_bot" });
  assert.equal(finto.webhookTolti, 1);
  assert.match(readFileSync(file, "utf8"), new RegExp(finto.gettone));
  // Né lo stato per il centro né ciò che vede il proprietario contengono il token.
  assert.doesNotMatch(JSON.stringify([telegram.stato, telegram.inVista()]), /PROVA_token/);
  assert.equal((await telegram.invia({ testo: "ciao" })).esito, "rifiutato");
});

test("si abbina solo chi manda il codice giusto, e dopo pochi errori il codice non vale più", async (t) => {
  const { finto, telegram } = await banco(t);
  await telegram.imposta(finto.gettone);

  // Senza un codice in corso nessuno viene ascoltato, nemmeno chi sarà il proprietario.
  finto.scrive(PROPRIETARIO, "/start");
  finto.scrive(PROPRIETARIO, "ciao");
  await letto(finto);
  assert.equal(telegram.inVista().ignorati, 2);
  assert.equal(finto.messaggi.length, 0);

  telegram.nuovoCodice();
  const primo = telegram.inVista().codice?.valore;
  assert.match(primo ?? "", /^\d{6}$/);
  const sbagliato = primo === "000000" ? "000001" : "000000";
  for (let volta = 0; volta < 5; volta += 1) finto.scrive(ESTRANEO, sbagliato);
  await letto(finto);
  assert.equal(telegram.inVista().codice, undefined, "dopo cinque errori il codice è annullato");
  finto.scrive(ESTRANEO, primo);
  await letto(finto);
  assert.equal(telegram.stato.condizione, "da-abbinare");

  // Il codice vale per poco.
  telegram.nuovoCodice();
  const secondo = telegram.inVista().codice?.valore ?? "";
  finto.scrive(PROPRIETARIO, `/start ${secondo}`);
  await finto.attendi(() => finto.messaggi.length === 1);
  assert.equal(finto.messaggi[0]?.chat_id, PROPRIETARIO.id);
  assert.match(finto.messaggi[0]?.text ?? "", /ascolto solo te/);
  const vista = telegram.inVista();
  assert.equal(vista.condizione, "attivo");
  assert.equal(vista.proprietario?.id, PROPRIETARIO.id);
  assert.equal(vista.proprietario?.utente, "mario");
  assert.equal(vista.codice, undefined);
  assert.throws(() => telegram.nuovoCodice(), TelegramRifiutato);
});

test("un codice scaduto non abbina nessuno", async (t) => {
  const b = await banco(t);
  await b.telegram.imposta(b.finto.gettone);
  b.telegram.nuovoCodice();
  const codice = b.telegram.inVista().codice?.valore ?? "";
  b.passano(11 * 60 * 1000);
  b.finto.scrive(PROPRIETARIO, codice);
  await letto(b.finto);
  assert.equal(b.telegram.stato.condizione, "da-abbinare");
  assert.equal(b.telegram.inVista().codice, undefined);
});

test("ciò che scrive il proprietario arriva al centro; un altro mittente viene ignorato, senza risposta", async (t) => {
  const b = await banco(t);
  const { finto, telegram } = b;
  await abbina(b);

  finto.scrive(PROPRIETARIO, "Aggiornami sui progetti");
  const primi = await telegram.eventi(0, 3000);
  assert.equal(primi.stato.condizione, "attivo");
  assert.equal(primi.eventi.length, 1);
  const primo = primi.eventi[0];
  assert.ok(primo?.tipo === "messaggio");
  assert.equal(primo.testo, "Aggiornami sui progetti");

  // Un estraneo scrive e preme; il proprietario scrive da un gruppo, dove leggerebbero anche altri.
  finto.scrive(ESTRANEO, "Cancella tutto");
  finto.preme(ESTRANEO, 1, "a:1:s");
  finto.scrive(PROPRIETARIO, "dal gruppo", { id: -500, type: "group" });
  finto.scrive(PROPRIETARIO, "secondo");
  await letto(finto);

  const dopo = await telegram.eventi(primo.n, 3000);
  assert.deepEqual(
    dopo.eventi.map((evento) => (evento.tipo === "messaggio" ? evento.testo : evento.tipo === "pulsante" ? evento.dato : "posizione")),
    ["secondo"],
  );
  assert.equal(telegram.inVista().ignorati, 3);
  // All'estraneo il bot non ha risposto nulla: né un messaggio, né al pulsante.
  assert.equal(finto.messaggi.length, 1);
  assert.equal(finto.risposteAiPulsanti.length, 0);

  // Letto fin qui, non resta nulla: la richiesta aspetta e torna vuota.
  const ultimo = dopo.eventi.at(-1)?.n ?? 0;
  assert.deepEqual((await telegram.eventi(ultimo, 50)).eventi, []);
});

test("ciò che non è testo e il comando di avvio hanno una risposta fissa, e non arrivano al centro", async (t) => {
  const b = await banco(t);
  await abbina(b);
  b.finto.scrive(PROPRIETARIO, undefined);
  b.finto.scrive(PROPRIETARIO, "/start");
  await b.finto.attendi(() => b.finto.messaggi.length === 3);
  assert.match(b.finto.messaggi[1]?.text ?? "", /leggo testo, posizione, documenti, foto, video e audio/);
  assert.match(b.finto.messaggi[2]?.text ?? "", /Sono Shinka/);
  assert.deepEqual((await b.telegram.eventi(0, 0)).eventi, []);
});

test("un pulsante premuto dal proprietario arriva al centro, e il messaggio si può cambiare", async (t) => {
  const b = await banco(t);
  const { finto, telegram } = b;
  await abbina(b);

  const mandato = await telegram.invia({
    testo: `<b>Serve la tua approvazione</b>\n<pre>${testoPerTelegram("docker stop <plex> && echo fatto")}</pre>`,
    html: true,
    pulsanti: [
      [
        { testo: "Approva", dato: "a:abc:s" },
        { testo: "Nega", dato: "a:abc:n" },
      ],
    ],
  });
  assert.ok(mandato.esito === "inviato");
  const messaggio = finto.messaggi.at(-1);
  assert.equal(messaggio?.chat_id, PROPRIETARIO.id);
  assert.equal(messaggio?.parse_mode, "HTML");
  assert.deepEqual(messaggio?.pulsanti, [
    [
      { text: "Approva", callback_data: "a:abc:s" },
      { text: "Nega", callback_data: "a:abc:n" },
    ],
  ]);

  const pressione = finto.preme(PROPRIETARIO, mandato.messaggio, "a:abc:s");
  const { eventi } = await telegram.eventi(0, 3000);
  assert.equal(eventi.length, 1);
  assert.ok(eventi[0]?.tipo === "pulsante");
  assert.equal(eventi[0].dato, "a:abc:s");
  assert.equal(eventi[0].messaggio, mandato.messaggio);
  await finto.attendi(() => finto.risposteAiPulsanti.includes(pressione), 5000, "Telegram riceve la risposta al pulsante");

  assert.deepEqual(await telegram.modifica(mandato.messaggio, { testo: "Approvato da te." }), { esito: "inviato", messaggio: mandato.messaggio });
  assert.equal(messaggio?.text, "Approvato da te.");
  assert.deepEqual(messaggio?.pulsanti, []);
  assert.equal(messaggio?.modifiche, 1);
  // Cambiarlo in ciò che è già non è un errore.
  assert.equal((await telegram.modifica(mandato.messaggio, { testo: "Approvato da te." })).esito, "inviato");
  assert.equal((await telegram.modifica(9999, { testo: "Non c'è." })).esito, "fallito");
});

test("un formato che Telegram non capisce diventa testo nudo; ciò che non si può mandare è rifiutato prima", async (t) => {
  const b = await banco(t);
  const { finto, telegram } = b;
  await abbina(b);

  assert.equal((await telegram.invia({ testo: "<b>aperto e mai chiuso, con 1 < 2", html: true })).esito, "inviato");
  const nudo = finto.messaggi.at(-1);
  assert.equal(nudo?.parse_mode, undefined);
  assert.equal(nudo?.text, "aperto e mai chiuso, con 1 < 2");

  const prima = finto.messaggi.length;
  assert.equal((await telegram.invia({ testo: "x".repeat(4097) })).esito, "rifiutato");
  assert.equal((await telegram.invia({ testo: "   " })).esito, "rifiutato");
  assert.equal((await telegram.invia({ testo: "ok", pulsanti: [[{ testo: "Sì", dato: "d".repeat(65) }]] })).esito, "rifiutato");
  assert.equal(finto.messaggi.length, prima);
  // Con i segni di formato conta ciò che si legge, non ciò che è scritto.
  assert.equal((await telegram.invia({ testo: `<b>${"x".repeat(4096)}</b>`, html: true })).esito, "inviato");

  // Telegram chiede di aspettare: il gateway riprova da sé.
  finto.faiFallire("sendMessage", { error_code: 429, description: "Too Many Requests: retry after 1", parameters: { retry_after: 1 } });
  assert.equal((await telegram.invia({ testo: "dopo l'attesa", silenzioso: true })).esito, "inviato");
  assert.equal(finto.messaggi.at(-1)?.silenzioso, true);

  finto.faiFallire("sendMessage", { error_code: 403, description: "Forbidden: bot was blocked by the user" });
  const bloccato = await telegram.invia({ testo: "non arriva" });
  assert.ok(bloccato.esito === "fallito");
  assert.match(bloccato.motivo, /bloccato il bot/);
});

test("se il centro tace da un po', il proprietario lo viene a sapere subito", async (t) => {
  const b = await banco(t);
  const { finto, telegram } = b;
  await abbina(b);

  b.passano(91_000);
  finto.scrive(PROPRIETARIO, "ci sei?");
  await finto.attendi(() => finto.messaggi.length === 2);
  assert.match(finto.messaggi[1]?.text ?? "", /non risponde/);
  assert.deepEqual((await telegram.eventi(0, 0)).eventi, []);

  // Il centro è tornato a chiedere: i messaggi tornano ad arrivargli.
  finto.scrive(PROPRIETARIO, "e adesso?");
  const { eventi } = await telegram.eventi(0, 3000);
  assert.equal(eventi.length, 1);
  assert.equal(finto.messaggi.length, 2);
});

test("dopo un riavvio il bot ricorda token e proprietario; scollegato non ascolta nessuno; senza token tace", async (t) => {
  const b = await banco(t);
  const { finto, file } = b;
  await abbina(b);
  b.telegram.ferma();

  const riaperto = await b.riapri();
  assert.equal(riaperto.stato.condizione, "attivo");
  assert.equal(riaperto.inVista().proprietario?.id, PROPRIETARIO.id);
  finto.scrive(PROPRIETARIO, "dopo il riavvio");
  assert.equal((await riaperto.eventi(0, 3000)).eventi.length, 1);

  await riaperto.scollega();
  assert.deepEqual(riaperto.stato, { condizione: "da-abbinare", bot: "shinka_prova_bot" });
  finto.scrive(PROPRIETARIO, "mi senti?");
  await letto(finto);
  assert.deepEqual((await riaperto.eventi(0, 0)).eventi, []);
  assert.doesNotMatch(readFileSync(file, "utf8"), /proprietario/);

  await riaperto.rimuovi();
  assert.deepEqual(riaperto.stato, { condizione: "da-configurare" });
  assert.equal(existsSync(file), false);
});

test("se Telegram non riconosce più il token, o un altro programma usa il bot, lo stato lo dice", async (t) => {
  const b = await banco(t);
  const { finto, telegram } = b;
  await abbina(b);

  finto.faiFallire("getUpdates", { error_code: 409, description: "Conflict: terminated by other getUpdates request" });
  await finche(() => telegram.stato.condizione === "errore", "lo stato segnala l'altro programma");
  assert.match(telegram.stato.problema ?? "", /altro programma/);
  // Passato il conflitto, torna attivo da solo.
  await finche(() => telegram.stato.condizione === "attivo", "lo stato torna attivo");

  finto.faiFallire("getUpdates", { error_code: 401, description: "Unauthorized" });
  await finche(() => telegram.stato.condizione === "errore", "lo stato segnala il token");
  assert.match(telegram.stato.problema ?? "", /token/);

  // Riscritto il token, riprende; il proprietario resta lo stesso perché il bot è lo stesso.
  await telegram.imposta(finto.gettone);
  assert.equal(telegram.stato.condizione, "attivo");
  finto.scrive(PROPRIETARIO, "ripreso");
  assert.equal((await telegram.eventi(0, 3000)).eventi.length, 1);
});

test("il Telegram finto rifiuta il formato sbagliato come quello vero", () => {
  assert.equal(erroreNelFormato("<b>bene</b> e <code>a &lt; b</code>"), undefined);
  assert.equal(erroreNelFormato('<a href="https://esempio.it">qui</a>'), undefined);
  assert.match(erroreNelFormato("<b>aperto") ?? "", /can't find end tag/);
  assert.match(erroreNelFormato("1 < 2") ?? "", /unexpected character/);
  assert.match(erroreNelFormato("<table>no</table>") ?? "", /unsupported start tag/);
  assert.match(erroreNelFormato("Tizio & Caio") ?? "", /unexpected character/);
  assert.equal(senzaFormato(`<b>${testoPerTelegram("a < b & c")}</b>`), "a < b & c");
});

// ── Attraverso il servizio del gateway ───────────────────────────────────────

const FRASE = "una frase di sblocco di prova";
const GETTONE = "gettone-di-prova-del-centro-lungo-quanto-serve";
const DEL_CENTRO = { authorization: `Bearer ${GETTONE}` };

test("il centro manda e riceve ma non tocca token né proprietario; quelli sono del proprietario, dopo la frase", async (t) => {
  const b = await banco(t);
  const { finto, telegram, cartella } = b;
  const vault = await Vault.apri(join(cartella, "vault.json"), 2 ** 10);
  const registro = await Registro.apri(join(cartella, "registro.jsonl"));
  const app = await creaGateway({ vault, registro, operazioni: new Operazioni(vault, registro), telegram, gettone: GETTONE });
  t.after(() => app.close());

  // Senza gettone il centro non entra; con il gettone le porte del proprietario restano chiuse.
  assert.equal((await app.inject({ method: "GET", url: "/api/telegram" })).statusCode, 401);
  assert.deepEqual((await app.inject({ method: "GET", url: "/api/telegram", headers: DEL_CENTRO })).json(), { condizione: "da-configurare" });
  for (const url of ["/vault/telegram/gettone", "/vault/telegram/codice", "/vault/telegram/scollegamento", "/vault/telegram/rimozione"]) {
    const risposta = await app.inject({ method: "POST", url, headers: DEL_CENTRO, payload: { gettone: finto.gettone } });
    assert.equal(risposta.statusCode, 401, url);
  }
  assert.equal((await app.inject({ method: "GET", url: "/vault/telegram", headers: DEL_CENTRO })).statusCode, 401);
  assert.equal((await app.inject({ method: "POST", url: "/api/telegram/gettone", headers: DEL_CENTRO, payload: { gettone: finto.gettone } })).statusCode, 404);
  assert.equal(telegram.stato.condizione, "da-configurare");

  // Il proprietario entra con la frase e scrive il token: la risposta non lo ripete.
  const ingresso = await app.inject({ method: "POST", url: "/vault/frase", payload: { frase: FRASE } });
  const sessione = ingresso.cookies.find((cookie) => cookie.name === COOKIE_VAULT);
  assert.ok(sessione);
  const cookies = { [COOKIE_VAULT]: sessione.value };
  const rifiutato = await app.inject({ method: "POST", url: "/vault/telegram/gettone", cookies, payload: { gettone: "sbagliato" } });
  assert.equal(rifiutato.statusCode, 400);
  const scritto = await app.inject({ method: "POST", url: "/vault/telegram/gettone", cookies, payload: { gettone: finto.gettone } });
  assert.equal(scritto.statusCode, 200, scritto.body);
  assert.doesNotMatch(scritto.body, /PROVA_token/);
  assert.equal(scritto.json().condizione, "da-abbinare");

  const conCodice = await app.inject({ method: "POST", url: "/vault/telegram/codice", cookies });
  const codice = conCodice.json().codice.valore as string;
  finto.scrive(PROPRIETARIO, codice);
  await finto.attendi(() => finto.messaggi.length === 1);
  const vista = (await app.inject({ method: "GET", url: "/vault/telegram", cookies })).json();
  assert.equal(vista.condizione, "attivo");
  assert.equal(vista.proprietario.nome, "Mario");
  assert.doesNotMatch(JSON.stringify(vista), /PROVA_token/);
  assert.equal((await app.inject({ method: "POST", url: "/vault/telegram/codice", cookies })).statusCode, 400);

  assert.equal((await app.inject({ method: "POST", url: "/vault/telegram/prova", cookies })).statusCode, 200);
  assert.match(finto.messaggi.at(-1)?.text ?? "", /Prova riuscita/);

  // Il centro manda un messaggio, lo cambia, e legge ciò che il proprietario scrive.
  const mandato = await app.inject({
    method: "POST",
    url: "/api/telegram/messaggi",
    headers: DEL_CENTRO,
    payload: { testo: "<b>Finito</b>", html: true, pulsanti: [[{ testo: "Va bene", dato: "x:1" }]] },
  });
  assert.equal(mandato.json().esito, "inviato");
  const id = mandato.json().messaggio as number;
  const cambiato = await app.inject({ method: "POST", url: `/api/telegram/messaggi/${id}`, headers: DEL_CENTRO, payload: { testo: "Finito, visto." } });
  assert.equal(cambiato.json().esito, "inviato");
  assert.equal(finto.messaggi.at(-1)?.text, "Finito, visto.");
  // Un campo in più, per esempio un altro destinatario, viene tolto: il messaggio va comunque al proprietario.
  await app.inject({ method: "POST", url: "/api/telegram/messaggi", headers: DEL_CENTRO, payload: { testo: "ciao", chat_id: ESTRANEO.id } });
  assert.equal(finto.messaggi.at(-1)?.text, "ciao");
  assert.ok(finto.messaggi.every((messaggio) => messaggio.chat_id === PROPRIETARIO.id));

  finto.scrive(PROPRIETARIO, "ciao centro");
  const eventi = await app.inject({ method: "GET", url: "/api/telegram/eventi?dopo=0&attesa=3", headers: DEL_CENTRO });
  assert.equal(eventi.json().eventi[0].testo, "ciao centro");
  assert.doesNotMatch(eventi.body, /PROVA_token/);
  assert.equal((await app.inject({ method: "POST", url: "/api/telegram/scrive", headers: DEL_CENTRO })).statusCode, 200);
  assert.equal(finto.staScrivendo, 1);

  // Il vault è aperto; richiuso, Telegram continua a funzionare: il token non sta nel vault.
  await app.inject({ method: "POST", url: "/vault/chiusura", cookies });
  assert.equal(vault.condizione, "chiuso");
  const aVaultChiuso = await app.inject({ method: "POST", url: "/api/telegram/messaggi", headers: DEL_CENTRO, payload: { testo: "Il vault è chiuso." } });
  assert.equal(aVaultChiuso.json().esito, "inviato");
  assert.equal((await app.inject({ method: "GET", url: "/vault/telegram", cookies })).statusCode, 401);
});

test("un gateway senza bot dice al centro che Telegram non c'è", async (t) => {
  const cartella = await mkdtemp(join(tmpdir(), "shinka-telegram-"));
  t.after(() => rm(cartella, { recursive: true, force: true }));
  const vault = await Vault.apri(join(cartella, "vault.json"), 2 ** 10);
  const registro = await Registro.apri(join(cartella, "registro.jsonl"));
  const app = await creaGateway({ vault, registro, operazioni: new Operazioni(vault, registro), gettone: GETTONE });
  t.after(() => app.close());
  assert.deepEqual((await app.inject({ method: "GET", url: "/api/telegram/eventi?attesa=5", headers: DEL_CENTRO })).json(), {
    stato: { condizione: "da-configurare" },
    eventi: [],
  });
  assert.equal((await app.inject({ method: "POST", url: "/api/telegram/messaggi", headers: DEL_CENTRO, payload: { testo: "ciao" } })).json().esito, "rifiutato");
});

test("un file arriva al proprietario come documento, un'immagine come foto, e ciò che Telegram non accetta è rifiutato prima", async (t) => {
  const b = await banco(t);
  const { finto, telegram } = b;
  const pdf = Buffer.from("%PDF-1.7\nItinerario dei negozi di carte a Tokyo\n%%EOF\n");
  const fileVero = { nome: "itinerario-tokyo.pdf", tipo: "application/pdf" };

  // Prima dell'abbinamento non parte nulla.
  assert.equal((await telegram.inviaFile(fileVero, pdf)).esito, "rifiutato");
  await abbina(b);

  const documento = await telegram.inviaFile({ ...fileVero, didascalia: "Itinerario del giro a Tokyo" }, pdf);
  assert.equal(documento.esito, "inviato");
  const [arrivato] = finto.file;
  assert.equal(arrivato?.metodo, "sendDocument");
  assert.equal(arrivato?.chat_id, PROPRIETARIO.id);
  assert.equal(arrivato?.nome, "itinerario-tokyo.pdf");
  assert.equal(arrivato?.tipo, "application/pdf");
  assert.deepEqual(arrivato?.contenuto, pdf);
  assert.equal(arrivato?.didascalia, "Itinerario del giro a Tokyo");

  // Un'immagine arriva come foto; una che Telegram non accetta come foto arriva come documento.
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  assert.equal((await telegram.inviaFile({ nome: "mappa.png", tipo: "image/png", comeFoto: true }, png)).esito, "inviato");
  assert.equal(finto.file.at(-1)?.metodo, "sendPhoto");
  assert.equal((await telegram.inviaFile({ nome: "mappa.svg", tipo: "image/svg+xml", comeFoto: true }, Buffer.from("<svg/>"))).esito, "inviato");
  assert.equal(finto.file.at(-1)?.metodo, "sendDocument");
  assert.equal(finto.file.at(-1)?.nome, "mappa.svg");

  // Un nome con le cartelle arriva con il solo nome; un tipo strano diventa generico.
  await telegram.inviaFile({ nome: "tokyo/negozi.csv", tipo: "non un tipo" }, Buffer.from("a,b\n"));
  assert.equal(finto.file.at(-1)?.nome, "negozi.csv");
  assert.equal(finto.file.at(-1)?.tipo, "application/octet-stream");

  // Vuoto, senza nome o oltre i 50 MB: rifiutato senza disturbare Telegram.
  const prima = finto.chiamate.length;
  assert.match((await telegram.inviaFile(fileVero, Buffer.alloc(0))).esito, /rifiutato/);
  assert.equal((await telegram.inviaFile({ nome: "..", tipo: "text/plain" }, pdf)).esito, "rifiutato");
  const enorme = await telegram.inviaFile(fileVero, Buffer.alloc(50 * 1024 * 1024 + 1));
  assert.deepEqual(enorme, { esito: "rifiutato", motivo: "itinerario-tokyo.pdf è troppo grande per Telegram: un bot può mandare file fino a 50 MB." });
  assert.equal(finto.chiamate.length, prima);

  // Un bot fermato dal proprietario lo dice.
  finto.faiFallire("sendDocument", { error_code: 403, description: "Forbidden: bot was blocked by the user" });
  const bloccato = await telegram.inviaFile(fileVero, pdf);
  assert.deepEqual(bloccato, { esito: "fallito", motivo: "Telegram non consegna il file: il proprietario ha fermato o bloccato il bot." });
});

test("il centro manda un file al gateway così com'è, e solo con il suo gettone", async (t) => {
  const b = await banco(t);
  const { finto, telegram, cartella } = b;
  const vault = await Vault.apri(join(cartella, "vault.json"), 2 ** 10);
  const registro = await Registro.apri(join(cartella, "registro.jsonl"));
  const app = await creaGateway({ vault, registro, operazioni: new Operazioni(vault, registro), telegram, gettone: GETTONE });
  t.after(() => app.close());
  await abbina(b);
  const pdf = Buffer.from("%PDF-1.7\nprova\n");
  const url = `/api/telegram/file?nome=${encodeURIComponent("Itinerario Tokyo.pdf")}&tipo=application%2Fpdf&didascalia=${encodeURIComponent("Il giro")}`;
  const headers = { "content-type": "application/octet-stream" };

  assert.equal((await app.inject({ method: "POST", url, headers, payload: pdf })).statusCode, 401);
  assert.equal(finto.file.length, 0);

  const mandato = await app.inject({ method: "POST", url, headers: { ...headers, ...DEL_CENTRO }, payload: pdf });
  assert.equal(mandato.statusCode, 200, mandato.body);
  assert.equal(mandato.json().esito, "inviato");
  assert.equal(finto.file[0]?.nome, "Itinerario Tokyo.pdf");
  assert.equal(finto.file[0]?.didascalia, "Il giro");
  assert.deepEqual(finto.file[0]?.contenuto, pdf);

  // Un file più grande dei messaggi soliti passa: 3 MB.
  const grande = Buffer.alloc(3 * 1024 * 1024, 7);
  const passato = await app.inject({ method: "POST", url: "/api/telegram/file?nome=grande.bin&tipo=application%2Foctet-stream", headers: { ...headers, ...DEL_CENTRO }, payload: grande });
  assert.equal(passato.json().esito, "inviato");
  assert.equal(finto.file[1]?.contenuto.length, grande.length);

  // Senza nome o senza contenuto il gateway non manda nulla.
  const senzaNome = await app.inject({ method: "POST", url: "/api/telegram/file?tipo=application%2Fpdf", headers: { ...headers, ...DEL_CENTRO }, payload: pdf });
  assert.equal(senzaNome.statusCode, 400);
  assert.equal(finto.file.length, 2);
});

test("la posizione del proprietario arriva al centro, anche dal vivo; /posizione mostra il tasto per mandarla", async (t) => {
  const b = await banco(t);
  const { finto, telegram } = b;
  await abbina(b);
  // Il comando compare nel menu del bot.
  await finto.attendi(() => finto.comandi.length === 1, 5000, "il bot mette /posizione nel menu");
  assert.equal(finto.comandi[0]?.command, "posizione");

  // /posizione risponde con il tasto che chiede a Telegram la posizione; al centro non arriva nulla.
  finto.scrive(PROPRIETARIO, "/posizione");
  await finto.attendi(() => finto.messaggi.length === 2, 5000, "il bot mostra il tasto");
  assert.deepEqual(finto.messaggi[1]?.tasti, [[{ text: "📍 Invia la mia posizione", request_location: true }], [{ text: "✖️ Annulla" }]]);
  assert.match(finto.messaggi[1]?.text ?? "", /in tempo reale/);
  assert.equal((await telegram.eventi(0, 0)).eventi.length, 0);

  // Una posizione mandata una volta.
  const presa = Date.parse("2026-11-13T05:32:10.000Z");
  finto.condivide(PROPRIETARIO, 35.68963, 139.6917, { precisione: 18.6, quando: presa });
  const [una] = (await telegram.eventi(0, 3000)).eventi;
  assert.ok(una?.tipo === "posizione");
  assert.deepEqual(una.posizione, { lat: 35.68963, lon: 139.6917, precisioneM: 19, quando: "2026-11-13T05:32:10.000Z" });
  assert.equal(una.aggiornamento, false);

  // Dal vivo: il primo messaggio dice fino a quando, gli spostamenti arrivano come aggiornamenti.
  const inizio = Date.now();
  const id = finto.condivide(PROPRIETARIO, 35.69, 139.7, { durataS: 900, quando: inizio });
  finto.sposta(PROPRIETARIO, id, 35.691, 139.701, 900, inizio);
  await letto(finto);
  const vivi = (await telegram.eventi(una.n, 3000)).eventi;
  assert.equal(vivi.length, 2);
  const [primo, spostato] = vivi;
  assert.ok(primo?.tipo === "posizione" && spostato?.tipo === "posizione");
  assert.equal(primo.posizione.dalVivo, true);
  assert.equal(primo.posizione.finoA, new Date(Math.floor(inizio / 1000) * 1000 + 900_000).toISOString());
  assert.equal(primo.aggiornamento, false);
  assert.equal(spostato.aggiornamento, true);
  assert.equal(spostato.posizione.lat, 35.691);

  // Un testo corretto dopo l'invio non arriva di nuovo al centro; la posizione di un estraneo nemmeno.
  finto.correggi(PROPRIETARIO, 1, "testo corretto");
  finto.condivide(ESTRANEO, 1, 2);
  await letto(finto);
  assert.equal((await telegram.eventi(spostato.n, 0)).eventi.length, 0);
});

test("il pulsante della posizione si toglie: arrivata la posizione, con Annulla, con /nascondi, o con il primo messaggio del bot", async (t) => {
  const b = await banco(t);
  const { finto, telegram } = b;
  await abbina(b);
  const ultimo = () => finto.messaggi.at(-1);
  const mostra = async () => {
    const prima = finto.messaggi.length;
    finto.scrive(PROPRIETARIO, "/posizione");
    await finto.attendi(() => finto.messaggi.length === prima + 1, 5000, "il bot risponde a /posizione");
  };

  // Arrivata la posizione, il bot toglie il pulsante e lo dice.
  await mostra();
  assert.ok(ultimo()?.tasti !== undefined);
  // Chiederlo di nuovo non ne mette un altro.
  await mostra();
  assert.equal(ultimo()?.tasti, undefined);
  assert.match(ultimo()?.text ?? "", /già sotto il campo/);
  finto.condivide(PROPRIETARIO, 35.69, 139.7);
  await finto.attendi(() => ultimo()?.togliTasti === true, 5000, "il bot toglie il pulsante");
  assert.equal(ultimo()?.text, "📍 Posizione ricevuta.");

  // Con Annulla, o con /nascondi: niente arriva al centro.
  const n = (await telegram.eventi(0, 3000)).eventi.at(-1)?.n ?? 0;
  for (const comando of ["✖️ Annulla", "/nascondi"]) {
    await mostra();
    finto.scrive(PROPRIETARIO, comando);
    await finto.attendi(() => ultimo()?.togliTasti === true && ultimo()?.text !== "📍 Posizione ricevuta.", 5000, `${comando} toglie il pulsante`);
    assert.match(ultimo()?.text ?? "", /non c'è più/);
  }
  await letto(finto);
  assert.deepEqual((await telegram.eventi(n, 0)).eventi, []);

  // Qualunque altra cosa: il primo messaggio del bot senza pulsanti suoi lo toglie.
  await mostra();
  finto.scrive(PROPRIETARIO, "Dove mangio?");
  await letto(finto);
  await telegram.invia({ testo: "Ecco tre posti." });
  assert.equal(ultimo()?.togliTasti, true);
  await telegram.invia({ testo: "E un altro." });
  assert.equal(ultimo()?.togliTasti, undefined);
});

test("i file del proprietario arrivano al centro, e il centro ne può scaricare solo questi", async (t) => {
  const b = await banco(t);
  const { finto, telegram } = b;
  await abbina(b);
  const pdf = Buffer.from("%PDF-1.7\nitinerario\n");
  const id = finto.mandaFile(PROPRIETARIO, { come: "document", nome: "Itinerario Tokyo.pdf", mime: "application/pdf", contenuto: pdf }, { didascalia: "Leggilo" });
  finto.mandaFile(PROPRIETARIO, { come: "photo", contenuto: Buffer.from([0xff, 0xd8, 0xff]) }, { gruppo: "album-1" });
  finto.mandaFile(ESTRANEO, { come: "document", nome: "virus.exe", contenuto: Buffer.from("x") });
  finto.mandaFile(PROPRIETARIO, { come: "document", nome: "enorme.zip", contenuto: Buffer.from("x"), dimensione: 21 * 1024 * 1024 });
  await letto(finto);
  const eventi = (await telegram.eventi(0, 3000)).eventi;
  assert.deepEqual(eventi.map((evento) => evento.tipo), ["file", "file"]);
  const [documento, foto] = eventi;
  assert.ok(documento?.tipo === "file" && foto?.tipo === "file");
  assert.deepEqual(documento.file, { id, nome: "Itinerario Tokyo.pdf", mime: "application/pdf", byte: pdf.length });
  assert.equal(documento.didascalia, "Leggilo");
  // Di una foto arriva la misura più grande, con un nome e un tipo.
  assert.match(foto.file.nome, /^foto-\d{8}-\d{6}\.jpg$/);
  assert.equal(foto.file.mime, "image/jpeg");
  assert.equal(foto.gruppo, "album-1");
  assert.doesNotMatch(foto.file.id, /piccola/);
  // Il file troppo grande non arriva: il proprietario sa perché.
  assert.ok(finto.messaggi.some((messaggio) => /enorme\.zip è troppo grande/.test(messaggio.text)));

  assert.deepEqual(await telegram.scaricaFile(id), { dati: pdf });
  assert.ok("problema" in (await telegram.scaricaFile("file-3")), "il file dell'estraneo non si scarica");
  assert.ok("problema" in (await telegram.scaricaFile("inventato")));
});
