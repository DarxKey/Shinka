import assert from "node:assert/strict";
import { test } from "node:test";
import { allestisci } from "../prove/banco.ts";
import { delProprietario, PERCORSI_LIBERI, ROTTE_REGISTRATE } from "./centro.ts";

test("senza sessione ogni API risponde 401, tranne quelle libere", async (t) => {
  const banco = await allestisci(t);
  // Tutte le rotte che il centro ha registrato, con i loro metodi.
  const rotte = (ROTTE_REGISTRATE.get(banco.centro) ?? []).filter((rotta) => rotta.percorso.startsWith("/api"));
  assert.ok(rotte.length > 50, `rotte trovate: ${rotte.length}`);
  // Quelle che erano rimaste scoperte prima di questa prova ci sono.
  for (const attesa of ["/api/cerca", "/api/uso", "/api/archiviazione", "/api/stili", "/api/impostazioni", "/api/impostazioni/accessi/:id", "/api/impostazioni/password"]) {
    assert.ok(rotte.some((rotta) => rotta.percorso === attesa), `manca ${attesa}`);
  }
  const scoperte: string[] = [];
  for (const { percorso, metodo } of rotte) {
    if (metodo === "HEAD" || metodo === "OPTIONS") continue;
    const url = percorso.replace(/:[A-Za-z]+/g, "prova");
    if ((PERCORSI_LIBERI as readonly string[]).includes(url)) continue;
    const risposta = await banco.centro.inject({ method: metodo as "GET", url, ...(metodo === "GET" || metodo === "DELETE" ? {} : { payload: {} }) });
    if (risposta.statusCode !== 401) scoperte.push(`${metodo} ${url} → ${risposta.statusCode}`);
  }
  assert.deepEqual(scoperte, []);
});

test("il confine tra API libere e riservate", () => {
  assert.equal(delProprietario("/api/stato"), false);
  assert.equal(delProprietario("/api/stato?x=1"), false);
  assert.equal(delProprietario("/api/accesso"), false);
  assert.equal(delProprietario("/api/nodi/collegamento"), false);
  assert.equal(delProprietario("/api/statox"), true);
  assert.equal(delProprietario("/api/cerca?q=segreto"), true);
  assert.equal(delProprietario("/api/impostazioni/accessi/centro"), true);
  assert.equal(delProprietario("/api"), true);
  assert.equal(delProprietario("/index.html"), false);
  assert.equal(delProprietario("/apix"), false);
});
