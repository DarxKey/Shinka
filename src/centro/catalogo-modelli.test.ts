/**
 * I modelli nella scheda di un progetto nuovo: ambiente per ambiente, quelli che lì si possono usare
 * (nell'ambiente del centro anche quelli in rete degli altri, con il nome di chi li fornisce); il
 * modello scelto si salva con il progetto e vale dal suo primo messaggio.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { ModelloDisponibile } from "../protocollo/impostazioni.ts";
import { allestisci, avviaNodoAccettato, finche, ID_NODO } from "../prove/banco.ts";
import { COOKIE_SESSIONE } from "./centro.ts";

const DEL_CENTRO: ModelloDisponibile[] = [
  { valore: "opus", nome: "Opus", descrizione: "", motore: "claude" },
  { valore: "locale:qwen", nome: "qwen3 (in rete, PC Windows)", descrizione: "Gira su «PC Windows».", motore: "claude" },
];

test("la scheda di un progetto nuovo ha i modelli dell'ambiente scelto, e il modello scelto vale dal primo messaggio", { timeout: 30_000 }, async (t) => {
  const banco = await allestisci(t, { modelliDelCentro: DEL_CENTRO });
  const nodo = await avviaNodoAccettato(t, banco, {
    modelli: {
      leggi: async (motore) =>
        motore === "claude" ? [{ valore: "sonnet", nome: "Sonnet", descrizione: "", impegni: ["low", "high"] }] : [{ valore: "gpt-6", nome: "GPT-6", descrizione: "" }],
    },
  });
  const cookies = { [COOKIE_SESSIONE]: await banco.entra() };
  const modelli = async (ambiente: string) => banco.centro.inject({ method: "GET", url: `/api/nuovo-progetto/modelli?ambiente=${ambiente}`, cookies });

  // Nell'ambiente del centro: i suoi motori, e i modelli in rete degli altri ambienti con il loro nome.
  assert.deepEqual((await modelli("centro")).json(), { modelli: DEL_CENTRO });
  // In un altro ambiente li dice il suo nodo: ciascuno con il suo motore.
  const delNodo = (await modelli(ID_NODO)).json() as { modelli: ModelloDisponibile[] };
  assert.deepEqual(
    delNodo.modelli.map((modello) => `${modello.motore}:${modello.valore}`),
    ["claude:sonnet", "codex:gpt-6"],
  );
  assert.deepEqual(delNodo.modelli[0]?.impegni, ["low", "high"]);
  // Un ambiente che non c'è o è spento lo dice.
  assert.equal((await modelli("non-esiste")).statusCode, 409);

  // Un progetto nel nodo, con il sottomodello scelto: si salva, e la conversazione parte con quello.
  const creato = await banco.centro.inject({
    method: "POST",
    url: "/api/nuovo-progetto",
    cookies,
    payload: { nome: "Videogioco", idAmbiente: ID_NODO, brief: "Un platformer.", motore: "claude", modello: "sonnet" },
  });
  const { idProgetto } = creato.json() as { idProgetto: string };
  assert.equal(banco.lavori.impostazioni(idProgetto).modello, "sonnet");
  await finche(() => nodo.conversazioni[0]?.inviati.length === 1, "il primo messaggio arriva al nodo");
  assert.equal(nodo.conversazioni[0]?.configurazione?.impostazioni.modello, "sonnet");
  assert.equal(nodo.conversazioni[0]?.configurazione?.impostazioni.motore, "claude");

  // Nell'ambiente del centro, con il modello in rete di un altro ambiente.
  const inRete = await banco.centro.inject({
    method: "POST",
    url: "/api/nuovo-progetto",
    cookies,
    payload: { nome: "Appunti", idAmbiente: "centro", brief: "Raccogli gli appunti.", modello: "locale:qwen" },
  });
  const idInRete = (inRete.json() as { idProgetto: string }).idProgetto;
  assert.equal(banco.lavori.impostazioni(idInRete).modello, "locale:qwen");
  await finche(() => banco.conversazioniLocali.some((una) => una.inviati.includes("Raccogli gli appunti.")), "il primo messaggio parte");
  const locale = banco.conversazioniLocali.find((una) => una.inviati.includes("Raccogli gli appunti."));
  assert.equal(locale?.configurazione?.impostazioni.modello, "locale:qwen");

  // Senza un sottomodello resta il predefinito.
  const predefinito = await banco.centro.inject({
    method: "POST",
    url: "/api/nuovo-progetto",
    cookies,
    payload: { nome: "Senza scelta", idAmbiente: "centro", brief: "Niente di speciale." },
  });
  assert.equal(banco.lavori.impostazioni((predefinito.json() as { idProgetto: string }).idProgetto).modello, undefined);
});

test("se il nodo non risponde valgono gli ultimi modelli che aveva detto", { timeout: 30_000 }, async (t) => {
  const banco = await allestisci(t);
  let risponde = true;
  await avviaNodoAccettato(t, banco, {
    modelli: {
      leggi: async (motore) => {
        if (!risponde) await new Promise(() => {});
        return motore === "claude" ? [{ valore: "sonnet", nome: "Sonnet", descrizione: "" }] : undefined;
      },
    },
  });
  const cookies = { [COOKIE_SESSIONE]: await banco.entra() };
  const modelli = async () => (await banco.centro.inject({ method: "GET", url: `/api/nuovo-progetto/modelli?ambiente=${ID_NODO}`, cookies })).json() as { modelli?: ModelloDisponibile[] };
  assert.deepEqual((await modelli()).modelli?.map((modello) => modello.valore), ["sonnet"]);
  risponde = false;
  assert.deepEqual((await modelli()).modelli?.map((modello) => modello.valore), ["sonnet"]);
});
