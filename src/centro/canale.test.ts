import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import type { EventoArchiviato } from "../protocollo/eventi.ts";
import { Canale } from "./canale.ts";

async function fileProvvisorio(t: TestContext): Promise<string> {
  const cartella = await mkdtemp(join(tmpdir(), "shinka-canale-"));
  t.after(() => rm(cartella, { recursive: true, force: true }));
  return join(cartella, "conversazioni", "home.jsonl");
}

function raccogli(canale: Canale): EventoArchiviato[] {
  const ricevuti: EventoArchiviato[] = [];
  canale.iscrivi((evento) => ricevuti.push(evento));
  return ricevuti;
}

test("gli eventi vengono numerati, archiviati e distribuiti", async (t) => {
  const file = await fileProvvisorio(t);
  const canale = await Canale.apri(file);
  const ricevuti = raccogli(canale);

  canale.pubblica({ tipo: "messaggio-proprietario", id: "a", testo: "ciao" });
  canale.pubblica({ tipo: "turno-iniziato" });

  assert.deepEqual(ricevuti.map((e) => [e.n, e.evento.tipo]), [
    [1, "messaggio-proprietario"],
    [2, "turno-iniziato"],
  ]);
  const righe = (await readFile(file, "utf8")).trim().split("\n");
  assert.equal(righe.length, 2);
});

test("i frammenti di testo si distribuiscono ma non si archiviano", async (t) => {
  const file = await fileProvvisorio(t);
  const canale = await Canale.apri(file);
  const ricevuti = raccogli(canale);

  canale.pubblica({ tipo: "testo-iniziato", idTesto: "t1" });
  canale.pubblica({ tipo: "testo-frammento", idTesto: "t1", frammento: "Ciao" });
  canale.pubblica({ tipo: "testo-concluso", idTesto: "t1", testo: "Ciao" });

  assert.deepEqual(ricevuti.map((e) => e.n), [1, 0, 2]);
  assert.equal((await readFile(file, "utf8")).includes("testo-frammento"), false);
});

test("chi si collega a metà risposta riceve la storia e il testo arrivato finora", async (t) => {
  const canale = await Canale.apri(await fileProvvisorio(t));
  canale.pubblica({ tipo: "turno-iniziato" });
  canale.pubblica({ tipo: "testo-iniziato", idTesto: "t1" });
  canale.pubblica({ tipo: "testo-frammento", idTesto: "t1", frammento: "Tokyo è " });
  canale.pubblica({ tipo: "testo-frammento", idTesto: "t1", frammento: "la capitale" });

  const ricevuti = raccogli(canale);
  assert.deepEqual(ricevuti.map((e) => e.evento), [
    { tipo: "turno-iniziato" },
    { tipo: "testo-iniziato", idTesto: "t1" },
    { tipo: "testo-frammento", idTesto: "t1", frammento: "Tokyo è la capitale" },
  ]);
});

test("chi si scollega non riceve più nulla", async (t) => {
  const canale = await Canale.apri(await fileProvvisorio(t));
  const ricevuti: EventoArchiviato[] = [];
  const scollega = canale.iscrivi((evento) => ricevuti.push(evento));
  scollega();
  canale.pubblica({ tipo: "turno-iniziato" });
  assert.equal(ricevuti.length, 0);
});

test("la storia si ritrova dopo il riavvio", async (t) => {
  const file = await fileProvvisorio(t);
  const primo = await Canale.apri(file);
  primo.pubblica({ tipo: "messaggio-proprietario", id: "a", testo: "ciao" });
  primo.pubblica({ tipo: "turno-iniziato" });
  primo.pubblica({ tipo: "turno-concluso", riuscito: true, durataMs: 5 });

  const secondo = await Canale.apri(file);
  assert.deepEqual(secondo.archiviati.map((e) => e.evento.tipo), [
    "messaggio-proprietario",
    "turno-iniziato",
    "turno-concluso",
  ]);
});

test("al riavvio ciò che era in sospeso viene chiuso", async (t) => {
  const file = await fileProvvisorio(t);
  const primo = await Canale.apri(file);
  primo.pubblica({ tipo: "turno-iniziato" });
  primo.pubblica({ tipo: "testo-iniziato", idTesto: "t1" });
  primo.pubblica({
    tipo: "permesso-richiesto",
    idPermesso: "p1",
    idAzione: "p1",
    strumento: "Bash",
    ingresso: { command: "date" },
  });

  const secondo = await Canale.apri(file);
  const aggiunti = secondo.archiviati.slice(3).map((e) => e.evento);
  assert.deepEqual(aggiunti.map((e) => e.tipo), ["testo-concluso", "permesso-deciso", "turno-concluso"]);
  assert.ok(aggiunti[1]?.tipo === "permesso-deciso" && aggiunti[1].decisione === "negato");
  assert.ok(aggiunti[2]?.tipo === "turno-concluso" && !aggiunti[2].riuscito);
});

