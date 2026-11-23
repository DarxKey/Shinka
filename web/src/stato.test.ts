import assert from "node:assert/strict";
import { test } from "node:test";
import type { EventoConversazione } from "../../src/protocollo/eventi.ts";
import { alLavoro, applica, statoIniziale, type StatoChat } from "./stato.ts";

function dopo(eventi: EventoConversazione[]): StatoChat {
  return eventi.reduce(applica, statoIniziale);
}

test("domanda e risposta a frammenti diventano due righe", () => {
  const stato = dopo([
    { tipo: "messaggio-proprietario", id: "m1", testo: "Capitale del Giappone?" },
    { tipo: "turno-iniziato" },
    { tipo: "testo-iniziato", idTesto: "t1" },
    { tipo: "testo-frammento", idTesto: "t1", frammento: "Tok" },
    { tipo: "testo-frammento", idTesto: "t1", frammento: "yo." },
  ]);
  assert.equal(alLavoro(stato), true);
  assert.deepEqual(stato.elementi, [
    { tipo: "proprietario", chiave: "m1", testo: "Capitale del Giappone?" },
    { tipo: "testo", chiave: "t1", testo: "Tokyo.", concluso: false },
  ]);

  const fine: EventoConversazione[] = [
    { tipo: "testo-concluso", idTesto: "t1", testo: "Tokyo." },
    { tipo: "turno-concluso", riuscito: true, durataMs: 900 },
  ];
  const finito = fine.reduce(applica, stato);
  assert.equal(alLavoro(finito), false);
  assert.deepEqual(finito.elementi.at(-1), { tipo: "testo", chiave: "t1", testo: "Tokyo.", concluso: true });
});

test("chi ricarica la pagina vede il testo intero anche senza frammenti", () => {
  const stato = dopo([
    { tipo: "testo-iniziato", idTesto: "t1" },
    { tipo: "testo-concluso", idTesto: "t1", testo: "Tokyo." },
  ]);
  assert.deepEqual(stato.elementi, [{ tipo: "testo", chiave: "t1", testo: "Tokyo.", concluso: true }]);
});

test("un blocco di testo rimasto vuoto non lascia righe", () => {
  const stato = dopo([
    { tipo: "testo-iniziato", idTesto: "t1" },
    { tipo: "testo-concluso", idTesto: "t1", testo: "" },
  ]);
  assert.deepEqual(stato.elementi, []);
});

test("un'azione passa da iniziata a conclusa con il suo esito", () => {
  const stato = dopo([
    { tipo: "azione-iniziata", idAzione: "a1", strumento: "Bash", ingresso: { command: "date" } },
    { tipo: "azione-conclusa", idAzione: "a1", esito: "lun 10 nov", errore: false },
  ]);
  assert.deepEqual(stato.elementi, [
    {
      tipo: "azione",
      chiave: "a1",
      strumento: "Bash",
      ingresso: { command: "date" },
      conclusa: true,
      esito: "lun 10 nov",
      errore: false,
    },
  ]);
});

test("la richiesta di permesso si aggancia all'azione e poi registra la decisione", () => {
  const richiesta: EventoConversazione = {
    tipo: "permesso-richiesto",
    idPermesso: "a1",
    idAzione: "a1",
    strumento: "Bash",
    ingresso: { command: "date" },
    motivo: "Comando da approvare",
  };
  const inAttesa = dopo([
    { tipo: "azione-iniziata", idAzione: "a1", strumento: "Bash", ingresso: { command: "date" } },
    richiesta,
  ]);
  assert.equal(inAttesa.elementi.length, 1);
  const azione = inAttesa.elementi[0];
  assert.ok(azione?.tipo === "azione");
  assert.deepEqual(azione.permesso, { id: "a1", stato: "in-attesa", motivo: "Comando da approvare" });

  const deciso = applica(inAttesa, { tipo: "permesso-deciso", idPermesso: "a1", decisione: "negato" });
  const dopoDecisione = deciso.elementi[0];
  assert.ok(dopoDecisione?.tipo === "azione" && dopoDecisione.permesso?.stato === "negato");
});

