import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { allestisci, PASSWORD } from "../prove/banco.ts";
import { COOKIE_SESSIONE } from "./centro.ts";
import { daDove, programmaDa, RegistroAccessi, type VoceAccesso } from "./registro-accessi.ts";
import type { SessioneInVista } from "./accesso.ts";

test("da dove arriva una richiesta, e con che cosa", () => {
  assert.equal(daDove("192.168.1.30", undefined), "192.168.1.30");
  assert.equal(daDove("::ffff:192.168.1.254", "203.0.113.9, 10.0.0.1"), "192.168.1.254 (per conto di 203.0.113.9)");
  assert.equal(daDove("192.168.1.30", "192.168.1.30"), "192.168.1.30");
  // Ciò che non è un indirizzo non entra nel registro così com'è.
  assert.equal(daDove("10.0.0.9", "<script>alert(1)</script>"), "10.0.0.9 (per conto di un indirizzo che non si legge)");
  assert.equal(daDove(undefined, undefined), "sconosciuto");
  assert.equal(programmaDa("Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1"), "iPhone · Safari");
  assert.equal(programmaDa("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"), "PC Windows · Chrome");
  assert.equal(programmaDa("curl/8.5.0"), "curl/8.5.0");
  assert.equal(programmaDa(undefined), "non lo dice");
});

test("ciò che si ripete a raffica sta in una riga con il suo conto; il resto una riga a volta; dopo un riavvio c'è ancora", () => {
  const file = join(mkdtempSync(join(tmpdir(), "shinka-accessi-")), "accessi.jsonl");
  const orologio = { ora: Date.parse("2026-11-22T10:00:00Z") };
  const registro = new RegistroAccessi({ file, adesso: () => orologio.ora });
  const estraneo = { da: "203.0.113.7", programma: "curl/8.5.0" };
  const casa = { da: "192.168.1.30", programma: "iPhone · Safari" };

  registro.annota("entrata", casa);
  for (let giro = 0; giro < 40; giro += 1) {
    orologio.ora += 1000;
    registro.annota("senza-sessione", estraneo, { percorso: `/api/cerca?q=segreto-${giro}` });
  }
  registro.annota("entrata-fallita", estraneo);
  registro.annota("entrata-fallita", estraneo);
  assert.deepEqual(
    registro.ultime(10).map((voce) => [voce.tipo, voce.da, voce.volte]),
    [
      ["entrata-fallita", "203.0.113.7", undefined],
      ["entrata-fallita", "203.0.113.7", undefined],
      ["senza-sessione", "203.0.113.7", 40],
      ["entrata", "192.168.1.30", undefined],
    ],
  );
  // Del percorso resta la prima parte: ciò che segue il punto interrogativo può essere un segreto.
  assert.equal(registro.ultime(10)[2]?.percorso, "/api/cerca");
  assert.ok(!readFileSync(file, "utf8").includes("segreto"));
  assert.equal(registro.ultime(10, true).length, 3);

  // Dopo dieci minuti la stessa cosa apre una riga nuova.
  orologio.ora += 11 * 60_000;
  registro.annota("senza-sessione", estraneo, { percorso: "/api/uso" });
  assert.equal(registro.ultime(10).filter((voce) => voce.tipo === "senza-sessione").length, 2);
  registro.chiudi();
  assert.equal(statSync(file).mode & 0o077, 0);

  const dopo = new RegistroAccessi({ file, adesso: () => orologio.ora });
  const rilette = dopo.ultime(10);
  assert.equal(rilette.length, 5);
  assert.equal(rilette.find((voce) => voce.volte === 40)?.finoA, "2026-11-22T10:00:40.000Z");
  dopo.chiudi();

  // Una riga rovinata non impedisce di leggere le altre.
  writeFileSync(file, `${readFileSync(file, "utf8")}{rovinata\n`);
  const ancora = new RegistroAccessi({ file });
  assert.equal(ancora.ultime(10).length, 5);
  ancora.chiudi();
});