test("una proposta rimasta senza risposta al riavvio resta in attesa", async (t) => {
  const file = await fileProvvisorio(t);
  const primo = await Canale.apri(file);
  primo.pubblica({ tipo: "proposta-progetto", idProposta: "p1", nome: "Videogioco", idAmbiente: "centro", brief: "Un gioco." });
  primo.pubblica({ tipo: "proposta-progetto", idProposta: "p2", nome: "Sito", idAmbiente: "centro", brief: "Un sito." });
  primo.pubblica({ tipo: "proposta-decisa", idProposta: "p2", esito: "confermata", idProgetto: "x", nome: "Sito" });

  // Le proposte in attesa il centro le ricorda (ProposteRicordate): riaprendo l'archivio restano com'erano.
  const secondo = await Canale.apri(file);
  assert.equal(secondo.archiviati.length, 3);
});

test("l'ordine di spostarsi su un progetto si distribuisce ma non si archivia", async (t) => {
  const file = await fileProvvisorio(t);
  const canale = await Canale.apri(file);
  const ricevuti = raccogli(canale);
  canale.pubblica({ tipo: "messaggio-proprietario", id: "a", testo: "apri il videogioco" });
  canale.pubblica({ tipo: "apri-progetto", idProgetto: "x" });

  assert.deepEqual(ricevuti.map((e) => [e.n, e.evento.tipo]), [
    [1, "messaggio-proprietario"],
    [0, "apri-progetto"],
  ]);
  // Chi ricarica la pagina non deve essere spostato di nuovo.
  assert.deepEqual(raccogli(canale).map((e) => e.evento.tipo), ["messaggio-proprietario"]);
  assert.equal((await readFile(file, "utf8")).includes("apri-progetto"), false);
});

test("il canale sa quanti turni e quanti permessi sono ancora aperti", async (t) => {
  const canale = await Canale.apri(await fileProvvisorio(t));
  assert.deepEqual(canale.sospesi, { turni: 0, permessi: 0 });

  canale.pubblica({ tipo: "turno-iniziato" });
  canale.pubblica({ tipo: "permesso-richiesto", idPermesso: "p1", idAzione: "p1", strumento: "Bash", ingresso: {} });
  assert.deepEqual(canale.sospesi, { turni: 1, permessi: 1 });

  canale.pubblica({ tipo: "permesso-deciso", idPermesso: "p1", decisione: "approvato" });
  assert.deepEqual(canale.sospesi, { turni: 1, permessi: 0 });

  // Chi lavorava non c'è più: ciò che era aperto viene chiuso, e chi ascolta lo viene a sapere.
  const dopo: string[] = [];
  canale.ascolta(({ evento }) => dopo.push(evento.tipo));
  canale.chiudiSospesi("L'ambiente si è scollegato.");
  assert.deepEqual(canale.sospesi, { turni: 0, permessi: 0 });
  assert.deepEqual(dopo, ["turno-concluso"]);
});

test("le domande di Claude aspettano il proprietario finché non si chiudono, e chi lavorava non c'è più le annulla", async (t) => {
  const canale = await Canale.apri(await fileProvvisorio(t));
  canale.pubblica({ tipo: "turno-iniziato" });
  canale.pubblica({ tipo: "domande-poste", idDomande: "d1", domande: [] });
  canale.pubblica({ tipo: "domande-poste", idDomande: "d2", domande: [] });
  assert.deepEqual(canale.sospesi, { turni: 1, permessi: 2 });
  canale.pubblica({ tipo: "domande-chiuse", idDomande: "d1", esito: "risposte", risposte: ["Sì"] });
  assert.deepEqual(canale.sospesi, { turni: 1, permessi: 1 });

  const dopo: unknown[] = [];
  canale.ascolta(({ evento }) => dopo.push(evento));
  canale.chiudiSospesi("Il centro è stato riavviato.");
  assert.deepEqual(canale.sospesi, { turni: 0, permessi: 0 });
  assert.deepEqual(dopo[0], { tipo: "domande-chiuse", idDomande: "d2", esito: "annullate" });
});

