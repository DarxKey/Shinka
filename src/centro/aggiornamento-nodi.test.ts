import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { leggiInstallazione, scriviInstallazione } from "../guardiano/guardiano.ts";
import { allestisci, avviaNodo, avviaNodoAccettato, finche, ID_NODO, type Banco, type NodoInProva, type OpzioniBanco } from "../prove/banco.ts";
import type { Ambiente, ComandoPerNodo, RiferitoDalNodo } from "../protocollo/nodi.ts";
import { ID_AMBIENTE_DEL_CENTRO } from "./ambienti.ts";
import { COOKIE_SESSIONE } from "./centro.ts";

type Aggiorna = Extract<ComandoPerNodo, { tipo: "aggiorna" }>;

const DEL_CENTRO = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const DI_PRIMA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

/** Un centro alla versione nuova, e il modo di premere "Aggiorna" come fa la pagina degli ambienti. */
async function centroAggiornato(t: TestContext, opzioni: OpzioniBanco = {}) {
  const banco = await allestisci(t, { versione: DEL_CENTRO, ...opzioni });
  const cookies = { [COOKIE_SESSIONE]: await banco.entra() };
  const premi = (idAmbiente: string = ID_NODO) => banco.centro.inject({ method: "POST", url: `/api/ambienti/${idAmbiente}/aggiornamento`, cookies });
  return { banco, premi };
}

function ambienteDelNodo(banco: Banco): Ambiente {
  const ambiente = banco.ambienti.stato().ambienti.find((uno) => uno.id === ID_NODO);
  assert.ok(ambiente, "l'ambiente del nodo c'è");
  return ambiente;
}

/** Il nodo si spegne e riparte, come quando il suo guardiano lo riavvia: stessa identità, la versione che il test dice. */
async function riparte(t: TestContext, banco: Banco, nodo: NodoInProva, opzioni: Parameters<typeof avviaNodo>[2]): Promise<NodoInProva> {
  nodo.lavoro.spegni();
  nodo.collegamento.ferma();
  const nuovo = await avviaNodo(t, banco, opzioni);
  await finche(() => nuovo.stati.some((stato) => stato.stato === "attivo"), "il nodo riparte e viene accolto");
  return nuovo;
}

test("il proprietario fa passare un nodo rimasto indietro alla versione del centro", async (t) => {
  const { banco, premi } = await centroAggiornato(t);
  const ricevuti: Aggiorna[] = [];
  const nodo = await avviaNodoAccettato(t, banco, { versione: DI_PRIMA, aggiorna: (comando) => void ricevuti.push(comando) });
  assert.deepEqual(
    { versione: ambienteDelNodo(banco).versione, indietro: ambienteDelNodo(banco).indietro, siAggiorna: ambienteDelNodo(banco).siAggiorna },
    { versione: "bbbbbbbb", indietro: true, siAggiorna: true },
  );
  // Collegarsi indietro non basta: senza una richiesta il nodo resta com'è.
  await new Promise((fatto) => setTimeout(fatto, 100));
  assert.equal(ricevuti.length, 0);

  assert.equal((await banco.centro.inject({ method: "POST", url: `/api/ambienti/${ID_NODO}/aggiornamento` })).statusCode, 401);
  const premuto = await premi();
  assert.equal(premuto.statusCode, 200);
  assert.deepEqual(premuto.json(), { avviato: true });

  // Al nodo arrivano la versione del centro e i suoi file.
  await finche(() => ricevuti.length === 1, "il nodo riceve la richiesta di aggiornarsi");
  assert.equal(ricevuti[0]?.versione, DEL_CENTRO);
  assert.deepEqual(ricevuti[0]?.file, [{ percorso: "versione.json", dati: Buffer.from(JSON.stringify({ versione: DEL_CENTRO })).toString("base64") }]);
  assert.deepEqual(ambienteDelNodo(banco).aggiornamento, { stato: "in-corso", versione: "aaaaaaaa" });

  // Mentre è in corso non se ne chiede un altro.
  const ancora = await premi();
  assert.equal(ancora.statusCode, 409);
  assert.match(ancora.json().errore, /già in corso/);

  // Il nodo riparte con la versione nuova: non è più indietro, e non resta nulla in sospeso.
  await riparte(t, banco, nodo, { versione: DEL_CENTRO, aggiorna: (comando) => void ricevuti.push(comando) });
  await finche(() => ambienteDelNodo(banco).versione === "aaaaaaaa", "il centro vede la versione nuova del nodo");
  assert.deepEqual(
    { indietro: ambienteDelNodo(banco).indietro, aggiornamento: ambienteDelNodo(banco).aggiornamento },
    { indietro: undefined, aggiornamento: undefined },
  );
  const inutile = await premi();
  assert.equal(inutile.statusCode, 409);
  assert.match(inutile.json().errore, /già alla versione del centro/);
  assert.equal(ricevuti.length, 1);
});

