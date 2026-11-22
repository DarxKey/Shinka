import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { harnessDiProva } from "../prove/harness-di-prova.ts";
import { repositoryDiProva } from "../prove/plugin-di-prova.ts";
import { avvisiDellaDefinizione, contenutoInRighe, type ChiaviConsegnate, type EstensioneDistribuita } from "../protocollo/estensioni.ts";
import {
  configurazioneDelServer,
  esaminaPlugin,
  EstensioniInAmbiente,
  gitVero,
  leggiContenutoPlugin,
  preparaPlugin,
  risolviCommit,
  type Git,
} from "./estensioni.ts";

/** Un valore finto, fatto per riconoscerlo se finisse dove non deve. */
const CHIAVE_FINTA = "chiave-FINTA-di-prova-0001";

async function cartellaDiProva(t: TestContext): Promise<string> {
  const cartella = await mkdtemp(join(tmpdir(), "shinka-estensioni-"));
  t.after(() => rm(cartella, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return cartella;
}

const LOCALE: EstensioneDistribuita = {
  id: "id-meteo",
  nome: "meteo",
  definizione: { tipo: "mcp-locale", comando: "node", argomenti: ["meteo.js"], variabili: { REGIONE: "veneto" } },
  chiavi: [],
};

test("la definizione di un server diventa quella che l'harness vuole, con le chiavi al loro posto", () => {
  assert.deepEqual(configurazioneDelServer(LOCALE.definizione, { METEO_TOKEN: CHIAVE_FINTA }), {
    command: "node",
    args: ["meteo.js"],
    env: { REGIONE: "veneto", METEO_TOKEN: CHIAVE_FINTA },
  });
  assert.deepEqual(configurazioneDelServer({ tipo: "mcp-remoto", indirizzo: "https://mcp.esempio.it/", trasporto: "http" }), {
    type: "http",
    url: "https://mcp.esempio.it/",
  });
  assert.deepEqual(configurazioneDelServer({ tipo: "mcp-remoto", indirizzo: "https://mcp.esempio.it/", trasporto: "sse" }, { Authorization: CHIAVE_FINTA }), {
    type: "sse",
    url: "https://mcp.esempio.it/",
    headers: { Authorization: CHIAVE_FINTA },
  });
  assert.equal(configurazioneDelServer({ tipo: "plugin", repository: "https://esempio.it/p.git", commit: "a".repeat(40) }), undefined);
});

test("il commit di un riferimento si trova nel repository, e uno scritto per intero resta com'è", async (t) => {
  const { repository, primo, secondo } = await repositoryDiProva(t);
  assert.deepEqual(await risolviCommit(repository, undefined), { commit: secondo });
  assert.deepEqual(await risolviCommit(repository, "main"), { commit: secondo });
  assert.deepEqual(await risolviCommit(repository, "v1"), { commit: primo });
  assert.deepEqual(await risolviCommit(repository, primo.toUpperCase()), { commit: primo });
  const manca = await risolviCommit(repository, "non-esiste");
  assert.ok("motivo" in manca && /non c'è un ramo o un'etichetta "non-esiste"/.test(manca.motivo));
  // Un riferimento non diventa un'opzione di git.
  const opzione = await risolviCommit(repository, "--upload-pack=calc");
  assert.ok("motivo" in opzione);
  const altrove = await risolviCommit(join(repository, "non-c-e"), undefined);
  assert.ok("motivo" in altrove && /non si è potuto leggere/.test(altrove.motivo));
});

test("un plugin viene preso fermo al suo commit, una volta sola, e se ne legge il contenuto senza eseguirlo", async (t) => {
  const { repository, primo, secondo } = await repositoryDiProva(t);
  const base = await cartellaDiProva(t);

  const preso = await preparaPlugin(base, "id-plugin", { tipo: "plugin", repository, commit: primo });
  assert.ok("radice" in preso, JSON.stringify(preso));
  assert.equal(preso.radice, join(base, `id-plugin-${primo.slice(0, 12)}`));
  // Fermo al primo commit: ciò che è arrivato dopo non c'è.
  assert.ok(!existsSync(join(preso.radice, "agents")));
  assert.deepEqual(await leggiContenutoPlugin(preso.radice), {
    nome: "di-prova",
    versione: "0.1.0",
    descrizione: "Un plugin per i test.",
    skill: ["saluta"],
    comandi: ["riassumi"],
    agenti: [],
    agganci: [{ evento: "PreToolUse", comando: "node controlla.js" }],
    server: ["interno"],
    altro: [],
  });

  // La seconda volta non si scarica nulla.
  const chiamate: string[][] = [];
  const contato: Git = (cartella, argomenti) => {
    chiamate.push(argomenti);
    return gitVero(cartella, argomenti);
  };
  assert.deepEqual(await preparaPlugin(base, "id-plugin", { tipo: "plugin", repository, commit: primo }, contato), preso);
  assert.deepEqual(chiamate, []);

  // Un altro commit sta in un'altra cartella.
  const dopo = await preparaPlugin(base, "id-plugin", { tipo: "plugin", repository, commit: secondo });
  assert.ok("radice" in dopo && dopo.radice !== preso.radice);
  assert.deepEqual((await leggiContenutoPlugin(dopo.radice)).agenti, ["revisore"]);

  const fuori = await preparaPlugin(base, "id-plugin", { tipo: "plugin", repository, commit: primo, cartella: "../altrove" });
  assert.deepEqual(fuori, { motivo: "La cartella indicata esce dal repository." });
  const vuota = await preparaPlugin(base, "id-plugin", { tipo: "plugin", repository, commit: primo, cartella: "skills" });
  assert.ok("motivo" in vuota && /manca \.claude-plugin\/plugin\.json/.test(vuota.motivo));
  const inesistente = await preparaPlugin(base, "altro", { tipo: "plugin", repository, commit: "0".repeat(40) });
  assert.ok("motivo" in inesistente, JSON.stringify(inesistente));
});

test("esaminare un plugin dice che cosa contiene e non lascia nulla sul disco", async (t) => {
  const { repository, primo } = await repositoryDiProva(t);
  const provvisoria = join(await cartellaDiProva(t), "in-esame");
  const esame = await esaminaPlugin(provvisoria, repository, "v1", undefined);
  assert.ok("definizione" in esame, JSON.stringify(esame));
  assert.deepEqual(esame.definizione, { tipo: "plugin", repository, commit: primo });
  assert.deepEqual(esame.contenuto.skill, ["saluta"]);
  assert.deepEqual(await readdir(provvisoria), []);

  const manca = await esaminaPlugin(provvisoria, repository, "non-esiste", undefined);
  assert.ok("motivo" in manca);
});

test("un server viene provato da solo, in un harness che non vede altro, e dice gli strumenti che offre", async (t) => {
  const cartella = await cartellaDiProva(t);
  const harness = harnessDiProva();
  const estensioni = new EstensioniInAmbiente({ cartella, radiceProgetti: join(cartella, "progetti"), apriHarness: harness.apri });

  assert.deepEqual(await estensioni.prova(LOCALE), { riuscita: true, strumenti: ["saluta", "ha_la_chiave"] });
  assert.deepEqual(harness.aperture, [{ cartella, isolata: true }]);
  assert.deepEqual(harness.avviati, [{ meteo: { command: "node", args: ["meteo.js"], env: { REGIONE: "veneto" } } }]);
  assert.equal(harness.chiusi, 1);
  // La prova non la accende.
  assert.deepEqual(await estensioni.server(), { server: {}, nonPartite: [] });

  const rotta = await estensioni.prova({ ...LOCALE, definizione: { tipo: "mcp-locale", comando: "non-parte", argomenti: [], variabili: {} } });
  assert.deepEqual(rotta, { riuscita: false, motivo: "Non è partita: Connection closed" });

  const conAccesso = await estensioni.prova({
    id: "id-remoto",
    nome: "remoto",
    definizione: { tipo: "mcp-remoto", indirizzo: "https://oauth.esempio.it/mcp", trasporto: "http" },
    chiavi: [],
  });
  assert.ok(!conAccesso.riuscita && /OAuth/.test(conAccesso.motivo) && conAccesso.riprovabile === undefined);
  assert.equal(harness.chiusi, 3);
});

test("un server che resta in attesa viene aspettato, e uno che non risponde non blocca la prova", async (t) => {
  const cartella = await cartellaDiProva(t);
  let chieste = 0;
  const lento = harnessDiProva({ stato: () => ((chieste += 1) < 3 ? { status: "pending" } : { status: "connected", tools: [{ name: "uno" }] }) });
  const estensioni = new EstensioniInAmbiente({ cartella, radiceProgetti: cartella, apriHarness: lento.apri, attesaProvaMs: 5_000 });
  assert.deepEqual(await estensioni.prova(LOCALE), { riuscita: true, strumenti: ["uno"] });

  const muto = new EstensioniInAmbiente({
    cartella,
    radiceProgetti: cartella,
    attesaProvaMs: 50,
    apriHarness: () => ({
      setMcpServers: () => new Promise(() => {}),
      mcpServerStatus: async () => [],
      reloadPlugins: () => new Promise(() => {}),
      close: () => {},
    }),
  });
  assert.deepEqual(await muto.prova(LOCALE), { riuscita: false, motivo: "Non ha risposto in tempo." });
});

test("le chiavi si chiedono per nome nel momento in cui il server parte, e senza tutte non parte", async (t) => {
  const cartella = await cartellaDiProva(t);
  const harness = harnessDiProva();
  const chieste: string[] = [];
  let consegna: ChiaviConsegnate = { valori: { METEO_TOKEN: CHIAVE_FINTA, ALTRA: "non richiesta" } };
  const estensioni = new EstensioniInAmbiente({
    cartella,
    radiceProgetti: cartella,
    apriHarness: harness.apri,
    chiavi: async (nome) => {
      chieste.push(nome);
      return consegna;
    },
  });
  const conChiave: EstensioneDistribuita = { ...LOCALE, chiavi: ["METEO_TOKEN"] };

  assert.equal((await estensioni.prova(conChiave)).riuscita, true);
  assert.deepEqual(chieste, ["meteo"]);
  // Al programma arriva la chiave dichiarata, e solo quella.
  assert.deepEqual(harness.avviati[0], { meteo: { command: "node", args: ["meteo.js"], env: { REGIONE: "veneto", METEO_TOKEN: CHIAVE_FINTA } } });

  // Accesa, le chiavi vengono chieste di nuovo a ogni conversazione che parte.
  await estensioni.imposta([conChiave]);
  assert.deepEqual(await estensioni.server(), {
    server: { meteo: { command: "node", args: ["meteo.js"], env: { REGIONE: "veneto", METEO_TOKEN: CHIAVE_FINTA } } },
    nonPartite: [],
  });
  assert.deepEqual(chieste, ["meteo", "meteo"]);

  // Il vault è chiuso, o la chiave manca: il motivo si dice, e la prova si può rifare.
  consegna = { motivo: "il vault è chiuso" };
  assert.deepEqual(await estensioni.prova(conChiave), { riuscita: false, motivo: "Non è partita: il vault è chiuso.", riprovabile: true });
  assert.deepEqual(await estensioni.server(), { server: {}, nonPartite: [{ nome: "meteo", motivo: "il vault è chiuso" }] });
  consegna = { valori: {} };
  assert.deepEqual(await estensioni.prova(conChiave), { riuscita: false, motivo: "Non è partita: nel vault manca la chiave METEO_TOKEN.", riprovabile: true });
  // Nessun harness è stato aperto per una prova che non poteva partire.
  assert.equal(harness.aperture.length, 1);

  const senzaVault = new EstensioniInAmbiente({ cartella, radiceProgetti: cartella, apriHarness: harness.apri });
  const esito = await senzaVault.prova(conChiave);
  assert.ok(!esito.riuscita && esito.riprovabile === true);
});

test("un plugin acceso viene preso e dato alle conversazioni; spento, la sua cartella sparisce", async (t) => {
  const { repository, primo, secondo } = await repositoryDiProva(t);
  const cartella = await cartellaDiProva(t);
  const harness = harnessDiProva();
  let cambi = 0;
  const estensioni = new EstensioniInAmbiente({ cartella, radiceProgetti: cartella, apriHarness: harness.apri, alCambio: () => (cambi += 1) });
  const plugin: EstensioneDistribuita = { id: "id-plugin", nome: "di-prova", definizione: { tipo: "plugin", repository, commit: primo }, chiavi: [] };
  const radice = join(cartella, "plugin", `id-plugin-${primo.slice(0, 12)}`);

  // La prova lo prende, lo fa caricare all'harness e dice che cosa contiene.
  const provato = await estensioni.prova(plugin);
  assert.ok(provato.riuscita, JSON.stringify(provato));
  assert.deepEqual(provato.strumenti, []);
  assert.deepEqual(provato.contenuto?.skill, ["saluta"]);
  assert.deepEqual(harness.aperture, [{ cartella, isolata: true, plugin: [radice] }]);
  assert.deepEqual(estensioni.plugin(), []);
  assert.equal(cambi, 0);

  await estensioni.imposta([plugin, LOCALE]);
  assert.deepEqual(estensioni.plugin(), [radice]);
  assert.deepEqual(Object.keys((await estensioni.server()).server), ["meteo"]);
  assert.equal(cambi, 1);
  // Lo stesso elenco, arrivato di nuovo, non fa ripartire nulla.
  await estensioni.imposta([plugin, LOCALE]);
  assert.equal(cambi, 1);

  // Aggiornato a un altro commit: la cartella di prima non resta.
  await estensioni.imposta([{ ...plugin, definizione: { tipo: "plugin", repository, commit: secondo } }]);
  assert.deepEqual(estensioni.plugin(), [join(cartella, "plugin", `id-plugin-${secondo.slice(0, 12)}`)]);
  assert.ok(!existsSync(radice));
  assert.equal(cambi, 2);

  await estensioni.imposta([]);
  assert.deepEqual(estensioni.plugin(), []);
  assert.deepEqual(await readdir(join(cartella, "plugin")), []);
  assert.equal(cambi, 3);
});

test("un plugin che l'harness non carica non risulta partito, e uno che non si può prendere non ferma gli altri", async (t) => {
  const { repository, primo } = await repositoryDiProva(t);
  const cartella = await cartellaDiProva(t);
  const sordo = harnessDiProva();
  const estensioni = new EstensioniInAmbiente({
    cartella,
    radiceProgetti: cartella,
    apriHarness: (apertura) => ({ ...sordo.apri(apertura), reloadPlugins: async () => ({ plugins: [], mcpServers: [], commands: [], error_count: 1 }) }),
  });
  const plugin: EstensioneDistribuita = { id: "id-plugin", nome: "di-prova", definizione: { tipo: "plugin", repository, commit: primo }, chiavi: [] };
  const esito = await estensioni.prova(plugin);
  assert.ok(!esito.riuscita && /non ha caricato il plugin/.test(esito.motivo));

  const sparito: EstensioneDistribuita = { id: "id-sparito", nome: "sparito", definizione: { tipo: "plugin", repository: join(cartella, "non-c-e"), commit: primo }, chiavi: [] };
  const provato = await estensioni.prova(sparito);
  assert.ok(!provato.riuscita && /non si è potuto leggere/.test(provato.motivo));
  await estensioni.imposta([sparito, plugin]);
  assert.deepEqual(estensioni.plugin(), [join(cartella, "plugin", `id-plugin-${primo.slice(0, 12)}`)]);
});

test("guardare un ambiente dice ciò che il proprietario ha installato, non ciò che porta l'harness né ciò che è di Shinka", async (t) => {
  const cartella = await cartellaDiProva(t);
  const harness = harnessDiProva();
  const radiceProgetti = join(cartella, "progetti");
  const estensioni = new EstensioniInAmbiente({ cartella, radiceProgetti, apriHarness: harness.apri });

  const viste = await estensioni.guarda();
  // Si guarda dalla cartella dei progetti, con le impostazioni dell'ambiente.
  assert.deepEqual(harness.aperture, [{ cartella: radiceProgetti, isolata: false }]);
  assert.deepEqual(viste.plugin, [{ nome: "del-proprietario", versione: "1.2.0" }]);
  assert.deepEqual(viste.server, [{ nome: "appunti", provenienza: "user" }]);
  assert.deepEqual(viste.skill, ["del-proprietario:riassumi", "mia-skill"]);
  assert.equal(viste.quanteSkill, 2);
  assert.ok(!Number.isNaN(Date.parse(viste.quando)));
  assert.equal(harness.chiusi, 1);
  // Guardare non avvia nulla.
  assert.deepEqual(harness.avviati, []);
});

test("ciò che un plugin porta in una forma che Shinka non conosce viene nominato lo stesso nella scheda", async (t) => {
  const radice = await cartellaDiProva(t);
  const scrivi = async (nome: string, contenuto: unknown): Promise<void> => {
    await mkdir(join(radice, nome, ".."), { recursive: true });
    await writeFile(join(radice, nome), typeof contenuto === "string" ? contenuto : JSON.stringify(contenuto));
  };
  await scrivi(".claude-plugin/plugin.json", { name: "moderno", version: "0.1.0", author: { name: "Qualcuno" }, userConfig: { modo: { type: "string" } } });
  // Agganci dichiarati come moduli di codice, non come comandi: partono da soli lo stesso.
  await scrivi("hooks/hooks.json", { description: "Fa qualcosa a ogni chiamata.", modules: ["./register.ts"] });
  await scrivi("hooks/register.ts", "export {};\n");
  await scrivi("README.md", "Leggimi.\n");
  await scrivi("LICENSE", "Licenza.\n");
  await scrivi("settings.json", {});
  await scrivi("scripts/installa.sh", "echo ciao\n");

  const contenuto = await leggiContenutoPlugin(radice);
  assert.deepEqual(contenuto, {
    nome: "moderno",
    versione: "0.1.0",
    skill: [],
    comandi: [],
    agenti: [],
    agganci: [{ evento: "codice del plugin", comando: "./register.ts" }],
    server: [],
    altro: ["voci del manifesto che Shinka non conosce (userConfig)", "altri file e cartelle (scripts, settings.json)"],
  });
  assert.deepEqual(contenutoInRighe(contenuto), ["Parte da solo (codice del plugin): ./register.ts"]);
  const avvisi = avvisiDellaDefinizione({ tipo: "plugin", repository: "https://esempio.it/plugin.git", commit: "0".repeat(40) }, contenuto);
  assert.match(avvisi[1] ?? "", /un comando che parte da solo durante le conversazioni, senza chiedere il consenso/);
  assert.match(avvisi[2] ?? "", /Porta con sé anche: voci del manifesto che Shinka non conosce \(userConfig\), altri file e cartelle \(scripts, settings\.json\)\./);

  // Una cartella di agganci che non si sa leggere affatto non passa per un plugin senza agganci.
  await scrivi("hooks/hooks.json", "non è JSON");
  assert.deepEqual((await leggiContenutoPlugin(radice)).agganci, [
    { evento: "non letto", comando: "agganci dichiarati in una forma che Shinka non sa leggere" },
  ]);

  // Skill e comandi messi dove vuole il plugin: la scheda non li elenca, e lo dice.
  await rm(join(radice, "hooks"), { recursive: true });
  await scrivi(".claude-plugin/plugin.json", { name: "moderno", skills: ["./mie-skill"], commands: "./miei-comandi" });
  await scrivi("mie-skill/saluta/SKILL.md", "Saluta.\n");
  const altrove = await leggiContenutoPlugin(radice);
  assert.deepEqual(altrove.agganci, []);
  assert.deepEqual(altrove.altro, [
    "skill, comandi o agenti in cartelle scelte dal plugin, che questa scheda non elenca",
    "altri file e cartelle (mie-skill, scripts, settings.json)",
  ]);
});
