import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { codiceDiVerifica } from "../protocollo/codice.ts";
import { PERCORSO_COLLEGAMENTO } from "../protocollo/nodi.ts";
import { allestisci, avviaNodo, finche, ID_NODO, PASSWORD, SEGRETO_NODO } from "../prove/banco.ts";
import { COOKIE_SESSIONE } from "./centro.ts";

test("prima dell'accesso lo stato dice configurato ma non autenticato", async (t) => {
  const { centro } = await allestisci(t);
  const risposta = await centro.inject({ method: "GET", url: "/api/stato" });
  assert.deepEqual(risposta.json(), { configurato: true, autenticato: false });
});

test("senza sessione la Home non è raggiungibile", async (t) => {
  const { centro, home } = await allestisci(t);
  const messaggio = await centro.inject({
    method: "POST",
    url: "/api/home/messaggi",
    payload: { testo: "ciao" },
  });
  assert.equal(messaggio.statusCode, 401);
  const eventi = await centro.inject({ method: "GET", url: "/api/home/eventi" });
  assert.equal(eventi.statusCode, 401);
  assert.deepEqual(home.inviati, []);
});

test("con la password sbagliata non si entra", async (t) => {
  const { centro } = await allestisci(t);
  const risposta = await centro.inject({
    method: "POST",
    url: "/api/accesso",
    payload: { password: "password-sbagliata" },
  });
  assert.equal(risposta.statusCode, 401);
  assert.equal(risposta.cookies.length, 0);
});

test("il cookie di sessione non è leggibile dagli script e non esce dal sito", async (t) => {
  const { centro } = await allestisci(t);
  const risposta = await centro.inject({
    method: "POST",
    url: "/api/accesso",
    payload: { password: PASSWORD },
  });
  const cookie = risposta.cookies.find((c) => c.name === COOKIE_SESSIONE);
  assert.equal(cookie?.httpOnly, true);
  assert.equal(cookie?.sameSite, "Strict");
  assert.equal(cookie?.path, "/");
});

test("dopo l'accesso un messaggio arriva alla Home", async (t) => {
  const { centro, home, entra } = await allestisci(t);
  const token = await entra();
  const risposta = await centro.inject({
    method: "POST",
    url: "/api/home/messaggi",
    cookies: { [COOKIE_SESSIONE]: token },
    payload: { testo: "  Che ora è in Giappone?  " },
  });
  assert.equal(risposta.statusCode, 202);
  assert.deepEqual(home.inviati, ["Che ora è in Giappone?"]);
});

test("un messaggio vuoto o malformato viene rifiutato", async (t) => {
  const { centro, home, entra } = await allestisci(t);
  const cookies = { [COOKIE_SESSIONE]: await entra() };
  for (const payload of [{ testo: "   " }, { testo: "" }, {}, { testo: null }]) {
    const risposta = await centro.inject({ method: "POST", url: "/api/home/messaggi", cookies, payload });
    assert.equal(risposta.statusCode, 400, JSON.stringify(payload));
  }
  assert.deepEqual(home.inviati, []);
});

test("la decisione su un permesso arriva alla Home, una volta sola", async (t) => {
  const { centro, home, entra } = await allestisci(t);
  const cookies = { [COOKIE_SESSIONE]: await entra() };
  home.permessiInAttesa.add("toolu_1");

  const prima = await centro.inject({
    method: "POST",
    url: "/api/home/permessi/toolu_1",
    cookies,
    payload: { decisione: "approvato" },
  });
  assert.equal(prima.statusCode, 200);
  assert.deepEqual(home.decisioni, [["toolu_1", "approvato"]]);

  const seconda = await centro.inject({
    method: "POST",
    url: "/api/home/permessi/toolu_1",
    cookies,
    payload: { decisione: "negato" },
  });
  assert.equal(seconda.statusCode, 404);

  const malformata = await centro.inject({
    method: "POST",
    url: "/api/home/permessi/toolu_2",
    cookies,
    payload: { decisione: "forse" },
  });
  assert.equal(malformata.statusCode, 400);
});

