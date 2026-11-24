/**
 * I modelli locali (ADR 0051): un server vero, fatto con Node al posto di llama-server, acceso quando
 * una conversazione lo prende, con l'impegno negli argomenti, e spento quando resta fermo.
 */

import assert from "node:assert/strict";
import { createServer, type AddressInfo } from "node:net";
import { createServer as serverHttp } from "node:http";
import { test } from "node:test";
import type { EstensioneDistribuita } from "../protocollo/estensioni.ts";
import { ModelliLocali, type DefinizioneModelloLocale } from "./modelli-locali.ts";

async function portaLibera(): Promise<number> {
  const server = createServer();
  await new Promise<void>((fatto) => server.listen(0, "127.0.0.1", fatto));
  const porta = (server.address() as AddressInfo).port;
  await new Promise<void>((fatto) => server.close(() => fatto()));
  return porta;
}

/** Un server che risponde su /health e dice su /impegno con quale impegno è partito. */
const PROGRAMMA = `
const [porta, impegno] = process.argv.slice(-2);
require("node:http").createServer((richiesta, risposta) => {
  risposta.end(richiesta.url === "/impegno" ? impegno : JSON.stringify({ status: "ok" }));
}).listen(Number(porta), "127.0.0.1");
`;

function definizione(porta: number, comando = process.execPath, argomenti = ["-e", PROGRAMMA, String(porta), "{impegno}"]): DefinizioneModelloLocale {
  return { tipo: "modello-locale", comando, argomenti, variabili: {}, porta, modello: "qwen-prova", contesto: 98_304, uscita: 32_000, impegni: ["xhigh", "medium"] };
}

function estensione(def: DefinizioneModelloLocale, nome = "qwen"): EstensioneDistribuita {
  return { id: "e1", nome, definizione: def, chiavi: [] };
}

async function risponde(porta: number, percorso = "/health"): Promise<string | undefined> {
  try {
    const risposta = await fetch(`http://127.0.0.1:${porta}${percorso}`, { signal: AbortSignal.timeout(1000) });
    return await risposta.text();
  } catch {
    return undefined;
  }
}

async function finche(condizione: () => Promise<boolean> | boolean, cosa: string, ms = 10_000): Promise<void> {
  const scade = Date.now() + ms;
  while (!(await condizione())) {
    if (Date.now() > scade) throw new Error(`Non è successo: ${cosa}`);
    await new Promise((fatto) => setTimeout(fatto, 50));
  }
}

