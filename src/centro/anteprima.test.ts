import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test, type TestContext } from "node:test";
import { avviaApplicazione, portaLibera } from "../prove/applicazione-di-prova.ts";
import { allestisci, avviaNodoAccettato, finche, ID_NODO, usaStrumento, type Banco } from "../prove/banco.ts";
import { leggiComandoAnteprima, leggiRiferitoAnteprima, percorsoValido, portaValida, type StatoAnteprima } from "../protocollo/anteprima.ts";
import { COOKIE_SESSIONE, politicaContenuti } from "./centro.ts";
import { creaServerAnteprima } from "./server-anteprima.ts";

/** Avvia la porta dell'anteprima del centro in prova e restituisce il suo indirizzo. */
async function avviaAnteprima(t: TestContext, banco: Banco): Promise<string> {
  const server = await creaServerAnteprima({ accesso: banco.accesso, anteprime: banco.anteprime });
  await server.listen({ host: "127.0.0.1", port: 0 });
  t.after(() => server.close());
  return `http://127.0.0.1:${(server.server.address() as AddressInfo).port}`;
}

async function chiama(banco: Banco, url: string, corpo: unknown = {}): Promise<{ stato: number; dati: Record<string, unknown> }> {
  const risposta = await banco.centro.inject({
    method: "POST",
    url,
    cookies: { [COOKIE_SESSIONE]: await banco.entra() },
    payload: corpo as Record<string, unknown>,
  });
  return { stato: risposta.statusCode, dati: risposta.json() };
}

test("il proprietario vede l'applicazione del progetto attraverso la porta dell'anteprima", async (t) => {
  const banco = await allestisci(t);
  const applicazione = await avviaApplicazione(t);
  const anteprima = await avviaAnteprima(t, banco);
  const progetto = await banco.lavori.crea("Sito", "centro", "Un sito.");
  const sessione = `${COOKIE_SESSIONE}=${await banco.entra()}`;

  const stati: StatoAnteprima[] = [];
  t.after(banco.anteprime.iscrivi((stato) => stati.push(stato)));
  assert.equal(stati[0]?.aperta, undefined);

  const aperta = await chiama(banco, `/api/progetti/${progetto.id}/anteprima`, { porta: applicazione.porta });
  assert.equal(aperta.stato, 200);
  assert.deepEqual(stati.at(-1)?.aperta, { idProgetto: progetto.id, porta: applicazione.porta, percorso: "/" });

  const pagina = await fetch(`${anteprima}/`, {
    headers: { cookie: `${sessione}; tema=scuro`, "if-none-match": '"uno"', "if-modified-since": new Date().toUTCString() },
  });
  assert.equal(pagina.status, 200);
  assert.match(await pagina.text(), /Applicazione di prova/);
  assert.match(pagina.headers.get("content-type") ?? "", /text\/html/);
  // L'applicazione sta in un riquadro di Shinka: i suoi divieti di starci non valgono.
  assert.equal(pagina.headers.get("x-frame-options"), null);
  assert.equal(pagina.headers.get("content-security-policy"), "default-src 'self'");
  // Su questa porta passano applicazioni diverse: il browser non ne conserva le pagine, e l'applicazione
  // non si sente chiedere "è cambiata?" a proposito di una copia che potrebbe essere di un'altra.
  assert.equal(pagina.headers.get("cache-control"), "no-store");
  assert.equal(applicazione.richieste.at(-1)?.intestazioni["if-none-match"], undefined);
  assert.equal(applicazione.richieste.at(-1)?.intestazioni["if-modified-since"], undefined);
  // I suoi cookie arrivano al browser, ma non può scrivere quelli di Shinka: né la sessione né il vault.
  assert.deepEqual(pagina.headers.getSetCookie(), ["sessione-app=uno; Path=/"]);

  // L'applicazione non vede la sessione di Shinka, e crede di essere chiamata su localhost.
  const eco = await fetch(`${anteprima}/eco?x=1`, {
    method: "POST",
    // Sullo stesso host, a un'altra porta, c'è anche la pagina del vault: nemmeno il suo cookie passa.
    headers: { cookie: `${sessione}; tema=scuro; shinka_vault=aperto`, "content-type": "application/json", origin: anteprima },
    body: JSON.stringify({ saluto: "ciao" }),
  });
  assert.deepEqual(await eco.json(), {
    corpo: { saluto: "ciao" },
    cookie: "tema=scuro",
    host: `localhost:${applicazione.porta}`,
    origine: `http://localhost:${applicazione.porta}`,
  });
  assert.equal(applicazione.richieste.at(-1)?.percorso, "/eco?x=1");

  // Un rinvio verso l'applicazione stessa resta dentro l'anteprima.
  const rinvio = await fetch(`${anteprima}/vai`, { headers: { cookie: sessione }, redirect: "manual" });
  assert.equal(rinvio.status, 302);
  assert.equal(rinvio.headers.get("location"), "/arrivo?da=vai");

  // Una risposta grande arriva intera, a pezzi.
  const grande = await fetch(`${anteprima}/grande`, { headers: { cookie: sessione } });
  assert.equal((await grande.text()).length, 700_000);

  // Una pagina che l'applicazione non ha resta un suo 404, non un errore di Shinka.
  assert.equal((await fetch(`${anteprima}/non-esiste`, { headers: { cookie: sessione } })).status, 404);

  // Chiusa l'anteprima, da quella porta non si vede più nulla.
  assert.deepEqual((await chiama(banco, `/api/progetti/${progetto.id}/anteprima/chiusura`)).dati, { chiusa: true });
  assert.equal(stati.at(-1)?.aperta, undefined);
  const dopo = await fetch(`${anteprima}/`, { headers: { cookie: sessione } });
  assert.equal(dopo.status, 404);
  assert.match(await dopo.text(), /nessuna anteprima aperta/);
});

