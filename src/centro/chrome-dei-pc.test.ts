/**
 * Il Chrome dei PC (ADR 0063), con il nodo del banco sul collegamento: il nodo dice se c'è Chrome con
 * Claude in Chrome; il proprietario lo accende dalla pagina Ambienti; la Home lo vede nell'elenco
 * degli ambienti e vi fa un lavoro, con una conversazione a parte sul nodo le cui azioni nel browser
 * chiedono il consenso nella sua chat.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { EventoConversazione } from "../protocollo/eventi.ts";
import { allestisci, avviaNodoAccettato, finche, ID_NODO } from "../prove/banco.ts";
import { COOKIE_SESSIONE } from "./centro.ts";
import { LavoriNelBrowser } from "./lavori-nel-browser.ts";
import { azioniDellaHome } from "./strumenti-home.ts";

const CON_ESTENSIONE = { chrome: true, estensione: true, collegamento: true };

test("Chrome per Claude si accende dalla pagina Ambienti, e la Home lo vede nell'elenco", { timeout: 30_000 }, async (t) => {
  const banco = await allestisci(t);
  const nodo = await avviaNodoAccettato(t, banco, { chrome: { stato: CON_ESTENSIONE, acceso: false } });
  const cookies = { [COOKIE_SESSIONE]: await banco.entra() };
  const ambiente = () => banco.ambienti.stato().ambienti.find((uno) => uno.id === ID_NODO);
  assert.deepEqual(ambiente()?.chrome, CON_ESTENSIONE);
  assert.equal(ambiente()?.browserDelPc, false);
  const azioni = azioniDellaHome({ ambienti: banco.ambienti, lavori: banco.lavori, proposte: banco.proposte, home: () => banco.casa, agisci: banco.agisci });
  const elenco = () => (azioni.elencaAmbienti().content[0] as { text: string }).text;
  assert.match(elenco(), /PC Windows.*non l'ha acceso per Claude/);

  const acceso = await banco.centro.inject({ method: "POST", url: `/api/ambienti/${ID_NODO}/browser-del-pc`, cookies, payload: { attivo: true } });
  assert.equal(acceso.statusCode, 200, acceso.body);
  assert.deepEqual(acceso.json(), { attivo: true, riparte: false });
  // Il nodo la usa quando si ripresenta, come quando riparte.
  nodo.collegamento.ferma();
  await finche(() => !banco.ambienti.attivo(ID_NODO), "il nodo si scollega");
  nodo.collegamento.avvia();
  await finche(() => ambiente()?.browserDelPc === true, "il nodo si ripresenta con Chrome acceso");
  assert.match(elenco(), /PC Windows.*Chrome con Claude in Chrome: acceso, lo usi con usa_chrome_del_pc/);

  // L'ambiente del centro non ha Chrome da accendere.
  assert.equal((await banco.centro.inject({ method: "POST", url: "/api/ambienti/centro/browser-del-pc", cookies, payload: { attivo: true } })).statusCode, 409);
});

test("senza l'estensione Chrome per Claude non si accende", { timeout: 30_000 }, async (t) => {
  const banco = await allestisci(t);
  await avviaNodoAccettato(t, banco, { chrome: { stato: { chrome: true, estensione: false, collegamento: false }, acceso: false } });
  const cookies = { [COOKIE_SESSIONE]: await banco.entra() };
  const rifiutato = await banco.centro.inject({ method: "POST", url: `/api/ambienti/${ID_NODO}/browser-del-pc`, cookies, payload: { attivo: true } });
  assert.equal(rifiutato.statusCode, 409);
  assert.match((rifiutato.json() as { errore: string }).errore, /manca l'estensione Claude in Chrome/);
});

test("un lavoro della Home nel Chrome di un PC: conversazione a parte, consenso nella chat della Home, risultato alla Home", { timeout: 30_000 }, async (t) => {
  const banco = await allestisci(t);
  const nodo = await avviaNodoAccettato(t, banco, { chrome: { stato: CON_ESTENSIONE, acceso: true } });
  const lavori = banco.lavoriNelBrowser;
  const nellaHome: EventoConversazione[] = [];

  // Dove Chrome non è acceso, o l'ambiente non c'è, lo dice.
  assert.match((await lavori.esegui("Unraid", "apri YouTube", (evento) => nellaHome.push(evento))).testo, /Chrome non c'è/);
  assert.match((await lavori.esegui("Inventato", "apri YouTube", (evento) => nellaHome.push(evento))).testo, /Nessun ambiente si chiama "Inventato"\. Hanno Chrome acceso: "PC Windows"/);

  const esito = lavori.esegui("pc windows", "Apri YouTube in una scheda nuova e dimmi il titolo della pagina.", (evento) => nellaHome.push(evento));
  await finche(() => nodo.conversazioni.length === 1 && nodo.conversazioni[0]?.inviati.length === 1, "parte la conversazione sul nodo");
  const nelBrowser = nodo.conversazioni[0]!;
  const cfg = nelBrowser.configurazione;
  assert.equal(cfg?.impostazioni.browserChrome, true);
  assert.equal(cfg?.impostazioni.permessi, "chiedi");
  assert.equal(cfg?.browserDelPc, true);
  assert.match(cfg?.istruzioniAggiunte ?? "", /Un lavoro nel browser, per la Home di Shinka/);
  assert.equal(cfg?.strumentiNostri, undefined, "senza gli strumenti di Shinka");
  assert.match(cfg?.cartella ?? "", /shinka-browser-del-pc$/);
  assert.deepEqual(nelBrowser.inviati, ["Apri YouTube in una scheda nuova e dimmi il titolo della pagina."]);

  // Un'azione nel browser chiede il consenso nella chat della Home; il proprietario approva da lì.
  nelBrowser.emetti({ tipo: "permesso-richiesto", idPermesso: "p1", idAzione: "p1", strumento: "mcp__claude-in-chrome__navigate", ingresso: { url: "https://www.youtube.com" } });
  await finche(() => nellaHome.some((evento) => evento.tipo === "permesso-richiesto"), "il consenso arriva nella chat della Home");
  const chiesto = nellaHome.find((evento) => evento.tipo === "permesso-richiesto");
  assert.ok(chiesto?.tipo === "permesso-richiesto" && /Nel Chrome di «PC Windows», per la Home/.test(chiesto.motivo ?? ""));
  // Si decide nella chat della Home (o da Telegram, che passa da lei): la decisione va al lavoro nel browser.
  assert.equal(banco.casa.decidiPermesso("p1", "approvato"), true);
  await finche(() => nelBrowser.decisioni.length === 1, "la decisione arriva al nodo");
  assert.deepEqual(nelBrowser.decisioni, [["p1", "approvato"]]);
  assert.equal(lavori.decidiPermesso("p1", "approvato"), false, "una decisione vale una volta");

  // Alla fine la Home riceve il risultato, e la conversazione sul nodo si chiude.
  nelBrowser.emetti({ tipo: "permesso-richiesto", idPermesso: "p2", idAzione: "p2", strumento: "mcp__claude-in-chrome__computer", ingresso: {} });
  nelBrowser.emetti({ tipo: "testo-concluso", idTesto: "t1", testo: "La pagina si intitola «YouTube»." });
  nelBrowser.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 10 });
  const fatto = await esito;
  assert.notEqual(fatto.errore, true);
  assert.match(fatto.testo, /Fatto nel Chrome di «PC Windows»[\s\S]*La pagina si intitola «YouTube»/);
  // Ciò che aspettava ancora il proprietario si chiude nella chat della Home.
  assert.ok(nellaHome.some((evento) => evento.tipo === "permesso-deciso" && evento.idPermesso === "p2" && evento.decisione === "negato"));
  await finche(() => nelBrowser.chiusa, "la conversazione sul nodo si chiude");
});

test("in «Automatico» o «Senza permessi» della Home, il lavoro nel browser parte con lo stesso modo (ADR 0064)", { timeout: 30_000 }, async (t) => {
  const banco = await allestisci(t);
  const nodo = await avviaNodoAccettato(t, banco, { chrome: { stato: CON_ESTENSIONE, acceso: true } });
  for (const [permessi, atteso] of [
    ["senza-permessi", "senza-permessi"],
    ["automatico", "automatico"],
    ["modifiche-libere", "chiedi"],
  ] as const) {
    const lavori = new LavoriNelBrowser({ ambienti: banco.ambienti, esecutore: (idAmbiente) => banco.lavori.esecutore(idAmbiente), permessiDellaHome: () => permessi });
    const quante = nodo.conversazioni.length;
    const esito = lavori.esegui("PC Windows", "Apri YouTube.", () => {});
    await finche(() => nodo.conversazioni.length === quante + 1 && nodo.conversazioni.at(-1)?.inviati.length === 1, "parte la conversazione sul nodo");
    const nelBrowser = nodo.conversazioni.at(-1)!;
    assert.equal(nelBrowser.configurazione?.impostazioni.permessi, atteso, permessi);
    nelBrowser.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 1 });
    await esito;
  }
});
