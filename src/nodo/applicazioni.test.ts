import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import type { RiferitoApplicazione } from "../protocollo/applicazioni.ts";
import { Applicazioni, sondaVera } from "./applicazioni.ts";

const SU_WINDOWS = process.platform === "win32";

/** Una porta libera di questa macchina. */
async function portaLibera(): Promise<number> {
  const server = createServer();
  await new Promise<void>((fatto) => server.listen(0, "127.0.0.1", fatto));
  const { port } = server.address() as { port: number };
  await new Promise((fatto) => server.close(fatto));
  return port;
}

async function cartella(t: TestContext): Promise<string> {
  const dove = await mkdtemp(join(tmpdir(), "shinka-applicazione-"));
  // Un server minimo che ascolta sulla porta che gli dà Shinka, in primo piano.
  await writeFile(
    join(dove, "server.js"),
    "const s=require('node:http').createServer((q,r)=>r.end('ciao'));s.listen(Number(process.env.PORT),'127.0.0.1',()=>console.log('in ascolto su '+process.env.PORT));",
  );
  t.after(() => rm(dove, { recursive: true, force: true }));
  return dove;
}

test("l'applicazione si avvia una volta sola, risponde, e si ferma con ciò che ha avviato", { skip: SU_WINDOWS && "su Windows il comando passa da PowerShell" }, async (t) => {
  const dove = await cartella(t);
  const porta = await portaLibera();
  const applicazioni = new Applicazioni(() => {}, { passoMs: 100 });
  t.after(() => applicazioni.spegniTutte());

  const avviata = await applicazioni.avvia("p1", dove, "node server.js", porta);
  assert.equal(avviata.condizione, "attiva", JSON.stringify(avviata));
  assert.equal(await sondaVera(porta), true);
  // Di nuovo: nessuna seconda copia, la stessa che risponde.
  assert.equal((await applicazioni.avvia("p1", dove, "node server.js", porta)).condizione, "attiva");
  const stato = await applicazioni.stato("p1", porta);
  assert.equal(stato.condizione, "attiva");
  assert.match(stato.righe.join("\n"), new RegExp(`in ascolto su ${porta}`));

  const fermata = await applicazioni.ferma("p1");
  assert.equal(fermata.condizione, "ferma");
  assert.equal(await sondaVera(porta), false);
  // Ferma di nuovo: non è un errore.
  assert.equal((await applicazioni.ferma("p1")).condizione, "ferma");
  assert.equal((await applicazioni.stato("p1", porta)).condizione, "ferma");
});

test("un comando che fallisce o finisce da solo lo dice con le sue ultime righe", { skip: SU_WINDOWS && "su Windows il comando passa da PowerShell" }, async (t) => {
  const dove = await cartella(t);
  const porta = await portaLibera();
  const applicazioni = new Applicazioni(() => {}, { passoMs: 100 });
  const fallita = await applicazioni.avvia("p1", dove, "echo 'Error: manca il modulo vite' >&2; exit 3", porta);
  assert.equal(fallita.condizione, "fallita");
  assert.match(fallita.motivo ?? "", /codice 3/);
  assert.deepEqual(fallita.righe, ["Error: manca il modulo vite"]);
  // Dopo un fallimento si può riprovare, con un altro comando.
  const finita = await applicazioni.avvia("p1", dove, "echo avviato in background", porta);
  assert.equal(finita.condizione, "fallita");
  assert.match(finita.motivo ?? "", /primo piano/);
  assert.equal((await applicazioni.avvia("p2", join(dove, "non-esiste"), "node server.js", porta)).motivo, `La cartella del progetto ${join(dove, "non-esiste")} non c'è.`);
});

test("se sulla porta risponde già qualcos'altro non ne avvia una seconda; uno che non risponde in tempo è in avvio", { skip: SU_WINDOWS && "su Windows il comando passa da PowerShell" }, async (t) => {
  const dove = await cartella(t);
  const porta = await portaLibera();
  const altro = createServer();
  await new Promise<void>((fatto) => altro.listen(porta, "127.0.0.1", fatto));
  t.after(() => new Promise((fatto) => altro.close(fatto)));
  const riferiti: RiferitoApplicazione[] = [];
  const applicazioni = new Applicazioni((messaggio) => riferiti.push(messaggio), { passoMs: 100, attesaAvvioMs: 600 });
  t.after(() => applicazioni.spegniTutte());
  applicazioni.esegui({ tipo: "applicazione-avvia", idRichiesta: "r1", idApplicazione: "p1", cartella: dove, comando: "node server.js", porta });
  await new Promise((fatto) => setTimeout(fatto, 400));
  assert.equal(riferiti[0]?.idRichiesta, "r1");
  assert.equal(riferiti[0]?.stato.condizione, "fuori-da-shinka");
  assert.equal((await applicazioni.stato("p1", porta)).condizione, "fuori-da-shinka");

  const lenta = await applicazioni.avvia("p2", dove, "sleep 30", await portaLibera());
  assert.equal(lenta.condizione, "in-avvio");
  assert.equal((await applicazioni.ferma("p2")).condizione, "ferma");
});