test("l'anteprima si vede solo con la sessione del proprietario", async (t) => {
  const banco = await allestisci(t);
  const applicazione = await avviaApplicazione(t);
  const anteprima = await avviaAnteprima(t, banco);
  const progetto = await banco.lavori.crea("Sito", "centro", "Un sito.");
  assert.equal((await chiama(banco, `/api/progetti/${progetto.id}/anteprima`, { porta: applicazione.porta })).stato, 200);
  const prima = applicazione.richieste.length;

  const senza = await fetch(`${anteprima}/`);
  assert.equal(senza.status, 401);
  assert.match(await senza.text(), /entra prima in Shinka/);
  const falsa = await fetch(`${anteprima}/eco`, { method: "POST", headers: { cookie: `${COOKIE_SESSIONE}=inventata` }, body: "x" });
  assert.equal(falsa.status, 401);
  assert.equal(applicazione.richieste.length, prima);

  // Senza sessione non si apre nemmeno dall'interfaccia.
  const daFuori = await banco.centro.inject({
    method: "POST",
    url: `/api/progetti/${progetto.id}/anteprima`,
    payload: { porta: applicazione.porta },
  });
  assert.equal(daFuori.statusCode, 401);
});

test("l'anteprima non si apre se sulla porta non risponde nulla, e dice perché", async (t) => {
  const banco = await allestisci(t, { porteRiservate: [7850, 7852] });
  const progetto = await banco.lavori.crea("Sito", "centro", "Un sito.");
  const spenta = await portaLibera();

  const nulla = await chiama(banco, `/api/progetti/${progetto.id}/anteprima`, { porta: spenta });
  assert.equal(nulla.stato, 409);
  assert.match(String(nulla.dati.errore), new RegExp(`Sulla porta ${spenta} di questo ambiente non risponde nulla`));
  assert.equal(banco.anteprime.stato().aperta, undefined);

  // Le porte di Shinka non sono l'applicazione del progetto.
  const riservata = await chiama(banco, `/api/progetti/${progetto.id}/anteprima`, { porta: 7850 });
  assert.equal(riservata.stato, 409);
  assert.match(String(riservata.dati.errore), /è di Shinka/);

  assert.equal((await chiama(banco, `/api/progetti/${progetto.id}/anteprima`, { porta: 70_000 })).stato, 409);
  assert.equal((await chiama(banco, `/api/progetti/${progetto.id}/anteprima`, { porta: spenta, percorso: "//altrove.example" })).stato, 409);
  assert.equal((await chiama(banco, "/api/progetti/non-esiste/anteprima", { porta: spenta })).stato, 409);
  assert.equal((await chiama(banco, `/api/progetti/${progetto.id}/anteprima`, { porta: "tremila" })).stato, 400);
});

