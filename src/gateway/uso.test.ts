import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { avviaHostDiProva, nuovaCoppiaDiChiavi, type HostDiProva, type OpzioniHostDiProva } from "../prove/host-di-prova.ts";
import { DomandeAlProprietario } from "./domande.ts";
import { Registro } from "./registro.ts";
import { Operazioni } from "./uso.ts";
import { Vault } from "./vault.ts";

const FRASE = "una frase di sblocco di prova";
const PASSWORD = "P4ssword-di-prova-da-non-vedere";
const COSTO = 2 ** 10;

interface Banco {
  vault: Vault;
  registro: Registro;
  operazioni: Operazioni;
  /** Le domande che il gateway fa al proprietario da sé. */
  domande: DomandeAlProprietario;
  fileRegistro: string;
  fileVault: string;
}

async function banco(t: TestContext): Promise<Banco> {
  const cartella = await mkdtemp(join(tmpdir(), "shinka-gateway-"));
  t.after(() => rm(cartella, { recursive: true, force: true }));
  const fileVault = join(cartella, "vault.json");
  const fileRegistro = join(cartella, "registro.jsonl");
  const vault = await Vault.apri(fileVault, COSTO);
  await vault.imposta(FRASE);
  const registro = await Registro.apri(fileRegistro);
  const domande = new DomandeAlProprietario();
  t.after(() => domande.ferma());
  return { vault, registro, operazioni: new Operazioni(vault, registro, undefined, domande), domande, fileRegistro, fileVault };
}

async function host(t: TestContext, opzioni: Partial<OpzioniHostDiProva> = {}): Promise<HostDiProva> {
  const avviato = await avviaHostDiProva({
    utente: "mario",
    password: PASSWORD,
    esegui: (comando) => ({ uscita: `eseguito: ${comando}\n` }),
    ...opzioni,
  });
  t.after(() => avviato.chiudi());
  return avviato;
}

function richiesta(porta: number, comando: string, credenziale = "prova") {
  return { credenziale, host: `127.0.0.1:${porta}`, comando, conversazione: "Home" };
}

test("un comando su un host con una password del vault: il valore non compare da nessuna parte", async (t) => {
  const b = await banco(t);
  const h = await host(t);
  await b.vault.inserisci({ nome: "prova", tipo: "password", utente: "mario", host: [`127.0.0.1:${h.porta}`], segreto: PASSWORD });

  const esito = await b.operazioni.usa(richiesta(h.porta, "uptime"));
  assert.deepEqual(
    { ...esito, durataMs: 0 },
    { esito: "eseguito", codice: 0, uscita: "eseguito: uptime\n", errori: "", scaduto: false, durataMs: 0 },
  );
  assert.deepEqual(h.comandi, ["uptime"]);

  const voce = b.registro.ultime(1)[0];
  assert.equal(voce?.esito, "eseguito");
  assert.equal(voce?.credenziale, "prova");
  assert.equal(voce?.conversazione, "Home");
  assert.equal(voce?.comando, "uptime");
  assert.equal(voce?.codice, 0);

  // Né ciò che torna a Claude, né il registro, né il file del vault portano il valore.
  assert.ok(!JSON.stringify(esito).includes(PASSWORD));
  assert.ok(!(await readFile(b.fileRegistro, "utf8")).includes(PASSWORD));
  assert.ok(!(await readFile(b.fileVault, "utf8")).includes(PASSWORD));
  assert.notEqual(b.vault.elenco()[0]?.usataIl, undefined);
});

