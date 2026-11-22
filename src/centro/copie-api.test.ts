import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { CopiaCaricata, CopiaPronta, EsitoTrasloco, StatoCopie } from "../protocollo/copia.ts";
import { allestisci, PASSWORD, type Banco } from "../prove/banco.ts";
import { COOKIE_SESSIONE } from "./centro.ts";
import { applicaRipristino } from "./copia-di-sicurezza.ts";

const DELLA_COPIA = "la password della copia";

async function chiedi(banco: Banco, method: "GET" | "POST" | "DELETE", url: string, payload?: Record<string, unknown> | Buffer) {
  return banco.centro.inject({
    method,
    url,
    cookies: { [COOKIE_SESSIONE]: await banco.entra() },
    ...(payload === undefined ? {} : Buffer.isBuffer(payload) ? { payload, headers: { "content-type": "application/octet-stream" } } : { payload }),
  });
}

/** Un'installazione con memoria, skill e un progetto, e la sua copia scaricata. */
async function conLaCopia(t: Parameters<typeof allestisci>[0]): Promise<{ casa: Banco; copia: Buffer }> {
  const casa = await allestisci(t);
  await casa.memoria.annota("Preferisce le risposte brevi.");
  await casa.memoria.annota("Il server di casa si chiama Unraid.");
  await casa.skill.salva({ nome: "backup-foto", descrizione: "Quando serve copiare le foto.", contenuto: "1. Monta il disco.\n2. Copia.", motivo: "prova" }, "prova");
  await casa.skill.salva({ nome: "aggiorna-esxi", descrizione: "Quando c'è da aggiornare ESXi.", contenuto: "Passi.", motivo: "prova" }, "prova");
  await casa.lavori.crea("Videogioco", "centro", "Un gioco.");
  const preparata = await chiedi(casa, "POST", "/api/copie/preparazione", { password: DELLA_COPIA });
  assert.equal(preparata.statusCode, 200, preparata.body);
  const pronta = preparata.json() as CopiaPronta;
  assert.match(pronta.nome, /^shinka-copia-\d{4}-\d{2}-\d{2}-\d{4}\.shinka$/);
  const scaricata = await chiedi(casa, "GET", `/api/copie/scaricamento/${pronta.id}`);
  assert.equal(scaricata.statusCode, 200);
  assert.match(String(scaricata.headers["content-disposition"]), /attachment; filename="shinka-copia-/);
  assert.equal(scaricata.rawPayload.length, pronta.byte);
  return { casa, copia: scaricata.rawPayload };
}

test("una copia si prepara con una password sua, si scarica, e senza sessione non c'è nulla", async (t) => {
  const { casa, copia } = await conLaCopia(t);
  // Nel file non si legge nulla dei dati.
  for (const scritto of ["Preferisce", "backup-foto", "Videogioco"]) assert.equal(copia.includes(scritto), false);
  assert.equal((await chiedi(casa, "POST", "/api/copie/preparazione", { password: "corta" })).statusCode, 409);
  assert.equal((await chiedi(casa, "GET", "/api/copie/scaricamento/non-esiste")).statusCode, 404);
  assert.equal((await casa.centro.inject({ method: "GET", url: "/api/copie" })).statusCode, 401);
  assert.equal((await casa.centro.inject({ method: "POST", url: "/api/copie/preparazione", payload: { password: DELLA_COPIA } })).statusCode, 401);
  // Una copia di prima lascia il posto a quella nuova, e la preparazione resta nel registro delle richieste.
  const pronta = (await chiedi(casa, "POST", "/api/copie/preparazione", { password: DELLA_COPIA })).json() as CopiaPronta;
  assert.equal((await chiedi(casa, "GET", `/api/copie/scaricamento/${pronta.id}`)).statusCode, 200);
  const sicurezza = (await chiedi(casa, "GET", "/api/sicurezza")).json() as { voci: { tipo: string }[] };
  assert.equal(sicurezza.voci.filter((voce) => voce.tipo === "copia-preparata").length, 2);
  // La copia di una copia non contiene le copie.
  assert.ok(pronta.byte < copia.length * 1.5);
});

test("il trasloco: da una copia caricata e aperta arrivano memoria e skill scelte, e il resto non si tocca", async (t) => {
  const { copia } = await conLaCopia(t);
  const lavoro = await allestisci(t);
  await lavoro.memoria.annota("Il server di casa si chiama Unraid.");
  await lavoro.skill.salva({ nome: "backup-foto", descrizione: "Un'altra descrizione.", contenuto: "Altri passi.", motivo: "prova" }, "prova");
  await lavoro.lavori.crea("Del lavoro", "centro", "Un progetto del lavoro.");

  // Un file qualunque non resta sul server.
  assert.equal((await chiedi(lavoro, "POST", "/api/copie/caricata", Buffer.from("non sono una copia"))).statusCode, 400);
  assert.equal(((await chiedi(lavoro, "GET", "/api/copie")).json() as StatoCopie).caricata, undefined);

  const caricata = await chiedi(lavoro, "POST", "/api/copie/caricata", copia);
  assert.equal(caricata.statusCode, 200, caricata.body);
  const vista = caricata.json() as CopiaCaricata;
  assert.equal(vista.versione, "versione-di-prova");
  assert.equal(vista.contenuto, undefined);
  // Prima di aprirla non si porta nulla.
  assert.equal((await chiedi(lavoro, "POST", "/api/copie/trasloco", { memoria: true, skill: [] })).statusCode, 409);
  assert.equal((await chiedi(lavoro, "POST", "/api/copie/apertura", { password: "non è questa qui" })).statusCode, 403);
  const aperta = await chiedi(lavoro, "POST", "/api/copie/apertura", { password: DELLA_COPIA });
  assert.equal(aperta.statusCode, 200, aperta.body);
  const contenuto = (aperta.json() as CopiaCaricata).contenuto;
  assert.ok(contenuto !== undefined);
  assert.equal(contenuto.stessaVersione, true);
  assert.deepEqual(contenuto.memoria, { voci: 2, nuove: 1 });
  assert.deepEqual(
    contenuto.skill.map((skill) => [skill.nome, skill.qui]),
    [["aggiorna-esxi", undefined], ["backup-foto", "diversa"]],
  );
  assert.equal(contenuto.progetti, 1);
  assert.deepEqual(contenuto.progettiSenzaCartella, []);

  const portato = await chiedi(lavoro, "POST", "/api/copie/trasloco", { memoria: true, skill: ["aggiorna-esxi", "che-non-esiste"] });
  assert.equal(portato.statusCode, 200, portato.body);
  const esito = portato.json() as EsitoTrasloco;
  assert.equal(esito.memoria, 1);
  assert.deepEqual(esito.skillCreate, ["aggiorna-esxi"]);
  assert.deepEqual(esito.skillCambiate, []);
  assert.deepEqual(esito.rifiutati.map((voce) => voce.che), ["La skill che-non-esiste"]);
  assert.deepEqual(lavoro.memoria.voci().map((voce) => voce.testo), ["Il server di casa si chiama Unraid.", "Preferisce le risposte brevi."]);
  assert.equal((await lavoro.skill.leggi("aggiorna-esxi"))?.contenuto, "Passi.");
  // Quella non scelta resta com'era, e il progetto del lavoro pure.
  assert.equal((await lavoro.skill.leggi("backup-foto"))?.contenuto, "Altri passi.");
  assert.deepEqual(lavoro.progetti.elenco().map((progetto) => progetto.nome), ["Del lavoro"]);
  // Dopo, la copia dice che la memoria qui c'è già tutta.
  assert.deepEqual(((await chiedi(lavoro, "GET", "/api/copie")).json() as StatoCopie).caricata?.contenuto?.memoria, { voci: 2, nuove: 0 });
  // Tolta la copia caricata, non resta nulla.
  assert.equal((await chiedi(lavoro, "DELETE", "/api/copie/caricata")).statusCode, 200);
  assert.equal(existsSync(join(lavoro.cartella, "copia-di-sicurezza", "caricata.shinka")), false);
  assert.equal(existsSync(join(lavoro.cartella, "copia-di-sicurezza", "aperta")), false);
});

test("il ripristino: confermato con la password di Shinka, vale al riavvio, e i dati di prima restano da parte", async (t) => {
  const { copia } = await conLaCopia(t);
  const nuova = await allestisci(t);
  await nuova.memoria.annota("Una voce dell'installazione nuova.");
  writeFileSync(join(nuova.cartella, "gateway.json"), '{"di":"questa macchina"}');
  await chiedi(nuova, "POST", "/api/copie/caricata", copia);
  // Senza averla aperta, e con la password sbagliata, non parte.
  assert.equal((await chiedi(nuova, "POST", "/api/copie/ripristino", { password: PASSWORD })).statusCode, 409);
  await chiedi(nuova, "POST", "/api/copie/apertura", { password: DELLA_COPIA });
  assert.equal((await chiedi(nuova, "POST", "/api/copie/ripristino", { password: "non è la password di Shinka" })).statusCode, 403);
  assert.deepEqual(nuova.riavvii, []);
  assert.equal(applicaRipristino(nuova.cartella), undefined);

  const chiesto = await chiedi(nuova, "POST", "/api/copie/ripristino", { password: PASSWORD });
  assert.equal(chiesto.statusCode, 200, chiesto.body);
  assert.deepEqual(chiesto.json(), { riparte: true });
  assert.equal(nuova.riavvii.length, 1);
  // Mentre aspetta di ripartire non comincia altro.
  assert.equal((await chiedi(nuova, "POST", "/api/copie/preparazione", { password: DELLA_COPIA })).statusCode, 409);
  const sicurezza = (await chiedi(nuova, "GET", "/api/sicurezza")).json() as { voci: { tipo: string }[] };
  assert.deepEqual(
    sicurezza.voci.map((voce) => voce.tipo).filter((tipo) => tipo.startsWith("ripristino") || tipo.startsWith("copia")),
    ["ripristino-chiesto", "ripristino-rifiutato", "copia-caricata"],
  );

  // Il centro riparte: i dati sono quelli della copia.
  const esito = applicaRipristino(nuova.cartella);
  assert.equal(esito?.riuscito, true);
  const memoria = readFileSync(join(nuova.cartella, "memoria.md"), "utf8");
  assert.match(memoria, /Preferisce le risposte brevi/);
  assert.doesNotMatch(memoria, /installazione nuova/);
  assert.match(readFileSync(join(nuova.cartella, "progetti.json"), "utf8"), /Videogioco/);
  assert.equal(existsSync(join(nuova.cartella, "skill", "skills", "backup-foto", "SKILL.md")), true);
  assert.equal(readFileSync(join(nuova.cartella, "gateway.json"), "utf8"), '{"di":"questa macchina"}');
  // La pagina Impostazioni lo dice, e i dati di prima si possono togliere.
  const stato = (await chiedi(nuova, "GET", "/api/copie")).json() as StatoCopie;
  assert.equal(stato.ultimoRipristino?.riuscito, true);
  assert.ok((stato.datiDiPrima?.byte ?? 0) > 0);
  assert.equal(stato.caricata, undefined);
  const tolti = (await chiedi(nuova, "DELETE", "/api/copie/dati-di-prima")).json() as StatoCopie;
  assert.equal(tolti.datiDiPrima, undefined);
});