test("l'anteprima aperta è una sola: aprirne un'altra prende il suo posto", async (t) => {
  const banco = await allestisci(t);
  const prima = await avviaApplicazione(t);
  const seconda = await avviaApplicazione(t);
  const anteprima = await avviaAnteprima(t, banco);
  const sito = await banco.lavori.crea("Sito", "centro", "Un sito.");
  const gioco = await banco.lavori.crea("Gioco", "centro", "Un gioco.");
  const sessione = `${COOKIE_SESSIONE}=${await banco.entra()}`;

  assert.equal((await chiama(banco, `/api/progetti/${sito.id}/anteprima`, { porta: prima.porta })).stato, 200);
  assert.equal((await chiama(banco, `/api/progetti/${gioco.id}/anteprima`, { porta: seconda.porta, percorso: "/grande" })).stato, 200);
  assert.deepEqual(banco.anteprime.stato().aperta, { idProgetto: gioco.id, porta: seconda.porta, percorso: "/grande" });

  await fetch(`${anteprima}/`, { headers: { cookie: sessione } });
  assert.equal(prima.richieste.filter((r) => r.percorso === "/" && r.intestazioni.cookie === undefined).length, 1, "solo la sonda");
  assert.ok(seconda.richieste.length >= 2);

  // Chiudere quella di un altro progetto non tocca quella aperta.
  assert.deepEqual((await chiama(banco, `/api/progetti/${sito.id}/anteprima/chiusura`)).dati, { chiusa: false });
  assert.equal(banco.anteprime.stato().aperta?.idProgetto, gioco.id);
});

test("i WebSocket dell'applicazione passano dall'anteprima", async (t) => {
  const banco = await allestisci(t);
  const applicazione = await avviaApplicazione(t);
  const anteprima = await avviaAnteprima(t, banco);
  const progetto = await banco.lavori.crea("Sito", "centro", "Un sito.");
  assert.equal((await chiama(banco, `/api/progetti/${progetto.id}/anteprima`, { porta: applicazione.porta })).stato, 200);

  const Socket = WebSocket as unknown as new (indirizzo: string, opzioni: { headers: Record<string, string> }) => WebSocket;
  const socket = new Socket(`${anteprima.replace("http", "ws")}/ws?token=abc`, {
    headers: { cookie: `${COOKIE_SESSIONE}=${await banco.entra()}` },
  });
  socket.binaryType = "arraybuffer";
  t.after(() => socket.close());
  const arrivati: unknown[] = [];
  socket.addEventListener("message", (evento) => arrivati.push(evento.data));
  // Scritto appena aperto, prima che il collegamento con l'applicazione sia pronto: resta in coda.
  socket.addEventListener("open", () => socket.send("subito"));
  await finche(() => arrivati.length === 1, "l'applicazione risponde");
  assert.equal(arrivati[0], "eco: subito");
  assert.equal(applicazione.richieste.at(-1)?.percorso, "/ws?token=abc");
  assert.equal(applicazione.richieste.at(-1)?.intestazioni.cookie, undefined);

  socket.send(new Uint8Array([1, 2, 3]));
  await finche(() => arrivati.length === 2, "anche i dati binari tornano");
  assert.deepEqual([...new Uint8Array(arrivati[1] as ArrayBuffer)], [1, 2, 3]);

  // Chiusa l'anteprima, il WebSocket si chiude.
  let chiuso = false;
  socket.addEventListener("close", () => (chiuso = true));
  banco.anteprime.chiudi(progetto.id);
  await finche(() => chiuso, "il WebSocket si chiude con l'anteprima");

  // Senza sessione non si apre.
  const senza = new WebSocket(`${anteprima.replace("http", "ws")}/ws`);
  let codice: number | undefined;
  senza.addEventListener("close", (evento) => (codice = evento.code));
  senza.addEventListener("error", () => {});
  await finche(() => codice !== undefined, "il collegamento senza sessione viene chiuso");
  assert.equal(codice, 1008);
});

