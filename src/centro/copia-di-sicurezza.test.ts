import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  applicaRipristino,
  apriCopia,
  CopiaNonValida,
  fuoriDallaCopia,
  leggiTestata,
  PasswordDellaCopiaSbagliata,
  scriviCopia,
  segnaIlRipristino,
} from "./copia-di-sicurezza.ts";

/** Ricavare la chiave costa poco, nelle prove. */
const COSTO = 2 ** 10;
const PASSWORD = "una password per la copia";

function cartella(t: { after(fn: () => Promise<void>): void }, nome: string): string {
  const creata = mkdtempSync(join(tmpdir(), `shinka-copia-${nome}-`));
  t.after(() => rm(creata, { recursive: true, force: true }));
  return creata;
}

/** Dei dati come quelli di un centro, con ciò che deve restare fuori. */
function datiDiProva(dati: string): void {
  mkdirSync(join(dati, "conversazioni", "progetti"), { recursive: true });
  mkdirSync(join(dati, "skill", "skills", "backup-foto"), { recursive: true });
  mkdirSync(join(dati, "home"), { recursive: true });
  mkdirSync(join(dati, "https"), { recursive: true });
  mkdirSync(join(dati, "modifiche", "p1", "fotografie", "objects"), { recursive: true });
  mkdirSync(join(dati, "copia-di-sicurezza"), { recursive: true });
  mkdirSync(join(dati, "estensioni-in-esame", "x"), { recursive: true });
  writeFileSync(join(dati, "memoria.md"), "# Memoria di Shinka\n\n- [abc123 · 2026-11-01] Preferisce le risposte brevi.\n");
  writeFileSync(join(dati, "progetti.json"), '{"progetti":[]}');
  writeFileSync(join(dati, "conversazioni", "progetti", "p1.jsonl"), '{"n":1}\n{"n":2}\n');
  writeFileSync(join(dati, "skill", "skills", "backup-foto", "SKILL.md"), "---\nname: backup-foto\ndescription: \"Quando serve.\"\n---\nPassi.\n");
  writeFileSync(join(dati, "https", "ca.key"), "CHIAVE PRIVATA", { mode: 0o600 });
  writeFileSync(join(dati, "immagine.bin"), Buffer.from([0, 1, 2, 255, 254, 0]));
  writeFileSync(join(dati, "modifiche", "p1", "turno.json"), "{}");
  writeFileSync(join(dati, "modifiche", "p1", "fotografie", "objects", "pesante"), "x".repeat(1000));
  // Ciò che è della macchina, o che non serve portare.
  writeFileSync(join(dati, "gateway.json"), '{"gettone":"della macchina"}');
  writeFileSync(join(dati, "installazione.json"), '{"fase":"in funzione"}');
  writeFileSync(join(dati, "sessioni.json"), '{"s":1}');
  writeFileSync(join(dati, "progetti.json.tmp"), "a metà");
  writeFileSync(join(dati, "copia-di-sicurezza", "vecchia.shinka"), "una copia di prima");
  writeFileSync(join(dati, "estensioni-in-esame", "x", "y"), "in esame");
  // Un percorso più lungo di quanto ustar sappia scrivere.
  const lunga = join(dati, "estensioni", ...Array.from({ length: 6 }, (_, n) => `cartella-con-un-nome-piuttosto-lungo-numero-${n}-${"a".repeat(30)}`));
  mkdirSync(lunga, { recursive: true });
  writeFileSync(join(lunga, `${"file-dal-nome-lunghissimo-".repeat(5)}.txt`), "in fondo");
  if (process.platform !== "win32") symlinkSync(join(dati, "memoria.md"), join(dati, "collegamento"));
}

/** Tutti i file di una cartella, relativi, con le barre in avanti. */
function elenco(radice: string, relativo = ""): string[] {
  return readdirSync(join(radice, relativo), { withFileTypes: true })
    .flatMap((voce) => {
      const qui = relativo === "" ? voce.name : `${relativo}/${voce.name}`;
      return voce.isDirectory() ? elenco(radice, qui) : [qui];
    })
    .sort();
}

