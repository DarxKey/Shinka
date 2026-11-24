/**
 * Gli aggiornamenti dall'originale (ADR 0059), con repository veri: le versioni che il fork non ha si
 * contano e si propongono una volta; le modifiche fatte nel fork non contano; dopo la fusione non c'è
 * più nulla da proporre; un originale che non risponde lo dice.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { allestisci } from "../prove/banco.ts";
import { COOKIE_SESSIONE } from "./centro.ts";
import { AggiornamentiDallOriginale } from "./originale.ts";

const ambiente = { ...process.env, GIT_AUTHOR_NAME: "Prova", GIT_AUTHOR_EMAIL: "prova@localhost", GIT_COMMITTER_NAME: "Prova", GIT_COMMITTER_EMAIL: "prova@localhost", GIT_CONFIG_NOSYSTEM: "1" };
const git = (cartella: string, ...argomenti: string[]): string => execFileSync("git", ["-C", cartella, ...argomenti], { encoding: "utf8", env: ambiente }).trim();

test("le versioni dell'originale che il fork non ha si propongono una volta, e dopo la fusione non ci sono più", (t) => {
  const cartella = mkdtempSync(join(tmpdir(), "shinka-originale-"));
  t.after(() => rmSync(cartella, { recursive: true, force: true }));
  const originale = join(cartella, "originale");
  execFileSync("git", ["init", "--quiet", "--initial-branch=main", originale], { env: ambiente });
  const registra = (dove: string, file: string, messaggio: string): void => {
    writeFileSync(join(dove, file), `${messaggio}\n`);
    git(dove, "add", "--all");
    git(dove, "commit", "--quiet", "-m", messaggio);
  };
  registra(originale, "a.txt", "Prima pubblicazione");
  // Il fork: il suo repository, e la copia di lavoro del suo progetto Shinka.
  const repository = join(cartella, "repository.git");
  execFileSync("git", ["clone", "--quiet", "--bare", originale, repository], { env: ambiente });
  const progetto = join(cartella, "progetto");
  execFileSync("git", ["clone", "--quiet", repository, progetto], { env: ambiente });
  registra(progetto, "nostro.txt", "Una modifica del fork");
  git(progetto, "push", "--quiet", "origin", "main");

  const proposte: { titolo: string; richiesta: string }[] = [];
  const aggiornamenti = new AggiornamentiDallOriginale({ repository, originale, file: join(cartella, "originale.json"), proponi: (proposta) => proposte.push(proposta) });
  return (async () => {
    // Nulla di nuovo: le modifiche del fork non contano.
    assert.equal((await aggiornamenti.controlla()).nuovi, 0);
    assert.equal(proposte.length, 0);

    registra(originale, "b.txt", "Il ponte di un nodo");
    registra(originale, "c.txt", "Le proposte sopravvivono ai riavvii");
    const stato = await aggiornamenti.controlla();
    assert.equal(stato.nuovi, 2);
    assert.deepEqual(stato.titoli, ["Le proposte sopravvivono ai riavvii", "Il ponte di un nodo"]);
    assert.equal(proposte.length, 1);
    assert.equal(proposte[0]?.titolo, "Aggiornamenti dall'originale: 2 versioni nuove");
    assert.match(proposte[0]?.richiesta ?? "", new RegExp(`git fetch ${originale.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} main`));
    // La stessa cima non si ripropone, nemmeno dopo un riavvio.
    await aggiornamenti.controlla();
    const dopoIlRiavvio = new AggiornamentiDallOriginale({ repository, originale, file: join(cartella, "originale.json"), proponi: (proposta) => proposte.push(proposta) });
    assert.equal((await dopoIlRiavvio.controlla()).nuovi, 2);
    assert.equal(proposte.length, 1);

    // Il progetto Shinka le fonde, come dicono le istruzioni: poi non manca più nulla.
    git(progetto, "fetch", "--quiet", originale, "main");
    git(progetto, "merge", "--quiet", "--no-edit", "FETCH_HEAD");
    git(progetto, "push", "--quiet", "origin", "main");
    assert.equal((await aggiornamenti.controlla()).nuovi, 0);

    // Un originale che non risponde lo dice, senza proporre nulla.
    const rotto = new AggiornamentiDallOriginale({ repository, originale: join(cartella, "non-esiste"), file: join(cartella, "rotto.json"), proponi: (proposta) => proposte.push(proposta) });
    assert.match((await rotto.controlla()).motivo ?? "", /non si è potuto leggere/);
    assert.equal(proposte.length, 1);
  })();
});

test("le rotte dell'originale: in un fork dicono com'è e controllano a richiesta; altrove non ci sono", { timeout: 30_000 }, async (t) => {
  const cartella = mkdtempSync(join(tmpdir(), "shinka-originale-rotte-"));
  t.after(() => rmSync(cartella, { recursive: true, force: true }));
  const originale = join(cartella, "originale");
  execFileSync("git", ["init", "--quiet", "--initial-branch=main", originale], { env: ambiente });
  writeFileSync(join(originale, "a.txt"), "uno\n");
  git(originale, "add", "--all");
  git(originale, "commit", "--quiet", "-m", "Prima pubblicazione");
  const repository = join(cartella, "repository.git");
  execFileSync("git", ["clone", "--quiet", "--bare", originale, repository], { env: ambiente });
  writeFileSync(join(originale, "b.txt"), "due\n");
  git(originale, "add", "--all");
  git(originale, "commit", "--quiet", "-m", "Una versione nuova");
  const proposte: string[] = [];
  const aggiornamenti = new AggiornamentiDallOriginale({ repository, originale, file: join(cartella, "originale.json"), proponi: (proposta) => proposte.push(proposta.titolo) });

  const banco = await allestisci(t, { originale: aggiornamenti });
  const cookie = { [COOKIE_SESSIONE]: await banco.entra() };
  const prima = (await banco.centro.inject({ method: "GET", url: "/api/sviluppo/originale", cookies: cookie })).json() as { nuovi: number; originale: string };
  assert.deepEqual([prima.nuovi, prima.originale], [0, originale]);
  const dopo = (await banco.centro.inject({ method: "POST", url: "/api/sviluppo/originale/controllo", cookies: cookie })).json() as { nuovi: number; titoli: string[] };
  assert.deepEqual([dopo.nuovi, dopo.titoli], [1, ["Una versione nuova"]]);
  assert.deepEqual(proposte, ["Aggiornamenti dall'originale: una versione nuova"]);

  const altrove = await allestisci(t);
  assert.equal((await altrove.centro.inject({ method: "GET", url: "/api/sviluppo/originale", cookies: { [COOKIE_SESSIONE]: await altrove.entra() } })).statusCode, 404);
});
