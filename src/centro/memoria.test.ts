import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { VOCE_MEMORIA_MASSIMA } from "../protocollo/memoria.ts";
import { Memoria, VoceRifiutata } from "./memoria.ts";
import { sembraUnSegreto } from "./segreti.ts";

async function fileDiProva(t: TestContext): Promise<string> {
  const cartella = await mkdtemp(join(tmpdir(), "shinka-memoria-"));
  t.after(() => rm(cartella, { recursive: true, force: true }));
  return join(cartella, "memoria.md");
}

const UN_GIORNO = Date.parse("2026-11-11T10:00:00Z");

test("una voce annotata resta nel file di testo e si ritrova alla riapertura", async (t) => {
  const file = await fileDiProva(t);
  const memoria = await Memoria.apri(file);
  assert.deepEqual(memoria.voci(), []);

  const voce = await memoria.annota("  Preferisce risposte brevi,\n senza premesse. ", UN_GIORNO);
  assert.deepEqual(voce, { id: voce.id, testo: "Preferisce risposte brevi, senza premesse.", annotataIl: "2026-11-11" });
  assert.match(voce.id, /^[a-z0-9]{6}$/);

  const scritto = await readFile(file, "utf8");
  assert.match(scritto, /^# Memoria di Shinka/);
  assert.ok(scritto.includes(`- [${voce.id} · 2026-11-11] Preferisce risposte brevi, senza premesse.\n`));

  const riaperta = await Memoria.apri(file);
  assert.deepEqual(riaperta.voci(), [voce]);
});

test("la stessa cosa non si annota due volte, e una riga scritta a mano vale come le altre", async (t) => {
  const file = await fileDiProva(t);
  const memoria = await Memoria.apri(file);
  const prima = await memoria.annota("Usa pnpm, non npm.");
  const ripetuta = await memoria.annota("usa pnpm, non npm");
  assert.equal(ripetuta.id, prima.id);
  assert.equal(memoria.voci().length, 1);

  await writeFile(file, `${await readFile(file, "utf8")}- Abita a Udine.\n`);
  const riaperta = await Memoria.apri(file, UN_GIORNO);
  assert.deepEqual(
    riaperta.voci().map((voce) => voce.testo),
    ["Usa pnpm, non npm.", "Abita a Udine."],
  );
});

test("il proprietario corregge e cancella una voce, e chi ascolta lo sa", async (t) => {
  const memoria = await Memoria.apri(await fileDiProva(t));
  const stati: number[] = [];
  const stacca = memoria.iscrivi((stato) => stati.push(stato.voci.length));
  const voce = await memoria.annota("Preferisce il tema scuro.");
  const corretta = await memoria.correggi(voce.id, "Preferisce il tema chiaro.");
  assert.equal(corretta?.testo, "Preferisce il tema chiaro.");
  assert.equal(await memoria.correggi("zzzzzz", "Altro."), undefined);
  assert.equal(await memoria.cancella(voce.id), true);
  assert.equal(await memoria.cancella(voce.id), false);
  assert.deepEqual(memoria.voci(), []);
  assert.deepEqual(stati, [0, 1, 1, 0]);
  stacca();
});

test("in memoria non entrano segreti, voci vuote o troppo lunghe", async (t) => {
  const memoria = await Memoria.apri(await fileDiProva(t));
  for (const rifiutata of [
    "   ",
    "x".repeat(VOCE_MEMORIA_MASSIMA + 1),
    "La password del router è Fritz!2024",
    "token: abcd1234efgh",
    "La chiave è sk-ant-api03-abcdefghijklmnop",
  ]) {
    await assert.rejects(() => memoria.annota(rifiutata), VoceRifiutata, rifiutata);
  }
  assert.deepEqual(memoria.voci(), []);
  const voce = await memoria.annota("Il router di casa è un Fritz!Box.");
  await assert.rejects(() => memoria.correggi(voce.id, "password: pippo1234"), VoceRifiutata);
});

test("il controllo sui segreti lascia passare le frasi normali", () => {
  for (const innocua of [
    "Preferisce che le password non vengano mai mostrate.",
    "Il token di accesso scade ogni mese: va rinnovato a mano.",
    "Usa una chiave SSH per entrare nel server, mai la password.",
    "Il PIN è una cosa che non vuole dettare.",
  ]) {
    assert.equal(sembraUnSegreto(innocua), false, innocua);
  }
  for (const segreto of [
    "-----BEGIN OPENSSH PRIVATE KEY-----",
    "ghp_abcdefghijklmnopqrstuvwxyz0123",
    "api key = 9f8e7d6c5b4a",
    "il pin è 4821",
  ]) {
    assert.equal(sembraUnSegreto(segreto), true, segreto);
  }
});

test("ogni conversazione riceve la memoria una volta, e di nuovo solo quando cambia", async (t) => {
  const memoria = await Memoria.apri(await fileDiProva(t));
  // Finché è vuota non c'è nulla da dire a nessuno.
  assert.equal(memoria.daConsegnare("home"), undefined);

  const voce = await memoria.annota("Preferisce risposte brevi.");
  const nota = memoria.daConsegnare("progetto-1");
  assert.ok(nota !== undefined && nota.startsWith("[Shinka] Memoria del proprietario"));
  assert.ok(nota.endsWith(`- [${voce.id}] Preferisce risposte brevi.`));
  assert.equal(memoria.daConsegnare("progetto-1"), undefined);
  // Un'altra conversazione non l'ha ancora avuta.
  assert.ok(memoria.daConsegnare("progetto-2") !== undefined);

  // Chi l'ha appena cambiata, e la conosceva, la conosce ancora; gli altri la ricevono di nuovo, intera.
  assert.ok(memoria.daConsegnare("home") !== undefined);
  await memoria.annota("Lavora in italiano.", UN_GIORNO, "home");
  assert.equal(memoria.daConsegnare("home"), undefined);
  // Chi la cambia senza averla ricevuta nella versione di prima la riceve comunque intera.
  await memoria.annota("Usa pnpm.", UN_GIORNO, "progetto-2");
  assert.match(memoria.daConsegnare("progetto-2") ?? "", /Usa pnpm\.$/);
  assert.match(memoria.daConsegnare("progetto-1") ?? "", /Preferisce risposte brevi\.\n- \[[a-z0-9]{6}\] Lavora in italiano\.\n- \[[a-z0-9]{6}\] Usa pnpm\.$/);

  // Svuotata, lo si dice a chi ne conosceva una versione.
  for (const { id } of memoria.voci()) await memoria.cancella(id);
  assert.match(memoria.daConsegnare("progetto-1") ?? "", /ora è vuota/);
  assert.equal(memoria.daConsegnare("progetto-1"), undefined);
});

test("dopo un riavvio del centro, una memoria svuotata viene detta anche a chi l'aveva avuta prima", async (t) => {
  const file = await fileDiProva(t);
  const prima = await Memoria.apri(file);
  const voce = await prima.annota("Preferisce risposte brevi.");
  assert.ok(prima.daConsegnare("progetto-1") !== undefined);
  await prima.cancella(voce.id);

  // Il centro riparte: di chi aveva ricevuto la memoria non resta traccia.
  const dopo = await Memoria.apri(file);
  assert.match(dopo.daConsegnare("progetto-1") ?? "", /ora è vuota: se in questa conversazione/);
  assert.equal(dopo.daConsegnare("progetto-1"), undefined);
});