test("l'anteprima di un progetto su un nodo passa dal nodo, e cade se l'ambiente si scollega", async (t) => {
  const banco = await allestisci(t);
  const nodo = await avviaNodoAccettato(t, banco);
  const applicazione = await avviaApplicazione(t);
  const anteprima = await avviaAnteprima(t, banco);
  const progetto = await banco.lavori.crea("Videogioco", ID_NODO, "Un gioco.");
  const sessione = `${COOKIE_SESSIONE}=${await banco.entra()}`;

  assert.equal((await chiama(banco, `/api/progetti/${progetto.id}/anteprima`, { porta: applicazione.porta })).stato, 200);
  const pagina = await fetch(`${anteprima}/`, { headers: { cookie: sessione } });
  assert.equal(pagina.status, 200);
  assert.match(await pagina.text(), /Applicazione di prova/);
  const grande = await fetch(`${anteprima}/grande`, { headers: { cookie: sessione } });
  assert.equal((await grande.text()).length, 700_000);

  nodo.collegamento.ferma();
  await finche(() => !banco.ambienti.attivo(ID_NODO), "l'ambiente risulta spento");
  const dopo = await fetch(`${anteprima}/`, { headers: { cookie: sessione } });
  assert.equal(dopo.status, 502);
  assert.match(await dopo.text(), /ambiente del progetto è spento/);
  const riaperta = await chiama(banco, `/api/progetti/${progetto.id}/anteprima`, { porta: applicazione.porta });
  assert.equal(riaperta.stato, 409);
  assert.match(String(riaperta.dati.errore), /ambiente del progetto è spento/);
});

test("Claude propone l'anteprima solo dal progetto e solo se l'applicazione risponde", async (t) => {
  const banco = await allestisci(t);
  const nodo = await avviaNodoAccettato(t, banco);
  const applicazione = await avviaApplicazione(t);
  const progetto = await banco.lavori.crea("Videogioco", ID_NODO, "Un gioco.");
  await finche(() => nodo.conversazioni.length === 1, "la conversazione del progetto nasce sul nodo");
  const conversazione = nodo.conversazioni[0];
  assert.ok(conversazione);
  // Proporre non chiede consenso: ad aprire è il proprietario.
  assert.ok(conversazione.configurazione?.strumentiSenzaRichiesta?.includes("mcp__shinka__proponi_anteprima"));
  assert.match(conversazione.configurazione?.istruzioniAggiunte ?? "", /proponi_anteprima/);

  const proposta = await usaStrumento(conversazione, "proponi_anteprima", { porta: applicazione.porta });
  assert.equal(proposta.errore, false);
  assert.match(proposta.testo, /Anteprima proposta/);
  // Proporre non apre nulla.
  assert.equal(banco.anteprime.stato().aperta, undefined);

  const spenta = await portaLibera();
  const fallita = await usaStrumento(conversazione, "proponi_anteprima", { porta: spenta });
  assert.equal(fallita.errore, true);
  assert.match(fallita.testo, /non risponde nulla/);
  assert.match(fallita.testo, /avviala/);

  // Nella Home lo strumento non c'è, e se arrivasse comunque verrebbe rifiutato.
  const dallaHome = await banco.comuniDellaHome("proponi_anteprima", { porta: applicazione.porta });
  assert.equal(dallaHome.errore, true);
  assert.match(dallaHome.testo, /solo nei progetti/);
  assert.equal(progetto.idAmbiente, ID_NODO);
});