test("una richiesta di permesso che arriva prima dell'azione non crea un doppione", () => {
  const stato = dopo([
    {
      tipo: "permesso-richiesto",
      idPermesso: "a1",
      idAzione: "a1",
      strumento: "Bash",
      ingresso: { command: "date" },
    },
    { tipo: "azione-iniziata", idAzione: "a1", strumento: "Bash", ingresso: { command: "date" } },
  ]);
  assert.equal(stato.elementi.length, 1);
  const azione = stato.elementi[0];
  assert.ok(azione?.tipo === "azione" && azione.permesso?.stato === "in-attesa");
});

test("un turno fallito mostra il motivo una volta sola", () => {
  const stato = dopo([
    { tipo: "turno-iniziato" },
    { tipo: "errore", messaggio: "Non autenticato." },
    { tipo: "errore", messaggio: "Non autenticato." },
    { tipo: "turno-concluso", riuscito: false, durataMs: 3, errore: "Non autenticato." },
  ]);
  assert.equal(alLavoro(stato), false);
  assert.deepEqual(stato.elementi.map((e) => e.tipo), ["avviso"]);
});

test("una risposta interrotta dal proprietario lascia una nota, non un avviso", () => {
  const stato = dopo([
    { tipo: "turno-iniziato" },
    { tipo: "testo-iniziato", idTesto: "t1" },
    { tipo: "testo-frammento", idTesto: "t1", frammento: "C'era una volta" },
    { tipo: "testo-concluso", idTesto: "t1", testo: "C'era una volta" },
    { tipo: "turno-concluso", riuscito: true, durataMs: 3, interrotto: true },
  ]);
  assert.equal(alLavoro(stato), false);
  assert.deepEqual(stato.elementi.map((e) => e.tipo), ["testo", "nota"]);
});

test("una proposta di progetto resta in attesa finché il proprietario non decide", () => {
  const proposta: EventoConversazione = {
    tipo: "proposta-progetto",
    idProposta: "p1",
    nome: "Videogioco",
    idAmbiente: "centro",
    brief: "Un gioco di piattaforme.",
  };
  const inAttesa = dopo([proposta, proposta]);
  assert.deepEqual(inAttesa.elementi, [
    { tipo: "proposta", chiave: "p1", nome: "Videogioco", idAmbiente: "centro", brief: "Un gioco di piattaforme." },
  ]);

  const confermata = applica(inAttesa, {
    tipo: "proposta-decisa",
    idProposta: "p1",
    esito: "confermata",
    idProgetto: "progetto-7",
    nome: "Gioco spaziale",
  });
  assert.deepEqual(confermata.elementi, [
    {
      tipo: "proposta",
      chiave: "p1",
      nome: "Videogioco",
      idAmbiente: "centro",
      brief: "Un gioco di piattaforme.",
      esito: "confermata",
      idProgetto: "progetto-7",
      nomeProgetto: "Gioco spaziale",
    },
  ]);

  const annullata = applica(inAttesa, { tipo: "proposta-decisa", idProposta: "p1", esito: "annullata" });
  const elemento = annullata.elementi[0];
  assert.ok(elemento?.tipo === "proposta" && elemento.esito === "annullata" && elemento.idProgetto === undefined);
});

test("l'ordine di spostarsi su un progetto non lascia traccia nella conversazione", () => {
  const prima = dopo([{ tipo: "messaggio-proprietario", id: "m1", testo: "Apri il videogioco" }]);
  assert.equal(applica(prima, { tipo: "apri-progetto", idProgetto: "progetto-7" }), prima);
});

test("un turno interrotto chiude il testo rimasto a metà", () => {
  const stato = dopo([
    { tipo: "turno-iniziato" },
    { tipo: "testo-iniziato", idTesto: "t1" },
    { tipo: "testo-frammento", idTesto: "t1", frammento: "Stavo dicendo" },
    { tipo: "turno-concluso", riuscito: true, durataMs: 3 },
  ]);
  assert.deepEqual(stato.elementi, [
    { tipo: "testo", chiave: "t1", testo: "Stavo dicendo", concluso: true },
  ]);
});