test("il server si accende quando una conversazione prende il modello, e si spegne quando resta fermo", async (t) => {
  const porta = await portaLibera();
  const modelli = new ModelliLocali({ fermoMs: 300, passoMs: 50, vram: async () => 21_000 });
  t.after(() => modelli.chiudi());
  modelli.imposta([estensione(definizione(porta)), { id: "e2", nome: "altro", definizione: { tipo: "mcp-remoto", indirizzo: "https://x", trasporto: "http" }, chiavi: [] }]);
  assert.deepEqual(
    modelli.modelli().map((voce) => [voce.valore, voce.nome, voce.motore, voce.impegni]),
    [["locale:qwen", "qwen-prova (locale)", "claude", ["xhigh", "medium"]]],
  );

  assert.match((modelli.prendi("locale:nessuno") as { motivo: string }).motivo, /non è acceso in questo ambiente/);
  assert.match((modelli.prendi("locale:qwen", "low") as { motivo: string }).motivo, /accetta questi impegni: xhigh, medium/);

  const prima = modelli.prendi("locale:qwen");
  assert.ok(!("motivo" in prima));
  assert.equal(prima.indirizzo, `http://127.0.0.1:${porta}`);
  assert.equal(prima.modello, "qwen-prova");
  await prima.pronto;
  // Senza un impegno chiesto, il primo della definizione.
  assert.equal(await risponde(porta, "/impegno"), "xhigh");
  await finche(() => prima.vramPiccoMb() === 21_000, "la scheda video viene misurata");

  // Una seconda conversazione con lo stesso impegno usa lo stesso server; con un altro aspetta.
  const seconda = modelli.prendi("locale:qwen", "xhigh");
  assert.ok(!("motivo" in seconda));
  assert.match((modelli.prendi("locale:qwen", "medium") as { motivo: string }).motivo, /acceso con impegno xhigh e lo sta usando un'altra conversazione/);
  prima.lascia();
  prima.lascia();
  await new Promise((fatto) => setTimeout(fatto, 500));
  assert.notEqual(await risponde(porta), undefined, "una conversazione lo usa ancora");
  seconda.lascia();
  await finche(async () => (await risponde(porta)) === undefined, "il server si spegne dopo il tempo da fermo");
  assert.equal(modelli.acceso("qwen"), false);

  // Ripreso con un altro impegno, riparte con quello.
  const terza = modelli.prendi("locale:qwen", "medium");
  assert.ok(!("motivo" in terza));
  await terza.pronto;
  assert.equal(await risponde(porta, "/impegno"), "medium");
  // Ripreso prima che si spenga, resta acceso.
  terza.lascia();
  const quarta = modelli.prendi("locale:qwen", "medium");
  assert.ok(!("motivo" in quarta));
  await new Promise((fatto) => setTimeout(fatto, 500));
  assert.equal(await risponde(porta, "/impegno"), "medium");
  // Tolta l'estensione mentre la si usa, il server resta finché non la si lascia.
  modelli.imposta([]);
  assert.notEqual(await risponde(porta), undefined);
  quarta.lascia();
  await finche(async () => (await risponde(porta)) === undefined, "il server si spegne");
});

test("un server già acceso dal proprietario si usa e non si spegne; uno che non parte lo dice", async (t) => {
  const porta = await portaLibera();
  const suo = serverHttp((_richiesta, risposta) => risposta.end("ok"));
  await new Promise<void>((fatto) => suo.listen(porta, "127.0.0.1", fatto));
  t.after(() => suo.close());
  const modelli = new ModelliLocali({ fermoMs: 50, passoMs: 50, vram: async () => undefined });
  t.after(() => modelli.chiudi());
  // Il comando non esiste: se lo si avviasse, fallirebbe.
  modelli.imposta([estensione(definizione(porta, "/non/esiste/llama-server"))]);
  const presa = modelli.prendi("locale:qwen");
  assert.ok(!("motivo" in presa));
  await presa.pronto;
  presa.lascia();
  await new Promise((fatto) => setTimeout(fatto, 300));
  assert.equal(await risponde(porta), "ok");

  const altra = await portaLibera();
  const rotto = new ModelliLocali({ passoMs: 50, vram: async () => undefined });
  rotto.imposta([estensione(definizione(altra, process.execPath, ["-e", "console.error('modello non trovato'); process.exit(3)"]))]);
  const fallita = rotto.prendi("locale:qwen");
  assert.ok(!("motivo" in fallita));
  await assert.rejects(fallita.pronto, /si è fermato \(codice 3\)\.\nmodello non trovato/);
  assert.equal(rotto.acceso("qwen"), false);

  const lento = new ModelliLocali({ passoMs: 50, attesaMs: 300, vram: async () => undefined });
  lento.imposta([estensione(definizione(altra, process.execPath, ["-e", "setTimeout(() => {}, 5000)"]))]);
  const atteso = lento.prendi("locale:qwen");
  assert.ok(!("motivo" in atteso));
  await assert.rejects(atteso.pronto, /non ha risposto su 127\.0\.0\.1:\d+ entro 0 secondi/);
});

test("la prova accende il server, dice il suo modello e lo spegne", async () => {
  const porta = await portaLibera();
  const modelli = new ModelliLocali({ passoMs: 50, vram: async () => undefined });
  const esito = await modelli.prova(definizione(porta));
  assert.deepEqual(esito, { riuscita: true, strumenti: ["qwen-prova"] });
  await finche(async () => (await risponde(porta)) === undefined, "dopo la prova il server è spento");
  const rotta = await modelli.prova(definizione(porta, "/non/esiste/llama-server"));
  assert.equal(rotta.riuscita, false);
});
