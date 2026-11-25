import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { nuovaCoppiaDiChiavi } from "../prove/host-di-prova.ts";
import { CredenzialeRifiutata, UsoRifiutato, Vault, VaultChiuso, type CredenzialeDaCustodire } from "./vault.ts";
import { nuovaCoppia } from "../protocollo/sigillo.ts";

const FRASE = "una frase di sblocco di prova";
const VALORE = "V4lore-di-prova-che-non-deve-uscire";
/** Nei test ricavare la chiave costa poco: quello vero è volutamente lento. */
const COSTO = 2 ** 10;

async function vaultNuovo(t: TestContext): Promise<{ vault: Vault; file: string }> {
  const cartella = await mkdtemp(join(tmpdir(), "shinka-vault-"));
  t.after(() => rm(cartella, { recursive: true, force: true }));
  const file = join(cartella, "vault.json");
  return { vault: await Vault.apri(file, COSTO), file };
}

const CON_PASSWORD: CredenzialeDaCustodire = {
  nome: "nas-root",
  tipo: "password",
  utente: "root",
  host: ["NAS.lan", "192.168.1.5:2222"],
  segreto: VALORE,
};

test("il vault nasce da impostare, e la frase si sceglie una volta sola", async (t) => {
  const { vault } = await vaultNuovo(t);
  assert.equal(vault.condizione, "da-impostare");
  assert.throws(() => vault.elenco(), VaultChiuso);
  await assert.rejects(vault.imposta("corta"), CredenzialeRifiutata);
  await vault.imposta(FRASE);
  assert.equal(vault.condizione, "aperto");
  await assert.rejects(vault.imposta("un'altra frase di sblocco"), CredenzialeRifiutata);
});

test("il file su disco non contiene né il valore né il nome di una credenziale", async (t) => {
  const { vault, file } = await vaultNuovo(t);
  await vault.imposta(FRASE);
  await vault.inserisci(CON_PASSWORD);
  const scritto = await readFile(file, "utf8");
  assert.ok(!scritto.includes(VALORE));
  assert.ok(!scritto.includes("nas-root"));
  assert.ok(!scritto.includes(FRASE));
});

test("dopo un riavvio il vault è chiuso, e si apre solo con la frase giusta", async (t) => {
  const { vault, file } = await vaultNuovo(t);
  await vault.imposta(FRASE);
  await vault.inserisci(CON_PASSWORD);

  const riaperto = await Vault.apri(file, COSTO);
  assert.equal(riaperto.condizione, "chiuso");
  assert.throws(() => riaperto.perUso("nas-root", "nas.lan"), VaultChiuso);
  assert.equal(await riaperto.sblocca("la frase sbagliata, lunga uguale"), false);
  assert.equal(riaperto.condizione, "chiuso");
  assert.equal(await riaperto.sblocca(FRASE), true);
  assert.deepEqual(riaperto.elenco().map((c) => c.nome), ["nas-root"]);

  // A vault aperto la frase serve a riconoscere il proprietario.
  assert.equal(await riaperto.sblocca("la frase sbagliata, lunga uguale"), false);
  assert.equal(await riaperto.sblocca(FRASE), true);

  riaperto.chiudi();
  assert.equal(riaperto.condizione, "chiuso");
  assert.throws(() => riaperto.elenco(), VaultChiuso);
});

test("l'elenco non porta mai il valore", async (t) => {
  const { vault } = await vaultNuovo(t);
  await vault.imposta(FRASE);
  const inserita = await vault.inserisci(CON_PASSWORD);
  assert.deepEqual(inserita.host, ["nas.lan:22", "192.168.1.5:2222"]);
  assert.ok(!JSON.stringify([inserita, vault.elenco()]).includes(VALORE));
});

