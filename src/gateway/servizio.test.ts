import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import type { FastifyInstance } from "fastify";
import { DockerDiProva } from "../prove/docker-di-prova.ts";
import { avviaHostDiProva } from "../prove/host-di-prova.ts";
import { AggiornamentoDelGateway } from "./aggiornamento.ts";
import { DomandeAlProprietario } from "./domande.ts";
import { Registro } from "./registro.ts";
import { COOKIE_VAULT, creaGateway } from "./servizio.ts";
import { StackDiProva } from "./stack.ts";
import { Operazioni } from "./uso.ts";
import { Vault } from "./vault.ts";

const FRASE = "una frase di sblocco di prova";
const PASSWORD = "P4ssword-di-prova-da-non-vedere";
const GETTONE = "gettone-di-prova-del-centro-lungo-quanto-serve";
const DEL_CENTRO = { authorization: `Bearer ${GETTONE}` };

async function gateway(t: TestContext): Promise<{ app: FastifyInstance; vault: Vault }> {
  const cartella = await mkdtemp(join(tmpdir(), "shinka-gateway-"));
  t.after(() => rm(cartella, { recursive: true, force: true }));
  const vault = await Vault.apri(join(cartella, "vault.json"), 2 ** 10);
  const registro = await Registro.apri(join(cartella, "registro.jsonl"));
  const app = await creaGateway({ vault, registro, operazioni: new Operazioni(vault, registro), gettone: GETTONE });
  t.after(() => app.close());
  return { app, vault };
}

function sessioneDa(risposta: { cookies: { name: string; value: string }[] }): Record<string, string> {
  const cookie = risposta.cookies.find((c) => c.name === COOKIE_VAULT);
  assert.ok(cookie, "manca il cookie della sessione");
  return { [COOKIE_VAULT]: cookie.value };
}

async function entra(app: FastifyInstance, percorso = "/vault/frase"): Promise<Record<string, string>> {
  const risposta = await app.inject({ method: "POST", url: percorso, payload: { frase: FRASE } });
  assert.equal(risposta.statusCode, 200, risposta.body);
  return sessioneDa(risposta);
}

test("la pagina del vault viene servita con una politica dei contenuti stretta", async (t) => {
  const { app } = await gateway(t);
  const pagina = await app.inject({ method: "GET", url: "/" });
  assert.equal(pagina.statusCode, 200);
  assert.match(pagina.headers["content-type"] as string, /text\/html/);
  assert.match(pagina.headers["content-security-policy"] as string, /default-src 'none'/);
  assert.equal(pagina.headers["cache-control"], "no-store");
  assert.equal((await app.inject({ method: "GET", url: "/vault.js" })).statusCode, 200);
  assert.equal((await app.inject({ method: "GET", url: "/vault.css" })).statusCode, 200);
});

test("il centro entra solo con il gettone, e da lì non si inserisce né si rimuove nulla", async (t) => {
  const { app } = await gateway(t);
  assert.equal((await app.inject({ method: "GET", url: "/api/stato" })).statusCode, 401);
  assert.equal(
    (await app.inject({ method: "GET", url: "/api/stato", headers: { authorization: "Bearer sbagliato" } })).statusCode,
    401,
  );
  const stato = await app.inject({ method: "GET", url: "/api/stato", headers: DEL_CENTRO });
  assert.deepEqual(stato.json(), { condizione: "da-impostare", credenziali: [] });

  // Con il gettone del centro le porte del proprietario restano chiuse.
  for (const url of ["/vault/credenziali", "/vault/chiusura", "/vault/credenziali/prova/rimozione"]) {
    const risposta = await app.inject({ method: url === "/vault/credenziali" ? "GET" : "POST", url, headers: DEL_CENTRO });
    assert.equal(risposta.statusCode, 401, url);
  }
  assert.equal((await app.inject({ method: "POST", url: "/api/credenziali", headers: DEL_CENTRO, payload: {} })).statusCode, 404);
});

