/**
 * L'installazione di un fork (ADR 0059), senza Docker: gli script che il container lancia a ogni
 * avvio, provati su un originale locale (questo repository). La prima volta il centro prende il
 * repository con la storia, prepara la versione in funzione con il suo versione.json e mette il
 * guardiano fuori di lei; il gateway prende la sua parte. La seconda volta non rifanno nulla.
 * Le dipendenze e l'avvio si saltano.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const radice = join(import.meta.dirname, "..", "..");
const cartellaFork = join(radice, "installazione", "fork");

test("gli script del fork preparano centro e gateway dalla copia originale, una volta sola", { timeout: 120_000 }, (t) => {
  const cartella = mkdtempSync(join(tmpdir(), "shinka-fork-"));
  t.after(() => rmSync(cartella, { recursive: true, force: true }));
  // L'originale: un repository nuovo con il codice di questa versione (la copia pulita dell'installazione non è un repository).
  const originale = join(cartella, "originale");
  mkdirSync(originale);
  for (const voce of ["src", "package.json", "package-lock.json", "tsconfig.json"]) cpSync(join(radice, voce), join(originale, voce), { recursive: true });
  const conIlNome = { ...process.env, GIT_AUTHOR_NAME: "Prova", GIT_AUTHOR_EMAIL: "prova@localhost", GIT_COMMITTER_NAME: "Prova", GIT_COMMITTER_EMAIL: "prova@localhost" };
  execFileSync("git", ["init", "--quiet", "--initial-branch=main", originale]);
  execFileSync("git", ["-C", originale, "add", "--all"]);
  execFileSync("git", ["-C", originale, "commit", "--quiet", "-m", "Prima pubblicazione di Shinka"], { env: conIlNome });
  const cima = execFileSync("git", ["-C", originale, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const ambiente = { ...process.env, SHINKA_ORIGINALE: originale, SHINKA_FORK_SENZA_DIPENDENZE: "1", SHINKA_FORK_SOLO_PREPARA: "1" };

  const casa = join(cartella, "casa");
  mkdirSync(casa);
  const centro = () => execFileSync("bash", [join(cartellaFork, "prepara-centro.sh")], { env: { ...ambiente, SHINKA_CASA: casa }, encoding: "utf8" });
  centro();
  assert.equal(execFileSync("git", ["--git-dir", join(casa, "repository.git"), "rev-parse", "main"], { encoding: "utf8" }).trim(), cima);
  assert.equal((JSON.parse(readFileSync(join(casa, "shinka", "versione.json"), "utf8")) as { versione: string }).versione, cima);
  assert.ok(existsSync(join(casa, "shinka", "src", "centro", "avvio.ts")));
  assert.ok(existsSync(join(casa, "guardiano", "avvio.ts")));
  assert.ok(existsSync(join(casa, "dati")) && existsSync(join(casa, "progetti")));
  // La seconda volta non si rifà nulla: la versione in funzione resta quella che c'è.
  const prima = statSync(join(casa, "shinka", "versione.json")).mtimeMs;
  centro();
  assert.equal(statSync(join(casa, "shinka", "versione.json")).mtimeMs, prima);

  const codice = join(cartella, "gateway");
  const dati = join(cartella, "gateway-dati");
  mkdirSync(codice);
  mkdirSync(dati);
  execFileSync("bash", [join(cartellaFork, "prepara-gateway.sh")], { env: { ...ambiente, SHINKA_GATEWAY_CODICE: codice, SHINKA_GATEWAY_DATI: dati, SHINKA_GATEWAY_GETTONE: "gettone-di-prova" }, encoding: "utf8" });
  assert.equal(readFileSync(join(dati, "gettone.txt"), "utf8").trim(), "gettone-di-prova");
  assert.ok(existsSync(join(codice, "shinka", "src", "gateway", "avvio.ts")));
  assert.ok(!existsSync(join(codice, "shinka", "src", "centro", "avvio.ts")), "nel gateway c'è solo la sua parte");
  assert.match(readFileSync(join(codice, "shinka", "versione.json"), "utf8"), new RegExp(cima));
  assert.ok(existsSync(join(codice, "guardiano", "avvio-gateway.ts")));
});

test("i file del fork che installa.sh scarica ci sono tutti", () => {
  const installa = readFileSync(join(cartellaFork, "installa.sh"), "utf8");
  const elenco = /for nome in ([^;]+); do/.exec(installa)?.[1]?.split(/\s+/) ?? [];
  assert.ok(elenco.length >= 5);
  for (const nome of elenco) assert.ok(existsSync(join(cartellaFork, nome)), nome);
  assert.ok(existsSync(join(radice, "installazione", "seccomp-chromium.json")));
});
