/**
 * Quando il proprietario ha scritto l'ultima volta a un progetto: l'elenco dei progetti lo dice,
 * da qualunque sua chat, e lo ricava dall'archivio dopo un riavvio. La barra laterale ordina così.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { allestisci, finche } from "../prove/banco.ts";

test("l'elenco dei progetti dice quando il proprietario ha scritto l'ultima volta, anche da una chat parallela e dopo un riavvio", { timeout: 30_000 }, async (t) => {
  const banco = await allestisci(t);
  const progetto = await banco.lavori.crea("Blog", "centro", "Un blog.");
  const voce = () => banco.lavori.stato().progetti.find((uno) => uno.id === progetto.id);
  await finche(() => banco.conversazioniLocali.length === 1, "la conversazione del progetto parte");
  // Il brief è il primo messaggio: da lì il progetto ha un ultimo messaggio.
  await finche(() => voce()?.ultimoMessaggioIl !== undefined, "il primo messaggio conta");
  const primo = voce()?.ultimoMessaggioIl ?? "";

  // Un messaggio in una chat parallela sposta l'ultimo messaggio del progetto, e avvisa chi guarda.
  const chat = await banco.lavori.apriChat(progetto.id);
  assert.ok("idConversazione" in chat);
  let avvisi = 0;
  const smetti = banco.lavori.iscrivi(() => avvisi++);
  const prima = avvisi;
  await new Promise((fatto) => setTimeout(fatto, 5));
  banco.lavori.invia(chat.idConversazione, "Una domanda a parte.");
  await finche(() => (voce()?.ultimoMessaggioIl ?? "") > primo, "l'ultimo messaggio si sposta");
  assert.ok(avvisi > prima);
  smetti();
  const ultimo = voce()?.ultimoMessaggioIl;

  // Dopo un riavvio lo stesso, ricavato dall'archivio.
  const dopo = await allestisci(t, { cartella: banco.cartella });
  assert.equal(dopo.lavori.stato().progetti.find((uno) => uno.id === progetto.id)?.ultimoMessaggioIl, ultimo);
});
