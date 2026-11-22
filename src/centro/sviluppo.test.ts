import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test, type TestContext } from "node:test";
import { leggiInstallazione, scriviInstallazione } from "../guardiano/guardiano.ts";
import { allestisci, finche, type Banco, type OpzioniBanco } from "../prove/banco.ts";
import type { EventoConversazione } from "../protocollo/eventi.ts";
import { FILE_STATO_DELLO_SVILUPPO, FILE_STATO_PROGETTO, NOME_PROGETTO_SHINKA } from "../protocollo/progetti.ts";
import { COOKIE_SESSIONE } from "./centro.ts";
import { ID_AMBIENTE_DEL_CENTRO } from "./ambienti.ts";
import type { EsitoPreparazione } from "./preparazione.ts";
import { SviluppoDiShinka } from "./sviluppo.ts";
import { azioniDellaHome } from "./strumenti-home.ts";

const VERSIONE = "0123456789abcdef0123456789abcdef01234567";
const PRONTA: EsitoPreparazione = {
  pronta: true,
  versione: VERSIONE,
  modifiche: ["Aggiunge il pulsante"],
  file: ["web/src/Pulsante.tsx"],
  quantiFile: 1,
  avvisi: [],
};

type Sviluppo = NonNullable<OpzioniBanco["sviluppo"]>;

/** Un centro con lo sviluppo di Shinka acceso, e una preparazione che risponde ciò che il test decide. */
async function conSviluppo(t: TestContext, esito: EsitoPreparazione = PRONTA, altro: Partial<Sviluppo> = {}) {
  const preparazioni: string[] = [];
  const banco = await allestisci(t, {
    sviluppo: {
      prepara: async (opzioni) => {
        preparazioni.push(opzioni.nuova);
        return esito;
      },
      ...altro,
    },
  });
  const sviluppo = banco.sviluppo;
  assert.ok(sviluppo);
  const idProgetto = sviluppo.idProgetto;
  const canale = banco.lavori.canale(idProgetto);
  assert.ok(canale);
  const eventi = (): EventoConversazione[] => canale.archiviati.map((archiviato) => archiviato.evento);
  const diTipo = <T extends EventoConversazione["tipo"]>(tipo: T, dove: EventoConversazione[] = eventi()) =>
    dove.filter((evento): evento is Extract<EventoConversazione, { tipo: T }> => evento.tipo === tipo);
  const cookie = { [COOKIE_SESSIONE]: await banco.entra() };
  const manda = (percorso: string, corpo: unknown) => banco.centro.inject({ method: "POST", url: percorso, cookies: cookie, payload: corpo as object });
  return { banco, sviluppo, idProgetto, canale, eventi, diTipo, manda, preparazioni };
}

function eventiDellaHome(banco: Banco): EventoConversazione[] {
  return banco.canale.archiviati.map((archiviato) => archiviato.evento);
}

