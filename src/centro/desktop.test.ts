/**
 * Gli aggiornamenti di Shinka Desktop dal centro (ADR 0049): latest.yml, la pubblicazione dalla
 * cartella di un progetto, i file serviti anche a parti, e il protocollo in /api/stato.
 */

import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { gzipSync } from "node:zlib";
import { PROTOCOLLO_DEI_CLIENTI } from "../protocollo/desktop.ts";
import { allestisci, PASSWORD, type Banco } from "../prove/banco.ts";
import { COOKIE_SESSIONE } from "./centro.ts";
import { confrontaVersioni, leggiManifesto, nomeDellInstaller } from "./desktop.ts";
import { intervalliChiesti } from "./intervalli.ts";

/** Una versione costruita come la costruisce electron-builder: installer, .blockmap e latest.yml. */
function costruita(versione: string, installer = randomBytes(300_000), sha512 = createHash("sha512").update(installer).digest("base64")) {
  const nome = nomeDellInstaller(versione);
  const blockmap = gzipSync(Buffer.from(JSON.stringify({ version: "2", files: [{ name: "file", offset: 0, checksums: [], sizes: [] }] })));
  const manifesto = [
    `version: ${versione}`,
    "files:",
    `  - url: ${nome}`,
    `    sha512: ${sha512}`,
    `    size: ${installer.length}`,
    `path: ${nome}`,
    `sha512: ${sha512}`,
    "releaseDate: '2026-11-23T10:00:00.000Z'",
    "",
  ].join("\n");
  return { nome, installer, blockmap, manifesto };
}

test("latest.yml di electron-builder si legge; un nome, una SHA-512 o una dimensione sbagliati no", () => {
  const { manifesto, installer } = costruita("0.2.0");
  const letto = leggiManifesto(manifesto);
  assert.ok(!("motivo" in letto));
  assert.deepEqual([letto.versione, letto.percorso, letto.dimensione, letto.dataDiRilascio], ["0.2.0", "Shinka-Desktop-0.2.0-installa.exe", installer.length, "2026-11-23T10:00:00.000Z"]);
  assert.match(String((leggiManifesto(manifesto.replaceAll("Shinka-Desktop-0.2.0-installa.exe", "altro.exe")) as { motivo: string }).motivo), /si deve chiamare/);
  assert.match(String((leggiManifesto(manifesto.replace(/sha512: \S+/g, "sha512: corta")) as { motivo: string }).motivo), /SHA-512/);
  assert.match(String((leggiManifesto(manifesto.replace(/size: \d+/, "size: tanti")) as { motivo: string }).motivo), /dimensione/);
  assert.match(String((leggiManifesto(manifesto.replace("version: 0.2.0", "version: due")) as { motivo: string }).motivo), /versione valida/);
});

test("le versioni si confrontano come semver", () => {
  assert.ok(confrontaVersioni("0.1.0", "0.2.0") < 0);
  assert.ok(confrontaVersioni("1.10.0", "1.9.9") > 0);
  assert.ok(confrontaVersioni("1.0.0-beta", "1.0.0") < 0);
  assert.ok(confrontaVersioni("1.0.0-beta.2", "1.0.0-beta.10") < 0);
  assert.ok(confrontaVersioni("1.0.0-alpha", "1.0.0-beta") < 0);
  assert.equal(confrontaVersioni("1.2.3", "1.2.3"), 0);
});

test("le parti di un file chieste con Range", () => {
  assert.deepEqual(intervalliChiesti("bytes=0-1023", 5000), [{ inizio: 0, fine: 1023 }]);
  assert.deepEqual(intervalliChiesti("bytes=4000-", 5000), [{ inizio: 4000, fine: 4999 }]);
  assert.deepEqual(intervalliChiesti("bytes=-100", 5000), [{ inizio: 4900, fine: 4999 }]);
  assert.deepEqual(intervalliChiesti("bytes=0-9, 20-29", 5000), [{ inizio: 0, fine: 9 }, { inizio: 20, fine: 29 }]);
  assert.deepEqual(intervalliChiesti("bytes=4990-6000", 5000), [{ inizio: 4990, fine: 4999 }]);
  assert.equal(intervalliChiesti("bytes=6000-7000", 5000), "fuori");
  assert.equal(intervalliChiesti("bytes=9-3", 5000), undefined);
  assert.equal(intervalliChiesti("righe=0-9", 5000), undefined);
  assert.equal(intervalliChiesti(undefined, 5000), undefined);
});

