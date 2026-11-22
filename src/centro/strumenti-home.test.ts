import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { cartellaDellArgomento } from "../protocollo/azioni.ts";
import type { EventoArchiviato } from "../protocollo/eventi.ts";
import { allestisci, avviaNodoAccettato, finche, ID_NODO, type Banco } from "../prove/banco.ts";
import { azioniDellaHome, consensoDellaHome, trovaPerNome, type RispostaStrumento } from "./strumenti-home.ts";

const BRIEF = "Un cubo che salta gli ostacoli, in 3D, con la barra spaziatrice.";

async function conStrumenti(t: TestContext): Promise<{ banco: Banco; azioni: ReturnType<typeof azioniDellaHome> }> {
  const banco = await allestisci(t);
  const azioni = azioniDellaHome({
    ambienti: banco.ambienti,
    lavori: banco.lavori,
    proposte: banco.proposte,
    home: () => banco.casa,
    agisci: banco.agisci,
  });
  return { banco, azioni };
}

function testo(risposta: RispostaStrumento): string {
  return risposta.content[0].text;
}

function proposte(banco: Banco): EventoArchiviato["evento"][] {
  return banco.canale.archiviati.map((e) => e.evento).filter((e) => e.tipo === "proposta-progetto");
}

test("la Home vede gli ambienti attivi, con il nome staccato da ciò che offrono", async (t) => {
  const { banco, azioni } = await conStrumenti(t);
  const centro = '- nome: "Unraid"; sistema: Linux; offre: Linux; qui giri tu: usa Bash, Read, Write ed Edit';
  assert.equal(testo(azioni.elencaAmbienti()), centro);

  // Di un altro ambiente la Home sa anche con quale shell e in quale cartella lavorerà.
  const nodo = await avviaNodoAccettato(t, banco);
  const cartella = cartellaDellArgomento(nodo.radiceProgetti, banco.casa.idArgomentoAperto);
  assert.equal(
    testo(azioni.elencaAmbienti()),
    `${centro}\n- nome: "PC Windows"; sistema: Windows 11; offre: Unity, Blender; shell: PowerShell; cartella di questo argomento: ${cartella}`,
  );

  // Un ambiente spento non è tra quelli in cui si può lavorare, ma la Home sa che esiste.
  nodo.collegamento.ferma();
  await finche(() => !banco.ambienti.attivo(ID_NODO), "l'ambiente risulta spento");
  assert.equal(testo(azioni.elencaAmbienti()), `${centro}\nSpenti in questo momento: "PC Windows".`);
});

test("una proposta mostra la scheda nell'ambiente indicato e non crea nulla", async (t) => {
  const { banco, azioni } = await conStrumenti(t);
  await avviaNodoAccettato(t, banco);

  const risposta = await azioni.proponiProgetto({ nome: " Cubo salta ostacoli ", brief: ` ${BRIEF} `, ambiente: "PC Windows" });
  assert.equal(risposta.isError, undefined);
  assert.match(testo(risposta), /Proposta mostrata.*"Cubo salta ostacoli".*"PC Windows".*Non è stato creato nulla/);
  assert.partialDeepStrictEqual(proposte(banco), [
    { tipo: "proposta-progetto", nome: "Cubo salta ostacoli", idAmbiente: ID_NODO, brief: BRIEF },
  ]);
  assert.deepEqual(banco.lavori.stato().progetti, []);
});

test("l'ambiente viene riconosciuto anche se riportato insieme alla sua descrizione", async (t) => {
  const { banco, azioni } = await conStrumenti(t);
  await avviaNodoAccettato(t, banco);

  // Così lo ha scritto davvero la Home, ripetendo la riga intera dell'elenco.
  for (const ambiente of [
    "PC Windows (Windows 11): Unity, Blender",
    'nome: "PC Windows"; sistema: Windows 11; offre: Unity, Blender',
    "pc windows",
    "  PC Windows ",
  ]) {
    const risposta = await azioni.proponiProgetto({ nome: "Cubo", brief: BRIEF, ambiente });
    assert.equal(risposta.isError, undefined, ambiente);
  }
  assert.deepEqual(
    proposte(banco).map((e) => e.tipo === "proposta-progetto" && e.idAmbiente),
    [ID_NODO, ID_NODO, ID_NODO, ID_NODO],
  );
});