test("le risposte alle domande di Claude arrivano alla Home, una volta sola, e una risposta malformata no", async (t) => {
  const { centro, home, entra } = await allestisci(t);
  const cookies = { [COOKIE_SESSIONE]: await entra() };
  home.domandeInAttesa.add("toolu_d");
  const manda = (risposta: unknown, id = "toolu_d") =>
    centro.inject({ method: "POST", url: `/api/home/domande/${id}`, cookies, payload: { risposta } });

  for (const malformata of [{ tipo: "risposte", risposte: [] }, { tipo: "risposte", risposte: ["", "x"] }, { tipo: "forse" }, "si", { tipo: "risposte", risposte: ["a", "b", "c", "d", "e"] }]) {
    assert.equal((await manda(malformata)).statusCode, 400, JSON.stringify(malformata));
  }
  assert.equal((await manda({ tipo: "risposte", risposte: ["Postgres", "Accesso, Ricerca"] })).statusCode, 200);
  assert.deepEqual(home.risposteAlleDomande, [["toolu_d", { tipo: "risposte", risposte: ["Postgres", "Accesso, Ricerca"] }]]);
  assert.equal((await manda({ tipo: "saltate" })).statusCode, 404);
});

test("una richiesta che arriva da un altro sito viene respinta", async (t) => {
  const { centro, home, entra } = await allestisci(t);
  const risposta = await centro.inject({
    method: "POST",
    url: "/api/home/messaggi",
    cookies: { [COOKIE_SESSIONE]: await entra() },
    headers: { origin: "http://altro-sito.example", host: "shinka.local" },
    payload: { testo: "ciao" },
  });
  assert.equal(risposta.statusCode, 403);
  assert.deepEqual(home.inviati, []);
});

test("uscire chiude la sessione", async (t) => {
  const { centro, entra } = await allestisci(t);
  const cookies = { [COOKIE_SESSIONE]: await entra() };
  await centro.inject({ method: "POST", url: "/api/uscita", cookies });
  const dopo = await centro.inject({ method: "POST", url: "/api/home/interrompi", cookies });
  assert.equal(dopo.statusCode, 401);
});

test("le risposte portano le intestazioni di sicurezza", async (t) => {
  const { centro } = await allestisci(t);
  const risposta = await centro.inject({ method: "GET", url: "/api/stato" });
  assert.equal(risposta.headers["x-content-type-options"], "nosniff");
  assert.match(String(risposta.headers["content-security-policy"]), /default-src 'self'/);
  assert.match(String(risposta.headers["content-security-policy"]), /frame-ancestors 'none'/);
});

test("il flusso consegna prima la storia e poi gli eventi nuovi, e prepara la Home", async (t) => {
  const { centro, home, canale, entra } = await allestisci(t);
  const token = await entra();
  canale.pubblica({ tipo: "messaggio-proprietario", id: "a", testo: "ciao" });

  await centro.listen({ host: "127.0.0.1", port: 0 });
  const { port } = centro.server.address() as AddressInfo;
  const controllo = new AbortController();
  t.after(() => controllo.abort());
  const risposta = await fetch(`http://127.0.0.1:${port}/api/home/eventi`, {
    headers: { cookie: `${COOKIE_SESSIONE}=${token}` },
    signal: controllo.signal,
  });
  assert.equal(risposta.status, 200);
  assert.match(risposta.headers.get("content-type") ?? "", /text\/event-stream/);
  assert.ok(risposta.body);

  const lettore = risposta.body.pipeThrough(new TextDecoderStream()).getReader();
  let ricevuto = "";
  const leggiFinche = async (atteso: string): Promise<void> => {
    while (!ricevuto.includes(atteso)) {
      const { value, done } = await lettore.read();
      if (done) throw new Error(`il flusso si è chiuso prima di "${atteso}"`);
      ricevuto += value;
    }
  };

  // La storia si chiude con il suo segnale, così l'interfaccia la mostra tutta insieme.
  await leggiFinche("event: storia");
  assert.ok(ricevuto.indexOf('"testo":"ciao"') < ricevuto.indexOf("event: storia"));
  assert.equal(home.preparazioni, 1);

  canale.pubblica({ tipo: "testo-iniziato", idTesto: "t1" });
  canale.pubblica({ tipo: "testo-frammento", idTesto: "t1", frammento: "Eccomi" });
  await leggiFinche('"frammento":"Eccomi"');
  assert.ok(ricevuto.indexOf("event: storia") < ricevuto.indexOf('"frammento":"Eccomi"'));
  assert.equal(ricevuto.split("event: storia").length, 2, "il segnale arriva una volta sola");

  // Chi si scollega non resta iscritto al canale.
  controllo.abort();
  await lettore.closed.catch(() => {});
});

