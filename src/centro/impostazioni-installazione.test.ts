import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import type { RichiestaAccessi } from "../protocollo/accessi.ts";
import { allestisci, avviaNodoAccettato, ID_NODO, PASSWORD, type Banco } from "../prove/banco.ts";
import { COOKIE_SESSIONE } from "./centro.ts";
import { ImpostazioniDellInstallazione } from "./impostazioni-installazione.ts";

async function chiama(banco: Banco, metodo: "GET" | "POST" | "PUT", url: string, corpo?: unknown): Promise<{ stato: number; dati: Record<string, unknown> }> {
  const risposta = await banco.centro.inject({
    method: metodo,
    url,
    cookies: { [COOKIE_SESSIONE]: await banco.entra() },
    ...(corpo === undefined ? {} : { payload: corpo as Record<string, unknown> }),
  });
  return { stato: risposta.statusCode, dati: risposta.json() };
}

test("il motore predefinito si sceglie, si salva tra i dati e torna a quello della variabile", async (t) => {
  const banco = await allestisci(t);
  const letto = await chiama(banco, "GET", "/api/impostazioni");
  assert.deepEqual(letto.dati.motore, { variabile: "claude" });

  const scelto = await chiama(banco, "PUT", "/api/impostazioni", { motore: "codex" });
  assert.equal(scelto.stato, 200);
  assert.deepEqual(scelto.dati.motore, { scelto: "codex", variabile: "claude" });
  assert.deepEqual(JSON.parse(await readFile(join(banco.cartella, "impostazioni.json"), "utf8")), { motore: "codex" });
  // Dopo un riavvio la scelta c'è ancora, e chi ascolta la riceve subito.
  const ricevute: unknown[] = [];
  ImpostazioniDellInstallazione.apri(banco.cartella, (scelte) => ricevute.push(scelte));
  assert.deepEqual(ricevute, [{ motore: "codex" }]);

  const tornato = await chiama(banco, "PUT", "/api/impostazioni", { motore: null });
  assert.deepEqual(tornato.dati.motore, { variabile: "claude" });
  assert.equal((await chiama(banco, "PUT", "/api/impostazioni", { motore: "gemini" })).stato, 400);
});

test("gli accessi si chiedono all'ambiente del centro e a quelli dei nodi", async (t) => {
  const delNodo: RichiestaAccessi[] = [];
  const banco = await allestisci(t);
  await avviaNodoAccettato(t, banco, {
    accessi: {
      esegui: async (richiesta) => {
        delNodo.push(richiesta);
        if (richiesta.tipo === "avvia") {
          return { accessi: { claude: { collegato: false }, codex: { collegato: false } }, inCorso: [{ motore: "codex", indirizzo: "https://auth.openai.com/codex/device", codice: "ABCD-12345", chiedeCodice: false }] };
        }
        return { accessi: { claude: { collegato: false }, codex: { collegato: true, descrizione: "ChatGPT Plus" } } };
      },
    },
  });
  const { dati } = await chiama(banco, "GET", "/api/impostazioni/accessi");
  const ambienti = dati.ambienti as { id: string; attivo: boolean; esito?: { accessi?: Record<string, unknown> } }[];
  assert.deepEqual(ambienti.find((voce) => voce.id === "centro")?.esito?.accessi?.claude, { collegato: true, descrizione: "Claude Pro" });
  assert.deepEqual(ambienti.find((voce) => voce.id === ID_NODO)?.esito?.accessi?.codex, { collegato: true, descrizione: "ChatGPT Plus" });

  const avviato = await chiama(banco, "POST", `/api/impostazioni/accessi/${ID_NODO}`, { tipo: "avvia", motore: "codex" });
  assert.deepEqual((avviato.dati.inCorso as unknown[])[0], { motore: "codex", indirizzo: "https://auth.openai.com/codex/device", codice: "ABCD-12345", chiedeCodice: false });
  assert.deepEqual(delNodo, [{ tipo: "stato" }, { tipo: "avvia", motore: "codex" }]);
});

test("richieste sbagliate e ambienti sconosciuti vengono rifiutati; un nodo che non conosce gli accessi lo dice", async (t) => {
  const banco = await allestisci(t);
  for (const corpo of [{ tipo: "avvia", motore: "gemini" }, { tipo: "codice", motore: "claude", codice: "a\nb" }, { tipo: "rompi" }]) {
    assert.equal((await chiama(banco, "POST", "/api/impostazioni/accessi/centro", corpo)).stato, 400, JSON.stringify(corpo));
  }
  assert.equal((await chiama(banco, "POST", "/api/impostazioni/accessi/mai-visto", { tipo: "stato" })).stato, 404);
  await avviaNodoAccettato(t, banco);
  const vecchio = await chiama(banco, "POST", `/api/impostazioni/accessi/${ID_NODO}`, { tipo: "stato" });
  assert.match(String(vecchio.dati.motivo), /non sa dire gli accessi/);
});

test("nome e descrizione dell'ambiente del centro si cambiano dalla pagina e valgono subito", async (t) => {
  const banco = await allestisci(t);
  const prima = await chiama(banco, "GET", "/api/impostazioni");
  assert.deepEqual((prima.dati.ambiente as Record<string, unknown>).nome, "Unraid");
  const dopo = await chiama(banco, "PUT", "/api/impostazioni", { ambiente: { nome: " Server di casa ", descrizione: "Docker e dischi" } });
  assert.equal(dopo.stato, 200);
  assert.deepEqual(dopo.dati.ambiente, { nome: "Server di casa", descrizione: "Docker e dischi", sistema: "Linux", radiceProgetti: join(banco.cartella, "progetti"), nomeScelto: true, descrizioneScelta: true });
  assert.equal(banco.ambienti.stato().ambienti[0]?.nome, "Server di casa");
  const tornato = await chiama(banco, "PUT", "/api/impostazioni", { ambiente: { nome: null, descrizione: null } });
  assert.equal((tornato.dati.ambiente as Record<string, unknown>).nome, "Unraid");
  assert.equal((await chiama(banco, "PUT", "/api/impostazioni", { ambiente: { nome: "x".repeat(61) } })).stato, 400);
});

test("la password si cambia con quella attuale, e il browser che la cambia resta dentro", async (t) => {
  const banco = await allestisci(t);
  const sbagliata = await chiama(banco, "POST", "/api/impostazioni/password", { attuale: "non-è-lei", nuova: "una-nuova-password" });
  assert.equal(sbagliata.stato, 403);
  assert.equal((await chiama(banco, "POST", "/api/impostazioni/password", { attuale: PASSWORD, nuova: "corta" })).stato, 400);
  const risposta = await banco.centro.inject({
    method: "POST",
    url: "/api/impostazioni/password",
    cookies: { [COOKIE_SESSIONE]: await banco.entra() },
    payload: { attuale: PASSWORD, nuova: "una-nuova-password" },
  });
  assert.equal(risposta.statusCode, 200);
  const cookie = risposta.cookies.find((voce) => voce.name === COOKIE_SESSIONE);
  assert.ok(cookie !== undefined);
  const stato = await banco.centro.inject({ method: "GET", url: "/api/stato", cookies: { [COOKIE_SESSIONE]: cookie.value } });
  assert.equal(stato.json().autenticato, true);
});