test("per un ambiente sconosciuto o spento non compare nessuna scheda, e lo strumento lo dice", async (t) => {
  const { banco, azioni } = await conStrumenti(t);
  const sconosciuto = await azioni.proponiProgetto({ nome: "Cubo", brief: BRIEF, ambiente: "Mac dello studio" });
  assert.equal(sconosciuto.isError, true);
  assert.match(testo(sconosciuto), /Nessun ambiente attivo si chiama "Mac dello studio"/);
  assert.match(testo(sconosciuto), /- nome: "Unraid"/);

  const nodo = await avviaNodoAccettato(t, banco);
  nodo.collegamento.ferma();
  await finche(() => !banco.ambienti.attivo(ID_NODO), "l'ambiente risulta spento");
  const spento = await azioni.proponiProgetto({ nome: "Cubo", brief: BRIEF, ambiente: "PC Windows" });
  assert.equal(spento.isError, true);
  assert.equal(testo(spento).includes('"PC Windows";'), false);

  assert.deepEqual(proposte(banco), []);
});

test("una proposta senza nome o senza brief non viene mostrata", async (t) => {
  const { banco, azioni } = await conStrumenti(t);
  assert.equal((await azioni.proponiProgetto({ nome: "   ", brief: BRIEF, ambiente: "Unraid" })).isError, true);
  assert.equal((await azioni.proponiProgetto({ nome: "Cubo", brief: "  ", ambiente: "Unraid" })).isError, true);
  assert.deepEqual(proposte(banco), []);
});

test("la Home conosce i progetti, il loro ambiente e la loro condizione", async (t) => {
  const { banco, azioni } = await conStrumenti(t);
  assert.equal(testo(azioni.elencaProgetti()), "Non c'è ancora nessun progetto.");

  await banco.lavori.crea("Videogioco", "centro", BRIEF);
  assert.equal(
    testo(azioni.elencaProgetti()),
    '- nome: "Videogioco"; ambiente: Unraid; condizione: al lavoro',
  );

  banco.conversazioniLocali[0]?.emetti({
    tipo: "permesso-richiesto",
    idPermesso: "p1",
    idAzione: "p1",
    strumento: "Bash",
    ingresso: {},
  });
  assert.match(testo(azioni.elencaProgetti()), /condizione: aspetta una risposta del proprietario/);
});

test("su richiesta la Home sposta l'interfaccia sul progetto giusto", async (t) => {
  const { banco, azioni } = await conStrumenti(t);
  const sito = await banco.lavori.crea("Sito del club", "centro", "Un sito.");
  await banco.lavori.crea("Videogioco", "centro", BRIEF);
  const ricevuti: EventoArchiviato["evento"][] = [];
  banco.canale.ascolta(({ evento }) => ricevuti.push(evento));

  const risposta = azioni.apriProgetto({ progetto: "il sito del club" });
  assert.equal(risposta.isError, undefined);
  assert.match(testo(risposta), /"Sito del club"/);
  assert.deepEqual(ricevuti, [{ tipo: "apri-progetto", idProgetto: sito.id }]);

  const sconosciuto = azioni.apriProgetto({ progetto: "ricette" });
  assert.equal(sconosciuto.isError, true);
  assert.match(testo(sconosciuto), /I progetti sono: "Videogioco", "Sito del club"\./);
  assert.equal(ricevuti.length, 1);
});

test("un nome si trova anche scritto in parte, con altre maiuscole o con altro attorno", () => {
  const progetti = [{ nome: "Videogioco spaziale" }, { nome: "Sito del club" }, { nome: "Sito" }];
  assert.equal(trovaPerNome(progetti, "sito")?.nome, "Sito");
  assert.equal(trovaPerNome(progetti, "VIDEOGIOCO")?.nome, "Videogioco spaziale");
  assert.equal(trovaPerNome(progetti, "club")?.nome, "Sito del club");
  // Tra più nomi contenuti in ciò che è stato scritto vale il più lungo, cioè il più preciso.
  assert.equal(trovaPerNome(progetti, "apri il sito del club")?.nome, "Sito del club");
  assert.equal(trovaPerNome(progetti, "il progetto Sito, per favore")?.nome, "Sito");
  assert.equal(trovaPerNome(progetti, "ricette"), undefined);
  assert.equal(trovaPerNome(progetti, "  "), undefined);
});

/** Claude finisce di rispondere nell'argomento aperto. */
function concludi(banco: Banco): void {
  banco.home.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 1 });
}

