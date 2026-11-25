import assert from "node:assert/strict";
import { Canale } from "./canale.ts";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { EventoArchiviato, EventoConversazione } from "../protocollo/eventi.ts";
import { allestisci, finche, type Banco, type ConversazioneFinta } from "../prove/banco.ts";
import { RegistroArgomenti } from "./argomenti.ts";
import { notaDegliArchiviati } from "./home.ts";
import { COOKIE_SESSIONE } from "./centro.ts";

const SCRIPT = { titolo: "Script per rinominare le foto", riassunto: "Scritto rinomina.ps1 nell'ambiente del PC." };

function tipi(eventi: readonly EventoArchiviato[]): string[] {
  return eventi.map((e) => e.evento.tipo);
}

/** Claude finisce di rispondere nell'argomento aperto. */
function concludi(conversazione: ConversazioneFinta): void {
  conversazione.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 1 });
}

/** Il proprietario scrive e Claude risponde, nell'argomento aperto. */
function scambia(banco: Banco, ...messaggi: string[]): void {
  for (const testo of messaggi) {
    banco.casa.invia(testo);
    banco.home.emetti({ tipo: "testo-concluso", idTesto: `t-${testo}`, testo: `Risposta a: ${testo}` });
    concludi(banco.home);
  }
}

/** Aspetta che la Home abbia aperto tante conversazioni, e che l'ultima abbia ricevuto tanti messaggi. */
async function aperte(banco: Banco, quante: number, messaggi = 0): Promise<void> {
  await finche(
    () => banco.conversazioniHome.length === quante && banco.home.inviati.length === messaggi,
    `la Home apre la conversazione numero ${quante}`,
  );
}

/** Un argomento con qualcosa dentro, archiviato da Claude perché il discorso è cambiato. */
async function archiviaIlPrimo(banco: Banco): Promise<string> {
  const primo = banco.casa.idArgomentoAperto;
  scambia(banco, "Scrivimi uno script che rinomina le foto.", "Aggiungi la data al nome.");
  banco.casa.invia("Cambiando discorso: che tempo fa domani?");
  assert.equal(typeof banco.casa.richiediCambio(SCRIPT), "string");
  const quante = banco.conversazioniHome.length;
  concludi(banco.home);
  await aperte(banco, quante + 1, 1);
  concludi(banco.home);
  return primo;
}

test("quando Claude cambia argomento quello di prima viene archiviato e la richiesta riparte in quello nuovo", async (t) => {
  const banco = await allestisci(t);
  const primo = banco.casa.idArgomentoAperto;
  const conversazioneDiPrima = banco.home;
  scambia(banco, "Scrivimi uno script che rinomina le foto.", "Aggiungi la data al nome.");
  banco.casa.invia("Cambiando discorso: che tempo fa domani?");

  const detto = banco.casa.richiediCambio(SCRIPT);
  assert.ok(typeof detto === "string" && /argomento nuovo/.test(detto) && /senza scrivere altro/.test(detto));
  // Finché Claude non ha finito il turno non cambia nulla.
  assert.equal(banco.casa.idArgomentoAperto, primo);
  assert.equal(banco.conversazioniHome.length, 1);

  concludi(conversazioneDiPrima);
  await finche(() => banco.conversazioniHome.length === 2 && banco.home.inviati.length === 1, "si apre l'argomento nuovo");

  // L'argomento nuovo ha una conversazione sua, a contesto pulito e in una cartella sua.
  const nuovo = banco.casa.idArgomentoAperto;
  assert.notEqual(nuovo, primo);
  assert.equal(conversazioneDiPrima.chiusa, true);
  assert.equal(banco.home.configurazione?.cartella, join(banco.radiceProgetti, "_home", nuovo));
  assert.equal(banco.home.configurazione?.idSessione, undefined);
  assert.ok(existsSync(join(banco.radiceProgetti, "_home", nuovo)));
  // La richiesta che ha fatto cambiare argomento trova risposta lì.
  assert.deepEqual(banco.home.inviati, ["Cambiando discorso: che tempo fa domani?"]);
  assert.deepEqual(tipi(banco.canale.archiviati), ["passaggio-argomento", "messaggio-proprietario", "turno-iniziato"]);
  assert.deepEqual(banco.canale.archiviati[0]?.evento, {
    tipo: "passaggio-argomento",
    riaperto: false,
    archiviato: { id: primo, titolo: SCRIPT.titolo },
  });

  // Quello di prima resta tra gli archiviati, con titolo e riassunto, e la sua storia si rilegge.
  assert.deepEqual(
    banco.argomenti.archiviati().map((voce) => [voce.id, voce.titolo, voce.riassunto]),
    [[primo, SCRIPT.titolo, SCRIPT.riassunto]],
  );
  const archivio = await banco.casa.canaleDi(primo);
  assert.deepEqual(archivio?.archiviati.at(-1)?.evento, {
    tipo: "argomento-archiviato",
    titolo: SCRIPT.titolo,
    proseguito: true,
  });
  assert.equal(archivio?.sospesi.turni, 0);
  // Il messaggio che ha fatto cambiare argomento, con il turno che lo ha seguito, non resta in quello vecchio:
  // l'ultimo messaggio lì è quello dello scambio di prima, anche rileggendo il file.
  const ultimoMessaggio = (eventi: readonly { evento: { tipo: string; testo?: string } }[]): string | undefined =>
    eventi.filter((voce) => voce.evento.tipo === "messaggio-proprietario").at(-1)?.evento.testo;
  assert.equal(ultimoMessaggio(archivio?.archiviati ?? []), "Aggiungi la data al nome.");
  const dalFile = await Canale.apri(join(banco.cartella, "conversazioni", "argomenti", `${primo}.jsonl`));
  assert.equal(ultimoMessaggio(dalFile.archiviati), "Aggiungi la data al nome.");
  assert.deepEqual(dalFile.archiviati.map((voce) => voce.n), dalFile.archiviati.map((_, posto) => posto + 1));
  assert.equal(dalFile.archiviati.at(-1)?.evento.tipo, "argomento-archiviato");

  // Dopo un riavvio del centro gli argomenti sono quelli.
  const riaperto = await RegistroArgomenti.apri(join(banco.cartella, "argomenti.json"));
  assert.equal(riaperto.aperto.id, nuovo);
  assert.deepEqual(riaperto.archiviati(), banco.argomenti.archiviati());
});

