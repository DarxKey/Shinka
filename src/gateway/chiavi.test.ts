import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import type { FastifyInstance } from "fastify";
import { consegnaChiavi } from "./chiavi.ts";
import { Registro } from "./registro.ts";
import { COOKIE_VAULT, creaGateway } from "./servizio.ts";
import { Operazioni } from "./uso.ts";
import { CredenzialeRifiutata, UsoRifiutato, Vault, VaultChiuso, type CredenzialeDaCustodire } from "./vault.ts";

const FRASE = "una frase di sblocco di prova";
/** Valori finti, fatti per riconoscerli se uscissero dove non devono. */
const VALORE = "chiave-FINTA-di-prova-0001";
const ALTRO_VALORE = "chiave-FINTA-di-prova-0002";
const GETTONE = "gettone-di-prova-del-centro-lungo-quanto-serve";
const DEL_CENTRO = { authorization: `Bearer ${GETTONE}` };

const CHIAVE: CredenzialeDaCustodire = {
  nome: "meteo-unraid",
  tipo: "estensione",
  estensione: "meteo",
  utente: "METEO_TOKEN",
  host: ["Unraid"],
  segreto: `  ${VALORE}\n`,
};

interface Banco {
  vault: Vault;
  registro: Registro;
  fileVault: string;
  fileRegistro: string;
  app: FastifyInstance;
}

async function banco(t: TestContext): Promise<Banco> {
  const cartella = await mkdtemp(join(tmpdir(), "shinka-chiavi-"));
  t.after(() => rm(cartella, { recursive: true, force: true }));
  const fileVault = join(cartella, "vault.json");
  const fileRegistro = join(cartella, "registro.jsonl");
  const vault = await Vault.apri(fileVault, 2 ** 10);
  const registro = await Registro.apri(fileRegistro);
  const app = await creaGateway({ vault, registro, operazioni: new Operazioni(vault, registro), gettone: GETTONE });
  t.after(() => app.close());
  await vault.imposta(FRASE);
  return { vault, registro, fileVault, fileRegistro, app };
}

test("la chiave di un'estensione dice a chi va, come si chiama e in quali ambienti", async (t) => {
  const { vault } = await banco(t);
  const vista = await vault.inserisci(CHIAVE);
  assert.equal(vista.tipo, "estensione");
  assert.equal(vista.estensione, "meteo");
  assert.equal(vista.utente, "METEO_TOKEN");
  assert.deepEqual(vista.host, ["Unraid"]);
  assert.ok(!JSON.stringify(vista).includes(VALORE));

  const rifiutate: Partial<CredenzialeDaCustodire>[] = [
    { estensione: "" },
    { estensione: "Meteo Bello" },
    { estensione: "shinka" },
    { utente: "il mio token" },
    { utente: "" },
    { host: [] },
    { host: ["   "] },
    { host: ["x".repeat(81)] },
    { segreto: "   " },
    { segreto: "due\nrighe" },
  ];
  for (const difetto of rifiutate) {
    await assert.rejects(vault.inserisci({ ...CHIAVE, nome: "altra", ...difetto }), CredenzialeRifiutata, JSON.stringify(difetto));
  }
  assert.deepEqual(vault.elenco().map((c) => c.nome), ["meteo-unraid"]);
});

test("di una chiave ce n'è una sola per estensione e ambiente", async (t) => {
  const { vault } = await banco(t);
  await vault.inserisci(CHIAVE);
  // Lo stesso ambiente, scritto con altre maiuscole, è lo stesso ambiente.
  await assert.rejects(vault.inserisci({ ...CHIAVE, nome: "doppia", host: ["PC Windows", "unraid"], segreto: ALTRO_VALORE }), /già nel vault.*meteo-unraid/);
  // In un altro ambiente, per un'altra chiave o per un'altra estensione, sì.
  await vault.inserisci({ ...CHIAVE, nome: "meteo-pc", host: ["PC Windows"], segreto: ALTRO_VALORE });
  await vault.inserisci({ ...CHIAVE, nome: "meteo-secondo", utente: "METEO_REGIONE" });
  await vault.inserisci({ ...CHIAVE, nome: "posta-unraid", estensione: "posta" });
  // Sostituire la propria voce non è contendersela.
  assert.ok(await vault.sostituisci("meteo-unraid", { ...CHIAVE, host: ["Unraid", "Lab"] }));
  // Ma sostituendola non si invade l'ambiente di un'altra.
  await assert.rejects(vault.sostituisci("meteo-unraid", { ...CHIAVE, host: ["Unraid", "pc windows"] }), /già nel vault.*meteo-pc/);
});