test("la Home scrive un file in un altro ambiente, lo prova e lo rilegge, senza un progetto", async (t) => {
  const { banco, azioni } = await conStrumenti(t);
  const nodo = await avviaNodoAccettato(t, banco);
  const percorso = join(nodo.radiceProgetti, "_home", banco.casa.idArgomentoAperto, "saluto.txt");

  const scritto = await azioni.scriviFile({ ambiente: "PC Windows", percorso: "saluto.txt", contenuto: "Perché no?" });
  assert.equal(scritto.isError, undefined, testo(scritto));
  assert.equal(testo(scritto), `File scritto in "PC Windows": ${percorso}`);
  assert.equal(await readFile(percorso, "utf8"), "Perché no?");

  const letto = await azioni.leggiFile({ ambiente: "pc windows", percorso: "saluto.txt" });
  assert.equal(testo(letto), "Perché no?");

  const eseguito = await azioni.eseguiInAmbiente({ ambiente: "PC Windows", comando: "echo fatto", secondi: 20 });
  assert.equal(eseguito.isError, undefined, testo(eseguito));
  assert.match(testo(eseguito), /^Codice di uscita: 0\nfatto/);

  // Un comando che fallisce è un errore che Claude vede, con il suo codice.
  const fallito = await azioni.eseguiInAmbiente({ ambiente: "PC Windows", comando: "exit 4" });
  assert.equal(fallito.isError, true);
  assert.match(testo(fallito), /Codice di uscita: 4/);

  // Nessun progetto è nato, e nessuna conversazione si è aperta sul nodo.
  assert.deepEqual(banco.lavori.stato().progetti, []);
  assert.deepEqual(nodo.conversazioni, []);

  // Lo stesso vale nell'ambiente del centro, in una cartella sua.
  const alCentro = await azioni.scriviFile({ ambiente: "Unraid", percorso: "saluto.txt", contenuto: "Qui." });
  assert.equal(
    testo(alCentro),
    `File scritto in "Unraid": ${join(banco.radiceProgetti, "_home", banco.casa.idArgomentoAperto, "saluto.txt")}`,
  );
});

