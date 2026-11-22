import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { opzioniHarness, type ConfigurazioneConversazione } from "./conversazione.ts";
import { RegistroModifiche } from "./modifiche.ts";

function cartelle(t: { after(fn: () => Promise<void>): void }): { progetto: string; dati: string } {
  const progetto = mkdtempSync(join(tmpdir(), "shinka-modifiche-"));
  const dati = mkdtempSync(join(tmpdir(), "shinka-modifiche-dati-"));
  t.after(async () => {
    await rm(progetto, { recursive: true, force: true });
    await rm(dati, { recursive: true, force: true });
  });
  return { progetto, dati };
}

test("a fine turno restano i file cambiati davvero, con le due versioni, anche dopo un riavvio", async (t) => {
  const { progetto, dati } = cartelle(t);
  writeFileSync(join(progetto, "a.txt"), "uno\ndue\n");
  writeFileSync(join(progetto, "uguale.txt"), "fermo\n");
  const registro = new RegistroModifiche(progetto, dati);
  assert.equal(await registro.chiudiTurno(), undefined);

  const idTurno = registro.apriTurno();
  registro.prima("a.txt");
  registro.prima(join(progetto, "a.txt"));
  registro.prima("nuovo.txt");
  registro.prima("uguale.txt");
  // Claude cambia i file: conta solo la versione di prima della prima modifica.
  writeFileSync(join(progetto, "a.txt"), "uno\nDUE\ntre\n");
  writeFileSync(join(progetto, "nuovo.txt"), "ciao\n");
  const chiuso = await registro.chiudiTurno();
  assert.deepEqual(chiuso, {
    idTurno,
    file: [
      { percorso: "a.txt", aggiunte: 2, tolte: 1, stato: "cambiato" },
      { percorso: "nuovo.txt", aggiunte: 1, tolte: 0, stato: "nuovo" },
    ],
  });

  const riaperto = new RegistroModifiche(progetto, dati);
  assert.deepEqual(await riaperto.versioni(idTurno, "a.txt"), { prima: "uno\ndue\n", dopo: "uno\nDUE\ntre\n" });
  assert.deepEqual(await riaperto.versioni(idTurno, "nuovo.txt"), { prima: null, dopo: "ciao\n" });
  assert.ok("motivo" in (await riaperto.versioni(idTurno, "uguale.txt")));
  assert.ok("motivo" in (await riaperto.versioni("00000000-0000-0000-0000-000000000000", "a.txt")));
});

test("i file tornano com'erano, uno o tutto il turno; non se sono cambiati ancora dopo", async (t) => {
  const { progetto } = cartelle(t);
  writeFileSync(join(progetto, "a.txt"), "prima a\n");
  writeFileSync(join(progetto, "b.txt"), "prima b\n");
  // Senza cartella le modifiche restano in memoria.
  const registro = new RegistroModifiche(progetto);
  const idTurno = registro.apriTurno();
  for (const nome of ["a.txt", "b.txt", "c.txt"]) registro.prima(nome);
  writeFileSync(join(progetto, "a.txt"), "dopo a\n");
  writeFileSync(join(progetto, "b.txt"), "dopo b\n");
  writeFileSync(join(progetto, "c.txt"), "nuovo\n");
  await registro.chiudiTurno();

  assert.deepEqual(await registro.annulla(idTurno, ["a.txt", "inventato.txt"]), {
    annullati: ["a.txt"],
    nonAnnullati: [{ percorso: "inventato.txt", motivo: "non è tra le modifiche del turno" }],
  });
  assert.equal(readFileSync(join(progetto, "a.txt"), "utf8"), "prima a\n");

  // b è cambiato ancora dopo il turno: non si tocca, per non perdere ciò che è venuto dopo.
  writeFileSync(join(progetto, "b.txt"), "dopo b, e poi ancora\n");
  assert.deepEqual(await registro.annulla(idTurno), {
    annullati: ["a.txt", "c.txt"],
    nonAnnullati: [{ percorso: "b.txt", motivo: "è cambiato ancora dopo questo turno" }],
  });
  // Un file nato nel turno, annullato, non c'è più.
  assert.equal(existsSync(join(progetto, "c.txt")), false);
  assert.equal(readFileSync(join(progetto, "b.txt"), "utf8"), "dopo b, e poi ancora\n");
});

test("i file che non sono testo, o troppo grandi, non si tengono; fuori dal turno nulla si tiene", async (t) => {
  const { progetto } = cartelle(t);
  writeFileSync(join(progetto, "immagine.png"), Buffer.from([0x89, 0x50, 0x00, 0x01]));
  const registro = new RegistroModifiche(progetto);
  registro.prima("a.txt");
  registro.apriTurno();
  registro.prima("immagine.png");
  writeFileSync(join(progetto, "immagine.png"), Buffer.from([0x89, 0x50, 0x00, 0x02]));
  writeFileSync(join(progetto, "a.txt"), "scritto fuori dal turno\n");
  assert.equal(await registro.chiudiTurno(), undefined);
});