test("la domanda su dove lavorare resta aperta finché il proprietario non scrive", () => {
  const chiesto = dopo([
    { tipo: "messaggio-proprietario", id: "m1", testo: "Fammi un sito per il club." },
    { tipo: "scelta-richiesta", idScelta: "s1", lavoro: "Un sito per il club di scacchi" },
    // La stessa domanda rimandata dal centro non si raddoppia.
    { tipo: "scelta-richiesta", idScelta: "s1", lavoro: "Un sito per il club di scacchi" },
  ]);
  assert.deepEqual(chiesto.elementi.at(-1), {
    tipo: "scelta",
    chiave: "s1",
    lavoro: "Un sito per il club di scacchi",
    superata: false,
  });
  assert.equal(chiesto.elementi.length, 2);

  const risposto = applica(chiesto, { tipo: "messaggio-proprietario", id: "m2", testo: "Apri un progetto." });
  assert.deepEqual(
    risposto.elementi.map((e) => (e.tipo === "scelta" ? e.superata : e.tipo)),
    ["proprietario", true, "proprietario"],
  );
});

test("il passaggio da un argomento all'altro si vede dove avviene", () => {
  const vecchio = dopo([
    { tipo: "messaggio-proprietario", id: "m1", testo: "Che tempo fa domani?" },
    { tipo: "scelta-richiesta", idScelta: "s1", lavoro: "Un sito" },
    { tipo: "argomento-archiviato", titolo: "Rinominare le foto", proseguito: true },
  ]);
  assert.deepEqual(vecchio.elementi.slice(1), [
    { tipo: "scelta", chiave: "s1", lavoro: "Un sito", superata: true },
    { tipo: "archiviato", chiave: "archiviato-2", titolo: "Rinominare le foto", proseguito: true },
  ]);

  const nuovo = dopo([
    { tipo: "passaggio-argomento", riaperto: false, archiviato: { id: "2026-11-11-3fa9c1", titolo: "Rinominare le foto" } },
    { tipo: "messaggio-proprietario", id: "m1", testo: "Che tempo fa domani?" },
    { tipo: "passaggio-argomento", riaperto: true },
  ]);
  assert.deepEqual(nuovo.elementi, [
    {
      tipo: "passaggio",
      chiave: "passaggio-0",
      riaperto: false,
      archiviato: { id: "2026-11-11-3fa9c1", titolo: "Rinominare le foto" },
    },
    { tipo: "proprietario", chiave: "m1", testo: "Che tempo fa domani?" },
    { tipo: "passaggio", chiave: "passaggio-2", riaperto: true },
  ]);
});

test("una proposta ricorda i file dell'argomento e quanti ne ha portati il progetto", () => {
  const file = [{ idAmbiente: "pc", percorsi: ["sito/index.html"], quanti: 1 }];
  const proposta = dopo([{ tipo: "proposta-progetto", idProposta: "p1", nome: "Sito", idAmbiente: "pc", brief: "Un sito.", file }]);
  assert.deepEqual(proposta.elementi, [
    { tipo: "proposta", chiave: "p1", nome: "Sito", idAmbiente: "pc", brief: "Un sito.", file },
  ]);
  const decisa = applica(proposta, {
    tipo: "proposta-decisa",
    idProposta: "p1",
    esito: "confermata",
    idProgetto: "g1",
    nome: "Sito",
    filePortati: 1,
  });
  assert.partialDeepStrictEqual(decisa.elementi[0], { esito: "confermata", idProgetto: "g1", filePortati: 1 });
});

test("lo stato del progetto è l'ultimo arrivato, e non è una riga della conversazione", () => {
  const stato = dopo([
    { tipo: "stato-progetto", testo: "Fatto il personaggio." },
    { tipo: "stato-progetto", testo: "Fatto il personaggio e il primo livello." },
  ]);
  assert.equal(stato.statoProgetto, "Fatto il personaggio e il primo livello.");
  assert.deepEqual(stato.elementi, []);
});

test("un evento sconosciuto a questa versione dell'interfaccia non cambia nulla", () => {
  const prima = dopo([{ tipo: "messaggio-proprietario", id: "m1", testo: "Ciao" }]);
  const evento = { tipo: "mai-sentito" } as unknown as EventoConversazione;
  assert.equal(applica(prima, evento), prima);
});