test("in un ambiente spento o sconosciuto non si agisce, e lo strumento dice perché", async (t) => {
  const { banco, azioni } = await conStrumenti(t);
  const sconosciuto = await azioni.eseguiInAmbiente({ ambiente: "Mac dello studio", comando: "ls" });
  assert.equal(sconosciuto.isError, true);
  assert.match(testo(sconosciuto), /Nessun ambiente attivo si chiama "Mac dello studio"/);

  const nodo = await avviaNodoAccettato(t, banco);
  nodo.collegamento.ferma();
  await finche(() => !banco.ambienti.attivo(ID_NODO), "l'ambiente risulta spento");
  const spento = await azioni.scriviFile({ ambiente: "PC Windows", percorso: "x.txt", contenuto: "x" });
  assert.equal(spento.isError, true);
  assert.match(testo(spento), /L'ambiente "PC Windows" è spento/);
});

test("leggere tra i file della Home non chiede consenso, scriverli solo con le modifiche libere", async (t) => {
  const { banco } = await conStrumenti(t);
  const nodo = await avviaNodoAccettato(t, banco);
  const consente = consensoDellaHome(banco.ambienti);
  const dentro = join(nodo.radiceProgetti, "_home", banco.casa.idArgomentoAperto, "prova.ps1");
  const fuori = join(nodo.radiceProgetti, "videogioco", "main.c");
  const leggi = "mcp__shinka__leggi_file";
  const scrivi = "mcp__shinka__scrivi_file";

  assert.equal(consente(leggi, { ambiente: "PC Windows", percorso: "prova.ps1" }, "chiedi"), true);
  assert.equal(consente(leggi, { ambiente: "PC Windows", percorso: dentro }, "chiedi"), true);
  assert.equal(consente(leggi, { ambiente: "PC Windows", percorso: fuori }, "chiedi"), false);
  assert.equal(consente(leggi, { ambiente: "PC Windows", percorso: "../videogioco/main.c" }, "automatico"), false);
  assert.equal(consente(leggi, { ambiente: "Mac dello studio", percorso: "prova.ps1" }, "chiedi"), false);

  assert.equal(consente(scrivi, { ambiente: "PC Windows", percorso: "prova.ps1", contenuto: "" }, "chiedi"), false);
  assert.equal(consente(scrivi, { ambiente: "PC Windows", percorso: "prova.ps1", contenuto: "" }, "modifiche-libere"), true);
  assert.equal(consente(scrivi, { ambiente: "PC Windows", percorso: fuori, contenuto: "" }, "modifiche-libere"), false);

  // Un comando può fare qualunque cosa: segue sempre il modo dei permessi.
  for (const modo of ["chiedi", "modifiche-libere", "automatico"] as const) {
    assert.equal(consente("mcp__shinka__esegui_in_ambiente", { ambiente: "PC Windows", comando: "dir" }, modo), false);
    assert.equal(consente("mcp__shinka__inoltra_a_progetto", { progetto: "X", istruzione: "Y" }, modo), false);
  }
  assert.equal(consente(leggi, "prova.ps1", "chiedi"), false);
});

test("nel dubbio la Home chiede dove lavorare, e non comincia", async (t) => {
  const { banco, azioni } = await conStrumenti(t);
  const risposta = azioni.chiediDoveLavorare({ lavoro: " Un sito per il club di scacchi " });
  assert.equal(risposta.isError, undefined);
  assert.match(testo(risposta), /aspetta la sua risposta/);
  assert.partialDeepStrictEqual(banco.canale.archiviati.at(-1)?.evento, {
    tipo: "scelta-richiesta",
    lavoro: "Un sito per il club di scacchi",
  });
  assert.equal(azioni.chiediDoveLavorare({ lavoro: "  " }).isError, true);
  assert.deepEqual(banco.lavori.stato().progetti, []);
});

test("la Home riferisce di un progetto mai aperto lì, anche con il suo ambiente spento", async (t) => {
  const { banco, azioni } = await conStrumenti(t);
  const nodo = await avviaNodoAccettato(t, banco);
  const progetto = await banco.lavori.crea("Videogioco", ID_NODO, BRIEF);
  await finche(() => nodo.conversazioni.length === 1, "la conversazione nasce sul nodo");
  nodo.conversazioni[0]?.emetti({ tipo: "testo-concluso", idTesto: "t1", testo: "Il cubo salta. Manca il punteggio." });
  nodo.conversazioni[0]?.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 1 });
  await finche(
    () => banco.lavori.canale(progetto.id)?.archiviati.at(-1)?.evento.tipo === "turno-concluso",
    "il resoconto arriva al centro",
  );

  nodo.collegamento.ferma();
  await finche(() => !banco.ambienti.attivo(ID_NODO), "l'ambiente risulta spento");

  assert.equal(
    testo(azioni.elencaProgetti()),
    '- nome: "Videogioco"; ambiente: PC Windows; condizione: ambiente spento; ultimo resoconto: Il cubo salta. Manca il punteggio.',
  );
  const letto = testo(azioni.leggiProgetto({ progetto: "videogioco" }));
  assert.match(letto, /Condizione: ambiente spento/);
  assert.match(letto, /Brief:\nUn cubo che salta/);
  assert.match(letto, /Ultima richiesta del proprietario:\nUn cubo che salta/);
  assert.match(letto, /Ultimo resoconto del progetto:\nIl cubo salta\. Manca il punteggio\./);
  assert.equal(letto.includes("Storia della conversazione"), false);
  assert.match(testo(azioni.leggiProgetto({ progetto: "Videogioco", storia: true })), /Progetto: Il cubo salta/);

  // Nulla di tutto questo ha toccato la conversazione della Home o quella del progetto.
  assert.deepEqual(banco.canale.archiviati, []);
  assert.equal(azioni.leggiProgetto({ progetto: "Ricette" }).isError, true);

  // E a un progetto il cui ambiente è spento non si inoltra nulla.
  const inoltro = azioni.inoltraAProgetto({ progetto: "Videogioco", istruzione: "Aggiungi il punteggio." });
  assert.equal(inoltro.isError, true);
  assert.match(testo(inoltro), /spento/);
});

test("su richiesta del proprietario la Home inoltra un'istruzione a un progetto", async (t) => {
  const { banco, azioni } = await conStrumenti(t);
  await banco.lavori.crea("Videogioco", "centro", BRIEF);
  const risposta = azioni.inoltraAProgetto({ progetto: "Videogioco", istruzione: " Aggiungi il punteggio. " });
  assert.equal(risposta.isError, undefined);
  assert.match(testo(risposta), /inoltrata al progetto "Videogioco"/);
  assert.deepEqual(banco.conversazioniLocali[0]?.inviati, [
    BRIEF,
    "[Inoltrato dalla Home su richiesta del proprietario]\nAggiungi il punteggio.",
  ]);
  assert.equal(azioni.inoltraAProgetto({ progetto: "Videogioco", istruzione: "  " }).isError, true);
});

