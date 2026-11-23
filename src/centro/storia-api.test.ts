/**
 * La storia delle conversazioni da un punto in poi, per chi ne tiene una copia (ADR 0046): le rotte
 * di sola lettura, il flusso che riprende da un punto, e gli indici degli archivi nel quadro.
 */

import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test, type TestContext } from "node:test";
import type { PezzoDiStoria } from "../protocollo/eventi.ts";
import { allestisci, finche, type Banco } from "../prove/banco.ts";
import { COOKIE_SESSIONE } from "./centro.ts";

async function leggi(banco: Banco, url: string): Promise<{ stato: number; dati: PezzoDiStoria }> {
  const risposta = await banco.centro.inject({ method: "GET", url, cookies: { [COOKIE_SESSIONE]: await banco.entra() } });
  return { stato: risposta.statusCode, dati: risposta.json() };
}

/** Apre un flusso del centro e restituisce come aspettare che vi compaia un testo. */
async function apriFlusso(t: TestContext, banco: Banco, percorso: string): Promise<{ finche(atteso: string): Promise<void>; ricevuto(): string }> {
  if (!banco.centro.server.listening) await banco.centro.listen({ host: "127.0.0.1", port: 0 });
  const { port } = banco.centro.server.address() as AddressInfo;
  const controllo = new AbortController();
  t.after(() => controllo.abort());
  const risposta = await fetch(`http://127.0.0.1:${port}${percorso}`, {
    headers: { cookie: `${COOKIE_SESSIONE}=${await banco.entra()}` },
    signal: controllo.signal,
  });
  assert.equal(risposta.status, 200);
  assert.ok(risposta.body);
  const lettore = risposta.body.pipeThrough(new TextDecoderStream()).getReader();
  let ricevuto = "";
  return {
    ricevuto: () => ricevuto,
    finche: async (atteso) => {
      while (!ricevuto.includes(atteso)) {
        const { value, done } = await lettore.read();
        if (done) throw new Error(`il flusso si è chiuso prima di "${atteso}"`);
        ricevuto += value;
      }
    },
  };
}

/** I numeri degli eventi archiviati arrivati in un flusso prima della fine della storia. */
function numeriPrimaDellaStoria(ricevuto: string): number[] {
  const storia = ricevuto.slice(0, ricevuto.indexOf("event: storia"));
  return [...storia.matchAll(/"n":(\d+)/g)].map((trovato) => Number(trovato[1])).filter((n) => n > 0);
}

async function progettoConEventi(banco: Banco, quanti: number) {
  const progetto = await banco.lavori.crea("Videogioco", "centro", "Un gioco di piattaforme.");
  await finche(() => banco.conversazioniLocali.length === 1, "il progetto apre la sua conversazione");
  const conversazione = banco.conversazioniLocali[0];
  assert.ok(conversazione !== undefined);
  conversazione.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 1 });
  for (let i = 1; i <= quanti; i++) {
    conversazione.emetti({ tipo: "testo-iniziato", idTesto: `t${i}` });
    conversazione.emetti({ tipo: "testo-concluso", idTesto: `t${i}`, testo: `risposta ${i}` });
  }
  return { progetto, conversazione };
}

