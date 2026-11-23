import assert from "node:assert/strict";
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import type { EventoArchiviato } from "../protocollo/eventi.ts";
import { Canale, PEZZO_MASSIMO } from "./canale.ts";
import { fileDellaVersione, indiceSenzaAprire, leggiIndiceSalvato } from "./indice-archivio.ts";

async function archivioProvvisorio(t: TestContext): Promise<string> {
  const cartella = await mkdtemp(join(tmpdir(), "shinka-versione-"));
  t.after(() => rm(cartella, { recursive: true, force: true }));
  return join(cartella, "conversazioni", "p.jsonl");
}

function messaggi(canale: Canale, quanti: number, da = 1): void {
  for (let i = da; i < da + quanti; i++) canale.pubblica({ tipo: "messaggio-proprietario", id: `m${i}`, testo: `messaggio ${i}` });
}

test("la versione resta la stessa finché si aggiunge in fondo, anche dopo una riapertura", async (t) => {
  const file = await archivioProvvisorio(t);
  const canale = await Canale.apri(file);
  const prima = canale.indice;
  assert.equal(prima.ultimo, 0);
  assert.match(prima.versione, /^[\w-]{12}$/);

  messaggi(canale, 3);
  // Un evento passeggero non conta.
  canale.pubblica({ tipo: "testo-frammento", idTesto: "t", frammento: "ciao" });
  assert.deepEqual(canale.indice, { ultimo: 3, versione: prima.versione });
  assert.deepEqual(leggiIndiceSalvato(file), { ultimo: 3, versione: prima.versione, byte: readFileSync(file).length });

  const riaperto = await Canale.apri(file);
  assert.deepEqual(riaperto.indice, { ultimo: 3, versione: prima.versione });
  assert.deepEqual(indiceSenzaAprire(file), riaperto.indice);
});

test("un taglio cambia la versione", async (t) => {
  const file = await archivioProvvisorio(t);
  const canale = await Canale.apri(file);
  messaggi(canale, 5);
  const prima = canale.indice.versione;
  canale.taglia(4);
  assert.equal(canale.indice.ultimo, 3);
  assert.notEqual(canale.indice.versione, prima);
  assert.deepEqual(indiceSenzaAprire(file), canale.indice);
  assert.deepEqual((await Canale.apri(file)).indice, canale.indice);
});

test("una riga spezzata o persa cambia la versione, e l'archivio si riscrive con i numeri giusti una volta sola", async (t) => {
  const file = await archivioProvvisorio(t);
  const canale = await Canale.apri(file);
  messaggi(canale, 3);
  const versione = canale.indice.versione;

  // Uno spegnimento brusco a metà di una riga.
  appendFileSync(file, '{"n":4,"quando":"2026');
  const dopoLoSpegnimento = await Canale.apri(file);
  assert.equal(dopoLoSpegnimento.indice.ultimo, 3);
  assert.notEqual(dopoLoSpegnimento.indice.versione, versione);
  assert.ok(readFileSync(file, "utf8").endsWith("}\n"));
  messaggi(dopoLoSpegnimento, 1, 4);
  assert.deepEqual(readFileSync(file, "utf8").trim().split("\n").map((riga) => (JSON.parse(riga) as EventoArchiviato).n), [1, 2, 3, 4]);

  // Una riga persa in mezzo: i numeri dopo di lei cambiano.
  const righe = readFileSync(file, "utf8").split("\n");
  righe[1] = "riga rovinata";
  writeFileSync(file, righe.join("\n"));
  const rinumerato = await Canale.apri(file);
  assert.equal(rinumerato.indice.ultimo, 3);
  assert.notEqual(rinumerato.indice.versione, dopoLoSpegnimento.indice.versione);
  assert.deepEqual(readFileSync(file, "utf8").trim().split("\n").map((riga) => (JSON.parse(riga) as EventoArchiviato).n), [1, 2, 3]);
  // Riaperto ancora, è in ordine: la versione non cambia più.
  assert.deepEqual((await Canale.apri(file)).indice, rinumerato.indice);
});

test("senza il file della versione, come dopo un ripristino, la versione è nuova", async (t) => {
  const file = await archivioProvvisorio(t);
  const canale = await Canale.apri(file);
  messaggi(canale, 2);
  const versione = canale.indice.versione;
  rmSync(fileDellaVersione(file));
  const ripristinato = indiceSenzaAprire(file);
  assert.equal(ripristinato.ultimo, 2);
  assert.notEqual(ripristinato.versione, versione);
  assert.ok(existsSync(fileDellaVersione(file)));
  assert.deepEqual((await Canale.apri(file)).indice, ripristinato);
});

