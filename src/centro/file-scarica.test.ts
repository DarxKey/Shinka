/**
 * Scaricare dal pannello File (ADR 0048): un file così com'è, una cartella come ZIP, a flusso e con
 * la finestra dei pezzi che tiene ferma la memoria del nodo.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { request, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { test } from "node:test";
import { FINESTRA_SCARICAMENTO, PEZZO_SCARICATO, type RiferitoFile } from "../protocollo/file-progetto.ts";
import { allestisci, finche } from "../prove/banco.ts";
import { FileDeiProgettiQui } from "../nodo/file-progetto.ts";
import { COOKIE_SESSIONE } from "./centro.ts";

const conPython = (() => {
  try {
    execFileSync("python3", ["-I", "-c", "import zipfile"]);
    return true;
  } catch {
    return false;
  }
})();

async function progettoConFile(t: Parameters<typeof allestisci>[0]) {
  const banco = await allestisci(t);
  const progetto = await banco.lavori.crea("Città nuova", "centro", "Un gioco.");
  const cartella = progetto.cartella;
  mkdirSync(join(cartella, "src", "livelli"), { recursive: true });
  writeFileSync(join(cartella, "src", "salto.ts"), "export const salto = 3;\n");
  writeFileSync(join(cartella, "src", "livelli", "uno.json"), '{"livello":1}');
  const grande = randomBytes(PEZZO_SCARICATO * (FINESTRA_SCARICAMENTO + 3) + 123);
  writeFileSync(join(cartella, "grande.bin"), grande);
  const cookies = { [COOKIE_SESSIONE]: await banco.entra() };
  const scarica = (percorso: string) => banco.centro.inject({ method: "GET", url: `/api/progetti/${progetto.id}/file/scarica?percorso=${encodeURIComponent(percorso)}`, cookies });
  return { banco, progetto, cartella, grande, scarica };
}

test("un file si scarica così com'è, anche grande più della finestra dei pezzi, con il suo nome", async (t) => {
  const { scarica, grande } = await progettoConFile(t);
  const risposta = await scarica("grande.bin");
  assert.equal(risposta.statusCode, 200);
  assert.equal(risposta.headers["content-type"], "application/octet-stream");
  assert.equal(risposta.headers["content-disposition"], `attachment; filename="grande.bin"; filename*=UTF-8''grande.bin`);
  assert.equal(Number(risposta.headers["content-length"]), grande.length);
  assert.ok(risposta.rawPayload.equals(grande));

  const piccolo = await scarica("src/salto.ts");
  assert.equal(piccolo.body, "export const salto = 3;\n");
});

test("una cartella, o il progetto intero, si scarica come ZIP che si apre", { skip: conPython ? false : "manca python3" }, async (t) => {
  const { scarica, banco, cartella } = await progettoConFile(t);
  const leggi = (dati: Buffer): string[] => {
    const file = join(banco.cartella, "scaricato.zip");
    writeFileSync(file, dati);
    const codice = "import sys, zipfile\nz = zipfile.ZipFile(sys.argv[1])\nassert z.testzip() is None\nprint('\\n'.join(sorted(z.namelist())))";
    return execFileSync("python3", ["-I", "-c", codice, file], { encoding: "utf8" }).trim().split("\n");
  };

  const sotto = await scarica("src");
  assert.equal(sotto.statusCode, 200);
  assert.equal(sotto.headers["content-type"], "application/zip");
  assert.match(String(sotto.headers["content-disposition"]), /filename="src\.zip"/);
  assert.deepEqual(leggi(sotto.rawPayload), ["src/livelli/uno.json", "src/salto.ts"]);

  const tutto = await scarica("");
  const nome = cartella.split("/").at(-1) ?? "";
  assert.match(String(tutto.headers["content-disposition"]), new RegExp(`filename\\*=UTF-8''${encodeURIComponent(nome)}\\.zip`));
  assert.ok(leggi(tutto.rawPayload).includes(`${nome}/grande.bin`));
  assert.ok(leggi(tutto.rawPayload).includes(`${nome}/BRIEF.md`));
});

test("ciò che non c'è, o che esce dal progetto, non si scarica", async (t) => {
  const { scarica, banco } = await progettoConFile(t);
  const manca = await scarica("non-c-e.txt");
  assert.deepEqual([manca.statusCode, manca.json().errore], [409, "Il file non c'è."]);
  assert.equal((await scarica("../fuori")).statusCode, 409);
  const altro = await banco.centro.inject({ method: "GET", url: "/api/progetti/mai/file/scarica?percorso=a", cookies: { [COOKIE_SESSIONE]: await banco.entra() } });
  assert.deepEqual([altro.statusCode, altro.json().errore], [409, "Progetto non trovato."]);
  const senzaSessione = await banco.centro.inject({ method: "GET", url: "/api/progetti/mai/file/scarica?percorso=a" });
  assert.equal(senzaSessione.statusCode, 401);
});

test("nell'ambiente: non più pezzi della finestra senza il via del centro; annullato, si ferma", async (t) => {
  const { cartella } = await progettoConFile(t);
  const ricevuti: RiferitoFile[] = [];
  const qui = new FileDeiProgettiQui((messaggio) => ricevuti.push(messaggio));
  const pezzi = (): number => ricevuti.filter((messaggio) => messaggio.tipo === "file-scarica-pezzo").length;

  qui.esegui({ tipo: "file-scarica", idRichiesta: "r1", cartella, percorso: "grande.bin" });
  await finche(() => pezzi() === FINESTRA_SCARICAMENTO, "manda la finestra");
  await new Promise((risolvi) => setTimeout(risolvi, 100));
  assert.equal(pezzi(), FINESTRA_SCARICAMENTO);
  assert.deepEqual(ricevuti[0], { tipo: "file-scarica-inizio", idRichiesta: "r1", nome: "grande.bin", comeArchivio: false, dimensione: PEZZO_SCARICATO * (FINESTRA_SCARICAMENTO + 3) + 123 });

  qui.esegui({ tipo: "file-scarica-avanti", idRichiesta: "r1", quanti: 2 });
  await finche(() => pezzi() === FINESTRA_SCARICAMENTO + 2, "altri due");
  qui.esegui({ tipo: "file-scarica-annulla", idRichiesta: "r1" });
  await new Promise((risolvi) => setTimeout(risolvi, 100));
  assert.equal(pezzi(), FINESTRA_SCARICAMENTO + 2);
  assert.equal(ricevuti.some((messaggio) => messaggio.tipo === "file-scarica-fine" || messaggio.tipo === "file-scarica-errore"), false);
});

test("se il browser se ne va a metà, l'ambiente smette di leggere", async (t) => {
  const { banco, progetto } = await progettoConFile(t);
  await banco.centro.listen({ host: "127.0.0.1", port: 0 });
  const { port } = banco.centro.server.address() as AddressInfo;
  const cookie = `${COOKIE_SESSIONE}=${await banco.entra()}`;
  // Un cliente HTTP semplice: chiude la sua connessione e non ne apre altre.
  const richiesta = request({ host: "127.0.0.1", port, path: `/api/progetti/${progetto.id}/file/scarica?percorso=grande.bin`, headers: { cookie } });
  const risposta = await new Promise<IncomingMessage>((risolvi, rifiuta) => {
    richiesta.on("response", risolvi);
    richiesta.on("error", rifiuta);
    richiesta.end();
  });
  assert.equal(risposta.statusCode, 200);
  await new Promise((risolvi) => risposta.once("data", risolvi));
  assert.equal(banco.file.scaricamentiInCorso, 1);
  risposta.on("error", () => {});
  richiesta.destroy();
  await finche(() => banco.file.scaricamentiInCorso === 0, "lo scaricamento si chiude");
});