test("le chiavi escono solo per la loro estensione e nel loro ambiente, tutte oppure nessuna", async (t) => {
  const { vault } = await banco(t);
  await vault.inserisci(CHIAVE);
  await vault.inserisci({ ...CHIAVE, nome: "meteo-regione", utente: "METEO_REGIONE", host: ["Unraid", "PC Windows"], segreto: ALTRO_VALORE });

  assert.deepEqual(vault.perEstensione("meteo", "unraid", ["METEO_TOKEN", "METEO_REGIONE"]), {
    valori: { METEO_TOKEN: VALORE, METEO_REGIONE: ALTRO_VALORE },
    credenziali: ["meteo-unraid", "meteo-regione"],
  });
  // Un'altra estensione non riceve la chiave di questa, nemmeno chiedendola per nome.
  assert.throws(() => vault.perEstensione("posta", "Unraid", ["METEO_TOKEN"]), UsoRifiutato);
  // In un altro ambiente no, e l'errore dice dove vale senza dire quanto vale.
  assert.throws(
    () => vault.perEstensione("meteo", "PC Windows", ["METEO_TOKEN", "METEO_REGIONE"]),
    (errore: unknown) => {
      assert.ok(errore instanceof UsoRifiutato);
      assert.match(errore.message, /manca la chiave METEO_TOKEN dell'estensione "meteo" per l'ambiente "PC Windows"/);
      assert.match(errore.message, /C'è per Unraid/);
      assert.ok(!errore.message.includes(VALORE) && !errore.message.includes(ALTRO_VALORE));
      return true;
    },
  );
  assert.throws(() => vault.perEstensione("meteo", "Unraid", ["METEO_TOKEN", "NON_ESISTE"]), /manca la chiave NON_ESISTE/);
});

test("una password o una chiave SSH non escono come chiave di un'estensione, e una chiave non si usa su un host o in un sito", async (t) => {
  const { vault } = await banco(t);
  await vault.inserisci(CHIAVE);
  await vault.inserisci({ nome: "nas-root", tipo: "password", utente: "METEO_TOKEN", host: ["unraid"], segreto: "P4ssword-FINTA-di-prova" });
  await vault.inserisci({ nome: "posta-sito", tipo: "sito", utente: "METEO_TOKEN", host: ["https://unraid"], segreto: "P4ssword-FINTA-del-sito" });

  // Anche con lo stesso "utente" e lo stesso "host", conta il tipo della voce.
  assert.deepEqual(vault.perEstensione("meteo", "Unraid", ["METEO_TOKEN"]).credenziali, ["meteo-unraid"]);
  assert.throws(() => vault.perEstensione("nas-root", "unraid", ["METEO_TOKEN"]), UsoRifiutato);

  assert.throws(() => vault.perUso("meteo-unraid", "Unraid"), UsoRifiutato);
  assert.throws(() => vault.perSito("meteo-unraid", "https://unraid"), UsoRifiutato);
  // Ma il suo valore viene tolto da ciò che il gateway restituisce, come gli altri.
  assert.ok(vault.valoriDaNascondere().includes(VALORE));
});

test("la consegna resta nel registro senza il valore, e così il rifiuto", async (t) => {
  const { vault, registro, fileRegistro, fileVault } = await banco(t);
  await vault.inserisci(CHIAVE);

  const consegnate = await consegnaChiavi(vault, registro, { estensione: "meteo", ambiente: "Unraid", chiavi: ["METEO_TOKEN"] }, Date.UTC(2026, 10, 12, 9));
  assert.deepEqual(consegnate, { esito: "consegnate", valori: { METEO_TOKEN: VALORE } });
  assert.equal(vault.elenco()[0]?.usataIl, "2026-11-12T09:00:00.000Z");

  const altrove = await consegnaChiavi(vault, registro, { estensione: "meteo", ambiente: "PC Windows", chiavi: ["METEO_TOKEN"] });
  assert.equal(altrove.esito, "rifiutato");

  const [rifiuto, consegna] = registro.ultime(2);
  assert.deepEqual(
    { ...consegna },
    {
      quando: "2026-11-12T09:00:00.000Z",
      credenziale: "meteo-unraid",
      host: "ambiente Unraid",
      conversazione: 'Estensione "meteo"',
      comando: "Consegna della chiave METEO_TOKEN al programma dell'estensione",
      esito: "eseguito",
    },
  );
  assert.equal(rifiuto?.esito, "rifiutato");
  assert.equal(rifiuto?.host, "ambiente PC Windows");
  assert.match(rifiuto?.motivo ?? "", /manca la chiave METEO_TOKEN/);

  assert.ok(!(await readFile(fileRegistro, "utf8")).includes(VALORE));
  assert.ok(!(await readFile(fileVault, "utf8")).includes(VALORE));
});

test("una richiesta scritta male, o a vault chiuso, non consegna nulla e non lancia", async (t) => {
  const { vault, registro } = await banco(t);
  await vault.inserisci(CHIAVE);

  for (const richiesta of [
    { estensione: "Non Valida", ambiente: "Unraid", chiavi: ["METEO_TOKEN"] },
    { estensione: "meteo", ambiente: "  ", chiavi: ["METEO_TOKEN"] },
    { estensione: "meteo", ambiente: "Unraid", chiavi: [] },
    { estensione: "meteo", ambiente: "Unraid", chiavi: ["non è un nome"] },
  ]) {
    assert.equal((await consegnaChiavi(vault, registro, richiesta)).esito, "rifiutato", JSON.stringify(richiesta));
  }

  vault.chiudi();
  assert.throws(() => vault.perEstensione("meteo", "Unraid", ["METEO_TOKEN"]), VaultChiuso);
  const chiuso = await consegnaChiavi(vault, registro, { estensione: "meteo", ambiente: "Unraid", chiavi: ["METEO_TOKEN"] });
  assert.equal(chiuso.esito, "rifiutato");
  assert.ok(!JSON.stringify(chiuso).includes(VALORE));
});

test("il centro chiede le chiavi con il suo gettone, e il valore non compare da nessun'altra parte", async (t) => {
  const { app } = await banco(t);
  const entrata = await app.inject({ method: "POST", url: "/vault/sblocco", payload: { frase: FRASE } });
  assert.equal(entrata.statusCode, 200, entrata.body);
  const cookie = entrata.cookies.find((c) => c.name === COOKIE_VAULT);
  assert.ok(cookie);
  const cookies = { [COOKIE_VAULT]: cookie.value };

  // La scrive il proprietario, dalla sua pagina.
  const inserita = await app.inject({ method: "POST", url: "/vault/credenziali", cookies, payload: { ...CHIAVE, segreto: VALORE } });
  assert.equal(inserita.statusCode, 200, inserita.body);
  assert.ok(!inserita.body.includes(VALORE));
  // Senza dire di quale estensione è, non entra.
  const senza = await app.inject({
    method: "POST",
    url: "/vault/credenziali",
    cookies,
    payload: { nome: "senza", tipo: "estensione", utente: "X_TOKEN", host: ["Unraid"], segreto: ALTRO_VALORE },
  });
  assert.equal(senza.statusCode, 400);

  const richiesta = { estensione: "meteo", ambiente: "Unraid", chiavi: ["METEO_TOKEN"] };
  assert.equal((await app.inject({ method: "POST", url: "/api/chiavi-estensione", payload: richiesta })).statusCode, 401);
  // La sessione del proprietario non è il gettone del centro.
  assert.equal((await app.inject({ method: "POST", url: "/api/chiavi-estensione", cookies, payload: richiesta })).statusCode, 401);
  assert.equal(
    (await app.inject({ method: "POST", url: "/api/chiavi-estensione", headers: DEL_CENTRO, payload: { ...richiesta, chiavi: [] } })).statusCode,
    400,
  );

  const consegna = await app.inject({ method: "POST", url: "/api/chiavi-estensione", headers: DEL_CENTRO, payload: richiesta });
  assert.equal(consegna.statusCode, 200, consegna.body);
  assert.deepEqual(consegna.json(), { esito: "consegnate", valori: { METEO_TOKEN: VALORE } });

  const rifiuto = await app.inject({ method: "POST", url: "/api/chiavi-estensione", headers: DEL_CENTRO, payload: { ...richiesta, estensione: "posta" } });
  assert.equal(rifiuto.statusCode, 200);
  assert.equal(rifiuto.json().esito, "rifiutato");
  assert.ok(!rifiuto.body.includes(VALORE));

  // Lo stato, l'elenco e il registro la nominano senza dirne il valore.
  for (const [url, intestazioni] of [
    ["/api/stato", { headers: DEL_CENTRO }],
    ["/api/registro", { headers: DEL_CENTRO }],
    ["/vault/credenziali", { cookies }],
  ] as const) {
    const risposta = await app.inject({ method: "GET", url, ...intestazioni });
    assert.equal(risposta.statusCode, 200, url);
    assert.ok(!risposta.body.includes(VALORE), url);
    assert.match(risposta.body, /meteo-unraid/, url);
  }
  const stato = (await app.inject({ method: "GET", url: "/api/stato", headers: DEL_CENTRO })).json() as { credenziali: { nome: string; estensione?: string }[] };
  assert.equal(stato.credenziali.find((c) => c.nome === "meteo-unraid")?.estensione, "meteo");
});
