/**
 * I modelli locali in rete (ADR 0053): un modello acceso su un nodo, messo in rete dal proprietario,
 * lo usa anche il centro. Il nodo accende il server con la chiave, in ascolto dalla rete; il centro lo
 * raggiunge all'indirizzo del nodo, e lo lascia quando ha finito. Al posto di llama-server, un server
 * di Node che vuole la chiave come lui.
 */

import assert from "node:assert/strict";
import { createServer, type AddressInfo } from "node:net";
import { test } from "node:test";
import { argomentiInRete, type FonteModelliLocali, type PresaDelModello } from "../nodo/modelli-locali.ts";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { allestisci, avviaNodoAccettato, ID_NODO } from "../prove/banco.ts";
import { ModelliInRete, unisciModelli } from "./modelli-in-rete.ts";

async function portaLibera(): Promise<number> {
  const server = createServer();
  await new Promise<void>((fatto) => server.listen(0, "127.0.0.1", fatto));
  const porta = (server.address() as AddressInfo).port;
  await new Promise<void>((fatto) => server.close(() => fatto()));
  return porta;
}

/** Come llama-server: /health risponde a tutti, il resto solo con la chiave, se ce n'è una. */
const PROGRAMMA = `
const a = process.argv;
const dopo = (nome) => (a.includes(nome) ? a[a.indexOf(nome) + 1] : undefined);
const chiave = dopo("--api-key");
require("node:http").createServer((q, r) => {
  if (q.url === "/health") return r.end("ok");
  const data = q.headers.authorization === "Bearer " + chiave || chiave === undefined;
  r.statusCode = data ? 200 : 401;
  r.end(data ? "risposta" : "chiave sbagliata");
}).listen(Number(dopo("--port")), dopo("--host"));
`;

test("gli argomenti di un server in rete: ascolta da tutte le interfacce, con la chiave, al posto di quelli scritti", () => {
  assert.deepEqual(argomentiInRete(["-m", "q.gguf", "--host", "127.0.0.1", "--port", "8081", "--api-key=vecchia"], "nuova"), [
    "-m",
    "q.gguf",
    "--port",
    "8081",
    "--host",
    "0.0.0.0",
    "--api-key",
    "nuova",
  ]);
});

test("a parità di nome vale il modello di questo ambiente; gli altri arrivano dalla rete", () => {
  const voce = (valore: string, nome: string) => ({ valore, nome, descrizione: "", impegni: ["medium" as const], motore: "claude" as const });
  const presi: string[] = [];
  const fonte = (quale: string, voci: ReturnType<typeof voce>[]): FonteModelliLocali => ({
    modelli: () => voci,
    prendi: (modello) => {
      presi.push(`${quale}:${modello}`);
      return { motivo: "prova" };
    },
  });
  const unite = unisciModelli(fonte("qui", [voce("locale:qwen", "qui")]), fonte("rete", [voce("locale:qwen", "rete"), voce("locale:gemma", "rete")]));
  assert.deepEqual(unite.modelli().map((una) => una.nome), ["qui", "rete"]);
  unite.prendi("locale:qwen");
  unite.prendi("locale:gemma");
  assert.deepEqual(presi, ["qui:locale:qwen", "rete:locale:gemma"]);
});

test("un modello acceso su un nodo e messo in rete lo usa il centro, con la sua chiave", { timeout: 60_000 }, async (t) => {
  const banco = await allestisci(t, { estensioni: {} });
  const estensioni = banco.estensioni;
  assert.ok(estensioni !== undefined);
  await avviaNodoAccettato(t, banco);
  const porta = await portaLibera();
  const programma = join(banco.cartella, "server-del-modello.cjs");
  await writeFile(programma, PROGRAMMA);
  const proposta = await estensioni.proponi({
    nome: "qwen",
    descrizione: "Qwen sulla scheda video.",
    idAmbiente: ID_NODO,
    definizione: {
      tipo: "modello-locale",
      comando: process.execPath,
      argomenti: [programma, "--port", String(porta), "--host", "127.0.0.1"],
      variabili: {},
      porta,
      modello: "qwen-prova",
      contesto: 65_536,
      uscita: 16_000,
      impegni: ["medium", "xhigh"],
    },
    chiavi: [],
  });
  assert.ok("idProposta" in proposta, JSON.stringify(proposta));
  const accesa = await estensioni.conferma(proposta.idProposta);
  assert.equal(accesa?.stato, "accesa", JSON.stringify(accesa));
  const id = estensioni.stato().estensioni[0]?.id ?? "";

  const inRete = new ModelliInRete({ modelli: () => estensioni.modelliInRete(), ambienti: banco.ambienti, attesaMs: 20_000 });
  // Finché non è in rete il centro non lo vede.
  assert.deepEqual(inRete.modelli(), []);
  assert.match(await estensioni.impostaInRete(id, ID_NODO, "127.0.0.1:80") ?? "", /senza porta/);
  assert.equal(await estensioni.impostaInRete(id, ID_NODO, "127.0.0.1"), undefined);
  // La chiave non esce nello stato che vedono la pagina e le conversazioni.
  assert.doesNotMatch(JSON.stringify(estensioni.stato()), /chiave/);
  const [modello] = estensioni.modelliInRete();
  assert.ok(modello !== undefined && modello.chiave.length >= 16);
  assert.partialDeepStrictEqual(inRete.modelli(), [{ valore: "locale:qwen", nome: "qwen-prova (in rete, PC Windows)", impegni: ["medium", "xhigh"] }]);

  // Il nodo riceve la chiave con l'estensione: finché non l'ha ricevuta risponde che non è in rete.
  let presa: PresaDelModello | undefined;
  const scade = Date.now() + 20_000;
  while (presa === undefined) {
    assert.ok(Date.now() < scade, "il nodo accende il modello in rete");
    const tentativo = inRete.prendi("locale:qwen", "xhigh");
    assert.ok(!("motivo" in tentativo), JSON.stringify(tentativo));
    try {
      await tentativo.pronto;
      presa = tentativo;
    } catch (errore) {
      tentativo.lascia();
      assert.match(String(errore), /non è in rete/);
      await new Promise((fatto) => setTimeout(fatto, 100));
    }
  }
  assert.ok(presa !== undefined);
  assert.equal(presa.indirizzo, `http://127.0.0.1:${porta}`);
  assert.equal(presa.chiave, modello.chiave);
  // Con la chiave risponde; senza no.
  const con = await fetch(`${presa.indirizzo}/v1/messages`, { method: "POST", headers: { authorization: `Bearer ${presa.chiave}` } });
  assert.equal(con.status, 200);
  const senza = await fetch(`${presa.indirizzo}/v1/messages`, { method: "POST" });
  assert.equal(senza.status, 401);
  presa.lascia();

  // Tolto dalla rete, il centro non lo offre più e il nodo non lo accende per lui.
  assert.equal(await estensioni.impostaInRete(id, ID_NODO, undefined), undefined);
  assert.deepEqual(inRete.modelli(), []);
  const rifiuto = inRete.prendi("locale:qwen");
  assert.ok("motivo" in rifiuto);
  assert.match(rifiuto.motivo, /non è in rete in nessun ambiente acceso/);
});
