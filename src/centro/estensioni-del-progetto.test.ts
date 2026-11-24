/**
 * Le estensioni di un progetto si cambiano anche a progetto avviato: la conversazione riparte con
 * quelle nuove appena è ferma, e un modello locale spento per il progetto non si offre.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { StatoEstensioniDelProgetto } from "../protocollo/progetti.ts";
import { soloIModelliScelti, type FonteModelliLocali } from "../nodo/modelli-locali.ts";
import { allestisci, finche, type Banco } from "../prove/banco.ts";
import { COOKIE_SESSIONE } from "./centro.ts";

async function chiedi(banco: Banco, method: "GET" | "PUT", url: string, payload?: Record<string, unknown>) {
  return banco.centro.inject({ method, url, cookies: { [COOKIE_SESSIONE]: await banco.entra() }, ...(payload === undefined ? {} : { payload }) });
}

test("le estensioni di un progetto avviato si cambiano, e la conversazione riparte con quelle nuove", async (t) => {
  const banco = await allestisci(t, { estensioni: {} });
  const estensioni = banco.estensioni;
  assert.ok(estensioni !== undefined);
  for (const nome of ["meteo", "mappe"]) {
    const proposta = await estensioni.proponi({ nome, descrizione: `Fa ${nome}.`, idAmbiente: "centro", definizione: { tipo: "mcp-locale", comando: "node", argomenti: [`${nome}.js`], variabili: {} }, chiavi: [] });
    assert.ok("idProposta" in proposta);
    assert.equal((await estensioni.conferma(proposta.idProposta))?.stato, "accesa");
  }
  const progetto = await banco.lavori.crea("Viaggio", "centro", "Organizza un viaggio.");
  await finche(() => banco.conversazioniLocali.length === 1, "il progetto apre la sua conversazione");
  const prima = banco.conversazioniLocali[0];
  assert.ok(prima !== undefined);

  const letto = (await chiedi(banco, "GET", `/api/progetti/${progetto.id}/estensioni`)).json() as StatoEstensioniDelProgetto;
  assert.deepEqual(letto.voci.map((voce) => [voce.nome, voce.tipo]), [["mappe", "Server MCP locale"], ["meteo", "Server MCP locale"]]);
  assert.equal(letto.scelte, undefined);

  // Mentre lavora non si tocca: riparte alla fine del turno.
  const durante = await chiedi(banco, "PUT", `/api/progetti/${progetto.id}/estensioni`, { scelte: ["mappe", "sconosciuta"] });
  assert.deepEqual((durante.json() as StatoEstensioniDelProgetto).scelte, ["mappe"]);
  assert.equal(prima.chiusa, false);
  assert.ok(prima.annotazioni.some((nota) => nota.includes("ora ha mappe")));
  prima.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 1 });
  assert.equal(prima.chiusa, true);

  // Il messaggio dopo apre la conversazione con le estensioni nuove.
  banco.lavori.invia(progetto.id, "Andiamo avanti.");
  assert.equal(banco.conversazioniLocali.length, 2);
  const dopo = banco.conversazioniLocali[1];
  assert.deepEqual(Object.keys((await dopo?.configurazione?.estensioni?.server())?.server ?? {}), ["mappe"]);

  // Ferma, si chiude subito; e la nota arriva con il prossimo messaggio.
  dopo?.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 1 });
  await chiedi(banco, "PUT", `/api/progetti/${progetto.id}/estensioni`, { scelte: null });
  assert.equal(dopo?.chiusa, true);
  banco.lavori.invia(progetto.id, "E adesso?");
  const terza = banco.conversazioniLocali[2];
  assert.ok(terza?.annotazioni.some((nota) => nota.includes("tutte quelle accese")));
  assert.deepEqual(Object.keys((await terza?.configurazione?.estensioni?.server())?.server ?? {}).sort(), ["mappe", "meteo"]);
});

test("un modello locale spento per il progetto non si offre e non si prende", () => {
  const presi: string[] = [];
  const tutti: FonteModelliLocali = {
    modelli: () => [
      { valore: "locale:qwen", nome: "qwen (locale)", descrizione: "" },
      { valore: "locale:altro", nome: "altro (locale)", descrizione: "" },
    ],
    prendi: (modello) => (presi.push(modello), { motivo: "preso" }),
  };
  let scelte: readonly string[] | undefined = ["meteo", "qwen"];
  const delProgetto = soloIModelliScelti(tutti, () => scelte);
  assert.deepEqual(delProgetto.modelli().map((voce) => voce.valore), ["locale:qwen"]);
  assert.match((delProgetto.prendi("locale:altro") as { motivo: string }).motivo, /non è tra le estensioni scelte/);
  delProgetto.prendi("locale:qwen");
  assert.deepEqual(presi, ["locale:qwen"]);
  scelte = undefined;
  assert.equal(delProgetto.modelli().length, 2);
});