/** Un progetto Shinka Desktop nell'ambiente del centro, con la versione costruita nella sua cartella dist. */
async function progettoDesktop(t: TestContext, banco: Banco) {
  const progetto = await banco.lavori.crea("Shinka Desktop", "centro", "L'app per Windows.");
  const dist = join(progetto.cartella, "dist");
  const metti = (versione: ReturnType<typeof costruita>): void => {
    rmSync(dist, { recursive: true, force: true });
    mkdirSync(dist, { recursive: true });
    writeFileSync(join(dist, versione.nome), versione.installer);
    writeFileSync(join(dist, `${versione.nome}.blockmap`), versione.blockmap);
    writeFileSync(join(dist, "latest.yml"), versione.manifesto);
  };
  const cookies = { [COOKIE_SESSIONE]: await banco.entra() };
  const pubblica = (password = PASSWORD, intestazioni: Record<string, string> = {}) =>
    banco.centro.inject({ method: "POST", url: "/api/desktop/pubblicazione", cookies, headers: intestazioni, payload: { idProgetto: progetto.id, cartella: "dist", password } });
  t.after(() => rmSync(dist, { recursive: true, force: true }));
  return { progetto, metti, pubblica, cookies };
}

async function gettone(banco: Banco): Promise<string> {
  const aggiunto = await banco.centro.inject({ method: "POST", url: "/api/dispositivi", payload: { password: PASSWORD, nome: "PC", genere: "desktop" } });
  return (aggiunto.json() as { token: string }).token;
}

test("/api/stato dice a chiunque il protocollo dei clienti e la versione del centro", async (t) => {
  const cartella = mkdtempSync(join(tmpdir(), "shinka-installata-"));
  t.after(() => rmSync(cartella, { recursive: true, force: true }));
  writeFileSync(join(cartella, "versione.json"), JSON.stringify({ versione: "2367123abcdef0" }));
  const banco = await allestisci(t, { installata: cartella });
  const stato = (await banco.centro.inject({ method: "GET", url: "/api/stato" })).json();
  assert.deepEqual(stato, { protocollo: PROTOCOLLO_DEI_CLIENTI, versione: "2367123a", configurato: true, autenticato: false });
  assert.equal(PROTOCOLLO_DEI_CLIENTI, 1);
});

