import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { Applicazioni, sondaVera } from "../nodo/applicazioni.ts";
import { allestisci, avviaNodoAccettato, ID_NODO, type Banco } from "../prove/banco.ts";
import { TramiteAnteprima } from "../nodo/anteprima.ts";
import { Anteprime } from "./anteprima.ts";
import { ApplicazioniDeiProgetti } from "./applicazioni.ts";
import { COOKIE_SESSIONE } from "./centro.ts";

const SALTA = process.platform === "win32" && "su Windows il comando passa da PowerShell";

/** Un server minimo che ascolta sulla porta che gli dà Shinka, in primo piano. */
const SERVER = "const s=require('node:http').createServer((q,r)=>r.end('ricette'));s.listen(Number(process.env.PORT),'127.0.0.1',()=>console.log('pronto su '+process.env.PORT));";

async function portaLibera(): Promise<number> {
  const server = createServer();
  await new Promise<void>((fatto) => server.listen(0, "127.0.0.1", fatto));
  const { port } = server.address() as { port: number };
  await new Promise((fatto) => server.close(fatto));
  return port;
}

async function conProgetto(t: TestContext, banco: Banco, idAmbiente = "centro") {
  const progetto = await banco.lavori.crea("Ricettario", idAmbiente, "Un'app per le ricette.");
  await writeFile(join(progetto.cartella, "server.js"), SERVER);
  const porta = await portaLibera();
  const cookies = { [COOKIE_SESSIONE]: await banco.entra() };
  const chiama = async (metodo: "GET" | "PUT" | "POST", percorso: string, payload?: Record<string, unknown>) => {
    const risposta = await banco.centro.inject({ method: metodo, url: `/api/progetti/${progetto.id}/applicazione${percorso}`, cookies, ...(payload === undefined ? {} : { payload }) });
    return { stato: risposta.statusCode, dati: risposta.json() as Record<string, unknown> };
  };
  // Alla fine le applicazioni rimaste accese le spegne il banco, come il centro quando si spegne.
  return { progetto, porta, chiama };
}

test("dal pulsante il proprietario imposta, avvia e ferma l'applicazione; avviandola si apre anche l'anteprima", { skip: SALTA }, async (t) => {
  const banco = await allestisci(t);
  const { progetto, porta, chiama } = await conProgetto(t, banco);

  assert.deepEqual((await chiama("GET", "")).dati, { voluta: false });
  assert.equal((await chiama("POST", "/avvia")).stato, 409);
  assert.equal((await chiama("PUT", "", { comando: "node server.js\nrm -rf /", porta })).stato, 400);
  assert.equal((await chiama("PUT", "", { comando: "node server.js", porta, percorso: "/ricette" })).stato, 200);
  assert.partialDeepStrictEqual((await chiama("GET", "")).dati, { avvio: { comando: "node server.js", porta, percorso: "/ricette" }, voluta: false, stato: { condizione: "ferma" } });

  const avviata = await chiama("POST", "/avvia");
  assert.equal(avviata.stato, 200, JSON.stringify(avviata.dati));
  assert.partialDeepStrictEqual(avviata.dati, { stato: { condizione: "attiva" } });
  assert.equal(await sondaVera(porta), true);
  assert.deepEqual(banco.anteprime.stato().aperta, { idProgetto: progetto.id, porta, percorso: "/ricette" });
  assert.equal(banco.progetti.applicazione(progetto.id).voluta, true);
  // Di nuovo: la stessa, non una seconda.
  assert.partialDeepStrictEqual((await chiama("POST", "/avvia")).dati, { stato: { condizione: "attiva" } });

  const fermata = await chiama("POST", "/ferma");
  assert.partialDeepStrictEqual(fermata.dati, { stato: { condizione: "ferma" } });
  assert.equal(await sondaVera(porta), false);
  assert.equal(banco.anteprime.stato().aperta, undefined);
  assert.equal(banco.progetti.applicazione(progetto.id).voluta, false);
  assert.equal((await chiama("POST", "/ferma")).stato, 200);
});

test("un avvio che fallisce mostra il motivo e le ultime righe, e non apre l'anteprima", { skip: SALTA }, async (t) => {
  const banco = await allestisci(t);
  const { porta, chiama } = await conProgetto(t, banco);
  await chiama("PUT", "", { comando: "echo 'Cannot find module vite' >&2; exit 1", porta });
  const fallita = await chiama("POST", "/avvia");
  assert.partialDeepStrictEqual(fallita.dati, { stato: { condizione: "fallita", righe: ["Cannot find module vite"] } });
  assert.match(String((fallita.dati.stato as { motivo?: string }).motivo), /codice 1/);
  assert.equal(banco.anteprime.stato().aperta, undefined);
});

