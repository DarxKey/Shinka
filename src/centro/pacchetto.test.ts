import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test, type TestContext } from "node:test";
import { leggiFileDiVersione, percorsoDelGatewayValido } from "../protocollo/versione.ts";
import { cambiaLaParteDelGateway, pacchettoDelGateway, pacchettoDellaVersione } from "./pacchetto.ts";

const VERSIONE = "0123456789abcdef0123456789abcdef01234567";

async function versioneFinta(t: TestContext, conVersione = true): Promise<string> {
  const cartella = await mkdtemp(join(tmpdir(), "shinka-pacchetto-"));
  t.after(() => rm(cartella, { recursive: true, force: true }));
  await mkdir(join(cartella, "src", "nodo"), { recursive: true });
  await mkdir(join(cartella, "node_modules", "qualcosa"), { recursive: true });
  await mkdir(join(cartella, "web", "src"), { recursive: true });
  await writeFile(join(cartella, "package.json"), "{}");
  await writeFile(join(cartella, "package-lock.json"), "{}");
  if (conVersione) await writeFile(join(cartella, "versione.json"), JSON.stringify({ versione: VERSIONE }));
  await writeFile(join(cartella, "src", "nodo", "avvio.ts"), "console.log('nodo');\n");
  await writeFile(join(cartella, "src", "nodo", "avvio.test.ts"), "// un test\n");
  await writeFile(join(cartella, "node_modules", "qualcosa", "index.js"), "");
  await writeFile(join(cartella, "web", "src", "App.tsx"), "");
  await writeFile(join(cartella, ".env"), "SEGRETO=no");
  return cartella;
}

test("il pacchetto per un nodo porta il codice e l'elenco delle dipendenze, non i test né il resto", async (t) => {
  const file = await pacchettoDellaVersione(await versioneFinta(t));
  // Manca tsconfig.json, che in questa versione finta non c'è: non è un errore.
  assert.deepEqual(file.map((uno) => uno.percorso).sort(), ["package-lock.json", "package.json", "src/nodo/avvio.ts", "versione.json"]);
  assert.equal(Buffer.from(file.find((uno) => uno.percorso === "src/nodo/avvio.ts")?.dati ?? "", "base64").toString("utf8"), "console.log('nodo');\n");
  // Ciò che il centro costruisce è ciò che il nodo accetta.
  assert.deepEqual(leggiFileDiVersione(JSON.parse(JSON.stringify(file))), file);
});

test("senza il file della versione non c'è un pacchetto: il nodo non saprebbe dire a che versione è", async (t) => {
  await assert.rejects(pacchettoDellaVersione(await versioneFinta(t, false)));
});

test("il codice di Shinka com'è adesso sta in un pacchetto che un nodo accetta", async (t) => {
  // La cartella vera, con una versione finta accanto: nomi e peso devono stare nei limiti del protocollo.
  const vera = resolve(import.meta.dirname, "../..");
  const cartella = await mkdtemp(join(tmpdir(), "shinka-pacchetto-vero-"));
  t.after(() => rm(cartella, { recursive: true, force: true }));
  const { cp } = await import("node:fs/promises");
  await cp(join(vera, "src"), join(cartella, "src"), { recursive: true });
  for (const nome of ["package.json", "package-lock.json", "tsconfig.json"]) await cp(join(vera, nome), join(cartella, nome));
  await writeFile(join(cartella, "versione.json"), JSON.stringify({ versione: VERSIONE }));
  const file = await pacchettoDellaVersione(cartella);
  assert.ok(file.some((uno) => uno.percorso === "src/nodo/avvio.ts"));
  assert.ok(file.some((uno) => uno.percorso === "src/guardiano/guardiano.ts"));
  assert.ok(!file.some((uno) => uno.percorso.endsWith(".test.ts")));
  assert.deepEqual(leggiFileDiVersione(JSON.parse(JSON.stringify(file)))?.length, file.length);
});

/** Una versione finta in cui il gateway importa qualcosa, e qualcos'altro no. */
async function versioneColGateway(t: TestContext): Promise<string> {
  const cartella = await versioneFinta(t);
  const file: Record<string, string> = {
    "src/gateway/avvio.ts": 'import { creaGateway } from "./servizio.ts";\nconst guardiano = await import("../guardiano/guardiano.ts");\nconsole.log(creaGateway, guardiano);\n',
    "src/gateway/servizio.ts": 'import type {\n  Stato,\n} from "../protocollo/vault.ts";\nimport fastify from "fastify";\nexport * from "./uso.ts";\nexport const creaGateway = (stato: Stato) => fastify() && stato;\n',
    "src/gateway/uso.ts": 'import "../protocollo/telegram.ts";\nexport const uso = 1;\n',
    "src/gateway/uso.test.ts": 'import "../prove/banco.ts";\n',
    "src/gateway/pagina/index.html": "<!doctype html>\n",
    "src/gateway/pagina/vault.js": "// la pagina\n",
    "src/guardiano/guardiano.ts": "export const CODICE_RIAVVIO = 75;\n",
    "src/guardiano/avvio.ts": 'import "../centro/avvio.ts";\n',
    "src/protocollo/vault.ts": "export type Stato = string;\n",
    "src/protocollo/telegram.ts": "export const prefisso = 'gw:';\n",
    "src/protocollo/eventi.ts": "export type Evento = string;\n",
    "src/centro/avvio.ts": "console.log('centro');\n",
    "src/prove/banco.ts": "export {};\n",
  };
  for (const [percorso, testo] of Object.entries(file)) {
    await mkdir(join(cartella, percorso, ".."), { recursive: true });
    await writeFile(join(cartella, percorso), testo);
  }
  return cartella;
}

