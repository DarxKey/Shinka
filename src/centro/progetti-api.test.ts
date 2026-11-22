import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { test } from "node:test";
import type { EventoConversazione } from "../protocollo/eventi.ts";
import {
  allestisci,
  avviaNodo,
  avviaNodoAccettato,
  finche,
  ID_NODO,
  type Banco,
} from "../prove/banco.ts";
import { COOKIE_SESSIONE } from "./centro.ts";

const BRIEF = "Sviluppare un videogioco di piattaforme in due dimensioni.";

function tipi(eventi: readonly { evento: EventoConversazione }[]): string[] {
  return eventi.map((e) => e.evento.tipo);
}

/** La Home propone un progetto nell'ambiente del centro. */
function proponi(banco: Banco, idAmbiente = "centro", nome = "Videogioco"): string {
  return banco.proposte.proponi({ nome, brief: BRIEF, idAmbiente });
}

async function decidi(
  banco: Banco,
  idProposta: string,
  corpo: Record<string, unknown>,
): Promise<{ stato: number; dati: { idProgetto?: string; errore?: string } }> {
  const risposta = await banco.centro.inject({
    method: "POST",
    url: `/api/proposte/${idProposta}`,
    cookies: { [COOKIE_SESSIONE]: await banco.entra() },
    payload: corpo,
  });
  return { stato: risposta.statusCode, dati: risposta.json() };
}

test("una proposta mostra la scheda e non crea nulla", async (t) => {
  const banco = await allestisci(t);
  const idProposta = proponi(banco);

  const ultimo = banco.canale.archiviati.at(-1)?.evento;
  assert.deepEqual(ultimo, {
    tipo: "proposta-progetto",
    idProposta,
    nome: "Videogioco",
    idAmbiente: "centro",
    brief: BRIEF,
    // La scheda dice con quali impostazioni nascerebbe il progetto.
    impostazioni: { permessi: "modifiche-libere" },
  });
  assert.deepEqual(banco.lavori.stato().progetti, []);
  // Tra le cartelle dei progetti c'è solo quella degli argomenti della Home.
  assert.deepEqual(readdirSync(join(banco.cartella, "progetti")), ["_home"]);
  assert.deepEqual(banco.conversazioniLocali, []);
});

test("la conferma fa nascere la cartella e una conversazione che contiene solo il brief", async (t) => {
  const banco = await allestisci(t);
  banco.canale.pubblica({ tipo: "messaggio-proprietario", id: "h1", testo: "Parliamo d'altro, in Home." });
  const idProposta = proponi(banco);

  const { stato, dati } = await decidi(banco, idProposta, { esito: "confermata" });
  assert.equal(stato, 200);
  const idProgetto = dati.idProgetto;
  assert.ok(idProgetto);

  const cartella = join(banco.cartella, "progetti", "videogioco");
  assert.match(await readFile(join(cartella, "BRIEF.md"), "utf8"), /videogioco di piattaforme/);
  const progetto = banco.progetti.trova(idProgetto);
  assert.equal(progetto?.cartella, cartella);
  assert.equal(progetto?.idAmbiente, "centro");

  // La conversazione del progetto è nata nella sua cartella e ha ricevuto il brief, e basta.
  assert.equal(banco.conversazioniLocali.length, 1);
  assert.equal(banco.conversazioniLocali[0]?.configurazione?.cartella, cartella);
  assert.deepEqual(banco.conversazioniLocali[0]?.inviati, [BRIEF]);
  const archivio = banco.lavori.canale(idProgetto)?.archiviati ?? [];
  assert.deepEqual(tipi(archivio), ["messaggio-proprietario", "turno-iniziato"]);
  assert.equal(JSON.stringify(archivio).includes("Parliamo d'altro"), false);

  // La Home registra la decisione e ne viene informata, senza essere fatta rispondere.
  assert.deepEqual(banco.canale.archiviati.at(-1)?.evento, {
    tipo: "proposta-decisa",
    idProposta,
    esito: "confermata",
    idProgetto,
    nome: "Videogioco",
  });
  assert.equal(banco.home.annotazioni.length, 1);
  assert.match(banco.home.annotazioni[0] ?? "", /Videogioco.*Unraid/);
  assert.deepEqual(banco.home.inviati, []);
});

