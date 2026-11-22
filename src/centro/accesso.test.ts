import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { Accesso } from "./accesso.ts";

const PASSWORD = "una-password-di-prova";

async function cartellaProvvisoria(t: TestContext): Promise<string> {
  const cartella = await mkdtemp(join(tmpdir(), "shinka-accesso-"));
  t.after(() => rm(cartella, { recursive: true, force: true }));
  return cartella;
}

test("senza password impostata nessuno entra", async (t) => {
  const accesso = await Accesso.apri(await cartellaProvvisoria(t));
  assert.equal(accesso.configurato, false);
  assert.deepEqual(await accesso.entra(PASSWORD), { esito: "rifiutato" });
});

test("una password troppo corta viene rifiutata", async (t) => {
  const accesso = await Accesso.apri(await cartellaProvvisoria(t));
  await assert.rejects(() => accesso.impostaPassword("corta"), /almeno 10 caratteri/);
});

test("con la password giusta si ottiene una sessione valida", async (t) => {
  const accesso = await Accesso.apri(await cartellaProvvisoria(t));
  await accesso.impostaPassword(PASSWORD);
  const esito = await accesso.entra(PASSWORD);
  assert.equal(esito.esito, "ok");
  assert.ok(esito.esito === "ok" && accesso.valida(esito.token));
});

test("con la password sbagliata no", async (t) => {
  const accesso = await Accesso.apri(await cartellaProvvisoria(t));
  await accesso.impostaPassword(PASSWORD);
  assert.deepEqual(await accesso.entra("un'altra-password"), { esito: "rifiutato" });
});

test("un token inventato o assente non vale", async (t) => {
  const accesso = await Accesso.apri(await cartellaProvvisoria(t));
  await accesso.impostaPassword(PASSWORD);
  assert.equal(accesso.valida("token-inventato"), false);
  assert.equal(accesso.valida(undefined), false);
  assert.equal(accesso.valida(""), false);
});

test("la sessione scade", async (t) => {
  const accesso = await Accesso.apri(await cartellaProvvisoria(t));
  await accesso.impostaPassword(PASSWORD);
  const esito = await accesso.entra(PASSWORD, 1_000);
  assert.ok(esito.esito === "ok");
  assert.equal(accesso.valida(esito.token, 1_000 + esito.durataMs - 1), true);
  assert.equal(accesso.valida(esito.token, 1_000 + esito.durataMs), false);
});

test("uscire invalida la sessione", async (t) => {
  const accesso = await Accesso.apri(await cartellaProvvisoria(t));
  await accesso.impostaPassword(PASSWORD);
  const esito = await accesso.entra(PASSWORD);
  assert.ok(esito.esito === "ok");
  await accesso.esci(esito.token);
  assert.equal(accesso.valida(esito.token), false);
});

test("la sessione sopravvive al riavvio, la password in chiaro non è su disco", async (t) => {
  const cartella = await cartellaProvvisoria(t);
  const primo = await Accesso.apri(cartella);
  await primo.impostaPassword(PASSWORD);
  const esito = await primo.entra(PASSWORD);
  assert.ok(esito.esito === "ok");

  const secondo = await Accesso.apri(cartella);
  assert.equal(secondo.configurato, true);
  assert.equal(secondo.valida(esito.token), true);

  const suDisco =
    (await readFile(join(cartella, "proprietario.json"), "utf8")) +
    (await readFile(join(cartella, "sessioni.json"), "utf8"));
  assert.equal(suDisco.includes(PASSWORD), false);
  assert.equal(suDisco.includes(esito.token), false);
});

test("cambiare password chiude le sessioni aperte", async (t) => {
  const accesso = await Accesso.apri(await cartellaProvvisoria(t));
  await accesso.impostaPassword(PASSWORD);
  const esito = await accesso.entra(PASSWORD);
  assert.ok(esito.esito === "ok");
  await accesso.impostaPassword("un'altra-password-lunga");
  assert.equal(accesso.valida(esito.token), false);
});

