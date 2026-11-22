import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { Registro } from "../gateway/registro.ts";
import { creaGateway } from "../gateway/servizio.ts";
import { StackDiProva } from "../gateway/stack.ts";
import { Telegram } from "../gateway/telegram.ts";
import { Operazioni } from "../gateway/uso.ts";
import { Vault } from "../gateway/vault.ts";
import { allestisci, finche, type Banco, type ConversazioneFinta, type OpzioniBanco } from "../prove/banco.ts";
import { DockerDiProva } from "../prove/docker-di-prova.ts";
import { avviaHostDiProva } from "../prove/host-di-prova.ts";
import { erroreNelFormato, TelegramDiProva, type MessaggioDelBot } from "../prove/telegram-di-prova.ts";
import type { EventoConversazione } from "../protocollo/eventi.ts";
import type { DettaglioVault } from "../protocollo/vault.ts";
import { leggiInstallazione, scriviInstallazione } from "../guardiano/guardiano.ts";
import { COOKIE_SESSIONE } from "./centro.ts";
import { ClienteGateway } from "./gateway.ts";
import { azioniDellaHome } from "./strumenti-home.ts";

const FRASE = "una frase di sblocco di prova";
const PASSWORD = "P4ssword-di-prova-da-non-vedere";
const GETTONE = "gettone-di-prova-del-centro-lungo-quanto-serve";
const RECINTO = { porte: { da: 7900, a: 7999 }, radice: "/mnt/user/appdata/shinka-stack" };
const PROPRIETARIO = { id: 111, nome: "Mario", utente: "mario" };
const ESTRANEO = { id: 222, nome: "Qualcun altro" };

interface Lab {
  banco: Banco;
  finto: TelegramDiProva;
  telegram: Telegram;
  docker: DockerDiProva;
  /** L'host per gli stack, com'è scritto nel vault. */
  host: string;
  /** Il vault del gateway, aperto: per scriverci ciò che scriverebbe il proprietario. */
  vault: Vault;
  /** I messaggi del bot dopo quello che conferma l'abbinamento. */
  mandati(): MessaggioDelBot[];
  /** Aspetta che il bot abbia mandato almeno tanti messaggi, e li restituisce. */
  arrivano(quanti: number): Promise<MessaggioDelBot[]>;
}