test("senza aprirlo: se l'archivio è cresciuto dopo l'ultimo file della versione, si ricontano gli eventi con la stessa versione", async (t) => {
  const file = await archivioProvvisorio(t);
  const canale = await Canale.apri(file);
  messaggi(canale, 2);
  const salvato = leggiIndiceSalvato(file);
  messaggi(canale, 1, 3);
  // Uno spegnimento tra l'aggiunta e il file della versione.
  writeFileSync(fileDellaVersione(file), JSON.stringify(salvato));
  assert.deepEqual(indiceSenzaAprire(file), { ultimo: 3, versione: canale.indice.versione });
  // Un archivio che non c'è ancora: nessun evento.
  assert.deepEqual(indiceSenzaAprire(join(file, "..", "nuovo.jsonl")), { ultimo: 0, versione: "vuoto" });
  assert.equal(existsSync(fileDellaVersione(join(file, "..", "nuovo.jsonl"))), false);
});

test("la storia da un punto: in ordine, a pezzi, leggera, e dall'inizio se la versione non è quella", async (t) => {
  const file = await archivioProvvisorio(t);
  const canale = await Canale.apri(file);
  messaggi(canale, 4);
  canale.pubblica({ tipo: "azione-iniziata", idAzione: "a1", strumento: "Bash", ingresso: { command: "x".repeat(500) } });
  canale.pubblica({ tipo: "azione-conclusa", idAzione: "a1", esito: "y".repeat(500), errore: false });
  canale.pubblica({ tipo: "stato", stato: { modello: "claude-opus-5-5" } });
  const { versione } = canale.indice;

  const tutto = canale.storiaDopo({});
  assert.deepEqual(tutto.eventi.map((e) => e.n), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual([tutto.ultimo, tutto.versione, tutto.altri, tutto.daCapo], [6, versione, false, false]);
  // Leggera: l'azione conclusa ha solo il riassunto, anche se la si chiede dopo la sua conclusione.
  assert.equal(tutto.eventi[4]?.evento.tipo === "azione-iniziata" && tutto.eventi[4].evento.accorciato, true);

  const pezzo = canale.storiaDopo({ dopo: 2, limite: 2, versione });
  assert.deepEqual(pezzo.eventi.map((e) => e.n), [3, 4]);
  assert.equal(pezzo.altri, true);
  const resto = canale.storiaDopo({ dopo: 4, versione });
  assert.deepEqual(resto.eventi.map((e) => e.n), [5, 6]);
  assert.equal(resto.altri, false);
  assert.deepEqual(canale.storiaDopo({ dopo: 6, versione }).eventi, []);

  const altraVersione = canale.storiaDopo({ dopo: 4, versione: "vecchia" });
  assert.deepEqual([altraVersione.daCapo, altraVersione.eventi[0]?.n], [true, 1]);
  const oltre = canale.storiaDopo({ dopo: 9, versione });
  assert.deepEqual([oltre.daCapo, oltre.eventi.length], [true, 6]);
  assert.equal(canale.storiaDopo({ limite: 10_000 }).eventi.length, 6);
  assert.ok(PEZZO_MASSIMO >= 100);

  // Chiedere la storia non conta come pagina che segue la conversazione.
  assert.equal(canale.seguito, false);
});

test("iscriversi da un punto manda solo gli eventi archiviati dopo, poi i ricordati e quelli nuovi", async (t) => {
  const file = await archivioProvvisorio(t);
  const canale = await Canale.apri(file);
  messaggi(canale, 3);
  canale.pubblica({ tipo: "stato", stato: { modello: "claude-opus-5-5" } });
  const { versione } = canale.indice;
  assert.equal(canale.riprendibile(3, versione), true);
  assert.equal(canale.riprendibile(2, versione), true);
  assert.equal(canale.riprendibile(4, versione), false);
  assert.equal(canale.riprendibile(3, "altra"), false);

  const ricevuti: EventoArchiviato[] = [];
  canale.iscrivi((evento) => ricevuti.push(evento), 3);
  messaggi(canale, 1, 4);
  assert.deepEqual(ricevuti.map((e) => [e.n, e.evento.tipo]), [
    [0, "stato"],
    [4, "messaggio-proprietario"],
  ]);
});
