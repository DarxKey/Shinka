import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import type { EventoConversazione } from "../protocollo/eventi.ts";
import type { ChiaviConsegnate, ContenutoPlugin } from "../protocollo/estensioni.ts";
import { allestisci, avviaNodoAccettato, finche, ID_NODO, type Banco, type OpzioniBanco } from "../prove/banco.ts";
import { harnessDiProva } from "../prove/harness-di-prova.ts";
import { repositoryDiProva } from "../prove/plugin-di-prova.ts";
import { COOKIE_SESSIONE } from "./centro.ts";
import { Estensioni, type RichiestaEstensione } from "./estensioni.ts";
import { azioniDellaHome, consensoDellaHome, type RispostaStrumento } from "./strumenti-home.ts";

/** Un valore finto, fatto per riconoscerlo se finisse dove non deve. */
const CHIAVE_FINTA = "chiave-FINTA-di-prova-0001";
const CENTRO = "centro";

const LOCALE: Extract<NonNullable<RichiestaEstensione["definizione"]>, { tipo: "mcp-locale" }> = {
  tipo: "mcp-locale",
  comando: "node",
  argomenti: ["meteo.js"],
  variabili: {},
};
const METEO: RichiestaEstensione = { nome: "meteo", descrizione: "Dice che tempo fa.", idAmbiente: CENTRO, definizione: LOCALE, chiavi: [] };
const AVVIATO = { command: "node", args: ["meteo.js"], env: {} };

async function conEstensioni(t: TestContext, opzioni: NonNullable<OpzioniBanco["estensioni"]> = {}, altro: OpzioniBanco = {}): Promise<{ banco: Banco; estensioni: Estensioni }> {
  const banco = await allestisci(t, { ...altro, estensioni: opzioni });
  assert.ok(banco.estensioni, "il banco ha le estensioni");
  return { banco, estensioni: banco.estensioni };
}

type Evento<T extends EventoConversazione["tipo"]> = Extract<EventoConversazione, { tipo: T }>;

function eventi<T extends EventoConversazione["tipo"]>(banco: Banco, tipo: T): Evento<T>[] {
  return banco.canale.archiviati.map((e) => e.evento).filter((e): e is Evento<T> => e.tipo === tipo);
}

/** Propone, e si aspetta che la scheda compaia. */
async function proposta(estensioni: Estensioni, richiesta: RichiestaEstensione): Promise<string> {
  const esito = await estensioni.proponi(richiesta);
  assert.ok("idProposta" in esito, JSON.stringify(esito));
  return esito.idProposta;
}

async function chiedi(banco: Banco, url: string, payload?: Record<string, unknown>): Promise<{ stato: number; dati: Record<string, unknown> }> {
  const risposta = await banco.centro.inject({
    method: "POST",
    url,
    cookies: { [COOKIE_SESSIONE]: await banco.entra() },
    ...(payload === undefined ? {} : { payload }),
  });
  return { stato: risposta.statusCode, dati: risposta.json() };
}

function testo(risposta: RispostaStrumento): string {
  return risposta.content[0].text;
}

test("una proposta scritta male non mostra nessuna scheda, e dice perché", async (t) => {
  const { banco, estensioni } = await conEstensioni(t, { esamina: async () => ({ motivo: "non dovrebbe arrivare fin qui" }) });
  const remoto = (indirizzo: string): RichiestaEstensione => ({ ...METEO, definizione: { tipo: "mcp-remoto", indirizzo, trasporto: "http" } });
  const plugin = (repository: string, cartella?: string): RichiestaEstensione => ({
    ...METEO,
    definizione: { tipo: "plugin", repository, ...(cartella === undefined ? {} : { cartella }) },
  });
  const sbagliate: [RichiestaEstensione, RegExp][] = [
    [{ ...METEO, nome: "Meteo Bello" }, /lettere minuscole/],
    [{ ...METEO, nome: "shinka" }, /già usato da Shinka/],
    [{ ...METEO, idAmbiente: "non-esiste" }, /non esiste/],
    [{ ...METEO, descrizione: "  " }, /Serve una descrizione/],
    [{ ...METEO, chiavi: ["il valore della chiave"] }, /non è il nome di una chiave/],
    [{ ...METEO, definizione: { ...LOCALE, comando: " " } }, /Serve il comando/],
    // Un segreto non entra nella definizione: né tra gli argomenti, né tra le variabili, né nell'indirizzo.
    [{ ...METEO, definizione: { ...LOCALE, argomenti: ["--token=abcdef123456"] } }, /sembra contenere un segreto/],
    [{ ...METEO, definizione: { ...LOCALE, variabili: { API_KEY: "abcdef" } } }, /"API_KEY" sembra un segreto/],
    [{ ...METEO, definizione: { ...LOCALE, variabili: { REGIONE: "veneto" } }, chiavi: ["REGIONE"] }, /sia tra le variabili sia tra le chiavi/],
    [remoto("non un indirizzo"), /non è un indirizzo web/],
    [remoto("ftp://mcp.esempio.it"), /https o http/],
    [remoto("https://utente:parola@mcp.esempio.it/mcp"), /nome utente o una password/],
    [remoto("https://mcp.esempio.it/mcp?api_key=abcdef"), /"api_key" sembra un segreto/],
    [{ ...plugin("https://esempio.it/plugin.git"), chiavi: ["X_TOKEN"] }, /Un plugin non riceve chiavi/],
    [plugin("git@esempio.it:uno/plugin.git"), /indirizzo https/],
    [plugin("/cartella/sul/disco"), /indirizzo https/],
    [plugin("https://esempio.it/plugin.git", "../fuori"), /esce dal repository/],
    [plugin("https://esempio.it/plugin.git"), /Il plugin non si può proporre\. non dovrebbe arrivare fin qui/],
    // Senza definizione si accende altrove una che c'è già: questa non c'è.
    [{ nome: "meteo", descrizione: "", idAmbiente: CENTRO, chiavi: [] }, /non c'è un'estensione "meteo"/],
  ];
  for (const [richiesta, motivo] of sbagliate) {
    const esito = await estensioni.proponi(richiesta);
    assert.ok("motivo" in esito, JSON.stringify(richiesta));
    assert.match(esito.motivo, motivo);
  }
  assert.deepEqual(eventi(banco, "estensione-proposta"), []);
  assert.deepEqual(banco.harnessEstensioni.aperture, []);
});