test("alla conferma il proprietario può cambiare il nome", async (t) => {
  const banco = await allestisci(t);
  const { stato, dati } = await decidi(banco, proponi(banco), { esito: "confermata", nome: "Gioco spaziale" });
  assert.equal(stato, 200);
  assert.ok(dati.idProgetto);
  assert.equal(banco.progetti.trova(dati.idProgetto)?.nome, "Gioco spaziale");
  assert.ok(existsSync(join(banco.cartella, "progetti", "gioco-spaziale")));
});

test("una proposta annullata non crea nulla, e non si può più decidere", async (t) => {
  const banco = await allestisci(t);
  const idProposta = proponi(banco);

  assert.equal((await decidi(banco, idProposta, { esito: "annullata" })).stato, 200);
  assert.deepEqual(banco.lavori.stato().progetti, []);
  assert.equal(banco.canale.archiviati.at(-1)?.evento.tipo, "proposta-decisa");
  assert.match(banco.home.annotazioni[0] ?? "", /annullato/);

  assert.equal((await decidi(banco, idProposta, { esito: "confermata" })).stato, 404);
  assert.equal((await decidi(banco, "proposta-mai-esistita", { esito: "annullata" })).stato, 404);
});

test("se la cartella esiste già il progetto non nasce, e la proposta si può correggere", async (t) => {
  const banco = await allestisci(t);
  await mkdir(join(banco.cartella, "progetti", "videogioco"), { recursive: true });
  const idProposta = proponi(banco);

  const rifiutata = await decidi(banco, idProposta, { esito: "confermata" });
  assert.equal(rifiutata.stato, 409);
  assert.match(rifiutata.dati.errore ?? "", /esiste già/);
  assert.deepEqual(banco.lavori.stato().progetti, []);
  assert.deepEqual(banco.home.annotazioni, []);

  const corretta = await decidi(banco, idProposta, { esito: "confermata", nome: "Videogioco due" });
  assert.equal(corretta.stato, 200);
});

test("un progetto non può nascere in un ambiente spento o sconosciuto", async (t) => {
  const banco = await allestisci(t);
  const sconosciuto = await decidi(banco, proponi(banco, "ambiente-mai-visto"), { esito: "confermata" });
  assert.equal(sconosciuto.stato, 409);
  assert.match(sconosciuto.dati.errore ?? "", /non è attivo/);

  // Un nodo accettato e poi spento: il suo ambiente esiste ma non è attivo.
  const nodo = await avviaNodoAccettato(t, banco);
  nodo.collegamento.ferma();
  await finche(() => !banco.ambienti.attivo(ID_NODO), "l'ambiente risulta spento");
  const spento = await decidi(banco, proponi(banco, ID_NODO), { esito: "confermata" });
  assert.equal(spento.stato, 409);
  assert.deepEqual(banco.lavori.stato().progetti, []);
});

test("senza sessione progetti e proposte non sono raggiungibili", async (t) => {
  const banco = await allestisci(t);
  const idProposta = proponi(banco);
  for (const [method, url] of [
    ["GET", "/api/quadro/eventi"],
    ["GET", "/api/progetti/qualunque/eventi"],
    ["POST", "/api/progetti/qualunque/messaggi"],
    ["POST", "/api/progetti/qualunque/interrompi"],
    ["POST", `/api/proposte/${idProposta}`],
  ] as const) {
    const risposta = await banco.centro.inject({ method, url, payload: { esito: "confermata", testo: "x" } });
    assert.equal(risposta.statusCode, 401, `${method} ${url}`);
  }
  assert.deepEqual(banco.lavori.stato().progetti, []);
});