test("il proprietario imposta la frase, inserisce, sostituisce e rimuove; il valore non torna mai", async (t) => {
  const { app } = await gateway(t);
  assert.deepEqual((await app.inject({ method: "GET", url: "/vault/stato" })).json(), { condizione: "da-impostare", dentro: false });
  assert.equal((await app.inject({ method: "GET", url: "/vault/credenziali" })).statusCode, 401);
  assert.equal((await app.inject({ method: "POST", url: "/vault/frase", payload: { frase: "corta" } })).statusCode, 400);

  const cookies = await entra(app);
  assert.deepEqual((await app.inject({ method: "GET", url: "/vault/stato", cookies })).json(), { condizione: "aperto", dentro: true });

  const credenziale = { nome: "prova", tipo: "password", utente: "mario", host: ["nas.lan"], segreto: PASSWORD };
  const inserita = await app.inject({ method: "POST", url: "/vault/credenziali", cookies, payload: credenziale });
  assert.equal(inserita.statusCode, 200, inserita.body);
  assert.equal((await app.inject({ method: "POST", url: "/vault/credenziali", cookies, payload: credenziale })).statusCode, 400);

  const sostituita = await app.inject({
    method: "POST",
    url: "/vault/credenziali/prova",
    cookies,
    payload: { ...credenziale, host: ["nas.lan", "altro.lan:2222"] },
  });
  assert.equal(sostituita.statusCode, 200);
  const elenco = await app.inject({ method: "GET", url: "/vault/credenziali", cookies });
  assert.deepEqual(elenco.json().credenziali[0].host, ["nas.lan:22", "altro.lan:2222"]);

  const statoCentro = await app.inject({ method: "GET", url: "/api/stato", headers: DEL_CENTRO });
  assert.equal(statoCentro.json().credenziali[0].nome, "prova");
  for (const risposta of [inserita, sostituita, elenco, statoCentro]) assert.ok(!risposta.body.includes(PASSWORD));

  assert.equal((await app.inject({ method: "POST", url: "/vault/credenziali/prova/rimozione", cookies })).statusCode, 200);
  assert.equal((await app.inject({ method: "POST", url: "/vault/credenziali/prova/rimozione", cookies })).statusCode, 404);
});

test("uscire lascia il vault aperto per Claude; chiuderlo lo ferma per tutti", async (t) => {
  const { app, vault } = await gateway(t);
  const cookies = await entra(app);

  assert.equal((await app.inject({ method: "POST", url: "/vault/uscita", cookies })).statusCode, 200);
  assert.equal(vault.condizione, "aperto");
  assert.equal((await app.inject({ method: "GET", url: "/vault/credenziali", cookies })).statusCode, 401);

  // A vault aperto si rientra con la frase, e una frase sbagliata non entra.
  const sbagliata = await app.inject({ method: "POST", url: "/vault/sblocco", payload: { frase: "non è questa la frase" } });
  assert.equal(sbagliata.statusCode, 401);
  const dentro = await entra(app, "/vault/sblocco");

  assert.equal((await app.inject({ method: "POST", url: "/vault/chiusura", cookies: dentro })).statusCode, 200);
  assert.equal(vault.condizione, "chiuso");
  assert.equal((await app.inject({ method: "GET", url: "/vault/credenziali", cookies: dentro })).statusCode, 401);
  assert.deepEqual((await app.inject({ method: "GET", url: "/api/stato", headers: DEL_CENTRO })).json(), {
    condizione: "chiuso",
    credenziali: [],
  });
});

test("dopo tre frasi sbagliate bisogna aspettare", async (t) => {
  const { app } = await gateway(t);
  await entra(app);
  const prova = (frase: string) => app.inject({ method: "POST", url: "/vault/sblocco", payload: { frase } });
  for (let volta = 0; volta < 3; volta += 1) assert.equal((await prova("frase sbagliata numero uno")).statusCode, 401);
  const frenata = await prova(FRASE);
  assert.equal(frenata.statusCode, 429);
  assert.match(frenata.json().errore, /riprova tra/);
});

test("una richiesta che arriva da un'altra pagina viene rifiutata", async (t) => {
  const { app } = await gateway(t);
  const cookies = await entra(app);
  const risposta = await app.inject({
    method: "POST",
    url: "/vault/chiusura",
    cookies,
    headers: { origin: "http://altrove.example", host: "gateway.lan:7851" },
  });
  assert.equal(risposta.statusCode, 403);
});

