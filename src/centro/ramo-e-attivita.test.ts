import assert from "node:assert/strict";
import { test } from "node:test";
import type { EventoArchiviato, EventoConversazione } from "../protocollo/eventi.ts";
import { allestisci, avviaNodoAccettato, finche, ID_NODO, type Banco, type ConversazioneFinta } from "../prove/banco.ts";
import { COOKIE_SESSIONE } from "./centro.ts";
import { storiaPrimaDi } from "./home.ts";

async function chiedi(banco: Banco, url: string, payload: Record<string, unknown>): Promise<{ stato: number; dati: Record<string, unknown> }> {
  const risposta = await banco.centro.inject({ method: "POST", url, cookies: { [COOKIE_SESSIONE]: await banco.entra() }, payload });
  return { stato: risposta.statusCode, dati: risposta.json() };
}

function concludi(conversazione: ConversazioneFinta): void {
  conversazione.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 1 });
}

function scambia(banco: Banco, ...messaggi: string[]): void {
  for (const testo of messaggi) {
    banco.casa.invia(testo);
    banco.home.emetti({ tipo: "testo-concluso", idTesto: `t-${testo}`, testo: `Risposta a: ${testo}` });
    concludi(banco.home);
  }
}

const TITOLO = { titolo: "Nomi per il gatto", riassunto: "Scelti tre nomi." };

test("un messaggio modificato parte in un argomento nuovo, con la storia fin lì e la conversazione copiata", async (t) => {
  const banco = await allestisci(t);
  const primo = banco.casa.idArgomentoAperto;
  const cartella = banco.casa.cartellaAperta;
  const diPrima = banco.home;
  scambia(banco, "Mi servono nomi per un gatto.", "Più corti.", "Ancora più corti.");

  const { stato } = await chiedi(banco, "/api/home/messaggi/m2/ramo", { testo: "Più lunghi." });
  assert.equal(stato, 202);
  // La conversazione di prima ha copiato la sua storia fino a prima di quel messaggio, e intitola l'argomento.
  assert.deepEqual(diPrima.biforcazioni, ["m2"]);
  assert.match(diPrima.istruzioni[0] ?? "", /cambia_argomento/);
  assert.equal(banco.casa.richiediCambio(TITOLO), "Argomento archiviato. Non scrivere altro.");
  concludi(diPrima);
  await finche(() => banco.conversazioniHome.length === 2 && banco.home.inviati.length === 1, "si apre il ramo");

  // Il ramo lavora nella stessa cartella e riprende dalla copia; sa da dove nasce.
  const nuovo = banco.home;
  assert.notEqual(banco.casa.idArgomentoAperto, primo);
  assert.equal(nuovo.configurazione?.cartella, cartella);
  assert.equal(nuovo.configurazione?.idSessione, "ramo-di-m2");
  assert.equal(banco.argomenti.aperto.cartella, cartella);
  assert.deepEqual(nuovo.inviati, ["Più lunghi."]);
  assert.match(nuovo.annotazioni.join("\n"), /argomento nuovo da un suo messaggio[\s\S]*«Nomi per il gatto»/);

  // La sua storia comincia con quella di prima fino al messaggio, che lì non si modifica più.
  const eventi = banco.canale.archiviati.map(({ evento }) => evento);
  assert.deepEqual(
    eventi.map((evento) => evento.tipo),
    ["messaggio-proprietario", "turno-iniziato", "testo-concluso", "turno-concluso", "passaggio-argomento", "messaggio-proprietario", "turno-iniziato"],
  );
  assert.deepEqual(eventi[0], { tipo: "messaggio-proprietario", id: "m1", testo: "Mi servono nomi per un gatto." });
  assert.deepEqual(eventi[4], { tipo: "passaggio-argomento", riaperto: false, archiviato: { id: primo, titolo: TITOLO.titolo }, ramo: true });
  assert.equal((eventi[5] as Extract<EventoConversazione, { tipo: "messaggio-proprietario" }>).modificabile, true);
  // I momenti sono quelli di allora.
  const archivioDiPrima = await banco.casa.canaleDi(primo);
  assert.equal(banco.canale.archiviati[0]?.quando, archivioDiPrima?.archiviati.find(({ evento }) => evento.tipo === "messaggio-proprietario")?.quando);

  // Quello di prima resta tutto, archiviato.
  assert.deepEqual(banco.argomenti.archiviati().map((voce) => voce.titolo), [TITOLO.titolo]);
  assert.equal(archivioDiPrima?.archiviati.filter(({ evento }) => evento.tipo === "messaggio-proprietario").length, 3);
});

