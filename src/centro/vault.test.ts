import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { BrowserDelGateway } from "../gateway/browser.ts";
import { Registro } from "../gateway/registro.ts";
import { COOKIE_VAULT, creaGateway } from "../gateway/servizio.ts";
import { Operazioni } from "../gateway/uso.ts";
import { Vault } from "../gateway/vault.ts";
import { allestisci, avviaNodoAccettato, finche, ID_NODO, usaStrumento, type Banco } from "../prove/banco.ts";
import { browserDiProva } from "../prove/browser-di-prova.ts";
import { avviaHostDiProva, type HostDiProva } from "../prove/host-di-prova.ts";
import { avviaSitoDiProva } from "../prove/sito-di-prova.ts";
import type { DettaglioVault } from "../protocollo/vault.ts";
import { COOKIE_SESSIONE } from "./centro.ts";
import { ClienteGateway } from "./gateway.ts";
import { STRUMENTI_HOME_SENZA_RICHIESTA } from "./istruzioni-home.ts";

const FRASE = "una frase di sblocco di prova";
const PASSWORD = "P4ssword-di-prova-da-non-vedere";
const GETTONE = "gettone-di-prova-del-centro-lungo-quanto-serve";

interface GatewayInProva {
  vault: Vault;
  cliente: ClienteGateway;
  indirizzo: string;
  cartella: string;
}