test("il progetto Shinka c'è una volta sola, senza un primo messaggio, e sa di essere lo sviluppo di Shinka", async (t) => {
  const { banco, sviluppo, idProgetto } = await conSviluppo(t);
  const progetti = banco.lavori.stato().progetti;
  assert.equal(progetti.length, 1);
  assert.deepEqual(
    { nome: progetti[0]?.nome, diShinka: progetti[0]?.diShinka, idAmbiente: progetti[0]?.idAmbiente, condizione: progetti[0]?.condizione },
    { nome: NOME_PROGETTO_SHINKA, diShinka: true, idAmbiente: ID_AMBIENTE_DEL_CENTRO, condizione: "fermo" },
  );
  // Nessuno ha chiesto nulla: la conversazione non è nemmeno partita.
  assert.equal(banco.conversazioniLocali.length, 0);

  // Riaprendo, il progetto è quello di prima.
  const riaperto = await SviluppoDiShinka.apri({
    repository: "non-serve",
    radiceProgetti: banco.radiceProgetti,
    installata: "non-serve",
    fileInstallazione: banco.fileInstallazione,
    guardiano: true,
    lavori: banco.lavori,
    canaleHome: () => banco.canale,
    annotaHome: () => {},
    riavvia: () => {},
  });
  assert.equal(riaperto?.idProgetto, idProgetto);
  assert.equal(banco.lavori.stato().progetti.length, 1);
  assert.equal(sviluppo.puoInstallare, true);

  // La sua conversazione ha le istruzioni dello sviluppo, e lo stato del progetto in un file che non è quello del repository.
  banco.lavori.invia(idProgetto, "A che punto siamo?");
  const configurazione = banco.conversazioniLocali[0]?.configurazione;
  assert.ok(configurazione);
  assert.match(configurazione.istruzioniAggiunte ?? "", /# Lo sviluppo di Shinka/);
  assert.match(configurazione.istruzioniAggiunte ?? "", /chiedi_installazione/);
  assert.ok((configurazione.istruzioniAggiunte ?? "").includes(`tieni aggiornato il file \`${FILE_STATO_DELLO_SVILUPPO}\``));
  assert.equal(configurazione.consenteDaSe?.("Write", { file_path: FILE_STATO_DELLO_SVILUPPO }, "chiedi"), true);
  assert.equal(configurazione.consenteDaSe?.("Write", { file_path: FILE_STATO_PROGETTO }, "chiedi"), false);

  // Un progetto qualunque resta com'era.
  const altro = await banco.lavori.crea("Altro", ID_AMBIENTE_DEL_CENTRO, "Un progetto qualunque.");
  const diAltro = banco.conversazioniLocali[1]?.configurazione;
  assert.ok(diAltro);
  assert.doesNotMatch(diAltro.istruzioniAggiunte ?? "", /Lo sviluppo di Shinka/);
  assert.equal(diAltro.consenteDaSe?.("Write", { file_path: FILE_STATO_PROGETTO }, "chiedi"), true);
  assert.equal(altro.diShinka, undefined);
});

test("una proposta di sviluppo confermata passa la richiesta al progetto Shinka, una volta", async (t) => {
  const { banco, sviluppo, idProgetto, manda } = await conSviluppo(t);
  const azioni = azioniDellaHome({
    ambienti: banco.ambienti,
    lavori: banco.lavori,
    proposte: banco.proposte,
    home: () => banco.casa,
    agisci: banco.agisci,
    sviluppo,
  });
  const risposta = azioni.proponiSviluppo({ titolo: " Tema scuro ", richiesta: "Il proprietario vuole un tema scuro per l'interfaccia." });
  assert.equal(risposta.isError, undefined);
  assert.match(risposta.content[0].text, /Non è partito nulla/);
  assert.equal(azioni.proponiSviluppo({ titolo: "  ", richiesta: "x" }).isError, true);

  const proposta = eventiDellaHome(banco).find((evento) => evento.tipo === "sviluppo-proposto");
  assert.ok(proposta?.tipo === "sviluppo-proposto");
  assert.equal(proposta.titolo, "Tema scuro");
  // Finché non decide il proprietario non parte nulla.
  assert.equal(banco.conversazioniLocali.length, 0);

  assert.equal((await banco.centro.inject({ method: "POST", url: `/api/sviluppo/proposte/${proposta.idProposta}`, payload: { esito: "confermata" } })).statusCode, 401);
  const confermata = await manda(`/api/sviluppo/proposte/${proposta.idProposta}`, { esito: "confermata" });
  assert.equal(confermata.statusCode, 200);
  assert.deepEqual(confermata.json(), { idProgetto });
  assert.deepEqual(banco.conversazioniLocali[0]?.inviati, [
    "[Sviluppo di Shinka: proposta dalla Home, confermata dal proprietario]\nTema scuro\n\nIl proprietario vuole un tema scuro per l'interfaccia.",
  ]);
  // Senza scelte nella scheda il lavoro parte con le impostazioni di sempre, e la decisione lo dice.
  assert.deepEqual(eventiDellaHome(banco).at(-1), {
    tipo: "sviluppo-deciso",
    idProposta: proposta.idProposta,
    esito: "confermata",
    idProgetto,
    impostazioni: banco.lavori.impostazioni(idProgetto),
  });
  assert.match(banco.home.annotazioni.at(-1) ?? "", /ha confermato la proposta di sviluppo "Tema scuro"/);

  // La stessa scheda non vale due volte.
  assert.equal((await manda(`/api/sviluppo/proposte/${proposta.idProposta}`, { esito: "confermata" })).statusCode, 404);
  assert.equal((await manda(`/api/sviluppo/proposte/${proposta.idProposta}`, { esito: "annullata" })).statusCode, 404);
  assert.equal(banco.conversazioniLocali[0]?.inviati.length, 1);
});

test("una proposta di sviluppo annullata non fa partire nulla", async (t) => {
  const { banco, sviluppo, manda } = await conSviluppo(t);
  const idProposta = sviluppo.proponi({ titolo: "Tema scuro", richiesta: "Serve un tema scuro." });
  const annullata = await manda(`/api/sviluppo/proposte/${idProposta}`, { esito: "annullata" });
  assert.equal(annullata.statusCode, 200);
  assert.deepEqual(eventiDellaHome(banco).at(-1), { tipo: "sviluppo-deciso", idProposta, esito: "annullata" });
  assert.match(banco.home.annotazioni.at(-1) ?? "", /ha annullato la proposta di sviluppo "Tema scuro": non è partito nulla/);
  assert.equal(banco.conversazioniLocali.length, 0);
});

test("una versione che ha passato le prove si installa solo dopo l'approvazione del proprietario", async (t) => {
  const { banco, idProgetto, diTipo, manda, preparazioni } = await conSviluppo(t);
  const esito = await banco.comuniDelProgetto(idProgetto, "chiedi_installazione", { riassunto: " Aggiunge un pulsante per il tema scuro. " });
  assert.equal(esito.errore, undefined);
  assert.match(esito.testo, /Le prove sono passate sulla versione 01234567/);
  assert.match(esito.testo, /solo se la approva/);
  assert.equal(preparazioni.length, 1);

  const [richiesta] = diTipo("installazione-richiesta");
  assert.ok(richiesta);
  assert.deepEqual(
    { ...richiesta, idInstallazione: "" },
    {
      tipo: "installazione-richiesta",
      idInstallazione: "",
      versione: "01234567",
      riassunto: "Aggiunge un pulsante per il tema scuro.",
      modifiche: ["Aggiunge il pulsante"],
      file: ["web/src/Pulsante.tsx"],
      quantiFile: 1,
      avvisi: [],
    },
  );
  // Finché il proprietario non decide il progetto aspetta lui, e non è scritto nulla da installare.
  assert.equal(banco.lavori.stato().progetti[0]?.condizione, "aspetta-te");
  assert.equal(banco.sviluppo?.inAttesa, 1);
  assert.equal(leggiInstallazione(banco.fileInstallazione), undefined);
  assert.deepEqual(banco.riavvii, []);

  assert.equal((await banco.centro.inject({ method: "POST", url: `/api/sviluppo/installazioni/${richiesta.idInstallazione}`, payload: { decisione: "approvata" } })).statusCode, 401);
  assert.equal((await manda("/api/sviluppo/installazioni/un-altra", { decisione: "approvata" })).statusCode, 404);
  const approvata = await manda(`/api/sviluppo/installazioni/${richiesta.idInstallazione}`, { decisione: "approvata" });
  assert.equal(approvata.statusCode, 200);

  await finche(() => banco.riavvii.length === 1, "il centro si riavvia");
  const scritta = leggiInstallazione(banco.fileInstallazione);
  assert.equal(scritta?.fase, "da-installare");
  assert.equal(scritta?.versione, VERSIONE);
  assert.equal(scritta?.riassunto, "Aggiunge un pulsante per il tema scuro.");
  assert.equal(scritta?.nuova, preparazioni[0]);
  assert.deepEqual(diTipo("installazione-decisa"), [{ tipo: "installazione-decisa", idInstallazione: richiesta.idInstallazione, esito: "approvata" }]);
  assert.equal(banco.lavori.stato().progetti[0]?.condizione, "fermo");
  // Approvata una volta, non si decide di nuovo.
  assert.equal((await manda(`/api/sviluppo/installazioni/${richiesta.idInstallazione}`, { decisione: "negata" })).statusCode, 404);
  assert.equal(banco.riavvii.length, 1);
});

test("un'installazione negata non parte, e il progetto lo viene a sapere prima del messaggio successivo", async (t) => {
  const { banco, idProgetto, diTipo, manda } = await conSviluppo(t);
  await banco.comuniDelProgetto(idProgetto, "chiedi_installazione", { riassunto: "Un pulsante." });
  const [richiesta] = diTipo("installazione-richiesta");
  assert.ok(richiesta);
  assert.equal((await manda(`/api/sviluppo/installazioni/${richiesta.idInstallazione}`, { decisione: "negata" })).statusCode, 200);
  await finche(() => diTipo("installazione-decisa").length === 1, "la decisione compare nella conversazione");
  assert.equal(diTipo("installazione-decisa")[0]?.esito, "negata");
  assert.equal(leggiInstallazione(banco.fileInstallazione), undefined);

  banco.lavori.invia(idProgetto, "Non mi convince il colore.");
  const conversazione = banco.conversazioniLocali[0];
  assert.match(conversazione?.annotazioni[0] ?? "", /^\[Shinka\] Il proprietario ha negato l'installazione della versione 01234567/);
  // La nota arriva una volta sola.
  banco.lavori.invia(idProgetto, "Fallo più chiaro.");
  assert.equal(conversazione?.annotazioni.length, 1);
  await new Promise((fatto) => setTimeout(fatto, 50));
  assert.deepEqual(banco.riavvii, []);
});

test("un'installazione aspetta il proprietario senza scadere, finché una richiesta nuova non ne prende il posto", async (t) => {
  const { banco, idProgetto, diTipo, manda } = await conSviluppo(t, PRONTA);
  await banco.comuniDelProgetto(idProgetto, "chiedi_installazione", { riassunto: "Prima." });
  await banco.comuniDelProgetto(idProgetto, "chiedi_installazione", { riassunto: "Seconda." });
  const richieste = diTipo("installazione-richiesta");
  assert.equal(richieste.length, 2);
  assert.deepEqual(diTipo("installazione-decisa"), [{ tipo: "installazione-decisa", idInstallazione: richieste[0]?.idInstallazione, esito: "scaduta" }]);
  assert.equal(banco.sviluppo?.inAttesa, 1);

  // La richiesta non dice fino a quando vale, perché vale finché il proprietario non decide.
  assert.equal(richieste[1]?.scadeIl, undefined);
  assert.match((await banco.comuniDelProgetto(idProgetto, "chiedi_installazione", { riassunto: "Terza." })).testo, /resta in attesa finché non decide/);
  await new Promise((fatto) => setTimeout(fatto, 300));
  assert.equal(banco.sviluppo?.inAttesa, 1);
  // Quella sostituita non si approva più; l'ultima sì, anche dopo un po'.
  assert.equal(banco.sviluppo?.decidi(richieste[0]?.idInstallazione ?? "", "approvata"), false);
  const ultima = diTipo("installazione-richiesta").at(-1);
  assert.equal((await manda(`/api/sviluppo/installazioni/${ultima?.idInstallazione}`, { decisione: "approvata" })).statusCode, 200);
  await finche(() => banco.riavvii.length === 1, "il centro si riavvia");
  // Le sostituite non lasciano una nota al progetto: la richiesta l'ha fatta lui.
  banco.lavori.invia(idProgetto, "Ci sei?");
  assert.equal(banco.conversazioniLocali[0]?.annotazioni.length, 0);
});

test("se le prove non passano al proprietario non viene chiesto nulla", async (t) => {
  const { banco, idProgetto, diTipo } = await conSviluppo(t, { pronta: false, motivo: 'Il passo "test" non è riuscito:\n1 test fallito' });
  const esito = await banco.comuniDelProgetto(idProgetto, "chiedi_installazione", { riassunto: "Un pulsante." });
  assert.equal(esito.errore, true);
  assert.match(esito.testo, /al proprietario non è stato chiesto nulla/);
  assert.match(esito.testo, /1 test fallito/);
  assert.equal(diTipo("installazione-richiesta").length, 0);
  assert.equal(banco.sviluppo?.inAttesa, 0);
});

test("solo il progetto Shinka può chiedere un'installazione, e con un riassunto", async (t) => {
  const { banco, idProgetto, preparazioni } = await conSviluppo(t);
  const altro = await banco.lavori.crea("Altro", ID_AMBIENTE_DEL_CENTRO, "Un progetto qualunque.");
  const daAltro = await banco.comuniDelProgetto(altro.id, "chiedi_installazione", { riassunto: "Ci provo." });
  assert.equal(daAltro.errore, true);
  assert.match(daAltro.testo, /Solo il progetto Shinka/);
  const dallaHome = await banco.comuniDellaHome("chiedi_installazione", { riassunto: "Ci provo." });
  assert.equal(dallaHome.errore, true);
  const senza = await banco.comuniDelProgetto(idProgetto, "chiedi_installazione", { riassunto: "   " });
  assert.equal(senza.errore, true);
  assert.match(senza.testo, /Serve il riassunto/);
  assert.deepEqual(preparazioni, []);
});

test("senza lo sviluppo di Shinka lo strumento e le rotte dicono che non c'è", async (t) => {
  const banco = await allestisci(t);
  const progetto = await banco.lavori.crea("Altro", ID_AMBIENTE_DEL_CENTRO, "Un progetto qualunque.");
  const esito = await banco.comuniDelProgetto(progetto.id, "chiedi_installazione", { riassunto: "Ci provo." });
  assert.equal(esito.errore, true);
  assert.match(esito.testo, /lo sviluppo di Shinka non è acceso/);
  const cookies = { [COOKIE_SESSIONE]: await banco.entra() };
  assert.equal((await banco.centro.inject({ method: "POST", url: "/api/sviluppo/installazioni/x", cookies, payload: { decisione: "approvata" } })).statusCode, 404);
  assert.equal((await banco.centro.inject({ method: "POST", url: "/api/sviluppo/proposte/x", cookies, payload: { esito: "confermata" } })).statusCode, 404);
});

test("senza guardiano le prove si fanno, ma la versione non si installa da qui", async (t) => {
  const { banco, idProgetto, diTipo, preparazioni } = await conSviluppo(t, PRONTA, { guardiano: false });
  const esito = await banco.comuniDelProgetto(idProgetto, "chiedi_installazione", { riassunto: "Un pulsante." });
  assert.equal(esito.errore, undefined);
  assert.match(esito.testo, /non può mettere in funzione una versione da sola/);
  assert.equal(preparazioni.length, 1);
  assert.equal(diTipo("installazione-richiesta").length, 0);
  assert.equal(banco.sviluppo?.puoInstallare, false);
});

test("dopo il riavvio il centro dice una volta sola com'è finita l'installazione", async (t) => {
  const { banco, sviluppo, idProgetto, diTipo } = await conSviluppo(t);
  const quando = new Date().toISOString();
  // Niente da riferire finché non c'è stata un'installazione.
  await sviluppo.riferisci();
  assert.equal(diTipo("installazione-conclusa").length, 0);

  await scriviInstallazione(banco.fileInstallazione, { fase: "confermata", versione: VERSIONE, riassunto: "Un pulsante.", quando, precedente: "/dove/era" });
  await sviluppo.riferisci();
  assert.deepEqual(diTipo("installazione-conclusa"), [{ tipo: "installazione-conclusa", versione: "01234567", esito: "installata" }]);
  assert.equal(leggiInstallazione(banco.fileInstallazione)?.riferita, true);
  await sviluppo.riferisci();
  assert.equal(diTipo("installazione-conclusa").length, 1);
  banco.lavori.invia(idProgetto, "Com'è andata?");
  assert.match(banco.conversazioniLocali[0]?.annotazioni[0] ?? "", /^\[Shinka\] La versione 01234567 è stata installata/);

  await scriviInstallazione(banco.fileInstallazione, { fase: "tornata-indietro", versione: VERSIONE, riassunto: "Un pulsante.", quando, motivo: "si è spenta da sola (1)" });
  await sviluppo.riferisci();
  assert.deepEqual(diTipo("installazione-conclusa")[1], {
    tipo: "installazione-conclusa",
    versione: "01234567",
    esito: "tornata-indietro",
    motivo: "si è spenta da sola (1)",
  });
  banco.lavori.invia(idProgetto, "E adesso?");
  assert.match(banco.conversazioniLocali[0]?.annotazioni[1] ?? "", /non è partita \(si è spenta da sola \(1\)\): Shinka è tornata da sola alla versione di prima/);
});

/** Un gateway finto per lo sviluppo: ricorda che cosa gli viene proposto, e risponde ciò che il test decide. */
function gatewayFinto(esito: "uguale" | "chiesto" | "non-accolto", avviso?: string) {
  const proposti: string[] = [];
  const preparate: string[] = [];
  return {
    proposti,
    preparate,
    porta: {
      avviso: async (nuova: string) => {
        preparate.push(nuova);
        return avviso;
      },
      proponi: async (riassunto: string) => {
        proposti.push(riassunto);
        return { testo: `Il gateway dice: ${esito}.`, esito, ...(esito === "non-accolto" ? { errore: true as const } : {}) };
      },
    },
  };
}

test("dopo un'installazione riuscita la versione viene proposta anche al gateway, e il progetto sa che cosa ha risposto", async (t) => {
  const gateway = gatewayFinto("chiesto", "Cambia anche il gateway: dopo l'installazione sarà lui a chiederti il sì.");
  const { banco, sviluppo, idProgetto, diTipo, preparazioni } = await conSviluppo(t, PRONTA, { gateway: gateway.porta });

  // La scheda dice del gateway ciò che dice chi sa se la sua parte cambia.
  await banco.comuniDelProgetto(idProgetto, "chiedi_installazione", { riassunto: "Il gateway impara una cosa nuova." });
  assert.deepEqual(diTipo("installazione-richiesta")[0]?.avvisi, ["Cambia anche il gateway: dopo l'installazione sarà lui a chiederti il sì."]);
  assert.deepEqual(gateway.preparate, preparazioni);
  // Finché la versione non è in funzione al gateway non si propone nulla.
  assert.deepEqual(gateway.proposti, []);

  const stato = { versione: VERSIONE, riassunto: "Il gateway impara una cosa nuova.", quando: new Date().toISOString() };
  await scriviInstallazione(banco.fileInstallazione, { fase: "confermata", ...stato });
  await sviluppo.riferisci();
  assert.deepEqual(gateway.proposti, ["Il gateway impara una cosa nuova."]);
  await sviluppo.riferisci();
  assert.equal(gateway.proposti.length, 1);
  banco.lavori.invia(idProgetto, "Com'è andata?");
  assert.match(
    banco.conversazioniLocali[0]?.annotazioni[0] ?? "",
    /^\[Shinka\] La versione 01234567 è stata installata, ed è quella in funzione adesso\.\n\[Shinka\] Gateway: Il gateway dice: chiesto\.$/,
  );

  // Una versione tornata indietro non si propone a nessuno.
  await scriviInstallazione(banco.fileInstallazione, { fase: "tornata-indietro", ...stato, motivo: "si è spenta da sola (1)" });
  await sviluppo.riferisci();
  assert.equal(gateway.proposti.length, 1);
});

test("se per il gateway non cambia nulla il progetto non viene disturbato; riproporre la versione è solo del progetto Shinka", async (t) => {
  const gateway = gatewayFinto("uguale");
  const { banco, sviluppo, idProgetto, diTipo } = await conSviluppo(t, PRONTA, { gateway: gateway.porta });
  await banco.comuniDelProgetto(idProgetto, "chiedi_installazione", { riassunto: "Un pulsante." });
  assert.deepEqual(diTipo("installazione-richiesta")[0]?.avvisi, []);
  await scriviInstallazione(banco.fileInstallazione, { fase: "confermata", versione: VERSIONE, riassunto: "Un pulsante.", quando: new Date().toISOString() });
  await sviluppo.riferisci();
  assert.deepEqual(gateway.proposti, ["Un pulsante."]);
  banco.lavori.invia(idProgetto, "Com'è andata?");
  assert.doesNotMatch(banco.conversazioniLocali[0]?.annotazioni[0] ?? "", /Gateway/);

  // Lo strumento: solo dal progetto Shinka, e con un riassunto.
  const riproposta = await banco.comuniDelProgetto(idProgetto, "aggiorna_gateway", { riassunto: " Di nuovo. " });
  assert.deepEqual(riproposta, { testo: "Il gateway dice: uguale." });
  assert.deepEqual(gateway.proposti, ["Un pulsante.", "Di nuovo."]);
  const altro = await banco.lavori.crea("Altro", ID_AMBIENTE_DEL_CENTRO, "Un progetto qualunque.");
  const daAltro = await banco.comuniDelProgetto(altro.id, "aggiorna_gateway", { riassunto: "Ci provo." });
  assert.match(daAltro.errore === true ? daAltro.testo : "", /Solo il progetto Shinka/);
  assert.equal((await banco.comuniDellaHome("aggiorna_gateway", { riassunto: "Ci provo." })).errore, true);
  const senza = await banco.comuniDelProgetto(idProgetto, "aggiorna_gateway", { riassunto: "  " });
  assert.match(senza.errore === true ? senza.testo : "", /Serve il riassunto/);
  assert.equal(gateway.proposti.length, 2);
});

test("senza un gateway lo strumento per proporgli la versione lo dice", async (t) => {
  const { banco, idProgetto } = await conSviluppo(t);
  const esito = await banco.comuniDelProgetto(idProgetto, "aggiorna_gateway", { riassunto: "Ci provo." });
  assert.match(esito.errore === true ? esito.testo : "", /il gateway non è configurato/);
  const senzaSviluppo = await allestisci(t);
  const progetto = await senzaSviluppo.lavori.crea("Altro", ID_AMBIENTE_DEL_CENTRO, "Un progetto qualunque.");
  const spento = await senzaSviluppo.comuniDelProgetto(progetto.id, "aggiorna_gateway", { riassunto: "Ci provo." });
  assert.match(spento.errore === true ? spento.testo : "", /lo sviluppo di Shinka non è acceso/);
});

test("il centro aspetta che il guardiano confermi la versione prima di riferire", async (t) => {
  const { banco, sviluppo, diTipo } = await conSviluppo(t, PRONTA, { attesaEsitoMs: 3_000 });
  const stato = { versione: VERSIONE, riassunto: "Un pulsante.", quando: new Date().toISOString() };
  await scriviInstallazione(banco.fileInstallazione, { fase: "in-prova", ...stato });
  const riferito = sviluppo.riferisci();
  await new Promise((fatto) => setTimeout(fatto, 100));
  assert.equal(diTipo("installazione-conclusa").length, 0);
  await scriviInstallazione(banco.fileInstallazione, { fase: "confermata", ...stato });
  await riferito;
  assert.equal(diTipo("installazione-conclusa")[0]?.esito, "installata");
  assert.ok(existsSync(banco.fileInstallazione));
});

test("le impostazioni scelte nella scheda valgono solo per quel lavoro, poi tornano quelle di sempre", async (t) => {
  const { banco, sviluppo, idProgetto, manda, canale } = await conSviluppo(t);
  const salvate = banco.lavori.impostazioni(idProgetto);
  const mostrate = () => {
    const ultimo = canale.ricordato("impostazioni");
    return ultimo?.tipo === "impostazioni" ? ultimo.impostazioni : undefined;
  };
  // La scheda dice da quali impostazioni si parte.
  const idProposta = sviluppo.proponi({ titolo: "Tema scuro", richiesta: "Serve un tema scuro." });
  const proposta = eventiDellaHome(banco).find((evento) => evento.tipo === "sviluppo-proposto");
  assert.ok(proposta?.tipo === "sviluppo-proposto");
  assert.deepEqual(proposta.impostazioni, salvate);

  const confermata = await manda(`/api/sviluppo/proposte/${idProposta}`, { esito: "confermata", modello: "opus", impegno: "max", permessi: "modifiche-libere" });
  assert.equal(confermata.statusCode, 200);
  const scelte = { modello: "opus", impegno: "max", permessi: "modifiche-libere" };
  await finche(() => banco.conversazioniLocali[0]?.inviati.length === 1, "la richiesta arriva al progetto Shinka");
  const conversazione = banco.conversazioniLocali[0];
  assert.ok(conversazione);
  // Il lavoro parte con le scelte della scheda, e la chat del progetto le mostra.
  assert.deepEqual(banco.lavori.impostazioniInUso(idProgetto), scelte);
  assert.deepEqual(conversazione.impostazioni.at(-1), scelte);
  assert.deepEqual(mostrate(), scelte);
  const decisa = eventiDellaHome(banco).find((evento) => evento.tipo === "sviluppo-deciso");
  assert.ok(decisa?.tipo === "sviluppo-deciso");
  assert.deepEqual(decisa.impostazioni, scelte);
  assert.equal(decisa.soloPerQuestoLavoro, true);
  // Le impostazioni di sempre non cambiano.
  assert.deepEqual(banco.lavori.impostazioni(idProgetto), salvate);

  // Finito il lavoro, il progetto torna a quelle di sempre.
  conversazione.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 10 });
  assert.deepEqual(banco.lavori.impostazioniInUso(idProgetto), salvate);
  assert.deepEqual(conversazione.impostazioni.at(-1), salvate);
  assert.deepEqual(mostrate(), salvate);
});

