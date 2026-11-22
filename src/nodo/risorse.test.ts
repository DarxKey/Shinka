import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { leggiRisorse } from "../protocollo/risorse.ts";
import { CampionatoreRisorse, type EseguiProgramma } from "./risorse.ts";

/** Una cartella dei processi finta: due processi, con i tic di processore dati. */
function procFinto(tic: Record<number, number>): string {
  const proc = mkdtempSync(join(tmpdir(), "shinka-proc-"));
  writeFileSync(join(proc, "meminfo"), "MemTotal:       16000000 kB\nMemFree:         1000000 kB\nMemAvailable:   12000000 kB\n");
  mkdirSync(join(proc, "self"));
  for (const [pid, suoi] of Object.entries(tic)) {
    mkdirSync(join(proc, pid));
    // Il nome può avere spazi e parentesi: i campi contano dall'ultima chiusa.
    const nome = pid === "10" ? "node (centro)" : "postgres";
    writeFileSync(join(proc, pid, "stat"), `${pid} (${nome}) S 1 1 1 0 -1 4194560 100 0 0 0 ${suoi} 0 0 0 20 0 1 0 100 1000000 ${pid === "10" ? 50000 : 2000} 18446744073709551615 0 0 0 0 0 0 0 0 0 0 0 0 17 0 0 0 0 0 0`);
    writeFileSync(join(proc, pid, "cmdline"), pid === "10" ? "node\0src/centro/avvio.ts\0" : "");
  }
  return proc;
}

const senzaDocker: EseguiProgramma = async () => ({ codice: null, uscita: "", errori: "", assente: true });

test("su Linux: memoria da ciò che è disponibile, e il processore di ogni processo dalla differenza tra due letture", async () => {
  const orologio = { ora: 1_000_000 };
  const proc = procFinto({ 10: 500, 20: 100 });
  const campionatore = new CampionatoreRisorse({ radiceProgetti: tmpdir(), piattaforma: "linux", proc, esegui: senzaDocker, adesso: () => orologio.ora });
  const prima = await campionatore.leggi();
  assert.deepEqual(prima.campione.memoria, { usata: 4_000_000 * 1024, totale: 16_000_000 * 1024 });
  assert.equal(prima.quantiProcessi, 2);
  assert.equal(prima.docker.stato, "assente");
  assert.ok(prima.campione.cpu >= 0 && prima.campione.cpu <= 100);
  assert.ok((prima.campione.disco?.totale ?? 0) > 0);

  // Due secondi dopo il processo 10 ha usato un secondo di processore (100 tic): metà di un nucleo.
  writeFileSync(join(proc, "10", "stat"), `10 (node (centro)) S 1 1 1 0 -1 4194560 100 0 0 0 600 0 0 0 20 0 1 0 100 1000000 50000 18446744073709551615 0 0 0 0 0 0 0 0 0 0 0 0 17 0 0 0 0 0 0`);
  orologio.ora += 2_000;
  const dopo = await campionatore.leggi();
  assert.deepEqual(dopo.processi, [
    { pid: 10, nome: "node (centro)", cpu: 50, memoria: 50000 * 4096, comando: "node src/centro/avvio.ts" },
    { pid: 20, nome: "postgres", cpu: 0, memoria: 2000 * 4096 },
  ]);
  // Ciò che il nodo manda supera il controllo del centro così com'è.
  assert.deepEqual(leggiRisorse(JSON.parse(JSON.stringify(dopo))), dopo);
});

test("Docker: assente, non raggiungibile, oppure con i suoi container; si rilegge ogni tanto, non a ogni campione", async () => {
  const orologio = { ora: 1_000_000 };
  const chiesti: string[] = [];
  let modo: "negato" | "attivo" = "negato";
  const esegui: EseguiProgramma = async (programma, argomenti) => {
    chiesti.push(`${programma} ${argomenti[0]}`);
    if (modo === "negato") return { codice: 1, uscita: "", errori: "permission denied while trying to connect to the Docker daemon socket\naltro" };
    return argomenti[0] === "ps"
      ? { codice: 0, uscita: JSON.stringify({ Names: "plex", Image: "plex", State: "running", Status: "Up 3 days", Ports: "", Labels: "" }), errori: "" }
      : { codice: 0, uscita: JSON.stringify({ Name: "plex", CPUPerc: "5.00%", MemUsage: "1GiB / 2GiB" }), errori: "" };
  };
  const campionatore = new CampionatoreRisorse({ radiceProgetti: tmpdir(), piattaforma: "linux", proc: procFinto({ 10: 1 }), esegui, adesso: () => orologio.ora });
  assert.deepEqual((await campionatore.leggi()).docker, { stato: "non-raggiungibile", motivo: "permission denied while trying to connect to the Docker daemon socket", contenitori: [] });
  assert.deepEqual(chiesti, ["docker ps"]);

  // Subito dopo non si richiede a Docker; passati otto secondi sì.
  modo = "attivo";
  orologio.ora += 3_000;
  assert.equal((await campionatore.leggi()).docker.stato, "non-raggiungibile");
  assert.equal(chiesti.length, 1);
  orologio.ora += 6_000;
  await campionatore.leggi();
  await new Promise((fatto) => setTimeout(fatto, 20));
  orologio.ora += 1_000;
  assert.deepEqual((await campionatore.leggi()).docker, {
    stato: "attivo",
    contenitori: [{ nome: "plex", immagine: "plex", stato: "running", dettaglio: "Up 3 days", porte: "", cpu: 5, memoria: { usata: 1_073_741_824, limite: 2_147_483_648 } }],
  });
  assert.deepEqual(chiesti, ["docker ps", "docker ps", "docker stats"]);
});

test("su Windows i processi li dice PowerShell, e il carico è la differenza dei secondi di processore", async () => {
  const orologio = { ora: 1_000_000 };
  let secondi = 10;
  const esegui: EseguiProgramma = async (programma) => {
    if (programma === "docker") return { codice: null, uscita: "", errori: "", assente: true };
    return { codice: 0, uscita: JSON.stringify([{ Id: 4, ProcessName: "System", CPU: null, WorkingSet64: 1000 }, { Id: 900, ProcessName: "chrome", CPU: secondi, WorkingSet64: 500_000_000 }]), errori: "" };
  };
  const campionatore = new CampionatoreRisorse({ radiceProgetti: tmpdir(), piattaforma: "win32", esegui, adesso: () => orologio.ora });
  const prima = await campionatore.leggi();
  assert.equal(prima.campione.carico, undefined);
  assert.deepEqual(prima.processi.map((uno) => [uno.nome, uno.cpu]), [["chrome", 0], ["System", 0]]);
  // Dieci secondi dopo chrome ha usato altri cinque secondi di processore: metà di un nucleo.
  secondi = 15;
  orologio.ora += 10_000;
  const dopo = await campionatore.leggi();
  assert.deepEqual(dopo.processi[0], { pid: 900, nome: "chrome", cpu: 50, memoria: 500_000_000 });
  assert.equal(dopo.quantiProcessi, 2);
});
