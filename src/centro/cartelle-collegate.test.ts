/**
 * Un progetto in più ambienti (ADR 0050): un progetto del centro con una cartella collegata su un
 * nodo vero, collegata dal proprietario, e gli strumenti con cui ci lavora.
 */

import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import type { StatoCollegate } from "../protocollo/progetti.ts";
import { STRUMENTI_COMUNI_SENZA_RICHIESTA, STRUMENTI_SOLO_DEI_PROGETTI } from "../protocollo/strumenti.ts";
import { allestisci, avviaNodoAccettato, finche, ID_NODO, type Banco } from "../prove/banco.ts";
import { COOKIE_SESSIONE } from "./centro.ts";

async function chiedi(banco: Banco, method: "GET" | "POST" | "DELETE", url: string, payload?: Record<string, string>) {
  const cookies = { [COOKIE_SESSIONE]: await banco.entra() };
  return payload === undefined ? banco.centro.inject({ method, url, cookies }) : banco.centro.inject({ method, url, cookies, payload });
}

test("il proprietario collega una cartella di un altro ambiente, e il progetto ci lavora con i suoi strumenti", async (t) => {
  const banco = await allestisci(t);
  const nodo = await avviaNodoAccettato(t, banco);
  const progetto = await banco.lavori.crea("Shinka", "centro", "Il codice di Shinka.");
  await finche(() => banco.conversazioniLocali.length === 1, "il progetto apre la sua conversazione");
  const conversazione = banco.conversazioniLocali[0];
  assert.ok(conversazione !== undefined);

  // Il codice dell'app, sul nodo.
  const desktop = join(nodo.radiceProgetti, "shinka-desktop");
  await mkdir(join(desktop, "src"), { recursive: true });
  await writeFile(join(desktop, "src", "aggiorna.ts"), "export const OGNI_ORE = 6;\n");

  const prima = (await chiedi(banco, "GET", `/api/progetti/${progetto.id}/collegate`)).json() as StatoCollegate;
  assert.deepEqual(prima.collegate, []);
  assert.deepEqual(prima.possibili.map((voce) => voce.idAmbiente), [ID_NODO]);

  // Una cartella che non c'è, o l'ambiente del progetto, non si collegano.
  const manca = await chiedi(banco, "POST", `/api/progetti/${progetto.id}/collegate`, { idAmbiente: ID_NODO, cartella: join(nodo.radiceProgetti, "non-c-e") });
  assert.equal(manca.statusCode, 409);
  assert.match(manca.json().errore, /non c'è/);
  const propria = await chiedi(banco, "POST", `/api/progetti/${progetto.id}/collegate`, { idAmbiente: "centro", cartella: "/tmp" });
  assert.equal(propria.statusCode, 409);

  const collegata = await chiedi(banco, "POST", `/api/progetti/${progetto.id}/collegate`, { idAmbiente: ID_NODO, cartella: desktop });
  assert.equal(collegata.statusCode, 200, collegata.body);
  const stato = collegata.json() as StatoCollegate;
  assert.equal(stato.collegate[0]?.attivo, true);
  assert.deepEqual(stato.possibili, []);
  // La conversazione del progetto lo viene a sapere.
  assert.ok(conversazione.annotazioni.some((nota) => nota.includes("Le cartelle collegate a questo progetto sono cambiate") && nota.includes(desktop)));
  assert.deepEqual(banco.progetti.collegate(progetto.id), [{ idAmbiente: ID_NODO, cartella: stato.collegate[0]?.cartella }]);

  // Gli strumenti, dal progetto, passano dal nodo.
  const nomeNodo = stato.collegate[0]?.nomeAmbiente ?? "";
  const elenco = await banco.comuniDelProgetto(progetto.id, "cartelle_collegate", {});
  assert.match(elenco.testo, new RegExp(`ambiente "${nomeNodo}"`));
  const letto = await banco.comuniDelProgetto(progetto.id, "leggi_nella_collegata", { ambiente: nomeNodo, percorso: "src/aggiorna.ts" });
  assert.equal(letto.testo, "export const OGNI_ORE = 6;\n");
  const modificato = await banco.comuniDelProgetto(progetto.id, "modifica_nella_collegata", { ambiente: nomeNodo, percorso: "src/aggiorna.ts", testo_vecchio: "= 6", testo_nuovo: "= 4" });
  assert.equal(modificato.errore, undefined, modificato.testo);
  assert.equal(await readFile(join(desktop, "src", "aggiorna.ts"), "utf8"), "export const OGNI_ORE = 4;\n");
  await banco.comuniDelProgetto(progetto.id, "scrivi_nella_collegata", { ambiente: nomeNodo, percorso: "NOTE.md", contenuto: "# Note\n" });
  const comando = await banco.comuniDelProgetto(progetto.id, "esegui_nella_collegata", { ambiente: nomeNodo, comando: process.platform === "win32" ? "Get-ChildItem -Name" : "ls" });
  assert.match(comando.testo, /NOTE\.md/);
  const altrove = await banco.comuniDelProgetto(progetto.id, "leggi_nella_collegata", { ambiente: "Marte", percorso: "a" });
  assert.equal(altrove.errore, true);

  // Da una cartella collegata si pubblica anche Shinka Desktop (ADR 0049, 0050).
  const fonti = (await chiedi(banco, "GET", "/api/desktop")).json().fonti as { idAmbiente?: string; cartella: string }[];
  assert.ok(fonti.some((fonte) => fonte.idAmbiente === ID_NODO && fonte.cartella === stato.collegate[0]?.cartella));
  const { createHash, randomBytes } = await import("node:crypto");
  const { gzipSync } = await import("node:zlib");
  const installer = randomBytes(50_000);
  const sha512 = createHash("sha512").update(installer).digest("base64");
  const nome = "Shinka-Desktop-0.3.0-installa.exe";
  await mkdir(join(desktop, "release"));
  await writeFile(join(desktop, "release", nome), installer);
  await writeFile(join(desktop, "release", `${nome}.blockmap`), gzipSync("{}"));
  await writeFile(join(desktop, "release", "latest.yml"), `version: 0.3.0\r\nfiles:\r\n  - url: ${nome}\r\n    sha512: ${sha512}\r\n    size: ${installer.length}\r\npath: ${nome}\r\nsha512: ${sha512}\r\n`);
  const { PASSWORD } = await import("../prove/banco.ts");
  const pubblicata = await chiedi(banco, "POST", "/api/desktop/pubblicazione", { idProgetto: progetto.id, idAmbiente: ID_NODO, cartella: "release", password: PASSWORD });
  assert.equal(pubblicata.statusCode, 200, pubblicata.body);
  assert.equal(pubblicata.json().pubblicata.versione, "0.3.0");
  const nonCollegata = await chiedi(banco, "POST", "/api/desktop/pubblicazione", { idProgetto: progetto.id, idAmbiente: "altro", cartella: "release", password: PASSWORD });
  assert.equal(nonCollegata.statusCode, 409);

  // Scollegata, gli strumenti non la raggiungono più.
  const scollegata = await chiedi(banco, "DELETE", `/api/progetti/${progetto.id}/collegate/${ID_NODO}`);
  assert.deepEqual((scollegata.json() as StatoCollegate).collegate, []);
  assert.equal((await banco.comuniDelProgetto(progetto.id, "leggi_nella_collegata", { ambiente: nomeNodo, percorso: "NOTE.md" })).errore, true);
});

test("comandi e file scritti nelle collegate seguono i permessi del progetto; leggere no; la Home non li ha", () => {
  for (const nome of ["esegui_nella_collegata", "scrivi_nella_collegata", "modifica_nella_collegata"] as const) {
    assert.equal(STRUMENTI_COMUNI_SENZA_RICHIESTA.includes(nome), false, nome);
  }
  assert.ok(STRUMENTI_COMUNI_SENZA_RICHIESTA.includes("leggi_nella_collegata"));
  assert.ok(STRUMENTI_COMUNI_SENZA_RICHIESTA.includes("cartelle_collegate"));
  for (const nome of ["cartelle_collegate", "esegui_nella_collegata", "leggi_nella_collegata", "scrivi_nella_collegata", "modifica_nella_collegata"] as const) {
    assert.ok(STRUMENTI_SOLO_DEI_PROGETTI.includes(nome), nome);
  }
});