test("una copia fatta e riaperta: gli stessi file, byte per byte, senza ciò che è della macchina o che si rifà da solo", async (t) => {
  const dati = cartella(t, "dati");
  const fuori = cartella(t, "fuori");
  datiDiProva(dati);
  const file = join(fuori, "copia.shinka");
  const scritta = await scriviCopia({ dati, destinazione: file, password: PASSWORD, versione: "abc1234", adesso: new Date("2026-11-22T10:00:00Z"), costo: COSTO });
  assert.equal(scritta.byte, statSync(file).size);
  assert.deepEqual(scritta.saltati, process.platform === "win32" ? [] : ["collegamento"]);

  // Senza password si legge solo quando è stata fatta, e da quale versione.
  const { testata } = await leggiTestata(file);
  assert.equal(testata.quando, "2026-11-22T10:00:00.000Z");
  assert.equal(testata.versione, "abc1234");
  const grezzo = readFileSync(file);
  for (const segreto of ["CHIAVE PRIVATA", "Preferisce", "backup-foto", "memoria.md"]) assert.equal(grezzo.includes(segreto), false, `${segreto} si legge nella copia`);

  const aperta = join(fuori, "aperta");
  const esito = await apriCopia({ file, password: PASSWORD, destinazione: aperta });
  const attesi = elenco(dati).filter((percorso) => !fuoriDallaCopia(percorso) && percorso !== "collegamento");
  assert.deepEqual(elenco(join(aperta, "dati")), attesi);
  assert.equal(esito.file, attesi.length + 1);
  assert.equal(scritta.file, attesi.length);
  for (const percorso of attesi) assert.deepEqual(readFileSync(join(aperta, "dati", percorso)), readFileSync(join(dati, percorso)), percorso);
  for (const fuoriNome of ["gateway.json", "installazione.json", "sessioni.json", "progetti.json.tmp", "copia-di-sicurezza", "estensioni-in-esame", "modifiche/p1/fotografie"]) {
    assert.equal(existsSync(join(aperta, "dati", fuoriNome)), false, fuoriNome);
  }
  assert.ok(attesi.some((percorso) => percorso.length > 255), "il percorso lungo c'è");
  assert.deepEqual(JSON.parse(readFileSync(join(aperta, "manifesto.json"), "utf8")), { formato: 1, quando: "2026-11-22T10:00:00.000Z", versione: "abc1234" });
  // Una cartella vuota resta, e una chiave privata resta leggibile solo da chi fa girare Shinka.
  assert.equal(existsSync(join(aperta, "dati", "home")), true);
  if (process.platform !== "win32") assert.equal(statSync(join(aperta, "dati", "https", "ca.key")).mode & 0o777, 0o600);
});

test("un file grande passa a pezzi e torna identico", async (t) => {
  const dati = cartella(t, "dati");
  const fuori = cartella(t, "fuori");
  const grande = Buffer.alloc(33 * 1024 * 1024 + 123);
  for (let i = 0; i < grande.length; i += 4099) grande[i] = i % 251;
  writeFileSync(join(dati, "video.bin"), grande);
  const file = join(fuori, "copia.shinka");
  await scriviCopia({ dati, destinazione: file, password: PASSWORD, costo: COSTO });
  await apriCopia({ file, password: PASSWORD, destinazione: join(fuori, "aperta") });
  assert.ok(readFileSync(join(fuori, "aperta", "dati", "video.bin")).equals(grande));
});

test("la password sbagliata, un file che non è una copia, una copia tagliata o cambiata: non si aprono, e non resta nulla", async (t) => {
  const dati = cartella(t, "dati");
  const fuori = cartella(t, "fuori");
  datiDiProva(dati);
  const file = join(fuori, "copia.shinka");
  await scriviCopia({ dati, destinazione: file, password: PASSWORD, costo: COSTO });
  const aperta = join(fuori, "aperta");

  await assert.rejects(apriCopia({ file, password: "un'altra password", destinazione: aperta }), PasswordDellaCopiaSbagliata);
  assert.equal(existsSync(aperta), false);

  const altro = join(fuori, "altro.zip");
  writeFileSync(altro, "PK\x03\x04 non sono una copia di Shinka");
  await assert.rejects(leggiTestata(altro), CopiaNonValida);
  await assert.rejects(apriCopia({ file: altro, password: PASSWORD, destinazione: aperta }), CopiaNonValida);

  const intera = readFileSync(file);
  const tagliata = join(fuori, "tagliata.shinka");
  writeFileSync(tagliata, intera.subarray(0, intera.length - 40));
  await assert.rejects(apriCopia({ file: tagliata, password: PASSWORD, destinazione: aperta }), CopiaNonValida);
  assert.equal(existsSync(aperta), false);

  // Un byte cambiato nel cifrato, e uno nella testata: il sigillo non torna.
  for (const dove of [intera.length - 100, 30]) {
    const cambiata = Buffer.from(intera);
    cambiata[dove] = (cambiata[dove] ?? 0) ^ 1;
    const manomessa = join(fuori, "manomessa.shinka");
    writeFileSync(manomessa, cambiata);
    await assert.rejects(apriCopia({ file: manomessa, password: PASSWORD, destinazione: aperta }), (errore) => errore instanceof CopiaNonValida || errore instanceof PasswordDellaCopiaSbagliata);
    assert.equal(existsSync(aperta), false);
  }

  // Una testata che chiede troppo lavoro per ricavare la chiave non viene nemmeno provata.
  const testata = JSON.stringify({ formato: 1, quando: new Date().toISOString(), derivazione: { sale: "AAAA", N: 2 ** 30, r: 8, p: 1 } });
  const lunghezza = Buffer.alloc(4);
  lunghezza.writeUInt32BE(Buffer.byteLength(testata));
  const esosa = join(fuori, "esosa.shinka");
  writeFileSync(esosa, Buffer.concat([Buffer.from("SHINKA-COPIA-1\n"), lunghezza, Buffer.from(testata)]));
  await assert.rejects(leggiTestata(esosa), CopiaNonValida);
});

