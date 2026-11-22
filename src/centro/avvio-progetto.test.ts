import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import type { EsitoPreparazione, PreparazioneDelProgetto } from "../protocollo/avvio-progetto.ts";
import type { EventoConversazione } from "../protocollo/eventi.ts";
import { allestisci, avviaNodoAccettato, finche, ID_NODO, type Banco } from "../prove/banco.ts";
import { repositoryDiProva } from "../prove/plugin-di-prova.ts";
import { COOKIE_SESSIONE } from "./centro.ts";
import type { Estensioni, RichiestaEstensione } from "./estensioni.ts";

const CENTRO = "centro";
const CODEGRAPH: RichiestaEstensione = {
  nome: "codegraph",
  descrizione: "Il grafo del codice.",
  idAmbiente: CENTRO,
  definizione: { tipo: "mcp-locale", comando: "npx", argomenti: ["-y", "@colbymchenry/codegraph@1.6.2", "serve", "--mcp"], variabili: {} },
  chiavi: [],
};
const METEO: RichiestaEstensione = {
  nome: "meteo",
  descrizione: "Dice che tempo fa.",
  idAmbiente: CENTRO,
  definizione: { tipo: "mcp-locale", comando: "node", argomenti: ["meteo.js"], variabili: {} },
  chiavi: [],
};

type Evento<T extends EventoConversazione["tipo"]> = Extract<EventoConversazione, { tipo: T }>;

async function accendi(estensioni: Estensioni, richiesta: RichiestaEstensione): Promise<void> {
  const proposta = await estensioni.proponi(richiesta);
  assert.ok("idProposta" in proposta, JSON.stringify(proposta));
  assert.equal((await estensioni.conferma(proposta.idProposta))?.stato, "accesa");
}

/** Un centro con tre estensioni accese, una delle quali è il plugin delle skill di partenza, e una preparazione finta. */
async function allestisciConEstensioni(t: TestContext, esitoPreparazione: (p: PreparazioneDelProgetto) => EsitoPreparazione) {
  const { repository } = await repositoryDiProva(t);
  const preparate: { cartella: string; preparazioni: PreparazioneDelProgetto[] }[] = [];
  const banco = await allestisci(t, {
    estensioni: { accettaRepository: (indirizzo) => indirizzo === repository },
    preparaProgetto: async (cartella, preparazioni) => {
      preparate.push({ cartella, preparazioni: [...preparazioni] });
      return preparazioni.map(esitoPreparazione);
    },
  });
  const estensioni = banco.estensioni;
  assert.ok(estensioni);
  await accendi(estensioni, { nome: "mattpocock-skills", descrizione: "Le skill di Matt Pocock.", idAmbiente: CENTRO, definizione: { tipo: "plugin", repository }, chiavi: [] });
  await accendi(estensioni, CODEGRAPH);
  await accendi(estensioni, METEO);
  return { banco, estensioni, preparate };
}

function schede(banco: Banco): Evento<"proposta-progetto">[] {
  return banco.canale.archiviati.map((e) => e.evento).filter((e): e is Evento<"proposta-progetto"> => e.tipo === "proposta-progetto");
}

async function conferma(banco: Banco, idProposta: string, scelte: Record<string, unknown> = {}) {
  const risposta = await banco.centro.inject({
    method: "POST",
    url: `/api/proposte/${idProposta}`,
    cookies: { [COOKIE_SESSIONE]: await banco.entra() },
    payload: { esito: "confermata", ...scelte },
  });
  return { stato: risposta.statusCode, dati: risposta.json() as { idProgetto?: string; errore?: string } };
}

