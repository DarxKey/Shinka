import assert from "node:assert/strict";
import { test } from "node:test";
import type { EventoConversazione } from "../protocollo/eventi.ts";
import { esportaInMarkdown, nomeDellEsportazione } from "./esportazione.ts";

const storia = (eventi: EventoConversazione[]) => eventi.map((evento, n) => ({ n: n + 1, quando: "2026-11-17T10:00:00.000Z", evento }));

test("la conversazione esportata ha i messaggi, le risposte e le azioni in una riga, senza ciò che una modifica ha tolto", () => {
  const testo = esportaInMarkdown(
    "Blog",
    storia([
      { tipo: "messaggio-proprietario", id: "m1", testo: "Conta le righe", file: ["dati.csv"] },
      { tipo: "azione-iniziata", idAzione: "a1", strumento: "Bash", ingresso: { command: "wc -l `ls`" } },
      { tipo: "testo-concluso", idTesto: "t1", testo: "Sono **42** righe." },
      { tipo: "messaggio-proprietario", id: "m2", testo: "E le parole?" },
      { tipo: "testo-concluso", idTesto: "t2", testo: "Non lo so." },
      { tipo: "riavvolto", idMessaggio: "m2" },
      { tipo: "messaggio-proprietario", id: "m3", testo: "E i caratteri?" },
    ]),
    new Date("2026-11-17T12:00:00Z"),
  );
  assert.equal(
    testo,
    [
      "# Blog",
      "_Esportata da Shinka il 2026-11-17 12:00 (UTC)._",
      "### Tu · 2026-11-17 10:00\n\nConta le righe\n\n_Allegati: dati.csv_",
      "> Comando: `wc -l 'ls'`",
      "### Claude\n\nSono **42** righe.",
      "### Tu · 2026-11-17 10:00\n\nE i caratteri?",
    ].join("\n\n") + "\n",
  );
  assert.equal(nomeDellEsportazione("Viaggio in Giappone: città", new Date("2026-11-17T12:00:00Z")), "viaggio-in-giappone-citta-2026-11-17.md");
});