test("la storia di un progetto da un punto: solo gli eventi dopo, in ordine, a pezzi, senza preparare il motore", async (t) => {
  const banco = await allestisci(t);
  const { progetto, conversazione } = await progettoConEventi(banco, 3);
  const preparazioni = conversazione.preparazioni;

  const tutta = await leggi(banco, `/api/progetti/${progetto.id}/storia`);
  assert.equal(tutta.stato, 200);
  const { ultimo, versione } = tutta.dati;
  assert.ok(ultimo >= 7);
  assert.deepEqual(tutta.dati.eventi.map((e) => e.n), Array.from({ length: ultimo }, (_, i) => i + 1));
  assert.equal(tutta.dati.altri, false);
  assert.equal(tutta.dati.daCapo, false);
  // Solo eventi archiviati: niente frammenti, niente eventi ricordati.
  assert.ok(tutta.dati.eventi.every((e) => e.n > 0 && e.evento.tipo !== "impostazioni"));

  const dopo = await leggi(banco, `/api/progetti/${progetto.id}/storia?dopo=${ultimo - 2}&versione=${versione}`);
  assert.deepEqual(dopo.dati.eventi.map((e) => e.n), [ultimo - 1, ultimo]);
  const pezzo = await leggi(banco, `/api/progetti/${progetto.id}/storia?dopo=1&limite=2`);
  assert.deepEqual([pezzo.dati.eventi.map((e) => e.n), pezzo.dati.altri], [[2, 3], true]);
  const altra = await leggi(banco, `/api/progetti/${progetto.id}/storia?dopo=3&versione=non-questa`);
  assert.deepEqual([altra.dati.daCapo, altra.dati.eventi[0]?.n, altra.dati.versione], [true, 1, versione]);

  // Nessun effetto: il motore non viene preparato, e nessuna pagina segue la conversazione.
  assert.equal(conversazione.preparazioni, preparazioni);
  assert.equal(banco.lavori.canale(progetto.id)?.seguito, false);

  // Il quadro dice lo stesso indice.
  const voce = banco.lavori.stato().progetti.find((p) => p.id === progetto.id);
  assert.deepEqual([voce?.ultimo, voce?.versione], [ultimo, versione]);

  assert.equal((await leggi(banco, "/api/progetti/mai-esistito/storia")).stato, 404);
  const senzaSessione = await banco.centro.inject({ method: "GET", url: `/api/progetti/${progetto.id}/storia` });
  assert.equal(senzaSessione.statusCode, 401);
});

test("il flusso di un progetto riprende da un punto; con un'altra versione azzera e rimanda tutto; senza parametri è come prima", async (t) => {
  const banco = await allestisci(t);
  const { progetto, conversazione } = await progettoConEventi(banco, 2);
  const { ultimo, versione } = (await leggi(banco, `/api/progetti/${progetto.id}/storia`)).dati;

  const ripreso = await apriFlusso(t, banco, `/api/progetti/${progetto.id}/eventi?dopo=${ultimo}&versione=${versione}`);
  await ripreso.finche("event: storia");
  assert.deepEqual(numeriPrimaDellaStoria(ripreso.ricevuto()), []);
  assert.equal(ripreso.ricevuto().includes("event: azzera"), false);
  // La fine della storia dice fin dove arriva l'archivio.
  assert.ok(ripreso.ricevuto().includes(`event: storia\ndata: {"ultimo":${ultimo},"versione":"${versione}"}`));
  // Gli eventi ricordati arrivano comunque, e poi quelli nuovi.
  assert.match(ripreso.ricevuto(), /"tipo":"impostazioni"/);
  conversazione.emetti({ tipo: "testo-iniziato", idTesto: "nuovo" });
  await ripreso.finche(`"n":${ultimo + 1}`);

  const daUnPunto = await apriFlusso(t, banco, `/api/progetti/${progetto.id}/eventi?dopo=${ultimo - 1}&versione=${versione}`);
  await daUnPunto.finche("event: storia");
  assert.deepEqual(numeriPrimaDellaStoria(daUnPunto.ricevuto()), [ultimo, ultimo + 1]);

  const vecchia = await apriFlusso(t, banco, `/api/progetti/${progetto.id}/eventi?dopo=${ultimo}&versione=vecchia`);
  await vecchia.finche("event: storia");
  assert.ok(vecchia.ricevuto().startsWith("event: azzera") || vecchia.ricevuto().indexOf("event: azzera") < vecchia.ricevuto().indexOf('"n":1,'));
  assert.equal(numeriPrimaDellaStoria(vecchia.ricevuto())[0], 1);

  const sito = await apriFlusso(t, banco, `/api/progetti/${progetto.id}/eventi`);
  await sito.finche("event: storia");
  assert.equal(sito.ricevuto().includes("event: azzera"), false);
  assert.equal(numeriPrimaDellaStoria(sito.ricevuto())[0], 1);
});