test("prima della pubblicazione latest.yml dà 404 con un gettone e 401 senza; dopo, la versione e l'installer con la sua SHA-512, anche a parti", async (t) => {
  const banco = await allestisci(t);
  const token = await gettone(banco);
  const conGettone = { authorization: `Bearer ${token}` };
  assert.equal((await banco.centro.inject({ method: "GET", url: "/api/desktop/aggiornamenti/latest.yml", headers: conGettone })).statusCode, 404);
  assert.equal((await banco.centro.inject({ method: "GET", url: "/api/desktop/aggiornamenti/latest.yml" })).statusCode, 401);

  const { metti, pubblica } = await progettoDesktop(t, banco);
  const prima = costruita("0.2.0");
  metti(prima);
  const pubblicata = await pubblica();
  assert.equal(pubblicata.statusCode, 200, pubblicata.body);
  assert.equal(pubblicata.json().pubblicata.versione, "0.2.0");

  const manifesto = await banco.centro.inject({ method: "GET", url: "/api/desktop/aggiornamenti/latest.yml", headers: conGettone });
  assert.equal(manifesto.statusCode, 200);
  assert.equal(manifesto.body, prima.manifesto);
  const installer = await banco.centro.inject({ method: "GET", url: `/api/desktop/aggiornamenti/${prima.nome}`, headers: conGettone });
  assert.equal(installer.statusCode, 200);
  assert.equal(installer.headers["accept-ranges"], "bytes");
  assert.equal(createHash("sha512").update(installer.rawPayload).digest("base64"), (leggiManifesto(prima.manifesto) as { sha512: string }).sha512);

  const parte = await banco.centro.inject({ method: "GET", url: `/api/desktop/aggiornamenti/${prima.nome}`, headers: { ...conGettone, range: "bytes=0-1023" } });
  assert.equal(parte.statusCode, 206);
  assert.equal(parte.rawPayload.length, 1024);
  assert.equal(parte.headers["content-range"], `bytes 0-1023/${prima.installer.length}`);
  assert.ok(parte.rawPayload.equals(prima.installer.subarray(0, 1024)));

  // Più parti insieme, come le chiede electron-updater per scaricare solo i blocchi cambiati.
  const parti = await banco.centro.inject({ method: "GET", url: `/api/desktop/aggiornamenti/${prima.nome}`, headers: { ...conGettone, range: "bytes=0-9,100-109" } });
  assert.equal(parti.statusCode, 206);
  const confine = /boundary=(\S+)/.exec(String(parti.headers["content-type"]))?.[1] ?? "";
  assert.ok(confine !== "");
  assert.equal(Number(parti.headers["content-length"]), parti.rawPayload.length);
  const corpo = parti.rawPayload.toString("latin1");
  assert.ok(corpo.includes(`Content-Range: bytes 0-9/${prima.installer.length}\r\n\r\n${prima.installer.subarray(0, 10).toString("latin1")}\r\n--${confine}`));
  assert.ok(corpo.includes(`Content-Range: bytes 100-109/${prima.installer.length}\r\n\r\n${prima.installer.subarray(100, 110).toString("latin1")}\r\n--${confine}--`));

  const fuori = await banco.centro.inject({ method: "GET", url: `/api/desktop/aggiornamenti/${prima.nome}`, headers: { ...conGettone, range: "bytes=999999999-" } });
  assert.equal(fuori.statusCode, 416);
  assert.equal((await banco.centro.inject({ method: "GET", url: "/api/desktop/aggiornamenti/altro.exe", headers: conGettone })).statusCode, 404);

  // Con la versione dopo resta il .blockmap di prima, per scaricare solo le parti cambiate.
  const seconda = costruita("0.3.0");
  metti(seconda);
  assert.equal((await pubblica()).statusCode, 200);
  assert.ok((await banco.centro.inject({ method: "GET", url: "/api/desktop/aggiornamenti/latest.yml", headers: conGettone })).body.includes("version: 0.3.0"));
  assert.equal((await banco.centro.inject({ method: "GET", url: `/api/desktop/aggiornamenti/${prima.nome}.blockmap`, headers: conGettone })).statusCode, 200);
  assert.equal((await banco.centro.inject({ method: "GET", url: `/api/desktop/aggiornamenti/${prima.nome}`, headers: conGettone })).statusCode, 404);
  assert.equal((await banco.centro.inject({ method: "GET", url: `/api/desktop/aggiornamenti/${seconda.nome}.blockmap`, headers: conGettone })).statusCode, 200);

  const sicurezza = (await banco.centro.inject({ method: "GET", url: "/api/sicurezza", headers: conGettone })).json() as { voci: { tipo: string; dettaglio?: string }[] };
  assert.ok(sicurezza.voci.some((voce) => voce.tipo === "desktop-pubblicato" && voce.dettaglio === "versione 0.3.0"));
});

test("la pubblicazione rifiuta un gettone di dispositivo, la password sbagliata, la SHA-512 sbagliata e le versioni non nuove", async (t) => {
  const banco = await allestisci(t);
  const { metti, pubblica } = await progettoDesktop(t, banco);
  const token = await gettone(banco);

  metti(costruita("0.2.0"));
  const daDispositivo = await banco.centro.inject({
    method: "POST",
    url: "/api/desktop/pubblicazione",
    headers: { authorization: `Bearer ${token}` },
    payload: { idProgetto: "x", cartella: "dist", password: PASSWORD },
  });
  assert.equal(daDispositivo.statusCode, 403);
  assert.equal((await pubblica("sbagliata!!")).statusCode, 403);

  // Un installer che non è quello del manifesto.
  metti(costruita("0.2.0", randomBytes(1000), createHash("sha512").update("altro").digest("base64")));
  const hashSbagliato = await pubblica();
  assert.equal(hashSbagliato.statusCode, 409);
  assert.match(hashSbagliato.json().errore, /SHA-512/);
  assert.deepEqual((await banco.centro.inject({ method: "GET", url: "/api/desktop", headers: { authorization: `Bearer ${token}` } })).json(), {});

  metti(costruita("0.2.0"));
  assert.equal((await pubblica()).statusCode, 200);
  metti(costruita("0.2.0"));
  assert.match((await pubblica()).json().errore, /non viene dopo/);
  metti(costruita("0.1.9"));
  assert.match((await pubblica()).json().errore, /non viene dopo/);
  // Il .blockmap che manca.
  const senza = costruita("0.4.0");
  metti(senza);
  rmSync(join(banco.lavori.stato().progetti[0]?.cartella ?? "", "dist", `${senza.nome}.blockmap`));
  assert.match((await pubblica()).json().errore, /blockmap/);
  assert.equal((await banco.centro.inject({ method: "GET", url: "/api/desktop", headers: { authorization: `Bearer ${token}` } })).json().pubblicata.versione, "0.2.0");
});
