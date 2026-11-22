import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { allestisci, finche, type Banco } from "../prove/banco.ts";
import { RegistroArgomenti } from "./argomenti.ts";
import { COOKIE_SESSIONE } from "./centro.ts";

const TITOLO = { titolo: "Rinominare le foto", riassunto: "Script sul PC." };

function concludi(banco: Banco): void {
  banco.home.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 1 });
}

async function chiama(banco: Banco, url: string): Promise<{ stato: number; dati: Record<string, unknown> }> {
  const risposta = await banco.centro.inject({
    method: "POST",
    url,
    cookies: { [COOKIE_SESSIONE]: await banco.entra() },
  });
  return { stato: risposta.statusCode, dati: risposta.json() };
}

/** Apre un flusso del centro e restituisce come aspettare che vi compaia un testo. */
async function apriFlusso(
  t: TestContext,
  banco: Banco,
  percorso: string,
): Promise<{ finche(atteso: string): Promise<void>; ricevuto(): string }> {
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

test("senza sessione gli argomenti non si leggono e non si cambiano", async (t) => {
  const banco = await allestisci(t);
  const id = banco.casa.idArgomentoAperto;
  for (const [method, url] of [
    ["POST", "/api/home/argomento-nuovo"],
    ["GET", `/api/argomenti/${id}/eventi`],
    ["GET", `/api/argomenti/${id}/immagini/x.png`],
    ["POST", `/api/argomenti/${id}/riapertura`],
  ] as const) {
    const risposta = await banco.centro.inject({ method, url });
    assert.equal(risposta.statusCode, 401, url);
  }
});

test("il proprietario apre un argomento nuovo e riprende quello archiviato", async (t) => {
  const banco = await allestisci(t);
  const primo = banco.casa.idArgomentoAperto;

  // Mentre Claude lavora l'argomento non si cambia.
  banco.casa.invia("Scrivimi uno script che rinomina le foto.");
  const occupata = await chiama(banco, "/api/home/argomento-nuovo");
  assert.equal(occupata.stato, 409);
  assert.match(String(occupata.dati.errore), /sta ancora lavorando/);
  concludi(banco);

  assert.equal((await chiama(banco, "/api/home/argomento-nuovo")).stato, 202);
  banco.casa.richiediCambio(TITOLO);
  concludi(banco);
  await finche(() => banco.conversazioniHome.length === 2, "si apre l'argomento nuovo");
  const secondo = banco.casa.idArgomentoAperto;

  assert.equal((await chiama(banco, "/api/argomenti/mai-esistito/riapertura")).stato, 404);
  assert.equal((await chiama(banco, `/api/argomenti/${secondo}/riapertura`)).stato, 404);
  // Dall'argomento nuovo, ancora vuoto, la ripresa è immediata.
  assert.equal((await chiama(banco, `/api/argomenti/${primo}/riapertura`)).stato, 202);
  assert.equal(banco.casa.idArgomentoAperto, primo);
  assert.deepEqual(banco.argomenti.archiviati(), []);
});

test("la storia di un argomento archiviato si rilegge, quella di uno inesistente no", async (t) => {
  const banco = await allestisci(t);
  const primo = banco.casa.idArgomentoAperto;
  banco.casa.invia("Scrivimi uno script che rinomina le foto.");
  concludi(banco);
  banco.casa.invia("Aggiungi la data.");
  concludi(banco);
  banco.casa.invia("Che tempo fa domani?");
  banco.casa.richiediCambio(TITOLO);
  concludi(banco);
  await finche(() => banco.conversazioniHome.length === 2, "si apre l'argomento nuovo");

  const cookies = { [COOKIE_SESSIONE]: await banco.entra() };
  const inesistente = await banco.centro.inject({ method: "GET", url: "/api/argomenti/mai-esistito/eventi", cookies });
  assert.equal(inesistente.statusCode, 404);

  const flusso = await apriFlusso(t, banco, `/api/argomenti/${primo}/eventi`);
  await flusso.finche("event: storia");
  assert.ok(flusso.ricevuto().indexOf('"tipo":"argomento-archiviato"') < flusso.ricevuto().indexOf("event: storia"));
  assert.match(flusso.ricevuto(), /"testo":"Scrivimi uno script che rinomina le foto\."/);
  assert.equal(flusso.ricevuto().includes("passaggio-argomento"), false);
  // Rileggere un argomento archiviato non avvia nulla.
  assert.equal(banco.conversazioniHome[0]?.preparazioni, 0);
});

test("chi tiene aperta la Home vede cambiare l'argomento, e il quadro elenca quelli archiviati", async (t) => {
  const banco = await allestisci(t);
  const primo = banco.casa.idArgomentoAperto;
  banco.casa.invia("Scrivimi uno script che rinomina le foto.");
  concludi(banco);
  banco.casa.invia("Aggiungi la data.");
  concludi(banco);

  const home = await apriFlusso(t, banco, "/api/home/eventi");
  const quadro = await apriFlusso(t, banco, "/api/quadro/eventi");
  await home.finche('"testo":"Aggiungi la data."');
  await quadro.finche(`event: argomenti\ndata: {"idAperto":"${primo}","archiviati":[]}`);

  banco.casa.invia("Che tempo fa domani?");
  banco.casa.richiediCambio(TITOLO);
  concludi(banco);

  await home.finche("event: azzera\ndata: {}\n\n");
  await home.finche('"tipo":"turno-iniziato"');
  const dopo = home.ricevuto().slice(home.ricevuto().indexOf("event: azzera"));
  assert.match(dopo, new RegExp(`"tipo":"passaggio-argomento","riaperto":false,"archiviato":\\{"id":"${primo}"`));
  assert.match(dopo, /"testo":"Che tempo fa domani\?"/);
  assert.equal(dopo.includes("Aggiungi la data."), false);

  await quadro.finche('"titolo":"Rinominare le foto"');
  assert.match(quadro.ricevuto(), new RegExp(`"idAperto":"${banco.casa.idArgomentoAperto}","archiviati":\\[\\{"id":"${primo}"`));
});

test("la conversazione della Home nata prima degli argomenti diventa il primo argomento, dov'era", async (t) => {
  const cartella = await mkdtemp(join(tmpdir(), "shinka-argomenti-"));
  t.after(() => rm(cartella, { recursive: true, force: true }));
  const file = join(cartella, "argomenti.json");
  const ereditato = { archivio: join(cartella, "home.jsonl"), cartella: join(cartella, "home"), idSessione: "sessione-di-prima" };

  const registro = await RegistroArgomenti.apri(file, ereditato, Date.parse("2026-11-11T09:00:00Z"));
  assert.match(registro.aperto.id, /^2026-11-11-[0-9a-f]{6}$/);
  assert.partialDeepStrictEqual(registro.aperto, ereditato);
  assert.deepEqual(registro.stato(), { idAperto: registro.aperto.id, archiviati: [] });

  // Una volta nato, il registro non eredita più nulla; e archiviando si tiene il posto dei file.
  const stati: string[] = [];
  const smetti = registro.iscrivi((stato) => stati.push(stato.idAperto));
  const primo = registro.aperto.id;
  const nuovo = await registro.passa(TITOLO, "nuovo", Date.parse("2026-11-12T09:00:00Z"));
  assert.match(nuovo.id, /^2026-11-12-/);
  assert.deepEqual(stati, [primo, nuovo.id]);
  smetti();
  await registro.ricordaSessione(nuovo.id, "sessione-nuova");

  const riaperto = await RegistroArgomenti.apri(file, { archivio: "altro", cartella: "altra" });
  assert.equal(riaperto.aperto.id, nuovo.id);
  assert.equal(riaperto.aperto.idSessione, "sessione-nuova");
  assert.partialDeepStrictEqual(riaperto.trova(primo), { ...ereditato, ...TITOLO, archiviatoIl: "2026-11-12T09:00:00.000Z" });
  assert.deepEqual(riaperto.archiviati(), [
    { id: primo, ...TITOLO, apertoIl: "2026-11-11T09:00:00.000Z", archiviatoIl: "2026-11-12T09:00:00.000Z" },
  ]);

  // Un argomento dimenticato sparisce; riprendere quello aperto o uno inesistente non si può.
  await riaperto.ricordaSessione(nuovo.id, "");
  await assert.rejects(riaperto.passa("da-dimenticare", nuovo.id), /non esiste/);
  await assert.rejects(riaperto.passa("da-dimenticare", "mai-esistito"), /non esiste/);
  const ripreso = await riaperto.passa("da-dimenticare", primo);
  assert.equal(ripreso.id, primo);
  assert.equal(ripreso.archiviatoIl, undefined);
  assert.equal(riaperto.trova(nuovo.id), undefined);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")).argomenti.map((a: { id: string }) => a.id), [primo]);

  // Un registro che non indica un argomento aperto esistente riparte da uno nuovo.
  await writeFile(file, JSON.stringify({ idAperto: "sparito", argomenti: [] }));
  const ripartito = await RegistroArgomenti.apri(file);
  assert.deepEqual(ripartito.archiviati(), []);
  assert.equal(ripartito.aperto.archivio, undefined);
});

test("due scritture del registro chieste insieme non si pestano i piedi", async (t) => {
  const cartella = await mkdtemp(join(tmpdir(), "shinka-argomenti-"));
  t.after(() => rm(cartella, { recursive: true, force: true }));
  const file = join(cartella, "argomenti.json");
  const registro = await RegistroArgomenti.apri(file);
  const primo = registro.aperto.id;

  // L'harness comunica la sessione proprio mentre l'argomento cambia.
  await Promise.all([
    registro.ricordaSessione(primo, "sessione-1"),
    registro.passa({ titolo: "Foto", riassunto: "Rinominate." }, "nuovo"),
    registro.ricordaSessione(primo, "sessione-2"),
  ]);

  const riletto = await RegistroArgomenti.apri(file);
  assert.equal(riletto.trova(primo)?.idSessione, "sessione-2");
  assert.equal(riletto.trova(primo)?.titolo, "Foto");
  assert.notEqual(riletto.aperto.id, primo);
});