test("un comando da approvare diventa una scheda, che poi dice com'è finita", () => {
  const richiesta: EventoConversazione = {
    tipo: "approvazione-richiesta",
    idApprovazione: "ap1",
    host: "192.168.1.20:22",
    credenziale: "nas",
    comando: "docker stop plex",
    scadeIl: "2026-11-12T18:05:00.000Z",
  };
  const inAttesa = dopo([
    { tipo: "azione-iniziata", idAzione: "a1", strumento: "mcp__shinka__esegui_su_host", ingresso: { comando: "docker stop plex" } },
    richiesta,
    // Chi si ricollega riceve la storia un'altra volta: la scheda resta una.
    richiesta,
  ]);
  assert.deepEqual(inAttesa.elementi.at(-1), {
    tipo: "approvazione",
    chiave: "ap1",
    host: "192.168.1.20:22",
    credenziale: "nas",
    comando: "docker stop plex",
    scadeIl: "2026-11-12T18:05:00.000Z",
  });
  assert.equal(inAttesa.elementi.length, 2);

  const negata = applica(inAttesa, { tipo: "approvazione-decisa", idApprovazione: "ap1", esito: "negata" });
  const scheda = negata.elementi.at(-1);
  assert.ok(scheda?.tipo === "approvazione" && scheda.esito === "negata");
  // Una decisione su una scheda che non c'è non cambia nulla.
  assert.deepEqual(applica(inAttesa, { tipo: "approvazione-decisa", idApprovazione: "altra", esito: "approvata" }), inAttesa);
});

test("un comando sul server di Shinka diventa una scheda che ricorda che il sì si dà al gateway", () => {
  const alGateway = dopo([
    {
      tipo: "approvazione-richiesta",
      idApprovazione: "ap2",
      host: "192.168.1.20:22",
      credenziale: "unraid",
      comando: "docker restart shinka",
      scadeIl: "2026-11-13T18:05:00.000Z",
      alGateway: true,
    },
  ]);
  const scheda = alGateway.elementi.at(-1);
  assert.ok(scheda?.tipo === "approvazione" && scheda.alGateway === true && scheda.esito === undefined);
  const approvata = applica(alGateway, { tipo: "approvazione-decisa", idApprovazione: "ap2", esito: "approvata" }).elementi.at(-1);
  assert.ok(approvata?.tipo === "approvazione" && approvata.alGateway === true && approvata.esito === "approvata");
});

test("un messaggio scritto da Telegram resta riconoscibile nella chat", () => {
  const stato = dopo([
    { tipo: "messaggio-proprietario", id: "m1", testo: "Aggiornami sui progetti", origine: "telegram" },
    { tipo: "messaggio-proprietario", id: "m2", testo: "E questo dall'interfaccia" },
  ]);
  assert.deepEqual(stato.elementi, [
    { tipo: "proprietario", daTelegram: true, chiave: "m1", testo: "Aggiornami sui progetti" },
    { tipo: "proprietario", chiave: "m2", testo: "E questo dall'interfaccia" },
  ]);
});

test("una proposta di sviluppo di Shinka diventa una scheda, che poi dice com'è finita", () => {
  const proposta: EventoConversazione = { tipo: "sviluppo-proposto", idProposta: "s1", titolo: "Tema scuro", richiesta: "Serve un tema scuro." };
  const inAttesa = dopo([proposta, proposta]);
  assert.deepEqual(inAttesa.elementi, [{ tipo: "sviluppo", chiave: "s1", titolo: "Tema scuro", richiesta: "Serve un tema scuro." }]);

  const confermata = applica(inAttesa, { tipo: "sviluppo-deciso", idProposta: "s1", esito: "confermata", idProgetto: "p1" });
  assert.deepEqual(confermata.elementi.at(-1), {
    tipo: "sviluppo",
    chiave: "s1",
    titolo: "Tema scuro",
    richiesta: "Serve un tema scuro.",
    esito: "confermata",
    idProgetto: "p1",
  });
  const annullata = applica(inAttesa, { tipo: "sviluppo-deciso", idProposta: "s1", esito: "annullata" });
  const scheda = annullata.elementi.at(-1);
  assert.ok(scheda?.tipo === "sviluppo" && scheda.esito === "annullata" && scheda.idProgetto === undefined);
});

