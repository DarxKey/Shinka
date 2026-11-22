import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import type { FastifyInstance } from "fastify";
import { CredenzialiInChiaro } from "./in-chiaro.ts";
import { Registro } from "./registro.ts";
import { COOKIE_VAULT, creaGateway } from "./servizio.ts";
import { daNascondere, Operazioni } from "./uso.ts";
import { CredenzialeRifiutata, UsoRifiutato, Vault, VaultChiuso, type CredenzialeDaCustodire } from "./vault.ts";

const FRASE = "una frase di sblocco di prova";
const GETTONE = "gettone-di-prova-del-centro-lungo-quanto-serve";
const DEL_CENTRO = { authorization: `Bearer ${GETTONE}` };
/** Valori finti, fatti per riconoscerli se uscissero dove non devono. */
const PROTETTO = "Valore-PROTETTO-che-non-esce-mai";
const IN_CHIARO = "Lab-Passw0rd-in-chiaro";

const PROTETTA: CredenzialeDaCustodire = { nome: "nas-root", tipo: "password", utente: "root", host: ["nas.lan"], segreto: PROTETTO };
const LAB: CredenzialeDaCustodire = { nome: "lab-dc", tipo: "password", utente: "Administrator", host: ["dc1.lab:22", "10.0.0.5"], segreto: IN_CHIARO, inChiaro: true };
const SITO: CredenzialeDaCustodire = { nome: "prova-sito", tipo: "sito", utente: "prova@esempio.it", host: ["https://prova.esempio.it"], segreto: IN_CHIARO, inChiaro: true };

interface Banco {
  vault: Vault;
  registro: Registro;
  fileVault: string;
  fileRegistro: string;
  inChiaro: CredenzialiInChiaro;
  app: FastifyInstance;
}

async function banco(t: TestContext, attesaMs?: number): Promise<Banco> {
  const cartella = await mkdtemp(join(tmpdir(), "shinka-in-chiaro-"));
  t.after(() => rm(cartella, { recursive: true, force: true }));
  const fileVault = join(cartella, "vault.json");
  const fileRegistro = join(cartella, "registro.jsonl");
  const vault = await Vault.apri(fileVault, 2 ** 10);
  const registro = await Registro.apri(fileRegistro);
  const inChiaro = new CredenzialiInChiaro(vault, registro, attesaMs);
  const app = await creaGateway({ vault, registro, operazioni: new Operazioni(vault, registro), inChiaro, gettone: GETTONE });
  t.after(() => app.close());
  await vault.imposta(FRASE);
  return { vault, registro, fileVault, fileRegistro, inChiaro, app };
}

test("una credenziale in chiaro si legge per un host o un sito in cui vale; una protetta mai", async (t) => {
  const { vault, inChiaro, fileRegistro } = await banco(t);
  await vault.inserisci(PROTETTA);
  await vault.inserisci(LAB);
  await vault.inserisci(SITO);
  assert.deepEqual(
    vault.elenco().map((c) => [c.nome, c.inChiaro === true]),
    [
      ["nas-root", false],
      ["lab-dc", true],
      ["prova-sito", true],
    ],
  );

  const letta = await inChiaro.leggi({ conversazione: "Home", credenziale: "LAB-DC", dove: "10.0.0.5" });
  assert.deepEqual(letta, { esito: "letta", nome: "lab-dc", tipo: "password", utente: "Administrator", segreto: IN_CHIARO, host: ["dc1.lab:22", "10.0.0.5:22"] });
  assert.equal((await inChiaro.leggi({ conversazione: "Home", credenziale: "prova-sito", dove: "https://prova.esempio.it/accesso" })).esito, "letta");

  const altrove = await inChiaro.leggi({ conversazione: "Home", credenziale: "lab-dc", dove: "nas.lan" });
  assert.equal(altrove.esito, "rifiutato");
  assert.match(altrove.esito === "rifiutato" ? altrove.motivo : "", /non vale per nas\.lan/);
  const sitoSimile = await inChiaro.leggi({ conversazione: "Home", credenziale: "prova-sito", dove: "https://prova.esempio.it.altro.com" });
  assert.equal(sitoSimile.esito, "rifiutato");

  const protetta = await inChiaro.leggi({ conversazione: "Home", credenziale: "nas-root", dove: "nas.lan" });
  assert.equal(protetta.esito, "rifiutato");
  assert.match(protetta.esito === "rifiutato" ? protetta.motivo : "", /protetta/);
  assert.ok(!JSON.stringify(protetta).includes(PROTETTO));

  // Il registro annota letture e rifiuti, mai il valore.
  const registro = await readFile(fileRegistro, "utf8");
  assert.match(registro, /Lettura del valore di una credenziale in chiaro/);
  assert.ok(!registro.includes(IN_CHIARO) && !registro.includes(PROTETTO));

  vault.chiudi();
  assert.equal((await inChiaro.leggi({ conversazione: "Home", credenziale: "lab-dc", dove: "10.0.0.5" })).esito, "rifiutato");
});