test("il centro chiede un comando su un host e lo ritrova nel registro", async (t) => {
  const { app, vault } = await gateway(t);
  const host = await avviaHostDiProva({ utente: "mario", password: PASSWORD, esegui: () => ({ uscita: "tutto bene\n" }) });
  t.after(() => host.chiudi());
  const cookies = await entra(app);
  await vault.inserisci({ nome: "prova", tipo: "password", utente: "mario", host: [`127.0.0.1:${host.porta}`], segreto: PASSWORD });

  const uso = await app.inject({
    method: "POST",
    url: "/api/uso",
    headers: DEL_CENTRO,
    payload: { credenziale: "prova", host: `127.0.0.1:${host.porta}`, comando: "uptime", conversazione: 'Progetto "Prova"' },
  });
  assert.equal(uso.statusCode, 200, uso.body);
  assert.equal(uso.json().esito, "eseguito");
  assert.equal(uso.json().uscita, "tutto bene\n");

  const senzaGettone = await app.inject({
    method: "POST",
    url: "/api/uso",
    payload: { credenziale: "prova", host: `127.0.0.1:${host.porta}`, comando: "uptime", conversazione: "x" },
  });
  assert.equal(senzaGettone.statusCode, 401);

  for (const registro of [
    await app.inject({ method: "GET", url: "/api/registro", headers: DEL_CENTRO }),
    await app.inject({ method: "GET", url: "/vault/credenziali", cookies }),
  ]) {
    assert.ok(!registro.body.includes(PASSWORD));
    const voci = registro.json().voci ?? registro.json().registro;
    assert.equal(voci[0].conversazione, 'Progetto "Prova"');
    assert.equal(voci[0].comando, "uptime");
  }
  assert.deepEqual(host.comandi, ["uptime"]);
});

test("il browser si chiede con il gettone del centro, e la richiesta deve avere ciò che serve", async (t) => {
  const { app } = await gateway(t);
  const corpo = { conversazione: "Home", chiave: "home:1" };
  assert.equal((await app.inject({ method: "POST", url: "/api/browser", payload: { ...corpo, operazione: "leggi" } })).statusCode, 401);
  const senzaBrowser = await app.inject({ method: "POST", url: "/api/browser", headers: DEL_CENTRO, payload: { ...corpo, operazione: "leggi" } });
  assert.equal(senzaBrowser.statusCode, 200);
  assert.match(senzaBrowser.json().motivo, /non ha un browser/);
  const senzaIndirizzo = await app.inject({ method: "POST", url: "/api/browser", headers: DEL_CENTRO, payload: { ...corpo, operazione: "apri" } });
  assert.equal(senzaIndirizzo.json().esito, "rifiutato");
  for (const sbagliata of [{ ...corpo, operazione: "esegui-script" }, { ...corpo, operazione: "agisci", azione: "esegui" }, { operazione: "leggi" }]) {
    assert.equal((await app.inject({ method: "POST", url: "/api/browser", headers: DEL_CENTRO, payload: sbagliata })).statusCode, 400);
  }
});

test("il proprietario inserisce una credenziale per un sito, e chiudere il vault chiude il browser", async (t) => {
  const cartella = await mkdtemp(join(tmpdir(), "shinka-gateway-"));
  t.after(() => rm(cartella, { recursive: true, force: true }));
  const vault = await Vault.apri(join(cartella, "vault.json"), 2 ** 10);
  const registro = await Registro.apri(join(cartella, "registro.jsonl"));
  let chiusure = 0;
  const app = await creaGateway({
    vault,
    registro,
    operazioni: new Operazioni(vault, registro),
    gettone: GETTONE,
    browser: {
      esegui: async (richiesta) => ({ esito: "fatto", testo: `${richiesta.operazione} per ${richiesta.conversazione}` }),
      chiudi: async () => {
        chiusure += 1;
      },
    },
  });
  t.after(() => app.close());
  const cookies = await entra(app);

  const inserita = await app.inject({
    method: "POST",
    url: "/vault/credenziali",
    cookies,
    payload: { nome: "banca", tipo: "sito", utente: "mario@esempio.it", host: ["www.banca.example"], segreto: PASSWORD },
  });
  assert.equal(inserita.statusCode, 200, inserita.body);
  assert.deepEqual(inserita.json().credenziale.host, ["https://www.banca.example"]);
  assert.ok(!inserita.body.includes(PASSWORD));
  const stato = await app.inject({ method: "GET", url: "/api/stato", headers: DEL_CENTRO });
  assert.equal(stato.json().credenziali[0].tipo, "sito");
  assert.ok(!stato.body.includes(PASSWORD));

  const fatta = await app.inject({
    method: "POST",
    url: "/api/browser",
    headers: DEL_CENTRO,
    payload: { conversazione: "Home", chiave: "home:1", operazione: "inserisci", credenziale: "banca" },
  });
  assert.deepEqual(fatta.json(), { esito: "fatto", testo: "inserisci per Home" });

  assert.equal(chiusure, 0);
  assert.equal((await app.inject({ method: "POST", url: "/vault/chiusura", cookies })).statusCode, 200);
  assert.equal(chiusure, 1);
});