test("una password cambiata da un altro processo vale subito e chiude le sessioni", async (t) => {
  const cartella = await cartellaProvvisoria(t);
  // Il centro è acceso prima che il proprietario abbia scelto la password.
  const centro = await Accesso.apri(cartella);
  assert.equal(centro.configurato, false);

  // Il comando che imposta la password gira in un altro processo, sulla stessa cartella.
  const comando = await Accesso.apri(cartella);
  await comando.impostaPassword(PASSWORD);

  const traPoco = Date.now() + 2_000;
  const esito = await centro.entra(PASSWORD, traPoco);
  assert.equal(esito.esito, "ok");
  assert.ok(esito.esito === "ok" && centro.valida(esito.token, traPoco));

  await new Promise((risolvi) => setTimeout(risolvi, 20));
  await comando.impostaPassword("un'altra-password-lunga");
  const piuTardi = Date.now() + 5_000;
  assert.equal(centro.valida(esito.token, piuTardi), false);
  assert.deepEqual(await centro.entra(PASSWORD, piuTardi), { esito: "rifiutato" });
  assert.equal((await centro.entra("un'altra-password-lunga", piuTardi)).esito, "ok");
});

test("dopo cinque errori bisogna aspettare, anche con la password giusta", async (t) => {
  const accesso = await Accesso.apri(await cartellaProvvisoria(t));
  await accesso.impostaPassword(PASSWORD);
  for (let i = 0; i < 5; i += 1) {
    assert.deepEqual(await accesso.entra("sbagliata-ogni-volta", 1_000 + i), { esito: "rifiutato" });
  }
  const bloccato = await accesso.entra(PASSWORD, 2_000);
  assert.equal(bloccato.esito, "troppi-tentativi");
  assert.ok(bloccato.esito === "troppi-tentativi" && bloccato.riprovaTraMs > 0);

  const dopo = await accesso.entra(PASSWORD, 1_000 + 5 * 60 * 1000 + 10);
  assert.equal(dopo.esito, "ok");
});

test("la password si cambia con quella attuale: le altre sessioni si chiudono, chi la cambia resta dentro", async (t) => {
  const accesso = await Accesso.apri(await cartellaProvvisoria(t));
  await accesso.impostaPassword(PASSWORD);
  const altrove = await accesso.entra(PASSWORD);
  assert.equal(altrove.esito, "ok");

  assert.equal((await accesso.cambiaPassword("sbagliata", "una-nuova-password")).esito, "rifiutato");
  const cambiata = await accesso.cambiaPassword(PASSWORD, "una-nuova-password");
  assert.equal(cambiata.esito, "ok");
  assert.ok(cambiata.esito === "ok" && accesso.valida(cambiata.token));
  assert.ok(altrove.esito === "ok" && !accesso.valida(altrove.token));
  assert.equal((await accesso.entra(PASSWORD)).esito, "rifiutato");
  assert.equal((await accesso.entra("una-nuova-password")).esito, "ok");
});

test("chi prova a indovinare la password attuale trova lo stesso limite dell'entrata", async (t) => {
  const accesso = await Accesso.apri(await cartellaProvvisoria(t));
  await accesso.impostaPassword(PASSWORD);
  for (let i = 0; i < 5; i++) await accesso.cambiaPassword(`tentativo-${i}`, "una-nuova-password", 1000);
  assert.equal((await accesso.cambiaPassword(PASSWORD, "una-nuova-password", 2000)).esito, "troppi-tentativi");
});

