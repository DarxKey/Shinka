import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test, type TestContext } from "node:test";
import { FILE_VERSIONE, git, inBreve, preparaVersione, versioneDi, type Passo } from "./preparazione.ts";

const IDENTITA = ["-c", "user.name=Prova", "-c", "user.email=prova@localhost"];

/** Le prove di una Shinka finta: un programma che riesce, a meno che nella cartella ci sia un file che dice di no. */
const PROVA: Passo = { nome: "prova", comando: "node prova.mjs", secondi: 30 };
/** Le dipendenze finte: lasciano un segno, così si vede se sono state scaricate di nuovo. */
const DIPENDENZE: Passo = {
  nome: "dipendenze",
  comando: `node -e "require('fs').mkdirSync('node_modules/scaricato',{recursive:true})"`,
  secondi: 30,
};

async function comando(cartella: string, argomenti: string[]): Promise<string> {
  const esito = await git(cartella, [...IDENTITA, ...argomenti]);
  assert.equal(esito.codice, 0, `git ${argomenti.join(" ")}: ${esito.uscita}`);
  return esito.uscita;
}

function scrivi(cartella: string, percorso: string, contenuto: string): void {
  mkdirSync(dirname(join(cartella, percorso)), { recursive: true });
  writeFileSync(join(cartella, percorso), contenuto);
}

async function registra(cartella: string, messaggio: string): Promise<string> {
  await comando(cartella, ["add", "--all"]);
  await comando(cartella, ["commit", "--quiet", "-m", messaggio]);
  return comando(cartella, ["rev-parse", "HEAD"]);
}

/**
 * Un repository di Shinka in piccolo, la copia di lavoro del progetto e la cartella della versione
 * in funzione, che è la prima versione registrata.
 */
async function allestisci(t: TestContext) {
  const radice = mkdtempSync(join(tmpdir(), "shinka-preparazione-"));
  t.after(() => rm(radice, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 }));
  const repository = join(radice, "shinka.git");
  mkdirSync(repository);
  await comando(repository, ["init", "--quiet", "--bare", "--initial-branch=main"]);
  const progetto = join(radice, "progetto");
  await comando(radice, ["clone", "--quiet", repository, progetto]);
  await comando(progetto, ["checkout", "--quiet", "-B", "main"]);

  scrivi(progetto, "package.json", JSON.stringify({ name: "shinka-di-prova", private: true }));
  scrivi(progetto, "package-lock.json", JSON.stringify({ lockfileVersion: 3, versione: 1 }));
  scrivi(progetto, ".gitignore", "node_modules/\n");
  scrivi(progetto, "prova.mjs", `import { existsSync } from "node:fs";\nif (existsSync("rotto.txt")) { console.error("la prova dice di no"); process.exit(1); }\nconsole.log("la prova passa");\n`);
  scrivi(progetto, "src/centro/uno.ts", "export const uno = 1;\n");
  const prima = await registra(progetto, "Prima versione");
  await comando(progetto, ["push", "--quiet", "origin", "main"]);

  const installata = join(radice, "shinka");
  scrivi(installata, "package-lock.json", readFileSync(join(progetto, "package-lock.json"), "utf8"));
  scrivi(installata, "node_modules/una-dipendenza/index.js", "module.exports = 1;\n");
  scrivi(installata, FILE_VERSIONE, JSON.stringify({ versione: prima }));

  const nuova = join(radice, "shinka-nuovo");
  const prepara = (passi: Passo[] = [PROVA]) => preparaVersione({ progetto, installata, nuova, passi, dipendenze: DIPENDENZE });
  return { radice, repository, progetto, installata, nuova, prima, prepara };
}

test("la versione scritta in una cartella si legge, e una cartella senza non ne ha", async (t) => {
  const lab = await allestisci(t);
  assert.equal(await versioneDi(lab.installata), lab.prima);
  assert.equal(await versioneDi(lab.progetto), undefined);
  scrivi(lab.progetto, FILE_VERSIONE, JSON.stringify({ versione: "non è una versione" }));
  assert.equal(await versioneDi(lab.progetto), undefined);
  assert.equal(inBreve(lab.prima), lab.prima.slice(0, 8));
});

test("una versione registrata viene estratta pulita, provata, e descritta rispetto a quella in funzione", async (t) => {
  const lab = await allestisci(t);
  scrivi(lab.progetto, "src/centro/due.ts", "export const due = 2;\n");
  scrivi(lab.progetto, "src/gateway/vault.ts", "export const vault = true;\n");
  await registra(lab.progetto, "Aggiunge il due");
  scrivi(lab.progetto, "src/nodo/tre.ts", "export const tre = 3;\n");
  const versione = await registra(lab.progetto, "Aggiunge il tre");
  // Ciò che sta nella cartella ma non nel repository non entra nella versione.
  scrivi(lab.progetto, "node_modules/roba/index.js", "");

  const esito = await lab.prepara();
  assert.ok(esito.pronta, esito.pronta ? "" : esito.motivo);
  assert.equal(esito.versione, versione);
  assert.deepEqual(esito.modifiche, ["Aggiunge il tre", "Aggiunge il due"]);
  assert.deepEqual(esito.file, ["src/centro/due.ts", "src/gateway/vault.ts", "src/nodo/tre.ts"]);
  assert.equal(esito.quantiFile, 3);
  // Del gateway qui non si dice nulla: lo dice chi installa, che sa se la sua parte cambia davvero.
  assert.equal(esito.avvisi.length, 1);
  assert.match(esito.avvisi[0] ?? "", /un nodo che non sa aggiornarsi da solo resta alla versione di prima/);

  assert.equal(await versioneDi(lab.nuova), versione);
  assert.ok(existsSync(join(lab.nuova, "src/nodo/tre.ts")));
  assert.ok(!existsSync(join(lab.nuova, ".git")));
  // Le dipendenze non sono cambiate: valgono quelle della versione in funzione, senza scaricarle.
  assert.ok(existsSync(join(lab.nuova, "node_modules/una-dipendenza/index.js")));
  assert.ok(!existsSync(join(lab.nuova, "node_modules/scaricato")));
  assert.ok(!existsSync(join(lab.nuova, "node_modules/roba")));
});

