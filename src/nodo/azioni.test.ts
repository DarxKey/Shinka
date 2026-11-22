import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { cartellaDellArgomento, leggiAzione, leggiEsito, traIFileDellaHome } from "../protocollo/azioni.ts";
import { eseguiAzione, leggiElaborato } from "./azioni.ts";

const ARGOMENTO = "2026-11-11-abc123";
const diWindows = process.platform === "win32";

async function allestisci(t: TestContext): Promise<{ radice: string; cartella: string }> {
  const radice = await mkdtemp(join(tmpdir(), "shinka-azioni-"));
  t.after(() => rm(radice, { recursive: true, force: true }));
  return { radice, cartella: join(radice, "_home", ARGOMENTO) };
}

test("un file scritto con il solo nome finisce nella cartella dell'argomento, e si rilegge", async (t) => {
  const { radice, cartella } = await allestisci(t);
  const percorso = join(cartella, "appunti", "saluto.txt");

  const scritto = await eseguiAzione(radice, ARGOMENTO, {
    tipo: "scrivi-file",
    percorso: "appunti/saluto.txt",
    contenuto: "Perché no?\n",
  });
  assert.deepEqual(scritto, { riuscita: true, testo: `File scritto: ${percorso}`, percorso });
  assert.equal(await readFile(percorso, "utf8"), "Perché no?\n");

  const letto = await eseguiAzione(radice, ARGOMENTO, { tipo: "leggi-file", percorso: "appunti/saluto.txt" });
  assert.deepEqual(letto, { riuscita: true, testo: "Perché no?\n", percorso });

  // Con un percorso completo si legge lo stesso file.
  const perIntero = await eseguiAzione(radice, ARGOMENTO, { tipo: "leggi-file", percorso });
  assert.equal(perIntero.testo, "Perché no?\n");
});

test("un file che non c'è o un argomento dal nome strano non fanno danni", async (t) => {
  const { radice } = await allestisci(t);
  const assente = await eseguiAzione(radice, ARGOMENTO, { tipo: "leggi-file", percorso: "mai-scritto.txt" });
  assert.equal(assente.riuscita, false);
  assert.match(assente.testo, /non esiste/);

  const cartellaNonFile = await eseguiAzione(radice, ARGOMENTO, { tipo: "leggi-file", percorso: "." });
  assert.equal(cartellaNonFile.riuscita, false);

  for (const id of ["../fuori", "", "Con Spazi", "a/b"]) {
    const esito = await eseguiAzione(radice, id, { tipo: "scrivi-file", percorso: "x.txt", contenuto: "x" });
    assert.deepEqual(esito, { riuscita: false, testo: "L'argomento indicato non è valido." }, id);
  }
});

test("un comando gira nella cartella dell'argomento e riporta codice e uscita, accenti compresi", async (t) => {
  const { radice, cartella } = await allestisci(t);
  const comando = diWindows ? 'Write-Output "perché qui: $((Get-Location).Path)"' : 'echo "perché qui: $(pwd)"';

  const esito = await eseguiAzione(radice, ARGOMENTO, { tipo: "esegui", comando });
  assert.equal(esito.riuscita, true, esito.testo);
  assert.match(esito.testo, /^Codice di uscita: 0\n/);
  assert.ok(esito.testo.includes(`perché qui: ${cartella}`), esito.testo);

  const fallito = await eseguiAzione(radice, ARGOMENTO, { tipo: "esegui", comando: "exit 3" });
  assert.equal(fallito.riuscita, false);
  assert.match(fallito.testo, /^Codice di uscita: 3/);
});

test("uno script appena scritto si può provare subito", async (t) => {
  const { radice } = await allestisci(t);
  const nome = diWindows ? "saluta.ps1" : "saluta.sh";
  const contenuto = diWindows ? 'Write-Output "È andata: $($args[0])"\n' : 'echo "È andata: $1"\n';
  const scritto = await eseguiAzione(radice, ARGOMENTO, { tipo: "scrivi-file", percorso: nome, contenuto });
  assert.equal(scritto.riuscita, true);

  const comando = diWindows ? ".\\saluta.ps1 bene" : "bash saluta.sh bene";
  const esito = await eseguiAzione(radice, ARGOMENTO, { tipo: "esegui", comando });
  assert.equal(esito.riuscita, true, esito.testo);
  assert.ok(esito.testo.includes("È andata: bene"), esito.testo);

  // Riletto, lo script è quello scritto: il segno iniziale che serve a PowerShell non si vede.
  const riletto = await eseguiAzione(radice, ARGOMENTO, { tipo: "leggi-file", percorso: nome });
  assert.equal(riletto.testo, contenuto);
});

