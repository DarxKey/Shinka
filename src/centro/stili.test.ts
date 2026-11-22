import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { STILI_DI_SHINKA } from "../protocollo/stili.ts";
import { allestisci, finche, type Banco } from "../prove/banco.ts";
import { COOKIE_SESSIONE } from "./centro.ts";
import { RegistroStili, StileNonValido } from "./stili.ts";

async function chiedi(banco: Banco, method: "GET" | "POST" | "DELETE", url: string, payload?: Record<string, unknown>): Promise<{ stato: number; dati: Record<string, unknown> }> {
  const risposta = await banco.centro.inject({
    method,
    url,
    cookies: { [COOKIE_SESSIONE]: await banco.entra() },
    ...(payload === undefined ? {} : { payload }),
  });
  return { stato: risposta.statusCode, dati: risposta.json() };
}

test("uno stile nuovo nasce da nome e descrizione, resta dopo un riavvio e si toglie; quelli di Shinka no", async (t) => {
  const cartella = await mkdtemp(join(tmpdir(), "shinka-stili-"));
  t.after(() => rm(cartella, { recursive: true, force: true }));
  const file = join(cartella, "stili.json");
  const richieste: [string, string][] = [];
  const registro = await RegistroStili.apri(file, async (nome, descrizione) => {
    richieste.push([nome, descrizione]);
    return "  Frasi corte. Niente elenchi.  ";
  });
  assert.deepEqual(registro.elenco(), STILI_DI_SHINKA);

  const creato = await registro.crea("  Telegrafico ", "Frasi corte,\n niente elenchi.");
  assert.deepEqual(richieste, [["Telegrafico", "Frasi corte,\n niente elenchi."]]);
  assert.equal(creato.nome, "Telegrafico");
  assert.equal(creato.descrizione, "Frasi corte, niente elenchi.");
  assert.equal(creato.istruzioni, "Frasi corte. Niente elenchi.");
  assert.equal(creato.diShinka, undefined);
  assert.deepEqual(registro.trova(creato.id), creato);

  // Due stili con lo stesso nome confonderebbero la scelta, e nome e descrizione servono.
  await assert.rejects(registro.crea("telegrafico", "altro"), StileNonValido);
  await assert.rejects(registro.crea("Conciso", "altro"), StileNonValido);
  await assert.rejects(registro.crea("Vuoto", "   "), StileNonValido);
  assert.equal(richieste.length, 1);

  const riaperto = await RegistroStili.apri(file);
  assert.deepEqual(riaperto.elenco().at(-1), { id: creato.id, nome: "Telegrafico", descrizione: creato.descrizione, istruzioni: creato.istruzioni });

  assert.equal(await riaperto.rimuovi("conciso"), false);
  assert.equal(await riaperto.rimuovi(creato.id), true);
  assert.deepEqual((await RegistroStili.apri(file)).elenco(), STILI_DI_SHINKA);
});

test("se Claude non scrive le istruzioni lo stile non nasce", async (t) => {
  const cartella = await mkdtemp(join(tmpdir(), "shinka-stili-"));
  t.after(() => rm(cartella, { recursive: true, force: true }));
  const registro = await RegistroStili.apri(join(cartella, "stili.json"), async () => "   ");
  await assert.rejects(registro.crea("Muto", "Non dice nulla."), /non ha scritto/);
  assert.deepEqual(registro.elenco(), STILI_DI_SHINKA);
});

test("lo stile scelto per la Home e per un progetto arriva alla conversazione con le sue istruzioni, e si toglie", async (t) => {
  const banco = await allestisci(t);
  const elenco = await chiedi(banco, "GET", "/api/stili");
  assert.equal(elenco.stato, 200);
  assert.equal(elenco.dati.siCreano, true);
  assert.deepEqual((elenco.dati.stili as { id: string }[]).map((stile) => stile.id), ["conciso", "spiegato", "didattico"]);

  const nato = await chiedi(banco, "POST", "/api/stili", { nome: "Pirata", descrizione: "Parla come un pirata." });
  assert.equal(nato.stato, 201);
  const pirata = nato.dati.stile as { id: string; istruzioni: string };
  assert.equal(pirata.istruzioni, "Scrivi come «Pirata»: Parla come un pirata.");
  assert.equal((await chiedi(banco, "POST", "/api/stili", { nome: "pirata", descrizione: "Di nuovo." })).stato, 400);

  // Nella Home: la scelta viaggia per identificativo, e alla conversazione arriva lo stile intero.
  const scelta = await chiedi(banco, "POST", "/api/home/impostazioni", { stile: pirata.id });
  assert.equal(scelta.stato, 200);
  const attese = { modello: "haiku", permessi: "chiedi", stile: { id: pirata.id, nome: "Pirata", istruzioni: pirata.istruzioni } };
  assert.deepEqual(scelta.dati.impostazioni, attese);
  assert.deepEqual(banco.home.impostazioni.at(-1), attese);
  assert.deepEqual(banco.statoHome.impostazioni, attese);

  // Uno stile che non c'è non si sceglie; null torna allo stile normale.
  assert.equal((await chiedi(banco, "POST", "/api/home/impostazioni", { stile: "inventato" })).stato, 400);
  const tolto = await chiedi(banco, "POST", "/api/home/impostazioni", { stile: null });
  assert.deepEqual(tolto.dati.impostazioni, { modello: "haiku", permessi: "chiedi" });

  // In un progetto, uno stile di Shinka.
  const idProgetto = (await banco.lavori.crea("Videogioco", "centro", "Un gioco di piattaforme.")).id;
  await finche(() => banco.conversazioniLocali.length === 1, "il progetto apre la sua conversazione");
  const nelProgetto = await chiedi(banco, "POST", `/api/progetti/${idProgetto}/impostazioni`, { stile: "didattico" });
  assert.equal(nelProgetto.stato, 200);
  const didattico = STILI_DI_SHINKA.find((stile) => stile.id === "didattico");
  assert.deepEqual((nelProgetto.dati.impostazioni as { stile?: unknown }).stile, { id: "didattico", nome: "Didattico", istruzioni: didattico?.istruzioni });
  assert.equal(banco.conversazioniLocali[0]?.impostazioni.at(-1)?.stile?.id, "didattico");

  // Tolto dall'elenco, chi lo usava se lo tiene finché non ne sceglie un altro.
  assert.equal((await chiedi(banco, "DELETE", `/api/stili/${pirata.id}`)).stato, 200);
  assert.equal((await chiedi(banco, "DELETE", "/api/stili/conciso")).stato, 404);
});