test("un argomento appena cominciato non si archivia: Claude risponde lì", async (t) => {
  const banco = await allestisci(t);
  const primo = banco.casa.idArgomentoAperto;

  banco.casa.invia("Che tempo fa domani?");
  const rifiuto = banco.casa.richiediCambio({ titolo: "Meteo", riassunto: "" });
  assert.ok(typeof rifiuto === "object" && /appena cominciato/.test(rifiuto.rifiuto));
  concludi(banco.home);
  await new Promise((risolvi) => setTimeout(risolvi, 50));
  assert.equal(banco.casa.idArgomentoAperto, primo);
  assert.equal(banco.conversazioniHome.length, 1);

  // Senza titolo non si archivia nulla, e un argomento inventato non si riprende.
  scambia(banco, "E dopodomani?");
  assert.equal(typeof banco.casa.richiediCambio({ titolo: "  ", riassunto: "x" }), "object");
  const inventato = banco.casa.richiediCambio({ titolo: "Meteo", riassunto: "", riprendi: "2020-01-01-ffffff" });
  assert.ok(typeof inventato === "object" && /cerca_argomenti/.test(inventato.rifiuto));
  assert.deepEqual(banco.argomenti.archiviati(), []);
});

test("il proprietario apre un argomento nuovo: Claude intitola quello che si chiude, senza che se ne veda la richiesta", async (t) => {
  const banco = await allestisci(t);
  const primo = banco.casa.idArgomentoAperto;
  const conversazioneDiPrima = banco.home;
  scambia(banco, "Scrivimi uno script che rinomina le foto.");

  assert.equal(await banco.casa.nuovoArgomento(), undefined);
  assert.equal(conversazioneDiPrima.istruzioni.length, 1);
  assert.match(conversazioneDiPrima.istruzioni[0] ?? "", /cambia_argomento/);
  assert.deepEqual(conversazioneDiPrima.inviati, ["Scrivimi uno script che rinomina le foto."]);
  // Mentre Claude scrive titolo e riassunto, un secondo passaggio non parte.
  assert.equal(await banco.casa.nuovoArgomento(), "occupata");

  assert.equal(banco.casa.richiediCambio(SCRIPT), "Argomento archiviato. Non scrivere altro.");
  concludi(conversazioneDiPrima);
  await finche(() => banco.conversazioniHome.length === 2, "si apre l'argomento nuovo");

  // Nell'argomento nuovo non c'è nessuna richiesta in attesa di risposta.
  assert.deepEqual(banco.home.inviati, []);
  assert.deepEqual(tipi(banco.canale.archiviati), ["passaggio-argomento"]);
  const archivio = await banco.casa.canaleDi(primo);
  assert.deepEqual(archivio?.archiviati.at(-1)?.evento, {
    tipo: "argomento-archiviato",
    titolo: SCRIPT.titolo,
    proseguito: false,
  });
});