test("un nodo che torna con la versione di prima risulta non aggiornato, con il motivo che dice lui", async (t) => {
  const { banco, premi } = await centroAggiornato(t);
  const nodo = await avviaNodoAccettato(t, banco, { versione: DI_PRIMA, aggiorna: () => {} });
  assert.equal((await premi()).statusCode, 200);

  // Il guardiano del nodo ha rimesso la versione di prima.
  await riparte(t, banco, nodo, {
    versione: DI_PRIMA,
    aggiorna: () => {},
    aggiornamentoFallito: { versione: DEL_CENTRO, motivo: "non ha risposto in tempo" },
  });
  await finche(() => ambienteDelNodo(banco).aggiornamento?.stato === "non-riuscito", "il centro viene a sapere che non è riuscito");
  assert.deepEqual(ambienteDelNodo(banco).aggiornamento, {
    stato: "non-riuscito",
    versione: "aaaaaaaa",
    motivo: "La versione nuova non è partita (non ha risposto in tempo): il nodo è tornato a quella di prima.",
  });
  assert.equal(ambienteDelNodo(banco).indietro, true);
  // Si può riprovare.
  assert.equal((await premi()).statusCode, 200);
});

test("se il nodo non riesce a preparare la versione nuova lo dice, e resta com'è", async (t) => {
  const { banco, premi } = await centroAggiornato(t);
  const nodo: NodoInProva = await avviaNodoAccettato(t, banco, {
    versione: DI_PRIMA,
    aggiorna: (comando) =>
      nodo.collegamento.riferisci({ tipo: "aggiornamento-non-riuscito", idRichiesta: comando.idRichiesta, motivo: "Le dipendenze della versione nuova non si sono installate." }),
  });
  assert.equal((await premi()).statusCode, 200);
  await finche(() => ambienteDelNodo(banco).aggiornamento?.stato === "non-riuscito", "il nodo riferisce che non è riuscito");
  assert.deepEqual(ambienteDelNodo(banco).aggiornamento, {
    stato: "non-riuscito",
    versione: "aaaaaaaa",
    motivo: "Le dipendenze della versione nuova non si sono installate.",
  });
  assert.equal(ambienteDelNodo(banco).attivo, true);
  assert.equal((await premi()).statusCode, 200);
});

test("un nodo che non torna in tempo risulta non aggiornato", async (t) => {
  const { banco, premi } = await centroAggiornato(t, { aggiornamenti: { attesaMs: 150 } });
  await avviaNodoAccettato(t, banco, { versione: DI_PRIMA, aggiorna: () => {} });
  assert.equal((await premi()).statusCode, 200);
  await finche(() => ambienteDelNodo(banco).aggiornamento?.stato === "non-riuscito", "l'attesa finisce");
  const { aggiornamento } = ambienteDelNodo(banco);
  assert.match(aggiornamento?.stato === "non-riuscito" ? aggiornamento.motivo : "", /non è tornato con la versione nuova/);
});

test("l'aggiornamento non parte dove non può o dove chiuderebbe un lavoro", async (t) => {
  const { banco, premi } = await centroAggiornato(t);
  const rifiuto = async (idAmbiente?: string): Promise<string> => {
    const risposta = await premi(idAmbiente);
    assert.equal(risposta.statusCode, 409);
    return risposta.json().errore;
  };
  assert.match(await rifiuto(ID_AMBIENTE_DEL_CENTRO), /cambia versione insieme al centro/);
  assert.match(await rifiuto(), /è spento/);
  assert.match(await rifiuto("un-ambiente-che-non-c-e"), /è spento/);

  // Un nodo avviato a mano, senza il suo guardiano: nessuno scambierebbe le cartelle né tornerebbe indietro.
  const aMano = await avviaNodoAccettato(t, banco, { versione: DI_PRIMA });
  assert.equal(ambienteDelNodo(banco).siAggiorna, undefined);
  assert.match(await rifiuto(), /non è tenuto acceso dal suo guardiano/);

  // Con il guardiano, ma con una conversazione al lavoro in quell'ambiente.
  const ricevuti: Aggiorna[] = [];
  const nodo = await riparte(t, banco, aMano, { versione: DI_PRIMA, aggiorna: (comando) => void ricevuti.push(comando) });
  const progetto = await banco.lavori.crea("Videogioco", ID_NODO, "Un gioco.");
  await finche(() => banco.lavori.stato().progetti.find((uno) => uno.id === progetto.id)?.condizione === "al-lavoro", "il progetto lavora");
  assert.match(await rifiuto(), /una conversazione sta lavorando o aspetta una tua risposta/);
  assert.equal(ricevuti.length, 0);
  assert.equal(ambienteDelNodo(banco).aggiornamento, undefined);

  // Finito il turno, parte.
  await finche(() => nodo.conversazioni.length === 1, "la conversazione è aperta sul nodo");
  nodo.conversazioni[0]?.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 10 });
  await finche(() => banco.lavori.stato().progetti.find((uno) => uno.id === progetto.id)?.condizione !== "al-lavoro", "il turno finisce");
  assert.equal((await premi()).statusCode, 200);
  await finche(() => ricevuti.length === 1, "il nodo riceve la richiesta");
});

