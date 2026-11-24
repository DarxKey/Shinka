/**
 * Le estensioni dell'interfaccia (ADR 0054): la Home ne propone una, il proprietario guarda le pagine
 * in anteprima e la conferma; le pagine si servono chiuse nel loro recinto.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { LightMyRequestResponse } from "fastify";
import type { EventoConversazione } from "../protocollo/eventi.ts";
import { leggiRichiestaInterfaccia, POLITICA_PAGINA_ESTENSIONE } from "../protocollo/interfaccia.ts";
import { conLaLibreria } from "../protocollo/ponte-delle-pagine.ts";
import { allestisci, type Banco } from "../prove/banco.ts";
import { COOKIE_SESSIONE } from "./centro.ts";
import { azioniDellaHome } from "./strumenti-home.ts";

async function chiama(banco: Banco, method: "GET" | "POST" | "DELETE", url: string, payload?: Record<string, unknown>): Promise<LightMyRequestResponse> {
  return banco.centro.inject({ method, url, cookies: { [COOKIE_SESSIONE]: await banco.entra() }, ...(payload === undefined ? {} : { payload }) });
}

const PAGINA = "<!doctype html><title>NAS</title><p id='quanti'></p><script>parent.postMessage({ shinka: 'stato' }, '*')</script>";

test("la proposta di un'estensione dell'interfaccia si controlla prima di mostrarla", () => {
  const buona = { nome: "cyberpunk", descrizione: "Un tema scuro con il neon.", tema: ":root { --accento: #ff00aa; }", pagine: [{ id: "nas", titolo: "NAS", html: PAGINA }], pulsanti: [{ etichetta: "Riassumi", testo: "Riassumi la conversazione." }] };
  const letta = leggiRichiestaInterfaccia(buona);
  assert.ok(!("motivo" in letta));
  assert.deepEqual(letta.pagine[0]?.posti, [{ posto: "menu", ambito: "ovunque", client: "tutti" }]);
  assert.equal(letta.pulsanti[0]?.dove, "ovunque");
  for (const [cattiva, motivo] of [
    [{ ...buona, nome: "Con Spazi" }, /minuscole/],
    [{ ...buona, descrizione: "" }, /descrizione/],
    [{ ...buona, tema: "@import url(https://x.it/a.css);" }, /altri siti/],
    [{ ...buona, tema: "body { background: url('https://x.it/a.png') }" }, /altri siti/],
    [{ ...buona, pagine: [{ id: "Nas!", titolo: "NAS", html: PAGINA }] }, /id breve/],
    [{ ...buona, pagine: [{ id: "a", titolo: "A", html: PAGINA }, { id: "a", titolo: "B", html: PAGINA }] }, /stesso id/],
    [{ ...buona, pagine: [{ id: "a", titolo: "A", html: PAGINA, dove: "barra" }] }, /posto che non c'è/],
    [{ ...buona, pulsanti: [{ etichetta: "", testo: "x" }] }, /etichetta/],
    [{ nome: "vuota", descrizione: "Niente." }, /almeno un tema/],
  ] as const) {
    const esito = leggiRichiestaInterfaccia(cattiva);
    assert.ok("motivo" in esito, JSON.stringify(cattiva));
    assert.match(esito.motivo, motivo);
  }
});

test("la Home propone un'estensione dell'interfaccia: anteprima nel recinto, conferma, pagina servita chiusa, spegnere e togliere", async (t) => {
  const banco = await allestisci(t);
  const azioni = azioniDellaHome({ ambienti: banco.ambienti, lavori: banco.lavori, proposte: banco.proposte, home: () => banco.casa, agisci: banco.agisci, interfaccia: banco.interfaccia });
  const mostrata = await azioni.proponiInterfaccia({
    nome: "nas",
    descrizione: "Una pagina con lo stato dei progetti.",
    tema: ":root {\n  --accento: #ff00aa;\n}",
    pagine: [{ id: "stato", titolo: "Stato", dove: "menu", html: PAGINA }],
    pulsanti: [{ etichetta: "Riassumi", testo: "Riassumi la conversazione.", dove: "home" }],
  });
  assert.equal(mostrata.isError, undefined);
  const scheda = banco.canale.archiviati.map((voce) => voce.evento).find((evento): evento is Extract<EventoConversazione, { tipo: "interfaccia-proposta" }> => evento.tipo === "interfaccia-proposta");
  assert.ok(scheda !== undefined);
  assert.deepEqual({ ...scheda, idProposta: "" }, {
    tipo: "interfaccia-proposta",
    idProposta: "",
    nome: "nas",
    descrizione: "Una pagina con lo stato dei progetti.",
    righeTema: 3,
    pagine: [{ id: "stato", titolo: "Stato", posti: [{ posto: "menu", ambito: "ovunque", client: "tutti" }] }],
    pulsanti: [{ etichetta: "Riassumi", testo: "Riassumi la conversazione.", dove: "home" }],
    api: [],
    comandi: [],
    parti: [],
  });
  // L'HTML non entra nella storia della conversazione: si guarda dall'anteprima, chiuso nel recinto.
  assert.doesNotMatch(JSON.stringify(banco.canale.archiviati), /postMessage/);
  const anteprima = await chiama(banco, "GET", `/api/interfaccia/proposte/${scheda.idProposta}/pagine/stato`);
  assert.equal(anteprima.statusCode, 200);
  // In cima la libreria del ponte (ADR 0057), poi la pagina com'è.
  assert.equal(anteprima.body, conLaLibreria(PAGINA));
  assert.equal(anteprima.headers["content-security-policy"], POLITICA_PAGINA_ESTENSIONE);
  assert.match(POLITICA_PAGINA_ESTENSIONE, /^sandbox allow-scripts;.*connect-src 'none'/);
  assert.equal(banco.interfaccia.stato().estensioni.length, 0);

  // Confermata, entra accesa; la pagina si serve, l'elenco non ne porta l'HTML, e la Home lo sa.
  assert.equal((await chiama(banco, "POST", `/api/interfaccia/proposte/${scheda.idProposta}`, { esito: "confermata" })).statusCode, 200);
  const [estensione] = banco.interfaccia.stato().estensioni;
  assert.ok(estensione !== undefined && estensione.accesa);
  assert.equal(estensione.tema, ":root {\n  --accento: #ff00aa;\n}");
  assert.doesNotMatch(JSON.stringify(banco.interfaccia.stato()), /postMessage/);
  assert.match(banco.home.annotazioni.at(-1) ?? "", /ha confermato l'estensione dell'interfaccia "nas"/);
  const pagina = await chiama(banco, "GET", `/api/interfaccia/${estensione.id}/pagine/stato`);
  assert.equal(pagina.statusCode, 200);
  assert.equal(pagina.headers["content-security-policy"], POLITICA_PAGINA_ESTENSIONE);
  assert.equal((await chiama(banco, "GET", `/api/interfaccia/proposte/${scheda.idProposta}/pagine/stato`)).statusCode, 404);
  // Senza sessione la pagina non si vede.
  assert.equal((await banco.centro.inject({ method: "GET", url: `/api/interfaccia/${estensione.id}/pagine/stato` })).statusCode, 401);

  // Riproposta con lo stesso nome la sostituisce, con lo stesso identificativo.
  await azioni.proponiInterfaccia({ nome: "nas", descrizione: "Solo il tema.", tema: "body { color: red }" });
  const seconda = banco.canale.archiviati.map((voce) => voce.evento).filter((evento) => evento.tipo === "interfaccia-proposta").at(-1);
  assert.ok(seconda?.tipo === "interfaccia-proposta" && seconda.sostituisce === true);
  assert.equal((await chiama(banco, "POST", `/api/interfaccia/proposte/${seconda.idProposta}`, { esito: "confermata" })).statusCode, 200);
  assert.deepEqual(banco.interfaccia.stato().estensioni.map((una) => [una.id, una.descrizione, una.pagine.length]), [[estensione.id, "Solo il tema.", 0]]);

  // Spenta, le sue pagine non si servono; tolta, non c'è più.
  assert.equal((await chiama(banco, "POST", `/api/interfaccia/${estensione.id}`, { accesa: false })).statusCode, 200);
  assert.equal(banco.interfaccia.stato().estensioni[0]?.accesa, false);
  assert.equal((await chiama(banco, "DELETE", `/api/interfaccia/${estensione.id}`)).statusCode, 200);
  assert.deepEqual(banco.interfaccia.stato().estensioni, []);

  // Una proposta annullata non entra.
  await azioni.proponiInterfaccia({ nome: "pulsanti", descrizione: "Un pulsante.", pulsanti: [{ etichetta: "Ciao", testo: "Ciao!" }] });
  const terza = banco.canale.archiviati.map((voce) => voce.evento).filter((evento) => evento.tipo === "interfaccia-proposta").at(-1);
  assert.ok(terza?.tipo === "interfaccia-proposta");
  assert.equal((await chiama(banco, "POST", `/api/interfaccia/proposte/${terza.idProposta}`, { esito: "annullata" })).statusCode, 200);
  assert.deepEqual(banco.interfaccia.stato().estensioni, []);
  assert.equal((await chiama(banco, "POST", `/api/interfaccia/proposte/${terza.idProposta}`, { esito: "confermata" })).statusCode, 404);

  // Una proposta che non va non si mostra, e la Home sa perché.
  const sbagliata = await azioni.proponiInterfaccia({ nome: "x", descrizione: "y" });
  assert.equal(sbagliata.isError, true);
});

test("le richieste che l'interfaccia fa per un'estensione entrano nel registro con il suo nome, e le rotte chiuse si rifiutano anche al centro", async (t) => {
  const banco = await allestisci(t);
  const cookie = await banco.entra();
  const conEstensione = (method: "GET" | "POST", url: string, payload?: Record<string, unknown>) =>
    banco.centro.inject({ method, url, cookies: { [COOKIE_SESSIONE]: cookie }, headers: { "x-shinka-estensione": encodeURIComponent("barra risorse") }, ...(payload === undefined ? {} : { payload }) });
  assert.equal((await conEstensione("GET", "/api/ambienti/centro/risorse")).statusCode, 200);
  const chiusa = await conEstensione("POST", "/api/impostazioni/password", { attuale: "x", nuova: "y" });
  assert.equal(chiusa.statusCode, 403);
  assert.equal((await conEstensione("POST", "/api/home/permessi/p1", { decisione: "approvato" })).statusCode, 403);
  const registro = { registro: ((await chiama(banco, "GET", "/api/sicurezza")).json() as { voci: { tipo: string; dettaglio?: string }[] }).voci };
  assert.ok(registro.registro.some((voce) => voce.tipo === "richiesta-estensione" && voce.dettaglio === "«barra risorse» GET /api/ambienti/centro/risorse"));
  assert.ok(registro.registro.some((voce) => voce.tipo === "richiesta-estensione-rifiutata" && voce.dettaglio === "«barra risorse» POST /api/impostazioni/password"));
  // Senza sessione l'intestazione non apre nulla.
  assert.equal((await banco.centro.inject({ method: "GET", url: "/api/ambienti/centro/risorse", headers: { "x-shinka-estensione": "barra" } })).statusCode, 401);
});
