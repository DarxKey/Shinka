import assert from "node:assert/strict";
import { test } from "node:test";
import type { Domanda } from "../../src/protocollo/eventi.ts";
import { risposteComplete, rispostaDi, SCELTA_VUOTA, scegli, scegliAltro } from "./domande-scheda.ts";

const UNA: Domanda = {
  domanda: "Quale database?",
  intestazione: "Database",
  opzioni: [{ etichetta: "Postgres" }, { etichetta: "SQLite" }],
  piuScelte: false,
};
const PIU: Domanda = {
  domanda: "Che cosa serve?",
  intestazione: "Funzioni",
  opzioni: [{ etichetta: "Accesso" }, { etichetta: "Ricerca" }, { etichetta: "Esportazione" }],
  piuScelte: true,
};

test("con una sola scelta l'ultima tocca vince, e Altro prende il posto delle risposte proposte", () => {
  let scelta = scegli(UNA, SCELTA_VUOTA, "Postgres");
  scelta = scegli(UNA, scelta, "SQLite");
  assert.equal(rispostaDi(UNA, scelta), "SQLite");
  scelta = scegliAltro(UNA, scelta);
  // Altro senza testo non è ancora una risposta.
  assert.equal(rispostaDi(UNA, scelta), undefined);
  assert.equal(rispostaDi(UNA, { ...scelta, testoAltro: "  MariaDB  " }), "MariaDB");
  assert.equal(rispostaDi(UNA, scegli(UNA, { ...scelta, testoAltro: "MariaDB" }, "Postgres")), "Postgres");
});

test("con più scelte si aggiungono e si tolgono, nell'ordine proposto, e Altro si somma", () => {
  let scelta = scegli(PIU, SCELTA_VUOTA, "Esportazione");
  scelta = scegli(PIU, scelta, "Accesso");
  scelta = scegli(PIU, scelta, "Ricerca");
  scelta = scegli(PIU, scelta, "Ricerca");
  assert.equal(rispostaDi(PIU, scelta), "Accesso, Esportazione");
  scelta = { ...scegliAltro(PIU, scelta), testoAltro: "Notifiche" };
  assert.equal(rispostaDi(PIU, scelta), "Accesso, Esportazione, Notifiche");
  // Tolto Altro, il suo testo non conta più.
  assert.equal(rispostaDi(PIU, scegliAltro(PIU, scelta)), "Accesso, Esportazione");
  assert.equal(rispostaDi(PIU, SCELTA_VUOTA), undefined);
});

test("le risposte partono solo quando ogni domanda ne ha una", () => {
  assert.equal(risposteComplete([UNA, PIU], [scegli(UNA, SCELTA_VUOTA, "SQLite")]), undefined);
  assert.deepEqual(risposteComplete([UNA, PIU], [scegli(UNA, SCELTA_VUOTA, "SQLite"), scegli(PIU, SCELTA_VUOTA, "Ricerca")]), ["SQLite", "Ricerca"]);
});