test("ciò che è stato fatto in un argomento archiviato si ritrova e si riconsegna senza rifarlo", async (t) => {
  const { banco, azioni } = await conStrumenti(t);
  assert.equal(testo(await azioni.cercaArgomenti({ testo: "script foto" })), "Non c'è ancora nessun argomento archiviato.");

  // Nel primo argomento la Home scrive uno script in un altro ambiente.
  const primo = banco.casa.idArgomentoAperto;
  const script = "Get-ChildItem *.jpg | Rename-Item -NewName { $_.LastWriteTime.ToString('yyyy-MM-dd') + '_' + $_.Name }";
  const percorso = `D:\\Progetti\\_home\\${primo}\\rinomina.ps1`;
  banco.casa.invia("Scrivimi uno script che rinomina le foto con la data davanti.");
  banco.home.emetti({
    tipo: "azione-iniziata",
    idAzione: "a1",
    strumento: "mcp__shinka__scrivi_file",
    ingresso: { ambiente: "PC Windows", percorso: "rinomina.ps1", contenuto: script },
  });
  banco.home.emetti({ tipo: "azione-conclusa", idAzione: "a1", esito: `File scritto in "PC Windows": ${percorso}`, errore: false });
  banco.home.emetti({ tipo: "testo-concluso", idTesto: "t1", testo: "Ecco lo script, provato sul PC." });
  concludi(banco);
  banco.casa.invia("Perfetto, grazie.");
  concludi(banco);

  // Poi si parla d'altro: l'argomento viene archiviato.
  banco.casa.invia("Che tempo fa domani?");
  azioni.cambiaArgomento({ titolo: "Rinominare le foto", riassunto: "Script PowerShell sul PC, provato." });
  concludi(banco);
  await finche(() => banco.conversazioniHome.length === 2 && banco.home.inviati.length === 1, "si apre l'argomento nuovo");
  concludi(banco);

  // Richiesto di nuovo, lo script si ritrova: dove sta, e che cosa contiene.
  const trovati = testo(await azioni.cercaArgomenti({ testo: "lo script che rinomina le foto" }));
  assert.match(trovati, new RegExp(`- identificativo: ${primo}`));
  assert.match(trovati, /titolo: "Rinominare le foto"/);
  assert.match(trovati, /riassunto: Script PowerShell sul PC, provato\./);
  assert.ok(trovati.includes(`file: ${percorso} (in "PC Windows")`), trovati);

  const letto = testo(await azioni.leggiArgomento({ argomento: primo }));
  assert.match(letto, /Proprietario: Scrivimi uno script/);
  assert.match(letto, /Home: Ecco lo script, provato sul PC\./);
  assert.ok(letto.includes(`### ${percorso} (nell'ambiente "PC Windows")\n${script}`), letto);
  // Anche per titolo, se Claude non ripete l'identificativo.
  assert.ok(testo(await azioni.leggiArgomento({ argomento: "rinominare le foto" })).includes(script));

  // Ciò che non c'è non si inventa.
  const nulla = testo(await azioni.cercaArgomenti({ testo: "dichiarazione dei redditi" }));
  assert.match(nulla, /Nessun argomento archiviato parla di "dichiarazione dei redditi"/);
  assert.match(nulla, new RegExp(`- ${primo}: "Rinominare le foto"`));
  assert.equal((await azioni.leggiArgomento({ argomento: "2020-01-01-ffffff" })).isError, true);
});

test("cambiare argomento da uno appena cominciato viene rifiutato, e Claude lo sa", async (t) => {
  const { banco, azioni } = await conStrumenti(t);
  banco.casa.invia("Che tempo fa domani?");
  const risposta = azioni.cambiaArgomento({ titolo: "Meteo", riassunto: "" });
  assert.equal(risposta.isError, true);
  assert.match(testo(risposta), /Rispondi alla richiesta del proprietario qui/);
});

