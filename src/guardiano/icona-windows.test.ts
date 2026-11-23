/**
 * L'icona del nodo su Windows (`icona-windows.ps1`). L'icona vera vuole Windows; qui si prova ciò
 * che si può prova senza: il file con il BOM, che Windows PowerShell 5.1 vuole per leggere le
 * lettere accentate; la sintassi, sua e dello script che prepara l'ambiente; e, con PowerShell,
 * le funzioni che leggono lo stato scritto dal nodo e decidono che cosa mostrare.
 *
 * PowerShell si cerca in SHINKA_PWSH, poi come `pwsh`: dove non c'è, le prove che lo vogliono si saltano.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FILE_STATO_DEL_COLLEGAMENTO, scriviStatoDelCollegamento } from "../nodo/stato-del-collegamento.ts";

const ICONA = join(import.meta.dirname, "icona-windows.ps1");
const PREPARA = join(import.meta.dirname, "..", "centro", "prepara-ambiente.ps1");
const PWSH = process.env.SHINKA_PWSH ?? "pwsh";
const conPowershell = spawnSync(PWSH, ["-NoProfile", "-Command", "exit 0"]).status === 0;
const salta = conPowershell ? false : "su questa macchina non c'è PowerShell";

/**
 * Le funzioni dell'icona, cioè il file fino a `-SoloFunzioni`. Il resto nomina le librerie grafiche
 * di Windows, che PowerShell su Linux non riesce nemmeno a caricare.
 */
function soloLeFunzioni(): string {
  const testo = readFileSync(ICONA, "utf8");
  const fine = testo.indexOf("if ($SoloFunzioni) { return }");
  assert.ok(fine > 0);
  const cartella = mkdtempSync(join(tmpdir(), "shinka-icona-funzioni-"));
  const file = join(cartella, "funzioni.ps1");
  writeFileSync(file, testo.slice(0, fine));
  return file;
}

/** Esegue un pezzo di PowerShell dopo aver caricato le funzioni dell'icona, e ne legge il JSON. */
function conLeFunzioni(codice: string, ambiente: Record<string, string> = {}): unknown {
  const funzioni = soloLeFunzioni();
  const esito = spawnSync(PWSH, ["-NoProfile", "-NonInteractive", "-Command", `. '${funzioni}' -SoloFunzioni; ${codice}`], {
    encoding: "utf8",
    env: { ...process.env, ...ambiente },
  });
  rmSync(join(funzioni, ".."), { recursive: true, force: true });
  assert.equal(esito.status, 0, esito.stderr);
  return JSON.parse(esito.stdout);
}