test("i messaggi arrivano alla conversazione del loro progetto", async (t) => {
  const banco = await allestisci(t);
  const cookies = { [COOKIE_SESSIONE]: await banco.entra() };
  const primo = (await decidi(banco, proponi(banco, "centro", "Primo"), { esito: "confermata" })).dati.idProgetto;
  const secondo = (await decidi(banco, proponi(banco, "centro", "Secondo"), { esito: "confermata" })).dati.idProgetto;
  assert.ok(primo && secondo);

  const inviato = await banco.centro.inject({
    method: "POST",
    url: `/api/progetti/${secondo}/messaggi`,
    cookies,
    payload: { testo: "Aggiungi il salvataggio." },
  });
  assert.equal(inviato.statusCode, 202);
  assert.deepEqual(banco.conversazioniLocali[0]?.inviati, [BRIEF]);
  assert.deepEqual(banco.conversazioniLocali[1]?.inviati, [BRIEF, "Aggiungi il salvataggio."]);

  const inesistente = await banco.centro.inject({
    method: "POST",
    url: "/api/progetti/mai-esistito/messaggi",
    cookies,
    payload: { testo: "ciao" },
  });
  assert.equal(inesistente.statusCode, 404);
});

test("il flusso di un progetto chiude la storia con il suo segnale, prima degli eventi nuovi", async (t) => {
  const banco = await allestisci(t);
  const id = (await decidi(banco, proponi(banco), { esito: "confermata" })).dati.idProgetto;
  assert.ok(id);
  await banco.centro.listen({ host: "127.0.0.1", port: 0 });
  const { port } = banco.centro.server.address() as AddressInfo;
  const controllo = new AbortController();
  t.after(() => controllo.abort());
  const risposta = await fetch(`http://127.0.0.1:${port}/api/progetti/${id}/eventi`, {
    headers: { cookie: `${COOKIE_SESSIONE}=${await banco.entra()}` },
    signal: controllo.signal,
  });
  assert.ok(risposta.body);
  const lettore = risposta.body.pipeThrough(new TextDecoderStream()).getReader();
  let ricevuto = "";
  const finche = async (atteso: string) => {
    while (!ricevuto.includes(atteso)) {
      const { value, done } = await lettore.read();
      if (done) throw new Error(`il flusso si è chiuso prima di "${atteso}"`);
      ricevuto += value;
    }
  };

  await finche("event: storia");
  assert.ok(ricevuto.indexOf('"tipo":"messaggio-proprietario"') < ricevuto.indexOf("event: storia"));
  banco.conversazioniLocali[0]?.emetti({ tipo: "testo-iniziato", idTesto: "t1" });
  banco.conversazioniLocali[0]?.emetti({ tipo: "testo-frammento", idTesto: "t1", frammento: "Al lavoro" });
  await finche('"frammento":"Al lavoro"');
  assert.ok(ricevuto.indexOf("event: storia") < ricevuto.indexOf('"frammento":"Al lavoro"'));
  controllo.abort();
  await lettore.closed.catch(() => {});
});

test("la condizione di un progetto segue ciò che accade nella sua conversazione", async (t) => {
  const banco = await allestisci(t);
  const cookies = { [COOKIE_SESSIONE]: await banco.entra() };
  const idProgetto = (await decidi(banco, proponi(banco), { esito: "confermata" })).dati.idProgetto;
  assert.ok(idProgetto);
  const condizione = (): string | undefined => banco.lavori.stato().progetti[0]?.condizione;
  const conversazione = banco.conversazioniLocali[0];
  assert.ok(conversazione);

  assert.equal(condizione(), "al-lavoro");
  conversazione.emetti({
    tipo: "permesso-richiesto",
    idPermesso: "p1",
    idAzione: "p1",
    strumento: "Bash",
    ingresso: { command: "npm install" },
  });
  assert.equal(condizione(), "aspetta-te");

  const decisione = await banco.centro.inject({
    method: "POST",
    url: `/api/progetti/${idProgetto}/permessi/p1`,
    cookies,
    payload: { decisione: "approvato" },
  });
  assert.equal(decisione.statusCode, 200);
  assert.deepEqual(conversazione.decisioni, [["p1", "approvato"]]);
  assert.equal(condizione(), "al-lavoro");

  conversazione.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 10 });
  assert.equal(condizione(), "fermo");
  assert.equal(banco.lavori.stato().progetti[0]?.nomeAmbiente, "Unraid");
});

