import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import {
  certificatoProprio,
  leggiConfigurazioneHttps,
  nomiDelCertificato,
  paginaDelCertificato,
  preparaCertificati,
  profiloApple,
  salvaSceltaHttps,
} from "./https.ts";

async function cartella(t: TestContext): Promise<string> {
  const dove = await mkdtemp(join(tmpdir(), "shinka-https-"));
  t.after(() => rm(dove, { recursive: true, force: true }));
  return dove;
}

const NOMI = ["192.168.1.20", "localhost", "127.0.0.1", "::1", "unraid"];

test("i certificati nascono al primo avvio e poi si riusano", async (t) => {
  const dati = await cartella(t);
  const primi = preparaCertificati(join(dati, "https"), NOMI);
  assert.deepEqual(primi.avvisi, []);
  assert.equal(primi.proprio, false);
  assert.ok(primi.ca !== undefined);
  // Le chiavi le legge solo il centro.
  if (process.platform !== "win32") assert.equal((await stat(join(dati, "https", "server.key"))).mode & 0o777, 0o600);
  const secondi = preparaCertificati(join(dati, "https"), NOMI);
  assert.equal(secondi.server.impronta, primi.server.impronta);
  assert.equal(secondi.ca?.impronta, primi.ca.impronta);
  // Il server manda il suo certificato con quello della CA.
  assert.equal((secondi.catena.match(/BEGIN CERTIFICATE/g) ?? []).length, 2);
  assert.equal(new X509Certificate(secondi.catena).checkIP("192.168.1.20"), "192.168.1.20");
});

test("se cambiano gli indirizzi si rifà il server e la CA resta; un nome nuovo rifà anche la CA, e lo dice", async (t) => {
  const dati = await cartella(t);
  const cartellaHttps = join(dati, "https");
  const primi = preparaCertificati(cartellaHttps, NOMI);
  const altroIndirizzo = preparaCertificati(cartellaHttps, [...NOMI, "10.0.0.5"]);
  assert.equal(altroIndirizzo.ca?.impronta, primi.ca?.impronta);
  assert.notEqual(altroIndirizzo.server.impronta, primi.server.impronta);
  assert.match(altroIndirizzo.avvisi.join(" "), /nomi sono cambiati.*non c'è nulla da reinstallare/);

  const altroNome = preparaCertificati(cartellaHttps, [...NOMI, "shinka.casa"]);
  assert.notEqual(altroNome.ca?.impronta, primi.ca?.impronta);
  assert.match(altroNome.avvisi.join(" "), /va installata di nuovo/);
  assert.equal(new X509Certificate(altroNome.catena).checkHost("shinka.casa"), "shinka.casa");
});

test("un certificato del server che sta per scadere si rifà, con la stessa CA", async (t) => {
  const dati = await cartella(t);
  const cartellaHttps = join(dati, "https");
  const primi = preparaCertificati(cartellaHttps, NOMI);
  const tra790Giorni = new Date(Date.now() + 790 * 86_400_000);
  const dopo = preparaCertificati(cartellaHttps, NOMI, tra790Giorni);
  assert.equal(dopo.ca?.impronta, primi.ca?.impronta);
  assert.notEqual(dopo.server.impronta, primi.server.impronta);
  assert.ok(Date.parse(dopo.server.scadeIl) > Date.parse(primi.server.scadeIl));
});

test("l'HTTPS si accende con la variabile o con la scelta salvata, e i nomi si sommano", async (t) => {
  const dati = await cartella(t);
  assert.deepEqual(leggiConfigurazioneHttps(dati, {}), { attivo: false, nomi: [], reindirizza: false });
  salvaSceltaHttps(dati, { attivo: true, nomi: ["192.168.1.20", "non valido!", " ", "0.0.0.0", "8.8.8.8"], reindirizza: true });
  assert.deepEqual(JSON.parse(await readFile(join(dati, "https.json"), "utf8")), { attivo: true, nomi: ["192.168.1.20"], reindirizza: true });
  assert.deepEqual(leggiConfigurazioneHttps(dati, { SHINKA_HTTPS_NOMI: "shinka.casa, 10.0.0.5" }), {
    attivo: true,
    nomi: ["shinka.casa", "10.0.0.5", "192.168.1.20"],
    reindirizza: true,
  });
  // La variabile vale sopra la scelta salvata.
  assert.equal(leggiConfigurazioneHttps(dati, { SHINKA_HTTPS: "0" }).attivo, false);
  assert.deepEqual(leggiConfigurazioneHttps(dati, { SHINKA_HTTPS_CERTIFICATO: "/a.pem", SHINKA_HTTPS_CHIAVE: "/a.key" }).proprio, { certificato: "/a.pem", chiave: "/a.key" });
  await writeFile(join(dati, "https.json"), "non json");
  assert.equal(leggiConfigurazioneHttps(dati, {}).attivo, false);
});

test("il certificato vale per i nomi dati, la macchina e i suoi indirizzi", () => {
  assert.deepEqual(nomiDelCertificato(["192.168.1.20", "Shinka.Casa"], { nome: "Unraid", indirizzi: ["172.17.0.2"] }), [
    "192.168.1.20",
    "shinka.casa",
    "localhost",
    "127.0.0.1",
    "::1",
    "unraid",
    "172.17.0.2",
  ]);
});

test("un certificato proprio si usa com'è, senza CA di Shinka", async (t) => {
  const dati = await cartella(t);
  const generati = preparaCertificati(join(dati, "https"), NOMI);
  const file = { certificato: join(dati, "mio.pem"), chiave: join(dati, "mio.key") };
  await writeFile(file.certificato, generati.catena);
  await writeFile(file.chiave, generati.chiave);
  const proprio = certificatoProprio(file);
  assert.equal(proprio.proprio, true);
  assert.equal(proprio.ca, undefined);
  assert.ok(proprio.nomi.includes("192.168.1.20"));
  assert.throws(() => certificatoProprio({ certificato: join(dati, "manca.pem"), chiave: file.chiave }));
});

test("il profilo per iOS contiene la CA, e la pagina dice l'impronta e come installarla", async (t) => {
  const dati = await cartella(t);
  const { ca } = preparaCertificati(join(dati, "https"), NOMI);
  assert.ok(ca !== undefined);
  const profilo = profiloApple(ca);
  assert.match(profilo, /<string>com\.apple\.security\.root<\/string>/);
  assert.match(profilo, /<string>Configuration<\/string>/);
  const base64 = /<data>\s*([\s\S]*?)\s*<\/data>/.exec(profilo)?.[1]?.replace(/\s+/g, "") ?? "";
  assert.deepEqual(Buffer.from(base64, "base64"), ca.der);
  const uuid = [...profilo.matchAll(/<key>PayloadUUID<\/key>\s*<string>([^<]+)<\/string>/g)].map((m) => m[1]);
  assert.equal(uuid.length, 2);
  for (const u of uuid) assert.match(u ?? "", /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/);
  assert.notEqual(uuid[0], uuid[1]);

  const pagina = paginaDelCertificato(ca, ["https://192.168.1.20:7850"]);
  assert.ok(pagina.includes(ca.impronta));
  assert.match(pagina, /Attendibilità certificati/);
  assert.match(pagina, /href="\/certificato\/shinka\.mobileconfig"/);
  assert.match(pagina, /href="\/certificato\/shinka-ca\.crt"/);
  assert.match(pagina, /href="https:\/\/192\.168\.1\.20:7850"/);
  assert.match(paginaDelCertificato(undefined, []), /non ha una sua CA/);
});