test("dopo un riavvio l'applicazione voluta riparte da sola, e l'anteprima aperta si ritrova", { skip: SALTA }, async (t) => {
  const dati = await mkdtemp(join(tmpdir(), "shinka-riavvio-"));
  t.after(() => rm(dati, { recursive: true, force: true }));
  const banco = await allestisci(t, { fileAnteprima: join(dati, "anteprima.json") });
  const { progetto, porta, chiama } = await conProgetto(t, banco);
  await chiama("PUT", "", { comando: "node server.js", porta });

  // Prima del riavvio: avviata, con l'anteprima aperta.
  const primaDelRiavvio: Applicazioni[] = [];
  const primoCentro = new ApplicazioniDeiProgetti({
    progetti: banco.progetti,
    ambienti: banco.ambienti,
    locale: (riferisci) => {
      const qui = new Applicazioni(riferisci, { passoMs: 100 });
      primaDelRiavvio.push(qui);
      return qui;
    },
  });
  t.after(() => primaDelRiavvio.forEach((qui) => qui.spegniTutte()));
  assert.partialDeepStrictEqual(await primoCentro.avvia(progetto.id), { stato: { condizione: "attiva" } });
  await banco.anteprime.apri(progetto.id, porta, "/");
  // Il centro si spegne, e con lui l'applicazione: resta voluta.
  primaDelRiavvio.forEach((qui) => qui.spegniTutte());
  for (let volta = 0; volta < 50 && (await sondaVera(porta)); volta += 1) await new Promise((fatto) => setTimeout(fatto, 100));
  assert.equal(await sondaVera(porta), false);
  assert.equal(banco.progetti.applicazione(progetto.id).voluta, true);

  // Il centro riparte: l'applicazione voluta riparte, e l'anteprima è quella di prima.
  const locali: Applicazioni[] = [];
  const nuovoCentro = new ApplicazioniDeiProgetti({
    progetti: banco.progetti,
    ambienti: banco.ambienti,
    locale: (riferisci) => {
      const qui = new Applicazioni(riferisci, { passoMs: 100 });
      locali.push(qui);
      return qui;
    },
  });
  t.after(() => locali.forEach((qui) => qui.spegniTutte()));
  await nuovoCentro.ripristina("centro");
  assert.equal(await sondaVera(porta), true);
  const anteprimeDopo = new Anteprime({ progetti: banco.progetti, ambienti: banco.ambienti, locale: (riferisci) => new TramiteAnteprima(riferisci), porta: 7852, file: join(dati, "anteprima.json") });
  assert.deepEqual(anteprimeDopo.stato().aperta, { idProgetto: progetto.id, porta, percorso: "/" });
});

test("gli agenti usano lo stesso meccanismo: il progetto imposta e avvia, la Home indica il progetto per nome", { skip: SALTA }, async (t) => {
  const banco = await allestisci(t);
  const { progetto, porta } = await conProgetto(t, banco);

  const impostata = await banco.comuniDelProgetto(progetto.id, "imposta_anteprima", { comando: "node server.js", porta });
  assert.equal(impostata.errore, undefined, impostata.testo);
  const avviata = await banco.comuniDelProgetto(progetto.id, "avvia_anteprima", {});
  assert.match(avviata.testo, /è attiva \(porta \d+\)\..*proponigli l'anteprima/s);
  // Dall'agente l'anteprima non si apre: la apre il proprietario.
  assert.equal(banco.anteprime.stato().aperta, undefined);

  const dallaHome = await banco.comuniDellaHome("stato_anteprima", { progetto: "ricettario" });
  assert.match(dallaHome.testo, /L'applicazione di «Ricettario» è attiva/);
  assert.match(dallaHome.testo, /pronto su \d+/);
  assert.equal((await banco.comuniDellaHome("stato_anteprima", {})).errore, true);
  assert.match((await banco.comuniDellaHome("avvia_anteprima", { progetto: "Altro" })).testo, /Non trovo un progetto/);
  // Come si avvia lo dice solo il progetto.
  assert.equal((await banco.comuniDellaHome("imposta_anteprima", { progetto: "Ricettario", comando: "x", porta: 1 })).errore, true);

  const fermata = await banco.comuniDellaHome("ferma_anteprima", { progetto: "Ricettario" });
  assert.match(fermata.testo, /è ferma/);
  assert.equal(await sondaVera(porta), false);
});

test("in un altro ambiente l'applicazione passa dal suo nodo, e ripristinarla non ne avvia una seconda", { skip: SALTA }, async (t) => {
  const banco = await allestisci(t);
  await avviaNodoAccettato(t, banco, { applicazioni: { passoMs: 100, attesaAvvioMs: 10_000 } });
  const { progetto, porta, chiama } = await conProgetto(t, banco, ID_NODO);
  await chiama("PUT", "", { comando: "node server.js", porta });
  assert.partialDeepStrictEqual((await chiama("POST", "/avvia")).dati, { stato: { condizione: "attiva" } });
  assert.equal(await sondaVera(porta), true);
  // Ripristinare un'applicazione già accesa non ne avvia una seconda.
  await banco.applicazioni.ripristina(ID_NODO);
  assert.partialDeepStrictEqual((await chiama("GET", "")).dati, { voluta: true, stato: { condizione: "attiva" } });
});
