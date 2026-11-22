import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import type { Archiviazione, Uso } from "../protocollo/uso.ts";
import { allestisci, finche, type Banco } from "../prove/banco.ts";
import { COOKIE_SESSIONE } from "./centro.ts";
import { contaUso, giornoDi } from "./uso.ts";

async function chiedi(banco: Banco, method: "GET" | "POST" | "DELETE", url: string, payload?: Record<string, unknown>) {
  return banco.centro.inject({ method, url, cookies: { [COOKIE_SESSIONE]: await banco.entra() }, ...(payload === undefined ? {} : { payload }) });
}

test("un progetto si rinomina, si fissa in cima e si elimina; la cartella resta, il progetto Shinka no", async (t) => {
  const banco = await allestisci(t);
  const progetto = await banco.lavori.crea("Videogioco", "centro", "Un gioco.");
  await finche(() => banco.conversazioniLocali.length === 1, "il progetto apre la sua conversazione");
  banco.conversazioniLocali[0]?.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 1 });

  assert.equal((await chiedi(banco, "POST", `/api/progetti/${progetto.id}/nome`, { nome: "  Gioco   di salti " })).statusCode, 200);
  assert.equal(banco.progetti.trova(progetto.id)?.nome, "Gioco di salti");
  assert.equal((await chiedi(banco, "POST", `/api/progetti/${progetto.id}/nome`, { nome: "   " })).statusCode, 400);
  assert.equal((await chiedi(banco, "POST", `/api/progetti/${progetto.id}/fissato`, { fissato: true })).statusCode, 200);
  assert.equal(banco.lavori.stato().progetti[0]?.fissato, true);
  await chiedi(banco, "POST", `/api/progetti/${progetto.id}/fissato`, { fissato: false });
  assert.equal(banco.lavori.stato().progetti[0]?.fissato, undefined);

  const archivio = banco.lavori.archivioDelProgetto(progetto.id);
  assert.equal(existsSync(archivio), true);
  // Le modifiche dei suoi turni, con le fotografie dei file, se ne vanno con lui.
  const modifiche = join(banco.cartella, "modifiche", progetto.id);
  await mkdir(join(modifiche, "fotografie"), { recursive: true });
  await writeFile(join(modifiche, "turno.json"), "{}");
  assert.equal((await chiedi(banco, "DELETE", `/api/progetti/${progetto.id}`)).statusCode, 200);
  assert.equal(existsSync(modifiche), false);
  assert.equal(banco.progetti.trova(progetto.id), undefined);
  assert.equal(banco.conversazioniLocali[0]?.chiusa, true);
  assert.equal(existsSync(archivio), false);
  assert.equal(existsSync(progetto.cartella), true);
  assert.equal((await chiedi(banco, "DELETE", `/api/progetti/${progetto.id}`)).statusCode, 404);
});

test("un argomento archiviato si elimina con la sua cartella; quello aperto no", async (t) => {
  const banco = await allestisci(t);
  const primo = banco.casa.idArgomentoAperto;
  banco.casa.invia("Scrivi una lista.");
  banco.home.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 1 });
  await mkdir(banco.casa.cartellaAperta, { recursive: true });
  await writeFile(join(banco.casa.cartellaAperta, "lista.md"), "- pane\n");
  assert.equal(await banco.casa.nuovoArgomento(), undefined);
  banco.casa.richiediCambio({ titolo: "La lista", riassunto: "" });
  banco.home.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 1 });
  await finche(() => banco.casa.idArgomentoAperto !== primo, "si passa all'argomento nuovo");

  const spazio = (await chiedi(banco, "GET", "/api/archiviazione")).json() as Archiviazione;
  const voce = spazio.voci.find((uno) => uno.id === primo);
  assert.equal(voce?.eliminabile, true);
  assert.equal(voce?.byteFile, 7);
  assert.ok((voce?.byteStoria ?? 0) > 0);
  assert.equal(spazio.voci.find((uno) => uno.id === banco.casa.idArgomentoAperto)?.eliminabile, false);

  const cartella = banco.casa.cartellaDellArgomento(primo);
  assert.equal((await chiedi(banco, "DELETE", `/api/argomenti/${banco.casa.idArgomentoAperto}`)).statusCode, 409);
  assert.equal((await chiedi(banco, "DELETE", `/api/argomenti/${primo}`)).statusCode, 200);
  assert.deepEqual(banco.argomenti.archiviati(), []);
  assert.equal(existsSync(cartella), false);
});

test("l'uso conta i token dei turni per giorno e per conversazione, dalla più costosa", async (t) => {
  const adesso = new Date(2026, 10, 18, 15);
  const ieri = new Date(2026, 10, 17, 9).toISOString();
  const oggi = adesso.toISOString();
  const vecchio = new Date(2026, 9, 1).toISOString();
  const turno = (quando: string, ingresso: number, uscita: number) => ({ n: 1, quando, evento: { tipo: "turno-concluso" as const, riuscito: true, durataMs: 1, token: { ingresso, uscita } } });
  const uso = contaUso(
    [
      { genere: "home", id: "a1", nome: "Home", storia: [turno(ieri, 100, 10), turno(oggi, 50, 5), turno(vecchio, 999, 999)] },
      { genere: "progetto", id: "p1", nome: "Gioco", storia: [turno(oggi, 1000, 100), { n: 2, quando: oggi, evento: { tipo: "turno-concluso", riuscito: true, durataMs: 1 } }] },
      { genere: "progetto", id: "p2", nome: "Fermo", storia: [] },
    ],
    3,
    adesso,
  );
  assert.deepEqual(uso.giorni, [
    { giorno: "2026-11-16", ingresso: 0, uscita: 0, turni: 0 },
    { giorno: "2026-11-17", ingresso: 100, uscita: 10, turni: 1 },
    { giorno: giornoDi(adesso), ingresso: 1050, uscita: 105, turni: 2 },
  ]);
  assert.deepEqual(uso.conversazioni.map((voce) => [voce.nome, voce.turni, voce.ingresso + voce.uscita]), [
    ["Gioco", 1, 1100],
    ["Home", 2, 165],
  ]);

  // Dal centro: la Home con un turno che ha i suoi token.
  const banco = await allestisci(t);
  banco.casa.invia("Ciao");
  banco.home.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 1, token: { ingresso: 2000, uscita: 300 } });
  const dalCentro = (await chiedi(banco, "GET", "/api/uso")).json() as Uso;
  assert.equal(dalCentro.giorni.length, 14);
  assert.deepEqual(dalCentro.giorni.at(-1), { giorno: giornoDi(new Date()), ingresso: 2000, uscita: 300, turni: 1 });
  assert.equal(dalCentro.conversazioni[0]?.nome, "Home, argomento aperto");
});