test("un comando con una chiave del vault, anche protetta da una frase", async (t) => {
  const b = await banco(t);
  const coppia = nuovaCoppiaDiChiavi("frase-della-chiave");
  const h = await host(t, { password: undefined, chiavePubblica: coppia.pubblica, esegui: () => ({ uscita: "ok\n", errori: "avviso\n", codice: 3 }) });
  await b.vault.inserisci({
    nome: "prova",
    tipo: "chiave",
    utente: "mario",
    host: [`127.0.0.1:${h.porta}`],
    segreto: coppia.privata,
    fraseDellaChiave: "frase-della-chiave",
  });
  const esito = await b.operazioni.usa(richiesta(h.porta, "false"));
  assert.equal(esito.esito, "eseguito");
  assert.equal(esito.esito === "eseguito" && esito.codice, 3);
  assert.equal(esito.esito === "eseguito" && esito.uscita, "ok\n");
  assert.equal(esito.esito === "eseguito" && esito.errori, "avviso\n");
});

test("un host che chiede la password con una domanda la riceve", async (t) => {
  const b = await banco(t);
  const h = await host(t, { soloConDomanda: true });
  await b.vault.inserisci({ nome: "prova", tipo: "password", utente: "mario", host: [`127.0.0.1:${h.porta}`], segreto: PASSWORD });
  assert.equal((await b.operazioni.usa(richiesta(h.porta, "id"))).esito, "eseguito");
});

