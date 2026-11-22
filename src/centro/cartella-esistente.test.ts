import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import type { EventoConversazione } from "../protocollo/eventi.ts";
import { allestisci, avviaNodoAccettato, finche, ID_NODO, type Banco } from "../prove/banco.ts";
import { COOKIE_SESSIONE } from "./centro.ts";
import { azioniDellaHome } from "./strumenti-home.ts";

const BRIEF = "Portaluce: gioco per browser, monorepo pnpm con Node 24.";

/** Una cartella di un lavoro cominciato per conto suo dal proprietario, con dentro un po' di tutto. */
async function giocoEsistente(t: TestContext): Promise<string> {
  const radice = await mkdtemp(join(tmpdir(), "shinka-esistente-"));
  t.after(() => rm(radice, { recursive: true, force: true }));
  const gioco = join(radice, "Rougue AFK");
  await mkdir(join(gioco, "docs"), { recursive: true });
  await mkdir(join(gioco, ".claude"), { recursive: true });
  await mkdir(join(gioco, "node_modules", "pnpm"), { recursive: true });
  await writeFile(join(gioco, "README.md"), "# Portaluce\n");
  await writeFile(join(gioco, "docs", "GDD.md"), "Design del gioco\n");
  return gioco;
}

async function decidi(banco: Banco, idProposta: string, corpo: Record<string, unknown>) {
  const risposta = await banco.centro.inject({
    method: "POST",
    url: `/api/proposte/${idProposta}`,
    cookies: { [COOKIE_SESSIONE]: await banco.entra() },
    payload: { esito: "confermata", ...corpo },
  });
  return { stato: risposta.statusCode, dati: risposta.json() as { idProgetto?: string; errore?: string } };
}

function azioni(banco: Banco) {
  return azioniDellaHome({
    ambienti: banco.ambienti,
    lavori: banco.lavori,
    proposte: banco.proposte,
    home: () => banco.casa,
    agisci: banco.agisci,
  });
}

function proposteNellaChat(banco: Banco): EventoConversazione[] {
  return banco.canale.archiviati.map((voce) => voce.evento).filter((evento) => evento.tipo.startsWith("proposta-"));
}