test("la scheda dice che cosa parte e dove; confermata, l'estensione viene provata e accesa solo se parte", async (t) => {
  const { banco, estensioni } = await conEstensioni(t);
  await banco.lavori.crea("Sito del club", CENTRO, "Un sito.");
  const progetto = banco.conversazioniLocali[0];
  assert.ok(progetto);

  const id = await proposta(estensioni, { ...METEO, nome: " meteo ", definizione: { ...LOCALE, comando: "npx", argomenti: ["-y", "meteo-mcp"] } });
  const [scheda] = eventi(banco, "estensione-proposta");
  assert.partialDeepStrictEqual(scheda, {
    idProposta: id,
    nome: "meteo",
    descrizione: "Dice che tempo fa.",
    definizione: { tipo: "mcp-locale", comando: "npx", argomenti: ["-y", "meteo-mcp"], variabili: {} },
    chiavi: [],
    idAmbiente: CENTRO,
    nomeAmbiente: "Unraid",
  });
  assert.equal(scheda?.giaInElenco, undefined);
  assert.match(scheda?.avvisi[0] ?? "", /programma di terzi/);
  assert.match(scheda?.avvisi[1] ?? "", /La versione di "meteo-mcp" non è scritta nel comando/);

  // Finché il proprietario non conferma non parte nulla, e la stessa scheda non compare due volte.
  assert.deepEqual(banco.harnessEstensioni.aperture, []);
  assert.deepEqual(estensioni.stato().estensioni, []);
  const doppia = await estensioni.proponi(METEO);
  assert.ok("motivo" in doppia && /ha già davanti la scheda/.test(doppia.motivo));

  const esito = await estensioni.conferma(id);
  assert.equal(esito?.stato, "accesa");
  assert.deepEqual(banco.harnessEstensioni.avviati, [{ meteo: { command: "npx", args: ["-y", "meteo-mcp"], env: {} } }]);
  assert.equal(banco.harnessEstensioni.chiusi, 1);
  assert.partialDeepStrictEqual(estensioni.stato().estensioni, [
    { nome: "meteo", descrizione: "Dice che tempo fa.", chiavi: [], ambienti: [{ idAmbiente: CENTRO, accesa: true, strumenti: ["saluta", "ha_la_chiave"] }] },
  ]);
  assert.deepEqual(eventi(banco, "estensione-decisa"), [
    { tipo: "estensione-decisa", idProposta: id, esito: "accesa", strumenti: ["saluta", "ha_la_chiave"] },
  ]);
  assert.match(banco.home.annotazioni.at(-1) ?? "", /"meteo": nell'ambiente "Unraid" è partita ed è accesa\. Offre questi strumenti: saluta, ha_la_chiave\..*questa compresa/);

  // Le conversazioni aperte nell'ambiente ripartono, e da lì in poi la ricevono a ogni avvio.
  await finche(() => banco.home.ricaricheEstensioni === 1 && progetto.ricaricheEstensioni === 1, "le conversazioni aperte ripartono");
  const fonte = progetto.configurazione?.estensioni;
  assert.ok(fonte);
  assert.deepEqual(await fonte.server(), { server: { meteo: { command: "npx", args: ["-y", "meteo-mcp"], env: {} } }, nonPartite: [] });
  assert.deepEqual(fonte.plugin(), []);

  // Resta scritta, e la proposta è chiusa.
  const scritto = JSON.parse(await readFile(join(banco.cartella, "estensioni.json"), "utf8")) as { estensioni: { nome: string }[] };
  assert.deepEqual(scritto.estensioni.map((una) => una.nome), ["meteo"]);
  assert.equal(await estensioni.conferma(id), undefined);
  assert.equal(estensioni.annulla(id), false);
});

test("un'estensione che non parte non entra nell'elenco, e una annullata non avvia nulla", async (t) => {
  const { banco, estensioni } = await conEstensioni(t);
  const rotta = await proposta(estensioni, { ...METEO, definizione: { ...LOCALE, comando: "non-parte" } });
  assert.deepEqual(await estensioni.conferma(rotta), { stato: "non-partita", motivo: "Non è partita: Connection closed" });
  assert.deepEqual(estensioni.stato().estensioni, []);
  assert.deepEqual(estensioni.accese(CENTRO), []);
  assert.deepEqual(eventi(banco, "estensione-decisa"), [
    { tipo: "estensione-decisa", idProposta: rotta, esito: "non-partita", motivo: "Non è partita: Connection closed" },
  ]);
  assert.match(banco.home.annotazioni.at(-1) ?? "", /non è partita, e quindi non è stata accesa\..*Connection closed.*riproponila corretta/);
  assert.equal(banco.home.ricaricheEstensioni, 0);

  // Chiusa quella, si può riproporre; e annullare non avvia nulla.
  const seconda = await proposta(estensioni, METEO);
  assert.equal(estensioni.annulla(seconda), true);
  assert.deepEqual(eventi(banco, "estensione-decisa").at(-1), { tipo: "estensione-decisa", idProposta: seconda, esito: "annullata" });
  assert.match(banco.home.annotazioni.at(-1) ?? "", /ha annullato la proposta dell'estensione "meteo": non è stato installato né avviato nulla/);
  assert.equal(banco.harnessEstensioni.aperture.length, 1);
  assert.equal(estensioni.annulla(seconda), false);
});

test("la chiave esce dal vault solo dopo la conferma, per l'ambiente in cui l'estensione parte, e non resta in nulla di Shinka", async (t) => {
  const chieste: [string, string, string[]][] = [];
  let vault: ChiaviConsegnate = { motivo: 'Nel vault manca la chiave METEO_TOKEN dell\'estensione "meteo" per l\'ambiente "Unraid".' };
  const { banco, estensioni } = await conEstensioni(t, {
    chiavi: async (estensione, ambiente, nomi) => {
      chieste.push([estensione, ambiente, nomi]);
      return vault;
    },
  });
  const id = await proposta(estensioni, { ...METEO, chiavi: ["METEO_TOKEN", " METEO_TOKEN "] });
  const [scheda] = eventi(banco, "estensione-proposta");
  assert.deepEqual(scheda?.chiavi, ["METEO_TOKEN"]);
  assert.match(scheda?.avvisi.at(-1) ?? "", /Vuole una chiave dal vault \(METEO_TOKEN\).*una conversazione di quell'ambiente potrebbe leggerla/);

  // Proposta e non ancora confermata, la sua chiave non si può chiedere.
  assert.equal(estensioni.chiaviRichiedibili("meteo", CENTRO), undefined);

  // Manca nel vault: la scheda resta lì, e il proprietario può confermare di nuovo.
  const prima = await estensioni.conferma(id);
  assert.equal(prima?.stato, "da-riprovare");
  assert.match(prima?.stato === "da-riprovare" ? prima.motivo : "", /Nel vault manca la chiave METEO_TOKEN/);
  assert.deepEqual(chieste, [["meteo", "Unraid", ["METEO_TOKEN"]]]);
  assert.deepEqual(eventi(banco, "estensione-decisa"), []);
  assert.deepEqual(banco.harnessEstensioni.aperture, []);

  vault = { valori: { METEO_TOKEN: CHIAVE_FINTA } };
  assert.equal((await estensioni.conferma(id))?.stato, "accesa");
  assert.deepEqual(banco.harnessEstensioni.avviati, [{ meteo: { command: "node", args: ["meteo.js"], env: { METEO_TOKEN: CHIAVE_FINTA } } }]);

  // Il valore è arrivato al programma, e a nient'altro.
  await finche(() => banco.home.ricaricheEstensioni === 1, "la Home riparte");
  assert.ok(!(await readFile(join(banco.cartella, "estensioni.json"), "utf8")).includes(CHIAVE_FINTA));
  assert.ok(!JSON.stringify(banco.canale.archiviati).includes(CHIAVE_FINTA));
  assert.ok(!banco.home.annotazioni.join("\n").includes(CHIAVE_FINTA));
  assert.ok(!JSON.stringify(estensioni.stato()).includes(CHIAVE_FINTA));

  // Accesa lì, la chiede a ogni avvio; altrove, o per un'altra estensione, no.
  assert.deepEqual(estensioni.chiaviRichiedibili("meteo", CENTRO), ["METEO_TOKEN"]);
  assert.equal(estensioni.chiaviRichiedibili("meteo", ID_NODO), undefined);
  assert.equal(estensioni.chiaviRichiedibili("posta", CENTRO), undefined);
  const [accesa] = estensioni.stato().estensioni;
  assert.ok(accesa);
  assert.equal(await estensioni.spegni(accesa.id, CENTRO), true);
  assert.equal(estensioni.chiaviRichiedibili("meteo", CENTRO), undefined);
});

test("mentre l'ambiente la prova, una seconda conferma non la avvia due volte e non si può annullare", async (t) => {
  let consegna: ((chiavi: ChiaviConsegnate) => void) | undefined;
  const { banco, estensioni } = await conEstensioni(t, { chiavi: () => new Promise((risolvi) => (consegna = risolvi)) });
  const id = await proposta(estensioni, { ...METEO, chiavi: ["METEO_TOKEN"] });

  const prima = estensioni.conferma(id);
  await finche(() => consegna !== undefined, "la prova chiede la chiave");
  assert.deepEqual(await estensioni.conferma(id), { stato: "in-prova" });
  assert.equal(estensioni.annulla(id), false);
  consegna?.({ valori: { METEO_TOKEN: CHIAVE_FINTA } });
  assert.equal((await prima)?.stato, "accesa");
  assert.equal(banco.harnessEstensioni.avviati.length, 1);
});

test("un'estensione dell'elenco si accende in un altro ambiente con una scheda sua, e una definizione nuova prende il posto della vecchia", async (t) => {
  const { banco, estensioni } = await conEstensioni(t);
  const nodo = await avviaNodoAccettato(t, banco);
  await banco.lavori.crea("Videogioco", ID_NODO, "Un videogioco.");
  await finche(() => nodo.conversazioni.length === 1, "il progetto si apre sul nodo");
  const remota = nodo.conversazioni[0];
  const fonte = remota?.configurazione?.estensioni;
  assert.ok(remota && fonte);

  assert.equal((await estensioni.conferma(await proposta(estensioni, METEO)))?.stato, "accesa");
  // Accesa al centro, il nodo non la riceve.
  assert.deepEqual(nodo.harness.aperture, []);
  assert.deepEqual(await fonte.server(), { server: {}, nonPartite: [] });

  const gia = await estensioni.proponi({ nome: "meteo", descrizione: "", idAmbiente: CENTRO, chiavi: [] });
  assert.ok("motivo" in gia && /già accesa nell'ambiente "Unraid"/.test(gia.motivo));
  const uguale = await estensioni.proponi(METEO);
  assert.ok("motivo" in uguale && /già nell'elenco con questa stessa definizione/.test(uguale.motivo));

  // Senza definizione: è quella dell'elenco, da accendere altrove.
  const altrove = await proposta(estensioni, { nome: "meteo", descrizione: "", idAmbiente: ID_NODO, chiavi: [] });
  assert.partialDeepStrictEqual(eventi(banco, "estensione-proposta").at(-1), {
    idProposta: altrove,
    nome: "meteo",
    descrizione: "Dice che tempo fa.",
    definizione: LOCALE,
    idAmbiente: ID_NODO,
    nomeAmbiente: "PC Windows",
    giaInElenco: true,
  });
  assert.equal((await estensioni.conferma(altrove))?.stato, "accesa");
  // L'ha provata il nodo, con il suo harness, e ora le sue conversazioni la ricevono.
  assert.deepEqual(nodo.harness.avviati, [{ meteo: AVVIATO }]);
  assert.deepEqual(estensioni.stato().estensioni[0]?.ambienti.map((dove) => [dove.idAmbiente, dove.accesa]), [
    [CENTRO, true],
    [ID_NODO, true],
  ]);
  await finche(() => remota.ricaricheEstensioni === 1, "la conversazione sul nodo riparte");
  assert.deepEqual(await fonte.server(), { server: { meteo: AVVIATO }, nonPartite: [] });
  assert.match(banco.home.annotazioni.at(-1) ?? "", /nell'ambiente "PC Windows" è partita ed è accesa.*Valgono nelle conversazioni che partono da adesso\.$/);

  // Una definizione nuova con lo stesso nome: la scheda dice che cosa sostituisce e dove si spegne.
  const prima = estensioni.stato().estensioni[0];
  const nuova = await proposta(estensioni, { ...METEO, definizione: { ...LOCALE, argomenti: ["meteo-2.js"] } });
  const avvisi = eventi(banco, "estensione-proposta").at(-1)?.avvisi ?? [];
  assert.ok(avvisi.some((avviso) => /Prende il posto di "meteo" com'è adesso nell'elenco \(node meteo\.js\)\..*\(PC Windows\) verrà spenta/.test(avviso)), avvisi.join("\n"));
  assert.equal((await estensioni.conferma(nuova))?.stato, "accesa");
  const dopo = estensioni.stato().estensioni;
  assert.equal(dopo.length, 1);
  assert.equal(dopo[0]?.id, prima?.id);
  assert.deepEqual(dopo[0]?.definizione, { ...LOCALE, argomenti: ["meteo-2.js"] });
  assert.deepEqual(dopo[0]?.ambienti.map((dove) => dove.idAmbiente), [CENTRO]);
  // Sul nodo non è mai stata provata con la definizione nuova: lì non c'è più.
  await finche(() => remota.ricaricheEstensioni === 2, "la conversazione sul nodo riparte senza");
  assert.deepEqual(await fonte.server(), { server: {}, nonPartite: [] });
});

test("in un altro ambiente la prova, la chiave e lo sguardo passano dal suo nodo", async (t) => {
  const chieste: [string, string, string[]][] = [];
  const { banco, estensioni } = await conEstensioni(t, {
    chiavi: async (estensione, ambiente, nomi) => {
      chieste.push([estensione, ambiente, nomi]);
      return { valori: { METEO_TOKEN: CHIAVE_FINTA } };
    },
  });
  const nodo = await avviaNodoAccettato(t, banco);

  const id = await proposta(estensioni, { ...METEO, idAmbiente: ID_NODO, chiavi: ["METEO_TOKEN"] });
  assert.equal((await estensioni.conferma(id))?.stato, "accesa");
  // La chiave è stata chiesta per l'ambiente del nodo, con il nome che ha in Shinka.
  assert.deepEqual(chieste, [["meteo", "PC Windows", ["METEO_TOKEN"]]]);
  assert.deepEqual(nodo.harness.avviati, [{ meteo: { ...AVVIATO, env: { METEO_TOKEN: CHIAVE_FINTA } } }]);
  assert.deepEqual(banco.harnessEstensioni.aperture, []);

  // Un nodo non riceve la chiave di un'estensione che nel suo ambiente non è accesa.
  const [accesa] = estensioni.stato().estensioni;
  assert.ok(accesa);
  assert.equal(await estensioni.spegni(accesa.id, ID_NODO), true);
  nodo.collegamento.riferisci({ tipo: "chiavi-richieste", idRichiesta: "r1", estensione: "meteo" });
  await new Promise((fatto) => setTimeout(fatto, 100));
  assert.equal(chieste.length, 1);

  // Lo sguardo: ciò che l'ambiente ha già, visto dal suo nodo e ricordato al centro.
  const viste = await estensioni.guarda(ID_NODO);
  assert.deepEqual(viste.server, [{ nome: "appunti", provenienza: "user" }]);
  assert.deepEqual(nodo.harness.aperture.at(-1), { cartella: nodo.radiceProgetti, isolata: false });
  assert.deepEqual(estensioni.stato().dellAmbiente[ID_NODO], viste);

  // Spento l'ambiente, lì non si propone e non si accende: una prova si fa dove poi si userà.
  nodo.collegamento.ferma();
  await finche(() => !banco.ambienti.attivo(ID_NODO), "l'ambiente risulta spento");
  const spento = await estensioni.proponi({ ...METEO, nome: "altra", idAmbiente: ID_NODO });
  assert.ok("motivo" in spento && /"PC Windows" è spento/.test(spento.motivo));
  const riaccesa = await estensioni.accendi(accesa.id, ID_NODO);
  assert.equal(riaccesa?.stato, "da-riprovare");
  await assert.rejects(estensioni.guarda(ID_NODO), /spento/);
});

test("un nodo che non conosce le estensioni, o che non risponde, non lascia la proposta appesa", async (t) => {
  const muto = harnessDiProva();
  muto.apri = () => ({
    setMcpServers: () => new Promise(() => {}),
    mcpServerStatus: async () => [],
    reloadPlugins: () => new Promise(() => {}),
    close: () => {},
  });
  await t.test("un nodo vecchio dice che non le sa tenere", async (t) => {
    const { banco, estensioni } = await conEstensioni(t);
    await avviaNodoAccettato(t, banco, { senzaEstensioni: true });
    const id = await proposta(estensioni, { ...METEO, idAmbiente: ID_NODO });
    assert.deepEqual(await estensioni.conferma(id), { stato: "non-partita", motivo: "Questo nodo non sa tenere le estensioni." });
    await assert.rejects(estensioni.guarda(ID_NODO), /non sa guardare le estensioni/);
  });
  await t.test("un nodo che non risponde viene aspettato per un tempo solo", async (t) => {
    const { banco, estensioni } = await conEstensioni(t, { attesaProvaMs: 150, attesaSguardoMs: 150 });
    await avviaNodoAccettato(t, banco, { harness: muto });
    const id = await proposta(estensioni, { ...METEO, idAmbiente: ID_NODO });
    const esito = await estensioni.conferma(id);
    assert.ok(esito?.stato === "non-partita" && /non ha risposto alla prova/.test(esito.motivo));
    await assert.rejects(estensioni.guarda(ID_NODO), /non ha risposto/);
  });
  await t.test("un nodo che si scollega a metà prova lascia la scheda da riconfermare", async (t) => {
    const { banco, estensioni } = await conEstensioni(t);
    const nodo = await avviaNodoAccettato(t, banco, { harness: muto });
    const id = await proposta(estensioni, { ...METEO, idAmbiente: ID_NODO });
    const attesa = estensioni.conferma(id);
    await new Promise((fatto) => setTimeout(fatto, 100));
    nodo.collegamento.ferma();
    assert.deepEqual(await attesa, { stato: "da-riprovare", motivo: "L'ambiente si è scollegato durante la prova." });
    assert.deepEqual(eventi(banco, "estensione-decisa"), []);
  });
});

test("un plugin viene letto prima di proporlo, preso fermo al suo commit e dato alle conversazioni dell'ambiente", async (t) => {
  const { repository, primo } = await repositoryDiProva(t);
  const { banco, estensioni } = await conEstensioni(t, { accettaRepository: (indirizzo) => indirizzo === repository });
  await banco.lavori.crea("Sito del club", CENTRO, "Un sito.");
  const fonte = banco.conversazioniLocali[0]?.configurazione?.estensioni;
  assert.ok(fonte);

  const id = await proposta(estensioni, {
    nome: "di-prova",
    descrizione: "Un plugin di prova.",
    idAmbiente: CENTRO,
    definizione: { tipo: "plugin", repository, riferimento: " v1 " },
    chiavi: [],
  });
  const [scheda] = eventi(banco, "estensione-proposta");
  // La scheda dice il commit per intero e che cosa c'è dentro, letto senza eseguirlo.
  assert.deepEqual(scheda?.definizione, { tipo: "plugin", repository, commit: primo });
  const contenuto: ContenutoPlugin = {
    nome: "di-prova",
    versione: "0.1.0",
    descrizione: "Un plugin per i test.",
    skill: ["saluta"],
    comandi: ["riassumi"],
    agenti: [],
    agganci: [{ evento: "PreToolUse", comando: "node controlla.js" }],
    server: ["interno"],
    altro: [],
  };
  assert.deepEqual(scheda?.contenuto, contenuto);
  const avvisi = scheda?.avvisi.join("\n") ?? "";
  assert.match(avvisi, /resta fermo al commit indicato/);
  assert.match(avvisi, /Contiene un comando che parte da solo durante le conversazioni, senza chiedere il consenso/);
  assert.match(avvisi, /Dichiara un server MCP \(interno\) che Shinka non avvia/);
  assert.deepEqual(fonte.plugin(), []);

  const esito = await estensioni.conferma(id);
  assert.equal(esito?.stato, "accesa");
  const cartella = join(banco.cartella, "estensioni", "plugin", `${estensioni.stato().estensioni[0]?.id}-${primo.slice(0, 12)}`);
  assert.deepEqual(banco.harnessEstensioni.aperture, [{ cartella: join(banco.cartella, "estensioni"), isolata: true, plugin: [cartella] }]);
  assert.deepEqual(estensioni.stato().estensioni[0]?.contenuto, contenuto);
  assert.match(banco.home.annotazioni.at(-1) ?? "", /Le sue skill valgono nelle conversazioni che partono da adesso\.$/);
  await finche(() => fonte.plugin().length === 1, "il plugin arriva alle conversazioni");
  assert.deepEqual(fonte.plugin(), [cartella]);

  // Tolta dall'elenco, non la riceve più nessuno.
  assert.equal(await estensioni.rimuovi(estensioni.stato().estensioni[0]?.id ?? ""), true);
  await finche(() => fonte.plugin().length === 0, "il plugin sparisce dalle conversazioni");
});

test("dalla pagina il proprietario conferma, spegne, riaccende, guarda e toglie; senza sessione nulla", async (t) => {
  let vault: ChiaviConsegnate = { motivo: "Il vault è chiuso." };
  const { banco, estensioni } = await conEstensioni(t, { chiavi: async () => vault });

  for (const url of ["/api/estensioni/proposte/x", "/api/estensioni/x/ambienti/centro", "/api/estensioni/x/rimozione", "/api/estensioni/ambienti/centro/sguardo"]) {
    assert.equal((await banco.centro.inject({ method: "POST", url, payload: { esito: "confermata", accesa: true } })).statusCode, 401, url);
  }

  // Manca solo la chiave: la risposta lo dice, e la scheda resta in attesa.
  const id = await proposta(estensioni, { ...METEO, chiavi: ["METEO_TOKEN"] });
  assert.equal((await chiedi(banco, `/api/estensioni/proposte/${id}`, { esito: "forse" })).stato, 400);
  assert.deepEqual(await chiedi(banco, `/api/estensioni/proposte/${id}`, { esito: "confermata" }), {
    stato: 409,
    dati: { errore: "Non è partita: Il vault è chiuso.." },
  });
  vault = { valori: { METEO_TOKEN: CHIAVE_FINTA } };
  assert.deepEqual(await chiedi(banco, `/api/estensioni/proposte/${id}`, { esito: "confermata" }), {
    stato: 200,
    dati: { stato: "accesa", strumenti: ["saluta", "ha_la_chiave"] },
  });
  assert.equal((await chiedi(banco, `/api/estensioni/proposte/${id}`, { esito: "confermata" })).stato, 404);
  assert.equal((await chiedi(banco, `/api/estensioni/proposte/${id}`, { esito: "annullata" })).stato, 404);

  const rotta = await proposta(estensioni, { ...METEO, nome: "rotta", definizione: { ...LOCALE, comando: "non-parte" } });
  assert.deepEqual(await chiedi(banco, `/api/estensioni/proposte/${rotta}`, { esito: "confermata" }), {
    stato: 200,
    dati: { stato: "non-partita", motivo: "Non è partita: Connection closed" },
  });
  const annullata = await proposta(estensioni, { ...METEO, nome: "altra" });
  assert.deepEqual(await chiedi(banco, `/api/estensioni/proposte/${annullata}`, { esito: "annullata" }), { stato: 200, dati: { annullata: true } });

  // Il quadro la porta all'interfaccia.
  const [meteo] = estensioni.stato().estensioni;
  assert.ok(meteo);
  if (!banco.centro.server.listening) await banco.centro.listen({ host: "127.0.0.1", port: 0 });
  const { port } = banco.centro.server.address() as AddressInfo;
  const controllo = new AbortController();
  t.after(() => controllo.abort());
  const flusso = await fetch(`http://127.0.0.1:${port}/api/quadro/eventi`, {
    headers: { cookie: `${COOKIE_SESSIONE}=${await banco.entra()}` },
    signal: controllo.signal,
  });
  assert.ok(flusso.body);
  const lettore = flusso.body.pipeThrough(new TextDecoderStream()).getReader();
  let ricevuto = "";
  while (!/event: estensioni\ndata: .*\n\n/.test(ricevuto)) {
    const { value, done } = await lettore.read();
    assert.ok(!done, "il quadro resta aperto");
    ricevuto += value;
  }
  assert.ok(ricevuto.includes(`event: estensioni\ndata: {"estensioni":[{"id":"${meteo.id}","nome":"meteo"`), ricevuto);
  assert.ok(!ricevuto.includes(CHIAVE_FINTA));

  // Spenta resta nell'elenco; riaccenderla la prova di nuovo.
  assert.deepEqual(await chiedi(banco, `/api/estensioni/${meteo.id}/ambienti/centro`, { accesa: false }), { stato: 200, dati: { stato: "spenta" } });
  assert.equal((await chiedi(banco, `/api/estensioni/${meteo.id}/ambienti/centro`, { accesa: false })).stato, 404);
  assert.deepEqual(estensioni.accese(CENTRO), []);
  assert.equal(estensioni.stato().estensioni.length, 1);
  const prove = banco.harnessEstensioni.avviati.length;
  vault = { motivo: "Il vault è chiuso." };
  assert.equal((await chiedi(banco, `/api/estensioni/${meteo.id}/ambienti/centro`, { accesa: true })).stato, 409);
  vault = { valori: { METEO_TOKEN: CHIAVE_FINTA } };
  assert.deepEqual(await chiedi(banco, `/api/estensioni/${meteo.id}/ambienti/centro`, { accesa: true }), {
    stato: 200,
    dati: { stato: "accesa", strumenti: ["saluta", "ha_la_chiave"] },
  });
  assert.equal(banco.harnessEstensioni.avviati.length, prove + 1);
  assert.equal((await chiedi(banco, `/api/estensioni/${meteo.id}/ambienti/non-esiste`, { accesa: true })).stato, 404);
  assert.equal((await chiedi(banco, "/api/estensioni/non-esiste/ambienti/centro", { accesa: true })).stato, 404);

  // Lo sguardo a ciò che l'ambiente ha già: si vede, e resta ricordato.
  const sguardo = await chiedi(banco, "/api/estensioni/ambienti/centro/sguardo");
  assert.equal(sguardo.stato, 200);
  assert.deepEqual(sguardo.dati.plugin, [{ nome: "del-proprietario", versione: "1.2.0" }]);
  assert.equal((await chiedi(banco, "/api/estensioni/ambienti/non-esiste/sguardo")).stato, 409);

  // Riaperto il centro, l'elenco e ciò che si era visto ci sono ancora.
  const riaperto = await Estensioni.apri({
    file: join(banco.cartella, "estensioni.json"),
    ambienti: () => banco.ambienti.stato().ambienti,
    inAmbiente: () => assert.fail("riaprire non prova nulla"),
    canaleHome: () => banco.canale,
    annotaHome: () => {},
  });
  assert.deepEqual(riaperto.stato(), JSON.parse(JSON.stringify(estensioni.stato())));
  assert.deepEqual(riaperto.accese(CENTRO).map((una) => una.nome), ["meteo"]);

  assert.deepEqual(await chiedi(banco, `/api/estensioni/${meteo.id}/rimozione`), { stato: 200, dati: { rimossa: true } });
  assert.equal((await chiedi(banco, `/api/estensioni/${meteo.id}/rimozione`)).stato, 404);
  assert.deepEqual(estensioni.stato().estensioni, []);
});

test("la Home propone un'estensione con il suo strumento, e sa dire che cosa c'è già", async (t) => {
  const { banco, estensioni } = await conEstensioni(t);
  const comuni = { ambienti: banco.ambienti, lavori: banco.lavori, proposte: banco.proposte, home: () => banco.casa, agisci: banco.agisci };
  const azioni = azioniDellaHome({ ...comuni, estensioni });

  const vuoto = testo(await azioni.elencaEstensioni({}));
  assert.match(vuoto, /Nell'elenco di Shinka non c'è ancora nessuna estensione\./);
  // Ciò che l'ambiente ha già di suo lo guarda la prima volta, e lo riferisce senza proporne un doppione.
  assert.match(vuoto, /Ambiente "Unraid", già installato dal proprietario fuori da Shinka.*\n  server MCP: appunti\n  plugin: del-proprietario 1\.2\.0\n  skill e comandi: 2 \(del-proprietario:riassumi, mia-skill\)/);
  assert.match(vuoto, /non proporne un doppione/);
  assert.equal(banco.harnessEstensioni.aperture.length, 1);
  await azioni.elencaEstensioni({});
  assert.equal(banco.harnessEstensioni.aperture.length, 1);
  await azioni.elencaEstensioni({ guarda: true });
  assert.equal(banco.harnessEstensioni.aperture.length, 2);

  for (const [argomenti, motivo] of [
    [{ nome: "meteo", ambiente: "Mac dello studio", tipo: "mcp-locale", comando: "node" }, /Nessun ambiente attivo si chiama/],
    [{ nome: "meteo", descrizione: "Dice che tempo fa.", ambiente: "Unraid", tipo: "mcp-locale" }, /serve il comando/],
    [{ nome: "meteo", descrizione: "Dice che tempo fa.", ambiente: "Unraid", tipo: "mcp-remoto" }, /serve l'indirizzo/],
    [{ nome: "meteo", descrizione: "Dice che tempo fa.", ambiente: "Unraid", tipo: "plugin" }, /serve l'indirizzo del repository/],
    [{ nome: "meteo", ambiente: "Unraid", tipo: "mcp-locale", comando: "node" }, /Serve una descrizione.*La scheda non è stata mostrata\.$/],
    [{ nome: "meteo", ambiente: "Unraid" }, /non c'è un'estensione "meteo".*La scheda non è stata mostrata\.$/],
  ] as const) {
    const risposta = await azioni.proponiEstensione(argomenti);
    assert.equal(risposta.isError, true, JSON.stringify(argomenti));
    assert.match(testo(risposta), motivo);
  }
  assert.deepEqual(eventi(banco, "estensione-proposta"), []);

  const mostrata = await azioni.proponiEstensione({
    nome: "meteo",
    descrizione: "Dice che tempo fa.",
    ambiente: "unraid",
    tipo: "mcp-remoto",
    indirizzo: "https://mcp.esempio.it/mcp",
    chiavi: ["Authorization"],
  });
  assert.equal(mostrata.isError, undefined);
  assert.match(testo(mostrata), /Scheda mostrata al proprietario: estensione "meteo" nell'ambiente "Unraid"\. Non è stato installato né avviato nulla/);
  const [scheda] = eventi(banco, "estensione-proposta");
  assert.deepEqual(scheda?.definizione, { tipo: "mcp-remoto", indirizzo: "https://mcp.esempio.it/mcp", trasporto: "http" });
  assert.match(scheda?.avvisi[0] ?? "", /esce da Shinka/);
  assert.equal(estensioni.annulla(scheda?.idProposta ?? ""), true);

  // Accesa, la Home la ritrova nell'elenco con il suo ambiente.
  assert.equal((await estensioni.conferma(await proposta(estensioni, { ...METEO, chiavi: [] })))?.stato, "accesa");
  assert.match(
    testo(await azioni.elencaEstensioni({})),
    /Estensioni di Shinka.*\n- meteo: Server MCP locale\. Dice che tempo fa\.\n  node meteo\.js\n  Ambienti: Unraid \(accesa\)\./,
  );

  // In un'installazione senza estensioni lo strumento lo dice.
  const senza = azioniDellaHome(comuni);
  assert.equal((await senza.proponiEstensione({ nome: "meteo", ambiente: "Unraid" })).isError, true);
  assert.equal((await senza.elencaEstensioni({})).isError, true);
});

test("nella Home una skill di Shinka non chiede consenso, quella di un plugin sì", async (t) => {
  const banco = await allestisci(t);
  const consenso = consensoDellaHome(banco.ambienti);
  for (const modo of ["chiedi", "modifiche-libere", "automatico"] as const) {
    assert.equal(consenso("Skill", { skill: "shinka:backup-foto" }, modo), true);
    assert.equal(consenso("Skill", { command: "/shinka:backup-foto" }, modo), true);
    assert.equal(consenso("Skill", { skill: "di-prova:saluta" }, modo), false);
    assert.equal(consenso("Skill", { skill: "saluta" }, modo), false);
    assert.equal(consenso("Skill", {}, modo), false);
    // Lo strumento di un'estensione segue il modo dei permessi, come ogni altro.
    assert.equal(consenso("mcp__meteo__saluta", {}, modo), false);
  }
});