/** Un gateway vero con il bot abbinato al proprietario, un Telegram finto, e il centro con il ponte acceso. */
async function allestisciLab(
  t: TestContext,
  opzioni: {
    tempi?: OpzioniBanco["telegram"];
    scadenzaMs?: number;
    abbinato?: boolean;
    sviluppo?: OpzioniBanco["sviluppo"];
    estensioni?: OpzioniBanco["estensioni"];
  } = {},
): Promise<Lab> {
  const finto = await TelegramDiProva.avvia();
  const cartella = await mkdtemp(join(tmpdir(), "shinka-gateway-"));
  const vault = await Vault.apri(join(cartella, "vault.json"), 2 ** 10);
  await vault.imposta(FRASE);
  const registro = await Registro.apri(join(cartella, "registro.jsonl"));
  const telegram = await Telegram.apri({ file: join(cartella, "telegram.json"), api: finto.indirizzo, attesaSecondi: 1, pausaMs: () => 20 });
  const app = await creaGateway({
    vault,
    registro,
    operazioni: new Operazioni(vault, registro, opzioni.scadenzaMs),
    stack: new StackDiProva(vault, registro),
    telegram,
    gettone: GETTONE,
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const cliente = new ClienteGateway({ indirizzo: `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`, gettone: GETTONE });
  const docker = new DockerDiProva();
  const avviato = await avviaHostDiProva({ utente: "root", password: PASSWORD, esegui: (comando, ingresso) => docker.esegui(comando, ingresso) });
  t.after(async () => {
    cliente.chiudi();
    await avviato.chiudi();
    await app.close();
    await finto.chiudi();
    await rm(cartella, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  const host = `127.0.0.1:${avviato.porta}`;
  await vault.inserisci({ nome: "lab", tipo: "password", utente: "root", host: [host], segreto: PASSWORD, stack: RECINTO });

  let primaDelTest = 0;
  if (opzioni.abbinato !== false) {
    await telegram.imposta(finto.gettone);
    telegram.nuovoCodice();
    finto.scrive(PROPRIETARIO, telegram.inVista().codice?.valore);
    await finto.attendi(() => finto.messaggi.length === 1, 5000, "il bot conferma l'abbinamento");
    primaDelTest = 1;
  }
  const banco = await allestisci(t, {
    gateway: cliente,
    telegram: { attesaEventiS: 1, ritardoRichiesteMs: 250, lavoroLungoMs: 60_000, pausaMs: 20, ...opzioni.tempi },
    ...(opzioni.sviluppo === undefined ? {} : { sviluppo: opzioni.sviluppo }),
    ...(opzioni.estensioni === undefined ? {} : { estensioni: opzioni.estensioni }),
  });
  // Il ponte sa in che stato è il bot appena il gateway gli ha risposto la prima volta.
  await new Promise((fatto) => setTimeout(fatto, 100));
  const mandati = (): MessaggioDelBot[] => finto.messaggi.slice(primaDelTest);
  return {
    banco,
    finto,
    telegram,
    docker,
    host,
    vault,
    mandati,
    arrivano: async (quanti) => {
      await finto.attendi(() => mandati().length >= quanti, 5000, `il bot manda ${quanti} messaggi (finora ${mandati().length})`);
      return mandati();
    },
  };
}

function attesa(ms: number): Promise<void> {
  return new Promise((fatto) => setTimeout(fatto, ms));
}

/** Claude risponde: qualche parola, un'azione, il testo finale, e il turno si chiude. */
function rispondi(conversazione: ConversazioneFinta, testo: string, fine: Partial<Extract<EventoConversazione, { tipo: "turno-concluso" }>> = {}): void {
  if (testo !== "") conversazione.emetti({ tipo: "testo-concluso", idTesto: `t${Math.random()}`, testo });
  conversazione.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 10, ...fine });
}

function messaggiDelProprietario(banco: Banco): Extract<EventoConversazione, { tipo: "messaggio-proprietario" }>[] {
  return banco.canale.archiviati.flatMap(({ evento }) => (evento.tipo === "messaggio-proprietario" ? [evento] : []));
}

function pulsante(messaggio: MessaggioDelBot | undefined, testo: string): string {
  const trovato = messaggio?.pulsanti.flat().find((uno) => uno.text === testo);
  assert.ok(trovato, `il messaggio ha il pulsante «${testo}»`);
  return trovato.callback_data;
}

test("un messaggio da Telegram arriva alla Home, e torna soltanto il testo finale", async (t) => {
  const { banco, finto, arrivano, mandati } = await allestisciLab(t);

  finto.scrive(PROPRIETARIO, "Aggiornami sui progetti");
  await finche(() => banco.home.inviati.length === 1, "il messaggio arriva alla Home");
  assert.deepEqual(banco.home.inviati, ["Aggiornami sui progetti"]);
  // Claude sa da dove arriva, e nell'archivio resta scritto.
  assert.match(banco.home.annotazioni.at(-1) ?? "", /^\[Shinka\] .*arriva da Telegram/);
  assert.equal(messaggiDelProprietario(banco)[0]?.origine, "telegram");
  await finche(() => finto.staScrivendo > 0, "su Telegram si vede che Shinka sta scrivendo");

  // Durante il turno Claude dice e fa altre cose: su Telegram non arrivano.
  banco.home.emetti({ tipo: "testo-concluso", idTesto: "t1", testo: "Guardo lo stato dei progetti." });
  banco.home.emetti({ tipo: "azione-iniziata", idAzione: "a1", strumento: "mcp__shinka__stato_progetti", ingresso: {} });
  banco.home.emetti({ tipo: "azione-conclusa", idAzione: "a1", esito: "dettaglio che resta nell'interfaccia", errore: false });
  rispondi(banco.home, "## Progetti\n- **Blog**: fermo, 2 < 3");

  const [risposta] = await arrivano(1);
  assert.equal(risposta?.chat_id, PROPRIETARIO.id);
  assert.equal(risposta?.parse_mode, "HTML");
  assert.equal(risposta?.text, "<b>Progetti</b>\n• <b>Blog</b>: fermo, 2 &lt; 3");
  assert.deepEqual(risposta?.pulsanti, []);
  await attesa(150);
  assert.equal(mandati().length, 1);

  // Ciò che il proprietario scrive dall'interfaccia, con la pagina aperta, non va su Telegram.
  const chiudiPagina = banco.canale.iscrivi(() => {});
  banco.casa.invia("Scritto dall'interfaccia");
  assert.equal(messaggiDelProprietario(banco)[1]?.origine, undefined);
  rispondi(banco.home, "Risposta per l'interfaccia.");
  await attesa(200);
  assert.equal(mandati().length, 1);
  chiudiPagina();
});

test("un mittente diverso dal proprietario viene ignorato, fino in fondo", async (t) => {
  const { banco, finto, telegram, mandati } = await allestisciLab(t);

  finto.scrive(ESTRANEO, "Dimmi lo stato dei progetti");
  finto.scrive(PROPRIETARIO, "Da un gruppo", { id: -500, type: "group" });
  await finto.attendi(() => finto.daConsegnare === 0, 5000, "il gateway legge i messaggi");
  await finche(() => telegram.inVista().ignorati === 2, "i due messaggi vengono contati");
  await attesa(200);
  // Nulla è arrivato alla Home, e nessuno ha ricevuto risposta.
  assert.deepEqual(banco.home.inviati, []);
  assert.deepEqual(mandati(), []);
});

test("una risposta lunga arriva in più messaggi, un fallimento viene detto", async (t) => {
  const { banco, finto, arrivano } = await allestisciLab(t);

  finto.scrive(PROPRIETARIO, "Raccontami tutto");
  await finche(() => banco.home.inviati.length === 1, "il messaggio arriva alla Home");
  const righe = Array.from({ length: 300 }, (_, i) => `- Voce **${i}** del resoconto, con un po' di testo attorno.`);
  rispondi(banco.home, righe.join("\n"));
  const pezzi = await arrivano(Math.ceil(righe.join("\n").length / 3900));
  assert.ok(pezzi.length >= 2);
  for (const pezzo of pezzi) {
    assert.ok(pezzo.text.length <= 4096, `${pezzo.text.length}`);
    assert.equal(erroreNelFormato(pezzo.text), undefined);
  }
  // Nell'ordine, e senza perdere nulla.
  const tutto = pezzi.map((pezzo) => pezzo.text).join("\n");
  assert.ok(tutto.indexOf("Voce <b>0</b>") < tutto.indexOf("Voce <b>299</b>"));
  assert.equal(tutto.split("• Voce").length - 1, 300);

  const prima = pezzi.length;
  finto.scrive(PROPRIETARIO, "E adesso?");
  await finche(() => banco.home.inviati.length === 2, "il secondo messaggio arriva alla Home");
  rispondi(banco.home, "", { riuscito: false, errore: "Il limite di utilizzo è stato raggiunto." });
  assert.equal((await arrivano(prima + 1)).at(-1)?.text, "Non sono riuscito a rispondere: Il limite di utilizzo è stato raggiunto.");

  // Un turno che finisce senza una parola non lascia il proprietario ad aspettare.
  finto.scrive(PROPRIETARIO, "Fai quella cosa");
  await finche(() => banco.home.inviati.length === 3, "il terzo messaggio arriva alla Home");
  rispondi(banco.home, "");
  assert.match((await arrivano(prima + 2)).at(-1)?.text ?? "", /^Fatto, ma senza una risposta scritta/);
});

test("se la richiesta fa cambiare argomento, la risposta arriva dall'argomento nuovo", async (t) => {
  const { banco, finto, arrivano, mandati } = await allestisciLab(t);

  // Un primo scambio, perché ci sia un argomento da archiviare.
  finto.scrive(PROPRIETARIO, "Parliamo del blog");
  await finche(() => banco.home.inviati.length === 1, "il primo messaggio arriva alla Home");
  rispondi(banco.home, "Dimmi pure.");
  await arrivano(1);

  finto.scrive(PROPRIETARIO, "Cambiando discorso: che tempo fa?");
  const diPrima = banco.home;
  await finche(() => diPrima.inviati.length === 2, "il secondo messaggio arriva alla Home");
  assert.equal(typeof banco.casa.richiediCambio({ titolo: "Il blog", riassunto: "Si è parlato del blog." }), "string");
  // Ciò che Claude dice chiudendo l'argomento vecchio non è la risposta.
  rispondi(diPrima, "Passo a un argomento nuovo.");

  await finche(() => banco.conversazioniHome.length === 2 && banco.home.inviati.length === 1, "la richiesta viene riproposta nell'argomento nuovo");
  assert.deepEqual(banco.home.inviati, ["Cambiando discorso: che tempo fa?"]);
  assert.equal(messaggiDelProprietario(banco).at(-1)?.origine, "telegram");
  assert.match(banco.home.annotazioni.join(" "), /arriva da Telegram/);
  rispondi(banco.home, "Fuori piove.");
  assert.equal((await arrivano(2))[1]?.text, "Fuori piove.");
  await attesa(150);
  assert.equal(mandati().length, 2);
});

test("un messaggio consegnato troppo tardi non viene passato alla Home", async (t) => {
  const { banco, finto, arrivano } = await allestisciLab(t, { tempi: { adesso: () => Date.now() + 11 * 60_000 } });

  finto.scrive(PROPRIETARIO, "Spegni tutto");
  const [avviso] = await arrivano(1);
  assert.match(avviso?.text ?? "", /^Ho ricevuto tardi un tuo messaggio \(«Spegni tutto»\): riscrivilo/);
  assert.deepEqual(banco.home.inviati, []);
});

test("il consenso a un'azione della Home si dà con un pulsante, e vale come dall'interfaccia", async (t) => {
  const { banco, finto, arrivano, mandati } = await allestisciLab(t);

  finto.scrive(PROPRIETARIO, "Installa le dipendenze");
  await finche(() => banco.home.inviati.length === 1, "il messaggio arriva alla Home");
  banco.home.emetti({ tipo: "permesso-richiesto", idPermesso: "p1", idAzione: "a1", strumento: "Bash", ingresso: { command: "npm install <tutto>" } });

  // Chi ha scritto da Telegram riceve la richiesta subito.
  const [richiesta] = await arrivano(1);
  assert.ok(richiesta);
  assert.match(richiesta.text, /^<b>La Home chiede il tuo consenso<\/b>\n/);
  assert.match(richiesta.text, /<pre>npm install &lt;tutto&gt;<\/pre>/);
  assert.deepEqual(richiesta.pulsanti.map((riga) => riga.map((uno) => uno.text)), [["Consenti", "Nega"]]);

  // Un altro che preme il pulsante non decide nulla.
  finto.preme(ESTRANEO, richiesta.message_id, pulsante(richiesta, "Consenti"));
  await finto.attendi(() => finto.daConsegnare === 0, 5000, "il gateway legge la pressione");
  await attesa(150);
  assert.deepEqual(banco.home.decisioni, []);

  const pressione = finto.preme(PROPRIETARIO, richiesta.message_id, pulsante(richiesta, "Consenti"));
  await finche(() => banco.home.decisioni.length === 1, "la decisione arriva alla conversazione");
  assert.deepEqual(banco.home.decisioni, [["p1", "approvato"]]);
  // Il pulsante smette di girare, e il messaggio dice com'è finita, senza più pulsanti.
  await finto.attendi(() => richiesta.modifiche === 1 && finto.risposteAiPulsanti.includes(pressione), 5000, "il messaggio viene chiuso");
  assert.match(richiesta.text, /<pre>npm install &lt;tutto&gt;<\/pre>\n\n<b>Consentito\.<\/b>$/);
  assert.deepEqual(richiesta.pulsanti, []);

  // Negare, e poi premere di nuovo un pulsante ormai vecchio.
  banco.home.emetti({ tipo: "permesso-richiesto", idPermesso: "p2", idAzione: "a2", strumento: "Bash", ingresso: { command: "rm -rf dist" } });
  const seconda = (await arrivano(2))[1];
  assert.ok(seconda);
  const nega = pulsante(seconda, "Nega");
  finto.preme(PROPRIETARIO, seconda.message_id, nega);
  await finche(() => banco.home.decisioni.length === 2, "la seconda decisione arriva");
  assert.deepEqual(banco.home.decisioni[1], ["p2", "negato"]);
  await finto.attendi(() => seconda.modifiche === 1, 5000, "il secondo messaggio viene chiuso");
  assert.match(seconda.text, /<b>Negato\.<\/b>$/);

  finto.preme(PROPRIETARIO, seconda.message_id, nega);
  await finto.attendi(() => seconda.modifiche === 2, 5000, "il pulsante vecchio riceve risposta");
  assert.match(seconda.text, /^Questa richiesta non è più in attesa/);
  assert.equal(banco.home.decisioni.length, 2);
  assert.equal(mandati().length, 2);
});

test("con la pagina aperta la richiesta va su Telegram solo se resta in attesa", async (t) => {
  const { banco, arrivano, mandati } = await allestisciLab(t);
  const cookies = { [COOKIE_SESSIONE]: await banco.entra() };
  const chiudiPagina = banco.canale.iscrivi(() => {});
  banco.casa.invia("Dall'interfaccia");

  // Decisa subito dall'interfaccia: su Telegram non arriva niente.
  banco.home.emetti({ tipo: "permesso-richiesto", idPermesso: "p1", idAzione: "a1", strumento: "Bash", ingresso: { command: "ls" } });
  const subito = await banco.centro.inject({ method: "POST", url: "/api/home/permessi/p1", cookies, payload: { decisione: "approvato" } });
  assert.equal(subito.statusCode, 200);
  await attesa(450);
  assert.deepEqual(mandati(), []);

  // Rimasta lì: dopo un po' parte, e quando viene decisa dall'interfaccia il messaggio lo dice.
  banco.home.emetti({ tipo: "permesso-richiesto", idPermesso: "p2", idAzione: "a2", strumento: "Bash", ingresso: { command: "npm test" } });
  await attesa(100);
  assert.deepEqual(mandati(), []);
  const [richiesta] = await arrivano(1);
  assert.ok(richiesta);
  assert.equal(richiesta.pulsanti.flat().length, 2);
  const poi = await banco.centro.inject({ method: "POST", url: "/api/home/permessi/p2", cookies, payload: { decisione: "negato" } });
  assert.equal(poi.statusCode, 200);
  await finche(() => richiesta.modifiche === 1, "il messaggio viene chiuso");
  assert.match(richiesta.text, /<b>Negato\.<\/b>$/);
  assert.deepEqual(richiesta.pulsanti, []);
  chiudiPagina();
});

test("ciò che non sta per intero in un messaggio si decide dall'interfaccia", async (t) => {
  const { banco, arrivano } = await allestisciLab(t);
  banco.home.emetti({ tipo: "turno-iniziato" });
  banco.home.emetti({ tipo: "permesso-richiesto", idPermesso: "p1", idAzione: "a1", strumento: "Bash", ingresso: { command: `echo ${"x".repeat(3000)}` } });
  const [richiesta] = await arrivano(1);
  assert.ok(richiesta);
  assert.deepEqual(richiesta.pulsanti, []);
  assert.match(richiesta.text, /troppo lungo per mostrarlo qui per intero/);
  assert.ok(richiesta.text.length <= 4096);
});

test("un progetto avvisa quando ha finito, quando aspetta una risposta e quando chiede un consenso", async (t) => {
  const { banco, finto, arrivano, mandati } = await allestisciLab(t, { tempi: { lavoroLungoMs: 300 } });
  const progetto = await banco.lavori.crea("Blog", "centro", "Provare un blog.");
  const conversazione = banco.conversazioniLocali[0];
  assert.ok(conversazione);

  // Nessuna pagina aperta sul progetto: la fine del lavoro arriva su Telegram, con il resoconto.
  rispondi(conversazione, "Fatto: il blog gira su `localhost:8080`.");
  const [finito] = await arrivano(1);
  assert.equal(finito?.text, "<b>Il progetto «Blog» ha finito</b>\n\nFatto: il blog gira su <code>localhost:8080</code>.");

  banco.lavori.invia(progetto.id, "Aggiungi i commenti");
  rispondi(conversazione, "Posso farlo in due modi.\n\nQuale database vuoi usare?");
  assert.match((await arrivano(2))[1]?.text ?? "", /^<b>Il progetto «Blog» aspetta una tua risposta<\/b>\n\nPosso farlo in due modi\./);

  banco.lavori.invia(progetto.id, "Postgres");
  rispondi(conversazione, "", { riuscito: false, errore: "Il nodo si è scollegato." });
  assert.equal((await arrivano(3))[2]?.text, "<b>Il progetto «Blog» si è fermato per un errore</b>\n\nIl nodo si è scollegato.");

  // Un lavoro interrotto dal proprietario non si annuncia.
  banco.lavori.invia(progetto.id, "Riprova");
  rispondi(conversazione, "Stavo per…", { interrotto: true });

  // Con la pagina del progetto aperta: un lavoro breve non si annuncia, uno lungo sì.
  const canale = banco.lavori.canale(progetto.id);
  assert.ok(canale);
  const chiudiPagina = canale.iscrivi(() => {});
  banco.lavori.invia(progetto.id, "Una cosa veloce");
  rispondi(conversazione, "Fatta.");
  await attesa(200);
  assert.equal(mandati().length, 3);
  banco.lavori.invia(progetto.id, "Una cosa lunga");
  await attesa(350);
  rispondi(conversazione, "Finita anche questa.");
  assert.match((await arrivano(4))[3]?.text ?? "", /ha finito<\/b>\n\nFinita anche questa\.$/);
  chiudiPagina();

  // Il consenso a un'azione del progetto, dato con il pulsante.
  banco.lavori.invia(progetto.id, "Pubblica");
  conversazione.emetti({ tipo: "permesso-richiesto", idPermesso: "p1", idAzione: "a1", strumento: "Bash", ingresso: { command: "git push" } });
  const richiesta = (await arrivano(5))[4];
  assert.ok(richiesta);
  assert.match(richiesta.text, /^<b>Il progetto «Blog» chiede il tuo consenso<\/b>\n/);
  finto.preme(PROPRIETARIO, richiesta.message_id, pulsante(richiesta, "Nega"));
  await finche(() => conversazione.decisioni.length === 1, "la decisione arriva al progetto");
  assert.deepEqual(conversazione.decisioni, [["p1", "negato"]]);
  await finto.attendi(() => richiesta.modifiche === 1, 5000, "il messaggio viene chiuso");
  assert.match(richiesta.text, /<b>Negato\.<\/b>$/);
});

test("le domande della Home arrivano su Telegram, e si risponde con un messaggio; quelle di un progetto dall'interfaccia", async (t) => {
  const { banco, finto, arrivano } = await allestisciLab(t);
  finto.scrive(PROPRIETARIO, "Prepara il blog");
  await finche(() => banco.home.inviati.length === 1, "il messaggio arriva alla Home");
  banco.home.emetti({
    tipo: "domande-poste",
    idDomande: "d1",
    domande: [
      { domanda: "Quale database?", intestazione: "Database", opzioni: [{ etichetta: "Postgres", descrizione: "Il più completo" }, { etichetta: "SQLite" }], piuScelte: false },
      { domanda: "Che cosa serve?", intestazione: "Funzioni", opzioni: [{ etichetta: "Commenti" }, { etichetta: "<Ricerca>" }], piuScelte: true },
    ],
  });
  const [domande] = await arrivano(1);
  assert.ok(domande);
  assert.equal(
    domande.text,
    [
      "<b>La Home ti chiede</b>",
      "",
      "<b>1. Quale database?</b>",
      "a) Postgres · Il più completo",
      "b) SQLite",
      "",
      "<b>2. Che cosa serve?</b> <i>(anche più di una)</i>",
      "a) Commenti",
      "b) &lt;Ricerca&gt;",
      "",
      "Rispondi con un messaggio, a parole tue (per esempio «1a, 2 b e c»), oppure dalla scheda nell'interfaccia di Shinka.",
    ].join("\n"),
  );
  assert.deepEqual(domande.pulsanti, []);

  // La risposta è un messaggio come gli altri: arriva alla Home, che la dà alle domande.
  finto.scrive(PROPRIETARIO, "1a, 2b");
  await finche(() => banco.home.inviati.length === 2, "la risposta arriva alla Home");
  assert.equal(banco.home.inviati[1], "1a, 2b");
  banco.home.emetti({ tipo: "domande-chiuse", idDomande: "d1", esito: "in-chat" });
  await finto.attendi(() => domande.modifiche === 1, 5000, "il messaggio delle domande viene chiuso");
  assert.match(domande.text, /<b>Hai risposto con un messaggio\.<\/b>$/);

  const progetto = await banco.lavori.crea("Blog", "centro", "Provare un blog.");
  const conversazione = banco.conversazioniLocali[0];
  assert.ok(conversazione);
  banco.lavori.invia(progetto.id, "Comincia");
  conversazione.emetti({ tipo: "domande-poste", idDomande: "d2", domande: [{ domanda: "Che tema?", intestazione: "Tema", opzioni: [{ etichetta: "Chiaro" }, { etichetta: "Scuro" }], piuScelte: false }] });
  const delProgetto = (await arrivano(2))[1];
  assert.ok(delProgetto);
  assert.match(delProgetto.text, /^<b>Il progetto «Blog» ti chiede<\/b>\n\n<b>Che tema\?<\/b>\na\) Chiaro\nb\) Scuro\n\nRispondi dalla scheda nell'interfaccia di Shinka/);
  assert.equal(banco.lavori.rispondiDomande(progetto.id, "d2", { tipo: "risposte", risposte: ["Scuro"] }), true);
  await finto.attendi(() => delProgetto.modifiche === 1, 5000, "il messaggio del progetto viene chiuso");
  assert.match(delProgetto.text, /<b>Hai risposto dall'interfaccia\.<\/b>$/);
});

test("un comando su un host si approva con un pulsante, e viene eseguito quello mostrato", async (t) => {
  const { banco, finto, docker, host, arrivano } = await allestisciLab(t);
  const argomenti = { credenziale: "lab", host, comando: "docker stop plex" };

  const esito = banco.comuniDellaHome("esegui_su_host", argomenti);
  const [richiesta] = await arrivano(1);
  assert.ok(richiesta);
  assert.match(richiesta.text, /^<b>La Home: comando da approvare<\/b>\n/);
  assert.ok(richiesta.text.includes(`Su ${host}, con la credenziale lab.`));
  assert.match(richiesta.text, /<pre>docker stop plex<\/pre>\nHai \d+ minuti: poi scade, e non viene eseguito\.$/);
  assert.deepEqual(richiesta.pulsanti.map((riga) => riga.map((uno) => uno.text)), [["Approva", "Nega"]]);
  assert.equal(docker.container[0]?.stato, "running");

  finto.preme(PROPRIETARIO, richiesta.message_id, pulsante(richiesta, "Approva"));
  assert.equal((await esito).errore, undefined);
  assert.equal(docker.container[0]?.stato, "exited");
  await finto.attendi(() => richiesta.modifiche === 1, 5000, "il messaggio viene chiuso");
  assert.match(richiesta.text, /<b>Approvato\.<\/b>$/);
  assert.deepEqual(richiesta.pulsanti, []);

  // Negato: il comando non parte.
  const altro = banco.comuniDellaHome("esegui_su_host", { ...argomenti, comando: "docker rm -f plex" });
  const seconda = (await arrivano(2))[1];
  assert.ok(seconda);
  finto.preme(PROPRIETARIO, seconda.message_id, pulsante(seconda, "Nega"));
  assert.equal((await altro).errore, true);
  assert.equal(docker.container.some((uno) => uno.nome === "plex"), true);
  await finto.attendi(() => seconda.modifiche === 1, 5000, "il secondo messaggio viene chiuso");
  assert.match(seconda.text, /<b>Negato: il comando non è stato eseguito\.<\/b>$/);
});

test("il consenso dato da Telegram a un comando su un host vale come approvazione, una volta", async (t) => {
  const { banco, finto, docker, host, arrivano, mandati } = await allestisciLab(t);
  const argomenti = { credenziale: "lab", host, comando: "docker stop plex" };

  banco.home.emetti({ tipo: "turno-iniziato" });
  banco.home.emetti({ tipo: "permesso-richiesto", idPermesso: "p1", idAzione: "a1", strumento: "mcp__shinka__esegui_su_host", ingresso: argomenti });
  const [richiesta] = await arrivano(1);
  assert.ok(richiesta);
  assert.match(richiesta.text, /docker stop plex/);
  finto.preme(PROPRIETARIO, richiesta.message_id, pulsante(richiesta, "Consenti"));
  await finche(() => banco.home.decisioni.length === 1, "il consenso arriva alla conversazione");

  // Non gli viene chiesto una seconda volta di approvare lo stesso comando.
  const esito = await banco.comuniDellaHome("esegui_su_host", argomenti);
  assert.equal(esito.errore, undefined, esito.testo);
  assert.equal(docker.container[0]?.stato, "exited");
  await attesa(150);
  assert.equal(mandati().length, 1);
});

test("un'approvazione che scade lo dice anche su Telegram", async (t) => {
  const { banco, host, docker, arrivano } = await allestisciLab(t, { scadenzaMs: 400 });
  const esito = banco.comuniDellaHome("esegui_su_host", { credenziale: "lab", host, comando: "docker stop plex" });
  const [richiesta] = await arrivano(1);
  assert.ok(richiesta);
  assert.match(richiesta.text, /Hai un minuto: poi scade/);
  assert.equal((await esito).errore, true);
  await finche(() => richiesta.modifiche === 1, "il messaggio viene chiuso");
  assert.match(richiesta.text, /<b>Scaduta: il comando non è stato eseguito\.<\/b>$/);
  assert.deepEqual(richiesta.pulsanti, []);
  assert.equal(docker.container[0]?.stato, "running");
});

test("la pagina del vault dice in che stato è Telegram, senza il token", async (t) => {
  const { banco, finto } = await allestisciLab(t);
  const risposta = await banco.centro.inject({ method: "GET", url: "/api/vault", cookies: { [COOKIE_SESSIONE]: await banco.entra() } });
  assert.equal(risposta.statusCode, 200);
  assert.deepEqual((risposta.json() as DettaglioVault).telegram, { condizione: "attivo", bot: "shinka_prova_bot" });
  assert.ok(!risposta.body.includes(finto.gettone));
});

test("senza un proprietario abbinato il ponte non manda nulla, e comincia quando c'è", async (t) => {
  const { banco, finto, telegram, mandati } = await allestisciLab(t, { abbinato: false });
  banco.home.emetti({ tipo: "turno-iniziato" });
  banco.home.emetti({ tipo: "permesso-richiesto", idPermesso: "p1", idAzione: "a1", strumento: "Bash", ingresso: { command: "ls" } });
  await attesa(200);
  assert.deepEqual(finto.messaggi, []);

  await telegram.imposta(finto.gettone);
  telegram.nuovoCodice();
  finto.scrive(PROPRIETARIO, telegram.inVista().codice?.valore);
  await finto.attendi(() => finto.messaggi.length === 1, 5000, "il bot conferma l'abbinamento");
  // Il ponte lo viene a sapere dal gateway senza aspettare la richiesta successiva.
  await attesa(150);
  banco.home.emetti({ tipo: "permesso-richiesto", idPermesso: "p2", idAzione: "a2", strumento: "Bash", ingresso: { command: "pwd" } });
  await finto.attendi(() => mandati().length === 2, 5000, "la richiesta nuova arriva su Telegram");
  assert.match(mandati()[1]?.text ?? "", /<pre>pwd<\/pre>/);
});

test("una proposta di sviluppo di Shinka e l'installazione di una versione si decidono con un pulsante", async (t) => {
  const versione = "0123456789abcdef0123456789abcdef01234567";
  const { banco, finto, arrivano } = await allestisciLab(t, {
    sviluppo: {
      prepara: async () => ({
        pronta: true,
        versione,
        modifiche: ["Aggiunge il tema <scuro>"],
        file: ["web/src/stile.css", "src/gateway/vault.ts"],
        quantiFile: 2,
        avvisi: ["Cambia anche il gateway: da qui non viene installato."],
      }),
    },
  });
  const sviluppo = banco.sviluppo;
  assert.ok(sviluppo);

  // La proposta: confermata da Telegram, la richiesta passa al progetto Shinka.
  sviluppo.proponi({ titolo: "Tema scuro", richiesta: "Serve un <tema> scuro." });
  const [proposta] = await arrivano(1);
  assert.ok(proposta);
  assert.match(proposta.text, /^<b>Sviluppo di Shinka: Tema scuro<\/b>\nServe un &lt;tema&gt; scuro\.\nSe confermi/);
  // Da qui si conferma con le impostazioni di sempre, e il messaggio lo dice.
  assert.match(proposta.text, /Confermando da qui lavora con le impostazioni di sempre: modello [^,]+, effort [^,]+, permessi «[^»]+»\. Per sceglierne altre per questo lavoro, conferma dall'interfaccia\./);
  assert.deepEqual(proposta.pulsanti.map((riga) => riga.map((uno) => uno.text)), [["Conferma", "Annulla"]]);
  finto.preme(ESTRANEO, proposta.message_id, pulsante(proposta, "Conferma"));
  await finto.attendi(() => finto.daConsegnare === 0, 5000, "il gateway legge la pressione");
  await attesa(150);
  assert.equal(banco.conversazioniLocali.length, 0);
  finto.preme(PROPRIETARIO, proposta.message_id, pulsante(proposta, "Conferma"));
  await finche(() => banco.conversazioniLocali[0]?.inviati.length === 1, "la richiesta passa al progetto Shinka");
  await finto.attendi(() => proposta.modifiche === 1, 5000, "il messaggio della proposta viene chiuso");
  assert.match(proposta.text, /<b>Confermata: il progetto Shinka ci sta lavorando\.<\/b>$/);
  assert.deepEqual(proposta.pulsanti, []);

  // L'installazione: la scheda arriva con ciò che cambia, e si approva da lì.
  const esito = await banco.comuniDelProgetto(sviluppo.idProgetto, "chiedi_installazione", { riassunto: "Aggiunge il tema scuro." });
  assert.equal(esito.errore, undefined);
  const richiesta = (await arrivano(2))[1];
  assert.ok(richiesta);
  assert.match(richiesta.text, /^<b>Shinka: versione 01234567 pronta da installare<\/b>\nLe prove sono passate\.\nAggiunge il tema scuro\./);
  assert.match(richiesta.text, /• Aggiunge il tema &lt;scuro&gt;\nCambiano 2 file\.\n⚠️ Cambia anche il gateway/);
  assert.deepEqual(richiesta.pulsanti.map((riga) => riga.map((uno) => uno.text)), [["Installa", "Nega"]]);
  assert.equal(leggiInstallazione(banco.fileInstallazione), undefined);
  finto.preme(PROPRIETARIO, richiesta.message_id, pulsante(richiesta, "Installa"));
  await finche(() => banco.riavvii.length === 1, "il centro si riavvia");
  assert.equal(leggiInstallazione(banco.fileInstallazione)?.versione, versione);
  await finto.attendi(() => richiesta.modifiche === 1, 5000, "il messaggio dell'installazione viene chiuso");
  assert.match(richiesta.text, /<b>Approvata: Shinka si riavvia con la versione nuova\.<\/b>$/);

  // Ripartito, il centro dice com'è finita anche lì.
  await scriviInstallazione(banco.fileInstallazione, { fase: "confermata", versione, riassunto: "Aggiunge il tema scuro.", quando: new Date().toISOString() });
  await sviluppo.riferisci();
  const conclusa = (await arrivano(3))[2];
  assert.equal(conclusa?.text, "Shinka è ripartita con la versione 01234567.");
});

test("la scheda di un'estensione si decide con un pulsante, e la sua chiave arriva dal vault al programma soltanto", async (t) => {
  /** Un valore finto, fatto per riconoscerlo se finisse dove non deve. */
  const chiaveFinta = "chiave-FINTA-di-prova-0001";
  const commit = "0123456789abcdef0123456789abcdef01234567";
  const { banco, finto, arrivano, vault } = await allestisciLab(t, {
    estensioni: {
      // Un plugin con tanto dentro da non stare in un messaggio.
      esamina: async (repository) => ({
        definizione: { tipo: "plugin", repository, commit },
        contenuto: {
          skill: Array.from({ length: 60 }, (_, i) => `una-skill-dal-nome-piuttosto-lungo-numero-${i}-per-riempire-la-scheda`),
          comandi: [],
          agenti: [],
          agganci: [],
          server: [],
          altro: [],
        },
      }),
    },
  });
  const estensioni = banco.estensioni;
  assert.ok(estensioni);
  const meteo = {
    nome: "meteo",
    descrizione: "Dice che <tempo> fa.",
    idAmbiente: "centro",
    definizione: { tipo: "mcp-locale" as const, comando: "npx", argomenti: ["-y", "meteo-mcp"], variabili: { REGIONE: "veneto" } },
    chiavi: ["METEO_TOKEN"],
  };

  assert.ok("idProposta" in (await estensioni.proponi(meteo)));
  const [scheda] = await arrivano(1);
  assert.ok(scheda);
  // La scheda dice che cosa parte, per intero, e dove.
  assert.match(
    scheda.text,
    /^<b>Estensione da installare: meteo<\/b>\nServer MCP locale, nell'ambiente «Unraid»\.\nDice che &lt;tempo&gt; fa\.\n<pre>npx -y meteo-mcp\nREGIONE=veneto<\/pre>\nChiavi dal vault: METEO_TOKEN\.\n⚠️ /,
  );
  assert.match(scheda.text, /⚠️ La versione di "meteo-mcp" non è scritta nel comando/);
  assert.match(scheda.text, /Finché non confermi non viene installato né avviato nulla\.$/);
  assert.deepEqual(scheda.pulsanti.map((riga) => riga.map((uno) => uno.text)), [["Conferma", "Annulla"]]);

  // Un estraneo non conferma nulla.
  finto.preme(ESTRANEO, scheda.message_id, pulsante(scheda, "Conferma"));
  await finto.attendi(() => finto.daConsegnare === 0, 5000, "il gateway legge la pressione");
  await attesa(150);
  assert.deepEqual(banco.harnessEstensioni.aperture, []);

  // Il proprietario conferma, ma la chiave nel vault non c'è: la scheda resta lì e lo dice.
  finto.preme(PROPRIETARIO, scheda.message_id, pulsante(scheda, "Conferma"));
  await finto.attendi(() => /Non ancora: /.test(scheda.text), 5000, "la scheda dice che cosa manca");
  assert.match(scheda.text, /Non ancora: Non è partita: Nel vault manca la chiave METEO_TOKEN dell'estensione "meteo" per l'ambiente "Unraid"\..*Quando è a posto, conferma di nuovo\.$/);
  assert.deepEqual(scheda.pulsanti.map((riga) => riga.map((uno) => uno.text)), [["Conferma", "Annulla"]]);
  assert.deepEqual(banco.harnessEstensioni.aperture, []);
  assert.deepEqual(estensioni.stato().estensioni, []);

  // La scrive nel vault, come chiave di quell'estensione per quell'ambiente, e conferma di nuovo.
  await vault.inserisci({ nome: "meteo-unraid", tipo: "estensione", estensione: "meteo", utente: "METEO_TOKEN", host: ["Unraid"], segreto: chiaveFinta });
  finto.preme(PROPRIETARIO, scheda.message_id, pulsante(scheda, "Conferma"));
  await finto.attendi(() => /Accesa/.test(scheda.text), 5000, "la scheda viene chiusa");
  assert.match(scheda.text, /<b>Accesa: è partita, con 2 strumenti\.<\/b>$/);
  assert.deepEqual(scheda.pulsanti, []);
  assert.deepEqual(banco.harnessEstensioni.avviati, [
    { meteo: { command: "npx", args: ["-y", "meteo-mcp"], env: { REGIONE: "veneto", METEO_TOKEN: chiaveFinta } } },
  ]);
  assert.deepEqual(estensioni.accese("centro").map((una) => una.nome), ["meteo"]);
  // La consegna è annotata nel vault; il valore non è passato da Telegram né dall'archivio.
  assert.ok(vault.elenco().find((una) => una.nome === "meteo-unraid")?.usataIl);
  assert.ok(!JSON.stringify(finto.messaggi).includes(chiaveFinta));
  assert.ok(!JSON.stringify(banco.canale.archiviati).includes(chiaveFinta));

  // Annullare da Telegram vale come dall'interfaccia.
  assert.ok("idProposta" in (await estensioni.proponi({ ...meteo, nome: "posta", chiavi: [] })));
  const seconda = (await arrivano(2))[1];
  assert.ok(seconda);
  finto.preme(PROPRIETARIO, seconda.message_id, pulsante(seconda, "Annulla"));
  await finto.attendi(() => /Annullata/.test(seconda.text), 5000, "la seconda scheda viene chiusa");
  assert.match(seconda.text, /<b>Annullata: non è stato installato né avviato nulla\.<\/b>$/);
  assert.equal(banco.harnessEstensioni.avviati.length, 1);

  // Ciò che non si legge per intero in un messaggio si decide dall'interfaccia.
  const lunga = await estensioni.proponi({
    nome: "tante-skill",
    descrizione: "Un plugin con molte skill.",
    idAmbiente: "centro",
    definizione: { tipo: "plugin", repository: "https://esempio.it/plugin.git" },
    chiavi: [],
  });
  assert.ok("idProposta" in lunga);
  const terza = (await arrivano(3))[2];
  assert.ok(terza);
  assert.match(terza.text, /^<b>Estensione da installare: tante-skill<\/b>\nPlugin di Claude Code, nell'ambiente «Unraid»\./);
  assert.ok(terza.text.includes(`<pre>https://esempio.it/plugin.git\ncommit ${commit}</pre>`));
  assert.match(terza.text, /decidi dall'interfaccia di Shinka, dove si legge tutta\.$/);
  assert.deepEqual(terza.pulsanti, []);
  assert.equal(erroreNelFormato(terza.text), undefined);
  assert.equal(erroreNelFormato(scheda.text), undefined);
});

test("i file che la Home mostra in un turno partito da Telegram arrivano lì dopo il testo, e a richiesta anche dall'interfaccia", async (t) => {
  const { banco, finto, arrivano, mandati } = await allestisciLab(t);
  const cartella = banco.casa.cartellaAperta;
  const pdf = Buffer.from("%PDF-1.7\nGiro dei negozi di carte a Tokyo\n%%EOF\n");
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9]);
  await mkdir(join(cartella, "tokyo"), { recursive: true });
  await writeFile(join(cartella, "tokyo", "itinerario.pdf"), pdf);
  await writeFile(join(cartella, "tokyo", "mappa.png"), png);
  const id = banco.casa.idArgomentoAperto;
  const mostra = (percorso: string, titolo?: string): void =>
    banco.home.emetti({
      tipo: "elaborato-mostrato",
      idArgomento: id,
      idAmbiente: "centro",
      nomeAmbiente: "Unraid",
      percorso,
      ...(titolo === undefined ? {} : { titolo }),
    });

  finto.scrive(PROPRIETARIO, "Mandami l'itinerario di Tokyo in PDF");
  await finche(() => banco.home.inviati.length === 1, "il messaggio arriva alla Home");
  // Claude sa che i file mostrati arriveranno come allegati.
  assert.match(banco.home.annotazioni.at(-1) ?? "", /le foto scritte nel testo e, come allegati, i file che mostri con mostra_elaborato/);
  mostra("tokyo/itinerario.pdf", "Itinerario del giro a Tokyo");
  mostra("tokyo/mappa.png");
  mostra("tokyo/itinerario.pdf");
  rispondi(banco.home, "Ecco l'itinerario in PDF e la mappa.");

  await arrivano(1);
  await finto.attendi(() => finto.file.length === 2, 5000, "arrivano i due file");
  // Prima il testo, poi i file nell'ordine in cui sono stati mostrati, ciascuno una volta.
  assert.deepEqual(finto.ordine.slice(-3), ["testo:Ecco l'itinerario in PDF e la mappa.", "file:itinerario.pdf", "file:mappa.png"]);
  const [documento, foto] = finto.file;
  assert.equal(documento?.metodo, "sendDocument");
  assert.equal(documento?.tipo, "application/pdf");
  assert.equal(documento?.didascalia, "Itinerario del giro a Tokyo");
  assert.deepEqual(documento?.contenuto, pdf);
  assert.equal(documento?.chat_id, PROPRIETARIO.id);
  assert.equal(foto?.metodo, "sendPhoto");
  assert.deepEqual(foto?.contenuto, png);

  // Dall'interfaccia i file mostrati non vanno su Telegram...
  const chiudiPagina = banco.canale.iscrivi(() => {});
  banco.casa.invia("Mostrami di nuovo la mappa");
  mostra("tokyo/mappa.png");
  rispondi(banco.home, "Eccola.");
  await attesa(200);
  assert.equal(finto.file.length, 2);

  // ...a meno che la Home non li mandi apposta, e solo dalla cartella dell'argomento.
  const azioni = azioniDellaHome({
    ambienti: banco.ambienti,
    lavori: banco.lavori,
    proposte: banco.proposte,
    home: () => banco.casa,
    agisci: banco.agisci,
    elaborati: banco.elaborati,
    telegram: () => banco.ponte,
  });
  const mandato = await azioni.inviaFileTelegram({ ambiente: "Unraid", percorso: "tokyo/itinerario.pdf" });
  assert.equal(mandato.isError, undefined, mandato.content[0].text);
  assert.equal(finto.file.length, 3);
  for (const fuori of ["../argomenti.json", "/etc/passwd", join(banco.cartella, "argomenti.json")]) {
    const rifiuto = await azioni.inviaFileTelegram({ ambiente: "Unraid", percorso: fuori });
    assert.equal(rifiuto.isError, true, fuori);
  }
  assert.equal((await azioni.inviaFileTelegram({ ambiente: "Unraid", percorso: "tokyo/non-ce.pdf" })).isError, true);
  assert.equal(finto.file.length, 3);
  chiudiPagina();

  // Da Telegram, un file mandato apposta durante il turno non riparte alla fine.
  finto.scrive(PROPRIETARIO, "E la mappa?");
  await finche(() => banco.home.inviati.length === 3, "il secondo messaggio arriva alla Home");
  await azioni.inviaFileTelegram({ ambiente: "Unraid", percorso: "tokyo/mappa.png" });
  mostra("tokyo/mappa.png");
  const prima = mandati().length;
  rispondi(banco.home, "Te l'ho mandata.");
  await arrivano(prima + 1);
  await attesa(200);
  assert.equal(finto.file.length, 4);
});

test("le foto scritte nel testo della risposta arrivano dopo il testo, con il loro nome; quelle che non si scaricano restano fuori", async (t) => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
  const chieste: string[] = [];
  const { banco, finto, arrivano } = await allestisciLab(t, {
    tempi: {
      immaginiEsterne: {
        leggi: async (indirizzo) => {
          chieste.push(indirizzo);
          return indirizzo.includes("sparita") ? { motivo: "Il sito ha risposto 404." } : { tipo: "image/jpeg", dati: jpeg };
        },
      },
    },
  });
  finto.scrive(PROPRIETARIO, "Cosa vedere a Shanghai?");
  await finche(() => banco.home.inviati.length === 1, "il messaggio arriva alla Home");
  rispondi(
    banco.home,
    [
      "Tre tappe:",
      "",
      "1. ![Tempio del Buddha di Giada](https://commons.wikimedia.org/wiki/Special:FilePath/Jade.jpg?width=640) **Tempio del Buddha di Giada** · 1 ora",
      "2. ![M50](https://esempio.org/sparita.jpg) **M50** · 1-2 ore",
      "",
      "![1000 Trees](https://esempio.org/alberi.jpg)",
    ].join("\n"),
  );
  await arrivano(1);
  await finto.attendi(() => finto.file.length === 2, 5000, "arrivano le due foto che si scaricano");
  assert.deepEqual(finto.ordine.slice(-3), [
    "testo:Tre tappe:\n\n1. Tempio del Buddha di Giada · 1 ora\n2. M50 · 1-2 ore",
    "file:immagine-1.jpg",
    "file:immagine-3.jpg",
  ]);
  assert.deepEqual(
    finto.file.map((foto) => [foto.metodo, foto.didascalia, foto.tipo]),
    [
      ["sendPhoto", "Tempio del Buddha di Giada", "image/jpeg"],
      ["sendPhoto", "1000 Trees", "image/jpeg"],
    ],
  );
  assert.deepEqual(finto.file[0]?.contenuto, jpeg);
  assert.equal(chieste.length, 3);
});

test("un file che non si può mandare su Telegram lo dice al proprietario, senza perdere la risposta", async (t) => {
  const { banco, finto, arrivano } = await allestisciLab(t);
  const id = banco.casa.idArgomentoAperto;
  finto.scrive(PROPRIETARIO, "Mandami il video");
  await finche(() => banco.home.inviati.length === 1, "il messaggio arriva alla Home");
  banco.home.emetti({ tipo: "elaborato-mostrato", idArgomento: id, idAmbiente: "centro", nomeAmbiente: "Unraid", percorso: "sparito.mp4" });
  rispondi(banco.home, "Ecco il video.");
  const messaggi = await arrivano(2);
  assert.equal(messaggi[0]?.text, "Ecco il video.");
  assert.match(messaggi[1]?.text ?? "", /^Non sono riuscito a mandarti sparito\.mp4: .*non esiste/);
  assert.equal(finto.file.length, 0);
});

test("la posizione mandata da Telegram arriva alla Home come messaggio, e dal vivo si aggiorna in silenzio", async (t) => {
  const { banco, finto } = await allestisciLab(t);
  const azioni = azioniDellaHome({
    ambienti: banco.ambienti,
    lavori: banco.lavori,
    proposte: banco.proposte,
    home: () => banco.casa,
    agisci: banco.agisci,
    posizione: banco.posizione,
  });
  assert.match(azioni.posizioneDelProprietario().content[0].text, /non ha condiviso/);

  const inizio = Date.now();
  const id = finto.condivide(PROPRIETARIO, 35.69, 139.7003, { precisione: 12, durataS: 900, quando: inizio });
  await finche(() => banco.home.inviati.length === 1, "la posizione arriva alla Home");
  assert.match(banco.home.inviati[0] ?? "", /^📍 La mia posizione: 35\.69000, 139\.70030, precisione ±12 m .*dal vivo/);
  assert.equal(messaggiDelProprietario(banco)[0]?.origine, "telegram");
  assert.match(azioni.posizioneDelProprietario().content[0].text, /35\.69000, 139\.70030.*condivisa da Telegram.*dal vivo/);

  // Spostandosi, la posizione si aggiorna ma la Home non riceve altri messaggi.
  finto.sposta(PROPRIETARIO, id, 35.6905, 139.699, 900, inizio);
  await finche(() => banco.posizione.ultima()?.lat === 35.6905, "il punto nuovo arriva al centro");
  await attesa(150);
  assert.equal(banco.home.inviati.length, 1);
  assert.match(azioni.posizioneDelProprietario().content[0].text, /35\.69050, 139\.69900/);
});

test("i file mandati da Telegram finiscono nella cartella dell'argomento, e la Home li riceve insieme", async (t) => {
  const { banco, finto, arrivano } = await allestisciLab(t, { tempi: { attesaAlbumMs: 200 } });
  const pdf = Buffer.from("%PDF-1.7\nitinerario\n");
  finto.mandaFile(PROPRIETARIO, { come: "document", nome: "Itinerario.pdf", mime: "application/pdf", contenuto: pdf }, { didascalia: "Leggilo" });
  await finche(() => banco.home.inviati.length === 1, "il file arriva alla Home");
  const cartella = banco.casa.cartellaAperta;
  assert.deepEqual(await readFile(join(cartella, "Itinerario.pdf")), pdf);
  assert.match(banco.home.inviati[0] ?? "", /^📎 Ti mando un file da Telegram: «Itinerario\.pdf» \(PDF, 20 byte\), salvato come `Itinerario\.pdf`\./);
  assert.match(banco.home.inviati[0] ?? "", /\nLeggilo$/);
  assert.equal(messaggiDelProprietario(banco)[0]?.origine, "telegram");
  const [conferma] = await arrivano(1);
  assert.equal(conferma?.text, "Ricevuto Itinerario.pdf.");

  // Un album: due foto, e un documento con un nome già preso. Arrivano alla Home in un messaggio solo.
  finto.mandaFile(PROPRIETARIO, { come: "photo", contenuto: Buffer.from([1]) }, { gruppo: "g1" });
  finto.mandaFile(PROPRIETARIO, { come: "photo", contenuto: Buffer.from([2]) }, { gruppo: "g1" });
  finto.mandaFile(PROPRIETARIO, { come: "document", nome: "Itinerario.pdf", mime: "application/pdf", contenuto: Buffer.from("altro") }, { gruppo: "g1" });
  await finche(() => banco.home.inviati.length === 2, "l'album arriva alla Home");
  assert.match(banco.home.inviati[1] ?? "", /^📎 Ti mando 3 file da Telegram:/);
  assert.match(banco.home.inviati[1] ?? "", /salvato come `Itinerario \(2\)\.pdf`/);
  // Il file di prima non è stato toccato.
  assert.deepEqual(await readFile(join(cartella, "Itinerario.pdf")), pdf);
  assert.equal(await readFile(join(cartella, "Itinerario (2).pdf"), "utf8"), "altro");
  const messaggi = await arrivano(2);
  assert.match(messaggi[1]?.text ?? "", /^Ricevuti 3 file: /);
});

test("un lavoro programmato dice su Telegram com'è finito, una volta sola e con il suo titolo; se non c'è nulla da dire, tace", async (t) => {
  const { banco, arrivano, mandati } = await allestisciLab(t);
  const sempre = banco.programmati.crea(
    { titolo: "Backup del NAS", istruzione: "Controlla il backup.", quando: { tipo: "ogni", minuti: 60 }, dove: { tipo: "home" }, avvisa: "sempre" },
    "Proprietario",
  );
  assert.equal(await banco.programmati.eseguiAdesso(sempre.id), undefined);
  rispondi(banco.home, "Il backup è **riuscito**: 12 GB.");
  const [detto] = await arrivano(1);
  assert.equal(detto?.text, "<b>Lavoro programmato «Backup del NAS» (Home)</b>\n\nIl backup è <b>riuscito</b>: 12 GB.");
  // L'avviso solito della Home («ha finito») non si aggiunge.
  await attesa(200);
  assert.equal(mandati().length, 1);

  const seServe = banco.programmati.crea(
    { titolo: "Dischi", istruzione: "Controlla i dischi.", quando: { tipo: "ogni", minuti: 60 }, dove: { tipo: "home" }, avvisa: "se-serve" },
    "Proprietario",
  );
  // Nella Home c'è l'argomento dell'altro lavoro: viene archiviato, e questo lavora in uno suo.
  const diPrima = banco.home;
  assert.equal(await banco.programmati.eseguiAdesso(seServe.id), undefined);
  banco.casa.richiediCambio({ titolo: "Backup del NAS", riassunto: "Il controllo del backup." });
  diPrima.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 1 });
  await finche(() => banco.home !== diPrima && banco.home.inviati.length === 1, "il lavoro parte nel suo argomento");
  rispondi(banco.home, "NULLA DA SEGNALARE");
  await attesa(250);
  assert.equal(mandati().length, 1);
  assert.equal(banco.programmati.stato().lavori[1]?.ultima?.esito, "nulla-da-segnalare");

  // Un errore arriva comunque.
  assert.equal(await banco.programmati.eseguiAdesso(seServe.id), undefined);
  banco.home.emetti({ tipo: "turno-concluso", riuscito: false, durataMs: 1, errore: "Limite del piano raggiunto." });
  assert.equal((await arrivano(2))[1]?.text, "<b>Lavoro programmato «Dischi» (Home): si è fermato</b>\n\nLimite del piano raggiunto.");
});

test("la proposta di un lavoro programmato si conferma anche da Telegram", async (t) => {
  const { banco, finto, arrivano } = await allestisciLab(t);
  const inCorso = banco.comuniDellaHome("programma_lavoro", {
    titolo: "Aggiornamenti",
    istruzione: "Guarda se ci sono aggiornamenti.",
    quando: { tipo: "giorni", ora: "09:00", giorni: ["lun"] },
  });
  const [scheda] = await arrivano(1);
  assert.match(scheda?.text ?? "", /^<b>La Home: lavoro programmato da confermare<\/b>\n«Aggiornamenti»: lun alle 09:00 \(Europe\/Rome\), nella Home; ti avvisa ogni volta\.\n<pre>Guarda se ci sono aggiornamenti\.<\/pre>/);
  assert.deepEqual(scheda?.pulsanti.flat().map((pulsante) => pulsante.text), ["Conferma", "Annulla"]);
  finto.preme(PROPRIETARIO, scheda?.message_id ?? 0, scheda?.pulsanti[0]?.[0]?.callback_data ?? "");
  const esito = await inCorso;
  assert.equal(esito.errore, undefined, esito.testo);
  assert.equal(banco.programmati.stato().lavori[0]?.titolo, "Aggiornamenti");
});

test("gli stessi avvisi arrivano come notifiche dell'app, anche senza Telegram abbinato; le risposte date su Telegram no", async (t) => {
  const { banco, finto, arrivano } = await allestisciLab(t, { tempi: { lavoroLungoMs: 300 } });
  banco.notifiche.iscrivi(
    { endpoint: "https://web.push.apple.com/telefono", keys: { p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString("base64url"), auth: Buffer.alloc(16, 2).toString("base64url") } },
    "iPhone",
  );
  const progetto = await banco.lavori.crea("Blog", "centro", "Provare un blog.");
  const conversazione = banco.conversazioniLocali[0];
  assert.ok(conversazione);
  const avvisi = () => banco.notificheMandate.map((una) => una.avviso);

  rispondi(conversazione, "Fatto: il blog gira su `localhost:8080`.");
  await finche(() => avvisi().length === 1, "la fine del lavoro arriva all'app");
  assert.deepEqual(avvisi()[0], { titolo: "Il progetto «Blog» ha finito", corpo: "Fatto: il blog gira su `localhost:8080`.", vai: `/progetti/${progetto.id}`, urgente: false });

  // Un consenso da dare: urgente, in testo semplice, e porta al progetto.
  banco.lavori.invia(progetto.id, "Pubblica");
  conversazione.emetti({ tipo: "permesso-richiesto", idPermesso: "p1", idAzione: "a1", strumento: "Bash", ingresso: { command: "git push && echo <fatto>" } });
  await finche(() => avvisi().length === 2, "la richiesta arriva all'app");
  assert.equal(avvisi()[1]?.titolo, "Il progetto «Blog» chiede il tuo consenso");
  assert.equal(avvisi()[1]?.urgente, true);
  assert.match(avvisi()[1]?.corpo ?? "", /git push && echo <fatto>/);
  assert.doesNotMatch(avvisi()[1]?.corpo ?? "", /<pre>|&lt;|<b>/);
  await arrivano(2);

  // Ciò che il proprietario scrive da Telegram ha la sua risposta su Telegram, non una notifica in più.
  finto.scrive(PROPRIETARIO, "Che ore sono?");
  await finche(() => banco.home.inviati.length === 1, "il messaggio arriva alla Home");
  rispondi(banco.home, "Le dieci.");
  await arrivano(3);
  await attesa(150);
  assert.equal(avvisi().length, 2);
});

test("senza Telegram abbinato le notifiche dell'app partono lo stesso", async (t) => {
  const { banco, mandati } = await allestisciLab(t, { abbinato: false });
  banco.notifiche.iscrivi(
    { endpoint: "https://web.push.apple.com/telefono", keys: { p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString("base64url"), auth: Buffer.alloc(16, 2).toString("base64url") } },
    "iPhone",
  );
  await banco.lavori.crea("Blog", "centro", "Provare un blog.");
  const conversazione = banco.conversazioniLocali[0];
  assert.ok(conversazione);
  conversazione.emetti({ tipo: "permesso-richiesto", idPermesso: "p1", idAzione: "a1", strumento: "Bash", ingresso: { command: "ls" } });
  await finche(() => banco.notificheMandate.length === 1, "la richiesta arriva all'app");
  assert.equal(banco.notificheMandate[0]?.avviso.titolo, "Il progetto «Blog» chiede il tuo consenso");
  assert.equal(mandati().length, 0);
});

test("il proprietario sceglie che cosa arriva su Telegram e che cosa all'app; ciò che nasce su Telegram resta lì", async (t) => {
  const { banco, finto, arrivano, mandati } = await allestisciLab(t, { tempi: { lavoroLungoMs: 300 } });
  banco.notifiche.iscrivi(
    { endpoint: "https://web.push.apple.com/telefono", keys: { p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString("base64url"), auth: Buffer.alloc(16, 2).toString("base64url") } },
    "iPhone",
  );
  // I lavori finiti solo all'app; le richieste solo su Telegram, dove hanno i pulsanti.
  banco.notifiche.impostaScelte({ telegram: { lavori: false }, app: { richieste: false } });
  const progetto = await banco.lavori.crea("Blog", "centro", "Provare un blog.");
  const conversazione = banco.conversazioniLocali[0];
  assert.ok(conversazione);
  const avvisi = () => banco.notificheMandate.map((una) => una.avviso.titolo);

  rispondi(conversazione, "Fatto.");
  await finche(() => avvisi().length === 1, "la fine del lavoro arriva all'app");
  await attesa(150);
  assert.equal(mandati().length, 0, "su Telegram non arriva");

  banco.lavori.invia(progetto.id, "Pubblica");
  conversazione.emetti({ tipo: "permesso-richiesto", idPermesso: "p1", idAzione: "a1", strumento: "Bash", ingresso: { command: "git push" } });
  assert.match((await arrivano(1))[0]?.text ?? "", /chiede il tuo consenso/);
  await attesa(150);
  assert.deepEqual(avvisi(), ["Il progetto «Blog» ha finito"]);

  // Spente anche su Telegram: una richiesta nata da un messaggio scritto su Telegram arriva lì lo stesso.
  banco.notifiche.impostaScelte({ telegram: { richieste: false } });
  finto.scrive(PROPRIETARIO, "Riavvia il NAS");
  await finche(() => banco.home.inviati.length === 1, "il messaggio arriva alla Home");
  banco.home.emetti({ tipo: "permesso-richiesto", idPermesso: "p2", idAzione: "a2", strumento: "Bash", ingresso: { command: "reboot" } });
  assert.match((await arrivano(2))[1]?.text ?? "", /La Home chiede il tuo consenso/);

  // Tolto l'ultimo dispositivo, su Telegram torna tutto.
  banco.notifiche.togli("https://web.push.apple.com/telefono");
  conversazione.emetti({ tipo: "permesso-deciso", idPermesso: "p1", decisione: "approvato" });
  rispondi(conversazione, "Pubblicato.");
  assert.match((await arrivano(3))[2]?.text ?? "", /Il progetto «Blog» ha finito/);
});