test("dove l'anteprima non è accesa, lo dice a chi prova ad aprirla e a Claude", async (t) => {
  const banco = await allestisci(t, { portaAnteprima: null });
  const applicazione = await avviaApplicazione(t);
  const progetto = await banco.lavori.crea("Sito", "centro", "Un sito.");
  assert.equal(banco.anteprime.stato().porta, null);
  const aperta = await chiama(banco, `/api/progetti/${progetto.id}/anteprima`, { porta: applicazione.porta });
  assert.equal(aperta.stato, 409);
  assert.match(String(aperta.dati.errore), /non è accesa/);
  const conversazione = banco.conversazioniLocali[0];
  assert.ok(conversazione);
  const proposta = await usaStrumento(conversazione, "proponi_anteprima", { porta: applicazione.porta });
  assert.equal(proposta.errore, true);
});

test("l'interfaccia ammette in un riquadro solo sé stessa, per gli elaborati, e la porta dell'anteprima dello stesso host", () => {
  const politica = politicaContenuti("192.168.1.20:7850", 7852);
  assert.match(politica, /frame-src 'self' 192\.168\.1\.20:7852;/);
  assert.match(politica, /connect-src 'self' ws:\/\/192\.168\.1\.20:7850 wss:\/\/192\.168\.1\.20:7850;/);
  assert.match(politica, /frame-ancestors 'none'/);
  assert.match(politicaContenuti("[fd00::1]:7850", 7852), /frame-src 'self' \[fd00::1\]:7852;/);
  assert.match(politicaContenuti("shinka.casa", 7852), /frame-src 'self' shinka\.casa:7852;/);
  // Senza anteprima, o con un host scritto in modo strano, nessun riquadro oltre agli elaborati.
  assert.match(politicaContenuti("192.168.1.20:7850", null), /frame-src 'self';/);
  const strana = politicaContenuti("a.example; script-src *", 7852);
  assert.match(strana, /frame-src 'self';/);
  assert.match(strana, /connect-src 'self';/);
  assert.doesNotMatch(strana, /script-src/);
  assert.match(politicaContenuti(undefined, 7852), /frame-src 'self';/);
});

test("i messaggi dell'anteprima scritti male non passano", () => {
  assert.equal(portaValida(5173), true);
  assert.equal(portaValida(0), false);
  assert.equal(portaValida(65536), false);
  assert.equal(portaValida("5173"), false);
  assert.equal(percorsoValido("/pagina?x=1#qui"), true);
  assert.equal(percorsoValido("pagina"), false);
  assert.equal(percorsoValido("//altrove.example/"), false);
  assert.equal(percorsoValido("/con spazio"), false);
  assert.equal(percorsoValido("/\\altrove.example"), false);

  const richiesta = { tipo: "anteprima-richiesta", idRichiesta: "r1", porta: 5173, metodo: "GET", percorso: "/", intestazioni: [["accept", "*/*"]] };
  assert.deepEqual(leggiComandoAnteprima(richiesta), richiesta);
  assert.equal(leggiComandoAnteprima({ ...richiesta, porta: 0 }), undefined);
  assert.equal(leggiComandoAnteprima({ ...richiesta, metodo: "get" }), undefined);
  assert.equal(leggiComandoAnteprima({ ...richiesta, percorso: "http://altrove.example/" }), undefined);
  assert.equal(leggiComandoAnteprima({ ...richiesta, intestazioni: [["accept"]] }), undefined);
  assert.equal(leggiComandoAnteprima({ tipo: "anteprima-ws-apri", idCanale: "c1", porta: 5173, percorso: "/ws", protocolli: [7] }), undefined);
  assert.deepEqual(leggiRiferitoAnteprima({ tipo: "anteprima-inizio", idRichiesta: "r1", stato: 200, intestazioni: [] }), {
    tipo: "anteprima-inizio",
    idRichiesta: "r1",
    stato: 200,
    intestazioni: [],
  });
  assert.equal(leggiRiferitoAnteprima({ tipo: "anteprima-inizio", idRichiesta: "r1", stato: 99, intestazioni: [] }), undefined);
  assert.equal(leggiRiferitoAnteprima({ tipo: "anteprima-pezzo", idRichiesta: "r1", dati: 7 }), undefined);
});