test("una credenziale si usa solo sugli host per cui è stata inserita", async (t) => {
  const { vault } = await vaultNuovo(t);
  await vault.imposta(FRASE);
  await vault.inserisci(CON_PASSWORD);

  const perUso = vault.perUso("nas-root", "nas.lan");
  assert.equal(perUso.segreto, VALORE);
  assert.equal(perUso.porta, 22);
  assert.equal(vault.perUso("NAS-ROOT", "192.168.1.5:2222").porta, 2222);

  // La stessa macchina su un'altra porta, un altro host, un nome che non esiste.
  assert.throws(() => vault.perUso("nas-root", "192.168.1.5"), UsoRifiutato);
  assert.throws(() => vault.perUso("nas-root", "altro.lan"), /non è prevista per l'host altro\.lan:22/);
  assert.throws(() => vault.perUso("non-esiste", "nas.lan"), /Ci sono: "nas-root"/);
  assert.throws(() => vault.perUso("nas-root", "nas.lan; rm -rf /"), UsoRifiutato);
});

test("una credenziale mal scritta viene rifiutata", async (t) => {
  const { vault } = await vaultNuovo(t);
  await vault.imposta(FRASE);
  await assert.rejects(vault.inserisci({ ...CON_PASSWORD, nome: "Con Spazi" }), CredenzialeRifiutata);
  await assert.rejects(vault.inserisci({ ...CON_PASSWORD, host: [] }), /almeno un host/);
  await assert.rejects(vault.inserisci({ ...CON_PASSWORD, host: ["nas lan"] }), CredenzialeRifiutata);
  await assert.rejects(vault.inserisci({ ...CON_PASSWORD, utente: "" }), CredenzialeRifiutata);
  await assert.rejects(vault.inserisci({ ...CON_PASSWORD, segreto: "" }), /Manca la password/);
  await assert.rejects(vault.inserisci({ ...CON_PASSWORD, tipo: "chiave", segreto: "non è una chiave" }), /non si legge/);
  await vault.inserisci(CON_PASSWORD);
  await assert.rejects(vault.inserisci(CON_PASSWORD), /Esiste già/);
});

test("una chiave protetta da una frase si inserisce solo con la frase giusta", async (t) => {
  const { vault } = await vaultNuovo(t);
  await vault.imposta(FRASE);
  const coppia = nuovaCoppiaDiChiavi("frase-della-chiave");
  const base: CredenzialeDaCustodire = { nome: "server-chiave", tipo: "chiave", utente: "mario", host: ["server.lan"], segreto: coppia.privata };
  await assert.rejects(vault.inserisci(base), /protetta da una frase/);
  await vault.inserisci({ ...base, fraseDellaChiave: "frase-della-chiave" });
  assert.equal(vault.perUso("server-chiave", "server.lan").fraseDellaChiave, "frase-della-chiave");
});

test("sostituire riscrive tutto e dimentica l'impronta dell'host; rimuovere toglie", async (t) => {
  const { vault } = await vaultNuovo(t);
  await vault.imposta(FRASE);
  await vault.inserisci(CON_PASSWORD);
  await vault.annotaUso("nas-root", "nas.lan", "SHA256:prima");
  assert.equal(vault.perUso("nas-root", "nas.lan").impronta, "SHA256:prima");
  assert.notEqual(vault.elenco()[0]?.usataIl, undefined);
  // Un secondo collegamento non cambia l'impronta ricordata.
  await vault.annotaUso("nas-root", "nas.lan", "SHA256:dopo");
  assert.equal(vault.perUso("nas-root", "nas.lan").impronta, "SHA256:prima");

  const sostituita = await vault.sostituisci("nas-root", { ...CON_PASSWORD, nome: "ignorato", host: ["nas.lan"], segreto: "valore-nuovo-di-prova" });
  assert.equal(sostituita?.nome, "nas-root");
  assert.equal(vault.perUso("nas-root", "nas.lan").impronta, undefined);
  assert.equal(vault.perUso("nas-root", "nas.lan").segreto, "valore-nuovo-di-prova");
  assert.throws(() => vault.perUso("nas-root", "192.168.1.5:2222"), UsoRifiutato);
  assert.equal(await vault.sostituisci("non-esiste", CON_PASSWORD), undefined);

  assert.equal(await vault.rimuovi("nas-root"), true);
  assert.equal(await vault.rimuovi("nas-root"), false);
  assert.deepEqual(vault.elenco(), []);
});

test("una credenziale per un sito vale solo per l'origine esatta, e non serve per i comandi sugli host", async (t) => {
  const { vault, file } = await vaultNuovo(t);
  await vault.imposta(FRASE);
  const inVista = await vault.inserisci({
    nome: "banca",
    tipo: "sito",
    utente: "mario@esempio.it",
    host: ["www.banca.example", "https://WWW.banca.example/accesso?x=1", "http://192.168.1.1:8080"],
    segreto: VALORE,
  });
  // Senza protocollo vale https; il percorso non conta; la stessa origine scritta due volte è una.
  assert.deepEqual(inVista.host, ["https://www.banca.example", "http://192.168.1.1:8080"]);
  assert.equal(inVista.tipo, "sito");
  assert.ok(!JSON.stringify(inVista).includes(VALORE));

  assert.deepEqual(vault.perSito("banca", "https://www.banca.example"), { nome: "banca", utente: "mario@esempio.it", segreto: VALORE });
  assert.equal(vault.perSito("banca", "http://192.168.1.1:8080").segreto, VALORE);
  for (const altrove of [
    "http://www.banca.example",
    "https://banca.example",
    "https://www.banca.example.evil.example",
    "https://www.banca.example:8443",
    "https://www.banca-example.com",
    "http://192.168.1.1",
  ]) {
    assert.throws(() => vault.perSito("banca", altrove), UsoRifiutato, altrove);
  }
  assert.throws(() => vault.perSito("manca", "https://www.banca.example"), /non c'è una credenziale/);
  assert.throws(() => vault.perUso("banca", "www.banca.example"), /serve per entrare in un sito/);

  await vault.inserisci(CON_PASSWORD);
  assert.throws(() => vault.perSito("nas-root", "https://nas.lan"), /serve per i comandi sugli host/);

  await assert.rejects(vault.inserisci({ nome: "strano", tipo: "sito", utente: "u", host: ["ftp://esempio.it"], segreto: "x" }), CredenzialeRifiutata);
  await assert.rejects(vault.inserisci({ nome: "strano", tipo: "sito", utente: "u", host: ["https://u:p@esempio.it"], segreto: "x" }), CredenzialeRifiutata);
  await assert.rejects(vault.inserisci({ nome: "strano", tipo: "sito", utente: "u", host: [], segreto: "x" }), /almeno un sito/);

  await vault.annotaUsoNelSito("banca", Date.UTC(2026, 10, 12));
  assert.equal(vault.elenco().find((c) => c.nome === "banca")?.usataIl, "2026-11-12T00:00:00.000Z");
  assert.ok(vault.valoriDaNascondere().includes(VALORE));
  assert.ok(!(await readFile(file, "utf8")).includes(VALORE));
  vault.chiudi();
  assert.deepEqual(vault.valoriDaNascondere(), []);
});

const RECINTO = { porte: { da: 7900, a: 7999 }, radice: "/mnt/user/appdata/shinka-stack/" };

test("un host per gli stack si dichiara con la credenziale: porte dedicate e cartella dei volumi", async (t) => {
  const { vault, file } = await vaultNuovo(t);
  await vault.imposta(FRASE);
  const inserita = await vault.inserisci({ ...CON_PASSWORD, stack: RECINTO });
  assert.deepEqual(inserita.stack, { porte: { da: 7900, a: 7999 }, radice: "/mnt/user/appdata/shinka-stack" });
  assert.deepEqual(vault.hostPerGliStack(), [
    { host: "nas.lan:22", credenziale: "nas-root", recinto: inserita.stack },
    { host: "192.168.1.5:2222", credenziale: "nas-root", recinto: inserita.stack },
  ]);
  const perStack = vault.perStack("NAS.lan");
  assert.equal(perStack.host, "nas.lan:22");
  assert.equal(perStack.credenziale.segreto, VALORE);
  assert.throws(() => vault.perStack("altro.lan"), UsoRifiutato);

  // Su quegli host, e con quella credenziale, un comando libero chiede l'approvazione.
  await vault.inserisci({ ...CON_PASSWORD, nome: "altra", host: ["nas.lan", "terzo.lan"] });
  assert.equal(vault.chiedeApprovazione("nas-root", "nas.lan"), true);
  assert.equal(vault.chiedeApprovazione("altra", "nas.lan:22"), true);
  assert.equal(vault.chiedeApprovazione("altra", "terzo.lan"), false);

  // Dopo un riavvio il recinto si ritrova, e a vault chiuso non si vede.
  const riaperto = await Vault.apri(file, COSTO);
  assert.throws(() => riaperto.hostPerGliStack(), VaultChiuso);
  assert.equal(riaperto.chiedeApprovazione("nas-root", "nas.lan"), false);
  await riaperto.sblocca(FRASE);
  assert.equal(riaperto.hostPerGliStack().length, 2);
  assert.ok(!(await readFile(file, "utf8")).includes("shinka-stack"));
});

test("un recinto scritto male viene rifiutato, e un host ne ha uno solo", async (t) => {
  const { vault } = await vaultNuovo(t);
  await vault.imposta(FRASE);
  for (const stack of [
    { porte: { da: 80, a: 90 }, radice: "/mnt/user/stack" },
    { porte: { da: 8000, a: 7000 }, radice: "/mnt/user/stack" },
    { porte: { da: 2000, a: 9000 }, radice: "/mnt/user/stack" },
    { porte: { da: 7900, a: 7999 }, radice: "/" },
    { porte: { da: 7900, a: 7999 }, radice: "/mnt" },
    { porte: { da: 7900, a: 7999 }, radice: "relativa/cartella" },
    { porte: { da: 7900, a: 7999 }, radice: "/mnt/../etc" },
    { porte: { da: 7900, a: 7999 }, radice: "/mnt/user/con spazio" },
  ]) {
    await assert.rejects(vault.inserisci({ ...CON_PASSWORD, stack }), CredenzialeRifiutata, JSON.stringify(stack));
  }
  await assert.rejects(
    vault.inserisci({ nome: "sito", tipo: "sito", utente: "io@esempio.it", host: ["https://esempio.it"], segreto: VALORE, stack: RECINTO }),
    CredenzialeRifiutata,
  );

  await vault.inserisci({ ...CON_PASSWORD, stack: RECINTO });
  await assert.rejects(vault.inserisci({ ...CON_PASSWORD, nome: "seconda", host: ["nas.lan"], stack: RECINTO }), /un host ha un solo recinto/);
  // Sostituendola senza recinto, l'host non è più un host per gli stack.
  await vault.sostituisci("nas-root", CON_PASSWORD);
  assert.deepEqual(vault.hostPerGliStack(), []);
  assert.equal(vault.chiedeApprovazione("nas-root", "nas.lan"), false);
});

test("la credenziale del server si dichiara all'inserimento, e vale per tutto ciò che arriva su quegli host", async (t) => {
  const { vault } = await vaultNuovo(t);
  await vault.imposta(FRASE);
  const inVista = await vault.inserisci({ ...CON_PASSWORD, server: true });
  assert.equal(inVista.server, true);
  assert.equal(vault.elenco()[0]?.server, true);
  await vault.inserisci({ ...CON_PASSWORD, nome: "altra", host: ["nas.lan", "altro.lan"] });
  assert.equal(vault.elenco().find((una) => una.nome === "altra")?.server, undefined);

  // Con quella credenziale, e con qualunque altra sugli stessi host, il sì lo chiede il gateway.
  assert.equal(vault.chiedeIlSiAlGateway("nas-root", "nas.lan"), true);
  assert.equal(vault.chiedeIlSiAlGateway("altra", "NAS.lan:22"), true);
  assert.equal(vault.chiedeIlSiAlGateway("altra", "192.168.1.5:2222"), true);
  assert.equal(vault.chiedeIlSiAlGateway("altra", "altro.lan"), false);

  // Sostituendola senza la dichiarazione torna una credenziale come le altre.
  await vault.sostituisci("nas-root", CON_PASSWORD);
  assert.equal(vault.elenco().find((una) => una.nome === "nas-root")?.server, undefined);
  assert.equal(vault.chiedeIlSiAlGateway("nas-root", "nas.lan"), false);

  // Né un sito né la chiave di un'estensione possono essere "il server".
  await assert.rejects(
    vault.inserisci({ nome: "sito", tipo: "sito", utente: "mario", host: ["www.esempio.example"], segreto: VALORE, server: true }),
    /non può essere la credenziale del server/,
  );
  await assert.rejects(
    vault.inserisci({ nome: "meteo", tipo: "estensione", utente: "METEO_API_KEY", host: ["Casa"], segreto: "chiave-finta-di-prova", estensione: "meteo", server: true }),
    /non può essere la credenziale del server/,
  );
});

test("una credenziale per SSH si dà a un ambiente con la chiave del suo nodo: un'altra chiave non la riceve (ADR 0062)", async (t) => {
  const { vault, file } = await vaultNuovo(t);
  await vault.imposta(FRASE);
  const pc = { id: "pc", nome: "PC ATES", chiave: nuovaCoppia().pubblica };
  await vault.inserisci({ nome: "lab", tipo: "password", utente: "mario", host: ["10.20.0.5:22"], segreto: "segreto-del-lab" });
  await vault.inserisci({ nome: "server", tipo: "password", utente: "root", host: ["192.168.1.20:22"], segreto: "segreto-del-server", server: true });
  await vault.inserisci({ nome: "sito", tipo: "sito", utente: "io", host: ["https://esempio.it"], segreto: "segreto-del-sito" });

  assert.equal((await vault.impostaAmbienti("lab", [pc]))?.ambienti?.[0]?.nome, "PC ATES");
  await assert.rejects(vault.impostaAmbienti("server", [pc]), CredenzialeRifiutata);
  await assert.rejects(vault.impostaAmbienti("sito", [pc]), CredenzialeRifiutata);
  assert.equal(await vault.impostaAmbienti("non-esiste", [pc]), undefined);

  assert.deepEqual(vault.perAmbiente("pc", pc.chiave).map((una) => [una.nome, una.segreto, una.host]), [["lab", "segreto-del-lab", ["10.20.0.5:22"]]]);
  // Un nodo che si presenta con un'altra chiave, o un altro ambiente, non la riceve.
  assert.deepEqual(vault.perAmbiente("pc", nuovaCoppia().pubblica), []);
  assert.deepEqual(vault.perAmbiente("altro", pc.chiave), []);
  assert.deepEqual(vault.ambientiDi("LAB").map((uno) => uno.id), ["pc"]);
  assert.deepEqual(vault.ambientiDi("server"), []);
  // Nella vista l'ambiente c'è, la chiave no.
  assert.equal(JSON.stringify(vault.elenco()).includes(pc.chiave), false);

  // Sostituita, la credenziale resta data a quell'ambiente; riaperto il vault, la scelta c'è ancora.
  await vault.sostituisci("lab", { nome: "lab", tipo: "password", utente: "mario", host: ["10.20.0.5:22"], segreto: "segreto-nuovo" });
  vault.chiudi();
  assert.throws(() => vault.perAmbiente("pc", pc.chiave), VaultChiuso);
  assert.deepEqual(vault.ambientiDi("lab"), []);
  const riaperto = await Vault.apri(file, 2 ** 10);
  assert.equal(await riaperto.sblocca(FRASE), true);
  assert.equal(riaperto.perAmbiente("pc", pc.chiave)[0]?.segreto, "segreto-nuovo");
  // Tolta all'ambiente, non la riceve più.
  await riaperto.impostaAmbienti("lab", []);
  assert.deepEqual(riaperto.perAmbiente("pc", pc.chiave), []);
});