test("prima di ogni strumento di modifica l'harness fa tenere la versione del file, senza decidere nulla", async () => {
  const visti: string[] = [];
  let fotografie = 0;
  const cfg: ConfigurazioneConversazione = {
    cartella: "/progetto",
    istruzioni: "claude-code",
    strumenti: "claude-code",
    strumentiSenzaRichiesta: [],
    impostazioni: { permessi: "chiedi" },
    alEvento: () => {},
    alIdSessione: () => {},
  };
  const opzioni = opzioniHarness(cfg, "abbonamento", undefined, { permessi: "chiedi" }, async () => ({ behavior: "deny", message: "" }), [], undefined, undefined, {
    pronto: async () => void (fotografie += 1),
    prima: (percorso) => visti.push(percorso),
  });
  // Vale per ogni strumento: è l'ultimo dei controlli, e non sceglie per nome.
  const controllo = opzioni.hooks?.PreToolUse?.at(-1);
  assert.ok(controllo !== undefined);
  assert.equal(controllo.matcher, undefined);
  const segnale = new AbortController().signal;
  const chiama = (tool_name: string, tool_input: unknown) =>
    controllo.hooks[0]?.({ hook_event_name: "PreToolUse", tool_name, tool_input, tool_use_id: "x", session_id: "s", transcript_path: "", cwd: "/progetto" } as never, "x", { signal: segnale });
  assert.deepEqual(await chiama("Write", { file_path: "src/a.ts", content: "" }), { continue: true });
  await chiama("NotebookEdit", { notebook_path: "/progetto/n.ipynb" });
  assert.deepEqual(visti, ["src/a.ts", "/progetto/n.ipynb"]);
  // La fotografia dei file si aspetta davanti a ciò che può cambiarli, comandi compresi, non davanti a chi legge soltanto.
  assert.equal(fotografie, 2);
  await chiama("Read", { file_path: "src/a.ts" });
  assert.equal(fotografie, 2);
  await chiama("Bash", { command: "sed -i s/a/b/ src/a.ts" });
  assert.equal(fotografie, 3);
  assert.deepEqual(visti, ["src/a.ts", "/progetto/n.ipynb"]);
  // Senza chi tiene le versioni il controllo non c'è.
  const senza = opzioniHarness(cfg, "abbonamento", undefined, { permessi: "chiedi" }, async () => ({ behavior: "deny", message: "" }));
  assert.equal(senza.hooks?.PreToolUse?.length, (opzioni.hooks?.PreToolUse?.length ?? 0) - 1);
});

test("con Codex: la versione di prima data da fuori, l'identificativo del turno del motore, più turni annullati insieme", async (t) => {
  const { progetto, dati } = cartelle(t);
  const a = join(progetto, "a.txt");
  writeFileSync(a, "due\n");
  const registro = new RegistroModifiche(progetto, dati);
  // Primo turno: a.txt era "uno", b.txt non c'era.
  assert.equal(registro.apriTurno("01a1fbf7-0000-7000-8000-000000000001"), "01a1fbf7-0000-7000-8000-000000000001");
  registro.primaCon(a, "uno\n");
  registro.primaCon(a, "ignorato: vale la prima volta\n");
  registro.primaCon("b.txt", null);
  writeFileSync(join(progetto, "b.txt"), "nuovo\n");
  const primo = await registro.chiudiTurno();
  assert.deepEqual(primo?.file.map((voce) => [voce.percorso, voce.stato]), [["a.txt", "cambiato"], ["b.txt", "nuovo"]]);
  // Secondo turno: a.txt da "due" a "tre".
  registro.apriTurno("01a1fbf7-0000-7000-8000-000000000002");
  registro.primaCon(a, "due\n");
  writeFileSync(a, "tre\n");
  await registro.chiudiTurno();

  const turni = ["01a1fbf7-0000-7000-8000-000000000001", "01a1fbf7-0000-7000-8000-000000000002"];
  assert.deepEqual(await registro.insieme(turni), { file: ["a.txt", "b.txt"], aggiunte: 3, tolte: 2 });
  const esito = await registro.annullaTurni(turni);
  assert.deepEqual(esito.annullati.sort(), ["a.txt", "b.txt"]);
  assert.deepEqual(esito.nonAnnullati, []);
  assert.equal(readFileSync(a, "utf8"), "uno\n");
  assert.equal(existsSync(join(progetto, "b.txt")), false);
});

