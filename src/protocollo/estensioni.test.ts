import assert from "node:assert/strict";
import { test } from "node:test";
import {
  avvisiDellaDefinizione,
  contenutoInRighe,
  definizioneInChiaro,
  difettoDelNome,
  inUnaRiga,
  leggiChiaviConsegnate,
  leggiDefinizione,
  leggiEsitoProva,
  leggiEstensioneDistribuita,
  leggiEstensioniDellAmbiente,
  nomeDiChiaveValido,
  prefissoDegliStrumenti,
  type ContenutoPlugin,
  type DefinizioneEstensione,
} from "./estensioni.ts";

const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const LOCALE: DefinizioneEstensione = { tipo: "mcp-locale", comando: "npx", argomenti: ["-y", "meteo-mcp@1.2.0", "--zona", "nord est"], variabili: { REGIONE: "veneto" } };
const REMOTO: DefinizioneEstensione = { tipo: "mcp-remoto", indirizzo: "https://mcp.esempio.it/mcp", trasporto: "http" };
const PLUGIN: DefinizioneEstensione = { tipo: "plugin", repository: "https://esempio.it/plugin.git", commit: COMMIT, cartella: "plugins/uno" };
const CONTENUTO: ContenutoPlugin = {
  nome: "di-prova",
  skill: ["saluta", "riassumi"],
  comandi: ["rilascia"],
  agenti: [],
  agganci: [{ evento: "PreToolUse", comando: "node controlla.js" }],
  server: ["interno"],
  altro: ["programmi nella cartella bin"],
};

test("il nome di un'estensione e quello di una chiave hanno una forma sola", () => {
  for (const nome of ["meteo", "meteo-2", "a", "0mcp"]) assert.equal(difettoDelNome(nome), undefined, nome);
  for (const nome of ["", "Meteo", "-meteo", "meteo bello", "meteo_2", "x".repeat(41), "mcp__meteo"]) assert.ok(difettoDelNome(nome), nome);
  // I nomi che sono già di Shinka o dell'harness non si prendono.
  for (const nome of ["shinka", "claude-in-chrome", "plugin"]) assert.match(difettoDelNome(nome) ?? "", /già usato da Shinka/);
  for (const nome of ["METEO_TOKEN", "Authorization", "X-Api-Key", "_x"]) assert.ok(nomeDiChiaveValido(nome), nome);
  for (const nome of ["", "9X", "IL MIO TOKEN", "x=1", "a".repeat(81)]) assert.ok(!nomeDiChiaveValido(nome), nome);
  assert.equal(prefissoDegliStrumenti("meteo"), "mcp__meteo__");
});

test("la scheda mostra la definizione per intero, e la riga breve la riassume", () => {
  assert.equal(inUnaRiga(LOCALE), 'npx -y meteo-mcp@1.2.0 --zona "nord est"');
  assert.deepEqual(definizioneInChiaro(LOCALE), ['npx -y meteo-mcp@1.2.0 --zona "nord est"', "REGIONE=veneto"]);
  assert.equal(inUnaRiga(REMOTO), "https://mcp.esempio.it/mcp");
  assert.deepEqual(definizioneInChiaro(REMOTO), ["https://mcp.esempio.it/mcp (http)"]);
  assert.equal(inUnaRiga(PLUGIN), "https://esempio.it/plugin.git @ 0123456789ab (plugins/uno)");
  // Nella scheda il commit è scritto tutto: è ciò che verrà preso.
  assert.deepEqual(definizioneInChiaro(PLUGIN), ["https://esempio.it/plugin.git", `commit ${COMMIT}`, "cartella plugins/uno"]);
  assert.deepEqual(contenutoInRighe(CONTENUTO), [
    "2 skill: saluta, riassumi",
    "Un comando: rilascia",
    "Parte da solo (PreToolUse): node controlla.js",
  ]);
  assert.deepEqual(contenutoInRighe({ ...CONTENUTO, skill: [], comandi: [], agganci: [] }), ["Non contiene skill, comandi né agenti."]);
});

