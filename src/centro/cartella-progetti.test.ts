/**
 * La cartella dei progetti nuovi di un ambiente, scelta dalla pagina degli ambienti: il centro la
 * chiede al nodo vero del banco, sul collegamento, e dice com'è andata.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { allestisci, avviaNodoAccettato, finche, ID_NODO } from "../prove/banco.ts";
import { COOKIE_SESSIONE } from "./centro.ts";

test("la cartella dei progetti di un nodo si sceglie dalla pagina degli ambienti", { skip: process.platform === "win32" ? "percorsi di Linux" : false, timeout: 30_000 }, async (t) => {
  const banco = await allestisci(t);
  const nodo = await avviaNodoAccettato(t, banco);
  const cookies = { [COOKIE_SESSIONE]: await banco.entra() };
  const scegli = (idAmbiente: string, percorso: string) =>
    banco.centro.inject({ method: "POST", url: `/api/ambienti/${idAmbiente}/cartella-progetti`, cookies, payload: { percorso } });

  const nuova = join(banco.cartella, "Progetti del PC");
  const fatto = await scegli(ID_NODO, nuova);
  assert.equal(fatto.statusCode, 200);
  assert.deepEqual(fatto.json(), { percorso: nuova, riparte: false });
  assert.ok(existsSync(nuova), "il nodo la crea");

  // Un percorso che non è completo lo dice il nodo; quella del centro si sceglie dove gira il centro.
  const relativo = await scegli(ID_NODO, "progetti");
  assert.equal(relativo.statusCode, 409);
  assert.match((relativo.json() as { errore: string }).errore, /percorso completo/);
  const delCentro = await scegli("centro", "/tmp/altrove");
  assert.equal(delCentro.statusCode, 409);
  assert.match((delCentro.json() as { errore: string }).errore, /SHINKA_PROGETTI/);

  // Con il nodo spento non si cambia.
  nodo.collegamento.ferma();
  await finche(() => !banco.ambienti.attivo(ID_NODO), "il nodo si scollega");
  assert.match(((await scegli(ID_NODO, nuova)).json() as { errore: string }).errore, /spento/);
});
