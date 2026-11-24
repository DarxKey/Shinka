import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { leggiAttivita } from "../protocollo/attivita.ts";
import { RegistroAttivita } from "./attivita.ts";

test("comandi e agenti diventano attività, con stato, progressi, riassunto e uscita", async (t) => {
  const cartella = mkdtempSync(join(tmpdir(), "shinka-attivita-"));
  t.after(() => rm(cartella, { recursive: true, force: true }));
  const uscita = join(cartella, "uscita.txt");
  writeFileSync(uscita, "riga uno\nUSCITA\n");
  const registro = new RegistroAttivita();
  assert.equal(registro.ricevi({ subtype: "task_started", task_id: "c1", description: "Test lunghi", task_type: "local_bash", is_backgrounded: true }), true);
  assert.equal(registro.ricevi({ subtype: "task_started", task_id: "a1", description: "Cerca i file", task_type: "local_agent", subagent_type: "Explore" }), true);
  // Ciò che non è lavoro non compare.
  assert.equal(registro.ricevi({ subtype: "task_started", task_id: "x", description: "osservatore", ambient: true }), false);
  assert.equal(registro.ricevi({ subtype: "task_progress", task_id: "x", description: "", usage: { tool_uses: 1, duration_ms: 1 } }), false);
  registro.ricevi({ subtype: "task_progress", task_id: "a1", description: "Cerca i file", usage: { tool_uses: 3, duration_ms: 4200 }, last_tool_name: "Grep" });
  assert.deepEqual(registro.elenco().map((voce) => [voce.id, voce.genere, voce.stato]), [
    ["a1", "agente", "in-corso"],
    ["c1", "comando", "in-corso"],
  ]);
  assert.equal(registro.elenco()[0]?.ultimoStrumento, "Grep");

  registro.ricevi({ subtype: "task_notification", task_id: "c1", status: "completed", output_file: uscita, summary: "Finito (codice 0)" });
  registro.ricevi({ subtype: "task_updated", task_id: "a1", patch: { status: "failed", error: "Troppi file" } });
  const [primo, secondo] = registro.elenco();
  assert.deepEqual([primo?.id, primo?.stato, primo?.riassunto], ["a1", "fallita", "Troppi file"]);
  assert.deepEqual([secondo?.id, secondo?.stato, secondo?.conUscita, secondo?.inSfondo], ["c1", "finita", true, true]);
  assert.deepEqual(await registro.uscita("c1"), { testo: "riga uno\nUSCITA\n", troncata: false });
  assert.ok("motivo" in (await registro.uscita("a1")));
  // Un elenco arrivato da un nodo si rilegge uguale.
  assert.deepEqual(leggiAttivita(JSON.parse(JSON.stringify(registro.elenco()))), registro.elenco());
});

test("chiuso il processo, ciò che lavorava risulta fermato; delle finite si tengono le ultime", () => {
  const registro = new RegistroAttivita();
  registro.ricevi({ subtype: "task_started", task_id: "c1", description: "Server", task_type: "local_bash", is_backgrounded: true });
  assert.equal(registro.processoChiuso(), true);
  assert.equal(registro.elenco()[0]?.stato, "fermata");
  assert.equal(registro.processoChiuso(), false);
  for (let i = 0; i < 30; i += 1) {
    registro.ricevi({ subtype: "task_started", task_id: `t${i}`, description: `Compito ${i}`, task_type: "local_bash" });
    registro.ricevi({ subtype: "task_notification", task_id: `t${i}`, status: "completed", output_file: "", summary: "" });
  }
  const elenco = registro.elenco();
  assert.equal(elenco.length, 20);
  assert.equal(elenco[0]?.id, "t29");
});

test("un comando in background mostra che cosa esegue, e la sua uscita si legge mentre lavora", async (t) => {
  const cartella = mkdtempSync(join(tmpdir(), "shinka-attivita-"));
  t.after(() => rm(cartella, { recursive: true, force: true }));
  const uscita = join(cartella, "b7k2.output");
  writeFileSync(uscita, "Compilo…\n");
  const registro = new RegistroAttivita();
  registro.azioneIniziata("toolu_1", "Bash", { command: "npm run build -- --watch", run_in_background: true, description: "Build" });
  registro.azioneIniziata("toolu_2", "Read", { file_path: "/a" });
  registro.ricevi({ subtype: "task_started", task_id: "b7k2", tool_use_id: "toolu_1", description: "Build", task_type: "local_bash", is_backgrounded: true });
  assert.equal(registro.elenco()[0]?.comando, "npm run build -- --watch");
  assert.equal(registro.elenco()[0]?.conUscita, undefined);
  // L'harness risponde all'azione dicendo dove scrive l'uscita.
  assert.equal(registro.azioneConclusa("toolu_1", `Command running in background with ID: b7k2. Output is being written to: ${uscita}.`), true);
  assert.equal(registro.elenco()[0]?.conUscita, true);
  assert.equal(registro.elenco()[0]?.stato, "in-corso");
  assert.deepEqual(await registro.uscita("b7k2"), { testo: "Compilo…\n", troncata: false });
  // Una risposta qualunque non cambia nulla.
  assert.equal(registro.azioneConclusa("toolu_2", "contenuto del file"), false);
  assert.deepEqual(leggiAttivita(JSON.parse(JSON.stringify(registro.elenco()))), registro.elenco());
});
