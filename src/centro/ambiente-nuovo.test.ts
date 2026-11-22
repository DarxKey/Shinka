import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { allestisci, PASSWORD } from "../prove/banco.ts";
import {
  comandoDiUnaRiga,
  DURATA_INVITO_MS,
  indirizzoPerIlNodo,
  InvitiDegliAmbienti,
  pacchettoDelNodo,
  PERCORSO_PACCHETTO_NODO,
  PERCORSO_PREPARAZIONE,
  scriptDiPreparazione,
  type Invito,
} from "./ambiente-nuovo.ts";
import { COOKIE_SESSIONE } from "./centro.ts";

function gettoneDi(comando: string): string {
  const trovato = /invito=([A-Za-z0-9_-]+)/.exec(comando);
  assert.ok(trovato !== null, comando);
  return trovato[1] as string;
}

/** Una versione installata finta, con un nodo, un guardiano, prove e dati che non devono partire. */
function versioneFinta(): string {
  const cartella = mkdtempSync(join(tmpdir(), "shinka-installata-"));
  const scrivi = (percorso: string, testo: string) => {
    mkdirSync(dirname(join(cartella, percorso)), { recursive: true });
    writeFileSync(join(cartella, percorso), testo);
  };
  scrivi("package.json", "{}");
  scrivi("package-lock.json", "{}");
  scrivi("tsconfig.json", "{}");
  scrivi("versione.json", JSON.stringify({ versione: "0123456789abcdef0123456789abcdef01234567" }));
  scrivi("src/nodo/avvio.ts", "// il nodo");
  scrivi("src/nodo/avvio.test.ts", "// una prova");
  scrivi("src/guardiano/guardiano.ts", "// il guardiano");
  scrivi("src/guardiano/avvio-nodo.ts", "// l'avvio del guardiano del nodo");
  scrivi("src/guardiano/guardiano.test.ts", "// una prova");
  scrivi("web/dist/index.html", "<!doctype html>");
  scrivi("dati/memoria.md", "segreto del proprietario");
  scrivi("node_modules/x/index.js", "// dipendenza");
  return cartella;
}

test("l'indirizzo per il nodo è sempre in HTTP, con la porta, senza percorso", () => {
  assert.equal(indirizzoPerIlNodo("https://192.168.1.10:7850/impostazioni?x=1"), "http://192.168.1.10:7850");
  assert.equal(indirizzoPerIlNodo("http://shinka.casa"), "http://shinka.casa:80");
  assert.equal(indirizzoPerIlNodo(" https://shinka.casa "), "http://shinka.casa:443");
  assert.equal(indirizzoPerIlNodo("http://[fd00::1]:7850"), "http://[fd00::1]:7850");
  assert.throws(() => indirizzoPerIlNodo("ftp://shinka.casa"), /http/);
  assert.throws(() => indirizzoPerIlNodo("http://io:segreto@shinka.casa"), /nome utente/);
  assert.throws(() => indirizzoPerIlNodo("non è un indirizzo"), /non è un indirizzo/);
});

test("un invito dà il comando del suo sistema, vale un'ora e si può usare più volte", () => {
  let adesso = 1_000_000;
  const inviti = new InvitiDegliAmbienti({ adesso: () => adesso });
  const linux = inviti.crea({ sistema: "linux", centro: "https://192.168.1.10:7850", nome: "Server del lavoro" });
  assert.match(linux.comando, /^curl -fsSL 'http:\/\/192\.168\.1\.10:7850\/api\/ambienti\/preparazione\?invito=[A-Za-z0-9_-]{32}' \| bash$/);
  assert.equal(linux.scade, new Date(1_000_000 + DURATA_INVITO_MS).toISOString());
  const windows = inviti.crea({ sistema: "windows", centro: "http://192.168.1.10:7850", nome: "PC" });
  assert.match(windows.comando, /^irm 'http:\/\/192\.168\.1\.10:7850\/api\/ambienti\/preparazione\?invito=[A-Za-z0-9_-]{32}' \| iex$/);

  const gettone = gettoneDi(linux.comando);
  assert.equal(inviti.valido(gettone)?.nome, "Server del lavoro");
  assert.equal(inviti.valido(gettone)?.sistema, "linux");
  assert.equal(inviti.valido("inventato"), undefined);
  assert.equal(inviti.valido(undefined), undefined);
  adesso += DURATA_INVITO_MS - 1;
  assert.ok(inviti.valido(gettone) !== undefined);
  adesso += 1;
  assert.equal(inviti.valido(gettone), undefined);
});