test("l'icona è in UTF-8 con il BOM, come vuole Windows PowerShell 5.1", () => {
  const byte = readFileSync(ICONA);
  assert.deepEqual([...byte.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.match(byte.toString("utf8"), /Si avvia…/);
});

test("l'icona e lo script che prepara l'ambiente sono PowerShell senza errori di sintassi", { skip: salta }, () => {
  for (const file of [ICONA, PREPARA]) {
    const esito = spawnSync(
      PWSH,
      ["-NoProfile", "-NonInteractive", "-Command", "$e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile($env:FILE, [ref]$null, [ref]$e); $e | ForEach-Object { $_.ToString() }; exit $e.Count"],
      { encoding: "utf8", env: { ...process.env, FILE: file } },
    );
    assert.equal(esito.status, 0, `${file}: ${esito.stdout}`);
  }
});

test("lo stato in parole: fermo, in avvio, in attesa con il codice, collegato, i problemi", { skip: salta }, () => {
  const casi = conLeFunzioni(`
    @(
      (Descrivi-Stato $false ([pscustomobject]@{ stato = 'attivo' }) $true),
      (Descrivi-Stato $true $null $false),
      (Descrivi-Stato $true ([pscustomobject]@{ stato = 'attivo'; pid = 1 }) $false),
      (Descrivi-Stato $true ([pscustomobject]@{ stato = 'collegamento' }) $true),
      (Descrivi-Stato $true ([pscustomobject]@{ stato = 'in-attesa'; codice = '123 456' }) $true),
      (Descrivi-Stato $true ([pscustomobject]@{ stato = 'attivo'; nome = 'PC' }) $true),
      (Descrivi-Stato $true ([pscustomobject]@{ stato = 'scollegato' }) $true),
      (Descrivi-Stato $true ([pscustomobject]@{ stato = 'rifiutato'; motivo = 'rimosso' }) $true)
    ) | ForEach-Object { [pscustomobject]@{ genere = $_.genere; testo = $_.testo } } | ConvertTo-Json -Compress`);
  assert.deepEqual(casi, [
    { genere: "fermo", testo: "Fermo" },
    { genere: "avvio", testo: "Si avvia…" },
    // Il file è di un nodo che non c'è più: non dice nulla di quello di adesso.
    { genere: "avvio", testo: "Si avvia…" },
    { genere: "avvio", testo: "Si collega al centro…" },
    { genere: "attesa", testo: "Aspetta il tuo consenso in Shinka, codice 123 456" },
    { genere: "attivo", testo: "Collegato al centro" },
    { genere: "problema", testo: "Centro non raggiungibile: riprova da solo" },
    { genere: "rifiutato", testo: "Rifiutato dal centro: rimosso" },
  ]);
});

test("l'icona legge lo stato come lo scrive il nodo, e riconosce il guardiano della sua cartella", { skip: salta }, async (t) => {
  const cartella = mkdtempSync(join(tmpdir(), "shinka-icona-"));
  t.after(() => rmSync(cartella, { recursive: true, force: true }));
  mkdirSync(join(cartella, "dati-nodo"));
  await scriviStatoDelCollegamento(join(cartella, "dati-nodo", FILE_STATO_DEL_COLLEGAMENTO), { stato: "in-attesa", codice: "042 117" }, 4242);
  writeFileSync(join(cartella, "dati-nodo", "nodo.json"), JSON.stringify({ centro: "http://192.168.1.20:7850", nome: "PC Windows" }));

  const letto = conLeFunzioni(
    `$l = Leggi-StatoDelCollegamento $env:CARTELLA; $n = Leggi-SceltaDelNodo $env:CARTELLA; $v = Leggi-StatoDelCollegamento (Join-Path $env:CARTELLA 'non-c-e');
     [pscustomobject]@{ stato = $l.stato; codice = $l.codice; pid = $l.pid; nome = $n.nome; centro = $n.centro; vuoto = ($null -eq $v) } | ConvertTo-Json -Compress`,
    { CARTELLA: cartella },
  );
  assert.deepEqual(letto, { stato: "in-attesa", codice: "042 117", pid: 4242, nome: "PC Windows", centro: "http://192.168.1.20:7850", vuoto: true });

  const riconosciuti = conLeFunzioni(`
    $c = 'C:\\Users\\Io\\Shinka\\nodo'
    @(
      (E-IlGuardiano '"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\Io\\Shinka\\nodo\\guardiano\\avvio-nodo.ts"' $c),
      (E-IlGuardiano '"C:\\Program Files\\nodejs\\node.exe" guardiano\\avvio-nodo.ts' $c),
      (E-IlGuardiano '"C:\\Program Files\\nodejs\\node.exe" "D:\\altro\\guardiano\\avvio-nodo.ts"' $c),
      (E-IlGuardiano '"C:\\Program Files\\nodejs\\node.exe" src\\nodo\\avvio.ts' $c),
      (E-IlGuardiano '' $c)
    ) | ConvertTo-Json -Compress`);
  // Il guardiano di un'altra cartella, con il percorso intero, non è il suo.
  assert.deepEqual(riconosciuti, [true, true, false, false, false]);

  const suggerimenti = conLeFunzioni(`@(
    (Testo-Suggerimento 'PC Windows' 'Collegato al centro'),
    (Testo-Suggerimento '' 'Fermo'),
    (Testo-Suggerimento 'PC Windows' 'Il centro vuole il collegamento cifrato, e il nodo non riesce ad aprirlo')
  ) | ConvertTo-Json -Compress`) as string[];
  assert.equal(suggerimenti[0], "Shinka · PC Windows: Collegato al centro");
  assert.equal(suggerimenti[1], "Shinka: Fermo");
  assert.equal(suggerimenti[2]?.length, 63);
  assert.ok(suggerimenti[2]?.endsWith("…"));
});