test("il proprietario dichiara un host per gli stack; il centro chiede stack e approvazioni, ma non cambia il recinto", async (t) => {
  const cartella = await mkdtemp(join(tmpdir(), "shinka-gateway-"));
  t.after(() => rm(cartella, { recursive: true, force: true }));
  const vault = await Vault.apri(join(cartella, "vault.json"), 2 ** 10);
  const registro = await Registro.apri(join(cartella, "registro.jsonl"));
  const app = await creaGateway({
    vault,
    registro,
    operazioni: new Operazioni(vault, registro),
    stack: new StackDiProva(vault, registro),
    gettone: GETTONE,
  });
  t.after(() => app.close());
  const docker = new DockerDiProva();
  const host = await avviaHostDiProva({ utente: "root", password: PASSWORD, esegui: (comando, ingresso) => docker.esegui(comando, ingresso) });
  t.after(() => host.chiudi());
  const indirizzo = `127.0.0.1:${host.porta}`;
  const cookies = await entra(app);

  const credenziale = { nome: "lab", tipo: "password", utente: "root", host: [indirizzo], segreto: PASSWORD };
  const malScritta = await app.inject({
    method: "POST",
    url: "/vault/credenziali",
    cookies,
    payload: { ...credenziale, stack: { porte: { da: 80, a: 90 }, radice: "/mnt/user/stack" } },
  });
  assert.equal(malScritta.statusCode, 400);
  assert.match(malScritta.json().errore, /tra 1024 e 65535/);
  const stack = { porte: { da: 7900, a: 7999 }, radice: "/mnt/user/appdata/shinka-stack" };
  const inserita = await app.inject({ method: "POST", url: "/vault/credenziali", cookies, payload: { ...credenziale, stack } });
  assert.equal(inserita.statusCode, 200, inserita.body);

  // Il centro vede quali host sono per gli stack, ma con il suo gettone non lo può cambiare.
  const stato = await app.inject({ method: "GET", url: "/api/stato", headers: DEL_CENTRO });
  assert.deepEqual(stato.json().credenziali[0].stack, stack);
  const dalCentro = await app.inject({ method: "POST", url: "/vault/credenziali/lab", headers: DEL_CENTRO, payload: credenziale });
  assert.equal(dalCentro.statusCode, 401);

  const descrizione = { nome: "prova", servizi: [{ nome: "web", immagine: "nginx:alpine", porte: [{ host: 7901, container: 80 }] }] };
  assert.equal((await app.inject({ method: "POST", url: "/api/stack", payload: { conversazione: "Home", operazione: "elenca" } })).statusCode, 401);
  const senzaNome = await app.inject({ method: "POST", url: "/api/stack", headers: DEL_CENTRO, payload: { conversazione: "Home", operazione: "ferma", host: indirizzo } });
  assert.equal(senzaNome.json().esito, "rifiutato");
  const avviato = await app.inject({
    method: "POST",
    url: "/api/stack",
    headers: DEL_CENTRO,
    payload: { conversazione: "Home", operazione: "avvia", host: indirizzo, stack: descrizione },
  });
  assert.equal(avviato.json().esito, "fatto", avviato.body);
  assert.deepEqual(docker.container.map((uno) => uno.nome), ["plex", "shinka-prova-web-1"]);

  // Fermare un servizio del proprietario: il comando aspetta, e parte solo con l'approvazione.
  const uso = { credenziale: "lab", host: indirizzo, comando: "docker stop plex", conversazione: "Home" };
  const chiesto = await app.inject({ method: "POST", url: "/api/uso", headers: DEL_CENTRO, payload: uso });
  assert.equal(chiesto.json().esito, "da-approvare");
  assert.equal(docker.container[0]?.stato, "running");
  const id = chiesto.json().approvazione as string;
  assert.equal((await app.inject({ method: "POST", url: `/api/approvazioni/${id}`, payload: { decisione: "approvata" } })).statusCode, 401);
  assert.equal((await app.inject({ method: "POST", url: `/api/approvazioni/${id}`, headers: DEL_CENTRO, payload: { decisione: "forse" } })).statusCode, 400);
  const negata = await app.inject({ method: "POST", url: `/api/approvazioni/${id}`, headers: DEL_CENTRO, payload: { decisione: "negata" } });
  assert.equal(negata.json().esito, "rifiutato");
  assert.equal(docker.container[0]?.stato, "running");

  const dinuovo = await app.inject({ method: "POST", url: "/api/uso", headers: DEL_CENTRO, payload: uso });
  const approvata = await app.inject({
    method: "POST",
    url: `/api/approvazioni/${dinuovo.json().approvazione as string}`,
    headers: DEL_CENTRO,
    // Il comando è quello tenuto da parte dal gateway: insieme alla decisione non ne arriva un altro.
    payload: { decisione: "approvata" },
  });
  assert.equal(approvata.json().esito, "eseguito");
  assert.equal(docker.container[0]?.stato, "exited");

  const voci = (await app.inject({ method: "GET", url: "/api/registro", headers: DEL_CENTRO })).json().voci as { esito: string; comando: string }[];
  assert.deepEqual(
    voci.slice(0, 3).map((voce) => [voce.esito, voce.comando]),
    [
      ["eseguito", "docker stop plex"],
      ["rifiutato", "docker stop plex"],
      ["eseguito", 'Stack "prova": avvio. Servizi: web (nginx:alpine; porte 7901)'],
    ],
  );
});

