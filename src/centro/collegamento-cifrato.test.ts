import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as creaServerTls } from "node:https";
import { connect } from "node:tls";
import { test, type TestContext } from "node:test";
import WebSocket, { WebSocketServer } from "ws";
import { custodiaDelSegreto, leggiOCreaIdentita, type Identita } from "../nodo/identita.ts";
import { CollegamentoAlCentro, indirizzoDelCollegamento, type StatoCollegamento } from "../nodo/collegamento.ts";
import { nuovoCertificatoDeiNodi } from "./certificato.ts";
import { allestisci, avviaNodo, avviaNodoAccettato, finche, ID_NODO, PASSWORD, SEGRETO_NODO, type Banco } from "../prove/banco.ts";
import { improntaDelSegreto } from "../protocollo/codice.ts";
import { NOME_TLS_DEI_NODI, PERCORSO_COLLEGAMENTO, type MessaggioCentro } from "../protocollo/nodi.ts";
import type { StatoSicurezza } from "../protocollo/sicurezza.ts";
import { COOKIE_SESSIONE } from "./centro.ts";
import { improntaInBreve, preparaIdentitaPerINodi } from "./identita-per-i-nodi.ts";

function cartellaProvvisoria(t: TestContext): string {
  const cartella = mkdtempSync(join(tmpdir(), "shinka-cifrato-"));
  t.after(() => rm(cartella, { recursive: true, force: true }));
  return cartella;
}

const ambienteDelNodo = (banco: Banco) => banco.ambienti.stato().ambienti.find((ambiente) => ambiente.id === ID_NODO);

/** L'impronta del certificato dei nodi di questo centro, come la vede chi lo chiede per nome. */
function improntaVista(porta: number, nome: string | undefined): Promise<string> {
  return new Promise((fatto, fallito) => {
    const presa = connect({ host: "127.0.0.1", port: porta, rejectUnauthorized: false, ...(nome === undefined ? {} : { servername: nome }) }, () => {
      const certificato = presa.getPeerX509Certificate();
      presa.destroy();
      if (certificato === undefined) fallito(new Error("nessun certificato"));
      else fatto(improntaInBreve(certificato));
    });
    presa.on("error", fallito);
  });
}

/** Un nodo di una versione di prima: si presenta in chiaro, senza sapere nulla di certificati. */
function nodoDiPrima(porta: number, segreto: string = SEGRETO_NODO): Promise<{ ricevuti: MessaggioCentro[]; chiuso: boolean }> {
  return new Promise((fatto) => {
    const esito = { ricevuti: [] as MessaggioCentro[], chiuso: false };
    const socket = new WebSocket(`ws://127.0.0.1:${porta}${PERCORSO_COLLEGAMENTO}`);
    socket.on("open", () =>
      socket.send(JSON.stringify({ tipo: "presentazione", idNodo: ID_NODO, segreto, nome: "PC Windows", descrizione: "", sistema: "Windows 11", radiceProgetti: "C:/Progetti" })),
    );
    socket.on("message", (dati) => {
      esito.ricevuti.push(JSON.parse(dati.toString()) as MessaggioCentro);
      // Un nodo accolto resta collegato: alla prova basta sapere com'è stato trattato.
      if (esito.ricevuti.at(-1)?.tipo === "accolto") socket.close();
    });
    socket.on("close", () => {
      esito.chiuso = true;
      fatto(esito);
    });
    socket.on("error", () => {});
  });
}

test("il certificato dei nodi nasce una volta e resta quello: ha il solo nome che i nodi chiedono", (t) => {
  const cartella = cartellaProvvisoria(t);
  const prima = preparaIdentitaPerINodi(cartella);
  const dopo = preparaIdentitaPerINodi(cartella);
  assert.equal(dopo.impronta, prima.impronta);
  assert.match(prima.impronta, /^[0-9a-f]{64}$/);
  const certificato = new X509Certificate(prima.certificato);
  assert.equal(certificato.subjectAltName, `DNS:${NOME_TLS_DEI_NODI}`);
  assert.ok(Date.parse(certificato.validTo) - Date.now() > 25 * 365 * 86_400_000);
  assert.equal(statSync(join(cartella, "nodi.key")).mode & 0o077, 0);

  // Un certificato che non si legge viene rifatto, e lo si dice: i nodi che ricordano quello di prima non lo riconosceranno.
  writeFileSync(join(cartella, "nodi.crt"), "rovinato");
  const avvisi: string[] = [];
  const rifatta = preparaIdentitaPerINodi(cartella, new Date(), (avviso) => avvisi.push(avviso));
  assert.notEqual(rifatta.impronta, prima.impronta);
  assert.equal(avvisi.length, 1);
});

