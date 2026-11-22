import assert from "node:assert/strict";
import { test } from "node:test";
import type { EventoConversazione } from "../protocollo/eventi.ts";
import { DomandeInSospeso, domandeDa, esitoDelleDomande } from "./domande.ts";

export const DOMANDE_DELL_HARNESS = {
  questions: [
    {
      question: "Quale database usiamo?",
      header: "Database",
      options: [
        { label: "Postgres", description: "Il più completo." },
        { label: "SQLite", description: "" },
      ],
      multiSelect: false,
    },
    {
      question: "Che cosa serve?",
      header: "Funzioni",
      options: [{ label: "Accesso" }, { label: "Ricerca" }, { label: "Esportazione" }],
      multiSelect: true,
    },
  ],
};

test("le domande dell'harness diventano quelle di Shinka, e un ingresso diverso non passa", () => {
  assert.deepEqual(domandeDa(DOMANDE_DELL_HARNESS), [
    {
      domanda: "Quale database usiamo?",
      intestazione: "Database",
      opzioni: [{ etichetta: "Postgres", descrizione: "Il più completo." }, { etichetta: "SQLite" }],
      piuScelte: false,
    },
    {
      domanda: "Che cosa serve?",
      intestazione: "Funzioni",
      opzioni: [{ etichetta: "Accesso" }, { etichetta: "Ricerca" }, { etichetta: "Esportazione" }],
      piuScelte: true,
    },
  ]);
  assert.equal(domandeDa(undefined), undefined);
  assert.equal(domandeDa({ questions: [] }), undefined);
  assert.equal(domandeDa({ questions: [{ header: "x" }] }), undefined);
});

test("all'harness arrivano le risposte nell'ingresso, oppure un no che dice a Claude come andare avanti", () => {
  const consentite = esitoDelleDomande(DOMANDE_DELL_HARNESS, { esito: "risposte", risposte: ["SQLite", "Accesso, Ricerca"] });
  assert.equal(consentite.hookSpecificOutput.permissionDecision, "allow");
  assert.deepEqual(consentite.hookSpecificOutput.updatedInput, {
    ...DOMANDE_DELL_HARNESS,
    answers: { "Quale database usiamo?": "SQLite", "Che cosa serve?": "Accesso, Ricerca" },
  });

  const inChat = esitoDelleDomande(DOMANDE_DELL_HARNESS, { esito: "in-chat", testo: "Fai tu, basta che sia veloce." });
  assert.equal(inChat.hookSpecificOutput.permissionDecision, "allow");
  const risposte = Object.values((inChat.hookSpecificOutput as { updatedInput: { answers: Record<string, string> } }).updatedInput.answers);
  assert.equal(risposte.length, 2);
  for (const risposta of risposte) assert.match(risposta, /con un messaggio: «Fai tu, basta che sia veloce\.»/);
  for (const risposta of risposte) assert.match(risposta, /numeri e lettere \(per esempio 1a, 2b\)/);
  const una = { questions: [DOMANDE_DELL_HARNESS.questions[0]] };
  const aUna = (esitoDelleDomande(una, { esito: "in-chat", testo: "b" }).hookSpecificOutput as { updatedInput: { answers: Record<string, string> } }).updatedInput;
  assert.deepEqual(Object.keys(aUna.answers), ["Quale database usiamo?"]);
  assert.match(aUna.answers["Quale database usiamo?"] ?? "", /^Il proprietario ha risposto con un messaggio: «b»\./);

  const saltate = esitoDelleDomande(DOMANDE_DELL_HARNESS, { esito: "saltate" });
  assert.equal(saltate.hookSpecificOutput.permissionDecision, "deny");
  assert.match(saltate.hookSpecificOutput.permissionDecisionReason, /preferito non rispondere/);
  assert.equal(esitoDelleDomande(DOMANDE_DELL_HARNESS, { esito: "annullate" }).hookSpecificOutput.permissionDecision, "deny");
});

const DOMANDE: Parameters<DomandeInSospeso["poni"]>[0] = domandeDa(DOMANDE_DELL_HARNESS) ?? [];

test("le domande si chiudono con le risposte della scheda, e una seconda risposta non conta", async () => {
  const eventi: EventoConversazione[] = [];
  const sospese = new DomandeInSospeso((evento) => eventi.push(evento));
  const raccolte = sospese.poni(DOMANDE, "d-1", new AbortController().signal);
  assert.equal(sospese.inAttesa, true);
  assert.deepEqual(eventi, [{ tipo: "domande-poste", idDomande: "d-1", domande: DOMANDE }]);
  assert.equal(sospese.rispondi("altre", { tipo: "saltate" }), false);
  assert.equal(sospese.rispondi("d-1", { tipo: "risposte", risposte: ["SQLite", "Accesso"] }), true);
  assert.deepEqual(await raccolte, { esito: "risposte", risposte: ["SQLite", "Accesso"] });
  assert.deepEqual(eventi.at(-1), { tipo: "domande-chiuse", idDomande: "d-1", esito: "risposte", risposte: ["SQLite", "Accesso"] });
  assert.equal(sospese.rispondi("d-1", { tipo: "saltate" }), false);
  assert.equal(sospese.inAttesa, false);
  assert.equal(eventi.length, 2);
});

test("le domande si chiudono con un messaggio in chat, saltandole, o quando l'harness smette di aspettare", async () => {
  const eventi: EventoConversazione[] = [];
  const sospese = new DomandeInSospeso((evento) => eventi.push(evento));

  const inChat = sospese.poni(DOMANDE, "d-1", new AbortController().signal);
  sospese.rispondiInChat("Fai tu.");
  assert.deepEqual(await inChat, { esito: "in-chat", testo: "Fai tu." });
  assert.deepEqual(eventi.at(-1), { tipo: "domande-chiuse", idDomande: "d-1", esito: "in-chat" });

  const saltate = sospese.poni(DOMANDE, "d-2", new AbortController().signal);
  sospese.rispondi("d-2", { tipo: "saltate" });
  assert.deepEqual(await saltate, { esito: "saltate" });

  const interruzione = new AbortController();
  const interrotte = sospese.poni(DOMANDE, "d-3", interruzione.signal);
  interruzione.abort();
  assert.deepEqual(await interrotte, { esito: "annullate" });
  assert.deepEqual(eventi.at(-1), { tipo: "domande-chiuse", idDomande: "d-3", esito: "annullate" });

  const giaAnnullato = AbortSignal.abort();
  assert.deepEqual(await sospese.poni(DOMANDE, "d-4", giaAnnullato), { esito: "annullate" });

  const lasciate = sospese.poni(DOMANDE, "d-5", new AbortController().signal);
  sospese.annullaTutte();
  assert.deepEqual(await lasciate, { esito: "annullate" });
  assert.equal(sospese.inAttesa, false);
});