test("senza il modulo degli stack il gateway lo dice", async (t) => {
  const { app } = await gateway(t);
  const risposta = await app.inject({ method: "POST", url: "/api/stack", headers: DEL_CENTRO, payload: { conversazione: "Home", operazione: "elenca" } });
  assert.equal(risposta.json().esito, "rifiutato");
});

test("un comando sul server di Shinka: il centro lo chiede e aspetta, il sì si dà solo dalla pagina del vault", async (t) => {
  const cartella = await mkdtemp(join(tmpdir(), "shinka-gateway-"));
  t.after(() => rm(cartella, { recursive: true, force: true }));
  const vault = await Vault.apri(join(cartella, "vault.json"), 2 ** 10);
  const registro = await Registro.apri(join(cartella, "registro.jsonl"));
  const domande = new DomandeAlProprietario();
  const app = await creaGateway({ vault, registro, operazioni: new Operazioni(vault, registro, undefined, domande), domande, gettone: GETTONE });
  t.after(() => app.close());
  const host = await avviaHostDiProva({ utente: "root", password: PASSWORD, esegui: () => ({ uscita: "riavviato\n" }) });
  t.after(() => host.chiudi());
  const indirizzo = `127.0.0.1:${host.porta}`;
  const cookies = await entra(app);

  const inserita = await app.inject({
    method: "POST",
    url: "/vault/credenziali",
    cookies,
    payload: { nome: "unraid", tipo: "password", utente: "root", host: [indirizzo], segreto: PASSWORD, server: true },
  });
  assert.equal(inserita.statusCode, 200, inserita.body);
  assert.equal((await app.inject({ method: "GET", url: "/api/stato", headers: DEL_CENTRO })).json().credenziali[0].server, true);

  const chiesto = await app.inject({
    method: "POST",
    url: "/api/uso",
    headers: DEL_CENTRO,
    payload: { credenziale: "unraid", host: indirizzo, comando: "docker restart shinka", conversazione: "Home" },
  });
  assert.equal(chiesto.json().esito, "da-approvare");
  assert.equal(chiesto.json().alGateway, true);
  const id = chiesto.json().approvazione as string;

  // Chi apre la pagina sa che c'è una domanda; che cosa chiede lo legge solo chi è entrato con la frase.
  assert.deepEqual((await app.inject({ method: "GET", url: "/vault/stato" })).json(), { condizione: "aperto", dentro: false, domande: 1 });
  assert.equal((await app.inject({ method: "GET", url: "/vault/domande" })).statusCode, 401);
  assert.equal((await app.inject({ method: "GET", url: "/vault/domande", headers: DEL_CENTRO })).statusCode, 401);
  const viste = (await app.inject({ method: "GET", url: "/vault/domande", cookies })).json().domande as { id: string; testo: string; si: string }[];
  assert.equal(viste.length, 1);
  assert.equal(viste[0]?.id, id);
  assert.match(viste[0]?.testo ?? "", /docker restart shinka$/);

  // Con il gettone del centro il sì non si dà: né riferendolo, né dalla porta del proprietario.
  const riferito = await app.inject({ method: "POST", url: `/api/approvazioni/${id}`, headers: DEL_CENTRO, payload: { decisione: "approvata" } });
  assert.equal(riferito.json().esito, "rifiutato");
  const dallaPorta = await app.inject({ method: "POST", url: `/vault/domande/${id}`, headers: DEL_CENTRO, payload: { decisione: "approvata" } });
  assert.equal(dallaPorta.statusCode, 401);
  assert.equal((await app.inject({ method: "POST", url: `/vault/domande/${id}`, payload: { decisione: "approvata" } })).statusCode, 401);
  assert.equal((await app.inject({ method: "GET", url: `/api/approvazioni/${id}?attesa=0` })).statusCode, 401);
  const ancora = await app.inject({ method: "GET", url: `/api/approvazioni/${id}?attesa=0`, headers: DEL_CENTRO });
  assert.equal(ancora.json().esito, "da-approvare");
  assert.deepEqual(host.comandi, []);

  // Il proprietario, entrato con la sua frase, dice di sì.
  assert.equal((await app.inject({ method: "POST", url: `/vault/domande/${id}`, cookies, payload: { decisione: "forse" } })).statusCode, 400);
  const detto = await app.inject({ method: "POST", url: `/vault/domande/${id}`, cookies, payload: { decisione: "approvata" } });
  assert.equal(detto.statusCode, 200, detto.body);
  assert.deepEqual(detto.json().domande, []);
  assert.equal((await app.inject({ method: "POST", url: `/vault/domande/${id}`, cookies, payload: { decisione: "approvata" } })).statusCode, 404);

  let finito = await app.inject({ method: "GET", url: `/api/approvazioni/${id}?attesa=10`, headers: DEL_CENTRO });
  if (finito.json().esito === "da-approvare") finito = await app.inject({ method: "GET", url: `/api/approvazioni/${id}?attesa=10`, headers: DEL_CENTRO });
  assert.equal(finito.json().esito, "eseguito", finito.body);
  assert.equal(finito.json().decisione, "approvata");
  assert.equal(finito.json().uscita, "riavviato\n");
  assert.deepEqual(host.comandi, ["docker restart shinka"]);
  assert.deepEqual((await app.inject({ method: "GET", url: "/vault/stato" })).json(), { condizione: "aperto", dentro: false });
});