test("se Claude non intitola l'argomento, il titolo è l'inizio della prima richiesta", async (t) => {
  const banco = await allestisci(t);
  const primo = banco.casa.idArgomentoAperto;
  scambia(banco, "Scrivimi   uno script\nche rinomina le foto delle vacanze mettendo la data davanti al nome.");

  assert.equal(await banco.casa.nuovoArgomento(), undefined);
  concludi(banco.home);
  await aperte(banco, 2);
  assert.notEqual(banco.casa.idArgomentoAperto, primo);
  assert.deepEqual(
    banco.argomenti.archiviati().map((voce) => [voce.titolo, voce.riassunto]),
    [["Scrivimi uno script che rinomina le foto delle vacanze me…", ""]],
  );
});

test("un argomento vuoto è già quello nuovo, e se se ne riprende un altro non lascia traccia", async (t) => {
  const banco = await allestisci(t);
  const primo = await archiviaIlPrimo(banco);
  scambia(banco, "Grazie.");
  assert.equal(await banco.casa.nuovoArgomento(), undefined);
  concludi(banco.home);
  await aperte(banco, 3);
  const vuoto = banco.casa.idArgomentoAperto;

  // Chiedere un argomento nuovo da uno vuoto non fa nulla.
  assert.equal(await banco.casa.nuovoArgomento(), undefined);
  assert.equal(banco.casa.idArgomentoAperto, vuoto);
  assert.equal(banco.conversazioniHome.length, 3);
  assert.deepEqual(banco.home.istruzioni, []);

  // Riprenderne uno archiviato da lì cancella quello vuoto.
  assert.equal(await banco.casa.riapri(primo), undefined);
  assert.equal(banco.casa.idArgomentoAperto, primo);
  assert.equal(banco.conversazioniHome.length, 4);
  assert.equal(banco.argomenti.trova(vuoto), undefined);
  assert.equal(existsSync(join(banco.cartella, "conversazioni", "argomenti", `${vuoto}.jsonl`)), false);
  assert.equal(banco.argomenti.archiviati().some((voce) => voce.id === primo), false);
});

test("un argomento archiviato si riprende dov'era: stessa storia, stessa cartella, stesso punto dell'harness", async (t) => {
  const banco = await allestisci(t);
  banco.home.configurazione?.alIdSessione?.("sessione-delle-foto");
  const primo = await archiviaIlPrimo(banco);
  const secondo = banco.casa.idArgomentoAperto;

  // Ciò che non esiste, o è già aperto, non si riprende; e nemmeno mentre Claude lavora.
  assert.equal(await banco.casa.riapri("2020-01-01-ffffff"), "non-trovato");
  assert.equal(await banco.casa.riapri(secondo), "non-trovato");
  banco.casa.invia("E dopodomani?");
  assert.equal(await banco.casa.riapri(primo), "occupata");
  concludi(banco.home);

  assert.equal(await banco.casa.riapri(primo), undefined);
  assert.equal(banco.casa.richiediCambio({ titolo: "Meteo", riassunto: "Previsioni." }), "Argomento archiviato. Non scrivere altro.");
  concludi(banco.home);
  await aperte(banco, 3);

  assert.equal(banco.casa.idArgomentoAperto, primo);
  assert.equal(banco.home.configurazione?.cartella, join(banco.radiceProgetti, "_home", primo));
  assert.equal(banco.home.configurazione?.idSessione, "sessione-delle-foto");
  assert.equal(banco.home.annotazioni.length, 1);
  assert.match(banco.home.annotazioni[0] ?? "", /era archiviato/);
  assert.deepEqual(banco.home.inviati, []);
  // La sua storia è quella di prima, con in più la ripresa.
  assert.equal(banco.canale.archiviati[0]?.evento.tipo, "messaggio-proprietario");
  assert.deepEqual(banco.canale.archiviati.at(-1)?.evento, {
    tipo: "passaggio-argomento",
    riaperto: true,
    archiviato: { id: secondo, titolo: "Meteo" },
  });
  assert.deepEqual(banco.argomenti.archiviati().map((voce) => voce.id), [secondo]);
});