test("un comando che non finisce viene fermato allo scadere del tempo", async (t) => {
  const { radice } = await allestisci(t);
  const inizio = Date.now();
  const esito = await eseguiAzione(radice, ARGOMENTO, {
    tipo: "esegui",
    comando: diWindows ? "Write-Output 'comincio'; Start-Sleep -Seconds 60" : "echo comincio; exec sleep 60",
    durataMs: 1_500,
  });
  assert.equal(esito.riuscita, false);
  assert.match(esito.testo, /fermato dopo 2 secondi/);
  assert.ok(Date.now() - inizio < 20_000, "il comando non deve arrivare in fondo");
});

test("un'azione arrivata dall'esterno vale solo se è ben formata", () => {
  assert.deepEqual(leggiAzione({ tipo: "esegui", comando: "dir", altro: 1 }), { tipo: "esegui", comando: "dir" });
  assert.deepEqual(leggiAzione({ tipo: "esegui", comando: "dir", durataMs: 9_000_000 }), {
    tipo: "esegui",
    comando: "dir",
    durataMs: 600_000,
  });
  assert.deepEqual(leggiAzione({ tipo: "scrivi-file", percorso: "a.txt", contenuto: "" }), {
    tipo: "scrivi-file",
    percorso: "a.txt",
    contenuto: "",
  });
  for (const malformata of [
    null,
    "esegui",
    { tipo: "esegui", comando: "   " },
    { tipo: "esegui", comando: "dir", durataMs: "tanto" },
    { tipo: "scrivi-file", percorso: "a.txt" },
    { tipo: "leggi-file", percorso: "" },
    { tipo: "cancella-tutto", percorso: "a.txt" },
  ]) {
    assert.equal(leggiAzione(malformata), undefined, JSON.stringify(malformata));
  }
});

test("la cartella di un argomento si scrive come la scrive il suo ambiente", () => {
  assert.equal(cartellaDellArgomento("/srv/progetti/", ARGOMENTO), `/srv/progetti/_home/${ARGOMENTO}`);
  assert.equal(cartellaDellArgomento("D:\\Progetti", ARGOMENTO), `D:\\Progetti\\_home\\${ARGOMENTO}`);
});

test("tra i file della Home stanno i percorsi relativi e quelli sotto la cartella degli argomenti", () => {
  const linux = "/srv/progetti";
  assert.equal(traIFileDellaHome(linux, "script.sh"), true);
  assert.equal(traIFileDellaHome(linux, "dati/elenco.csv"), true);
  assert.equal(traIFileDellaHome(linux, `/srv/progetti/_home/${ARGOMENTO}/script.sh`), true);
  assert.equal(traIFileDellaHome(linux, "../videogioco/main.c"), false);
  assert.equal(traIFileDellaHome(linux, "/srv/progetti/videogioco/main.c"), false);
  assert.equal(traIFileDellaHome(linux, "/srv/progetti/_home/../videogioco/main.c"), false);
  assert.equal(traIFileDellaHome(linux, "/etc/passwd"), false);
  assert.equal(traIFileDellaHome(linux, "/srv/progetti/_homealtro/x"), false);

  const windows = "D:\\Progetti";
  assert.equal(traIFileDellaHome(windows, "prova.ps1"), true);
  assert.equal(traIFileDellaHome(windows, `d:/progetti/_home/${ARGOMENTO}/prova.ps1`), true);
  assert.equal(traIFileDellaHome(windows, "C:\\Windows\\System32\\drivers\\etc\\hosts"), false);
  assert.equal(traIFileDellaHome(windows, "\\\\server\\condivisa\\x.txt"), false);
});