test("senza cambiare nulla nella scheda il lavoro usa le impostazioni di sempre", async (t) => {
  const { banco, sviluppo, idProgetto, manda } = await conSviluppo(t);
  const salvate = banco.lavori.impostazioni(idProgetto);
  const idProposta = sviluppo.proponi({ titolo: "Tema scuro", richiesta: "Serve un tema scuro." });
  // Anche mandando gli stessi valori di adesso, non è una scelta per un lavoro solo.
  assert.equal((await manda(`/api/sviluppo/proposte/${idProposta}`, { esito: "confermata", permessi: salvate.permessi })).statusCode, 200);
  const decisa = eventiDellaHome(banco).find((evento) => evento.tipo === "sviluppo-deciso");
  assert.ok(decisa?.tipo === "sviluppo-deciso");
  assert.deepEqual(decisa.impostazioni, salvate);
  assert.equal(decisa.soloPerQuestoLavoro, undefined);
  assert.deepEqual(banco.conversazioniLocali[0]?.impostazioni ?? [], []);
  // Valori che non esistono non passano.
  const altra = sviluppo.proponi({ titolo: "Altro", richiesta: "Altro." });
  assert.equal((await manda(`/api/sviluppo/proposte/${altra}`, { esito: "confermata", impegno: "infinito" })).statusCode, 400);
});

test("una scelta fatta a mano durante il lavoro diventa quella di sempre", async (t) => {
  const { banco, sviluppo, idProgetto, manda } = await conSviluppo(t);
  const idProposta = sviluppo.proponi({ titolo: "Tema scuro", richiesta: "Serve un tema scuro." });
  await manda(`/api/sviluppo/proposte/${idProposta}`, { esito: "confermata", modello: "opus" });
  await banco.lavori.cambiaImpostazioni(idProgetto, { impegno: "high" });
  // La scelta a mano parte da quelle di sempre, e resta anche dopo il lavoro.
  assert.equal(banco.lavori.impostazioni(idProgetto).impegno, "high");
  assert.equal(banco.lavori.impostazioniInUso(idProgetto).modello, banco.lavori.impostazioni(idProgetto).modello);
  banco.conversazioniLocali[0]?.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 10 });
  assert.equal(banco.lavori.impostazioniInUso(idProgetto).impegno, "high");
});