test("Claude riprende un argomento archiviato quando il proprietario ci torna sopra", async (t) => {
  const banco = await allestisci(t);
  const primo = await archiviaIlPrimo(banco);
  const secondo = banco.casa.idArgomentoAperto;

  // Dall'argomento del meteo, con uno scambio solo: resta archiviato anche quello.
  scambia(banco, "Grazie.");
  banco.casa.invia("Torniamo allo script delle foto: aggiungi anche l'ora.");
  const detto = banco.casa.richiediCambio({ titolo: "Meteo", riassunto: "Previsioni.", riprendi: primo });
  assert.ok(typeof detto === "string" && /argomento ripreso/.test(detto));
  concludi(banco.home);
  await aperte(banco, 3, 1);
  assert.equal(banco.casa.idArgomentoAperto, primo);
  assert.deepEqual(banco.home.inviati, ["Torniamo allo script delle foto: aggiungi anche l'ora."]);
  assert.deepEqual(banco.argomenti.archiviati().map((voce) => voce.id), [secondo]);
  concludi(banco.home);

  // Da un argomento nato solo per quella richiesta: non lascia nulla da conservare.
  assert.equal(await banco.casa.nuovoArgomento(), undefined);
  assert.equal(banco.casa.richiediCambio(SCRIPT), "Argomento archiviato. Non scrivere altro.");
  concludi(banco.home);
  await aperte(banco, 4);
  const diPassaggio = banco.casa.idArgomentoAperto;
  banco.casa.invia("Riprendi il meteo di ieri.");
  assert.equal(typeof banco.casa.richiediCambio({ titolo: "Meteo di nuovo", riassunto: "", riprendi: secondo }), "string");
  concludi(banco.home);
  await aperte(banco, 5, 1);
  assert.equal(banco.casa.idArgomentoAperto, secondo);
  assert.equal(banco.argomenti.trova(diPassaggio), undefined);
  assert.deepEqual(banco.canale.archiviati.at(-3)?.evento, { tipo: "passaggio-argomento", riaperto: true });
});

test("prima di un messaggio la Home sa gli argomenti archiviati di recente, per riconoscere un seguito anche da una foto", async (t) => {
  const banco = await allestisci(t);
  const primo = await archiviaIlPrimo(banco);
  const conversazione = banco.home;
  // Già con il messaggio riproposto nell'argomento nuovo la conversazione ha ricevuto, prima, gli
  // archiviati recenti con il loro identificativo: così una foto con poche parole trova il suo argomento.
  banco.casa.invia("Che kit è?", [{ nome: "foto.jpg", tipo: "image/jpeg", dati: "AAAA" }]);
  const note = conversazione.annotazioni.filter((testo) => testo.includes("archiviati di recente"));
  assert.equal(note.length, 1);
  const nota = note[0] ?? "";
  assert.match(nota, new RegExp(`- ${primo}: «Script per rinominare le foto» \\(archiviato il \\d{4}-\\d{2}-\\d{2}\\)`));
  assert.match(nota, /`riprendi`/);
  concludi(conversazione);

  // Lo stesso elenco non si ripete a ogni messaggio.
  const dopo = conversazione.annotazioni.length;
  scambia(banco, "E quanto costa?");
  assert.equal(conversazione.annotazioni.slice(dopo).filter((testo) => testo.includes("archiviati di recente")).length, 0);

  // Archiviati vecchi, o nessuno: niente nota. Al massimo gli otto più recenti.
  const adesso = Date.parse("2026-11-25T08:00:00Z");
  const voce = (n: number, quando: string) => ({ id: `a-${n}`, titolo: `Argomento ${n}`, riassunto: "", apertoIl: quando, archiviatoIl: quando });
  assert.equal(notaDegliArchiviati([], adesso), undefined);
  assert.equal(notaDegliArchiviati([voce(1, "2026-10-01T10:00:00Z")], adesso), undefined);
  const tanti = Array.from({ length: 12 }, (_, n) => voce(n, "2026-11-24T10:00:00Z"));
  assert.equal((notaDegliArchiviati(tanti, adesso) ?? "").split("\n").filter((riga) => riga.startsWith("- ")).length, 8);
});