/** Un gateway vero in ascolto su una porta, con il vault aperto, e il centro che gli parla. */
async function avviaGateway(t: TestContext, gettoneDelCentro = GETTONE, conBrowser = false): Promise<GatewayInProva> {
  const cartella = await mkdtemp(join(tmpdir(), "shinka-gateway-"));
  const vault = await Vault.apri(join(cartella, "vault.json"), 2 ** 10);
  await vault.imposta(FRASE);
  const registro = await Registro.apri(join(cartella, "registro.jsonl"));
  const browser = conBrowser ? new BrowserDelGateway(vault, registro, { profilo: join(cartella, "browser"), ...browserDiProva() }) : undefined;
  const app = await creaGateway({
    vault,
    registro,
    operazioni: new Operazioni(vault, registro),
    gettone: GETTONE,
    ...(browser === undefined ? {} : { browser }),
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const indirizzo = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const cliente = new ClienteGateway({ indirizzo, gettone: gettoneDelCentro, pagina: "http://vault.di.prova:7851" });
  // Nell'ordine: prima si spegne il browser, poi si cancella la cartella che contiene il suo profilo.
  t.after(async () => {
    cliente.chiudi();
    await app.close();
    await browser?.spegni();
    await rm(cartella, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  return { vault, cliente, indirizzo, cartella };
}

async function avviaHost(t: TestContext): Promise<HostDiProva> {
  const host = await avviaHostDiProva({
    utente: "mario",
    password: PASSWORD,
    esegui: (comando) => (comando === "false" ? { uscita: "", codice: 1 } : { uscita: `eseguito: ${comando}\n` }),
  });
  t.after(() => host.chiudi());
  return host;
}

async function leggiVault(banco: Banco): Promise<DettaglioVault> {
  const risposta = await banco.centro.inject({
    method: "GET",
    url: "/api/vault",
    cookies: { [COOKIE_SESSIONE]: await banco.entra() },
  });
  assert.equal(risposta.statusCode, 200, risposta.body);
  return risposta.json();
}

/** Tutto ciò che c'è scritto nei file di una cartella, per cercarvi un valore che non deve esserci. */
async function tuttoIlTesto(cartella: string): Promise<string> {
  let testo = "";
  for (const voce of await readdir(cartella, { withFileTypes: true, recursive: true })) {
    if (voce.isFile()) testo += await readFile(join(voce.parentPath, voce.name), "latin1");
  }
  return testo;
}

test("senza gateway il vault non è configurato, e gli strumenti lo dicono", async (t) => {
  const banco = await allestisci(t);
  assert.deepEqual(await leggiVault(banco), { gateway: "non-configurato", credenziali: [], registro: [] });

  const elenco = await banco.comuniDellaHome("elenca_credenziali", {});
  assert.match(elenco.testo, /gateway non è configurato/);
  const uso = await banco.comuniDellaHome("esegui_su_host", { credenziale: "nas", host: "nas.lan", comando: "uptime" });
  assert.equal(uso.errore, true);
  assert.match(uso.testo, /Rifiutato dal gateway/);
});

test("la pagina del vault al centro chiede l'accesso del proprietario", async (t) => {
  const banco = await allestisci(t);
  assert.equal((await banco.centro.inject({ method: "GET", url: "/api/vault" })).statusCode, 401);
});

test("usare una credenziale chiede consenso; elencarle no", () => {
  assert.ok(STRUMENTI_HOME_SENZA_RICHIESTA.some((nome) => nome.endsWith("__elenca_credenziali")));
  assert.ok(!STRUMENTI_HOME_SENZA_RICHIESTA.some((nome) => nome.endsWith("__esegui_su_host")));
});

test("aprire un sito, agirci e inserirci una credenziale chiedono consenso; rileggere e chiudere la pagina no", () => {
  const senza = (nome: string): boolean => STRUMENTI_HOME_SENZA_RICHIESTA.some((strumento) => strumento.endsWith(`__${nome}`));
  assert.ok(senza("leggi_sito"));
  assert.ok(senza("chiudi_sito"));
  assert.ok(!senza("apri_sito"));
  assert.ok(!senza("agisci_nel_sito"));
  assert.ok(!senza("inserisci_credenziale"));
});

test("senza gateway, o con un gateway senza browser, gli strumenti dei siti lo dicono", async (t) => {
  const senzaGateway = await allestisci(t);
  const aperto = await senzaGateway.comuniDellaHome("apri_sito", { indirizzo: "https://esempio.it" });
  assert.equal(aperto.errore, true);
  assert.match(aperto.testo, /gateway non è configurato/);

  const gateway = await avviaGateway(t);
  const banco = await allestisci(t, { gateway: gateway.cliente });
  const senzaBrowser = await banco.comuniDellaHome("apri_sito", { indirizzo: "https://esempio.it" });
  assert.equal(senzaBrowser.errore, true);
  assert.match(senzaBrowser.testo, /non ha un browser/);
  assert.match((await banco.comuniDellaHome("agisci_nel_sito", { azione: "salta" })).testo, /L'azione è una tra/);
});

const saltaIlBrowser = browserDiProva() === undefined ? "su questa macchina non c'è un browser per la prova" : false;

test("la Home entra in un sito con una credenziale del vault: il valore non arriva al centro", { skip: saltaIlBrowser }, async (t) => {
  const gateway = await avviaGateway(t, GETTONE, true);
  const sito = await avviaSitoDiProva({ utente: "mario", password: PASSWORD });
  t.after(() => sito.chiudi());
  const banco = await allestisci(t, { gateway: gateway.cliente });
  await gateway.vault.inserisci({ nome: "sito-prova", tipo: "sito", utente: "mario", host: [sito.origine], segreto: PASSWORD });

  const elenco = await banco.comuniDellaHome("elenca_credenziali", {});
  assert.ok(elenco.testo.includes(`- nome: "sito-prova"; per i siti: ${sito.origine}; utente: mario; tipo: accesso a un sito`), elenco.testo);

  const aperta = await banco.comuniDellaHome("apri_sito", { indirizzo: sito.origine });
  assert.equal(aperta.errore, undefined, aperta.testo);
  assert.match(aperta.testo, /textbox "Password"/);
  const inserita = await banco.comuniDellaHome("inserisci_credenziale", { credenziale: "sito-prova" });
  assert.equal(inserita.errore, undefined, inserita.testo);
  const bottone = /button "Entra" \[ref=(\w+)\]/.exec(inserita.testo)?.[1];
  assert.ok(bottone);
  const dentro = await banco.comuniDellaHome("agisci_nel_sito", { azione: "clicca", elemento: bottone, descrizione: "bottone Entra" });
  assert.match(dentro.testo, /Benvenuto, mario/);
  assert.deepEqual(sito.tentativi, [{ utente: "mario", password: PASSWORD }]);

  // Rileggere con l'immagine: l'immagine arriva a Claude insieme al testo.
  const conImmagine = await banco.comuniDellaHome("leggi_sito", { immagine: true });
  assert.equal(conImmagine.immagine?.tipo, "image/jpeg");
  assert.ok((conImmagine.immagine?.dati?.length ?? 0) > 1000);

  // Un altro sito non riceve la credenziale.
  const altro = await avviaSitoDiProva({ utente: "mario", password: PASSWORD });
  t.after(() => altro.chiudi());
  await banco.comuniDellaHome("apri_sito", { indirizzo: altro.origine });
  const rifiutata = await banco.comuniDellaHome("inserisci_credenziale", { credenziale: "sito-prova" });
  assert.equal(rifiutata.errore, true);
  assert.match(rifiutata.testo, /Rifiutato dal gateway: La credenziale "sito-prova" non è prevista per il sito/);
  assert.deepEqual(altro.tentativi, []);
  assert.match((await banco.comuniDellaHome("chiudi_sito", {})).testo, /Pagina chiusa/);

  const dettaglio = await leggiVault(banco);
  assert.deepEqual(
    dettaglio.registro.map((voce) => [voce.conversazione, voce.credenziale, voce.host, voce.esito, voce.nelBrowser]).reverse(),
    [
      ["Home", "sito-prova", sito.origine, "eseguito", true],
      ["Home", "sito-prova", altro.origine, "rifiutato", true],
    ],
  );
  assert.ok(dettaglio.credenziali[0]?.usataIl);

  // Il valore non è in ciò che il centro mostra né in alcun file dei suoi dati; al gateway resta solo cifrato.
  assert.ok(!JSON.stringify(dettaglio).includes(PASSWORD));
  assert.ok(!(await tuttoIlTesto(banco.cartella)).includes(PASSWORD));
  for (const file of ["vault.json", "registro.jsonl"]) {
    assert.ok(!(await readFile(join(gateway.cartella, file), "latin1")).includes(PASSWORD), file);
  }
});

test("un progetto in un altro ambiente usa il browser del gateway attraverso il centro, con la sua scheda", { skip: saltaIlBrowser }, async (t) => {
  const gateway = await avviaGateway(t, GETTONE, true);
  const sito = await avviaSitoDiProva({ utente: "mario", password: PASSWORD });
  t.after(() => sito.chiudi());
  const banco = await allestisci(t, { gateway: gateway.cliente });
  await gateway.vault.inserisci({ nome: "sito-prova", tipo: "sito", utente: "mario", host: [sito.origine], segreto: PASSWORD });

  const nodo = await avviaNodoAccettato(t, banco);
  await banco.lavori.crea("Bollette", ID_NODO, "Scaricare ogni mese le bollette dal sito del fornitore.");
  await finche(() => nodo.conversazioni.length === 1, "la conversazione del progetto nasce sul nodo");
  const remota = nodo.conversazioni[0];
  assert.ok(remota);
  const senzaRichiesta = remota.configurazione?.strumentiSenzaRichiesta ?? [];
  assert.ok(senzaRichiesta.includes("mcp__shinka__leggi_sito"));
  assert.ok(!senzaRichiesta.includes("mcp__shinka__inserisci_credenziale"));
  assert.match(remota.configurazione?.istruzioniAggiunte ?? "", /Siti in cui bisogna entrare/);

  // La Home ha una pagina aperta: il progetto non la vede, ha la sua scheda.
  await banco.comuniDellaHome("apri_sito", { indirizzo: `${sito.origine}/due-passi` });
  const senzaPagina = await usaStrumento(remota, "leggi_sito", {});
  assert.equal(senzaPagina.errore, true);
  assert.match(senzaPagina.testo, /non c'è una pagina aperta/);

  const aperta = await usaStrumento(remota, "apri_sito", { indirizzo: sito.origine });
  assert.equal(aperta.errore, false, aperta.testo);
  const inserita = await usaStrumento(remota, "inserisci_credenziale", { credenziale: "sito-prova" });
  assert.equal(inserita.errore, false, inserita.testo);
  assert.ok(!inserita.testo.includes(PASSWORD));
  // L'immagine attraversa il collegamento tra il centro e il nodo e arriva a Claude.
  const conImmagine = await usaStrumento(remota, "leggi_sito", { immagine: true });
  assert.equal(conImmagine.immagini, 1);
  assert.match(conImmagine.testo, /Pagina: Sito di prova: accesso/);

  const [voce] = (await leggiVault(banco)).registro;
  assert.equal(voce?.conversazione, 'Progetto "Bollette"');
  assert.equal(voce?.esito, "eseguito");
});

test("la Home usa una credenziale per nome: il valore non compare nella risposta, nei dati del centro né nel registro", async (t) => {
  const gateway = await avviaGateway(t);
  const host = await avviaHost(t);
  const banco = await allestisci(t, { gateway: gateway.cliente });
  const dove = `127.0.0.1:${host.porta}`;
  await gateway.vault.inserisci({ nome: "nas", tipo: "password", utente: "mario", host: [dove], segreto: PASSWORD });

  const elenco = await banco.comuniDellaHome("elenca_credenziali", {});
  assert.equal(elenco.errore, undefined);
  assert.match(elenco.testo, /nome: "nas"; utente: mario/);
  assert.ok(elenco.testo.includes(dove));

  const uso = await banco.comuniDellaHome("esegui_su_host", { credenziale: "nas", host: dove, comando: "uptime" });
  assert.equal(uso.errore, undefined, uso.testo);
  assert.equal(uso.testo, "Codice di uscita: 0\neseguito: uptime");
  assert.deepEqual(host.comandi, ["uptime"]);

  // Un comando che finisce male torna a Claude come errore, con il suo codice.
  const fallito = await banco.comuniDellaHome("esegui_su_host", { credenziale: "nas", host: dove, comando: "false" });
  assert.equal(fallito.errore, true);
  assert.match(fallito.testo, /Codice di uscita: 1/);

  // Un comando che prova a far uscire il valore lo riceve coperto.
  const eco = await banco.comuniDellaHome("esegui_su_host", { credenziale: "nas", host: dove, comando: `echo ${PASSWORD}` });
  assert.ok(!eco.testo.includes(PASSWORD), eco.testo);
  assert.match(eco.testo, /\[credenziale del vault\]/);

  const dettaglio = await leggiVault(banco);
  assert.equal(dettaglio.gateway, "attivo");
  assert.equal(dettaglio.condizione, "aperto");
  assert.equal(dettaglio.pagina, "http://vault.di.prova:7851");
  assert.deepEqual(
    dettaglio.credenziali.map((c) => ({ nome: c.nome, utente: c.utente, host: c.host, usata: c.usataIl !== undefined })),
    [{ nome: "nas", utente: "mario", host: [dove], usata: true }],
  );
  assert.deepEqual(
    dettaglio.registro.map((voce) => [voce.conversazione, voce.comando, voce.esito]).reverse(),
    [
      ["Home", "uptime", "eseguito"],
      ["Home", "false", "eseguito"],
      ["Home", "echo [credenziale del vault]", "eseguito"],
    ],
  );

  // Il valore non è in ciò che il centro mostra, né in alcun file dei suoi dati, né in quelli del gateway.
  assert.ok(!JSON.stringify(dettaglio).includes(PASSWORD));
  assert.ok(!(await tuttoIlTesto(banco.cartella)).includes(PASSWORD));
  assert.ok(!(await tuttoIlTesto(gateway.cartella)).includes(PASSWORD));
});

test("una credenziale usata fuori dal suo host viene rifiutata, e all'host non arriva nulla", async (t) => {
  const gateway = await avviaGateway(t);
  const previsto = await avviaHost(t);
  const altro = await avviaHost(t);
  const banco = await allestisci(t, { gateway: gateway.cliente });
  await gateway.vault.inserisci({
    nome: "nas",
    tipo: "password",
    utente: "mario",
    host: [`127.0.0.1:${previsto.porta}`],
    segreto: PASSWORD,
  });

  const uso = await banco.comuniDellaHome("esegui_su_host", {
    credenziale: "nas",
    host: `127.0.0.1:${altro.porta}`,
    comando: "uptime",
  });
  assert.equal(uso.errore, true);
  assert.match(uso.testo, /Rifiutato dal gateway/);
  assert.equal(altro.tentativi, 0);
  assert.deepEqual(altro.comandi, []);

  const [voce] = (await leggiVault(banco)).registro;
  assert.equal(voce?.esito, "rifiutato");
  assert.equal(voce?.host, `127.0.0.1:${altro.porta}`);
});

test("un cambio di password su un host è un divieto fisso: rifiutato senza collegarsi", async (t) => {
  const gateway = await avviaGateway(t);
  const host = await avviaHost(t);
  const banco = await allestisci(t, { gateway: gateway.cliente });
  const dove = `127.0.0.1:${host.porta}`;
  await gateway.vault.inserisci({ nome: "nas", tipo: "password", utente: "mario", host: [dove], segreto: PASSWORD });

  const uso = await banco.comuniDellaHome("esegui_su_host", { credenziale: "nas", host: dove, comando: "passwd mario" });
  assert.equal(uso.errore, true);
  assert.match(uso.testo, /divieto fisso|cambiare una password/);
  assert.equal(host.tentativi, 0);
});

test("a vault chiuso nessuna credenziale si elenca né si usa", async (t) => {
  const gateway = await avviaGateway(t);
  const host = await avviaHost(t);
  const banco = await allestisci(t, { gateway: gateway.cliente });
  const dove = `127.0.0.1:${host.porta}`;
  await gateway.vault.inserisci({ nome: "nas", tipo: "password", utente: "mario", host: [dove], segreto: PASSWORD });
  gateway.vault.chiudi();

  assert.match((await banco.comuniDellaHome("elenca_credenziali", {})).testo, /vault è chiuso/);
  const uso = await banco.comuniDellaHome("esegui_su_host", { credenziale: "nas", host: dove, comando: "uptime" });
  assert.equal(uso.errore, true);
  assert.match(uso.testo, /chiuso/);
  assert.equal(host.tentativi, 0);

  const dettaglio = await leggiVault(banco);
  assert.equal(dettaglio.condizione, "chiuso");
  assert.deepEqual(dettaglio.credenziali, []);
});

test("un progetto in un altro ambiente usa la credenziale attraverso il centro, e deve chiedere consenso", async (t) => {
  const gateway = await avviaGateway(t);
  const host = await avviaHost(t);
  const banco = await allestisci(t, { gateway: gateway.cliente });
  const dove = `127.0.0.1:${host.porta}`;
  await gateway.vault.inserisci({ nome: "nas", tipo: "password", utente: "mario", host: [dove], segreto: PASSWORD });

  const nodo = await avviaNodoAccettato(t, banco);
  await banco.lavori.crea("Videogioco", ID_NODO, "Sviluppare un videogioco di piattaforme in due dimensioni.");
  await finche(() => nodo.conversazioni.length === 1, "la conversazione del progetto nasce sul nodo");
  const remota = nodo.conversazioni[0];
  assert.ok(remota);

  const senzaRichiesta = remota.configurazione?.strumentiSenzaRichiesta ?? [];
  assert.ok(senzaRichiesta.includes("mcp__shinka__elenca_credenziali"));
  assert.ok(!senzaRichiesta.includes("mcp__shinka__esegui_su_host"));
  assert.match(remota.configurazione?.istruzioniAggiunte ?? "", /Host e credenziali/);

  assert.match((await usaStrumento(remota, "elenca_credenziali", {})).testo, /nome: "nas"/);
  const uso = await usaStrumento(remota, "esegui_su_host", { credenziale: "nas", host: dove, comando: "df -h" });
  assert.equal(uso.errore, false, uso.testo);
  assert.equal(uso.testo, "Codice di uscita: 0\neseguito: df -h");

  const [voce] = (await leggiVault(banco)).registro;
  assert.equal(voce?.conversazione, 'Progetto "Videogioco"');
  assert.equal(voce?.comando, "df -h");
});

test("il quadro dell'interfaccia riceve il vault in breve, e lo aggiorna quando cambia", async (t) => {
  const gateway = await avviaGateway(t);
  const banco = await allestisci(t, { gateway: gateway.cliente });
  await banco.centro.listen({ host: "127.0.0.1", port: 0 });
  const { port } = banco.centro.server.address() as AddressInfo;
  const controllo = new AbortController();
  t.after(() => controllo.abort());
  const risposta = await fetch(`http://127.0.0.1:${port}/api/quadro/eventi`, {
    headers: { cookie: `${COOKIE_SESSIONE}=${await banco.entra()}` },
    signal: controllo.signal,
  });
  assert.ok(risposta.body);
  const lettore = risposta.body.pipeThrough(new TextDecoderStream()).getReader();
  let ricevuto = "";
  const aspetta = async (atteso: string): Promise<void> => {
    while (!ricevuto.includes(atteso)) {
      const { value, done } = await lettore.read();
      if (done) throw new Error(`il flusso si è chiuso prima di "${atteso}"`);
      ricevuto += value;
    }
  };
  await aspetta('{"gateway":"attivo","condizione":"aperto","quante":0}');

  await gateway.vault.inserisci({ nome: "nas", tipo: "password", utente: "mario", host: ["nas.lan"], segreto: PASSWORD });
  await gateway.cliente.stato();
  await aspetta('{"gateway":"attivo","condizione":"aperto","quante":1}');
  assert.match(ricevuto, /event: vault/);
});

test("con un gettone sbagliato il centro non ottiene nulla dal gateway", async (t) => {
  const gateway = await avviaGateway(t, "un-gettone-che-non-è-quello-giusto");
  const banco = await allestisci(t, { gateway: gateway.cliente });
  assert.equal((await leggiVault(banco)).gateway, "irraggiungibile");
  const uso = await banco.comuniDellaHome("esegui_su_host", { credenziale: "nas", host: "nas.lan", comando: "uptime" });
  assert.equal(uso.errore, true);
  assert.match(uso.testo, /gettone/);
});

test("dal centro non si entra nelle porte del proprietario del gateway", async (t) => {
  const gateway = await avviaGateway(t);
  // Il cookie del centro non vale al gateway, e il gettone del centro non apre l'inserimento.
  const conGettone = await fetch(`${gateway.indirizzo}/vault/credenziali`, { headers: { authorization: `Bearer ${GETTONE}` } });
  assert.equal(conGettone.status, 401);
  const conCookieFinto = await fetch(`${gateway.indirizzo}/vault/credenziali`, { headers: { cookie: `${COOKIE_VAULT}=inventato` } });
  assert.equal(conCookieFinto.status, 401);
});
