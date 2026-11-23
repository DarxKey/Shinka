import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { allestisci } from "../prove/banco.ts";
import { COOKIE_SESSIONE } from "./centro.ts";
import { pacchettoDiInstallazione } from "./installazione-nuova.ts";

/** Una versione installata finta, con i file che ci sono davvero e qualcuno che non deve partire. */
function versioneFinta(conInstallazione = true): string {
  const cartella = mkdtempSync(join(tmpdir(), "shinka-installata-"));
  const scrivi = (percorso: string, testo: string) => {
    mkdirSync(dirname(join(cartella, percorso)), { recursive: true });
    writeFileSync(join(cartella, percorso), testo);
  };
  scrivi("package.json", "{}");
  scrivi("package-lock.json", "{}");
  scrivi("tsconfig.json", "{}");
  scrivi("versione.json", JSON.stringify({ versione: "0123456789abcdef0123456789abcdef01234567" }));
  scrivi("src/centro/avvio.ts", "// il centro");
  scrivi("src/centro/avvio.test.ts", "// una prova");
  scrivi("src/prove/banco.ts", "// il banco");
  scrivi("web/dist/index.html", "<!doctype html>");
  scrivi("web/src/App.tsx", "// il sorgente dell'interfaccia: c'è già costruita");
  scrivi("dati/memoria.md", "segreto del proprietario");
  scrivi("node_modules/x/index.js", "// dipendenza");
  if (conInstallazione) {
    for (const nome of ["compose.yaml", "Dockerfile.centro", "Dockerfile.gateway", "installa.sh", ".dockerignore", "LEGGIMI.md"]) scrivi(`installazione/${nome}`, `# ${nome}`);
  }
  return cartella;
}

test("il pacchetto ha il codice, l'interfaccia costruita e i file per installare; niente prove, dati o dipendenze", async () => {
  const pacchetto = await pacchettoDiInstallazione(versioneFinta());
  assert.equal(pacchetto.nome, "shinka-01234567.tar.gz");
  const cartella = mkdtempSync(join(tmpdir(), "shinka-pacchetto-"));
  writeFileSync(join(cartella, pacchetto.nome), pacchetto.dati);
  execFileSync("tar", ["-xzf", pacchetto.nome], { cwd: cartella });
  const elenco = execFileSync("find", ["shinka-01234567", "-type", "f"], { cwd: cartella }).toString().split("\n").filter(Boolean).sort();
  assert.deepEqual(elenco, [
    "shinka-01234567/.dockerignore",
    "shinka-01234567/Dockerfile.centro",
    "shinka-01234567/Dockerfile.gateway",
    "shinka-01234567/LEGGIMI.md",
    "shinka-01234567/compose.yaml",
    "shinka-01234567/installa.sh",
    "shinka-01234567/package-lock.json",
    "shinka-01234567/package.json",
    "shinka-01234567/src/centro/avvio.ts",
    "shinka-01234567/tsconfig.json",
    "shinka-01234567/versione.json",
    "shinka-01234567/web/dist/index.html",
  ]);
  assert.equal(statSync(join(cartella, "shinka-01234567/installa.sh")).mode & 0o111, 0o111);
  assert.equal(readFileSync(join(cartella, "shinka-01234567/compose.yaml"), "utf8"), "# compose.yaml");
});

test("anche un'installazione nata da un pacchetto sa rifare il pacchetto, con i file in cima", async () => {
  const pacchetto = await pacchettoDiInstallazione(versioneFinta());
  const cartella = mkdtempSync(join(tmpdir(), "shinka-dal-pacchetto-"));
  writeFileSync(join(cartella, "p.tar.gz"), pacchetto.dati);
  execFileSync("tar", ["-xzf", "p.tar.gz"], { cwd: cartella });
  const rifatto = await pacchettoDiInstallazione(join(cartella, "shinka-01234567"));
  writeFileSync(join(cartella, "r.tar.gz"), rifatto.dati);
  const elenco = execFileSync("tar", ["-tzf", "r.tar.gz"], { cwd: cartella }).toString();
  assert.match(elenco, /shinka-01234567\/compose\.yaml/);
  assert.match(elenco, /shinka-01234567\/installa\.sh/);
  assert.doesNotMatch(elenco, /installazione\//);
});

test("una versione senza i file per installare lo dice", async () => {
  await assert.rejects(pacchettoDiInstallazione(versioneFinta(false)), /non ha i file per un'installazione nuova/);
});

test("primo avvio: la pagina sa che serve, la password nasce solo con il codice, poi il pacchetto si scarica", async (t) => {
  const banco = await allestisci(t, { primoAvvio: true, installata: versioneFinta() });
  const stato = await banco.centro.inject({ method: "GET", url: "/api/stato" });
  assert.deepEqual(stato.json(), { protocollo: 1, versione: "01234567", configurato: false, autenticato: false, primoAvvio: true });
  assert.ok(banco.codicePrimoAvvio !== undefined);
  // Senza sessione il pacchetto non si scarica.
  assert.equal((await banco.centro.inject({ method: "GET", url: "/api/installazione/pacchetto" })).statusCode, 401);

  const sbagliato = await banco.centro.inject({ method: "POST", url: "/api/primo-avvio", payload: { codice: "AAAA-AAAA", password: "una-password-lunga" } });
  assert.equal(sbagliato.statusCode, 403);
  const giusto = await banco.centro.inject({ method: "POST", url: "/api/primo-avvio", payload: { codice: banco.codicePrimoAvvio, password: "una-password-lunga" } });
  assert.equal(giusto.statusCode, 200);
  const cookie = giusto.cookies.find((voce) => voce.name === COOKIE_SESSIONE);
  assert.ok(cookie !== undefined);
  const dopo = await banco.centro.inject({ method: "GET", url: "/api/stato", cookies: { [COOKIE_SESSIONE]: cookie.value } });
  assert.deepEqual(dopo.json(), { protocollo: 1, versione: "01234567", configurato: true, autenticato: true });
  assert.equal(existsSync(join(banco.cartella, "primo-avvio.txt")), false);
  // Una seconda volta non serve più.
  const ancora = await banco.centro.inject({ method: "POST", url: "/api/primo-avvio", payload: { codice: banco.codicePrimoAvvio, password: "un-altra-password" } });
  assert.equal(ancora.statusCode, 409);

  const scaricato = await banco.centro.inject({ method: "GET", url: "/api/installazione/pacchetto", cookies: { [COOKIE_SESSIONE]: cookie.value } });
  assert.equal(scaricato.statusCode, 200);
  assert.match(String(scaricato.headers["content-disposition"]), /shinka-01234567\.tar\.gz/);
  assert.equal(scaricato.rawPayload.subarray(0, 2).toString("hex"), "1f8b");
});