test("l'indirizzo del collegamento: cifrato sulla stessa porta, anche quando la porta è sottintesa", () => {
  assert.equal(indirizzoDelCollegamento("http://192.168.1.20:7850"), "ws://192.168.1.20:7850/api/nodi/collegamento");
  assert.equal(indirizzoDelCollegamento("http://192.168.1.20:7850", true), "wss://192.168.1.20:7850/api/nodi/collegamento");
  assert.equal(indirizzoDelCollegamento("http://shinka.lan", true), "wss://shinka.lan:80/api/nodi/collegamento");
  assert.equal(indirizzoDelCollegamento("https://shinka.esempio.it"), "wss://shinka.esempio.it/api/nodi/collegamento");
});

test("un nodo si collega cifrato, riconosce il centro dal certificato dei nodi e da lì lo ricorda", async (t) => {
  const banco = await allestisci(t);
  const ricordate: string[] = [];
  const cifrati: boolean[] = [];
  const nodo = await avviaNodoAccettato(t, banco, { collegamento: { alImpronta: (impronta) => ricordate.push(impronta), alCifrato: (cifrato) => cifrati.push(cifrato) } });
  const porta = (banco.centro.server.address() as AddressInfo).port;
  const delCentro = await improntaVista(porta, NOME_TLS_DEI_NODI);

  assert.equal(ambienteDelNodo(banco)?.cifrato, true);
  assert.deepEqual(cifrati, [true]);
  // La ricorda una volta, da quando il centro lo ha ascoltato.
  assert.deepEqual(ricordate, [delCentro]);
  assert.ok(!nodo.stati.some((stato) => stato.stato === "scollegato"));

  // La pagina Sicurezza dice l'impronta, e il registro che il nodo è arrivato cifrato.
  const sicurezza = (await banco.centro.inject({ method: "GET", url: "/api/sicurezza", cookies: { [COOKIE_SESSIONE]: await banco.entra() } })).json<StatoSicurezza>();
  assert.deepEqual(sicurezza.nodi, { soloCifrati: false, impronta: delCentro });
  assert.ok(sicurezza.voci.some((voce) => voce.tipo === "nodo-presentato" && voce.dettaglio === "«PC Windows», cifrato, in attesa del consenso"));
});

test("un nodo che ricorda un altro certificato non parla con chi risponde: nemmeno si presenta", async (t) => {
  const banco = await allestisci(t);
  const nodo = await avviaNodo(t, banco, { collegamento: { impronta: "ab".repeat(32) } });
  await finche(() => nodo.stati.filter((stato) => stato.stato === "centro-non-riconosciuto").length >= 2, "il nodo non riconosce il centro, e riprova");
  assert.equal(banco.ambienti.stato().richieste.length, 0);
  assert.ok(!nodo.stati.some((stato) => stato.stato === "in-attesa" || stato.stato === "attivo"));
});