test("un argomento che diventa progetto porta con sé i file del suo ambiente", async (t) => {
  const { banco, azioni } = await conStrumenti(t);
  const nodo = await avviaNodoAccettato(t, banco);
  const argomento = banco.casa.idArgomentoAperto;
  await azioni.scriviFile({ ambiente: "PC Windows", percorso: "gioco/cubo.js", contenuto: "salta();" });
  await azioni.scriviFile({ ambiente: "PC Windows", percorso: "note.md", contenuto: "Manca il punteggio." });
  await azioni.scriviFile({ ambiente: "Unraid", percorso: "altro.txt", contenuto: "Qui." });

  const risposta = await azioni.proponiProgetto({ nome: "Cubo", brief: BRIEF, ambiente: "PC Windows" });
  assert.match(testo(risposta), /ha 2 file in "PC Windows": se il proprietario conferma, il progetto nasce con una loro copia/);
  assert.match(testo(risposta), /ha file anche in "Unraid": quelli non seguono il progetto/);
  const scheda = proposte(banco)[0];
  assert.ok(scheda?.tipo === "proposta-progetto");
  assert.deepEqual(
    scheda.file?.toSorted((a, b) => a.idAmbiente.localeCompare(b.idAmbiente)),
    [
      { idAmbiente: "centro", percorsi: ["altro.txt"], quanti: 1 },
      { idAmbiente: ID_NODO, percorsi: ["gioco/cubo.js", "note.md"], quanti: 2 },
    ].toSorted((a, b) => a.idAmbiente.localeCompare(b.idAmbiente)),
  );

  const progetto = await banco.proposte.conferma(scheda.idProposta, {});
  assert.equal(progetto?.filePortati, 2);
  const cartella = join(nodo.radiceProgetti, "cubo");
  assert.equal(await readFile(join(cartella, "gioco", "cubo.js"), "utf8"), "salta();");
  assert.equal(await readFile(join(cartella, "note.md"), "utf8"), "Manca il punteggio.");
  assert.match(await readFile(join(cartella, "BRIEF.md"), "utf8"), /Un cubo che salta/);
  // Sono copie: l'argomento conserva i suoi file, e quello rimasto al centro non ha seguito il progetto.
  assert.equal(await readFile(join(nodo.radiceProgetti, "_home", argomento, "note.md"), "utf8"), "Manca il punteggio.");
  assert.equal(existsSync(join(cartella, "altro.txt")), false);

  // Chi comincia il lavoro sa che nella cartella c'è già qualcosa, e la scheda dice quanti file sono arrivati.
  await finche(() => nodo.conversazioni[0]?.inviati.length === 1, "il nodo riceve il brief");
  assert.equal(
    nodo.conversazioni[0]?.inviati[0],
    `${BRIEF}\n\n[Shinka] Questo progetto nasce da un lavoro cominciato nella Home: nella cartella ci sono già 2 file prodotti lì. Guardali prima di cominciare, e parti da quelli.`,
  );
  assert.partialDeepStrictEqual(banco.canale.archiviati.at(-1)?.evento, {
    tipo: "proposta-decisa",
    esito: "confermata",
    filePortati: 2,
  });
});

test("un argomento senza file propone un progetto come prima, e uno spento non blocca la proposta", async (t) => {
  const { banco, azioni } = await conStrumenti(t);
  const nodo = await avviaNodoAccettato(t, banco);
  await azioni.scriviFile({ ambiente: "PC Windows", percorso: "note.md", contenuto: "Sul PC." });
  nodo.collegamento.ferma();
  await finche(() => !banco.ambienti.attivo(ID_NODO), "l'ambiente risulta spento");

  // I file stanno in un ambiente spento: la proposta al centro compare lo stesso, senza file.
  const risposta = await azioni.proponiProgetto({ nome: "Cubo", brief: BRIEF, ambiente: "Unraid" });
  assert.equal(risposta.isError, undefined);
  assert.equal(testo(risposta).includes("file"), false);
  const scheda = proposte(banco)[0];
  assert.ok(scheda?.tipo === "proposta-progetto");
  assert.equal("file" in scheda, false);

  const progetto = await banco.proposte.conferma(scheda.idProposta, {});
  assert.equal(progetto?.filePortati, undefined);
  assert.deepEqual(banco.conversazioniLocali[0]?.inviati, [BRIEF]);
});