test("un ramo dal primo messaggio riparte da capo; mentre Claude lavora, o da un messaggio che non c'è, non nasce", async (t) => {
  const banco = await allestisci(t);
  scambia(banco, "Primo.");
  banco.casa.invia("Secondo, in corso.");
  const occupata = await chiedi(banco, "/api/home/messaggi/m1/ramo", { testo: "Altro." });
  assert.equal(occupata.stato, 409);
  assert.match(String(occupata.dati.errore), /sta lavorando/);
  concludi(banco.home);
  assert.equal((await chiedi(banco, "/api/home/messaggi/inventato/ramo", { testo: "Altro." })).stato, 409);
  assert.equal((await chiedi(banco, "/api/home/messaggi/m1/ramo", { testo: "   " })).stato, 400);

  const diPrima = banco.home;
  assert.equal((await chiedi(banco, "/api/home/messaggi/m1/ramo", { testo: "Primo, rivisto." })).stato, 202);
  banco.casa.richiediCambio(TITOLO);
  concludi(diPrima);
  await finche(() => banco.conversazioniHome.length === 2 && banco.home.inviati.length === 1, "si apre il ramo");
  assert.equal(banco.home.configurazione?.idSessione, undefined);
  assert.deepEqual(
    banco.canale.archiviati.map(({ evento }) => evento.tipo),
    ["passaggio-argomento", "messaggio-proprietario", "turno-iniziato"],
  );
});

test("la storia di un ramo chiude il turno in cui il messaggio era entrato, e lascia ciò che riguarda solo l'argomento di prima", () => {
  const voce = (n: number, evento: EventoConversazione): EventoArchiviato => ({ n, quando: `2026-11-18T10:00:0${n}Z`, evento });
  const storia = [
    voce(1, { tipo: "passaggio-argomento", riaperto: true }),
    voce(2, { tipo: "messaggio-proprietario", id: "a", testo: "Uno", modificabile: true }),
    voce(3, { tipo: "turno-iniziato" }),
    voce(4, { tipo: "riavvolto", idMessaggio: "x" }),
    voce(5, { tipo: "messaggio-proprietario", id: "b", testo: "Due, a turno in corso", modificabile: true }),
  ];
  assert.equal(storiaPrimaDi(storia, "c"), undefined);
  assert.deepEqual(storiaPrimaDi(storia, "b"), [
    voce(2, { tipo: "messaggio-proprietario", id: "a", testo: "Uno" }),
    voce(3, { tipo: "turno-iniziato" }),
    { n: 0, quando: "2026-11-18T10:00:05Z", evento: { tipo: "turno-concluso", riuscito: true, durataMs: 0 } },
  ]);
});

test("l'uscita di un'attività si legge dalla Home e da un progetto, anche su un nodo", async (t) => {
  const banco = await allestisci(t);
  banco.home.uscite.set("c1", "USCITA");
  const leggi = async (url: string) => banco.centro.inject({ method: "GET", url, cookies: { [COOKIE_SESSIONE]: await banco.entra() } });
  assert.deepEqual((await leggi("/api/home/attivita/c1/uscita")).json(), { testo: "USCITA", troncata: false });
  assert.equal((await leggi("/api/home/attivita/c2/uscita")).statusCode, 409);

  const nodo = await avviaNodoAccettato(t, banco);
  const idProgetto = (await banco.lavori.crea("Videogioco", ID_NODO, "Un gioco.")).id;
  await finche(() => nodo.conversazioni.length === 1, "la conversazione nasce sul nodo");
  nodo.conversazioni[0]?.uscite.set("a1", "PRONTO");
  assert.deepEqual((await leggi(`/api/progetti/${idProgetto}/attivita/a1/uscita`)).json(), { testo: "PRONTO", troncata: false });
});