test("i file di un argomento si elencano, senza repository né dipendenze", async (t) => {
  const { radice } = await allestisci(t);
  const vuoto = await eseguiAzione(radice, ARGOMENTO, { tipo: "elenca-file" });
  assert.deepEqual(vuoto, { riuscita: true, testo: "0 file", file: [], quantiFile: 0, dettagli: [] });
  // Chiedere l'elenco non crea la cartella di un argomento che non ha ancora prodotto nulla.
  assert.equal(existsSync(join(radice, "_home", ARGOMENTO)), false);

  for (const percorso of ["sito/index.html", "sito/stile.css", "appunti.md", ".git/config", "node_modules/x/index.js"]) {
    await eseguiAzione(radice, ARGOMENTO, { tipo: "scrivi-file", percorso, contenuto: "x" });
  }
  const elenco = await eseguiAzione(radice, ARGOMENTO, { tipo: "elenca-file" });
  const { dettagli, ...resto } = elenco;
  assert.deepEqual(resto, {
    riuscita: true,
    testo: "3 file",
    file: ["appunti.md", "sito/index.html", "sito/stile.css"],
    quantiFile: 3,
  });
  // Con ogni file arrivano la sua dimensione e la data dell'ultima modifica, nello stesso ordine.
  assert.equal(dettagli?.length, 3);
  for (const dettaglio of dettagli ?? []) {
    assert.equal(dettaglio.byte, 1);
    assert.ok(Date.now() - Date.parse(dettaglio.modificatoIl) < 60_000);
  }
});

test("un elaborato si legge così com'è, anche un'immagine, e solo dentro la cartella dell'argomento", async (t) => {
  const { radice, cartella } = await allestisci(t);
  // Guardare un argomento che qui non ha lavorato non crea la sua cartella.
  const senza = await eseguiAzione(radice, ARGOMENTO, { tipo: "leggi-elaborato", percorso: "mappa.png" });
  assert.equal(senza.riuscita, false);
  assert.equal(existsSync(cartella), false);

  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]);
  await mkdir(join(cartella, "mappe"), { recursive: true });
  await writeFile(join(cartella, "mappe", "tokyo.png"), png);
  const letto = await eseguiAzione(radice, ARGOMENTO, { tipo: "leggi-elaborato", percorso: "mappe/tokyo.png" });
  assert.equal(letto.riuscita, true);
  assert.deepEqual(Buffer.from(letto.testo, "base64"), png);

  // Fuori dalla cartella non si legge nulla: né risalendo, né con un percorso completo, né da un collegamento.
  await writeFile(join(radice, "segreto.txt"), "no");
  assert.equal((await leggiElaborato(cartella, "../segreto.txt")).hasOwnProperty("problema"), true);
  assert.equal((await leggiElaborato(cartella, join(radice, "segreto.txt"))).hasOwnProperty("problema"), true);
  if (!diWindows) {
    await symlink(join(radice, "segreto.txt"), join(cartella, "scorciatoia.txt"));
    assert.deepEqual(await leggiElaborato(cartella, "scorciatoia.txt"), {
      problema: "Il percorso non indica un file dell'argomento.",
    });
  }
  assert.equal((await leggiElaborato(cartella, "mappe")).hasOwnProperty("problema"), true);
  assert.equal(leggiAzione({ tipo: "leggi-elaborato", percorso: "../segreto.txt" }), undefined);
  assert.equal(leggiAzione({ tipo: "leggi-elaborato", percorso: "/etc/passwd" }), undefined);
  assert.deepEqual(leggiAzione({ tipo: "leggi-elaborato", percorso: "mappe/tokyo.png" }), {
    tipo: "leggi-elaborato",
    percorso: "mappe/tokyo.png",
  });
});

test("dimensione e data dei file passano dal nodo al centro, e un nodo di prima non le manda", () => {
  const dettagli = [{ byte: 12, modificatoIl: "2026-11-12T10:00:00.000Z" }];
  assert.deepEqual(leggiEsito({ riuscita: true, testo: "1 file", file: ["a.md"], quantiFile: 1, dettagli }), {
    riuscita: true,
    testo: "1 file",
    file: ["a.md"],
    quantiFile: 1,
    dettagli,
  });
  assert.equal(leggiEsito({ riuscita: true, testo: "1 file", file: ["a.md"], quantiFile: 1 })?.dettagli, undefined);
  // Dettagli che non tornano con l'elenco si lasciano cadere, senza buttare l'elenco.
  const storti = leggiEsito({ riuscita: true, testo: "1 file", file: ["a.md"], dettagli: [{ byte: -1, modificatoIl: "x" }] });
  assert.deepEqual(storti?.file, ["a.md"]);
  assert.equal(storti?.dettagli, undefined);
});