test("lo stato del progetto lo scrive il progetto, e la Home riferisce quello", async (t) => {
  const { banco, azioni } = await conStrumenti(t);
  const nodo = await avviaNodoAccettato(t, banco);
  const progetto = await banco.lavori.crea("Videogioco", ID_NODO, BRIEF);
  await finche(() => nodo.conversazioni.length === 1, "la conversazione nasce sul nodo");
  const conversazione = nodo.conversazioni[0];
  const canale = banco.lavori.canale(progetto.id);
  assert.ok(conversazione !== undefined && canale !== undefined);
  const stati = (): number => canale.archiviati.filter((e) => e.evento.tipo === "stato-progetto").length;
  const arrivato = (idTesto: string): boolean =>
    canale.archiviati.some((e) => e.evento.tipo === "testo-concluso" && e.evento.idTesto === idTesto);

  assert.match(
    testo(azioni.leggiProgetto({ progetto: "Videogioco" })),
    /Stato del progetto: il progetto non lo ha ancora scritto\./,
  );

  // Il progetto scrive il suo stato nella cartella, sul nodo: a fine turno arriva al centro.
  await writeFile(join(progetto.cartella, "STATO.md"), "# Stato\n\nIl cubo salta. **Aspetta** la scelta dei colori.\n");
  conversazione.emetti({ tipo: "testo-concluso", idTesto: "t1", testo: "Fatto, ho sistemato il salto." });
  conversazione.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 1 });
  await finche(() => stati() === 1, "lo stato del progetto arriva al centro");

  // Riferito di nuovo uguale, come dopo un riavvio del nodo, non entra una seconda volta nella storia.
  conversazione.emetti({ tipo: "stato-progetto", testo: "# Stato\n\nIl cubo salta. **Aspetta** la scelta dei colori." });
  conversazione.emetti({ tipo: "testo-concluso", idTesto: "t2", testo: "Fatto, ho sistemato il salto." });
  await finche(() => arrivato("t2"), "gli eventi successivi arrivano al centro");
  assert.equal(stati(), 1);

  nodo.collegamento.ferma();
  await finche(() => !banco.ambienti.attivo(ID_NODO), "l'ambiente risulta spento");

  // Anche con l'ambiente spento la Home riferisce lo stato, e non l'ultimo messaggio.
  assert.equal(
    testo(azioni.elencaProgetti()),
    '- nome: "Videogioco"; ambiente: PC Windows; condizione: ambiente spento; stato del progetto: Stato Il cubo salta. Aspetta la scelta dei colori.',
  );
  const letto = testo(azioni.leggiProgetto({ progetto: "Videogioco" }));
  assert.match(letto, /Stato del progetto, scritto dal progetto il \d{4}-\d{2}-\d{2}:\n# Stato\n\nIl cubo salta\./);
  assert.match(letto, /Ultimo resoconto del progetto:\nFatto, ho sistemato il salto\./);
  // Lo stato non è una battuta della conversazione.
  assert.equal(testo(azioni.leggiProgetto({ progetto: "Videogioco", storia: true })).includes("Aspetta** la scelta dei colori.\n["), false);
});

test("inoltrando, la Home può dare al progetto un modello e un effort per quel lavoro, non i permessi", async (t) => {
  const { banco, azioni } = await conStrumenti(t);
  const nato = await banco.lavori.crea("Videogioco", "centro", BRIEF);
  const salvate = banco.lavori.impostazioni(nato.id);
  const risposta = azioni.inoltraAProgetto({ progetto: "Videogioco", istruzione: "Rifai il livello 2.", modello: "opus", effort: "max" });
  assert.equal(risposta.isError, undefined);
  assert.match(testo(risposta), /Per questo lavoro solo usa il modello opus con effort max/);
  const conversazione = banco.conversazioniLocali[0];
  assert.deepEqual(conversazione?.impostazioni.at(-1), { ...salvate, modello: "opus", impegno: "max" });
  // I permessi restano quelli del progetto, e le impostazioni salvate non cambiano.
  assert.equal(conversazione?.impostazioni.at(-1)?.permessi, salvate.permessi);
  assert.deepEqual(banco.lavori.impostazioni(nato.id), salvate);
  // Finito il lavoro, tornano quelle di sempre.
  conversazione?.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 1 });
  conversazione?.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 1 });
  await finche(() => banco.lavori.impostazioniInUso(nato.id).modello === salvate.modello, "tornano le impostazioni di sempre");

  // Senza richieste del proprietario, nessuna scelta per il lavoro.
  const quante = conversazione?.impostazioni.length ?? 0;
  azioni.inoltraAProgetto({ progetto: "Videogioco", istruzione: "Aggiungi il punteggio." });
  assert.equal(conversazione?.impostazioni.length, quante);
});
