/**
 * Le estensioni dell'interfaccia nel protocollo (ADR 0057): la proposta con posti, API, comandi e
 * parti; quali richieste un'estensione può fare; le scorciatoie; la libreria in cima alle pagine.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { apiConsentita, conICampiNuovi, leggiRichiestaInterfaccia, rottaEsclusa, tastiCombaciano } from "./interfaccia.ts";
import { conLaLibreria, LIBRERIA_DEL_PONTE } from "./ponte-delle-pagine.ts";

const HTML = "<!doctype html><html><head><title>x</title></head><body>ciao</body></html>";

test("una proposta con posti, API, comandi e parti si legge; i posti di prima diventano posti nuovi", () => {
  const letta = leggiRichiestaInterfaccia({
    nome: "risorse",
    descrizione: "La barra delle risorse.",
    pagine: [
      { id: "barra", titolo: "Risorse", html: HTML, posti: [{ posto: "barra-destra" }, { posto: "testata", ambito: "progetti", client: "desktop" }, "flottante"] },
      { id: "vecchia", titolo: "Vecchia", html: HTML, dove: "pannello" },
      { id: "nascosta", titolo: "Solo da comando", html: HTML, posti: [] },
    ],
    api: ["GET /api/ambienti/*/risorse", "* /api/progetti/**"],
    comandi: [
      { etichetta: "Apri le risorse", tasti: "Ctrl+Shift+R", azione: { tipo: "pagina", pagina: "nascosta" } },
      { etichetta: "Aggiorna", azione: { tipo: "segnale", nome: "aggiorna" } },
    ],
    parti: ["stato-progetto", { parte: "pannello-file", pagina: "barra" }],
  });
  assert.ok(!("motivo" in letta), "motivo" in letta ? letta.motivo : "");
  assert.deepEqual(letta.pagine[0]?.posti, [
    { posto: "barra-destra", ambito: "ovunque", client: "tutti" },
    { posto: "testata", ambito: "progetti", client: "desktop" },
    { posto: "flottante", ambito: "ovunque", client: "tutti" },
  ]);
  assert.deepEqual(letta.pagine[1]?.posti, [{ posto: "pannello", ambito: "ovunque", client: "tutti" }]);
  assert.deepEqual(letta.pagine[2]?.posti, []);
  assert.deepEqual(letta.parti, [{ parte: "stato-progetto" }, { parte: "pannello-file", pagina: "barra" }]);
  assert.equal(letta.comandi[0]?.tasti, "Ctrl+Shift+R");

  // Ciò che non sta in piedi lo dice.
  const motivo = (proposta: Record<string, unknown>): string => {
    const esito = leggiRichiestaInterfaccia({ nome: "x", descrizione: "x", pagine: [{ id: "p", titolo: "P", html: HTML }], ...proposta });
    return "motivo" in esito ? esito.motivo : "";
  };
  assert.match(motivo({ pagine: [{ id: "p", titolo: "P", html: HTML, posti: ["sul-tetto"] }] }), /posto che non c'è/);
  assert.match(motivo({ api: ["GET ambienti"] }), /non è una voce delle API/);
  assert.match(motivo({ comandi: [{ etichetta: "C", tasti: "Q", azione: { tipo: "segnale", nome: "a" } }] }), /tasti/);
  assert.match(motivo({ comandi: [{ etichetta: "C", azione: { tipo: "pagina", pagina: "altra" } }] }), /azione/);
  assert.match(motivo({ parti: ["laterale"] }), /parte che non c'è/);
});

test("un'estensione chiama solo le API che ha dichiarato, e mai le rotte chiuse", () => {
  const api = ["GET /api/ambienti/*/risorse", "* /api/progetti/**"];
  assert.equal(apiConsentita(api, "GET", "/api/ambienti/nodo-1/risorse"), true);
  assert.equal(apiConsentita(api, "POST", "/api/ambienti/nodo-1/risorse"), false);
  assert.equal(apiConsentita(api, "GET", "/api/ambienti/nodo-1/risorse/altro"), false);
  assert.equal(apiConsentita(api, "POST", "/api/progetti/abc/messaggi"), true);
  assert.equal(apiConsentita(api, "GET", "/api/vault"), false);
  assert.equal(apiConsentita(api, "GET", "/api/../vault"), false);
  // Anche con "tutte": l'accesso a Shinka e le decisioni del proprietario restano chiusi.
  const tutte = ["tutte"];
  assert.equal(apiConsentita(tutte, "GET", "/api/vault"), true);
  assert.equal(apiConsentita(tutte, "POST", "/api/progetti/abc/messaggi"), true);
  for (const [metodo, percorso] of [
    ["POST", "/api/impostazioni/password"],
    ["POST", "/api/uscita"],
    ["POST", "/api/dispositivi"],
    ["POST", "/api/sicurezza/chiusura-delle-altre"],
    ["POST", "/api/copie/ripristino"],
    ["POST", "/api/progetti/abc/permessi/p1"],
    ["POST", "/api/home/permessi/p1"],
    ["POST", "/api/home/chat/2/permessi/p1"],
    ["POST", "/api/approvazioni/a1"],
    ["POST", "/api/proposte/x"],
    ["POST", "/api/sviluppo/installazioni/x"],
    ["POST", "/api/estensioni/proposte/x"],
    ["POST", "/api/interfaccia/proposte/x"],
    ["POST", "/api/desktop/pubblicazione"],
  ] as const) {
    assert.equal(rottaEsclusa(metodo, percorso), true, `${metodo} ${percorso}`);
    assert.equal(apiConsentita(tutte, metodo, percorso), false, `${metodo} ${percorso}`);
  }
  assert.equal(apiConsentita(tutte, "GET", "/api/sicurezza"), true);
  assert.equal(apiConsentita(tutte, "POST", "/api/progetti/abc/domande/d1"), true);
});

test("i tasti di un comando si riconoscono nell'evento della tastiera", () => {
  const evento = (key: string, altro: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...altro });
  assert.equal(tastiCombaciano("Ctrl+Shift+R", evento("R", { ctrlKey: true, shiftKey: true })), true);
  assert.equal(tastiCombaciano("Ctrl+Shift+R", evento("r", { metaKey: true, shiftKey: true })), true);
  assert.equal(tastiCombaciano("Ctrl+Shift+R", evento("r", { ctrlKey: true })), false);
  assert.equal(tastiCombaciano("Alt+F2", evento("F2", { altKey: true })), true);
});

test("la libreria del ponte va in cima alla pagina, dopo il doctype; le estensioni di prima hanno i campi nuovi", () => {
  const con = conLaLibreria(HTML);
  assert.ok(con.startsWith("<!doctype html><html><head><script>"));
  assert.ok(con.includes(LIBRERIA_DEL_PONTE));
  assert.ok(conLaLibreria("<p>solo</p>").startsWith("<script>"));
  assert.ok(conLaLibreria("<!DOCTYPE html><p>x</p>").startsWith("<!DOCTYPE html><script>"));
  const vecchia = conICampiNuovi({ pagine: [{ id: "p", titolo: "P", dove: "menu" as const }] });
  assert.deepEqual(vecchia.pagine[0]?.posti, [{ posto: "menu", ambito: "ovunque", client: "tutti" }]);
  assert.deepEqual([vecchia.api, vecchia.comandi, vecchia.parti], [[], [], []]);
});