test("un segreto passato in chiaro il nodo lo cambia appena il collegamento è cifrato, e quello di prima non vale più", async (t) => {
  const banco = await allestisci(t);
  const file = join(cartellaProvvisoria(t), "identita.json");
  // Un'identità di prima di questa versione: non dice di non essere mai passata in chiaro.
  writeFileSync(file, JSON.stringify({ idNodo: ID_NODO, segreto: SEGRETO_NODO }));
  const identita: Identita = await leggiOCreaIdentita(file);
  assert.equal(identita.maiInChiaro, undefined);

  // Finché il nodo aspetta il consenso il segreto resta quello: il codice di verifica dipende da lui.
  const nodo = await avviaNodoAccettato(t, banco, { collegamento: { identita, segreto: custodiaDelSegreto(file, identita) } });
  assert.equal(identita.segreto, SEGRETO_NODO);
  assert.ok(typeof identita.segretoProssimo === "string" && identita.segretoProssimo !== SEGRETO_NODO);

  // Alla presentazione successiva, da nodo accettato, il centro prende quello nuovo e lo conferma.
  nodo.collegamento.ferma();
  nodo.collegamento.avvia();
  await finche(() => identita.maiInChiaro === true, "il segreto cambia");
  assert.notEqual(identita.segreto, SEGRETO_NODO);
  assert.equal(identita.segretoProssimo, undefined);
  const salvata = JSON.parse(readFileSync(file, "utf8")) as Identita;
  assert.deepEqual(salvata, { idNodo: ID_NODO, segreto: identita.segreto, maiInChiaro: true });
  const registrati = JSON.parse(readFileSync(join(banco.cartella, "ambienti.json"), "utf8")) as { improntaSegreto: string }[];
  assert.equal(registrati[0]?.improntaSegreto, improntaDelSegreto(identita.segreto));

  // Chi avesse letto il segreto di prima sulla rete non entra più.
  const porta = (banco.centro.server.address() as AddressInfo).port;
  const intruso = await nodoDiPrima(porta);
  assert.equal(intruso.ricevuti[0]?.tipo, "rifiutato");
  // Il nodo vero, con quello nuovo, sì: e non ne propone un altro.
  nodo.collegamento.ferma();
  nodo.collegamento.avvia();
  await finche(() => nodo.stati.filter((stato) => stato.stato === "attivo").length === 3, "il nodo torna");
  assert.equal(identita.segretoProssimo, undefined);
});

test("davanti a un centro che non sa cifrare, un nodo che non lo ricorda torna al collegamento in chiaro e lo dice", async (t) => {
  const banco = await allestisci(t, { senzaCertificatoDeiNodi: true });
  const file = join(cartellaProvvisoria(t), "identita.json");
  const identita = await leggiOCreaIdentita(file);
  assert.equal(identita.maiInChiaro, true);
  const cifrati: boolean[] = [];
  const nodo = await avviaNodo(t, banco, { collegamento: { identita, segreto: custodiaDelSegreto(file, identita), alCifrato: (cifrato) => cifrati.push(cifrato) } });
  await finche(() => nodo.stati.some((stato) => stato.stato === "in-attesa"), "il nodo si presenta in chiaro");
  assert.equal(await banco.ambienti.decidi(identita.idNodo, "approvato"), true);
  await finche(() => nodo.stati.some((stato) => stato.stato === "attivo"), "il nodo viene accolto");
  assert.deepEqual(cifrati, [false]);
  assert.equal(banco.ambienti.stato().ambienti.find((ambiente) => ambiente.id === identita.idNodo)?.cifrato, false);
  // Il segreto è passato in chiaro: il nodo lo sa, e lo cambierà quando potrà.
  assert.equal(identita.maiInChiaro, undefined);
  assert.equal((JSON.parse(readFileSync(file, "utf8")) as Identita).maiInChiaro, undefined);
});