test("gli avvisi dicono ciò che la definizione da sola non dice", () => {
  // Con la versione scritta, resta solo l'avviso che vale per ogni programma di terzi.
  assert.equal(avvisiDellaDefinizione(LOCALE).length, 1);
  assert.match(avvisiDellaDefinizione(LOCALE)[0] ?? "", /programma di terzi/);
  for (const argomenti of [["-y", "meteo-mcp"], ["--yes", "@ditta/meteo-mcp"]]) {
    for (const comando of ["npx", "C:\\Program Files\\nodejs\\npx.cmd", "/usr/bin/uvx"]) {
      const avvisi = avvisiDellaDefinizione({ ...LOCALE, comando, argomenti });
      assert.match(avvisi[1] ?? "", /La versione di ".*meteo-mcp" non è scritta nel comando/, `${comando} ${argomenti.join(" ")}`);
    }
  }
  assert.equal(avvisiDellaDefinizione({ ...LOCALE, comando: "uvx", argomenti: ["meteo-mcp==1.2.0"] }).length, 1);
  // Un programma che non scarica nulla non ha una versione da scrivere.
  assert.equal(avvisiDellaDefinizione({ ...LOCALE, comando: "node", argomenti: ["meteo.js"] }).length, 1);

  assert.match(avvisiDellaDefinizione(REMOTO)[0] ?? "", /esce da Shinka/);
  assert.equal(avvisiDellaDefinizione(REMOTO).length, 1);
  assert.match(avvisiDellaDefinizione({ ...REMOTO, indirizzo: "http://192.168.1.5:8080/mcp" })[1] ?? "", /non è cifrato/);

  const delPlugin = avvisiDellaDefinizione(PLUGIN, CONTENUTO);
  assert.match(delPlugin[0] ?? "", /resta fermo al commit indicato/);
  assert.match(delPlugin[1] ?? "", /un comando che parte da solo durante le conversazioni, senza chiedere il consenso/);
  assert.match(delPlugin[2] ?? "", /Dichiara un server MCP \(interno\) che Shinka non avvia/);
  assert.match(delPlugin[3] ?? "", /Porta con sé anche: programmi nella cartella bin\./);
  assert.equal(avvisiDellaDefinizione(PLUGIN, { ...CONTENUTO, agganci: [], server: [], altro: [] }).length, 1);
});

test("ciò che il centro manda a un nodo viene letto solo se ha la forma giusta", () => {
  const distribuita = { id: "8b0c2e7a-1f7d-4c56-9a51-2f0f1c6f1a11", nome: "meteo", definizione: LOCALE, chiavi: ["METEO_TOKEN"] };
  assert.deepEqual(leggiEstensioneDistribuita(JSON.parse(JSON.stringify(distribuita))), distribuita);
  assert.deepEqual(leggiDefinizione(REMOTO), REMOTO);
  assert.deepEqual(leggiDefinizione(PLUGIN), PLUGIN);

  const guaste: unknown[] = [
    undefined,
    "meteo",
    { ...distribuita, nome: "Meteo Bello" },
    { ...distribuita, nome: "shinka" },
    // L'identificativo finisce nel nome di una cartella: non deve poterne uscire.
    { ...distribuita, id: "../../fuori" },
    { ...distribuita, id: "" },
    { ...distribuita, chiavi: ["non è un nome"] },
    { ...distribuita, chiavi: Array.from({ length: 21 }, (_, i) => `CHIAVE_${i}`) },
    { ...distribuita, chiavi: "METEO_TOKEN" },
    { ...distribuita, definizione: { tipo: "sconosciuto" } },
    { ...distribuita, definizione: { ...LOCALE, comando: "" } },
    { ...distribuita, definizione: { ...LOCALE, argomenti: ["-y", 3] } },
    { ...distribuita, definizione: { ...LOCALE, variabili: { "NON VALIDA": "x" } } },
    { ...distribuita, definizione: { ...REMOTO, indirizzo: "file:///etc/passwd" } },
    { ...distribuita, definizione: { ...REMOTO, trasporto: "stdio" } },
    // Né il repository né il commit possono diventare un'opzione di git.
    { ...distribuita, definizione: { ...PLUGIN, repository: "--upload-pack=calc" } },
    { ...distribuita, definizione: { ...PLUGIN, commit: "main" } },
    { ...distribuita, definizione: { ...PLUGIN, commit: "--force" } },
    { ...distribuita, definizione: { ...PLUGIN, cartella: 3 } },
  ];
  for (const guasta of guaste) assert.equal(leggiEstensioneDistribuita(guasta), undefined, JSON.stringify(guasta));

  assert.deepEqual(leggiChiaviConsegnate({ valori: { METEO_TOKEN: "chiave-FINTA" } }), { valori: { METEO_TOKEN: "chiave-FINTA" } });
  assert.deepEqual(leggiChiaviConsegnate({ motivo: "Il vault è chiuso." }), { motivo: "Il vault è chiuso." });
  for (const guasta of [undefined, {}, { valori: ["x"] }, { valori: { METEO_TOKEN: 3 } }]) assert.equal(leggiChiaviConsegnate(guasta), undefined);
});

