import assert from "node:assert/strict";
import { test } from "node:test";
import { blocchi, confronta, conta, righeDi } from "./differenze.ts";

/** Rifà il testo di dopo dalle righe del confronto: deve tornare quello. */
function ricostruisci(prima: string, dopo: string): { dopo: string[]; prima: string[] } {
  const righe = confronta(prima, dopo);
  return {
    prima: righe.flatMap((riga) => (riga.tipo === "aggiunta" ? [] : [riga.testo])),
    dopo: righe.flatMap((riga) => (riga.tipo === "tolta" ? [] : [riga.testo])),
  };
}

test("le righe aggiunte e tolte si contano, e dal confronto tornano i due testi", () => {
  assert.deepEqual(conta("a\nb\nc\n", "a\nB\nc\nd\n"), { aggiunte: 2, tolte: 1 });
  assert.deepEqual(conta("", "uno\ndue"), { aggiunte: 2, tolte: 0 });
  assert.deepEqual(conta("uno\r\ndue\r\n", "uno\ndue\n"), { aggiunte: 0, tolte: 0 });
  assert.deepEqual(conta("x", ""), { aggiunte: 0, tolte: 1 });
  assert.deepEqual(righeDi("a\n"), ["a"]);
  const casi: [string, string][] = [
    ["a\nb\nc\nd\ne\nf", "a\nc\nd\nX\nf\ng"],
    ["1\n2\n3\n4\n5\n6\n7\n8", "8\n7\n6\n5\n4\n3\n2\n1"],
    ["uno\ndue\ntre", "zero\nuno\ndue\ntre\nquattro"],
  ];
  for (const [prima, dopo] of casi) assert.deepEqual(ricostruisci(prima, dopo), { prima: righeDi(prima), dopo: righeDi(dopo) });
  // Il confronto è il più breve: una riga cambiata è una tolta e una aggiunta, non di più.
  assert.deepEqual(conta("a\nb\nc\nd\ne\nf", "a\nc\nd\nX\nf\ng"), { aggiunte: 2, tolte: 2 });
});

test("i numeri di riga sono quelli dei due testi, e i pezzi cambiati hanno tre righe intorno", () => {
  const prima = Array.from({ length: 30 }, (_, i) => `riga ${i + 1}`).join("\n");
  const dopo = prima.replace("riga 5\n", "riga cinque\n").replace("riga 25\n", "");
  const righe = confronta(prima, dopo);
  assert.deepEqual(righe.find((riga) => riga.tipo === "aggiunta"), { tipo: "aggiunta", testo: "riga cinque", dopo: 5 });
  assert.deepEqual(righe.filter((riga) => riga.tipo === "tolta"), [
    { tipo: "tolta", testo: "riga 5", prima: 5 },
    { tipo: "tolta", testo: "riga 25", prima: 25 },
  ]);
  const pezzi = blocchi(righe);
  assert.equal(pezzi.length, 2);
  assert.deepEqual(pezzi[0]?.righe.map((riga) => riga.testo), ["riga 2", "riga 3", "riga 4", "riga 5", "riga cinque", "riga 6", "riga 7", "riga 8"]);
  // Due pezzi vicini diventano uno.
  assert.equal(blocchi(confronta("a\nb\nc\nd\ne", "A\nb\nc\nD\ne")).length, 1);
  assert.deepEqual(blocchi(confronta("uguale", "uguale")), []);
});

test("due testi molto grandi e del tutto diversi si confrontano in fretta", () => {
  const prima = Array.from({ length: 20_000 }, (_, i) => `a${i}`).join("\n");
  const dopo = Array.from({ length: 20_000 }, (_, i) => `b${i}`).join("\n");
  const inizio = Date.now();
  assert.deepEqual(conta(prima, dopo), { aggiunte: 20_000, tolte: 20_000 });
  assert.ok(Date.now() - inizio < 5000);
});

test("su testi a caso il confronto ridà sempre i due testi", () => {
  let seme = 7;
  const caso = () => (seme = (seme * 1103515245 + 12345) % 2147483648) / 2147483648;
  const testo = () => Array.from({ length: Math.floor(caso() * 40) }, () => "abcde"[Math.floor(caso() * 5)]).join("\n");
  for (let volta = 0; volta < 300; volta += 1) {
    const prima = testo();
    const dopo = testo();
    assert.deepEqual(ricostruisci(prima, dopo), { prima: righeDi(prima), dopo: righeDi(dopo) });
  }
});
