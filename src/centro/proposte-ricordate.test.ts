/**
 * Le proposte che aspettano il proprietario sopravvivono a un riavvio del centro: la scheda resta
 * con i suoi pulsanti, e confermare o annullare funziona come prima. Il centro riavviato è un
 * secondo banco sugli stessi dati.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { allestisci } from "../prove/banco.ts";

test("dopo un riavvio le proposte in attesa ci sono ancora: si confermano e si annullano, e la scheda non diventa annullata da sola", async (t) => {
  const prima = await allestisci(t);
  const daConfermare = prima.proposte.proponi({ nome: "Videogioco", brief: "Un platformer.", idAmbiente: "centro" });
  const daAnnullare = prima.proposte.proponi({ nome: "Sito", brief: "Un sito.", idAmbiente: "centro" });
  const tema = prima.interfaccia.proponi({ nome: "neon", descrizione: "Un accento viola.", tema: ":root { --accento: #c026d3; }", pagine: [], pulsanti: [], api: [], comandi: [], parti: [] }, prima.casa.canale);
  const file = join(prima.cartella, "proposte-in-attesa.json");
  assert.equal((JSON.parse(readFileSync(file, "utf8")) as unknown[]).length, 3);

  // Il centro riparte sugli stessi dati.
  const dopo = await allestisci(t, { cartella: prima.cartella });
  const storia = () => dopo.casa.canale.archiviati.map(({ evento }) => evento);
  assert.ok(storia().some((evento) => evento.tipo === "proposta-progetto" && evento.idProposta === daConfermare));
  assert.ok(!storia().some((evento) => evento.tipo === "proposta-decisa"), "riaprendo l'archivio le proposte non si annullano");

  assert.equal(dopo.proposte.annulla(daAnnullare), true);
  assert.ok(storia().some((evento) => evento.tipo === "proposta-decisa" && evento.idProposta === daAnnullare && evento.esito === "annullata"));
  const nato = await dopo.proposte.conferma(daConfermare, {});
  assert.equal(nato?.nome, "Videogioco");
  assert.ok(storia().some((evento) => evento.tipo === "proposta-decisa" && evento.idProposta === daConfermare && evento.esito === "confermata"));
  assert.equal(await dopo.interfaccia.conferma(tema), true);
  assert.equal(dopo.interfaccia.stato().estensioni[0]?.nome, "neon");

  // Decise tutte, non c'è più nulla da ricordare.
  assert.ok(existsSync(file));
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), []);
});