test("se il centro non sa a che versione è, non ha una versione da passare ai nodi", async (t) => {
  const banco = await allestisci(t);
  await avviaNodoAccettato(t, banco, { versione: DI_PRIMA, aggiorna: () => {} });
  const risposta = await banco.centro.inject({
    method: "POST",
    url: `/api/ambienti/${ID_NODO}/aggiornamento`,
    cookies: { [COOKIE_SESSIONE]: await banco.entra() },
  });
  assert.equal(risposta.statusCode, 409);
  assert.match(risposta.json().errore, /Non è scritto quale versione sia in funzione al centro/);
  assert.equal(ambienteDelNodo(banco).indietro, undefined);
});

test("un nodo che non sa aggiornarsi lo dice, e un pacchetto scritto male non gli arriva nemmeno", async (t) => {
  const { banco } = await centroAggiornato(t);
  const ricevuti: Aggiorna[] = [];
  const riferiti: RiferitoDalNodo[] = [];
  banco.ambienti.iscriviRiferiti((_idNodo, messaggio) => void riferiti.push(messaggio));
  const file = [{ percorso: "src/nodo/avvio.ts", dati: "" }];

  // Senza guardiano: anche se la richiesta gli arrivasse, il nodo non cambia nulla.
  const aMano = await avviaNodoAccettato(t, banco, { versione: DI_PRIMA });
  assert.equal(banco.ambienti.inviaAlNodo(ID_NODO, { tipo: "aggiorna", idRichiesta: "r1", versione: DEL_CENTRO, file }), true);
  await finche(() => riferiti.length === 1, "il nodo risponde che non sa aggiornarsi");
  assert.deepEqual(riferiti[0], {
    tipo: "aggiornamento-non-riuscito",
    idRichiesta: "r1",
    motivo: "Questo nodo non sa aggiornarsi da solo: va aggiornato su quella macchina.",
  });

  // Con il guardiano: un file che uscirebbe dalla cartella, o una versione che non è una versione, si fermano al collegamento.
  await riparte(t, banco, aMano, { versione: DI_PRIMA, aggiorna: (comando) => void ricevuti.push(comando) });
  banco.ambienti.inviaAlNodo(ID_NODO, { tipo: "aggiorna", idRichiesta: "r2", versione: DEL_CENTRO, file: [{ percorso: "../fuori.ts", dati: "" }] });
  banco.ambienti.inviaAlNodo(ID_NODO, { tipo: "aggiorna", idRichiesta: "r3", versione: "main", file });
  banco.ambienti.inviaAlNodo(ID_NODO, { tipo: "aggiorna", idRichiesta: "r4", versione: DEL_CENTRO, file });
  await finche(() => ricevuti.length > 0, "la richiesta scritta bene arriva");
  await new Promise((fatto) => setTimeout(fatto, 100));
  assert.deepEqual(ricevuti.map((comando) => comando.idRichiesta), ["r4"]);
});