test("con «solo collegamenti cifrati» un nodo in chiaro non viene ascoltato, e quelli già collegati in chiaro vengono staccati", async (t) => {
  const banco = await allestisci(t);
  // Il nodo viene accettato cifrato, poi si spegne: da qui si presentano i suoi panni di prima.
  const accettato = await avviaNodoAccettato(t, banco);
  accettato.collegamento.ferma();
  await finche(() => ambienteDelNodo(banco)?.attivo === false, "il nodo si spegne");
  const porta = (banco.centro.server.address() as AddressInfo).port;
  const cookies = { [COOKIE_SESSIONE]: await banco.entra() };

  // Senza la scelta, un nodo di prima viene accolto in chiaro, e si vede.
  const accolto = await nodoDiPrima(porta);
  assert.equal(accolto.ricevuti[0]?.tipo, "accolto");

  const collegatoInChiaro = new WebSocket(`ws://127.0.0.1:${porta}${PERCORSO_COLLEGAMENTO}`);
  const ricevuti: MessaggioCentro[] = [];
  collegatoInChiaro.on("message", (dati) => ricevuti.push(JSON.parse(dati.toString()) as MessaggioCentro));
  collegatoInChiaro.on("open", () =>
    collegatoInChiaro.send(JSON.stringify({ tipo: "presentazione", idNodo: ID_NODO, segreto: SEGRETO_NODO, nome: "PC Windows", descrizione: "", sistema: "Windows 11", radiceProgetti: "C:/Progetti" })),
  );
  await finche(() => ricevuti.some((messaggio) => messaggio.tipo === "accolto"), "il nodo in chiaro è accolto");
  assert.equal(ambienteDelNodo(banco)?.cifrato, false);

  // Il proprietario accende la scelta: il nodo in chiaro viene staccato.
  const chiuso = new Promise((fatto) => collegatoInChiaro.on("close", fatto));
  const risposta = await banco.centro.inject({ method: "PUT", url: "/api/impostazioni", payload: { soloNodiCifrati: true }, cookies });
  assert.equal(risposta.statusCode, 200, risposta.body);
  await chiuso;
  assert.equal(ricevuti.at(-1)?.tipo, "solo-cifrato");
  assert.equal(banco.ambienti.soloCifrati, true);

  // Da qui un nodo in chiaro non viene ascoltato: nemmeno gli si dice se il suo segreto è giusto.
  for (const segreto of [SEGRETO_NODO, "un-segreto-sbagliato-lungo-almeno-trentadue"]) {
    const respinto = await nodoDiPrima(porta, segreto);
    assert.deepEqual(respinto.ricevuti, [{ tipo: "solo-cifrato" }]);
  }
  const sicurezza = (await banco.centro.inject({ method: "GET", url: "/api/sicurezza?solo=da-guardare", cookies })).json<StatoSicurezza>();
  assert.equal(sicurezza.nodi?.soloCifrati, true);
  assert.ok(sicurezza.voci.some((voce) => voce.tipo === "nodo-in-chiaro" && voce.dettaglio === "«PC Windows»"));

  // Un nodo che cifra entra come prima.
  const cifrato = await avviaNodo(t, banco);
  await finche(() => cifrato.stati.some((stato) => stato.stato === "attivo"), "il nodo cifrato è accolto");
  assert.equal(ambienteDelNodo(banco)?.cifrato, true);
});

test("senza HTTPS chi apre la porta in TLS trova il certificato dei nodi; i browser non lo chiedono per nome", async (t) => {
  const banco = await allestisci(t);
  await banco.centro.listen({ host: "127.0.0.1", port: 0 });
  const porta = (banco.centro.server.address() as AddressInfo).port;
  assert.equal(await improntaVista(porta, NOME_TLS_DEI_NODI), await improntaVista(porta, undefined));
  // L'interfaccia in chiaro risponde come prima.
  assert.equal((await fetch(`http://127.0.0.1:${porta}/api/stato`)).status, 200);
  assert.ok(existsSync(join(banco.cartella, "collegamento-nodi", "nodi.crt")));
  void PASSWORD;
});

test("al primo incontro un nodo ricorda solo un certificato dei nodi: a chi ne presenta un altro non dice nulla", async (t) => {
  // Un centro di prima con l'HTTPS acceso: risponde in TLS, ma con il certificato dei browser.
  const altro = nuovoCertificatoDeiNodi("shinka.casa");
  const server = creaServerTls({ key: altro.chiave, cert: altro.certificato });
  const ricevuti: string[] = [];
  const prese = new WebSocketServer({ server });
  prese.on("connection", (presa) => presa.on("message", (dati) => ricevuti.push(dati.toString())));
  await new Promise<void>((fatto) => server.listen(0, "127.0.0.1", fatto));
  t.after(() => {
    prese.close();
    server.close();
    server.closeAllConnections();
  });
  const stati: StatoCollegamento[] = [];
  const ricordate: string[] = [];
  const collegamento = new CollegamentoAlCentro({
    centro: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    identita: { idNodo: ID_NODO, segreto: SEGRETO_NODO },
    nome: "PC Windows",
    descrizione: "",
    sistema: "Windows 11",
    radiceProgetti: "C:/Progetti",
    alImpronta: (impronta) => ricordate.push(impronta),
    alCambio: (stato) => stati.push(stato),
    attesaInizialeMs: 20,
    attesaMassimaMs: 40,
  });
  t.after(() => collegamento.ferma());
  collegamento.avvia();
  await finche(() => stati.filter((stato) => stato.stato === "scollegato").length >= 4, "il nodo prova, e riprova");
  assert.deepEqual(ricevuti, []);
  assert.deepEqual(ricordate, []);
});