test("senza sessione gli ambienti non sono raggiungibili", async (t) => {
  const { centro } = await allestisci(t);
  const eventi = await centro.inject({ method: "GET", url: "/api/quadro/eventi" });
  assert.equal(eventi.statusCode, 401);
  const decisione = await centro.inject({
    method: "POST",
    url: `/api/ambienti/richieste/${ID_NODO}`,
    payload: { decisione: "approvato" },
  });
  assert.equal(decisione.statusCode, 401);
  const rimozione = await centro.inject({ method: "POST", url: `/api/ambienti/${ID_NODO}/rimozione` });
  assert.equal(rimozione.statusCode, 401);
});

test("un nodo si collega, aspetta il consenso, diventa attivo e poi risulta spento", async (t) => {
  const banco = await allestisci(t);
  const { centro, ambienti, entra } = banco;
  const cookies = { [COOKIE_SESSIONE]: await entra() };
  const { collegamento, stati } = await avviaNodo(t, banco);

  await finche(() => stati.some((s) => s.stato === "in-attesa"), "il nodo resta in attesa");
  const inAttesa = stati.find((s) => s.stato === "in-attesa");
  const codice = codiceDiVerifica(ID_NODO, SEGRETO_NODO);
  assert.ok(inAttesa?.stato === "in-attesa" && inAttesa.codice === codice);
  assert.deepEqual(ambienti.stato().richieste.map((r) => [r.nome, r.codice]), [["PC Windows", codice]]);

  const approvazione = await centro.inject({
    method: "POST",
    url: `/api/ambienti/richieste/${ID_NODO}`,
    cookies,
    payload: { decisione: "approvato" },
  });
  assert.equal(approvazione.statusCode, 200);
  await finche(() => stati.some((s) => s.stato === "attivo"), "il nodo viene accolto");
  assert.deepEqual(ambienti.stato().ambienti.map((a) => [a.nome, a.attivo]), [
    ["Unraid", true],
    ["PC Windows", true],
  ]);

  collegamento.ferma();
  await finche(() => ambienti.stato().ambienti[1]?.attivo === false, "l'ambiente risulta spento");
});

test("un nodo rifiutato dal proprietario si ferma", async (t) => {
  const banco = await allestisci(t);
  const { centro, ambienti, entra } = banco;
  const cookies = { [COOKIE_SESSIONE]: await entra() };
  const { stati } = await avviaNodo(t, banco);
  await finche(() => stati.some((s) => s.stato === "in-attesa"), "il nodo resta in attesa");

  const rifiuto = await centro.inject({
    method: "POST",
    url: `/api/ambienti/richieste/${ID_NODO}`,
    cookies,
    payload: { decisione: "negato" },
  });
  assert.equal(rifiuto.statusCode, 200);
  await finche(() => stati.some((s) => s.stato === "rifiutato"), "il nodo riceve il rifiuto");
  assert.equal(ambienti.stato().ambienti.length, 1);

  // Dopo un rifiuto il nodo non riprova da solo.
  const quanti = stati.length;
  await new Promise((risolvi) => setTimeout(risolvi, 300));
  assert.equal(stati.slice(quanti).some((s) => s.stato === "collegamento"), false);
});