test("di ogni sessione si sa quando è stata aperta, da dove e con che cosa, e quando è stata usata l'ultima volta", async (t) => {
  const cartella = await cartellaProvvisoria(t);
  const accesso = await Accesso.apri(cartella);
  await accesso.impostaPassword(PASSWORD);
  const telefono = await accesso.entra(PASSWORD, 1_000, { da: "192.168.1.30", programma: "iPhone · Safari" });
  const computer = await accesso.entra(PASSWORD, 2_000, { da: "192.168.1.40", programma: "PC Windows · Chrome" });
  assert.ok(telefono.esito === "ok" && computer.esito === "ok");

  accesso.segna(telefono.token, { da: "10.8.0.2", programma: "iPhone · Safari" }, 60_000);
  const viste = accesso.sessioni(61_000);
  // La più usata di recente per prima.
  assert.deepEqual(viste.map((sessione) => sessione.programma), ["iPhone · Safari", "PC Windows · Chrome"]);
  assert.equal(viste[0]?.id, accesso.idDi(telefono.token));
  assert.equal(viste[0]?.da, "192.168.1.30");
  assert.equal(viste[0]?.vistaDa, "10.8.0.2");
  assert.equal(viste[0]?.apertaIl, new Date(1_000).toISOString());
  assert.equal(viste[0]?.vistaIl, new Date(60_000).toISOString());
  // L'identificativo non è il token e non lo contiene.
  assert.ok(!JSON.stringify(viste).includes(telefono.token));
  assert.equal(accesso.valida(viste[0]?.id), false);
  assert.equal(accesso.idDi("token-inventato"), undefined);

  // Nel file non c'è il token, e ciò che si sa resta dopo un riavvio.
  await accesso.entra(PASSWORD, 62_000);
  const riaperto = await Accesso.apri(cartella);
  assert.ok(!(await readFile(join(cartella, "sessioni.json"), "utf8")).includes(telefono.token));
  assert.equal(riaperto.sessioni(63_000).find((sessione) => sessione.id === accesso.idDi(computer.token))?.da, "192.168.1.40");
});

test("una sessione si chiude dal suo identificativo, e tutte le altre insieme", async (t) => {
  const accesso = await Accesso.apri(await cartellaProvvisoria(t));
  await accesso.impostaPassword(PASSWORD);
  const [una, due, tre] = [await accesso.entra(PASSWORD), await accesso.entra(PASSWORD), await accesso.entra(PASSWORD)];
  assert.ok(una.esito === "ok" && due.esito === "ok" && tre.esito === "ok");

  assert.equal(await accesso.chiudiSessione("non-esiste"), false);
  // Un pezzo dell'identificativo non basta: non si chiude la sessione di un altro per caso.
  assert.equal(await accesso.chiudiSessione((accesso.idDi(due.token) ?? "").slice(0, 4)), false);
  assert.equal(await accesso.chiudiSessione(accesso.idDi(due.token) ?? ""), true);
  assert.equal(accesso.valida(due.token), false);
  assert.equal(accesso.valida(una.token), true);

  assert.equal(await accesso.chiudiLeAltre(una.token), 1);
  assert.equal(accesso.valida(tre.token), false);
  assert.equal(accesso.valida(una.token), true);
  assert.equal(accesso.sessioni().length, 1);
});

test("le sessioni salvate da una versione di prima, con la sola scadenza, restano valide", async (t) => {
  const cartella = await cartellaProvvisoria(t);
  const accesso = await Accesso.apri(cartella);
  await accesso.impostaPassword(PASSWORD);
  const esito = await accesso.entra(PASSWORD);
  assert.ok(esito.esito === "ok");
  const file = join(cartella, "sessioni.json");
  const salvate = JSON.parse(await readFile(file, "utf8")) as Record<string, { scade: number }>;
  await writeFile(file, JSON.stringify(Object.fromEntries(Object.entries(salvate).map(([chiave, sessione]) => [chiave, sessione.scade]))));

  const riaperto = await Accesso.apri(cartella);
  assert.equal(riaperto.valida(esito.token), true);
  const viste = riaperto.sessioni();
  assert.equal(viste.length, 1);
  assert.equal(viste[0]?.apertaIl, undefined);
});
