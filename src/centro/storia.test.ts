import assert from "node:assert/strict";
import { test } from "node:test";
import type { EventoArchiviato, EventoConversazione } from "../protocollo/eventi.ts";
import { cerca, fileScritti, paroleDi, trascrivi, ultimaRichiesta, ultimoResoconto } from "./storia.ts";

function storia(...eventi: EventoConversazione[]): EventoArchiviato[] {
  return eventi.map((evento, i) => ({ n: i + 1, quando: "2026-11-11T10:00:00.000Z", evento }));
}

function azione(id: string, strumento: string, ingresso: unknown, esito = "ok", errore = false): EventoConversazione[] {
  return [
    { tipo: "azione-iniziata", idAzione: id, strumento, ingresso },
    { tipo: "azione-conclusa", idAzione: id, esito, errore },
  ];
}

test("i file scritti si ricavano dalle azioni riuscite, una volta sola e con l'ultimo contenuto", () => {
  const scritti = fileScritti(
    storia(
      ...azione("a1", "Write", { file_path: "/srv/_home/x/elenco.py", content: "print(1)" }),
      ...azione("a2", "Write", { file_path: "/srv/_home/x/elenco.py", content: "print(2)" }),
      // Una modifica non cancella il testo intero che la storia conserva.
      ...azione("a3", "Edit", { file_path: "/srv/_home/x/elenco.py", old_string: "2", new_string: "3" }),
      ...azione("a4", "Edit", { file_path: "/srv/_home/x/altro.txt", old_string: "a", new_string: "b" }),
      // Un'azione fallita non ha scritto nulla.
      ...azione("a5", "Write", { file_path: "/srv/_home/x/mai.txt", content: "x" }, "permesso negato", true),
      // Nell'altro ambiente il percorso completo lo dice l'esito.
      ...azione(
        "a6",
        "mcp__shinka__scrivi_file",
        { ambiente: "PC Windows", percorso: "prova.ps1", contenuto: "Write-Output 1" },
        'File scritto in "PC Windows": D:\\Progetti\\_home\\x\\prova.ps1',
      ),
      ...azione("a7", "Bash", { command: "echo ciao > da-comando.txt" }),
    ),
  );
  assert.deepEqual(scritti, [
    { percorso: "/srv/_home/x/elenco.py", contenuto: "print(2)" },
    { percorso: "/srv/_home/x/altro.txt" },
    { percorso: "D:\\Progetti\\_home\\x\\prova.ps1", ambiente: "PC Windows", contenuto: "Write-Output 1" },
  ]);
});

test("l'ultimo resoconto e l'ultima richiesta sono gli ultimi testi non vuoti", () => {
  const conversazione = storia(
    { tipo: "messaggio-proprietario", id: "m1", testo: "Fai il livello 1." },
    { tipo: "testo-concluso", idTesto: "t1", testo: "Comincio." },
    { tipo: "messaggio-proprietario", id: "m2", testo: " E il punteggio. " },
    { tipo: "testo-concluso", idTesto: "t2", testo: "Livello 1 fatto, manca il punteggio.\n" },
    { tipo: "testo-concluso", idTesto: "t3", testo: "   " },
  );
  assert.equal(ultimoResoconto(conversazione), "Livello 1 fatto, manca il punteggio.");
  assert.equal(ultimaRichiesta(conversazione), "E il punteggio.");
  assert.equal(ultimoResoconto([]), undefined);
  assert.equal(ultimaRichiesta([]), undefined);
});

test("la trascrizione dice chi ha detto cosa e quali azioni sono state fatte, e tiene la parte più recente", () => {
  const conversazione = storia(
    { tipo: "messaggio-proprietario", id: "m1", testo: "Prova lo script." },
    { tipo: "turno-iniziato" },
    ...azione("a1", "mcp__shinka__esegui_in_ambiente", { ambiente: "PC Windows", comando: ".\\prova.ps1" }),
    { tipo: "testo-concluso", idTesto: "t1", testo: "Funziona." },
    { tipo: "turno-concluso", riuscito: true, durataMs: 5 },
  );
  assert.equal(
    trascrivi(conversazione, "Home"),
    "Proprietario: Prova lo script.\n[azione mcp__shinka__esegui_in_ambiente: .\\prova.ps1]\nHome: Funziona.",
  );
  const tagliata = trascrivi(conversazione, "Home", 20);
  assert.match(tagliata, /^\[… parte precedente omessa …\]\n/);
  assert.ok(tagliata.endsWith("Home: Funziona."));
});

test("la ricerca pesa titolo, riassunto e nomi dei file più di ciò che è stato detto", () => {
  const cercabili = [
    {
      id: "foto",
      titolo: "Rinominare le foto",
      riassunto: "Script PowerShell provato sul PC.",
      storia: storia(...azione("a1", "Write", { file_path: "/x/rinomina.ps1", content: "Get-ChildItem" })),
    },
    {
      id: "meteo",
      titolo: "Meteo",
      riassunto: "",
      storia: storia({ tipo: "messaggio-proprietario", id: "m1", testo: "Domani piove? Devo fare le foto in giardino." }),
    },
    { id: "ricette", titolo: "Ricette", riassunto: "Il ragù.", storia: [] },
  ];

  const trovati = cerca(cercabili, "Lo script che rinomina le FOTO");
  assert.deepEqual(trovati.map((trovato) => trovato.id), ["foto", "meteo"]);
  assert.ok((trovati[0]?.peso ?? 0) > (trovati[1]?.peso ?? 0));
  assert.match(trovati[1]?.brano ?? "", /fare le foto in giardino/);

  // Si trova anche per ciò che un file contiene, e senza badare agli accenti.
  assert.deepEqual(cerca(cercabili, "get-childitem").map((trovato) => trovato.id), ["foto"]);
  assert.deepEqual(cerca(cercabili, "ragu").map((trovato) => trovato.id), ["ricette"]);
  assert.deepEqual(cerca(cercabili, "dichiarazione dei redditi"), []);
  // Parole troppo comuni o troppo corte non bastano per cercare.
  assert.deepEqual(cerca(cercabili, "che per il"), []);
  assert.deepEqual(paroleDi("Perché NON lo script-nuovo, lo script?"), ["perche", "script", "nuovo"]);
});
