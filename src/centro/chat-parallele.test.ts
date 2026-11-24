/**
 * Le chat parallele (ADR 0052): nella Home e in un progetto il proprietario apre altre conversazioni
 * accanto alla principale, che lavorano anche mentre la principale lavora. Nella Home ciascuna è un
 * argomento aperto, archiviato quando la chat si chiude; in un progetto chiusa si cancella.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { LightMyRequestResponse } from "fastify";
import { conversazioneDellaChat, eChatParallela, numeroDellaChat, primoNumeroLibero } from "../protocollo/chat-parallele.ts";
import { progettoDellaConversazione } from "../protocollo/incarichi.ts";
import { allestisci, finche, type Banco } from "../prove/banco.ts";
import { RegistroArgomenti } from "./argomenti.ts";
import { COOKIE_SESSIONE, indirizzoDellaChat, numeroDellaChatNellIndirizzo } from "./centro.ts";

async function chiama(banco: Banco, method: "GET" | "POST" | "DELETE", url: string, payload?: Record<string, unknown>): Promise<LightMyRequestResponse> {
  return banco.centro.inject({ method, url, cookies: { [COOKIE_SESSIONE]: await banco.entra() }, ...(payload === undefined ? {} : { payload }) });
}

test("gli identificativi delle chat parallele portano quello del progetto, e i numeri vanno da 2 a 4", () => {
  assert.equal(conversazioneDellaChat("p-1", 1), "p-1");
  assert.equal(conversazioneDellaChat("p-1", 3), "p-1~chat-3");
  assert.equal(numeroDellaChat("p-1~chat-3"), 3);
  assert.equal(numeroDellaChat("p-1"), 1);
  assert.equal(numeroDellaChat("p-1~chat-9"), 1);
  assert.equal(eChatParallela("p-1~chat-2"), true);
  assert.equal(progettoDellaConversazione("p-1~chat-2"), "p-1");
  assert.equal(primoNumeroLibero([]), 2);
  assert.equal(primoNumeroLibero([2, 4]), 3);
  assert.equal(primoNumeroLibero([2, 3, 4]), undefined);
  // Le rotte della Home: /api/home/chat/N/… diventa /api/home/… con il numero tra i parametri.
  assert.equal(indirizzoDellaChat("/api/home/chat/2/messaggi"), "/api/home/messaggi?chat=2");
  assert.equal(indirizzoDellaChat("/api/home/chat/3/eventi?dopo=4&versione=v"), "/api/home/eventi?dopo=4&versione=v&chat=3");
  assert.equal(indirizzoDellaChat("/api/home/chat/2"), "/api/home/chat/2");
  assert.equal(indirizzoDellaChat("/api/progetti/x/messaggi"), "/api/progetti/x/messaggi");
  assert.equal(numeroDellaChatNellIndirizzo("/api/home/messaggi?chat=2"), 2);
  assert.equal(numeroDellaChatNellIndirizzo("/api/home/messaggi"), undefined);
});

test("il registro degli argomenti tiene gli argomenti aperti nelle chat parallele, e li ricorda", async (t) => {
  const banco = await allestisci(t);
  const file = join(banco.cartella, "argomenti-prova.json");
  const registro = await RegistroArgomenti.apri(file);
  const aperta = await registro.apriChat();
  assert.ok(aperta !== undefined);
  assert.equal(aperta.numero, 2);
  assert.equal(registro.apertoIn(2).id, aperta.argomento.id);
  assert.deepEqual(registro.stato().chat, [{ numero: 2, idAperto: aperta.argomento.id }]);
  assert.equal(registro.archiviati().length, 0);

  // Claude cambia argomento nella chat: la chat passa a quello nuovo, la principale non cambia.
  const principale = registro.aperto.id;
  const nuovo = await registro.passa({ titolo: "Ricette", riassunto: "Due ricette." }, "nuovo", Date.now(), 2);
  assert.equal(registro.apertoIn(2).id, nuovo.id);
  assert.equal(registro.aperto.id, principale);
  assert.deepEqual(registro.archiviati().map((voce) => voce.titolo), ["Ricette"]);
  // Un argomento aperto in un'altra chat non si riprende qui.
  await assert.rejects(registro.passa({ titolo: "X", riassunto: "" }, nuovo.id), /aperto in un'altra chat/);

  // Riaperto il registro, la chat c'è ancora.
  const riletto = await RegistroArgomenti.apri(file);
  assert.equal(riletto.apertoIn(2).id, nuovo.id);
  assert.ok(await riletto.chiudiChat(2, { titolo: "Viaggio", riassunto: "Un viaggio." }));
  assert.equal(riletto.stato().chat, undefined);
  assert.deepEqual(riletto.archiviati().map((voce) => voce.titolo).sort(), ["Ricette", "Viaggio"]);
  assert.equal(await riletto.chiudiChat(2, "da-dimenticare"), false);
});

test("nella Home una chat parallela lavora mentre la principale lavora, e chiusa archivia il suo argomento", async (t) => {
  const banco = await allestisci(t);
  const principale = banco.home;
  banco.casa.invia("Un lavoro lungo.");
  assert.equal(banco.casa.condizione, "al-lavoro");

  const aperta = await chiama(banco, "POST", "/api/home/chat");
  assert.equal(aperta.statusCode, 200, aperta.body);
  assert.equal(aperta.json().numero, 2);
  const chat = banco.casa.chat(2);
  assert.ok(chat !== undefined);
  const conversazione = banco.conversazioniHome.at(-1);
  assert.ok(conversazione !== undefined && conversazione !== principale);
  assert.ok(conversazione.annotazioni.some((nota) => /chat parallela della Home/.test(nota)));
  // Ha un argomento suo, con una cartella sua.
  assert.notEqual(chat.idArgomentoAperto, banco.casa.idArgomentoAperto);
  assert.equal(conversazione.configurazione?.cartella, join(banco.radiceProgetti, "_home", chat.idArgomentoAperto));

  // Il messaggio arriva alla chat, non alla principale, che intanto continua.
  const mandato = await chiama(banco, "POST", "/api/home/chat/2/messaggi", { testo: "Che ore sono?" });
  assert.equal(mandato.statusCode, 202, mandato.body);
  assert.deepEqual(conversazione.inviati, ["Che ore sono?"]);
  assert.deepEqual(principale.inviati, ["Un lavoro lungo."]);
  assert.deepEqual(banco.casa.condizioniDelleChat(), [{ numero: 2, condizione: "al-lavoro" }]);
  conversazione.emetti({ tipo: "testo-concluso", idTesto: "t1", testo: "Le dieci." });
  conversazione.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 1 });
  // Un permesso in attesa nella chat fa aspettare la Home.
  conversazione.emetti({ tipo: "permesso-richiesto", idPermesso: "p1", idAzione: "a1", strumento: "Bash", ingresso: {} });
  assert.equal(banco.casa.condizioneComplessiva, "aspetta-te");
  assert.equal(banco.casa.condizione, "al-lavoro");
  const deciso = await chiama(banco, "POST", "/api/home/chat/2/permessi/p1", { decisione: "approvato" });
  assert.equal(deciso.statusCode, 200, deciso.body);
  conversazione.emetti({ tipo: "permesso-deciso", idPermesso: "p1", decisione: "approvato" });
  assert.equal(banco.argomenti.stato().chat?.[0]?.numero, 2);

  // Una chat che non c'è non risponde.
  assert.equal((await chiama(banco, "POST", "/api/home/chat/3/messaggi", { testo: "?" })).statusCode, 404);

  // Chiusa, Claude scrive titolo e riassunto e l'argomento va tra gli archiviati.
  const idArgomento = chat.idArgomentoAperto;
  const chiusa = await chiama(banco, "DELETE", "/api/home/chat/2");
  assert.equal(chiusa.statusCode, 202, chiusa.body);
  assert.ok(conversazione.istruzioni.some((istruzione) => /chiude questa chat/.test(istruzione)));
  assert.equal(typeof chat.richiediCambio({ titolo: "L'ora", riassunto: "Il proprietario ha chiesto l'ora." }), "string");
  conversazione.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 1 });
  await finche(() => banco.casa.chat(2) === undefined, "la chat si chiude");
  assert.equal(conversazione.chiusa, true);
  assert.equal(principale.chiusa, false);
  assert.deepEqual(banco.casa.archiviati().map((voce) => [voce.id, voce.titolo]), [[idArgomento, "L'ora"]]);
  assert.equal(banco.argomenti.stato().chat, undefined);
  assert.equal(banco.casa.condizioniDelleChat().length, 0);
});

test("una chat parallela vuota della Home si chiude senza lasciare nulla; le chat sono al massimo tre", async (t) => {
  const banco = await allestisci(t);
  for (const atteso of [2, 3, 4]) assert.equal((await chiama(banco, "POST", "/api/home/chat")).json().numero, atteso);
  assert.equal((await chiama(banco, "POST", "/api/home/chat")).statusCode, 409);
  const idArgomento = banco.casa.chat(3)?.idArgomentoAperto;
  assert.ok(idArgomento !== undefined);
  assert.equal((await chiama(banco, "DELETE", "/api/home/chat/3")).statusCode, 202);
  assert.equal(banco.casa.chat(3), undefined);
  assert.equal(banco.argomenti.trova(idArgomento), undefined);
  assert.equal(banco.casa.archiviati().length, 0);
  assert.equal((await chiama(banco, "DELETE", "/api/home/chat/3")).statusCode, 404);
  // La prossima prende il primo numero libero.
  assert.equal((await chiama(banco, "POST", "/api/home/chat")).json().numero, 3);
});

test("in un progetto una chat parallela lavora nella stessa cartella mentre la principale lavora, e chiusa si cancella", async (t) => {
  const banco = await allestisci(t);
  const progetto = await banco.lavori.crea("Videogioco", "centro", "Un gioco.");
  await finche(() => banco.conversazioniLocali.length === 1, "il progetto apre la sua conversazione");
  const principale = banco.conversazioniLocali[0];
  assert.ok(principale !== undefined);
  assert.equal(banco.lavori.canale(progetto.id)?.sospesi.turni, 1);

  const aperta = await chiama(banco, "POST", `/api/progetti/${progetto.id}/chat`);
  assert.equal(aperta.statusCode, 200, aperta.body);
  const { idConversazione, numero } = aperta.json() as { idConversazione: string; numero: number };
  assert.equal(numero, 2);
  assert.equal(idConversazione, `${progetto.id}~chat-2`);

  // Il messaggio va alla chat, con le rotte del progetto e il suo identificativo.
  const mandato = await chiama(banco, "POST", `/api/progetti/${idConversazione}/messaggi`, { testo: "Leggi il README." });
  assert.equal(mandato.statusCode, 202, mandato.body);
  await finche(() => banco.conversazioniLocali.length === 2, "la chat apre la sua conversazione");
  const chat = banco.conversazioniLocali[1];
  assert.ok(chat !== undefined);
  assert.equal(chat.configurazione?.cartella, progetto.cartella);
  assert.deepEqual(chat.inviati, ["Leggi il README."]);
  assert.ok(chat.annotazioni.some((nota) => /chat parallela del progetto/.test(nota)));
  assert.equal(principale.inviati.length, 1);
  assert.deepEqual(
    banco.lavori.stato().progetti.find((voce) => voce.id === progetto.id)?.chat,
    [{ numero: 2, condizione: "al-lavoro" }],
  );
  // Un permesso nella chat fa aspettare il progetto.
  chat.emetti({ tipo: "permesso-richiesto", idPermesso: "p1", idAzione: "a1", strumento: "Bash", ingresso: {} });
  assert.equal(banco.lavori.stato().progetti.find((voce) => voce.id === progetto.id)?.condizione, "aspetta-te");
  const deciso = await chiama(banco, "POST", `/api/progetti/${idConversazione}/permessi/p1`, { decisione: "approvato" });
  assert.equal(deciso.statusCode, 200, deciso.body);
  assert.deepEqual(chat.decisioni, [["p1", "approvato"]]);
  // Lo stato del progetto, scritto dalla chat, entra nella storia della principale.
  chat.emetti({ tipo: "stato-progetto", testo: "A metà." });
  assert.ok(banco.lavori.canale(progetto.id)?.archiviati.some((voce) => voce.evento.tipo === "stato-progetto"));
  assert.equal(banco.lavori.canale(idConversazione)?.archiviati.some((voce) => voce.evento.tipo === "stato-progetto"), false);
  // Le impostazioni sono del progetto: cambiate da una chat, valgono per tutte.
  const impostato = await chiama(banco, "POST", `/api/progetti/${idConversazione}/impostazioni`, { impegno: "high" });
  assert.equal(impostato.statusCode, 200, impostato.body);
  assert.equal(banco.lavori.impostazioni(progetto.id).impegno, "high");
  assert.equal(principale.impostazioni.at(-1)?.impegno, "high");

  // Chiusa, si ferma, si chiude e la sua storia non c'è più; la principale continua.
  const archivio = join(banco.cartella, "conversazioni", "progetti", `${idConversazione}.jsonl`);
  assert.equal(existsSync(archivio), true);
  const chiusa = await chiama(banco, "DELETE", `/api/progetti/${progetto.id}/chat/2`);
  assert.equal(chiusa.statusCode, 200, chiusa.body);
  assert.equal(chat.interruzioni, 1);
  assert.equal(chat.chiusa, true);
  assert.equal(principale.chiusa, false);
  assert.equal(existsSync(archivio), false);
  assert.equal(banco.lavori.canale(idConversazione), undefined);
  assert.equal(banco.progetti.chatParallele(progetto.id).length, 0);
  assert.equal(banco.lavori.stato().progetti.find((voce) => voce.id === progetto.id)?.chat, undefined);
  assert.equal((await chiama(banco, "POST", `/api/progetti/${idConversazione}/messaggi`, { testo: "?" })).statusCode, 404);
});

test("le chat parallele di un progetto restano dopo un riavvio, e se ne vanno con il progetto", async (t) => {
  const banco = await allestisci(t);
  const progetto = await banco.lavori.crea("Blog", "centro", "Un blog.");
  assert.equal((await chiama(banco, "POST", `/api/progetti/${progetto.id}/chat`)).json().numero, 2);
  assert.equal((await chiama(banco, "POST", `/api/progetti/${progetto.id}/chat`)).json().numero, 3);
  assert.equal((await chiama(banco, "POST", `/api/progetti/${progetto.id}/chat`)).json().numero, 4);
  assert.equal((await chiama(banco, "POST", `/api/progetti/${progetto.id}/chat`)).statusCode, 409);
  await banco.progetti.ricordaSessione(`${progetto.id}~chat-3`, "sessione-tre");
  assert.equal(banco.progetti.idSessione(`${progetto.id}~chat-3`), "sessione-tre");
  assert.equal(banco.progetti.idSessione(progetto.id), undefined);

  const eliminato = await chiama(banco, "DELETE", `/api/progetti/${progetto.id}`);
  assert.equal(eliminato.statusCode, 200, eliminato.body);
  for (const numero of [2, 3, 4]) {
    assert.equal(existsSync(join(banco.cartella, "conversazioni", "progetti", `${progetto.id}~chat-${numero}.jsonl`)), false);
  }
});