test("il ripristino all'avvio: i dati della copia al posto di quelli di adesso, che restano da parte; ciò che è della macchina non si tocca", async (t) => {
  const vecchi = cartella(t, "vecchi");
  const dati = cartella(t, "dati");
  datiDiProva(vecchi);
  const file = join(dati, "copia-di-sicurezza", "caricata.shinka");
  await scriviCopia({ dati: vecchi, destinazione: file, password: PASSWORD, versione: "v-della-copia", adesso: new Date("2026-11-20T08:00:00Z"), costo: COSTO });

  // L'installazione di adesso: altri dati, e il suo collegamento con il gateway.
  writeFileSync(join(dati, "memoria.md"), "# Memoria di Shinka\n\n- [zzz999 · 2026-11-22] Una voce di adesso.\n");
  writeFileSync(join(dati, "solo-adesso.json"), "{}");
  writeFileSync(join(dati, "sessioni.json"), '{"aperta":1}');
  writeFileSync(join(dati, "gateway.json"), '{"gettone":"di questa macchina"}');
  writeFileSync(join(dati, "installazione.json"), '{"fase":"di questa macchina"}');
  // Senza che il proprietario lo abbia chiesto non succede nulla.
  const aperta = join(dati, "copia-di-sicurezza", "aperta");
  await apriCopia({ file, password: PASSWORD, destinazione: aperta });
  assert.equal(applicaRipristino(dati), undefined);
  assert.match(readFileSync(join(dati, "memoria.md"), "utf8"), /Una voce di adesso/);

  segnaIlRipristino(aperta, { quando: "2026-11-20T08:00:00.000Z", versione: "v-della-copia" });
  const esito = applicaRipristino(dati, new Date("2026-11-22T12:00:00Z"));
  assert.deepEqual(esito, { quando: "2026-11-22T12:00:00.000Z", riuscito: true, copia: { quando: "2026-11-20T08:00:00.000Z", versione: "v-della-copia" } });
  assert.match(readFileSync(join(dati, "memoria.md"), "utf8"), /Preferisce le risposte brevi/);
  assert.equal(readFileSync(join(dati, "conversazioni", "progetti", "p1.jsonl"), "utf8"), '{"n":1}\n{"n":2}\n');
  assert.equal(existsSync(join(dati, "solo-adesso.json")), false);
  // Le sessioni di prima non valgono più: si rientra con la password della copia.
  assert.equal(existsSync(join(dati, "sessioni.json")), false);
  assert.equal(readFileSync(join(dati, "gateway.json"), "utf8"), '{"gettone":"di questa macchina"}');
  assert.equal(readFileSync(join(dati, "installazione.json"), "utf8"), '{"fase":"di questa macchina"}');
  // I dati di prima sono da parte, interi; la copia aperta e quella caricata non servono più.
  const base = join(dati, "copia-di-sicurezza");
  const prima = readdirSync(base).filter((nome) => nome.startsWith("prima-"));
  assert.equal(prima.length, 1);
  assert.match(readFileSync(join(base, prima[0] ?? "", "memoria.md"), "utf8"), /Una voce di adesso/);
  assert.equal(existsSync(join(base, prima[0] ?? "", "sessioni.json")), true);
  assert.equal(existsSync(aperta), false);
  assert.equal(existsSync(file), false);
  assert.equal((JSON.parse(readFileSync(join(base, "esito.json"), "utf8")) as { riuscito: boolean }).riuscito, true);
  // Una seconda partenza non rifà nulla.
  assert.equal(applicaRipristino(dati), undefined);
});

test("un ripristino che non riesce lascia i dati com'erano, e lo dice", async (t) => {
  const dati = cartella(t, "dati");
  writeFileSync(join(dati, "memoria.md"), "di adesso");
  writeFileSync(join(dati, "progetti.json"), "di adesso");
  const aperta = join(dati, "copia-di-sicurezza", "aperta");
  // Una copia aperta senza i suoi dati: il segno c'è, ma non c'è nulla da mettere.
  mkdirSync(aperta, { recursive: true });
  segnaIlRipristino(aperta, { quando: "2026-11-20T08:00:00.000Z" });
  const esito = applicaRipristino(dati, new Date("2026-11-22T12:00:00Z"));
  assert.equal(esito?.riuscito, false);
  assert.match(esito?.errore ?? "", /non ci sono dati/);
  assert.equal(readFileSync(join(dati, "memoria.md"), "utf8"), "di adesso");
  assert.equal(readFileSync(join(dati, "progetti.json"), "utf8"), "di adesso");
  assert.deepEqual(readdirSync(join(dati, "copia-di-sicurezza")).filter((nome) => nome.startsWith("prima-")), []);
  assert.equal(applicaRipristino(dati), undefined);
});
