/**
 * Prova gli stack di prova contro il Docker vero di un host, senza passare dal vault: i comandi
 * sono quelli che scrive il gateway, ma a portarli all'host è il client SSH di questa macchina,
 * con la chiave di chi lancia la prova. Serve a chi sviluppa Shinka, non a Shinka.
 *
 * Uso:
 *   node src/prove/stack-su-host.ts <utente@host> <da>-<a> <radice> <operazione> [nome | file.json]
 *
 *   SHINKA_PROVA_CHIAVE  il file della chiave privata da dare a ssh (se manca, quella solita)
 *
 * Operazioni: elenca, avvia (con il file JSON della descrizione), leggi, ferma, rimuovi (con il nome).
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { leggiRecinto, type RichiestaStack } from "../protocollo/stack.ts";
import type { VoceRegistro } from "../protocollo/vault.ts";
import { StackDiProva, type EseguiPerStack } from "../gateway/stack.ts";
import type { CredenzialePerUso } from "../gateway/vault.ts";

const [destinazione, intervallo, radice, operazione, argomento] = process.argv.slice(2);
if (destinazione === undefined || intervallo === undefined || radice === undefined || operazione === undefined) {
  console.error("Uso: node src/prove/stack-su-host.ts <utente@host> <da>-<a> <radice> <operazione> [nome | file.json]");
  process.exit(2);
}
const [da, a] = intervallo.split("-").map(Number);
const recinto = leggiRecinto({ porte: { da, a }, radice });
if (typeof recinto === "string") {
  console.error(recinto);
  process.exit(2);
}
const [utente = "", macchina = ""] = destinazione.split("@");
const host = `${macchina}:22`;
const chiave = process.env.SHINKA_PROVA_CHIAVE;

const conSsh: EseguiPerStack = (_credenziale, comando, durataMs, ingresso) =>
  new Promise((risolvi, rifiuta) => {
    const inizio = Date.now();
    const processo = spawn(
      "ssh",
      [...(chiave === undefined ? [] : ["-i", chiave]), "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", destinazione, comando],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let uscita = "";
    let errori = "";
    let scaduto = false;
    const scadenza = setTimeout(() => {
      scaduto = true;
      processo.kill();
    }, durataMs);
    processo.stdout.on("data", (pezzo: Buffer) => (uscita += pezzo.toString("utf8")));
    processo.stderr.on("data", (pezzo: Buffer) => (errori += pezzo.toString("utf8")));
    processo.on("error", rifiuta);
    processo.on("close", (codice) => {
      clearTimeout(scadenza);
      risolvi({ codice: scaduto ? null : codice, uscita, errori, scaduto, impronta: "", durataMs: Date.now() - inizio });
    });
    processo.stdin.end(ingresso ?? "");
  });

const credenziale: CredenzialePerUso = { nome: "prova", tipo: "chiave", utente, host: macchina, porta: 22, segreto: "" };
const registro: VoceRegistro[] = [];
const stack = new StackDiProva(
  {
    hostPerGliStack: () => [{ host, credenziale: "prova", recinto }],
    perStack: () => ({ credenziale, recinto, host }),
    annotaUso: async () => {},
  },
  { annota: async (voce) => void registro.push(voce) },
  conSsh,
);

const base = { conversazione: "Prova di chi sviluppa" };
let richiesta: RichiestaStack;
switch (operazione) {
  case "elenca":
    richiesta = { ...base, operazione };
    break;
  case "avvia":
    richiesta = { ...base, operazione, host, stack: JSON.parse(readFileSync(argomento ?? "", "utf8")) as unknown };
    break;
  case "leggi":
  case "ferma":
    richiesta = { ...base, operazione, host, nome: argomento ?? "" };
    break;
  case "rimuovi":
    richiesta = { ...base, operazione, host, nome: argomento ?? "" };
    break;
  default:
    console.error(`Operazione sconosciuta: ${operazione}`);
    process.exit(2);
}

const esito = await stack.esegui(richiesta);
console.log(esito.esito === "fatto" ? esito.testo : `[${esito.esito}] ${esito.motivo}`);
console.log("\nNel registro:");
for (const voce of registro) console.log(`- ${voce.esito} · ${voce.comando}${voce.motivo === undefined ? "" : ` · ${voce.motivo.split("\n")[0]}`}`);
process.exit(esito.esito === "fatto" ? 0 : 1);