test("i file cambiati dai comandi entrano nel turno, con la versione di prima, e si riportano com'erano", async (t) => {
  const { progetto, dati } = cartelle(t);
  mkdirSync(join(progetto, "src"));
  mkdirSync(join(progetto, "node_modules"));
  writeFileSync(join(progetto, "src", "a.txt"), "uno\r\ndue\r\n");
  writeFileSync(join(progetto, "src", "b.txt"), "da togliere\n");
  writeFileSync(join(progetto, "src", "c.txt"), "di Claude\n");
  writeFileSync(join(progetto, "src", "fermo.txt"), "fermo\n");
  writeFileSync(join(progetto, "node_modules", "x.js"), "dipendenza\n");
  const stati: unknown[] = [];
  const registro = new RegistroModifiche(progetto, dati, { alStato: (stato) => stati.push(stato) });

  const idTurno = registro.apriTurno();
  // Un comando cambia c.txt prima che Claude lo tocchi con un suo strumento: vale com'era all'inizio del turno.
  await registro.pronto();
  writeFileSync(join(progetto, "src", "c.txt"), "di un comando\n");
  registro.prima("src/c.txt");
  writeFileSync(join(progetto, "src", "c.txt"), "di Claude, cambiato\n");
  // Ciò che fa un comando: cambia, toglie, crea, sposta; e scrive tra le dipendenze, che non si guardano.
  writeFileSync(join(progetto, "src", "a.txt"), "uno\r\nDUE\r\n");
  rmSync(join(progetto, "src", "b.txt"));
  writeFileSync(join(progetto, "nuovo.txt"), "nato da un comando\n");
  writeFileSync(join(progetto, "node_modules", "x.js"), "aggiornata\n");
  const cambiate = await registro.chiudiTurno();
  assert.deepEqual(stati, [{ guardati: true }]);
  assert.equal(cambiate?.idTurno, idTurno);
  assert.deepEqual(
    cambiate?.file.map((voce) => [voce.percorso, voce.stato, voce.daComando ?? false]),
    [
      ["src/c.txt", "cambiato", false],
      ["nuovo.txt", "nuovo", true],
      ["src/a.txt", "cambiato", true],
      ["src/b.txt", "tolto", true],
    ],
  );
  // I fine riga restano quelli del file.
  assert.deepEqual(await registro.versioni(idTurno, "src/a.txt"), { prima: "uno\r\ndue\r\n", dopo: "uno\r\nDUE\r\n" });
  assert.deepEqual(await registro.versioni(idTurno, "src/c.txt"), { prima: "di Claude\n", dopo: "di Claude, cambiato\n" });

  // Dopo un riavvio si riporta tutto com'era.
  const esito = await new RegistroModifiche(progetto, dati).annulla(idTurno);
  assert.deepEqual("motivo" in esito ? esito : esito.nonAnnullati, []);
  assert.equal(readFileSync(join(progetto, "src", "a.txt"), "utf8"), "uno\r\ndue\r\n");
  assert.equal(readFileSync(join(progetto, "src", "b.txt"), "utf8"), "da togliere\n");
  assert.equal(readFileSync(join(progetto, "src", "c.txt"), "utf8"), "di Claude\n");
  assert.equal(existsSync(join(progetto, "nuovo.txt")), false);
  assert.equal(readFileSync(join(progetto, "node_modules", "x.js"), "utf8"), "aggiornata\n");

  // Il turno dopo riparte da com'è adesso: ciò che è cambiato tra un turno e l'altro non è suo.
  writeFileSync(join(progetto, "src", "fermo.txt"), "cambiato dal proprietario tra due turni\n");
  const secondo = registro.apriTurno();
  await registro.pronto();
  renameSync(join(progetto, "src", "a.txt"), join(progetto, "src", "spostato.txt"));
  const poi = await registro.chiudiTurno();
  assert.equal(poi?.idTurno, secondo);
  assert.deepEqual(poi?.file.map((voce) => [voce.percorso, voce.stato]), [["src/a.txt", "tolto"], ["src/spostato.txt", "nuovo"]]);
});

test("un turno che non ha potuto cambiare nulla non scatta fotografie; senza fotografie restano gli strumenti", async (t) => {
  const { progetto, dati } = cartelle(t);
  writeFileSync(join(progetto, "a.txt"), "uno\n");
  const registro = new RegistroModifiche(progetto, dati);
  registro.apriTurno();
  writeFileSync(join(progetto, "a.txt"), "cambiato senza che nessuno strumento partisse\n");
  assert.equal(await registro.chiudiTurno(), undefined);
  assert.equal(existsSync(join(dati, "fotografie")), false);

  const senza = new RegistroModifiche(progetto, dati, { senzaFotografie: true });
  senza.apriTurno();
  await senza.pronto();
  senza.prima("a.txt");
  writeFileSync(join(progetto, "a.txt"), "di Claude\n");
  writeFileSync(join(progetto, "b.txt"), "di un comando\n");
  assert.deepEqual((await senza.chiudiTurno())?.file.map((voce) => voce.percorso), ["a.txt"]);
  assert.equal(existsSync(join(dati, "fotografie")), false);
});
