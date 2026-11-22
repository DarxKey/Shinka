import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { leggiInstallazione } from "../guardiano/guardiano.ts";
import type { FileDiVersione } from "../protocollo/versione.ts";
import { preparaAggiornamento } from "./aggiornamento.ts";

const PRIMA = "1111111111111111111111111111111111111111";
const NUOVA = "2222222222222222222222222222222222222222";

const b64 = (testo: string): string => Buffer.from(testo).toString("base64");

function pacchetto(versione: string, dipendenze = "{\"lock\":1}", altro: FileDiVersione[] = []): FileDiVersione[] {
  return [
    { percorso: "package.json", dati: b64("{}") },
    { percorso: "package-lock.json", dati: b64(dipendenze) },
    { percorso: "versione.json", dati: b64(JSON.stringify({ versione })) },
    { percorso: "src/nodo/avvio.ts", dati: b64("console.log('nuovo');\n") },
    ...altro,
  ];
}

/** Un nodo installato alla versione di prima, con le sue dipendenze. */
async function nodoInstallato(t: TestContext) {
  const radice = await mkdtemp(join(tmpdir(), "shinka-aggiornamento-"));
  t.after(() => rm(radice, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const installata = join(radice, "shinka");
  await mkdir(join(installata, "node_modules", "una-dipendenza"), { recursive: true });
  await mkdir(join(installata, "src", "nodo"), { recursive: true });
  await writeFile(join(installata, "node_modules", "una-dipendenza", "index.js"), "// di prima\n");
  await writeFile(join(installata, "package-lock.json"), "{\"lock\":1}");
  await writeFile(join(installata, "versione.json"), JSON.stringify({ versione: PRIMA }));
  await writeFile(join(installata, "src", "nodo", "avvio.ts"), "console.log('prima');\n");
  const fileInstallazione = join(radice, "dati-nodo", "installazione.json");
  return { radice, installata, nuova: `${installata}-nuovo`, fileInstallazione };
}

/** Al posto di npm: un comando che lascia un segno nella cartella in cui gira. */
const DIPENDENZE_FINTE = { comando: `node -e "require('fs').mkdirSync('node_modules/scaricata',{recursive:true})"`, secondi: 30 };

test("la versione nuova viene preparata accanto a quella in funzione, che non viene toccata", async (t) => {
  const { installata, nuova, fileInstallazione } = await nodoInstallato(t);
  const esito = await preparaAggiornamento({ installata, fileInstallazione, versione: NUOVA, file: pacchetto(NUOVA), dipendenze: DIPENDENZE_FINTE });
  assert.deepEqual(esito, { pronta: true });

  assert.equal(await readFile(join(nuova, "src", "nodo", "avvio.ts"), "utf8"), "console.log('nuovo');\n");
  assert.equal(await readFile(join(installata, "src", "nodo", "avvio.ts"), "utf8"), "console.log('prima');\n");
  // Le dipendenze non sono cambiate: valgono quelle di prima, e non si scarica nulla.
  assert.equal(existsSync(join(nuova, "node_modules", "una-dipendenza", "index.js")), true);
  assert.equal(existsSync(join(nuova, "node_modules", "scaricata")), false);

  // Al guardiano resta scritto che cosa installare, e da dove.
  const scritta = leggiInstallazione(fileInstallazione);
  assert.equal(scritta?.fase, "da-installare");
  assert.equal(scritta?.versione, NUOVA);
  assert.equal(scritta?.nuova, nuova);
});

test("se le dipendenze sono cambiate il nodo le scarica per il suo sistema", async (t) => {
  const { installata, nuova, fileInstallazione } = await nodoInstallato(t);
  const esito = await preparaAggiornamento({
    installata,
    fileInstallazione,
    versione: NUOVA,
    file: pacchetto(NUOVA, "{\"lock\":2}"),
    dipendenze: DIPENDENZE_FINTE,
  });
  assert.deepEqual(esito, { pronta: true });
  assert.equal(existsSync(join(nuova, "node_modules", "scaricata")), true);
  assert.equal(existsSync(join(nuova, "node_modules", "una-dipendenza")), false);
});

test("se le dipendenze non si scaricano il nodo resta com'è, e dice perché", async (t) => {
  const { installata, nuova, fileInstallazione } = await nodoInstallato(t);
  const esito = await preparaAggiornamento({
    installata,
    fileInstallazione,
    versione: NUOVA,
    file: pacchetto(NUOVA, "{\"lock\":2}"),
    dipendenze: { comando: `node -e "console.error('rete assente');process.exit(4)"`, secondi: 30 },
  });
  assert.equal(esito.pronta, false);
  assert.match(esito.pronta ? "" : esito.motivo, /dipendenze[\s\S]*rete assente/);
  assert.equal(existsSync(nuova), false);
  assert.equal(leggiInstallazione(fileInstallazione), undefined);
  assert.equal(await readFile(join(installata, "src", "nodo", "avvio.ts"), "utf8"), "console.log('prima');\n");
});

test("un pacchetto che non è quello della versione chiesta, o che esce dalla cartella, non viene installato", async (t) => {
  const { radice, installata, nuova, fileInstallazione } = await nodoInstallato(t);
  const prova = (versione: string, file: FileDiVersione[]) =>
    preparaAggiornamento({ installata, fileInstallazione, versione, file, dipendenze: DIPENDENZE_FINTE });

  // Il file della versione dice un'altra versione.
  const altra = await prova(NUOVA, pacchetto("3333333333333333333333333333333333333333"));
  assert.match(altra.pronta ? "" : altra.motivo, /non è quello della versione 22222222/);

  // Un file che uscirebbe dalla cartella della versione.
  const fuori = await prova(NUOVA, pacchetto(NUOVA, undefined, [{ percorso: "../fuori.ts", dati: b64("x") }]));
  assert.equal(fuori.pronta, false);
  assert.equal(existsSync(join(radice, "fuori.ts")), false);

  // Senza l'elenco delle dipendenze.
  const senza = await prova(NUOVA, pacchetto(NUOVA).filter((uno) => uno.percorso !== "package-lock.json"));
  assert.match(senza.pronta ? "" : senza.motivo, /dipendenze/);

  // La versione che il nodo ha già.
  const stessa = await prova(PRIMA, pacchetto(PRIMA));
  assert.match(stessa.pronta ? "" : stessa.motivo, /già quella in funzione/);

  // Qualcosa che non è una versione.
  assert.equal((await prova("main", pacchetto("main"))).pronta, false);

  assert.equal(existsSync(nuova), false);
  assert.equal(leggiInstallazione(fileInstallazione), undefined);
});