test("una protetta non diventa in chiaro; una in chiaro diventa protetta; una chiave di estensione non è mai in chiaro", async (t) => {
  const { vault, inChiaro } = await banco(t);
  await vault.inserisci(PROTETTA);
  await vault.inserisci(LAB);
  await assert.rejects(vault.sostituisci("nas-root", { ...PROTETTA, inChiaro: true }), CredenzialeRifiutata);
  // Una in chiaro si sostituisce restando in chiaro, oppure diventando protetta.
  assert.equal((await vault.sostituisci("lab-dc", { ...LAB, segreto: "Nuova-passw0rd" }))?.inChiaro, true);
  assert.equal((await vault.rendiProtetta("lab-dc"))?.inChiaro, undefined);
  assert.throws(() => vault.perLettura("lab-dc", "10.0.0.5"), UsoRifiutato);
  assert.equal((await inChiaro.leggi({ conversazione: "Home", credenziale: "lab-dc", dove: "10.0.0.5" })).esito, "rifiutato");
  await assert.rejects(
    vault.inserisci({ nome: "meteo", tipo: "estensione", estensione: "meteo", utente: "METEO_TOKEN", host: ["Unraid"], segreto: "abc", inChiaro: true }),
    CredenzialeRifiutata,
  );
});

test("il valore di una credenziale in chiaro non si nasconde nelle uscite; quello delle protette sì", async (t) => {
  const { vault } = await banco(t);
  await vault.inserisci(PROTETTA);
  await vault.inserisci(LAB);
  assert.deepEqual(daNascondere(vault.perUso("lab-dc", "10.0.0.5")), []);
  assert.deepEqual(daNascondere(vault.perUso("nas-root", "nas.lan")), [PROTETTO]);
  assert.ok(vault.valoriDaNascondere().includes(PROTETTO));
  assert.ok(!vault.valoriDaNascondere().includes(IN_CHIARO));
});

