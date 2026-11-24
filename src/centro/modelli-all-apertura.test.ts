/**
 * I modelli all'apertura di una conversazione di un altro ambiente: il centro chiede al nodo di
 * preparare la conversazione che il proprietario sta guardando, anche se il nodo la sa già aperta,
 * e la prepara quando il nodo si collega dopo che la pagina era già aperta (dopo un riavvio di
 * Shinka). Così il motore parte e dice modelli, comandi e contesto prima del primo messaggio.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { allestisci, avviaNodoAccettato, finche, ID_NODO } from "../prove/banco.ts";

test("la conversazione di un altro ambiente aperta in una pagina si prepara, anche quando il nodo arriva dopo", { timeout: 30_000 }, async (t) => {
  const banco = await allestisci(t);
  const nodo = await avviaNodoAccettato(t, banco);
  const progetto = await banco.lavori.crea("Videogioco", ID_NODO, "Un platformer.");
  await finche(() => nodo.conversazioni.length === 1, "il centro apre la conversazione sul nodo");
  const prima = nodo.conversazioni[0]!;
  prima.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 1 });

  // Il proprietario apre il progetto: il nodo la sa già aperta, ma il motore va preparato lo stesso.
  const canale = banco.lavori.canale(progetto.id);
  assert.ok(canale !== undefined);
  const smetti = canale.iscrivi(() => {});
  t.after(smetti);
  banco.lavori.prepara(progetto.id);
  await finche(() => prima.preparazioni === 1, "il nodo prepara la conversazione già aperta");

  // Il collegamento cade, come quando Shinka si riavvia; la pagina resta aperta e, finché il nodo non c'è,
  // prepararla non fa nulla.
  nodo.collegamento.ferma();
  await finche(() => !banco.ambienti.attivo(ID_NODO), "il centro vede l'ambiente spento");
  banco.lavori.prepara(progetto.id);

  // Il nodo torna: la conversazione che la pagina guarda è preparata di nuovo, senza messaggi.
  nodo.collegamento.avvia();
  await finche(() => prima.preparazioni === 2, "il nodo, tornato, prepara la conversazione guardata");
  assert.equal(nodo.conversazioni.length, 1);
  assert.equal(prima.inviati.length, 1, "solo il brief: nessun messaggio in più");

  // Una conversazione che nessuna pagina guarda non si prepara al ritorno del nodo.
  smetti();
  nodo.collegamento.ferma();
  await finche(() => !banco.ambienti.attivo(ID_NODO), "il centro vede di nuovo l'ambiente spento");
  nodo.collegamento.avvia();
  await finche(() => banco.ambienti.attivo(ID_NODO), "il nodo torna");
  await new Promise((fatto) => setTimeout(fatto, 200));
  assert.equal(prima.preparazioni, 2);
});