test("una riga scritta a metà non impedisce di riaprire l'archivio", async (t) => {
  const file = await fileProvvisorio(t);
  const primo = await Canale.apri(file);
  primo.pubblica({ tipo: "messaggio-proprietario", id: "a", testo: "ciao" });
  await appendFile(file, '{"n":2,"quando":"2026-11-11T10:00:00.000Z","evento":{"tipo":"turno-ini');

  const secondo = await Canale.apri(file);
  assert.equal(secondo.archiviati.length, 1);
  secondo.pubblica({ tipo: "turno-iniziato" });
  secondo.pubblica({ tipo: "turno-concluso", riuscito: true, durataMs: 1 });
  assert.equal(secondo.archiviati.at(-1)?.n, 3);

  // Ciò che viene aggiunto dopo non deve finire attaccato alla riga spezzata.
  const terzo = await Canale.apri(file);
  assert.deepEqual(terzo.archiviati.map((e) => e.evento.tipo), [
    "messaggio-proprietario",
    "turno-iniziato",
    "turno-concluso",
  ]);
});

test("un'approvazione in attesa conta come una richiesta al proprietario, e al riavvio risulta scaduta", async (t) => {
  const file = await fileProvvisorio(t);
  const primo = await Canale.apri(file);
  const richiesta = { host: "nas.lan:22", credenziale: "nas", comando: "docker stop plex", scadeIl: "2026-11-12T10:05:00.000Z" };
  primo.pubblica({ tipo: "approvazione-richiesta", idApprovazione: "a1", ...richiesta });
  primo.pubblica({ tipo: "approvazione-richiesta", idApprovazione: "a2", ...richiesta });
  assert.deepEqual(primo.sospesi, { turni: 0, permessi: 2 });
  primo.pubblica({ tipo: "approvazione-decisa", idApprovazione: "a2", esito: "negata" });
  assert.deepEqual(primo.sospesi, { turni: 0, permessi: 1 });

  // Le approvazioni in attesa vivono nella memoria del centro e del gateway: dopo il riavvio non si possono più dare.
  const secondo = await Canale.apri(file);
  assert.deepEqual(secondo.archiviati.slice(3).map((e) => e.evento), [
    { tipo: "approvazione-decisa", idApprovazione: "a1", esito: "scaduta" },
  ]);
  assert.deepEqual(secondo.sospesi, { turni: 0, permessi: 0 });
});

test("al riavvio un'installazione in attesa risulta scaduta, una proposta di sviluppo resta in attesa", async (t) => {
  const file = await fileProvvisorio(t);
  const primo = await Canale.apri(file);
  primo.pubblica({ tipo: "sviluppo-proposto", idProposta: "s1", titolo: "Tema scuro", richiesta: "Serve un tema scuro." });
  primo.pubblica({
    tipo: "installazione-richiesta",
    idInstallazione: "i1",
    versione: "01234567",
    riassunto: "Un pulsante.",
    modifiche: [],
    file: [],
    quantiFile: 0,
    avvisi: [],
    scadeIl: "2026-11-12T19:00:00.000Z",
  });
  // Un'installazione in attesa aspetta il proprietario, come un permesso; una proposta no.
  assert.deepEqual(primo.sospesi, { turni: 0, permessi: 1 });

  const secondo = await Canale.apri(file);
  assert.deepEqual(secondo.archiviati.slice(2).map((e) => e.evento), [{ tipo: "installazione-decisa", idInstallazione: "i1", esito: "scaduta" }]);
  assert.deepEqual(secondo.sospesi, { turni: 0, permessi: 0 });

  // Ciò che è già deciso resta com'è.
  const terzo = await Canale.apri(file);
  assert.equal(terzo.archiviati.length, 3);
});

test("la proposta di un'estensione rimasta senza risposta al riavvio resta in attesa", async (t) => {
  const file = await fileProvvisorio(t);
  const primo = await Canale.apri(file);
  const proposta = (idProposta: string, nome: string) =>
    primo.pubblica({
      tipo: "estensione-proposta",
      idProposta,
      nome,
      descrizione: "Dice che tempo fa.",
      definizione: { tipo: "mcp-locale", comando: "node", argomenti: ["meteo.js"], variabili: {} },
      chiavi: [],
      idAmbiente: "centro",
      nomeAmbiente: "Unraid",
      avvisi: [],
    });
  proposta("e1", "meteo");
  proposta("e2", "posta");
  primo.pubblica({ tipo: "estensione-decisa", idProposta: "e1", esito: "accesa", strumenti: ["saluta"] });
  // Una scheda in attesa non tiene occupata la conversazione.
  assert.deepEqual(primo.sospesi, { turni: 0, permessi: 0 });

  // Al riavvio la proposta resta: il centro la ricorda, e la scheda tiene i suoi pulsanti.
  const secondo = await Canale.apri(file);
  assert.equal(secondo.archiviati.length, 3);
});