test("il flusso del quadro consegna l'elenco dei progetti e i suoi cambiamenti", async (t) => {
  const banco = await allestisci(t);
  const token = await banco.entra();
  await banco.centro.listen({ host: "127.0.0.1", port: 0 });
  const { port } = banco.centro.server.address() as AddressInfo;
  const controllo = new AbortController();
  t.after(() => controllo.abort());
  const risposta = await fetch(`http://127.0.0.1:${port}/api/quadro/eventi`, {
    headers: { cookie: `${COOKIE_SESSIONE}=${token}` },
    signal: controllo.signal,
  });
  assert.ok(risposta.body);
  const lettore = risposta.body.pipeThrough(new TextDecoderStream()).getReader();
  let ricevuto = "";
  const leggiFinche = async (atteso: RegExp): Promise<void> => {
    while (!atteso.test(ricevuto)) {
      const { value, done } = await lettore.read();
      if (done) throw new Error(`il flusso si è chiuso prima di ${atteso}`);
      ricevuto += value;
    }
  };

  await leggiFinche(/event: progetti\ndata: \{"progetti":\[\]\}/);
  await decidi(banco, proponi(banco), { esito: "confermata" });
  await leggiFinche(/event: progetti\ndata: .*"nome":"Videogioco".*"condizione":"al-lavoro"/);
  controllo.abort();
  await lettore.closed.catch(() => {});
});

test("un progetto nasce nell'ambiente di un nodo e la sua conversazione gira lì", async (t) => {
  const banco = await allestisci(t);
  const nodo = await avviaNodoAccettato(t, banco);

  const { stato, dati } = await decidi(banco, proponi(banco, ID_NODO, "Gioco Unity"), { esito: "confermata" });
  assert.equal(stato, 200);
  const idProgetto = dati.idProgetto;
  assert.ok(idProgetto);

  // La cartella è nata dove il nodo tiene i progetti, non al centro.
  const cartella = join(nodo.radiceProgetti, "gioco-unity");
  assert.equal(banco.progetti.trova(idProgetto)?.cartella, cartella);
  assert.ok(existsSync(join(cartella, "BRIEF.md")));
  assert.equal(existsSync(join(banco.cartella, "progetti", "gioco-unity")), false);

  // La conversazione è stata aperta sul nodo e ha ricevuto il brief.
  await finche(() => nodo.conversazioni[0]?.inviati.length === 1, "il nodo riceve il brief");
  assert.equal(nodo.conversazioni[0]?.configurazione?.cartella, cartella);
  assert.deepEqual(nodo.conversazioni[0]?.inviati, [BRIEF]);
  assert.deepEqual(banco.conversazioniLocali, []);

  // Ciò che accade sul nodo arriva all'archivio del progetto al centro.
  const canale = banco.lavori.canale(idProgetto);
  assert.ok(canale);
  nodo.conversazioni[0]?.emetti({ tipo: "testo-concluso", idTesto: "t1", testo: "Comincio dal personaggio." });
  await finche(() => tipi(canale.archiviati).includes("testo-concluso"), "il testo arriva al centro");
  assert.deepEqual(tipi(canale.archiviati), ["messaggio-proprietario", "turno-iniziato", "testo-concluso"]);

  // Il nodo riferisce da dove riprendere, e il centro lo ricorda.
  nodo.conversazioni[0]?.configurazione?.alIdSessione("sessione-del-nodo");
  await finche(() => banco.progetti.idSessione(idProgetto) === "sessione-del-nodo", "il centro ricorda la sessione");
});