test("dal centro: entrate riuscite e fallite, richieste senza sessione, e le sessioni che si chiudono dalla pagina", async (t) => {
  const banco = await allestisci(t);
  const iPhone = { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 Version/26.0 Mobile/15E148 Safari/604.1", "x-forwarded-for": "203.0.113.9" };
  const entra = async (password: string, intestazioni: Record<string, string> = {}) => banco.centro.inject({ method: "POST", url: "/api/accesso", payload: { password }, headers: intestazioni });

  assert.equal((await banco.centro.inject({ method: "GET", url: "/api/sicurezza" })).statusCode, 401);
  assert.equal((await banco.centro.inject({ method: "GET", url: "/api/cerca?q=segreto" })).statusCode, 401);
  assert.equal((await entra("sbagliata", { "user-agent": "curl/8.5.0" })).statusCode, 401);
  assert.equal((await banco.centro.inject({ method: "GET", url: "/wp-login.php" })).statusCode, 404);
  const telefono = (await entra(PASSWORD, iPhone)).cookies.find((voce) => voce.name === COOKIE_SESSIONE)?.value ?? "";
  const computer = (await entra(PASSWORD, { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0.0.0 Safari/537.36" })).cookies.find((voce) => voce.name === COOKIE_SESSIONE)?.value ?? "";

  const leggi = async (cookie: string, solo = "") =>
    (await banco.centro.inject({ method: "GET", url: `/api/sicurezza${solo}`, cookies: { [COOKIE_SESSIONE]: cookie }, headers: iPhone })).json<{ questa: string; sessioni: SessioneInVista[]; voci: VoceAccesso[] }>();
  const letto = await leggi(telefono);
  assert.equal(letto.sessioni.length, 2);
  const mia = letto.sessioni.find((sessione) => sessione.id === letto.questa);
  assert.equal(mia?.programma, "iPhone · Safari");
  assert.match(mia?.da ?? "", /\(per conto di 203\.0\.113\.9\)$/);
  assert.ok(mia?.vistaIl !== undefined && mia.apertaIl !== undefined);
  // L'identificativo di una sessione non è il suo cookie, e non serve a entrare.
  assert.ok(!JSON.stringify(letto).includes(telefono) && !JSON.stringify(letto).includes(computer));
  assert.equal((await banco.centro.inject({ method: "GET", url: "/api/sicurezza", cookies: { [COOKIE_SESSIONE]: letto.questa } })).statusCode, 401);

  const tipi = letto.voci.map((voce) => voce.tipo);
  assert.deepEqual(tipi.filter((tipo) => tipo === "entrata").length, 2);
  for (const atteso of ["entrata-fallita", "senza-sessione", "pagina-inesistente"]) assert.ok(tipi.includes(atteso as VoceAccesso["tipo"]), atteso);
  const senza = letto.voci.find((voce) => voce.tipo === "senza-sessione");
  assert.equal(senza?.volte, 2);
  assert.ok(!JSON.stringify(letto.voci).includes("segreto"));
  assert.equal(letto.voci.find((voce) => voce.tipo === "entrata-fallita")?.programma, "curl/8.5.0");
  assert.ok((await leggi(telefono, "?solo=da-guardare")).voci.every((voce) => voce.tipo !== "entrata"));

  // Dal telefono si chiude la sessione del computer: quel browser è fuori.
  const altra = letto.sessioni.find((sessione) => sessione.id !== letto.questa)?.id ?? "";
  const chiusa = await banco.centro.inject({ method: "POST", url: `/api/sicurezza/sessioni/${altra}/chiusura`, cookies: { [COOKIE_SESSIONE]: telefono } });
  assert.equal(chiusa.statusCode, 200, chiusa.body);
  assert.equal((await banco.centro.inject({ method: "GET", url: "/api/sicurezza", cookies: { [COOKIE_SESSIONE]: computer } })).statusCode, 401);
  assert.equal((await banco.centro.inject({ method: "POST", url: `/api/sicurezza/sessioni/${altra}/chiusura`, cookies: { [COOKIE_SESSIONE]: telefono } })).statusCode, 404);

  // «Chiudi tutte le altre» lascia dentro solo chi lo chiede.
  await entra(PASSWORD);
  await entra(PASSWORD);
  await entra(PASSWORD);
  const altre = await banco.centro.inject({ method: "POST", url: "/api/sicurezza/chiusura-delle-altre", cookies: { [COOKIE_SESSIONE]: telefono } });
  assert.deepEqual(altre.json(), { chiuse: 3 });
  assert.equal((await leggi(telefono)).sessioni.length, 1);
});