test("una versione da installare diventa una scheda, e dopo il riavvio si legge com'è andata", () => {
  const richiesta: EventoConversazione = {
    tipo: "installazione-richiesta",
    idInstallazione: "i1",
    versione: "01234567",
    riassunto: "Aggiunge il tema scuro.",
    modifiche: ["Aggiunge il tema scuro"],
    file: ["web/src/stile.css"],
    quantiFile: 1,
    avvisi: [],
    scadeIl: "2026-11-12T19:00:00.000Z",
  };
  const inAttesa = dopo([richiesta, richiesta]);
  assert.equal(inAttesa.elementi.length, 1);
  const scheda = inAttesa.elementi[0];
  assert.ok(scheda?.tipo === "installazione" && scheda.esito === undefined && scheda.versione === "01234567");

  const approvata = applica(inAttesa, { tipo: "installazione-decisa", idInstallazione: "i1", esito: "approvata" });
  const decisa = approvata.elementi[0];
  assert.ok(decisa?.tipo === "installazione" && decisa.esito === "approvata");

  const ripartita = applica(approvata, { tipo: "installazione-conclusa", versione: "01234567", esito: "installata" });
  assert.deepEqual(ripartita.elementi.at(-1), { tipo: "installata", chiave: "installata-1", versione: "01234567", riuscita: true });
  const tornata = applica(approvata, { tipo: "installazione-conclusa", versione: "01234567", esito: "tornata-indietro", motivo: "non ha risposto in tempo" });
  assert.deepEqual(tornata.elementi.at(-1), {
    tipo: "installata",
    chiave: "installata-1",
    versione: "01234567",
    riuscita: false,
    motivo: "non ha risposto in tempo",
  });
});

test("la proposta di un'estensione è una scheda che resta in attesa finché non è decisa e provata", () => {
  const proposta: EventoConversazione = {
    tipo: "estensione-proposta",
    idProposta: "e1",
    nome: "meteo",
    descrizione: "Dice che tempo fa.",
    definizione: { tipo: "mcp-locale", comando: "npx", argomenti: ["-y", "meteo-mcp"], variabili: {} },
    chiavi: ["METEO_TOKEN"],
    idAmbiente: "centro",
    nomeAmbiente: "Unraid",
    avvisi: ["È un programma di terzi."],
  };
  const inAttesa = dopo([proposta, proposta]);
  // Lo stesso evento arrivato due volte non fa due schede.
  assert.equal(inAttesa.elementi.length, 1);
  assert.deepEqual(inAttesa.elementi[0], {
    tipo: "estensione",
    chiave: "e1",
    nome: "meteo",
    descrizione: "Dice che tempo fa.",
    definizione: { tipo: "mcp-locale", comando: "npx", argomenti: ["-y", "meteo-mcp"], variabili: {} },
    chiavi: ["METEO_TOKEN"],
    idAmbiente: "centro",
    nomeAmbiente: "Unraid",
    avvisi: ["È un programma di terzi."],
  });
  // Una scheda in attesa non fa risultare Claude al lavoro.
  assert.equal(alLavoro(inAttesa), false);

  const accesa = applica(inAttesa, { tipo: "estensione-decisa", idProposta: "e1", esito: "accesa", strumenti: ["saluta"] });
  const scheda = accesa.elementi[0];
  assert.ok(scheda?.tipo === "estensione" && scheda.esito === "accesa");
  assert.deepEqual(scheda.strumenti, ["saluta"]);

  const nonPartita = applica(inAttesa, { tipo: "estensione-decisa", idProposta: "e1", esito: "non-partita", motivo: "Connection closed" });
  const rotta = nonPartita.elementi[0];
  assert.ok(rotta?.tipo === "estensione" && rotta.esito === "non-partita" && rotta.motivo === "Connection closed");

  const annullata = applica(inAttesa, { tipo: "estensione-decisa", idProposta: "e1", esito: "annullata" });
  const chiusa = annullata.elementi[0];
  assert.ok(chiusa?.tipo === "estensione" && chiusa.esito === "annullata" && chiusa.strumenti === undefined);

  // Di un plugin la scheda porta anche ciò che contiene, e dice se è già nell'elenco.
  const plugin = dopo([
    {
      ...proposta,
      idProposta: "e2",
      definizione: { tipo: "plugin", repository: "https://esempio.it/plugin.git", commit: "0123456789abcdef0123456789abcdef01234567" },
      chiavi: [],
      contenuto: { skill: ["saluta"], comandi: [], agenti: [], agganci: [], server: [], altro: [] },
      giaInElenco: true,
    },
  ]).elementi[0];
  assert.ok(plugin?.tipo === "estensione" && plugin.giaInElenco === true);
  assert.deepEqual(plugin.contenuto?.skill, ["saluta"]);
});