test("una credenziale proposta da Claude entra nel vault solo con il sì, com'era stata proposta", async (t) => {
  const { vault, inChiaro, fileRegistro } = await banco(t);
  const proposta = { conversazione: 'Progetto "Lab"', nome: "lab-root", tipo: "password" as const, utente: "root", host: ["vm1.lab"], segreto: IN_CHIARO };
  const attesa = await inChiaro.proponi(proposta);
  assert.equal(attesa.esito, "da-approvare");
  if (attesa.esito !== "da-approvare") return;
  assert.deepEqual({ ...attesa.credenziale, inseritaIl: "" }, { nome: "lab-root", tipo: "password", utente: "root", host: ["vm1.lab:22"], inChiaro: true, inseritaIl: "" });
  // Finché il proprietario non decide, nel vault non c'è.
  assert.deepEqual(vault.elenco(), []);
  // Un'altra con lo stesso nome non si propone mentre questa aspetta.
  assert.equal((await inChiaro.proponi(proposta)).esito, "rifiutato");

  const salvata = await inChiaro.decidi(attesa.approvazione, "approvata");
  assert.equal(salvata.esito, "salvata");
  assert.equal(vault.perLettura("lab-root", "vm1.lab").segreto, IN_CHIARO);
  // Una decisione vale una volta sola.
  assert.equal((await inChiaro.decidi(attesa.approvazione, "approvata")).esito, "rifiutato");
  // Un nome già preso è rifiutato subito.
  assert.equal((await inChiaro.proponi(proposta)).esito, "rifiutato");

  const negata = await inChiaro.proponi({ ...proposta, nome: "lab-altra" });
  assert.equal(negata.esito, "da-approvare");
  if (negata.esito !== "da-approvare") return;
  assert.equal((await inChiaro.decidi(negata.approvazione, "negata")).esito, "rifiutato");
  assert.deepEqual(vault.elenco().map((c) => c.nome), ["lab-root"]);

  const registro = await readFile(fileRegistro, "utf8");
  assert.match(registro, /Approvata dal proprietario/);
  assert.match(registro, /non l'ha approvata/);
  assert.ok(!registro.includes(IN_CHIARO));
});

test("una proposta scritta male, a vault chiuso o lasciata scadere non entra nel vault", async (t) => {
  const { vault, inChiaro } = await banco(t, 60);
  const base = { conversazione: "Home", nome: "lab-root", tipo: "password" as const, utente: "root", host: ["vm1.lab"], segreto: IN_CHIARO };
  assert.equal((await inChiaro.proponi({ ...base, nome: "Nome Sbagliato" })).esito, "rifiutato");
  assert.equal((await inChiaro.proponi({ ...base, host: ["non è un host"] })).esito, "rifiutato");
  assert.equal((await inChiaro.proponi({ ...base, tipo: "estensione" as unknown as "password" })).esito, "rifiutato");
  const scadra = await inChiaro.proponi(base);
  assert.equal(scadra.esito, "da-approvare");
  await new Promise((fatto) => setTimeout(fatto, 120));
  if (scadra.esito === "da-approvare") assert.equal((await inChiaro.decidi(scadra.approvazione, "approvata")).esito, "rifiutato");
  assert.deepEqual(vault.elenco(), []);
  vault.chiudi();
  assert.equal((await inChiaro.proponi(base)).esito, "rifiutato");
  assert.throws(() => vault.valutaInChiaro(base), VaultChiuso);
});

test("dal servizio: il centro legge e propone con il gettone; il proprietario segna «in chiaro» e rende protetta dalla sua pagina", async (t) => {
  const { app, vault } = await banco(t);
  const senza = await app.inject({ method: "POST", url: "/api/in-chiaro/lettura", payload: { conversazione: "Home", credenziale: "lab-dc", dove: "10.0.0.5" } });
  assert.equal(senza.statusCode, 401);

  const entrata = await app.inject({ method: "POST", url: "/vault/sblocco", payload: { frase: FRASE } });
  const cookie = entrata.cookies.find((c) => c.name === COOKIE_VAULT);
  assert.ok(cookie);
  const cookies = { [COOKIE_VAULT]: cookie.value };
  const inserita = await app.inject({ method: "POST", url: "/vault/credenziali", cookies, payload: { ...LAB } });
  assert.equal(inserita.statusCode, 200, inserita.body);
  assert.equal(inserita.json<{ credenziale: { inChiaro?: true } }>().credenziale.inChiaro, true);
  assert.ok(!inserita.body.includes(IN_CHIARO));

  const letta = await app.inject({ method: "POST", url: "/api/in-chiaro/lettura", headers: DEL_CENTRO, payload: { conversazione: "Home", credenziale: "lab-dc", dove: "10.0.0.5" } });
  assert.equal(letta.json<{ segreto?: string }>().segreto, IN_CHIARO);
  // Lo stato che il centro vede dice quali sono in chiaro, senza i valori.
  const stato = await app.inject({ method: "GET", url: "/api/stato", headers: DEL_CENTRO });
  assert.match(stato.body, /"inChiaro":true/);
  assert.ok(!stato.body.includes(IN_CHIARO));

  const proposta = await app.inject({
    method: "POST",
    url: "/api/in-chiaro",
    headers: DEL_CENTRO,
    payload: { conversazione: "Home", nome: "vm-root", tipo: "password", utente: "root", host: ["vm1.lab"], segreto: "Altra-passw0rd" },
  });
  const attesa = proposta.json<{ esito: string; approvazione: string }>();
  assert.equal(attesa.esito, "da-approvare");
  const decisa = await app.inject({ method: "POST", url: `/api/in-chiaro/${attesa.approvazione}`, headers: DEL_CENTRO, payload: { decisione: "approvata" } });
  assert.equal(decisa.json<{ esito: string }>().esito, "salvata");

  const protetta = await app.inject({ method: "POST", url: "/vault/credenziali/lab-dc/protezione", cookies });
  assert.equal(protetta.statusCode, 200, protetta.body);
  assert.equal(vault.elenco().find((c) => c.nome === "lab-dc")?.inChiaro, undefined);
  // Dal centro non si rende in chiaro né protetta nulla: quelle rotte sono solo della pagina.
  assert.equal((await app.inject({ method: "POST", url: "/vault/credenziali/vm-root/protezione", headers: DEL_CENTRO })).statusCode, 401);
});