test("un permesso chiesto su un nodo si decide dal centro", async (t) => {
  const banco = await allestisci(t);
  const nodo = await avviaNodoAccettato(t, banco);
  const idProgetto = (await decidi(banco, proponi(banco, ID_NODO), { esito: "confermata" })).dati.idProgetto;
  assert.ok(idProgetto);
  await finche(() => nodo.conversazioni.length === 1, "la conversazione nasce sul nodo");
  const conversazione = nodo.conversazioni[0];
  assert.ok(conversazione);

  conversazione.emetti({
    tipo: "permesso-richiesto",
    idPermesso: "p1",
    idAzione: "p1",
    strumento: "Bash",
    ingresso: { command: "dotnet build" },
  });
  await finche(() => banco.lavori.stato().progetti[0]?.condizione === "aspetta-te", "il centro vede la richiesta");

  const cookies = { [COOKIE_SESSIONE]: await banco.entra() };
  const decisione = await banco.centro.inject({
    method: "POST",
    url: `/api/progetti/${idProgetto}/permessi/p1`,
    cookies,
    payload: { decisione: "negato" },
  });
  assert.equal(decisione.statusCode, 200);
  await finche(() => conversazione.decisioni.length === 1, "la decisione arriva al nodo");
  assert.deepEqual(conversazione.decisioni, [["p1", "negato"]]);

  const ripetuta = await banco.centro.inject({
    method: "POST",
    url: `/api/progetti/${idProgetto}/permessi/permesso-inventato`,
    cookies,
    payload: { decisione: "approvato" },
  });
  assert.equal(ripetuta.statusCode, 404);
});

test("con l'ambiente spento il progetto si consulta ma non ci si lavora; poi riprende", async (t) => {
  const banco = await allestisci(t);
  const cookies = { [COOKIE_SESSIONE]: await banco.entra() };
  const nodo = await avviaNodoAccettato(t, banco);
  const idProgetto = (await decidi(banco, proponi(banco, ID_NODO), { esito: "confermata" })).dati.idProgetto;
  assert.ok(idProgetto);
  await finche(() => nodo.conversazioni.length === 1, "la conversazione nasce sul nodo");
  nodo.conversazioni[0]?.configurazione?.alIdSessione("sessione-del-nodo");
  await finche(() => banco.progetti.idSessione(idProgetto) === "sessione-del-nodo", "il centro ricorda la sessione");

  // Il nodo si spegne a metà turno.
  nodo.collegamento.ferma();
  await finche(() => banco.lavori.stato().progetti[0]?.condizione === "ambiente-spento", "l'ambiente risulta spento");
  const canale = banco.lavori.canale(idProgetto);
  assert.ok(canale);
  const ultimo = canale.archiviati.at(-1)?.evento;
  assert.ok(ultimo?.tipo === "turno-concluso" && !ultimo.riuscito && /scollegato/.test(ultimo.errore ?? ""));

  const rifiutato = await banco.centro.inject({
    method: "POST",
    url: `/api/progetti/${idProgetto}/messaggi`,
    cookies,
    payload: { testo: "Sei ancora lì?" },
  });
  assert.equal(rifiutato.statusCode, 409);
  assert.match(rifiutato.json().errore, /spento/);
  assert.ok(canale.archiviati.length > 0, "la storia resta consultabile");

  // Il nodo torna: è lo stesso, quindi rientra da solo e la conversazione riprende da dove era.
  const tornato = await avviaNodo(t, banco);
  await finche(() => tornato.stati.some((s) => s.stato === "attivo"), "il nodo rientra");
  const accettato = await banco.centro.inject({
    method: "POST",
    url: `/api/progetti/${idProgetto}/messaggi`,
    cookies,
    payload: { testo: "Riprendiamo." },
  });
  assert.equal(accettato.statusCode, 202);
  await finche(() => tornato.conversazioni[0]?.inviati.length === 1, "il nodo riceve il messaggio");
  assert.equal(tornato.conversazioni[0]?.configurazione?.idSessione, "sessione-del-nodo");
  assert.deepEqual(tornato.conversazioni[0]?.inviati, ["Riprendiamo."]);
});