test("ciò che un nodo riferisce viene letto solo se ha la forma giusta, e accorciato a ciò che si mostra", () => {
  assert.deepEqual(leggiEsitoProva({ riuscita: true, strumenti: ["saluta"] }), { riuscita: true, strumenti: ["saluta"] });
  assert.deepEqual(leggiEsitoProva({ riuscita: true, strumenti: [], contenuto: CONTENUTO }), { riuscita: true, strumenti: [], contenuto: CONTENUTO });
  assert.deepEqual(leggiEsitoProva({ riuscita: false, motivo: "Non è partita.", riprovabile: true }), { riuscita: false, motivo: "Non è partita.", riprovabile: true });
  assert.deepEqual(leggiEsitoProva({ riuscita: false, motivo: "Non è partita.", riprovabile: "sì" }), { riuscita: false, motivo: "Non è partita." });
  for (const guasto of [undefined, {}, { riuscita: true }, { riuscita: true, strumenti: [1] }, { riuscita: false }, { riuscita: true, strumenti: [], contenuto: { skill: [] } }]) {
    assert.equal(leggiEsitoProva(guasto), undefined, JSON.stringify(guasto));
  }
  // Un server con moltissimi strumenti non fa cadere il collegamento: se ne tengono i primi.
  const tanti = leggiEsitoProva({ riuscita: true, strumenti: Array.from({ length: 900 }, (_, i) => `strumento_${i}`) });
  assert.ok(tanti?.riuscita === true && tanti.strumenti.length === 500);
  const lungo = leggiEsitoProva({ riuscita: false, motivo: "x".repeat(5000) });
  assert.ok(lungo?.riuscita === false && lungo.motivo.length === 2000);

  const viste = {
    quando: "2026-11-12T09:00:00.000Z",
    server: [{ nome: "appunti", provenienza: "user" }],
    plugin: [{ nome: "del-proprietario", versione: "1.2.0" }, { nome: "senza-versione" }],
    skill: ["mia-skill"],
    quanteSkill: 1,
  };
  assert.deepEqual(leggiEstensioniDellAmbiente(JSON.parse(JSON.stringify(viste))), viste);
  for (const guaste of [
    undefined,
    { ...viste, quando: "ieri" },
    { ...viste, server: [{ nome: "appunti" }] },
    { ...viste, plugin: ["del-proprietario"] },
    { ...viste, skill: "mia-skill" },
    { ...viste, quanteSkill: -1 },
  ]) {
    assert.equal(leggiEstensioniDellAmbiente(guaste), undefined, JSON.stringify(guaste));
  }
});