test("un progetto nasce in una cartella che esiste già, senza che Shinka la tocchi", async (t) => {
  const banco = await allestisci(t);
  const gioco = await giocoEsistente(t);
  const prima = (await readdir(gioco, { recursive: true })).sort();

  const esito = await azioni(banco).proponiProgetto({ nome: "Rougue AFK", brief: BRIEF, ambiente: "Unraid", cartella_esistente: gioco });
  assert.equal(esito.isError, undefined);
  assert.match(esito.content[0].text, /non è un repository Git/);
  const [proposta] = proposteNellaChat(banco);
  assert.ok(proposta?.tipo === "proposta-progetto");
  assert.equal(proposta.cartellaEsistente, await realpath(gioco));
  assert.match(proposta.avvisoCartella ?? "", /Non è un repository Git/);
  // Proporre non crea e non tocca nulla.
  assert.deepEqual(banco.progetti.elenco(), []);

  const { stato, dati } = await decidi(banco, proposta.idProposta, {});
  assert.equal(stato, 200);
  const progetto = banco.progetti.trova(dati.idProgetto ?? "");
  assert.equal(progetto?.cartella, await realpath(gioco));
  assert.equal(progetto?.nome, "Rougue AFK");
  // Niente brief scritto, niente repository, niente cartella nuova accanto: la cartella è com'era.
  assert.deepEqual((await readdir(gioco, { recursive: true })).sort(), prima);
  assert.equal(existsSync(join(banco.radiceProgetti, "rougue-afk")), false);

  // La conversazione lavora lì, e sa che la cartella era già del proprietario.
  await finche(() => banco.conversazioniLocali[0]?.inviati.length === 1, "il progetto riceve il brief");
  assert.equal(banco.conversazioniLocali[0]?.configurazione?.cartella, await realpath(gioco));
  const primo = banco.conversazioniLocali[0]?.inviati[0] ?? "";
  assert.ok(primo.startsWith(BRIEF));
  assert.match(primo, /esisteva già/);
  assert.match(primo, /non è un repository Git, e Shinka non l'ha inizializzato/);

  const decisa = proposteNellaChat(banco).find((evento) => evento.tipo === "proposta-decisa");
  assert.deepEqual(decisa?.tipo === "proposta-decisa" ? decisa.cartellaAdottata : undefined, {
    percorso: await realpath(gioco),
    git: false,
  });
  assert.ok(banco.home.annotazioni.some((nota) => nota.includes("Lavora nella cartella che esisteva già")));
});

test("dalla scheda il proprietario cambia il percorso a mano, o lo svuota per una cartella nuova", async (t) => {
  const banco = await allestisci(t);
  const gioco = await giocoEsistente(t);
  const altro = join(gioco, "..", "Altro gioco");
  await mkdir(join(altro, ".git"), { recursive: true });

  // Cambiato a mano: vale il percorso scritto dal proprietario.
  await azioni(banco).proponiProgetto({ nome: "Gioco", brief: BRIEF, ambiente: "Unraid", cartella_esistente: gioco });
  const prima = proposteNellaChat(banco).at(-1);
  assert.ok(prima?.tipo === "proposta-progetto");
  const cambiato = await decidi(banco, prima.idProposta, { cartellaEsistente: `  ${altro}  ` });
  assert.equal(cambiato.stato, 200);
  assert.equal(banco.progetti.trova(cambiato.dati.idProgetto ?? "")?.cartella, await realpath(altro));
  assert.equal(banco.lavori.stato().progetti.length, 1);

  // Svuotato: il progetto nasce in una cartella nuova, come prima.
  await azioni(banco).proponiProgetto({ nome: "Nuovo", brief: BRIEF, ambiente: "Unraid", cartella_esistente: gioco });
  const seconda = proposteNellaChat(banco).at(-1);
  assert.ok(seconda?.tipo === "proposta-progetto");
  const nuova = await decidi(banco, seconda.idProposta, { cartellaEsistente: "" });
  assert.equal(nuova.stato, 200);
  assert.equal(banco.progetti.trova(nuova.dati.idProgetto ?? "")?.cartella, join(banco.radiceProgetti, "nuovo"));
  assert.ok(existsSync(join(banco.radiceProgetti, "nuovo", "BRIEF.md")));

  // Anche senza che la Home l'abbia proposta, il proprietario può scriverne una.
  const terza = banco.proposte.proponi({ nome: "Terzo", brief: BRIEF, idAmbiente: "centro" });
  const scritta = join(gioco, "..", "Terzo");
  await mkdir(scritta);
  const adottata = await decidi(banco, terza, { cartellaEsistente: scritta });
  assert.equal(banco.progetti.trova(adottata.dati.idProgetto ?? "")?.cartella, await realpath(scritta));
});

test("una cartella che non c'è, o che è già di un progetto, non diventa un progetto", async (t) => {
  const banco = await allestisci(t);
  const gioco = await giocoEsistente(t);

  // La Home se ne accorge subito, e la scheda non compare.
  const assente = await azioni(banco).proponiProgetto({
    nome: "Fantasma",
    brief: BRIEF,
    ambiente: "Unraid",
    cartella_esistente: join(gioco, "..", "Non esiste"),
  });
  assert.equal(assente.isError, true);
  assert.match(assente.content[0].text, /non esiste/);
  assert.equal(proposteNellaChat(banco).length, 0);
  const relativo = await azioni(banco).proponiProgetto({ nome: "Relativo", brief: BRIEF, ambiente: "Unraid", cartella_esistente: "Rougue AFK" });
  assert.match(relativo.content[0].text, /percorso completo/);

  // Corretto a mano in un percorso che non c'è: la conferma non crea nulla, e la proposta resta.
  const idProposta = banco.proposte.proponi({ nome: "Gioco", brief: BRIEF, idAmbiente: "centro", cartellaEsistente: gioco });
  const sbagliato = await decidi(banco, idProposta, { cartellaEsistente: join(gioco, "..", "Rogue AFK") });
  assert.equal(sbagliato.stato, 409);
  assert.match(sbagliato.dati.errore ?? "", /non esiste/);
  assert.deepEqual(banco.progetti.elenco(), []);
  assert.equal((await decidi(banco, idProposta, {})).stato, 200);

  // La stessa cartella, scritta in un altro modo, o una cartella dentro o attorno: rifiutate.
  for (const percorso of [`${gioco}/`, join(gioco, "docs"), join(gioco, "..")]) {
    const doppione = await azioni(banco).proponiProgetto({ nome: "Doppione", brief: BRIEF, ambiente: "Unraid", cartella_esistente: percorso });
    assert.equal(doppione.isError, true, percorso);
    assert.match(doppione.content[0].text, /progetto «Gioco»/);
  }
  const altra = banco.proposte.proponi({ nome: "Altro", brief: BRIEF, idAmbiente: "centro" });
  const rifiuto = await decidi(banco, altra, { cartellaEsistente: gioco });
  assert.equal(rifiuto.stato, 409);
  assert.match(rifiuto.dati.errore ?? "", /è già del progetto «Gioco»/);
  assert.equal(banco.progetti.elenco().length, 1);
});

test("in un altro ambiente la cartella la guarda il suo nodo, e la conversazione gira lì", async (t) => {
  const banco = await allestisci(t);
  const nodo = await avviaNodoAccettato(t, banco);
  const gioco = await giocoEsistente(t);
  await mkdir(join(gioco, ".git"));

  const esito = await azioni(banco).proponiProgetto({ nome: "Rougue AFK", brief: BRIEF, ambiente: "PC Windows", cartella_esistente: gioco });
  assert.equal(esito.isError, undefined);
  assert.match(esito.content[0].text, /che è un repository Git/);
  const proposta = proposteNellaChat(banco).at(-1);
  assert.ok(proposta?.tipo === "proposta-progetto");
  assert.equal(proposta.avvisoCartella, undefined);

  const { stato, dati } = await decidi(banco, proposta.idProposta, {});
  assert.equal(stato, 200);
  assert.equal(banco.progetti.trova(dati.idProgetto ?? "")?.idAmbiente, ID_NODO);
  await finche(() => nodo.conversazioni[0]?.inviati.length === 1, "il nodo riceve il brief");
  assert.equal(nodo.conversazioni[0]?.configurazione?.cartella, await realpath(gioco));
  assert.doesNotMatch(nodo.conversazioni[0]?.inviati[0] ?? "", /non è un repository Git/);
  assert.equal(existsSync(join(gioco, "BRIEF.md")), false);
});