test("un elaborato mostrato dalla Home diventa una scheda nella chat", () => {
  const stato = dopo([
    { tipo: "turno-iniziato" },
    {
      tipo: "elaborato-mostrato",
      idArgomento: "a1",
      idAmbiente: "centro",
      nomeAmbiente: "Unraid",
      percorso: "tokyo/mappa.html",
      titolo: "Mappa dei negozi",
    },
    { tipo: "elaborato-mostrato", idArgomento: "a1", idAmbiente: "centro", nomeAmbiente: "Unraid", percorso: "itinerario.md" },
  ]);
  assert.deepEqual(stato.elementi, [
    {
      tipo: "elaborato",
      chiave: "elaborato-0",
      idArgomento: "a1",
      idAmbiente: "centro",
      nomeAmbiente: "Unraid",
      percorso: "tokyo/mappa.html",
      titolo: "Mappa dei negozi",
    },
    { tipo: "elaborato", chiave: "elaborato-1", idArgomento: "a1", idAmbiente: "centro", nomeAmbiente: "Unraid", percorso: "itinerario.md" },
  ]);
});

test("una proposta su una cartella che esiste già porta il percorso e, decisa, dice dove è nato il progetto", () => {
  const stato = dopo([
    {
      tipo: "proposta-progetto",
      idProposta: "p1",
      nome: "Rougue AFK",
      idAmbiente: "pc",
      brief: "Portaluce",
      cartellaEsistente: "C:\\Users\\mario\\Progetti\\Gioco vecchio",
      avvisoCartella: "Non è un repository Git.",
    },
    {
      tipo: "proposta-decisa",
      idProposta: "p1",
      esito: "confermata",
      idProgetto: "x",
      nome: "Rougue AFK",
      cartellaAdottata: { percorso: "C:\\Users\\mario\\Progetti\\Gioco vecchio", git: false },
    },
  ]);
  const [proposta] = stato.elementi;
  assert.ok(proposta?.tipo === "proposta");
  assert.equal(proposta.cartellaEsistente, "C:\\Users\\mario\\Progetti\\Gioco vecchio");
  assert.equal(proposta.avvisoCartella, "Non è un repository Git.");
  assert.deepEqual(proposta.cartellaAdottata, { percorso: "C:\\Users\\mario\\Progetti\\Gioco vecchio", git: false });
});

test("le domande di Claude diventano una scheda al posto dell'azione, e chiuse ricordano le risposte", () => {
  const domande = [{ domanda: "Quale?", intestazione: "Scelta", opzioni: [{ etichetta: "A" }, { etichetta: "B" }], piuScelte: false }];
  let stato = applica(statoIniziale, { tipo: "azione-iniziata", idAzione: "d1", strumento: "AskUserQuestion", ingresso: {} });
  stato = applica(stato, { tipo: "domande-poste", idDomande: "d1", domande });
  stato = applica(stato, { tipo: "domande-poste", idDomande: "d1", domande });
  assert.deepEqual(stato.elementi, [{ tipo: "domande", chiave: "d1", domande }]);
  stato = applica(stato, { tipo: "domande-chiuse", idDomande: "d1", esito: "risposte", risposte: ["B"] });
  stato = applica(stato, { tipo: "azione-conclusa", idAzione: "d1", esito: "fatto", errore: false });
  assert.deepEqual(stato.elementi, [{ tipo: "domande", chiave: "d1", domande, esito: "risposte", risposte: ["B"] }]);
});

test("il lavoro in background arriva con lo stato, e si aggiorna senza toccare il resto", () => {
  let stato = applica(statoIniziale, { tipo: "stato", stato: { modello: "claude-haiku-4-5" } });
  stato = applica(stato, { tipo: "stato", stato: { inSfondo: 2 } });
  assert.equal(stato.stato?.inSfondo, 2);
  assert.equal(stato.stato?.modello, "claude-haiku-4-5");
  stato = applica(stato, { tipo: "stato", stato: { inSfondo: 0 } });
  assert.equal(stato.stato?.inSfondo, 0);
});

