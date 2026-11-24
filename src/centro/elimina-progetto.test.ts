/**
 * Eliminare un progetto con i suoi file: si ferma se sta lavorando, e la cartella se ne va nel suo
 * ambiente, se il proprietario lo sceglie. Le cartelle che non possono essere di un progetto restano.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { perchéNonSiElimina } from "../nodo/azioni.ts";
import { allestisci, avviaNodoAccettato, finche, ID_NODO, type Banco } from "../prove/banco.ts";
import { COOKIE_SESSIONE } from "./centro.ts";

async function elimina(banco: Banco, id: string, cartella: boolean) {
  return banco.centro.inject({ method: "DELETE", url: `/api/progetti/${id}${cartella ? "?cartella=si" : ""}`, cookies: { [COOKIE_SESSIONE]: await banco.entra() } });
}

test("un progetto al lavoro si ferma e se ne va con la sua cartella, se lo si sceglie", async (t) => {
  const banco = await allestisci(t);
  const progetto = await banco.lavori.crea("Videogioco", "centro", "Un gioco.");
  await finche(() => banco.conversazioniLocali.length === 1, "il progetto apre la sua conversazione");
  const conversazione = banco.conversazioniLocali[0];
  assert.ok(conversazione !== undefined);
  await mkdir(join(progetto.cartella, "src"), { recursive: true });
  await writeFile(join(progetto.cartella, "src", "gioco.ts"), "export {};\n");
  // Il turno del brief è ancora aperto: prima si rifiutava di eliminarlo.
  assert.equal(banco.lavori.canale(progetto.id)?.sospesi.turni, 1);

  const risposta = await elimina(banco, progetto.id, true);
  assert.equal(risposta.statusCode, 200, risposta.body);
  assert.equal(conversazione.interruzioni, 1);
  assert.equal(conversazione.chiusa, true);
  assert.equal(risposta.json().cartella.riuscita, true);
  assert.equal(existsSync(progetto.cartella), false);

  // Senza la scelta, la cartella resta.
  const secondo = await banco.lavori.crea("Blog", "centro", "Un blog.");
  await finche(() => banco.conversazioniLocali.length === 2, "il secondo apre la sua conversazione");
  const senza = await elimina(banco, secondo.id, false);
  assert.equal(senza.json().cartella, undefined);
  assert.equal(existsSync(secondo.cartella), true);
});

test("in un altro ambiente la cartella la elimina il suo nodo", async (t) => {
  const banco = await allestisci(t);
  await avviaNodoAccettato(t, banco);
  const progetto = await banco.lavori.crea("Sul nodo", ID_NODO, "Un lavoro.");
  await finche(() => existsSync(progetto.cartella), "il nodo crea la cartella");
  const risposta = await elimina(banco, progetto.id, true);
  assert.equal(risposta.json().cartella.riuscita, true, risposta.body);
  assert.equal(existsSync(progetto.cartella), false);
});

test("le cartelle che non possono essere di un progetto non si eliminano", () => {
  const casa = homedir();
  assert.match(perchéNonSiElimina(resolve("/")) ?? "", /radice/);
  assert.match(perchéNonSiElimina(casa) ?? "", /cartella dell'utente/);
  assert.match(perchéNonSiElimina(dirname(casa)) ?? "", /cartella dell'utente|radice/);
  assert.match(perchéNonSiElimina(process.cwd()) ?? "", /gira Shinka/);
  assert.match(perchéNonSiElimina("/srv/x", "/home/mario", "/opt/shinka") ?? "", /troppo in alto/);
  assert.equal(perchéNonSiElimina("/srv/progetti/gioco", "/home/mario", "/opt/shinka"), undefined);
  assert.equal(perchéNonSiElimina(join(casa, "progetti", "gioco"), casa, "/opt/shinka"), undefined);
});