test("dopo un'installazione approvata si aggiornano i nodi che erano collegati, e la scheda lo dice prima", async (t) => {
  const { banco } = await centroAggiornato(t, {
    sviluppo: { prepara: async () => ({ pronta: true, versione: DEL_CENTRO, modifiche: ["Una modifica"], file: ["src/nodo/avvio.ts"], quantiFile: 1, avvisi: [] }) },
  });
  const sviluppo = banco.sviluppo;
  assert.ok(sviluppo);
  const ricevuti: Aggiorna[] = [];
  const opzioniNodo = { versione: DI_PRIMA, aggiorna: (comando: Aggiorna) => void ricevuti.push(comando) };
  const nodo = await avviaNodoAccettato(t, banco, opzioniNodo);

  // La scheda di installazione nomina il nodo che cambierà versione insieme al centro.
  await banco.comuniDelProgetto(sviluppo.idProgetto, "chiedi_installazione", { riassunto: "Una modifica ai nodi." });
  const eventi = banco.lavori.canale(sviluppo.idProgetto)?.archiviati.map((archiviato) => archiviato.evento) ?? [];
  const richiesta = eventi.find((evento) => evento.tipo === "installazione-richiesta");
  assert.ok(richiesta?.tipo === "installazione-richiesta");
  assert.deepEqual(richiesta.avvisi, [
    'Dopo l\'installazione si aggiorna anche il nodo dell\'ambiente "PC Windows", se quando approvi è ancora collegato: lì le conversazioni e i terminali aperti si chiudono.',
  ]);

  // Approvata: resta scritto quali nodi aggiornare dopo che il centro è ripartito.
  assert.equal(sviluppo.decidi(richiesta.idInstallazione, "approvata"), true);
  await finche(() => banco.riavvii.length === 1, "il centro si riavvia");
  const scritta = leggiInstallazione(banco.fileInstallazione);
  assert.deepEqual(scritta?.nodi, [ID_NODO]);
  assert.equal(ricevuti.length, 0);

  // Il centro riparte con la versione nuova, e il guardiano la conferma: il nodo, già ricollegato, viene aggiornato.
  assert.ok(scritta);
  const { nuova: _nuova, ...senzaNuova } = scritta;
  await scriviInstallazione(banco.fileInstallazione, { ...senzaNuova, fase: "confermata" });
  await sviluppo.riferisci();
  await finche(() => ricevuti.length === 1, "il nodo riceve la versione nuova");
  assert.equal(ricevuti[0]?.versione, DEL_CENTRO);
  assert.deepEqual(ambienteDelNodo(banco).aggiornamento, { stato: "in-corso", versione: "aaaaaaaa" });

  // Riferita una volta, non si ripete: un nodo che si ricollega più tardi non riceve nulla da solo.
  await riparte(t, banco, nodo, opzioniNodo);
  await sviluppo.riferisci();
  await new Promise((fatto) => setTimeout(fatto, 100));
  assert.equal(ricevuti.length, 1);
});

test("un nodo che al riavvio del centro non è ancora tornato viene aggiornato appena si ricollega", async (t) => {
  const { banco } = await centroAggiornato(t);
  const ricevuti: Aggiorna[] = [];
  const opzioniNodo = { versione: DI_PRIMA, aggiorna: (comando: Aggiorna) => void ricevuti.push(comando) };
  const nodo = await avviaNodoAccettato(t, banco, opzioniNodo);
  nodo.lavoro.spegni();
  nodo.collegamento.ferma();
  await finche(() => !ambienteDelNodo(banco).attivo, "il nodo risulta spento");

  // Tra i nodi da aggiornare ce n'è anche uno che non esiste più: non succede nulla.
  banco.aggiornamenti.propaga([ID_NODO, "un-nodo-rimosso"]);
  await new Promise((fatto) => setTimeout(fatto, 50));
  assert.equal(ricevuti.length, 0);

  const tornato = await avviaNodo(t, banco, opzioniNodo);
  await finche(() => ricevuti.length === 1, "il nodo, ricollegato, riceve la versione nuova");
  assert.equal(ricevuti[0]?.versione, DEL_CENTRO);

  // Una volta sola: se si ricollega ancora, non riceve un'altra richiesta.
  await riparte(t, banco, tornato, opzioniNodo);
  await new Promise((fatto) => setTimeout(fatto, 100));
  assert.equal(ricevuti.length, 1);
});

test("passata la finestra dopo l'installazione, un nodo che si ricollega non viene più aggiornato da solo", async (t) => {
  const { banco } = await centroAggiornato(t, { aggiornamenti: { finestraMs: 80 } });
  const ricevuti: Aggiorna[] = [];
  const opzioniNodo = { versione: DI_PRIMA, aggiorna: (comando: Aggiorna) => void ricevuti.push(comando) };
  const nodo = await avviaNodoAccettato(t, banco, opzioniNodo);
  nodo.lavoro.spegni();
  nodo.collegamento.ferma();
  await finche(() => !ambienteDelNodo(banco).attivo, "il nodo risulta spento");
  banco.aggiornamenti.propaga([ID_NODO]);
  await new Promise((fatto) => setTimeout(fatto, 200));

  const tornato = await avviaNodo(t, banco, opzioniNodo);
  await finche(() => tornato.stati.some((stato) => stato.stato === "attivo"), "il nodo si ricollega");
  await new Promise((fatto) => setTimeout(fatto, 100));
  assert.equal(ricevuti.length, 0);
  // Resta indietro, e lo si vede: il proprietario lo aggiorna dalla pagina degli ambienti.
  assert.equal(ambienteDelNodo(banco).indietro, true);
});