test("un invito rifiuta sistema, nome o indirizzo che non vanno, e ne tiene al massimo cinque", () => {
  const inviti = new InvitiDegliAmbienti();
  assert.throws(() => inviti.crea({ sistema: "macos", centro: "http://a:1", nome: "Mac" }), /Linux o Windows/);
  assert.throws(() => inviti.crea({ sistema: "linux", centro: "http://a:1", nome: " \n " }), /nome/);
  assert.throws(() => inviti.crea({ sistema: "linux", centro: "javascript:alert(1)", nome: "X" }), /http/);
  const gettoni = Array.from({ length: 6 }, (_, i) => gettoneDi(inviti.crea({ sistema: "linux", centro: "http://a:1", nome: `N${i}` }).comando));
  assert.equal(inviti.valido(gettoni[0]), undefined);
  for (const gettone of gettoni.slice(1)) assert.ok(inviti.valido(gettone) !== undefined);
});

const invitoCattivo: Invito = {
  gettone: "abc_DEF-123",
  sistema: "linux",
  centro: "http://192.168.1.10:7850",
  nome: `Il PC dell'ufficio $(touch /tmp/no) \`x\` "y" ’z’`,
  descrizione: "Docker; rm -rf ~",
  scade: Date.now() + 1000,
};

test("lo script per Linux è bash valido, tra graffe, e i valori scelti restano testo", async () => {
  const script = await scriptDiPreparazione(invitoCattivo);
  assert.ok(script.startsWith("#!/usr/bin/env bash\n"));
  assert.match(script, /\n\{\n/);
  assert.ok(script.trimEnd().endsWith("}"));
  const cartella = mkdtempSync(join(tmpdir(), "shinka-script-"));
  writeFileSync(join(cartella, "prepara.sh"), script);
  execFileSync("bash", ["-n", join(cartella, "prepara.sh")]);
  // Le scelte in cima, da sole: bash le legge come testo, senza eseguire nulla.
  const cima = script.slice(0, script.indexOf("\n{\n"));
  const letto = execFileSync("bash", ["-c", `${cima}\nprintf '%s\\n' "$SHINKA_NOME" "$SHINKA_DESCRIZIONE" "$SHINKA_CENTRO" "$SHINKA_PACCHETTO"`]).toString();
  assert.deepEqual(letto.trimEnd().split("\n"), [
    invitoCattivo.nome,
    invitoCattivo.descrizione,
    "http://192.168.1.10:7850",
    `http://192.168.1.10:7850${PERCORSO_PACCHETTO_NODO}?invito=abc_DEF-123`,
  ]);
});

test("lo script per Windows mette le scelte tra apici singoli, raddoppiando gli apici, e non chiude la finestra", async () => {
  const script = await scriptDiPreparazione({ ...invitoCattivo, sistema: "windows" });
  assert.ok(script.includes(`$SHINKA_NOME = 'Il PC dell''ufficio $(touch /tmp/no) \`x\` "y" ’’z’’'`), script.slice(0, 400));
  assert.ok(script.includes(`$SHINKA_PACCHETTO = 'http://192.168.1.10:7850${PERCORSO_PACCHETTO_NODO}?invito=abc_DEF-123'`));
  assert.match(script, /\nPrepara-AmbienteShinka\s*$/);
  // Con `irm | iex` un exit chiuderebbe PowerShell: lo script finisce sempre con return.
  assert.doesNotMatch(script, /^\s*exit\b/im);
});

test("il comando di una riga non lascia spazio a ciò che il proprietario scrive", () => {
  assert.equal(
    comandoDiUnaRiga({ sistema: "linux", centro: "http://a:1", gettone: "G" }),
    "curl -fsSL 'http://a:1/api/ambienti/preparazione?invito=G' | bash",
  );
});

test("il pacchetto del nodo ha il guardiano accanto alla versione, senza prove, interfaccia, dati o dipendenze", async () => {
  const pacchetto = await pacchettoDelNodo(versioneFinta());
  assert.equal(pacchetto.nome, "shinka-nodo-01234567.tar.gz");
  const cartella = mkdtempSync(join(tmpdir(), "shinka-pacchetto-nodo-"));
  writeFileSync(join(cartella, "p.tar.gz"), pacchetto.dati);
  const elenco = execFileSync("tar", ["-tzf", "p.tar.gz"], { cwd: cartella }).toString().split("\n").filter(Boolean).sort();
  assert.deepEqual(elenco, [
    "guardiano/avvio-nodo.ts",
    "guardiano/guardiano.ts",
    "shinka/package-lock.json",
    "shinka/package.json",
    "shinka/src/guardiano/avvio-nodo.ts",
    "shinka/src/guardiano/guardiano.ts",
    "shinka/src/nodo/avvio.ts",
    "shinka/tsconfig.json",
    "shinka/versione.json",
  ]);
  execFileSync("tar", ["-xzf", "p.tar.gz"], { cwd: cartella });
  assert.equal(readFileSync(join(cartella, "guardiano/guardiano.ts"), "utf8"), "// il guardiano");
});

test("dal centro: il comando lo prepara solo il proprietario; lo script e il pacchetto vogliono un invito valido", async (t) => {
  const banco = await allestisci(t, { installata: versioneFinta() });
  const senza = await banco.centro.inject({ method: "POST", url: "/api/ambienti/inviti", payload: { sistema: "linux", centro: "http://a:7850", nome: "X" } });
  assert.equal(senza.statusCode, 401);

  const entrata = await banco.centro.inject({ method: "POST", url: "/api/accesso", payload: { password: PASSWORD } });
  const cookie = entrata.cookies.find((voce) => voce.name === COOKIE_SESSIONE);
  assert.ok(cookie !== undefined);
  const cookies = { [COOKIE_SESSIONE]: cookie.value };
  const sbagliato = await banco.centro.inject({ method: "POST", url: "/api/ambienti/inviti", cookies, payload: { sistema: "linux", centro: "ftp://a", nome: "X" } });
  assert.equal(sbagliato.statusCode, 400);
  const pronto = await banco.centro.inject({
    method: "POST",
    url: "/api/ambienti/inviti",
    cookies,
    payload: { sistema: "linux", centro: "https://192.168.1.10:7850", nome: "Server del lavoro", descrizione: "Docker" },
  });
  assert.equal(pronto.statusCode, 200);
  const gettone = gettoneDi(pronto.json<{ comando: string }>().comando);

  // Senza sessione, come li chiama la macchina nuova.
  const script = await banco.centro.inject({ method: "GET", url: `${PERCORSO_PREPARAZIONE}?invito=${gettone}` });
  assert.equal(script.statusCode, 200);
  assert.match(String(script.headers["content-type"]), /text\/plain; charset=utf-8/);
  assert.match(script.body, /SHINKA_NOME='Server del lavoro'/);
  assert.match(script.body, /SHINKA_CENTRO='http:\/\/192\.168\.1\.10:7850'/);
  const pacchetto = await banco.centro.inject({ method: "GET", url: `${PERCORSO_PACCHETTO_NODO}?invito=${gettone}` });
  assert.equal(pacchetto.statusCode, 200);
  assert.equal(pacchetto.rawPayload.subarray(0, 2).toString("hex"), "1f8b");

  const scaduto = await banco.centro.inject({ method: "GET", url: `${PERCORSO_PREPARAZIONE}?invito=inventato` });
  assert.equal(scaduto.statusCode, 200);
  assert.match(scaduto.body, /^echo "L'invito non vale più/);
  assert.doesNotMatch(scaduto.body, /SHINKA_/);
  const senzaInvito = await banco.centro.inject({ method: "GET", url: PERCORSO_PACCHETTO_NODO });
  assert.equal(senzaInvito.statusCode, 403);
});

const CERTIFICATO = { impronta: "ab".repeat(32), improntaDellaChiave: "SJ3f/UNGwDLPukQpth0uxzQZxMBzBPaZP1/e6aNuIMk=" };

test("con il certificato dei nodi il comando per Linux scarica cifrato e pretende la chiave del centro; per Windows resta com'era", () => {
  assert.equal(
    comandoDiUnaRiga({ sistema: "linux", centro: "http://192.168.1.10:7850", gettone: "G" }, CERTIFICATO),
    "curl -fsSLk --pinnedpubkey 'sha256//SJ3f/UNGwDLPukQpth0uxzQZxMBzBPaZP1/e6aNuIMk=' --connect-to 'nodi.shinka.invalid:7850:192.168.1.10:7850' 'https://nodi.shinka.invalid:7850/api/ambienti/preparazione?invito=G' | bash",
  );
  assert.equal(comandoDiUnaRiga({ sistema: "windows", centro: "http://192.168.1.10:7850", gettone: "G" }, CERTIFICATO), "irm 'http://192.168.1.10:7850/api/ambienti/preparazione?invito=G' | iex");
  // Il comando di un invito porta il certificato del centro che lo ha dato.
  const inviti = new InvitiDegliAmbienti({ certificato: CERTIFICATO });
  assert.match(inviti.crea({ sistema: "linux", centro: "https://192.168.1.10:7850", nome: "Server" }).comando, /--pinnedpubkey 'sha256\/\/SJ3f/);
});

test("lo script porta al nodo l'impronta del certificato da riconoscere, e su Linux scarica il pacchetto cifrato", async () => {
  const script = await scriptDiPreparazione(invitoCattivo, CERTIFICATO);
  const cartella = mkdtempSync(join(tmpdir(), "shinka-script-"));
  writeFileSync(join(cartella, "prepara.sh"), script);
  execFileSync("bash", ["-n", join(cartella, "prepara.sh")]);
  const cima = script.slice(0, script.indexOf("\n{\n"));
  const letto = execFileSync("bash", ["-c", `${cima}\nprintf '%s\\n' "$SHINKA_CENTRO" "$SHINKA_PACCHETTO" "$SHINKA_IMPRONTA" "$SHINKA_CHIAVE_DEL_CENTRO" "$SHINKA_COLLEGA"`]).toString();
  assert.deepEqual(letto.trimEnd().split("\n"), [
    // Il nodo tiene l'indirizzo di sempre: a cifrare pensa lui, sulla stessa porta.
    "http://192.168.1.10:7850",
    `https://nodi.shinka.invalid:7850${PERCORSO_PACCHETTO_NODO}?invito=abc_DEF-123`,
    CERTIFICATO.impronta,
    `sha256//${CERTIFICATO.improntaDellaChiave}`,
    "nodi.shinka.invalid:7850:192.168.1.10:7850",
  ]);
  assert.match(script, /--pinnedpubkey "\$SHINKA_CHIAVE_DEL_CENTRO" --connect-to "\$SHINKA_COLLEGA"/);
  assert.match(script, /scelte\.improntaDelCentro = process\.env\.SHINKA_IMPRONTA/);

  // Senza certificato lo script è quello di prima, e non lascia al nodo un'impronta vecchia.
  const senza = await scriptDiPreparazione(invitoCattivo);
  assert.match(senza, /\nSHINKA_IMPRONTA=''\n/);
  assert.match(senza, /delete scelte\.improntaDelCentro/);

  const windows = await scriptDiPreparazione({ ...invitoCattivo, sistema: "windows" }, CERTIFICATO);
  assert.ok(windows.includes(`$SHINKA_IMPRONTA = '${CERTIFICATO.impronta}'`));
  assert.ok(windows.includes("s.improntaDelCentro=process.env.SHINKA_IMPRONTA"));
});