test("una versione nuova del gateway: il centro la propone con il suo gettone, il proprietario decide dalla pagina", async (t) => {
  const cartella = await mkdtemp(join(tmpdir(), "shinka-gateway-"));
  t.after(() => rm(cartella, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const PRIMA = "1111111111111111111111111111111111111111";
  const NUOVA = "2222222222222222222222222222222222222222";
  const installata = join(cartella, "shinka");
  const inFunzione: Record<string, string> = {
    "package.json": "{}",
    "package-lock.json": "{}",
    "versione.json": JSON.stringify({ versione: PRIMA }),
    "src/gateway/avvio.ts": "console.log('prima');\n",
  };
  for (const [percorso, testo] of Object.entries(inFunzione)) {
    await mkdir(join(installata, percorso, ".."), { recursive: true });
    await writeFile(join(installata, percorso), testo);
  }
  const pacchetto = (avvio: string) =>
    Object.entries({ ...inFunzione, "versione.json": JSON.stringify({ versione: NUOVA }), "src/gateway/avvio.ts": avvio }).map(([percorso, testo]) => ({
      percorso,
      dati: Buffer.from(testo).toString("base64"),
    }));

  const vault = await Vault.apri(join(cartella, "vault.json"), 2 ** 10);
  const registro = await Registro.apri(join(cartella, "registro.jsonl"));
  const domande = new DomandeAlProprietario();
  let riavvii = 0;
  const aggiornamento = await AggiornamentoDelGateway.apri({
    installata,
    fileInstallazione: join(cartella, "dati", "installazione.json"),
    colGuardiano: true,
    domande,
    registro,
    riavvia: () => {
      riavvii += 1;
    },
  });
  const app = await creaGateway({ vault, registro, operazioni: new Operazioni(vault, registro, undefined, domande), domande, aggiornamento, gettone: GETTONE });
  t.after(() => app.close());

  const stato = async () => (await app.inject({ method: "GET", url: "/api/stato", headers: DEL_CENTRO })).json();
  assert.deepEqual(await stato(), { condizione: "da-impostare", credenziali: [], versione: PRIMA, siAggiorna: true });

  const proposta = { versione: NUOVA, riassunto: "Il gateway impara una cosa nuova.", file: pacchetto("console.log('nuovo');\n") };
  assert.equal((await app.inject({ method: "POST", url: "/api/aggiornamento", payload: proposta })).statusCode, 401);
  const proposto = await app.inject({ method: "POST", url: "/api/aggiornamento", headers: DEL_CENTRO, payload: proposta });
  assert.equal(proposto.statusCode, 200, proposto.body);
  assert.equal(proposto.json().esito, "da-approvare");
  assert.deepEqual(proposto.json().cambiano, ["src/gateway/avvio.ts"]);
  assert.equal((await stato()).aggiornamento.stato, "in-attesa");

  // Anche a vault mai aperto la domanda c'è; per leggerla e rispondere serve la frase.
  const cookies = await entra(app);
  const viste = (await app.inject({ method: "GET", url: "/vault/domande", cookies })).json();
  assert.equal(viste.versione, PRIMA);
  assert.equal(viste.siAggiorna, true);
  assert.match(viste.domande[0].titolo, /Installare la versione 22222222 del gateway\?/);
  const id = viste.domande[0].id as string;
  assert.equal((await app.inject({ method: "POST", url: `/vault/domande/${id}`, headers: DEL_CENTRO, payload: { decisione: "approvata" } })).statusCode, 401);
  assert.equal((await app.inject({ method: "POST", url: `/vault/domande/${id}`, cookies, payload: { decisione: "negata" } })).statusCode, 200);
  for (let volta = 0; volta < 100 && (await stato()).aggiornamento.stato === "in-attesa"; volta += 1) await new Promise((fatto) => setTimeout(fatto, 10));
  assert.deepEqual((await stato()).aggiornamento, { stato: "negato", versione: NUOVA });
  assert.equal(riavvii, 0);

  // Una versione che non cambia nulla del gateway passa senza domande.
  const uguale = await app.inject({ method: "POST", url: "/api/aggiornamento", headers: DEL_CENTRO, payload: { ...proposta, file: pacchetto("console.log('prima');\n") } });
  assert.deepEqual(uguale.json(), { esito: "uguale" });
  assert.deepEqual(await stato(), { condizione: "aperto", credenziali: [], versione: NUOVA, siAggiorna: true });
});

test("la copia del vault: si scarica solo da dentro, resta cifrata, e si ricarica con la sua frase dove serve", async (t) => {
  const { app } = await gateway(t);
  // Senza la frase non c'è copia, e il centro con il suo gettone non la può chiedere.
  assert.equal((await app.inject({ method: "GET", url: "/vault/copia" })).statusCode, 401);
  assert.equal((await app.inject({ method: "GET", url: "/api/copia", headers: DEL_CENTRO })).statusCode, 404);
  const cookies = await entra(app);
  const credenziale = { nome: "nas", tipo: "password", utente: "mario", host: ["nas.lan"], segreto: PASSWORD };
  assert.equal((await app.inject({ method: "POST", url: "/vault/credenziali", cookies, payload: credenziale })).statusCode, 200);
  const scaricata = await app.inject({ method: "GET", url: "/vault/copia", cookies });
  assert.equal(scaricata.statusCode, 200, scaricata.body);
  assert.match(String(scaricata.headers["content-disposition"]), /attachment; filename="shinka-vault-\d{4}-\d{2}-\d{2}\.json"/);
  assert.ok(!scaricata.body.includes(PASSWORD) && !scaricata.body.includes("nas.lan") && !scaricata.body.includes("mario"));
  const copia = scaricata.json() as { tipo: string; vault: { cifrato: string } };
  assert.equal(copia.tipo, "shinka-copia-del-vault");

  // Dopo la copia il vault cambia: la credenziale di prima se ne va, ne arriva un'altra.
  await app.inject({ method: "POST", url: "/vault/credenziali/nas/rimozione", cookies });
  await app.inject({ method: "POST", url: "/vault/credenziali", cookies, payload: { ...credenziale, nome: "dopo" } });

  // Da fuori, a vault impostato, il ripristino non parte; da dentro serve la frase della copia.
  assert.equal((await app.inject({ method: "POST", url: "/vault/ripristino", payload: { copia, frase: FRASE } })).statusCode, 401);
  assert.equal((await app.inject({ method: "POST", url: "/vault/ripristino", cookies, payload: { copia, frase: "non è la frase della copia" } })).statusCode, 401);
  assert.equal((await app.inject({ method: "POST", url: "/vault/ripristino", cookies, payload: { copia: { tipo: "altro" }, frase: FRASE } })).statusCode, 400);
  // Il primo carattere cambia di sicuro: se fosse già quello, la copia non sarebbe manomessa.
  const manomessa = { ...copia, vault: { ...copia.vault, cifrato: `${copia.vault.cifrato.startsWith("A") ? "B" : "A"}${copia.vault.cifrato.slice(1)}` } };
  assert.equal((await app.inject({ method: "POST", url: "/vault/ripristino", cookies, payload: { copia: manomessa, frase: FRASE } })).statusCode, 401);
  assert.deepEqual((await app.inject({ method: "GET", url: "/vault/credenziali", cookies })).json().credenziali.map((voce: { nome: string }) => voce.nome), ["dopo"]);

  const ripristinato = await app.inject({ method: "POST", url: "/vault/ripristino", cookies, payload: { copia, frase: FRASE } });
  assert.equal(ripristinato.statusCode, 200, ripristinato.body);
  const dopo = (await app.inject({ method: "GET", url: "/vault/credenziali", cookies })).json() as { credenziali: { nome: string }[]; registro: { comando: string }[] };
  assert.deepEqual(dopo.credenziali.map((voce) => voce.nome), ["nas"]);
  assert.deepEqual(dopo.registro.map((voce) => voce.comando).filter((comando) => comando.includes("opia")), ["Vault ripristinato da una copia", "Copia del vault scaricata"]);

  // In un gateway nuovo, senza vault: la copia entra con la sua frase, che diventa la frase del vault.
  const nuovo = await gateway(t);
  assert.equal((await nuovo.app.inject({ method: "GET", url: "/vault/copia" })).statusCode, 401);
  assert.equal((await nuovo.app.inject({ method: "POST", url: "/vault/ripristino", payload: { copia, frase: "un'altra frase qualunque" } })).statusCode, 401);
  assert.equal(nuovo.vault.condizione, "da-impostare");
  const entrato = await nuovo.app.inject({ method: "POST", url: "/vault/ripristino", payload: { copia, frase: FRASE } });
  assert.equal(entrato.statusCode, 200, entrato.body);
  const sessione = sessioneDa(entrato);
  assert.deepEqual((await nuovo.app.inject({ method: "GET", url: "/vault/credenziali", cookies: sessione })).json().credenziali.map((voce: { nome: string }) => voce.nome), ["nas"]);
  // Chiuso e riaperto, la frase è quella della copia, e la credenziale si usa come prima.
  nuovo.vault.chiudi();
  assert.equal(await nuovo.vault.sblocca(FRASE), true);
  assert.equal(nuovo.vault.perUso("nas", "nas.lan").segreto, PASSWORD);
});
