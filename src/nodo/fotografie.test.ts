import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { FileDeiComandi } from "../protocollo/modifiche.ts";
import { Fotografo } from "./fotografie.ts";

function cartelle(t: { after(fn: () => Promise<void>): void }): { progetto: string; deposito: string } {
  const progetto = mkdtempSync(join(tmpdir(), "shinka-foto-"));
  const dati = mkdtempSync(join(tmpdir(), "shinka-foto-dati-"));
  t.after(async () => {
    await rm(progetto, { recursive: true, force: true });
    await rm(dati, { recursive: true, force: true });
  });
  return { progetto, deposito: join(dati, "fotografie") };
}

function git(cartella: string, ...argomenti: string[]): string {
  return execFileSync("git", ["-c", "user.name=Prova", "-c", "user.email=prova@example.invalid", "-c", "init.defaultBranch=main", ...argomenti], { cwd: cartella, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

test("tra due fotografie: i file cambiati, tolti e nati, con il testo di prima; non ciò che non è testo o è troppo grande", async (t) => {
  const { progetto, deposito } = cartelle(t);
  mkdirSync(join(progetto, "src"));
  writeFileSync(join(progetto, "src", "a.txt"), "uno\r\ndue\r\n");
  writeFileSync(join(progetto, "src", "b.txt"), "b\n");
  writeFileSync(join(progetto, "fermo.txt"), "fermo\n");
  writeFileSync(join(progetto, "grande.dat"), Buffer.alloc(1024 * 1024 + 1, 65));
  writeFileSync(join(progetto, "immagine.png"), Buffer.from([0x89, 0x50, 0x00, 0x02]));
  if (process.platform !== "win32") symlinkSync("src/a.txt", join(progetto, "collegamento"));
  const fotografo = new Fotografo(progetto, deposito);
  const prima = fotografo.scatta();
  const foto = await prima;
  assert.ok(foto !== undefined);
  assert.equal(foto.saltati.has("grande.dat"), true);

  writeFileSync(join(progetto, "src", "a.txt"), "uno\r\nDUE\r\n");
  rmSync(join(progetto, "src", "b.txt"));
  writeFileSync(join(progetto, "nome con spazi è.txt"), "nuovo\n");
  // Il file grande diventa piccolo, quello che non era testo lo diventa: di com'erano non si sa nulla.
  writeFileSync(join(progetto, "grande.dat"), "ora è piccolo\n");
  writeFileSync(join(progetto, "immagine.png"), "ora è testo\n");
  if (process.platform !== "win32") {
    rmSync(join(progetto, "collegamento"));
    writeFileSync(join(progetto, "collegamento"), "ora è un file\n");
  }
  assert.deepEqual(await fotografo.cambiatiDa(prima), {
    file: [
      { percorso: "nome con spazi è.txt", prima: null },
      { percorso: "src/a.txt", prima: "uno\r\ndue\r\n" },
      { percorso: "src/b.txt", prima: "b\n" },
    ],
    altri: 0,
  });
  assert.deepEqual(fotografo.stato, { guardati: true });
  // Senza cambiamenti non c'è nulla.
  assert.deepEqual(await fotografo.cambiatiDa(fotografo.scatta()), { file: [], altri: 0 });
});

test("ciò che il progetto fa ignorare a Git non si guarda, e il suo repository non viene toccato", async (t) => {
  const { progetto, deposito } = cartelle(t);
  git(progetto, "init", "--quiet");
  writeFileSync(join(progetto, ".gitignore"), "segreti.env\ncostruito/\n");
  writeFileSync(join(progetto, ".gitattributes"), "* text=auto eol=lf\n*.txt filter=inesistente\n");
  mkdirSync(join(progetto, "costruito"));
  // Una cartella che di solito è delle dipendenze, ma che questo progetto registra: si guarda.
  mkdirSync(join(progetto, "build"));
  writeFileSync(join(progetto, "build", "passi.txt"), "uno\r\n");
  writeFileSync(join(progetto, "a.txt"), "a\r\n");
  writeFileSync(join(progetto, "segreti.env"), "CHIAVE=1\n");
  writeFileSync(join(progetto, "costruito", "x.js"), "x\n");
  writeFileSync(join(progetto, ".git", "info", "exclude"), "solo-mio.txt\n");
  writeFileSync(join(progetto, "solo-mio.txt"), "mio\n");
  git(progetto, "add", "-A");
  git(progetto, "commit", "--quiet", "-m", "inizio");
  const statoPrima = git(progetto, "status", "--porcelain");
  const oggettiPrima = git(progetto, "count-objects");

  const fotografo = new Fotografo(progetto, deposito);
  const prima = fotografo.scatta();
  await prima;
  for (const nome of ["a.txt", "segreti.env", "solo-mio.txt", join("costruito", "x.js"), join("build", "passi.txt")]) writeFileSync(join(progetto, nome), "cambiato\r\n");
  const cambiati = await fotografo.cambiatiDa(prima);
  // I fine riga e i filtri che il progetto chiede a Git qui non valgono: il testo è quello del file.
  assert.deepEqual(cambiati, {
    file: [
      { percorso: "a.txt", prima: "a\r\n" },
      { percorso: "build/passi.txt", prima: "uno\r\n" },
    ],
    altri: 0,
  });
  assert.equal(git(progetto, "status", "--porcelain").replace(/^ M (a\.txt|build\/passi\.txt)\n/gm, ""), statoPrima);
  assert.equal(git(progetto, "count-objects"), oggettiPrima);
  assert.equal(existsSync(join(progetto, ".git", "index.lock")), false);
});

test("un file che compare solo perché non è più ignorato non è nuovo", async (t) => {
  const { progetto, deposito } = cartelle(t);
  writeFileSync(join(progetto, ".gitignore"), "vecchio.log\n");
  writeFileSync(join(progetto, "vecchio.log"), "c'era già\n");
  // Abbastanza perché il file di prima risulti più vecchio della fotografia, con il margine che si lascia.
  await new Promise((fatto) => setTimeout(fatto, 2100));
  const fotografo = new Fotografo(progetto, deposito);
  const prima = fotografo.scatta();
  await prima;
  writeFileSync(join(progetto, ".gitignore"), "");
  writeFileSync(join(progetto, "nato.txt"), "nato adesso\n");
  const cambiati = await fotografo.cambiatiDa(prima);
  assert.deepEqual(cambiati?.file.map((voce) => voce.percorso), [".gitignore", "nato.txt"]);
});

test("una cartella con un repository suo resta fuori, anche quando smette di averlo", async (t) => {
  const { progetto, deposito } = cartelle(t);
  mkdirSync(join(progetto, "dentro"));
  git(join(progetto, "dentro"), "init", "--quiet");
  writeFileSync(join(progetto, "dentro", "x.txt"), "x\n");
  writeFileSync(join(progetto, "a.txt"), "a\n");
  const fotografo = new Fotografo(progetto, deposito);
  const prima = fotografo.scatta();
  assert.equal((await prima)?.saltati.has("dentro"), true);
  rmSync(join(progetto, "dentro", ".git"), { recursive: true });
  writeFileSync(join(progetto, "a.txt"), "A\n");
  assert.deepEqual(await fotografo.cambiatiDa(prima), { file: [{ percorso: "a.txt", prima: "a\n" }], altri: 0 });
});

test("troppi file cambiati: se ne tengono alcuni e gli altri si contano", async (t) => {
  const { progetto, deposito } = cartelle(t);
  for (let n = 0; n < 6; n += 1) writeFileSync(join(progetto, `f${n}.txt`), `${n}\n`);
  const fotografo = new Fotografo(progetto, deposito, { limiti: { file: 4, byteDiPrima: 6 } });
  const prima = fotografo.scatta();
  await prima;
  for (let n = 0; n < 6; n += 1) writeFileSync(join(progetto, `f${n}.txt`), `cambiato ${n}\n`);
  // Quattro per numero, e di quelli tre per peso: ogni versione di prima pesa due byte.
  const cambiati = await fotografo.cambiatiDa(prima);
  assert.deepEqual(cambiati?.file.map((voce) => voce.percorso), ["f0.txt", "f1.txt", "f2.txt"]);
  assert.equal(cambiati?.altri, 3);
});

test("dove Git manca, o il progetto è troppo grande, non ci sono fotografie e lo si dice una volta", async (t) => {
  const { progetto, deposito } = cartelle(t);
  writeFileSync(join(progetto, "a.txt"), "a\n");
  writeFileSync(join(progetto, "b.txt"), "b\n");
  const stati: FileDeiComandi[] = [];
  const senzaGit = new Fotografo(progetto, deposito, { eseguibile: join(progetto, "git-che-non-esiste"), alStato: (stato) => stati.push(stato) });
  assert.equal(await senzaGit.scatta(), undefined);
  assert.equal(await senzaGit.scatta(), undefined);
  assert.equal(await senzaGit.cambiatiDa(senzaGit.scatta()), undefined);
  assert.deepEqual(stati, [{ guardati: false, motivo: "in questo ambiente manca Git" }]);

  const troppi: FileDeiComandi[] = [];
  const piccolo = new Fotografo(progetto, `${deposito}-2`, { limiti: { candidati: 1 }, alStato: (stato) => troppi.push(stato) });
  assert.equal(await piccolo.scatta(), undefined);
  assert.equal(await piccolo.scatta(), undefined);
  assert.equal(troppi.length, 1);
  assert.match(troppi[0]?.guardati === false ? troppi[0].motivo : "", /troppi file/);
  assert.equal(readFileSync(join(progetto, "a.txt"), "utf8"), "a\n");
});

test("il deposito non cresce senza fine: a turno chiuso ciò che non serve più viene tolto", async (t) => {
  const { progetto, deposito } = cartelle(t);
  writeFileSync(join(progetto, "a.txt"), "0\n");
  writeFileSync(join(progetto, "fermo.txt"), "fermo\n");
  const fotografo = new Fotografo(progetto, deposito, { limiti: { oggettiSparsi: 6 } });
  const conta = (): { sparsi: number; raccolti: number } => {
    const righe = execFileSync("git", ["count-objects", "-v"], { cwd: progetto, env: { ...process.env, GIT_DIR: deposito }, encoding: "utf8" });
    return { sparsi: Number(/^count: (\d+)/m.exec(righe)?.[1]), raccolti: Number(/^in-pack: (\d+)/m.exec(righe)?.[1]) };
  };
  let massimo = 0;
  for (let n = 1; n <= 12; n += 1) {
    const prima = fotografo.scatta();
    await prima;
    writeFileSync(join(progetto, "a.txt"), `${n}\n`);
    assert.deepEqual(await fotografo.cambiatiDa(prima), { file: [{ percorso: "a.txt", prima: `${n - 1}\n` }], altri: 0 });
    massimo = Math.max(massimo, conta().sparsi);
  }
  // Ogni turno lascia due oggetti: senza riordino sarebbero una trentina.
  assert.ok(massimo <= 8, `oggetti sparsi: ${massimo}`);
  assert.ok(conta().raccolti >= 2);
  assert.equal(existsSync(join(progetto, ".git")), false);
});