test("una credenziale non prevista per quell'host viene rifiutata senza collegarsi", async (t) => {
  const b = await banco(t);
  const previsto = await host(t);
  const altro = await host(t);
  await b.vault.inserisci({ nome: "prova", tipo: "password", utente: "mario", host: [`127.0.0.1:${previsto.porta}`], segreto: PASSWORD });

  const esito = await b.operazioni.usa(richiesta(altro.porta, "uptime"));
  assert.equal(esito.esito, "rifiutato");
  assert.match(esito.esito === "rifiutato" ? esito.motivo : "", /non è prevista per l'host/);
  // L'altro host non ha visto nemmeno un tentativo: la password non è partita.
  assert.equal(altro.tentativi, 0);
  assert.deepEqual(altro.comandi, []);
  assert.equal(b.registro.ultime(1)[0]?.esito, "rifiutato");

  const sconosciuta = await b.operazioni.usa(richiesta(previsto.porta, "uptime", "non-esiste"));
  assert.equal(sconosciuta.esito, "rifiutato");
});

test("un host che si presenta con un'altra chiave non riceve la credenziale", async (t) => {
  const b = await banco(t);
  const primo = await host(t);
  await b.vault.inserisci({ nome: "prova", tipo: "password", utente: "mario", host: [`127.0.0.1:${primo.porta}`], segreto: PASSWORD });
  assert.equal((await b.operazioni.usa(richiesta(primo.porta, "uptime"))).esito, "eseguito");
  const porta = primo.porta;
  await primo.chiudi();

  // Sulla stessa porta risponde un altro host, con un'altra chiave.
  const impostore = await host(t, { porta });
  const esito = await b.operazioni.usa(richiesta(porta, "uptime"));
  assert.equal(esito.esito, "rifiutato");
  assert.match(esito.esito === "rifiutato" ? esito.motivo : "", /chiave diversa/);
  assert.equal(impostore.tentativi, 0);
  assert.deepEqual(impostore.comandi, []);
});

test("vault chiuso, password sbagliata e host spento: il comando non parte e il registro lo dice", async (t) => {
  const b = await banco(t);
  const h = await host(t);
  await b.vault.inserisci({ nome: "prova", tipo: "password", utente: "mario", host: [`127.0.0.1:${h.porta}`, "127.0.0.1:1"], segreto: "password-sbagliata" });

  const negato = await b.operazioni.usa(richiesta(h.porta, "uptime"));
  assert.equal(negato.esito, "fallito");
  assert.match(negato.esito === "fallito" ? negato.motivo : "", /non ha accettato la credenziale/);
  assert.ok(!JSON.stringify(negato).includes("password-sbagliata"));

  const spento = await b.operazioni.usa({ ...richiesta(1, "uptime"), host: "127.0.0.1:1" });
  assert.equal(spento.esito, "fallito");

  b.vault.chiudi();
  const chiuso = await b.operazioni.usa(richiesta(h.porta, "uptime"));
  assert.equal(chiuso.esito, "rifiutato");
  assert.match(chiuso.esito === "rifiutato" ? chiuso.motivo : "", /Il vault è chiuso/);

  assert.deepEqual(h.comandi, []);
  assert.deepEqual(b.registro.ultime(3).map((voce) => voce.esito), ["rifiutato", "fallito", "fallito"]);
});

test("un divieto fisso viene rifiutato prima di aprire il vault", async (t) => {
  const b = await banco(t);
  const h = await host(t);
  await b.vault.inserisci({ nome: "prova", tipo: "password", utente: "mario", host: [`127.0.0.1:${h.porta}`], segreto: PASSWORD });
  const esito = await b.operazioni.usa(richiesta(h.porta, "sudo passwd mario"));
  assert.equal(esito.esito, "rifiutato");
  assert.match(esito.esito === "rifiutato" ? esito.motivo : "", /Divieto fisso: cambiare una password/);
  assert.deepEqual(h.comandi, []);
  assert.equal(h.tentativi, 0);
});

test("se l'host restituisce il valore, torna nascosto", async (t) => {
  const b = await banco(t);
  const h = await host(t, { esegui: () => ({ uscita: `la password è ${PASSWORD}\n`, errori: `ancora ${PASSWORD}` }) });
  await b.vault.inserisci({ nome: "prova", tipo: "password", utente: "mario", host: [`127.0.0.1:${h.porta}`], segreto: PASSWORD });
  const esito = await b.operazioni.usa(richiesta(h.porta, `echo ${PASSWORD}`));
  assert.equal(esito.esito, "eseguito");
  assert.ok(!JSON.stringify(esito).includes(PASSWORD));
  assert.match(esito.esito === "eseguito" ? esito.uscita : "", /la password è \[credenziale del vault\]/);
  assert.ok(!(await readFile(b.fileRegistro, "utf8")).includes(PASSWORD));
});

test("un comando che dura troppo viene fermato, e un'uscita lunghissima torna tagliata", async (t) => {
  const b = await banco(t);
  const h = await host(t, {
    esegui: (comando) => (comando === "lento" ? { uscita: "mai", attesaMs: 5_000 } : { uscita: "x".repeat(200_000) }),
  });
  await b.vault.inserisci({ nome: "prova", tipo: "password", utente: "mario", host: [`127.0.0.1:${h.porta}`], segreto: PASSWORD });

  const lento = await b.operazioni.usa({ ...richiesta(h.porta, "lento"), secondi: 1 });
  assert.equal(lento.esito, "eseguito");
  assert.equal(lento.esito === "eseguito" && lento.scaduto, true);
  assert.equal(lento.esito === "eseguito" && lento.codice, null);

  const lungo = await b.operazioni.usa(richiesta(h.porta, "lungo"));
  assert.equal(lungo.esito, "eseguito");
  const uscita = lungo.esito === "eseguito" ? lungo.uscita : "";
  assert.ok(uscita.length < 40_000);
  assert.match(uscita, /tagliati \d+ caratteri/);
});

test("il registro si ritrova dopo un riavvio, dalla riga più recente", async (t) => {
  const b = await banco(t);
  const h = await host(t);
  await b.vault.inserisci({ nome: "prova", tipo: "password", utente: "mario", host: [`127.0.0.1:${h.porta}`], segreto: PASSWORD });
  await b.operazioni.usa(richiesta(h.porta, "primo"));
  await b.operazioni.usa(richiesta(h.porta, "secondo"));
  const riaperto = await Registro.apri(b.fileRegistro);
  assert.deepEqual(riaperto.ultime(10).map((voce) => voce.comando), ["secondo", "primo"]);
});

const RECINTO = { porte: { da: 7900, a: 7999 }, radice: "/mnt/user/appdata/shinka-stack" };

test("su un host per gli stack un comando libero aspetta l'approvazione, e si esegue com'era stato chiesto", async (t) => {
  const b = await banco(t);
  const h = await host(t);
  await b.vault.inserisci({ nome: "prova", tipo: "password", utente: "mario", host: [`127.0.0.1:${h.porta}`], segreto: PASSWORD, stack: RECINTO });

  const chiesto = await b.operazioni.usa(richiesta(h.porta, "docker stop plex"));
  assert.equal(chiesto.esito, "da-approvare");
  const approvazione = chiesto.esito === "da-approvare" ? chiesto.approvazione : "";
  assert.ok(approvazione.length >= 16);
  assert.ok(chiesto.esito === "da-approvare" && Date.parse(chiesto.scadeIl) > Date.now());
  // Finché il proprietario non decide, all'host non arriva nulla e non c'è nemmeno un tentativo.
  assert.deepEqual(h.comandi, []);
  assert.equal(h.tentativi, 0);

  const eseguito = await b.operazioni.decidi(approvazione, "approvata");
  assert.equal(eseguito.esito, "eseguito");
  assert.deepEqual(h.comandi, ["docker stop plex"]);
  const voce = b.registro.ultime(1)[0];
  assert.equal(voce?.esito, "eseguito");
  assert.equal(voce?.comando, "docker stop plex");
  assert.equal(voce?.motivo, "Approvato dal proprietario.");

  // Un'approvazione vale una volta sola, e una inventata non vale.
  assert.equal((await b.operazioni.decidi(approvazione, "approvata")).esito, "rifiutato");
  assert.equal((await b.operazioni.decidi("inventata", "approvata")).esito, "rifiutato");
  assert.deepEqual(h.comandi, ["docker stop plex"]);
});

test("senza approvazione il comando non parte: negata, scaduta, o a vault richiuso", async (t) => {
  const cartella = await mkdtemp(join(tmpdir(), "shinka-gateway-"));
  t.after(() => rm(cartella, { recursive: true, force: true }));
  const vault = await Vault.apri(join(cartella, "vault.json"), COSTO);
  await vault.imposta(FRASE);
  const registro = await Registro.apri(join(cartella, "registro.jsonl"));
  const operazioni = new Operazioni(vault, registro, 60);
  const h = await host(t);
  const altro = await host(t);
  await vault.inserisci({ nome: "prova", tipo: "password", utente: "mario", host: [`127.0.0.1:${h.porta}`, `127.0.0.1:${altro.porta}`], segreto: PASSWORD, stack: RECINTO });
  // Sullo stesso host anche un'altra credenziale passa dall'approvazione.
  await vault.inserisci({ nome: "seconda", tipo: "password", utente: "mario", host: [`127.0.0.1:${h.porta}`], segreto: PASSWORD });

  const identificativo = async (comando: string, credenziale = "prova"): Promise<string> => {
    const esito = await operazioni.usa(richiesta(h.porta, comando, credenziale));
    assert.equal(esito.esito, "da-approvare", comando);
    return esito.esito === "da-approvare" ? esito.approvazione : "";
  };

  const negata = await operazioni.decidi(await identificativo("docker rm -f plex", "seconda"), "negata");
  assert.equal(negata.esito, "rifiutato");
  assert.match(negata.esito === "rifiutato" ? negata.motivo : "", /ha negato l'approvazione/);
  assert.equal(registro.ultime(1)[0]?.comando, "docker rm -f plex");

  // Il tempo finisce da solo, e dopo non si approva più.
  const scaduta = await identificativo("docker restart plex");
  await new Promise((fatto) => setTimeout(fatto, 150));
  assert.match(registro.ultime(1)[0]?.motivo ?? "", /non è arrivata in tempo/);
  assert.equal((await operazioni.decidi(scaduta, "approvata")).esito, "rifiutato");

  const aVaultChiuso = await identificativo("docker stop plex");
  vault.chiudi();
  const chiuso = await operazioni.decidi(aVaultChiuso, "approvata");
  assert.equal(chiuso.esito, "rifiutato");
  assert.match(chiuso.esito === "rifiutato" ? chiuso.motivo : "", /Il vault è chiuso/);

  assert.deepEqual(h.comandi, []);
  assert.deepEqual(altro.comandi, []);
  assert.equal(h.tentativi + altro.tentativi, 0);
  assert.ok(!JSON.stringify(registro.ultime(10)).includes(PASSWORD));
});

test("il divieto fisso e l'host sbagliato si rifiutano subito, senza chiedere l'approvazione", async (t) => {
  const b = await banco(t);
  const h = await host(t);
  await b.vault.inserisci({ nome: "prova", tipo: "password", utente: "mario", host: [`127.0.0.1:${h.porta}`], segreto: PASSWORD, stack: RECINTO });
  assert.equal((await b.operazioni.usa(richiesta(h.porta, "passwd root"))).esito, "rifiutato");
  assert.equal((await b.operazioni.usa({ ...richiesta(h.porta, "uptime"), host: "192.168.1.9" })).esito, "rifiutato");
  // Le approvazioni in attesa hanno un tetto.
  for (let volta = 0; volta < 20; volta += 1) assert.equal((await b.operazioni.usa(richiesta(h.porta, `echo ${volta}`))).esito, "da-approvare");
  const troppe = await b.operazioni.usa(richiesta(h.porta, "echo 21"));
  assert.equal(troppe.esito, "rifiutato");
  assert.match(troppe.esito === "rifiutato" ? troppe.motivo : "", /troppi comandi in attesa/);
  assert.deepEqual(h.comandi, []);
});

test("sul server di Shinka ogni comando aspetta il sì dato al gateway: il centro non lo può dare", async (t) => {
  const b = await banco(t);
  const h = await host(t);
  await b.vault.inserisci({ nome: "unraid", tipo: "password", utente: "mario", host: [`127.0.0.1:${h.porta}`], segreto: PASSWORD, server: true });

  const chiesto = await b.operazioni.usa({ ...richiesta(h.porta, "docker restart shinka", "unraid"), conversazione: 'Progetto "Shinka"' });
  assert.ok(chiesto.esito === "da-approvare");
  assert.equal(chiesto.alGateway, true);
  // La domanda al proprietario la fa il gateway, con il comando com'è e chi lo chiede.
  const domanda = b.domande.inVista()[0];
  assert.ok(domanda);
  assert.equal(domanda.id, chiesto.approvazione);
  assert.equal(domanda.tipo, "comando");
  assert.match(domanda.titolo, new RegExp(`Eseguire questo comando su 127\\.0\\.0\\.1:${h.porta}\\?`));
  assert.match(domanda.testo, /credenziale "unraid"[\s\S]*Progetto "Shinka"[\s\S]*\n\ndocker restart shinka$/);

  // Il centro riferisce un sì: non vale, e la domanda resta aperta.
  const dalCentro = await b.operazioni.decidi(chiesto.approvazione, "approvata");
  assert.match(dalCentro.esito === "rifiutato" ? dalCentro.motivo : "", /lo può dare solo il proprietario, al gateway/);
  assert.deepEqual((await b.operazioni.attendi(chiesto.approvazione, 20)).esito, "da-approvare");
  assert.deepEqual(h.comandi, []);
  assert.equal(h.tentativi, 0);
  assert.equal(b.domande.inVista().length, 1);

  // Il proprietario dice di sì al gateway: chi aspettava lo viene a sapere, e il comando parte com'era.
  const attesa = b.operazioni.attendi(chiesto.approvazione, 5_000);
  assert.equal(b.domande.decidi(domanda.id, "approvata", "pagina"), true);
  const subito = await attesa;
  assert.equal(subito.decisione, "approvata");
  const finito = await b.operazioni.attendi(chiesto.approvazione, 5_000);
  assert.equal(finito.esito, "eseguito");
  assert.equal(finito.decisione, "approvata");
  assert.deepEqual(h.comandi, ["docker restart shinka"]);
  const voce = b.registro.ultime(1)[0];
  assert.equal(voce?.esito, "eseguito");
  assert.equal(voce?.motivo, "Approvato dal proprietario, con il sì dato al gateway.");
  assert.ok(!JSON.stringify([chiesto, domanda, subito, finito]).includes(PASSWORD));
});

test("sul server di Shinka il centro può solo ritirare; un no o il silenzio non fanno partire nulla", async (t) => {
  const cartella = await mkdtemp(join(tmpdir(), "shinka-gateway-"));
  t.after(() => rm(cartella, { recursive: true, force: true }));
  const vault = await Vault.apri(join(cartella, "vault.json"), COSTO);
  await vault.imposta(FRASE);
  const registro = await Registro.apri(join(cartella, "registro.jsonl"));
  const domande = new DomandeAlProprietario();
  t.after(() => domande.ferma());
  const operazioni = new Operazioni(vault, registro, 80, domande);
  const h = await host(t);
  const indirizzo = `127.0.0.1:${h.porta}`;
  await vault.inserisci({ nome: "unraid", tipo: "password", utente: "mario", host: [indirizzo], segreto: PASSWORD, server: true });
  // Sullo stesso server anche un'altra credenziale passa dal sì dato al gateway.
  await vault.inserisci({ nome: "seconda", tipo: "password", utente: "mario", host: [indirizzo], segreto: PASSWORD });

  const chiedi = async (comando: string, credenziale = "unraid"): Promise<string> => {
    const esito = await operazioni.usa(richiesta(h.porta, comando, credenziale));
    assert.ok(esito.esito === "da-approvare" && esito.alGateway === true, comando);
    return esito.approvazione;
  };

  // Il centro ritira la richiesta (il proprietario ha premuto "Nega" sulla scheda): vale come un no.
  const ritirata = await operazioni.decidi(await chiedi("docker rm -f shinka", "seconda"), "negata");
  assert.match(ritirata.esito === "rifiutato" ? ritirata.motivo : "", /ha negato l'approvazione/);
  assert.equal(domande.inVista().length, 0);

  // Il proprietario dice di no al gateway.
  const negata = await chiedi("docker stop shinka");
  assert.equal(domande.decidi(negata, "negata", "pagina"), true);
  const dopoIlNo = await operazioni.attendi(negata, 5_000);
  assert.equal(dopoIlNo.decisione, "negata");

  // Nessuno risponde: il tempo finisce da solo.
  const scaduta = await chiedi("docker restart shinka");
  const dopoIlSilenzio = await operazioni.attendi(scaduta, 5_000);
  assert.equal(dopoIlSilenzio.decisione, "scaduta");
  assert.match((await operazioni.attendi(scaduta, 5_000)).esito, /rifiutato/);
  assert.match(registro.ultime(1)[0]?.motivo ?? "", /non è arrivata in tempo/);

  // Un divieto fisso non arriva nemmeno alla domanda; un'approvazione inventata non c'è.
  assert.equal((await operazioni.usa(richiesta(h.porta, "passwd root", "unraid"))).esito, "rifiutato");
  assert.equal((await operazioni.attendi("inventata", 10)).esito, "rifiutato");

  assert.deepEqual(h.comandi, []);
  assert.equal(h.tentativi, 0);
});

test("un gateway che non sa chiedere da sé non esegue nulla sul server di Shinka", async (t) => {
  const b = await banco(t);
  const h = await host(t);
  await b.vault.inserisci({ nome: "unraid", tipo: "password", utente: "mario", host: [`127.0.0.1:${h.porta}`], segreto: PASSWORD, server: true });
  const esito = await new Operazioni(b.vault, b.registro).usa(richiesta(h.porta, "uptime", "unraid"));
  assert.match(esito.esito === "rifiutato" ? esito.motivo : "", /non sa chiedere il sì al proprietario/);
  assert.deepEqual(h.comandi, []);
});