test("le cose da fare stanno in una scheda per turno, aggiornata sul posto, con il riepilogo a turno finito", () => {
  const lista = (stati: string[]) => ({
    todos: stati.map((status, i) => ({ content: `Passo ${i + 1}`, activeForm: `Faccio il passo ${i + 1}`, status })),
  });
  let stato = applica(statoIniziale, { tipo: "turno-iniziato" });
  stato = applica(stato, { tipo: "azione-iniziata", idAzione: "t1", strumento: "TodoWrite", ingresso: lista(["in_progress", "pending"]) });
  stato = applica(stato, { tipo: "azione-conclusa", idAzione: "t1", esito: "ok", errore: false });
  stato = applica(stato, { tipo: "azione-iniziata", idAzione: "a1", strumento: "Bash", ingresso: { command: "ls" } });
  stato = applica(stato, { tipo: "azione-iniziata", idAzione: "t2", strumento: "TodoWrite", ingresso: lista(["completed", "in_progress"]) });
  const schede = stato.elementi.filter((e) => e.tipo === "cose-da-fare");
  assert.equal(schede.length, 1);
  assert.deepEqual(schede[0], {
    tipo: "cose-da-fare",
    chiave: "cose-t1",
    finito: false,
    voci: [
      { testo: "Passo 1", inCorso: "Faccio il passo 1", stato: "fatta" },
      { testo: "Passo 2", inCorso: "Faccio il passo 2", stato: "in-corso" },
    ],
  });
  // Nessuna azione per la lista: la scheda è la lista.
  assert.equal(stato.elementi.filter((e) => e.tipo === "azione").length, 1);
  stato = applica(stato, { tipo: "turno-concluso", riuscito: true, durataMs: 10 });
  assert.equal(stato.elementi.find((e) => e.tipo === "cose-da-fare")?.tipo === "cose-da-fare" && (stato.elementi.find((e) => e.tipo === "cose-da-fare") as { finito: boolean }).finito, true);
  // Il turno dopo, una lista nuova apre una scheda nuova.
  stato = applica(stato, { tipo: "azione-iniziata", idAzione: "t3", strumento: "TodoWrite", ingresso: lista(["pending"]) });
  assert.equal(stato.elementi.filter((e) => e.tipo === "cose-da-fare").length, 2);
});

test("il ragionamento diventa un elemento suo, una volta sola", () => {
  let stato = applica(statoIniziale, { tipo: "ragionamento", idRagionamento: "r1", testo: "Prima guardo." });
  stato = applica(stato, { tipo: "ragionamento", idRagionamento: "r1", testo: "Prima guardo." });
  assert.deepEqual(stato.elementi, [{ tipo: "ragionamento", chiave: "r1", testo: "Prima guardo." }]);
});

test("le modifiche di un turno diventano una scheda, e le decisioni del proprietario vi si segnano", () => {
  const file = [
    { percorso: "src/a.ts", aggiunte: 2, tolte: 1, stato: "cambiato" as const },
    { percorso: "src/b.ts", aggiunte: 4, tolte: 0, stato: "nuovo" as const },
  ];
  const stato = dopo([
    { tipo: "modifiche", idTurno: "t1", file },
    { tipo: "modifiche", idTurno: "t1", file },
    { tipo: "modifiche-decise", idTurno: "t1", percorsi: ["src/a.ts"], esito: "accettate" },
    { tipo: "modifiche-decise", idTurno: "t1", percorsi: ["src/b.ts"], esito: "annullate" },
    { tipo: "modifiche-decise", idTurno: "altro", percorsi: ["src/a.ts"], esito: "annullate" },
  ]);
  assert.deepEqual(stato.elementi, [{ tipo: "modifiche", chiave: "t1", file, decisi: { "src/a.ts": "accettate", "src/b.ts": "annullate" } }]);
});

test("le attività valgono l'ultimo elenco arrivato", () => {
  const comando = { id: "c1", genere: "comando" as const, descrizione: "Test", stato: "in-corso" as const, inSfondo: true };
  const stato = dopo([
    { tipo: "attivita", attivita: [comando] },
    { tipo: "attivita", attivita: [{ ...comando, stato: "finita" }] },
  ]);
  assert.deepEqual(stato.attivita, [{ ...comando, stato: "finita" }]);
  assert.deepEqual(stato.elementi, []);
});
