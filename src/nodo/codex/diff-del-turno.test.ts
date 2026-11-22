import assert from "node:assert/strict";
import { test } from "node:test";
import { fileToccato, leggiDiffDelTurno, versionePrima } from "./diff-del-turno.ts";

/** Il diff di un turno come lo ha mandato l'app-server vero di Codex 0.170.0. */
const VERO =
  "diff --git a/a.txt b/a.txt\nindex fb85c0a2eacf48a66ef1b6802bbaacfd179e1181..0bceacc966f3ed03ef3c39ed94bbef7458162f5a\n--- a/a.txt\n+++ b/a.txt\n@@ -1,3 +1,3 @@\n uno\n-due\n+DUE\n tre\n" +
  "diff --git a/b.txt b/b.txt\nnew file mode 100644\nindex 0000000000000000000000000000000000000000..b31b0b130d568d7e685646a4c191c5b7d11d49ea\n--- /dev/null\n+++ b/b.txt\n@@ -0,0 +1 @@\n+nuovo\n";

test("il diff vero di Codex: un file cambiato e uno nuovo, con la versione di prima di ciascuno", () => {
  const file = leggiDiffDelTurno(VERO);
  assert.deepEqual(
    file.map((voce) => [voce.percorso, voce.nuovo, voce.tolto]),
    [
      ["a.txt", false, false],
      ["b.txt", true, false],
    ],
  );
  assert.equal(versionePrima("uno\nDUE\ntre\n", file[0]!), "uno\ndue\ntre\n");
  assert.equal(versionePrima("nuovo\n", file[1]!), null);
});

test("più pezzi in un file lungo, con righe aggiunte e tolte", () => {
  const prima = Array.from({ length: 30 }, (_, i) => `riga ${i + 1}`);
  const dopo = [...prima];
  dopo.splice(2, 1, "riga tre", "riga tre e mezzo");
  dopo.splice(26, 2);
  const diff = [
    "diff --git a/lungo.txt b/lungo.txt",
    "--- a/lungo.txt",
    "+++ b/lungo.txt",
    "@@ -1,5 +1,6 @@",
    " riga 1",
    " riga 2",
    "-riga 3",
    "+riga tre",
    "+riga tre e mezzo",
    " riga 4",
    " riga 5",
    "@@ -24,7 +25,5 @@",
    " riga 24",
    " riga 25",
    "-riga 26",
    "-riga 27",
    " riga 28",
    " riga 29",
    " riga 30",
    "",
  ].join("\n");
  const [voce] = leggiDiffDelTurno(diff);
  assert.ok(voce !== undefined);
  assert.equal(versionePrima(`${dopo.join("\n")}\n`, voce), `${prima.join("\n")}\n`);
});

test("un file tolto torna con il suo testo; l'a capo finale che manca si rispetta", () => {
  const [tolto] = leggiDiffDelTurno("diff --git a/x.txt b/x.txt\ndeleted file mode 100644\n--- a/x.txt\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-uno\n-due\n\\ No newline at end of file\n");
  assert.ok(tolto !== undefined);
  assert.equal(tolto.tolto, true);
  assert.equal(versionePrima(null, tolto), "uno\ndue");
  // Prima senza a capo finale, adesso con.
  const [aCapo] = leggiDiffDelTurno("diff --git a/y.txt b/y.txt\n--- a/y.txt\n+++ b/y.txt\n@@ -1 +1 @@\n-ciao\n\\ No newline at end of file\n+ciao\n");
  assert.ok(aCapo !== undefined);
  assert.equal(versionePrima("ciao\n", aCapo), "ciao");
});

test("se il file non torna con il diff, la versione di prima non si inventa", () => {
  const [voce] = leggiDiffDelTurno(VERO);
  assert.ok(voce !== undefined);
  assert.equal(versionePrima("uno\nALTRO\ntre\n", voce), undefined);
  assert.equal(versionePrima(null, voce), undefined);
  const nuovo = leggiDiffDelTurno(VERO)[1];
  assert.ok(nuovo !== undefined);
  assert.equal(versionePrima(null, nuovo), undefined);
});

test("il file del disco si trova tra quelli toccati; se il nome è ambiguo, no", () => {
  const toccati = ["/progetto/src/a.txt", "/progetto/b.txt"];
  assert.equal(fileToccato("src/a.txt", toccati), "/progetto/src/a.txt");
  assert.equal(fileToccato("b.txt", toccati), "/progetto/b.txt");
  assert.equal(fileToccato("c.txt", toccati), undefined);
  assert.equal(fileToccato("a.txt", ["/uno/a.txt", "/due/a.txt"]), undefined);
});