test("chi guarda la Home viene portato sull'argomento nuovo, e i messaggi scritti nel frattempo non si perdono", async (t) => {
  const banco = await allestisci(t);
  const primo = banco.casa.idArgomentoAperto;
  scambia(banco, "Scrivimi uno script che rinomina le foto.", "Aggiungi la data al nome.");
  banco.canale.pubblica({ tipo: "stato", stato: { modelli: [{ valore: "opus", nome: "Opus", descrizione: "" }], modello: "sonnet" } });

  const visti: (EventoConversazione | "azzera" | "storia")[] = [];
  const smetti = banco.casa.segui(
    ({ evento }) => visti.push(evento),
    () => visti.push("azzera"),
    () => visti.push("storia"),
  );
  const primaDelCambio = visti.length;
  assert.ok(primaDelCambio > 1 && !visti.includes("azzera"));
  assert.equal(visti.indexOf("storia"), primaDelCambio - 1, "la storia finisce con il suo segnale");

  banco.casa.invia("Cambiando discorso: che tempo fa domani?");
  banco.casa.richiediCambio(SCRIPT);
  // Scritto mentre l'argomento sta cambiando: aspetta, e parte in quello nuovo.
  banco.casa.invia("E anche dopodomani.");
  assert.equal(banco.home.inviati.includes("E anche dopodomani."), false);
  concludi(banco.home);
  await aperte(banco, 2, 2);
  assert.notEqual(banco.casa.idArgomentoAperto, primo);
  assert.deepEqual(banco.home.inviati, ["Cambiando discorso: che tempo fa domani?", "E anche dopodomani."]);

  // Dopo "azzera" arriva la storia dell'argomento nuovo, chiusa dal suo segnale, e nient'altro di quello vecchio.
  const dopo = visti.slice(visti.indexOf("azzera") + 1);
  assert.equal(dopo.includes("azzera"), false);
  assert.deepEqual(
    dopo.map((evento) => (typeof evento === "string" ? evento : evento.tipo)),
    ["passaggio-argomento", "impostazioni", "stato", "storia", "messaggio-proprietario", "turno-iniziato", "messaggio-proprietario", "turno-iniziato"],
  );
  // I modelli disponibili valgono da subito; il modello in uso lo dirà la conversazione nuova.
  assert.deepEqual(dopo[2], { tipo: "stato", stato: { modelli: [{ valore: "opus", nome: "Opus", descrizione: "" }] } });

  smetti();
  const quanti = visti.length;
  concludi(banco.home);
  assert.equal(visti.length, quanti);
});

test("una proposta decisa dopo il cambio di argomento resta nell'argomento in cui era stata fatta", async (t) => {
  const banco = await allestisci(t);
  scambia(banco, "Vorrei fare un videogioco.", "Di piattaforme.");
  const idProposta = banco.proposte.proponi({ nome: "Videogioco", brief: "Un gioco di piattaforme.", idAmbiente: "centro" });
  const primo = await archiviaIlPrimo(banco);

  const risposta = await banco.centro.inject({
    method: "POST",
    url: `/api/proposte/${idProposta}`,
    cookies: { [COOKIE_SESSIONE]: await banco.entra() },
    payload: { esito: "confermata" },
  });
  assert.equal(risposta.statusCode, 200);

  const archivio = await banco.casa.canaleDi(primo);
  assert.partialDeepStrictEqual(archivio?.archiviati.at(-1)?.evento, { tipo: "proposta-decisa", idProposta, esito: "confermata" });
  assert.equal(tipi(banco.canale.archiviati).includes("proposta-decisa"), false);
  // L'argomento aperto viene comunque informato che il progetto è nato.
  assert.match(banco.home.annotazioni.at(-1) ?? "", /Videogioco/);
});

test("deciso il cambio la Home ferma il turno, senza che nella storia risulti interrotto dal proprietario", async (t) => {
  const banco = await allestisci(t);
  const primo = banco.casa.idArgomentoAperto;
  const conversazione = banco.home;
  scambia(banco, "Scrivimi uno script che rinomina le foto.", "Aggiungi la data al nome.");
  banco.casa.invia("Passiamo ad altro: una lista della spesa.");
  assert.equal(typeof banco.casa.richiediCambio(SCRIPT), "string");
  assert.equal(conversazione.interruzioni, 0);

  // Claude potrebbe proseguire e rispondere anche qui: la Home non glielo lascia fare.
  await finche(() => conversazione.interruzioni === 1, "la Home ferma il turno");
  conversazione.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 7, interrotto: true });
  await aperte(banco, 2, 1);

  // Il turno fermato era quello della richiesta passata all'argomento nuovo: nel vecchio non resta, e
  // nessun turno vi risulta interrotto dal proprietario.
  const archivio = await banco.casa.canaleDi(primo);
  assert.deepEqual(archivio?.archiviati.at(-2)?.evento, { tipo: "turno-concluso", riuscito: true, durataMs: 1 });
  assert.equal(archivio?.archiviati.at(-1)?.evento.tipo, "argomento-archiviato");
  assert.equal(archivio?.archiviati.some(({ evento }) => evento.tipo === "turno-concluso" && evento.interrotto === true), false);

  // Un'interruzione chiesta dal proprietario resta tale.
  banco.home.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 3, interrotto: true });
  assert.deepEqual(banco.canale.archiviati.at(-1)?.evento, {
    tipo: "turno-concluso",
    riuscito: true,
    durataMs: 3,
    interrotto: true,
  });
});