test("la scheda elenca le estensioni di ogni ambiente; confermata così com'è, il progetto ha le consigliate, l'indice e grill-me", async (t) => {
  const { banco, estensioni, preparate } = await allestisciConEstensioni(t, (p) => ({ tipo: p.tipo, riuscita: true, testo: "Indexed 3 files" }));
  // Ciò che il proprietario ha installato per conto suo, l'ultima volta che Shinka ha guardato.
  await estensioni.guarda(CENTRO);

  const idProposta = banco.proposte.proponi({ nome: "Ricettario", brief: "Un'app per le ricette.", idAmbiente: CENTRO });
  const scheda = schede(banco)[0]?.estensioni?.[CENTRO];
  assert.ok(scheda?.guardatoIl);
  assert.deepEqual(
    scheda.voci.map(({ nome, genere, provenienza, accesa }) => [nome, genere, provenienza, accesa]),
    [
      ["codegraph", "server", "shinka", true],
      ["mattpocock-skills", "plugin", "shinka", true],
      ["meteo", "server", "shinka", true],
      ["del-proprietario", "plugin", "ambiente", true],
      ["appunti", "server", "ambiente", true],
    ],
  );
  assert.deepEqual(scheda.voci[0]?.preparazione, { tipo: "indice-codegraph", pacchetto: "@colbymchenry/codegraph@1.6.2" });

  const { stato, dati } = await conferma(banco, idProposta);
  assert.equal(stato, 200);
  const idProgetto = dati.idProgetto ?? "";
  const progetto = banco.progetti.trova(idProgetto);
  assert.ok(progetto);
  assert.deepEqual(banco.progetti.estensioni(idProgetto), ["codegraph", "mattpocock-skills"]);
  const decisa = banco.canale.archiviati.map((e) => e.evento).find((e) => e.tipo === "proposta-decisa");
  assert.partialDeepStrictEqual(decisa, { esito: "confermata", estensioni: ["codegraph", "mattpocock-skills"], skillDiPartenza: "grill-me" });

  // Prima l'indice nella cartella del progetto, poi il primo messaggio, che comincia con la skill.
  const conversazione = banco.conversazioniLocali.at(-1);
  assert.ok(conversazione);
  await finche(() => conversazione.inviati.length === 1, "il primo messaggio parte dopo l'indice");
  assert.deepEqual(preparate, [{ cartella: progetto.cartella, preparazioni: [{ tipo: "indice-codegraph", pacchetto: "@colbymchenry/codegraph@1.6.2" }] }]);
  const primo = conversazione.inviati[0] ?? "";
  assert.match(primo, /^\/mattpocock-skills:grill-me Un'app per le ricette\./);
  assert.match(primo, /\[Shinka\] CodeGraph è acceso per questo progetto, e Shinka ne ha già costruito l'indice/);
  const note = banco.lavori.canale(idProgetto)?.archiviati.flatMap(({ evento }) => (evento.tipo === "nota" ? [evento.testo] : []));
  assert.equal(note?.length, 2);
  assert.match(note?.[1] ?? "", /indice di CodeGraph è pronto/);

  // Il progetto riceve solo le estensioni scelte: meteo è accesa nell'ambiente, ma non è sua.
  const fonte = conversazione.configurazione?.estensioni;
  assert.ok(fonte);
  assert.deepEqual(Object.keys((await fonte.server()).server), ["codegraph"]);
  assert.equal(fonte.plugin().length, 1);
});

test("il proprietario sceglie altre estensioni e nessuna skill; una scelta che non sta in piedi non fa nascere il progetto", async (t) => {
  const { banco, preparate } = await allestisciConEstensioni(t, (p) => ({ tipo: p.tipo, riuscita: true, testo: "" }));
  const idProposta = banco.proposte.proponi({ nome: "Meteo di casa", brief: "Un cruscotto del tempo.", idAmbiente: CENTRO });

  // grill-me vuole il suo plugin, e un'estensione fuori dall'elenco non c'è.
  const senzaPlugin = await conferma(banco, idProposta, { estensioni: ["meteo"], skillDiPartenza: "grill-me" });
  assert.equal(senzaPlugin.stato, 409);
  assert.match(senzaPlugin.dati.errore ?? "", /viene dal plugin mattpocock-skills/);
  const inventata = await conferma(banco, idProposta, { estensioni: ["non-esiste"] });
  assert.equal(inventata.stato, 409);
  assert.match(inventata.dati.errore ?? "", /non è nell'elenco di Shinka/);
  assert.equal(banco.progetti.elenco().length, 0);

  const { stato, dati } = await conferma(banco, idProposta, { estensioni: ["meteo"], skillDiPartenza: null });
  assert.equal(stato, 200);
  const conversazione = banco.conversazioniLocali.at(-1);
  assert.ok(conversazione);
  // Senza CodeGraph non si prepara nulla, e il primo messaggio è il brief.
  assert.deepEqual(conversazione.inviati, ["Un cruscotto del tempo."]);
  assert.deepEqual(preparate, []);
  assert.deepEqual(banco.progetti.estensioni(dati.idProgetto ?? ""), ["meteo"]);
  const fonte = conversazione.configurazione?.estensioni;
  assert.deepEqual(Object.keys((await fonte?.server())?.server ?? {}), ["meteo"]);
  assert.deepEqual(fonte?.plugin(), []);
});

test("con una cartella che esiste già la skill consigliata è grill-with-docs, e un indice non riuscito lo dice a tutti e due", async (t) => {
  const { banco } = await allestisciConEstensioni(t, (p) => ({ tipo: p.tipo, riuscita: false, testo: "Codice di uscita: 1\nnpm ERR! network" }));
  const cartella = banco.radiceProgetti + "/lavoro-mio";
  await import("node:fs/promises").then(({ mkdir }) => mkdir(cartella, { recursive: true }));
  const idProposta = banco.proposte.proponi({ nome: "Lavoro mio", brief: "Riprendi il lavoro.", idAmbiente: CENTRO, cartellaEsistente: cartella });
  const { stato, dati } = await conferma(banco, idProposta);
  assert.equal(stato, 200);
  const conversazione = banco.conversazioniLocali.at(-1);
  assert.ok(conversazione);
  await finche(() => conversazione.inviati.length === 1, "il primo messaggio parte anche senza indice");
  assert.match(conversazione.inviati[0] ?? "", /^\/mattpocock-skills:grill-with-docs Riprendi il lavoro\./);
  assert.match(conversazione.inviati[0] ?? "", /non è riuscita a costruirne l'indice/);
  const note = banco.lavori.canale(dati.idProgetto ?? "")?.archiviati.flatMap(({ evento }) => (evento.tipo === "nota" ? [evento.testo] : []));
  assert.match(note?.at(-1) ?? "", /non si è potuto costruire: npm ERR! network$/);
});

test("in un altro ambiente le estensioni scelte e la preparazione passano dal suo nodo; un nodo di prima non blocca il progetto", async (t) => {
  const { repository } = await repositoryDiProva(t);
  const banco = await allestisci(t, { estensioni: { accettaRepository: (indirizzo) => indirizzo === repository } });
  const estensioni = banco.estensioni;
  assert.ok(estensioni);
  const preparate: string[] = [];
  const nodo = await avviaNodoAccettato(t, banco, {
    preparaProgetto: async (cartella, preparazioni) => {
      preparate.push(cartella);
      return preparazioni.map((p) => ({ tipo: p.tipo, riuscita: true, testo: "ok" }));
    },
  });
  await accendi(estensioni, { ...CODEGRAPH, idAmbiente: ID_NODO });
  await accendi(estensioni, { ...METEO, idAmbiente: ID_NODO });

  const idProposta = banco.proposte.proponi({ nome: "Gioco", brief: "Un gioco di carte.", idAmbiente: ID_NODO });
  const { stato, dati } = await conferma(banco, idProposta, { estensioni: ["codegraph"] });
  assert.equal(stato, 200);
  const progetto = banco.progetti.trova(dati.idProgetto ?? "");
  assert.ok(progetto);
  await finche(() => nodo.conversazioni.at(-1)?.inviati.length === 1, "il primo messaggio arriva al nodo");
  assert.deepEqual(preparate, [progetto.cartella]);
  // Il plugin delle skill qui non c'è: il primo messaggio è il brief, con l'indice.
  assert.match(nodo.conversazioni.at(-1)?.inviati[0] ?? "", /^Un gioco di carte\.\n\n\[Shinka\] CodeGraph è acceso/);
  const fonte = nodo.conversazioni.at(-1)?.configurazione?.estensioni;
  assert.deepEqual(Object.keys((await fonte?.server())?.server ?? {}), ["codegraph"]);
});

test("un nodo che non sa preparare un progetto fa partire il primo messaggio lo stesso, dicendolo", async (t) => {
  const banco = await allestisci(t, { estensioni: {} });
  const estensioni = banco.estensioni;
  assert.ok(estensioni);
  const nodo = await avviaNodoAccettato(t, banco, { senzaPreparazione: true });
  await accendi(estensioni, { ...CODEGRAPH, idAmbiente: ID_NODO });
  const idProposta = banco.proposte.proponi({ nome: "Gioco", brief: "Un gioco di carte.", idAmbiente: ID_NODO });
  const { stato, dati } = await conferma(banco, idProposta);
  assert.equal(stato, 200);
  await finche(() => nodo.conversazioni.at(-1)?.inviati.length === 1, "il primo messaggio arriva dopo l'attesa", 8000);
  assert.match(nodo.conversazioni.at(-1)?.inviati[0] ?? "", /non è riuscita a costruirne l'indice/);
  const note = banco.lavori.canale(dati.idProgetto ?? "")?.archiviati.flatMap(({ evento }) => (evento.tipo === "nota" ? [evento.testo] : []));
  assert.match(note?.at(-1) ?? "", /versione precedente non sa ancora preparare un progetto, e va aggiornato\.$/);
});