test("il pacchetto per il gateway porta solo ciò che il gateway carica: il suo avvio, ciò che importa, la sua pagina", async (t) => {
  const cartella = await versioneColGateway(t);
  const file = await pacchettoDelGateway(cartella);
  assert.deepEqual(file.map((uno) => uno.percorso).sort(), [
    "package-lock.json",
    "package.json",
    "src/gateway/avvio.ts",
    "src/gateway/pagina/index.html",
    "src/gateway/pagina/vault.js",
    "src/gateway/servizio.ts",
    "src/gateway/uso.ts",
    "src/guardiano/guardiano.ts",
    "src/protocollo/telegram.ts",
    "src/protocollo/vault.ts",
    "versione.json",
  ]);
  assert.deepEqual(leggiFileDiVersione(JSON.parse(JSON.stringify(file))), file);

  // Un gateway che importasse il centro uscirebbe da ciò che gli si può passare: meglio saperlo subito.
  await writeFile(join(cartella, "src", "gateway", "uso.ts"), 'import "../centro/avvio.ts";\n');
  await assert.rejects(pacchettoDelGateway(cartella), /Il gateway importa src\/centro\/avvio\.ts/);
});

test("tra due versioni la parte del gateway cambia solo se cambia ciò che il gateway carica", async (t) => {
  const prima = await versioneColGateway(t);
  const dopo = await mkdtemp(join(tmpdir(), "shinka-pacchetto-dopo-"));
  t.after(() => rm(dopo, { recursive: true, force: true }));
  await cp(prima, dopo, { recursive: true });
  assert.equal(await cambiaLaParteDelGateway(prima, dopo), false);

  // Il centro, un file del protocollo che il gateway non usa, un test, il nome della versione: non contano.
  await writeFile(join(dopo, "src", "centro", "avvio.ts"), "console.log('centro nuovo');\n");
  await writeFile(join(dopo, "src", "protocollo", "eventi.ts"), "export type Evento = number;\n");
  await writeFile(join(dopo, "src", "gateway", "uso.test.ts"), "// un altro test\n");
  await writeFile(join(dopo, "versione.json"), JSON.stringify({ versione: "f".repeat(40) }));
  assert.equal(await cambiaLaParteDelGateway(prima, dopo), false);

  // La pagina del vault, anche se nessuno la importa.
  await writeFile(join(dopo, "src", "gateway", "pagina", "vault.js"), "// la pagina nuova\n");
  assert.equal(await cambiaLaParteDelGateway(prima, dopo), true);
  await cp(join(prima, "src", "gateway", "pagina", "vault.js"), join(dopo, "src", "gateway", "pagina", "vault.js"));
  assert.equal(await cambiaLaParteDelGateway(prima, dopo), false);

  // Un file del protocollo che il gateway importa; le dipendenze.
  await writeFile(join(dopo, "src", "protocollo", "telegram.ts"), "export const prefisso = 'x:';\n");
  assert.equal(await cambiaLaParteDelGateway(prima, dopo), true);
  await cp(join(prima, "src", "protocollo", "telegram.ts"), join(dopo, "src", "protocollo", "telegram.ts"));
  await writeFile(join(dopo, "package-lock.json"), '{"lock":2}');
  assert.equal(await cambiaLaParteDelGateway(prima, dopo), true);
});

test("il gateway di Shinka com'è adesso sta in un pacchetto che il gateway accetta, senza nulla del centro né dei nodi", async (t) => {
  const vera = resolve(import.meta.dirname, "../..");
  const cartella = await mkdtemp(join(tmpdir(), "shinka-pacchetto-vero-"));
  t.after(() => rm(cartella, { recursive: true, force: true }));
  await cp(join(vera, "src"), join(cartella, "src"), { recursive: true });
  for (const nome of ["package.json", "package-lock.json", "tsconfig.json"]) await cp(join(vera, nome), join(cartella, nome));
  await writeFile(join(cartella, "versione.json"), JSON.stringify({ versione: VERSIONE }));
  const percorsi = (await pacchettoDelGateway(cartella)).map((uno) => uno.percorso);
  for (const atteso of [
    "src/gateway/avvio.ts",
    "src/gateway/domande.ts",
    "src/gateway/aggiornamento.ts",
    "src/gateway/pagina/vault.js",
    "src/guardiano/guardiano.ts",
    "src/guardiano/versione-nuova.ts",
    "src/protocollo/versione.ts",
    "package-lock.json",
    "versione.json",
  ]) {
    assert.ok(percorsi.includes(atteso), atteso);
  }
  assert.deepEqual(percorsi.filter((percorso) => !percorsoDelGatewayValido(percorso)), []);
  assert.deepEqual(percorsi.filter((percorso) => /^src\/(centro|nodo|prove)\//.test(percorso) || percorso.endsWith(".test.ts")), []);
});
