import assert from "node:assert/strict";
import { test } from "node:test";
import type { EventoConversazione } from "../../src/protocollo/eventi.ts";
import { inMigliaia, quandoRiparte } from "./descrivi.ts";
import { esitoDi, raggruppa, riassuntoDi, type Azione } from "./gruppi.ts";
import { applica, statoIniziale, type Elemento } from "./stato.ts";

function azione(chiave: string, strumento: string, altro: Partial<Azione> = {}): Azione {
  return { tipo: "azione", chiave, strumento, ingresso: {}, conclusa: true, errore: false, ...altro };
}

const testo: Elemento = { tipo: "testo", chiave: "t1", testo: "Fatto.", concluso: true };

test("le azioni compiute di seguito diventano un gruppo solo, il resto resta com'è", () => {
  const voci = raggruppa([
    { tipo: "proprietario", chiave: "m1", testo: "Sistema il progetto" },
    azione("a1", "Read"),
    azione("a2", "Bash"),
    azione("a3", "Bash"),
    testo,
    azione("a4", "Edit"),
  ]);
  assert.deepEqual(voci.map((v) => [v.tipo, v.chiave]), [
    ["proprietario", "m1"],
    ["gruppo", "gruppo-a1"],
    ["testo", "t1"],
    ["azione", "a4"],
  ]);
  const gruppo = voci[1];
  assert.ok(gruppo?.tipo === "gruppo" && gruppo.azioni.length === 3);
});

test("un'azione che aspetta il proprietario resta in vista, fuori dai gruppi", () => {
  const inAttesa = azione("a3", "Bash", { conclusa: false, permesso: { id: "a3", stato: "in-attesa" } });
  const voci = raggruppa([azione("a1", "Read"), azione("a2", "Read"), inAttesa]);
  assert.deepEqual(voci.map((v) => [v.tipo, v.chiave]), [
    ["gruppo", "gruppo-a1"],
    ["azione", "a3"],
  ]);

  // Decisa, rientra nel gruppo: la chiave del gruppo non cambia, quindi resta aperto se lo era.
  const decisa = { ...inAttesa, conclusa: true, permesso: { id: "a3", stato: "approvato" as const } };
  const dopo = raggruppa([azione("a1", "Read"), azione("a2", "Read"), decisa]);
  assert.deepEqual(dopo.map((v) => [v.tipo, v.chiave]), [["gruppo", "gruppo-a1"]]);
});

test("il riassunto di un gruppo dice quante azioni e di che genere", () => {
  const azioni = [azione("a1", "Read"), azione("a2", "Bash"), azione("a3", "PowerShell"), azione("a4", "Edit")];
  assert.equal(riassuntoDi(azioni), "4 azioni: Lettura, Comando ×2, Modifica");
});

test("l'esito di un gruppo segnala ciò che è ancora in corso e ciò che non è riuscito", () => {
  assert.deepEqual(esitoDi([azione("a1", "Read"), azione("a2", "Bash")]), { classe: "riuscita", testo: "fatte" });
  assert.equal(esitoDi([azione("a1", "Read"), azione("a2", "Bash", { conclusa: false })]).classe, "in-corso");
  assert.deepEqual(
    esitoDi([
      azione("a1", "Bash", { errore: true }),
      azione("a2", "Bash", { errore: true }),
      azione("a3", "Bash", { conclusa: false, permesso: { id: "a3", stato: "negato" } }),
    ]),
    { classe: "fallita", testo: "2 non riuscite, 1 negata" },
  );
});

test("immagini e file allegati arrivano nella conversazione con il messaggio e con l'azione", () => {
  const eventi: EventoConversazione[] = [
    {
      tipo: "messaggio-proprietario",
      id: "m1",
      testo: "Guarda",
      immagini: [{ tipo: "image/png", id: "foto.png" }],
      file: ["appunti.txt"],
    },
    { tipo: "azione-iniziata", idAzione: "a1", strumento: "Read", ingresso: { file_path: "schermo.png" } },
    { tipo: "azione-conclusa", idAzione: "a1", esito: "[immagine]", errore: false, immagini: [{ tipo: "image/png", id: "s.png" }] },
  ];
  const stato = eventi.reduce(applica, statoIniziale);
  const [messaggio, lettura] = stato.elementi;
  assert.ok(messaggio?.tipo === "proprietario");
  assert.deepEqual(messaggio.immagini, [{ tipo: "image/png", id: "foto.png" }]);
  assert.deepEqual(messaggio.file, ["appunti.txt"]);
  assert.ok(lettura?.tipo === "azione");
  assert.deepEqual(lettura.immagini, [{ tipo: "image/png", id: "s.png" }]);
});

test("impostazioni e stato non toccano la conversazione, e la fine di un turno non li perde", () => {
  const eventi: EventoConversazione[] = [
    { tipo: "impostazioni", impostazioni: { modello: "opus", permessi: "automatico" } },
    { tipo: "stato", stato: { modello: "claude-opus-5-5" } },
    { tipo: "turno-iniziato" },
    { tipo: "stato", stato: { contesto: { usati: 46000, massimo: 200000, percento: 23 } } },
    { tipo: "turno-concluso", riuscito: true, durataMs: 5 },
  ];
  const stato = eventi.reduce(applica, statoIniziale);
  assert.deepEqual(stato.elementi, []);
  assert.deepEqual(stato.impostazioni, { modello: "opus", permessi: "automatico" });
  assert.deepEqual(stato.stato, {
    modello: "claude-opus-5-5",
    contesto: { usati: 46000, massimo: 200000, percento: 23 },
  });
});

test("token e scadenze dei limiti si leggono in breve", () => {
  assert.equal(inMigliaia(840), "840");
  assert.equal(inMigliaia(46200), "46k");
  assert.equal(inMigliaia(200000), "200k");
  const ora = Date.parse("2026-11-11T12:00:00Z");
  assert.equal(quandoRiparte("2026-11-11T12:40:00Z", ora), "riparte tra 40 min");
  assert.equal(quandoRiparte("2026-11-11T15:10:00Z", ora), "riparte tra 3 h");
  assert.equal(quandoRiparte("2026-11-15T12:00:00Z", ora), "riparte tra 4 giorni");
  assert.equal(quandoRiparte("2026-11-11T11:00:00Z", ora), "");
  assert.equal(quandoRiparte(undefined, ora), "");
  assert.equal(quandoRiparte("non è una data", ora), "");
});

test("la proposta di un'anteprima resta in vista, fuori dai gruppi, con il suo pulsante", () => {
  const proposta = azione("a3", "mcp__shinka__proponi_anteprima", { ingresso: { porta: 5173 } });
  const voci = raggruppa([azione("a1", "Bash"), azione("a2", "Bash"), proposta, azione("a4", "Read")]);
  assert.deepEqual(voci.map((v) => [v.tipo, v.chiave]), [
    ["gruppo", "gruppo-a1"],
    ["azione", "a3"],
    ["azione", "a4"],
  ]);
});