test("un nodo accettato si ricollega da solo quando il collegamento cade", async (t) => {
  const banco = await allestisci(t);
  const { centro, ambienti, entra } = banco;
  const cookies = { [COOKIE_SESSIONE]: await entra() };
  const { stati } = await avviaNodo(t, banco);
  await finche(() => stati.some((s) => s.stato === "in-attesa"), "il nodo resta in attesa");
  await centro.inject({
    method: "POST",
    url: `/api/ambienti/richieste/${ID_NODO}`,
    cookies,
    payload: { decisione: "approvato" },
  });
  await finche(() => stati.some((s) => s.stato === "attivo"), "il nodo viene accolto");

  // Il centro crede che il nodo taccia da troppo e chiude il collegamento.
  ambienti.controllaSilenzi(Date.now() + 10 * 60 * 1000);
  await finche(() => stati.some((s) => s.stato === "scollegato"), "il nodo si accorge della caduta");
  await finche(
    () => stati.filter((s) => s.stato === "attivo").length === 2,
    "il nodo si ricollega ed è di nuovo attivo",
  );
  assert.equal(ambienti.stato().ambienti[1]?.attivo, true);
});

test("un collegamento che non si presenta come un nodo viene chiuso", async (t) => {
  const { centro, ambienti } = await allestisci(t);
  await centro.listen({ host: "127.0.0.1", port: 0 });
  const { port } = centro.server.address() as AddressInfo;
  const socket = new WebSocket(`ws://127.0.0.1:${port}${PERCORSO_COLLEGAMENTO}`);
  const chiuso = new Promise<void>((risolvi) => socket.addEventListener("close", () => risolvi()));
  socket.addEventListener("open", () => socket.send("ciao, sono un nodo"));
  await chiuso;
  assert.deepEqual(ambienti.stato().richieste, []);
});

test("il flusso del quadro consegna lo stato degli ambienti e i suoi cambiamenti", async (t) => {
  const banco = await allestisci(t);
  const { centro, entra } = banco;
  const token = await entra();
  const { stati } = await avviaNodo(t, banco);
  await finche(() => stati.some((s) => s.stato === "in-attesa"), "il nodo resta in attesa");

  const { port } = centro.server.address() as AddressInfo;
  const controllo = new AbortController();
  t.after(() => controllo.abort());
  const risposta = await fetch(`http://127.0.0.1:${port}/api/quadro/eventi`, {
    headers: { cookie: `${COOKIE_SESSIONE}=${token}` },
    signal: controllo.signal,
  });
  assert.equal(risposta.status, 200);
  assert.ok(risposta.body);
  const lettore = risposta.body.pipeThrough(new TextDecoderStream()).getReader();
  let ricevuto = "";
  while (!ricevuto.includes('"richieste":[{')) {
    const { value, done } = await lettore.read();
    if (done) throw new Error("il flusso si è chiuso troppo presto");
    ricevuto += value;
  }
  assert.match(ricevuto, /"nome":"PC Windows"/);
  // Nello stesso flusso viaggiano ambienti e progetti, ciascuno con il suo nome.
  assert.match(ricevuto, /event: ambienti\ndata: \{"ambienti":\[/);
  assert.match(ricevuto, /event: progetti\ndata: \{"progetti":\[\]\}/);

  await centro.inject({
    method: "POST",
    url: `/api/ambienti/richieste/${ID_NODO}`,
    cookies: { [COOKIE_SESSIONE]: token },
    payload: { decisione: "approvato" },
  });
  while (!ricevuto.includes('"richieste":[]},') && !/"attivo":true,"delCentro":false/.test(ricevuto)) {
    const { value, done } = await lettore.read();
    if (done) throw new Error("il flusso si è chiuso troppo presto");
    ricevuto += value;
  }
  assert.match(ricevuto, /"attivo":true,"delCentro":false/);
  controllo.abort();
  await lettore.closed.catch(() => {});
});