test("alla conferma il proprietario può lasciare i file dove sono, o cambiare ambiente", async (t) => {
  const banco = await allestisci(t);
  const cartellaArgomento = banco.casa.cartellaAperta;
  await mkdir(cartellaArgomento, { recursive: true });
  await writeFile(join(cartellaArgomento, "bozza.md"), "Una bozza.");
  await avviaNodoAccettato(t, banco);

  const conFile = async (nome: string): Promise<string> => {
    const daPortare = await banco.proposte.fileDellArgomento();
    assert.deepEqual(daPortare?.file, [{ idAmbiente: "centro", percorsi: ["bozza.md"], quanti: 1 }]);
    return banco.proposte.proponi({ nome, brief: BRIEF, idAmbiente: "centro", daPortare });
  };

  // Senza indicazioni, i file dell'ambiente del progetto lo seguono.
  const primo = await decidi(banco, await conFile("Primo"), { esito: "confermata" });
  assert.equal(primo.stato, 200);
  assert.equal(await readFile(join(banco.radiceProgetti, "primo", "bozza.md"), "utf8"), "Una bozza.");
  assert.partialDeepStrictEqual(banco.canale.archiviati.at(-1)?.evento, { tipo: "proposta-decisa", filePortati: 1 });
  assert.match(banco.conversazioniLocali[0]?.inviati[0] ?? "", /nella cartella c'è già un file prodotto lì/);

  // Il proprietario può dire di no.
  const secondo = await decidi(banco, await conFile("Secondo"), { esito: "confermata", portaFile: false });
  assert.equal(secondo.stato, 200);
  assert.equal(existsSync(join(banco.radiceProgetti, "secondo", "bozza.md")), false);
  const decisa = banco.canale.archiviati.at(-1)?.evento;
  assert.ok(decisa?.tipo === "proposta-decisa");
  assert.equal("filePortati" in decisa, false);
  assert.deepEqual(banco.conversazioniLocali[1]?.inviati, [BRIEF]);

  // In un altro ambiente il progetto nasce senza: i file non attraversano gli ambienti.
  const terzo = await decidi(banco, await conFile("Terzo"), { esito: "confermata", idAmbiente: ID_NODO });
  assert.equal(terzo.stato, 200);
  assert.ok(terzo.dati.idProgetto);
  const cartella = banco.progetti.trova(terzo.dati.idProgetto)?.cartella;
  assert.ok(cartella);
  assert.ok(existsSync(join(cartella, "BRIEF.md")));
  assert.equal(existsSync(join(cartella, "bozza.md")), false);

  const rifiutata = await decidi(banco, await conFile("Quarto"), { esito: "confermata", portaFile: "sì" });
  assert.equal(rifiutata.stato, 400);
});

test("dalla scheda il proprietario sceglie con quali impostazioni nasce il progetto", async (t) => {
  const banco = await allestisci(t);
  const idProposta = proponi(banco);
  const proposta = banco.canale.archiviati.map((voce) => voce.evento).find((evento) => evento.tipo === "proposta-progetto");
  assert.ok(proposta?.tipo === "proposta-progetto");
  // La scheda parte dalle impostazioni di un progetto nuovo.
  assert.deepEqual(proposta.impostazioni, { permessi: "modifiche-libere" });

  const { stato, dati } = await decidi(banco, idProposta, { esito: "confermata", modello: "opus", impegno: "high", permessi: "chiedi" });
  assert.equal(stato, 200);
  const idProgetto = dati.idProgetto ?? "";
  // Il progetto nasce con quelle, salvate: valgono dal primo messaggio.
  assert.deepEqual(banco.lavori.impostazioni(idProgetto), { modello: "opus", impegno: "high", permessi: "chiedi" });
  await finche(() => banco.conversazioniLocali[0]?.inviati.length === 1, "il brief arriva al progetto");
  assert.deepEqual(banco.conversazioniLocali[0]?.configurazione?.impostazioni, { modello: "opus", impegno: "high", permessi: "chiedi" });

  // Senza cambiare nulla, il progetto nasce con le impostazioni di sempre.
  const altra = await decidi(banco, proponi(banco, "centro", "Ricette"), { esito: "confermata" });
  assert.deepEqual(banco.lavori.impostazioni(altra.dati.idProgetto ?? ""), { permessi: "modifiche-libere" });
  // Valori che non esistono non passano.
  assert.equal((await decidi(banco, proponi(banco, "centro", "Terzo"), { esito: "confermata", permessi: "tutto" })).stato, 400);
});

test("il proprietario crea un progetto da sé: nasce con il suo brief, senza una proposta, e la Home lo viene a sapere", async (t) => {
  const banco = await allestisci(t);
  const cookies = { [COOKIE_SESSIONE]: await banco.entra() };
  assert.equal((await banco.centro.inject({ method: "GET", url: "/api/nuovo-progetto" })).statusCode, 401);

  const scheda = await banco.centro.inject({ method: "GET", url: "/api/nuovo-progetto", cookies });
  assert.equal(scheda.statusCode, 200);
  assert.equal(scheda.json<{ impostazioni: { permessi: string } }>().impostazioni.permessi, "modifiche-libere");

  const nato = await banco.centro.inject({
    method: "POST",
    url: "/api/nuovo-progetto",
    cookies,
    payload: { nome: "Sito del negozio", idAmbiente: "centro", brief: "Un sito con il catalogo.", permessi: "chiedi", modello: "opus" },
  });
  assert.equal(nato.statusCode, 200, nato.body);
  const { idProgetto } = nato.json<{ idProgetto: string }>();
  const progetto = banco.progetti.trova(idProgetto);
  assert.equal(progetto?.nome, "Sito del negozio");
  assert.ok(existsSync(progetto?.cartella ?? ""));
  // La conversazione parte dal brief scritto dal proprietario, con le impostazioni scelte.
  assert.deepEqual(banco.conversazioniLocali[0]?.inviati, ["Un sito con il catalogo."]);
  assert.equal(banco.lavori.impostazioni(idProgetto).permessi, "chiedi");
  assert.equal(banco.lavori.impostazioni(idProgetto).modello, "opus");
  // Nella Home non compare nessuna scheda; le resta una nota.
  assert.deepEqual(tipi(banco.canale.archiviati).filter((tipo) => tipo.startsWith("proposta")), []);
  assert.match(banco.home.annotazioni.at(-1) ?? "", /^\[Shinka\] Il proprietario ha creato da sé, dall'interfaccia, il progetto "Sito del negozio"/);

  // Ciò che non sta in piedi viene rifiutato con il motivo, e non nasce nulla.
  const prima = banco.progetti.elenco().length;
  const stessoNome = await banco.centro.inject({ method: "POST", url: "/api/nuovo-progetto", cookies, payload: { nome: "Sito del negozio", idAmbiente: "centro", brief: "Di nuovo." } });
  assert.equal(stessoNome.statusCode, 409);
  const spento = await banco.centro.inject({ method: "POST", url: "/api/nuovo-progetto", cookies, payload: { nome: "Altro", idAmbiente: "inventato", brief: "x" } });
  assert.equal(spento.statusCode, 409);
  assert.match(spento.json<{ errore: string }>().errore, /non è attivo/);
  const senzaBrief = await banco.centro.inject({ method: "POST", url: "/api/nuovo-progetto", cookies, payload: { nome: "Altro", idAmbiente: "centro", brief: "" } });
  assert.equal(senzaBrief.statusCode, 400);
  assert.equal(banco.progetti.elenco().length, prima);
});

test("un progetto creato a mano può nascere in una cartella che esiste già", async (t) => {
  const banco = await allestisci(t);
  const cookies = { [COOKIE_SESSIONE]: await banco.entra() };
  const cartella = join(banco.radiceProgetti, "..", "gia-mia");
  await mkdir(cartella, { recursive: true });
  await writeFile(join(cartella, "appunti.txt"), "miei");
  const nato = await banco.centro.inject({
    method: "POST",
    url: "/api/nuovo-progetto",
    cookies,
    payload: { nome: "Appunti", idAmbiente: "centro", brief: "Riordina gli appunti.", cartellaEsistente: cartella },
  });
  assert.equal(nato.statusCode, 200, nato.body);
  const progetto = banco.progetti.trova(nato.json<{ idProgetto: string }>().idProgetto);
  assert.equal(progetto?.cartella, cartella);
  assert.equal(await readFile(join(cartella, "appunti.txt"), "utf8"), "miei");
  assert.match(banco.conversazioniLocali[0]?.inviati[0] ?? "", /^Riordina gli appunti\.\n\n\[Shinka\] Questo progetto lavora in una cartella che esisteva già/);
});
