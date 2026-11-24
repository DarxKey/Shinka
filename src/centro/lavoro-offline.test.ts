/**
 * Il lavoro offline sui progetti di un ambiente (ADR 0056), da capo a fondo: il centro dice al nodo
 * i suoi progetti e la memoria; senza centro il nodo riprende un progetto e ne fa nascere uno; al
 * ritorno consegna tutto, e il centro lo mette negli archivi dei progetti una volta sola.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { ANNOTATO_OFFLINE, SENZA_CENTRO } from "../protocollo/offline.ts";
import { allestisci, avviaNodoAccettato, finche, ID_NODO } from "../prove/banco.ts";

test("offline il nodo riprende i suoi progetti e ne fa nascere; al ritorno il centro riceve tutto, una volta sola", { timeout: 30_000 }, async (t) => {
  const banco = await allestisci(t);
  const cartellaOffline = join(banco.cartella, "offline-del-nodo");
  const nodo = await avviaNodoAccettato(t, banco, { offline: cartellaOffline });
  const offline = nodo.offline;
  assert.ok(offline !== undefined);

  // Un progetto nell'ambiente del nodo: il nodo lo riceve, con la memoria.
  await banco.memoria.annota("Preferisce le risposte brevi.");
  const progetto = await banco.lavori.crea("Videogioco", ID_NODO, "Un platformer.");
  await finche(() => offline.elenco().some((uno) => uno.id === progetto.id), "il nodo conosce il progetto");
  await finche(() => nodo.conversazioni.length === 1, "il centro apre la conversazione sul nodo");
  // La conversazione aperta dal centro riprende da una sessione: il nodo la ricorda anche per sé.
  nodo.conversazioni[0]?.configurazione?.alIdSessione("sessione-del-centro");
  nodo.conversazioni[0]?.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 1 });

  // Il centro non si raggiunge più.
  nodo.collegamento.ferma();
  offline.collegato(false);
  await finche(() => !banco.ambienti.attivo(ID_NODO), "il centro vede l'ambiente spento");

  // Offline: un messaggio al progetto. La conversazione riparte dalla sessione, con la memoria prima.
  await offline.invia(progetto.id, "Aggiungi il salto doppio.");
  const ripresa = nodo.conversazioni[1];
  assert.ok(ripresa !== undefined);
  assert.equal(ripresa.configurazione?.idSessione, "sessione-del-centro");
  assert.match(ripresa.annotazioni[0] ?? "", /Preferisce le risposte brevi/);
  assert.deepEqual(ripresa.inviati, ["Aggiungi il salto doppio."]);
  ripresa.emetti({ tipo: "testo-concluso", idTesto: "t1", testo: "Fatto: il salto doppio funziona." });
  ripresa.configurazione?.alIdSessione("sessione-offline");
  // Gli strumenti: la memoria si annota, il resto dice che il centro manca.
  const chiama = offline.chiama(progetto.id);
  assert.deepEqual(await chiama("ricorda", { testo: "Il gioco si chiama Salto." }), { testo: ANNOTATO_OFFLINE });
  assert.deepEqual(await chiama("elenca_credenziali", {}), { testo: SENZA_CENTRO, errore: true });
  assert.equal(offline.occupato(progetto.id), true);
  ripresa.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 1 });
  assert.equal(offline.occupato(progetto.id), false);

  // Offline nasce anche un progetto nuovo, che parte con il suo brief.
  const nato = await offline.creaProgetto("Appunti", "Raccogli gli appunti del corso.");
  assert.equal(nato.nuovo, true);
  assert.ok(existsSync(nato.cartella));
  const delNato = nodo.conversazioni[2];
  assert.deepEqual(delNato?.inviati, ["Raccogli gli appunti del corso."]);
  delNato?.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 1 });
  assert.deepEqual(new Set(offline.daConsegnare()), new Set([progetto.id, nato.id]));

  // Il centro torna: il nodo consegna, e il centro lo mette negli archivi.
  nodo.collegamento.avvia();
  await finche(() => offline.daConsegnare().length === 0, "il nodo consegna tutto");
  const storia = banco.lavori.canale(progetto.id)?.archiviati.map(({ evento }) => evento) ?? [];
  const nota = storia.findIndex((evento) => evento.tipo === "nota" && evento.testo.includes("offline su PC Windows"));
  assert.ok(nota >= 0, "la storia dice da dove riprende il lavoro offline");
  assert.ok(storia.slice(nota).some((evento) => evento.tipo === "messaggio-proprietario" && evento.testo === "Aggiungi il salto doppio."));
  assert.ok(storia.slice(nota).some((evento) => evento.tipo === "testo-concluso" && evento.testo === "Fatto: il salto doppio funziona."));
  assert.equal(banco.progetti.idSessione(progetto.id), "sessione-offline");
  // Il progetto nato offline ora è del centro, con il suo identificativo e la sua cartella.
  const registrato = banco.progetti.trova(nato.id);
  assert.equal(registrato?.nome, "Appunti");
  assert.equal(registrato?.idAmbiente, ID_NODO);
  assert.equal(registrato?.cartella, nato.cartella);
  assert.ok(banco.lavori.canale(nato.id)?.archiviati.some(({ evento }) => evento.tipo === "messaggio-proprietario" && evento.testo === "Raccogli gli appunti del corso."));
  // La voce annotata offline è arrivata in memoria.
  await finche(() => banco.memoria.voci().some((voce) => voce.testo === "Il gioco si chiama Salto."), "la memoria riceve la voce annotata");
  assert.equal(banco.lavori.inConsegna(progetto.id), false);
  assert.equal(banco.lavori.stato().progetti.find((uno) => uno.id === progetto.id)?.offlineInArrivo, undefined);

  // Lo stesso pezzo, consegnato di nuovo, non entra due volte.
  const quanti = banco.lavori.canale(progetto.id)?.archiviati.length;
  const fino = await banco.lavori.riceviOffline(ID_NODO, {
    tipo: "offline-eventi",
    idProgetto: progetto.id,
    versione: "versione-di-prova",
    eventi: [{ n: 1, quando: new Date().toISOString(), evento: { tipo: "nota", testo: "uno" } }],
    ultimo: 1,
    ambiente: "PC Windows",
  });
  assert.equal(fino, 1);
  const ancora = await banco.lavori.riceviOffline(ID_NODO, {
    tipo: "offline-eventi",
    idProgetto: progetto.id,
    versione: "versione-di-prova",
    eventi: [{ n: 1, quando: new Date().toISOString(), evento: { tipo: "nota", testo: "uno" } }],
    ultimo: 1,
    ambiente: "PC Windows",
  });
  assert.equal(ancora, 1);
  // Una nota per il lavoro offline, e l'evento: una volta sola.
  assert.equal(banco.lavori.canale(progetto.id)?.archiviati.length, (quanti ?? 0) + 2);
});

test("finché il lavoro offline di un progetto non è arrivato, il centro non gli scrive", { timeout: 20_000 }, async (t) => {
  const banco = await allestisci(t);
  const nodo = await avviaNodoAccettato(t, banco);
  const progetto = await banco.lavori.crea("Videogioco", ID_NODO, "Un platformer.");
  await finche(() => nodo.conversazioni.length === 1, "il centro apre la conversazione sul nodo");
  banco.lavori.inConsegnaDa(ID_NODO, [progetto.id]);
  assert.equal(banco.lavori.inConsegna(progetto.id), true);
  assert.equal(banco.lavori.stato().progetti.find((uno) => uno.id === progetto.id)?.offlineInArrivo, true);
  assert.throws(() => banco.lavori.invia(progetto.id, "Ciao"), /lavoro fatto offline/);
  // Al prossimo collegamento senza lavoro da consegnare, il progetto torna libero.
  banco.lavori.inConsegnaDa(ID_NODO, []);
  banco.lavori.invia(progetto.id, "Ciao");
  await finche(() => nodo.conversazioni[0]?.inviati.includes("Ciao") === true, "il messaggio arriva");
});