test("argomenti: la storia dell'aperto e degli archiviati, la versione che cambia con il taglio, e il quadro con gli indici", async (t) => {
  const banco = await allestisci(t);
  const primo = banco.casa.idArgomentoAperto;
  const concludi = (): void => banco.home.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 1 });
  banco.casa.invia("Scrivimi uno script che rinomina le foto.");
  concludi();
  banco.casa.invia("Aggiungi la data.");
  concludi();

  const aperto = await leggi(banco, `/api/argomenti/${primo}/storia`);
  assert.equal(aperto.stato, 200);
  const prima = aperto.dati;
  assert.ok(prima.ultimo > 0);
  assert.deepEqual(banco.casa.indiceDi(primo), { ultimo: prima.ultimo, versione: prima.versione });

  const quadro = await apriFlusso(t, banco, "/api/quadro/eventi");
  await quadro.finche(`"aperto":{"ultimo":${prima.ultimo},"versione":"${prima.versione}"}`);
  await quadro.finche(`"argomento":{"id":"${primo}","ultimo":${prima.ultimo},"versione":"${prima.versione}"}`);

  // Il messaggio che fa cambiare argomento passa a quello nuovo: dall'archivio di questo viene tagliato.
  banco.casa.invia("Che tempo fa domani?");
  banco.casa.richiediCambio({ titolo: "Rinominare le foto", riassunto: "Script sul PC." });
  concludi();
  await finche(() => banco.casa.idArgomentoAperto !== primo, "si apre l'argomento nuovo");
  await finche(() => !banco.casa.staCambiandoArgomento, "il passaggio finisce");

  const archiviato = (await leggi(banco, `/api/argomenti/${primo}/storia`)).dati;
  assert.notEqual(archiviato.versione, prima.versione);
  // Il quadro lo rimanda, a passaggio finito, con l'indice giusto dell'archiviato.
  await quadro.finche(`"id":"${primo}","titolo":"Rinominare le foto"`);
  await quadro.finche(`"ultimo":${archiviato.ultimo},"versione":"${archiviato.versione}"`);
  const nuovo = banco.casa.idArgomentoAperto;
  const indiceNuovo = banco.casa.indiceDi(nuovo);
  assert.ok(indiceNuovo !== undefined);
  await quadro.finche(`"argomento":{"id":"${nuovo}","ultimo":${indiceNuovo.ultimo}`);

  // Rileggere da un punto un argomento archiviato non avvia nulla.
  const pezzo = (await leggi(banco, `/api/argomenti/${primo}/storia?dopo=1&versione=${archiviato.versione}`)).dati;
  assert.equal(pezzo.eventi[0]?.n, 2);
  assert.equal((await leggi(banco, "/api/argomenti/mai-esistito/storia")).stato, 404);
});

test("il flusso della Home riprende da un punto dell'argomento aperto", async (t) => {
  const banco = await allestisci(t);
  const id = banco.casa.idArgomentoAperto;
  banco.casa.invia("Ciao");
  banco.home.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 1 });
  const { ultimo, versione } = (await leggi(banco, `/api/argomenti/${id}/storia`)).dati;

  const ripreso = await apriFlusso(t, banco, `/api/home/eventi?dopo=${ultimo}&versione=${versione}`);
  await ripreso.finche("event: storia");
  assert.deepEqual(numeriPrimaDellaStoria(ripreso.ricevuto()), []);
  assert.equal(ripreso.ricevuto().includes("event: azzera"), false);

  const altra = await apriFlusso(t, banco, `/api/home/eventi?dopo=${ultimo}&versione=altra`);
  await altra.finche("event: storia");
  assert.ok(altra.ricevuto().indexOf("event: azzera") >= 0 && altra.ricevuto().indexOf("event: azzera") < altra.ricevuto().indexOf('"n":1,'));
});