test("ciò che non è registrato nel repository non si installa", async (t) => {
  const lab = await allestisci(t);
  scrivi(lab.progetto, "src/centro/due.ts", "export const due = 2;\n");
  const esito = await lab.prepara();
  assert.ok(!esito.pronta);
  assert.match(esito.motivo, /modifiche non registrate nel repository/);
  assert.match(esito.motivo, /src\//);
  assert.ok(!existsSync(lab.nuova));
});

test("la versione già in funzione non si installa di nuovo", async (t) => {
  const lab = await allestisci(t);
  const esito = await lab.prepara();
  assert.ok(!esito.pronta);
  assert.match(esito.motivo, /è già quella in funzione/);
});

test("una prova che non passa ferma tutto, e dice che cosa ha scritto", async (t) => {
  const lab = await allestisci(t);
  scrivi(lab.progetto, "rotto.txt", "sì");
  await registra(lab.progetto, "Rompe la prova");
  const esito = await lab.prepara();
  assert.ok(!esito.pronta);
  assert.match(esito.motivo, /Il passo "prova" \(node prova\.mjs\) non è riuscito/);
  assert.match(esito.motivo, /la prova dice di no/);
  assert.ok(!existsSync(lab.nuova));
});

test("una prova che non finisce viene fermata", async (t) => {
  const lab = await allestisci(t);
  scrivi(lab.progetto, "src/centro/due.ts", "export const due = 2;\n");
  await registra(lab.progetto, "Aggiunge il due");
  const esito = await lab.prepara([{ nome: "attesa", comando: `node -e "setInterval(()=>{},1000)"`, secondi: 1 }]);
  assert.ok(!esito.pronta);
  assert.match(esito.motivo, /Il passo "attesa" .* è stato fermato dopo 1 secondi/);
  assert.ok(!existsSync(lab.nuova));
});

test("se le dipendenze cambiano vengono scaricate di nuovo, e la scheda lo dice", async (t) => {
  const lab = await allestisci(t);
  scrivi(lab.progetto, "package-lock.json", JSON.stringify({ lockfileVersion: 3, versione: 2 }));
  await registra(lab.progetto, "Cambia le dipendenze");
  const esito = await lab.prepara();
  assert.ok(esito.pronta, esito.pronta ? "" : esito.motivo);
  assert.ok(existsSync(join(lab.nuova, "node_modules/scaricato")));
  assert.ok(!existsSync(join(lab.nuova, "node_modules/una-dipendenza")));
  assert.deepEqual(esito.avvisi, ["Cambiano le dipendenze: sono state scaricate di nuovo."]);
});

test("una versione che non contiene ciò che è arrivato nel repository da fuori non si installa", async (t) => {
  const lab = await allestisci(t);
  // Qualcun altro, da fuori, registra una modifica nel repository.
  const altrove = join(lab.radice, "altrove");
  await comando(lab.radice, ["clone", "--quiet", lab.repository, altrove]);
  scrivi(altrove, "src/centro/fuori.ts", "export const fuori = true;\n");
  await registra(altrove, "Arriva da fuori");
  await comando(altrove, ["push", "--quiet", "origin", "HEAD:main"]);

  scrivi(lab.progetto, "src/centro/due.ts", "export const due = 2;\n");
  await registra(lab.progetto, "Aggiunge il due");
  const esito = await lab.prepara();
  assert.ok(!esito.pronta);
  assert.match(esito.motivo, /ci sono modifiche che questa versione non contiene/);

  // Unite quelle modifiche, la versione si prepara.
  await comando(lab.progetto, ["pull", "--quiet", "--no-rebase", "--no-edit", "origin", "main"]);
  const unita = await lab.prepara();
  assert.ok(unita.pronta, unita.pronta ? "" : unita.motivo);
  assert.ok(existsSync(join(lab.nuova, "src/centro/fuori.ts")));
});

test("se non si sa quale versione è in funzione, la scheda lo dice", async (t) => {
  const lab = await allestisci(t);
  await rm(join(lab.installata, FILE_VERSIONE));
  const esito = await lab.prepara();
  assert.ok(esito.pronta, esito.pronta ? "" : esito.motivo);
  assert.deepEqual(esito.modifiche, ["Prima versione"]);
  assert.equal(esito.quantiFile, 0);
  assert.match(esito.avvisi[0] ?? "", /Non è scritto quale versione sia in funzione/);
});
