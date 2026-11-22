import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import type { EsitoBrowser, RichiestaBrowser } from "../protocollo/vault.ts";
import { browserDiProva } from "../prove/browser-di-prova.ts";
import { avviaSitoDiProva, type OpzioniSitoDiProva, type SitoDiProva } from "../prove/sito-di-prova.ts";
import { BrowserDelGateway } from "./browser.ts";
import { Registro } from "./registro.ts";
import { Vault } from "./vault.ts";

const FRASE = "una frase di sblocco di prova";
const UTENTE = "mario@esempio.it";
const PASSWORD = "P4ss di-prova&da=non+vedere";
const COSTO = 2 ** 10;

const disponibile = browserDiProva();
const salta = disponibile === undefined ? "su questa macchina non c'è un browser per la prova" : false;

interface Banco {
  vault: Vault;
  registro: Registro;
  browser: BrowserDelGateway;
  fileRegistro: string;
  /** Tutto ciò che il browser ha restituito, per controllare che il valore non ci sia mai. */
  restituito: EsitoBrowser[];
  fai(richiesta: Omit<Extract<RichiestaBrowser, { operazione: "apri" }>, "conversazione" | "chiave">): Promise<EsitoBrowser>;
  fai(richiesta: Omit<Extract<RichiestaBrowser, { operazione: "leggi" }>, "conversazione" | "chiave">): Promise<EsitoBrowser>;
  fai(richiesta: Omit<Extract<RichiestaBrowser, { operazione: "agisci" }>, "conversazione" | "chiave">): Promise<EsitoBrowser>;
  fai(richiesta: Omit<Extract<RichiestaBrowser, { operazione: "inserisci" }>, "conversazione" | "chiave">): Promise<EsitoBrowser>;
  fai(richiesta: Omit<Extract<RichiestaBrowser, { operazione: "chiudi" }>, "conversazione" | "chiave">): Promise<EsitoBrowser>;
}

async function banco(t: TestContext, vietato?: (indirizzo: URL) => boolean): Promise<Banco> {
  const cartella = await mkdtemp(join(tmpdir(), "shinka-browser-"));
  const fileRegistro = join(cartella, "registro.jsonl");
  const vault = await Vault.apri(join(cartella, "vault.json"), COSTO);
  await vault.imposta(FRASE);
  const registro = await Registro.apri(fileRegistro);
  const browser = new BrowserDelGateway(vault, registro, {
    profilo: join(cartella, "browser"),
    ...disponibile,
    ...(vietato === undefined ? {} : { vietato }),
  });
  t.after(async () => {
    await browser.spegni();
    await rm(cartella, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  const restituito: EsitoBrowser[] = [];
  return {
    vault,
    registro,
    browser,
    fileRegistro,
    restituito,
    fai: async (richiesta: object) => {
      const esito = await browser.esegui({ conversazione: "Home", chiave: "home:prova", ...richiesta } as RichiestaBrowser);
      restituito.push(esito);
      return esito;
    },
  };
}

async function sito(t: TestContext, opzioni: Partial<OpzioniSitoDiProva> = {}): Promise<SitoDiProva> {
  const avviato = await avviaSitoDiProva({ utente: UTENTE, password: PASSWORD, ...opzioni });
  t.after(() => avviato.chiudi());
  return avviato;
}

function testoDi(esito: EsitoBrowser): string {
  if (esito.esito !== "fatto") assert.fail(`${esito.esito}: ${esito.motivo}`);
  return esito.testo;
}

function motivoDi(esito: EsitoBrowser, atteso: "rifiutato" | "fallito" = "rifiutato"): string {
  if (esito.esito === "fatto") assert.fail(`doveva essere ${atteso}, invece è stato fatto:\n${esito.testo}`);
  assert.equal(esito.esito, atteso, esito.motivo);
  return esito.motivo;
}

/** Il riferimento di un elemento, letto dal testo della pagina come lo leggerebbe Claude. */
function riferimento(testo: string, ruolo: string, nome: string): string {
  const trovato = new RegExp(`- ${ruolo} "${nome}"[^\\n]*\\[ref=(\\w+)\\]`).exec(testo)?.[1];
  assert.ok(trovato, `nella pagina non c'è ${ruolo} "${nome}":\n${testo}`);
  return trovato;
}

/** Né ciò che è tornato a Claude né il registro portano la password, comunque sia scritta. */
async function maiVista(b: Banco): Promise<void> {
  const scritture = [PASSWORD, encodeURIComponent(PASSWORD), encodeURIComponent(PASSWORD).replace(/%20/g, "+")];
  const tutto = `${JSON.stringify(b.restituito.map((esito) => ({ ...esito, immagine: undefined })))}\n${await readFile(b.fileRegistro, "utf8").catch(() => "")}`;
  for (const scrittura of scritture) assert.ok(!tutto.includes(scrittura), `il valore compare in ciò che è uscito dal gateway: ${scrittura}`);
}

test("Claude entra in un sito con una credenziale del vault senza vederla", { skip: salta }, async (t) => {
  const b = await banco(t);
  const s = await sito(t);
  await b.vault.inserisci({ nome: "sito-prova", tipo: "sito", utente: UTENTE, host: [s.origine], segreto: PASSWORD });

  const aperta = testoDi(await b.fai({ operazione: "apri", indirizzo: s.origine }));
  assert.match(aperta, /Pagina: Sito di prova: accesso/);
  assert.match(aperta, /textbox "Password"/);

  const inserita = testoDi(await b.fai({ operazione: "inserisci", credenziale: "sito-prova" }));
  assert.match(inserita, /ha inserito nome utente e password della credenziale "sito-prova"/);
  assert.match(inserita, new RegExp(`textbox "Nome utente"[^\\n]*: ${UTENTE}`));
  assert.match(inserita, /textbox "Password"[^\n]*: \[nascosto\]/);

  const dentro = testoDi(await b.fai({ operazione: "agisci", azione: "clicca", elemento: riferimento(inserita, "button", "Entra") }));
  assert.match(dentro, /Benvenuto, mario@esempio\.it/);
  assert.match(dentro, /Indirizzo: http:\/\/127\.0\.0\.1:\d+\/dentro/);

  // Al sito è arrivata la password vera: l'ha scritta il gateway.
  assert.deepEqual(s.tentativi, [{ utente: UTENTE, password: PASSWORD }]);

  const voce = b.registro.ultime(1)[0];
  assert.equal(voce?.esito, "eseguito");
  assert.equal(voce?.credenziale, "sito-prova");
  assert.equal(voce?.host, s.origine);
  assert.equal(voce?.nelBrowser, true);
  assert.equal(voce?.conversazione, "Home");
  assert.ok(b.vault.elenco()[0]?.usataIl);
  await maiVista(b);
});

test("una credenziale inserita per un sito viene rifiutata in un altro, senza toccarne i campi", { skip: salta }, async (t) => {
  const b = await banco(t);
  const previsto = await sito(t);
  const altro = await sito(t, { nome: "Sito sosia" });
  await b.vault.inserisci({ nome: "sito-prova", tipo: "sito", utente: UTENTE, host: [previsto.origine], segreto: PASSWORD });

  const aperta = testoDi(await b.fai({ operazione: "apri", indirizzo: altro.origine }));
  const motivo = motivoDi(await b.fai({ operazione: "inserisci", credenziale: "sito-prova" }));
  assert.match(motivo, /non è prevista per il sito http:\/\/127\.0\.0\.1:\d+: vale solo per/);

  // Nei campi del sito sbagliato non è stato scritto nulla, nemmeno il nome utente.
  const riletta = testoDi(await b.fai({ operazione: "leggi" }));
  assert.ok(!riletta.includes(UTENTE));
  assert.doesNotMatch(riletta, /nascosto/);
  await b.fai({ operazione: "agisci", azione: "clicca", elemento: riferimento(aperta, "button", "Entra") });
  assert.deepEqual(altro.tentativi, [{ utente: "", password: "" }]);
  assert.deepEqual(previsto.tentativi, []);

  const voce = b.registro.ultime(1)[0];
  assert.equal(voce?.esito, "rifiutato");
  assert.equal(voce?.host, altro.origine);
  await maiVista(b);
});

test("conta il sito della cornice che contiene il campo, non quello della pagina intorno", { skip: salta }, async (t) => {
  const b = await banco(t);
  const dentroLaCornice = await sito(t, { nome: "Sito in cornice" });
  const intorno = await sito(t, { altroSito: dentroLaCornice.origine });
  // La credenziale vale per il sito intorno: il campo sta nella cornice di un altro, e non la riceve.
  await b.vault.inserisci({ nome: "intorno", tipo: "sito", utente: UTENTE, host: [intorno.origine], segreto: PASSWORD });
  await b.vault.inserisci({ nome: "cornice", tipo: "sito", utente: UTENTE, host: [dentroLaCornice.origine], segreto: PASSWORD });

  const aperta = testoDi(await b.fai({ operazione: "apri", indirizzo: `${intorno.origine}/cornice` }));
  assert.match(aperta, /iframe/);
  const campo = riferimento(aperta, "textbox", "Password");
  assert.match(campo, /^f\d+e\d+$/);

  assert.match(motivoDi(await b.fai({ operazione: "inserisci", credenziale: "intorno", campoPassword: campo })), /non è prevista per il sito/);
  // Quella del sito in cornice invece sì, anche se la pagina intorno è di un altro.
  const inserita = testoDi(await b.fai({ operazione: "inserisci", credenziale: "cornice", campoPassword: campo }));
  assert.match(inserita, new RegExp(`nel sito ${dentroLaCornice.origine}\\.`));
  await maiVista(b);
});

test("la password non si vede nemmeno se il sito la mostra: né nel testo né nell'immagine", { skip: salta }, async (t) => {
  const b = await banco(t);
  const s = await sito(t);
  await b.vault.inserisci({ nome: "sito-prova", tipo: "sito", utente: UTENTE, host: [s.origine], segreto: PASSWORD });

  // Il sito ha un interruttore "Mostra password": il campo diventa di testo.
  const aperta = testoDi(await b.fai({ operazione: "apri", indirizzo: s.origine }));
  await b.fai({ operazione: "inserisci", credenziale: "sito-prova" });
  const mostrata = testoDi(await b.fai({ operazione: "agisci", azione: "clicca", elemento: riferimento(aperta, "checkbox", "Mostra password") }));
  assert.match(mostrata, /textbox "Password"[^\n]*: \[credenziale del vault\]/);
  const conImmagine = await b.fai({ operazione: "leggi", immagine: true });
  assert.equal(conImmagine.esito, "fatto");
  // Il campo è coperto, e l'immagine si fa.
  assert.ok(conImmagine.esito === "fatto" && conImmagine.immagine !== undefined && conImmagine.immagine.length > 1000);

  // Una pagina che ricopia la password in chiaro nel suo testo: il testo esce pulito, l'immagine non si fa.
  await b.fai({ operazione: "apri", indirizzo: `${s.origine}/specchio` });
  const copiata = testoDi(await b.fai({ operazione: "inserisci", credenziale: "sito-prova" }));
  assert.match(copiata, /Stai scrivendo: \[nascosto\]/);
  const senzaImmagine = await b.fai({ operazione: "leggi", immagine: true });
  assert.ok(senzaImmagine.esito === "fatto" && senzaImmagine.immagine === undefined);
  assert.match(testoDi(senzaImmagine), /Immagine non fatta: la pagina mostra il valore di una credenziale/);

  // Un modulo che manda la password nell'indirizzo: nell'indirizzo e nella pagina non si legge.
  await b.fai({ operazione: "apri", indirizzo: `${s.origine}/nell-indirizzo` });
  const prima = testoDi(await b.fai({ operazione: "inserisci", credenziale: "sito-prova" }));
  const ricevuto = testoDi(await b.fai({ operazione: "agisci", azione: "clicca", elemento: riferimento(prima, "button", "Entra") }));
  assert.match(ricevuto, /Indirizzo: http:\/\/127\.0\.0\.1:\d+\/ricevuto\?utente=.*password=\[credenziale del vault\]/);
  assert.match(ricevuto, /Hai chiesto: \/ricevuto\?utente=.*password=\[credenziale del vault\]/);
  await maiVista(b);
});

test("in un campo password scrive solo il vault, e il valore di una credenziale non si scrive altrove", { skip: salta }, async (t) => {
  const b = await banco(t);
  const s = await sito(t);
  await b.vault.inserisci({ nome: "sito-prova", tipo: "sito", utente: UTENTE, host: [s.origine], segreto: PASSWORD });

  const aperta = testoDi(await b.fai({ operazione: "apri", indirizzo: s.origine }));
  const password = riferimento(aperta, "textbox", "Password");
  const utente = riferimento(aperta, "textbox", "Nome utente");
  assert.match(motivoDi(await b.fai({ operazione: "agisci", azione: "scrivi", elemento: password, testo: "una-password-dettata" })), /scrive solo il vault/);
  // Il proprietario ha scritto la password in chat e Claude prova a usarla in un campo qualsiasi.
  b.restituito.length = 0;
  assert.match(motivoDi(await b.fai({ operazione: "agisci", azione: "scrivi", elemento: utente, testo: PASSWORD })), /è il valore di una credenziale del vault/);
  // Il campo indicato per la password non è un campo password: lì si vedrebbe.
  assert.match(motivoDi(await b.fai({ operazione: "inserisci", credenziale: "sito-prova", campoPassword: utente })), /non è un campo password/);
  // Una credenziale per SSH non entra in un sito.
  await b.vault.inserisci({ nome: "nas", tipo: "password", utente: "root", host: ["192.168.1.10"], segreto: "altra-password-di-prova" });
  assert.match(motivoDi(await b.fai({ operazione: "inserisci", credenziale: "nas" })), /serve per i comandi sugli host/);
  assert.deepEqual(s.tentativi, []);
  await maiVista(b);
});

test("i divieti fissi valgono anche nei siti: pagare, cambiare password, cancellare l'account", { skip: salta }, async (t) => {
  const b = await banco(t);
  const s = await sito(t);
  await b.vault.inserisci({ nome: "sito-prova", tipo: "sito", utente: UTENTE, host: [s.origine], segreto: PASSWORD });

  await b.fai({ operazione: "apri", indirizzo: s.origine });
  const inserita = testoDi(await b.fai({ operazione: "inserisci", credenziale: "sito-prova" }));
  const dentro = testoDi(await b.fai({ operazione: "agisci", azione: "clicca", elemento: riferimento(inserita, "button", "Entra") }));

  assert.match(motivoDi(await b.fai({ operazione: "agisci", azione: "clicca", elemento: riferimento(dentro, "button", "Paga ora") })), /Divieto fisso: pagare/);
  assert.equal(b.registro.ultime(1)[0]?.esito, "rifiutato");
  assert.equal(b.registro.ultime(1)[0]?.credenziale, "");
  assert.match(b.registro.ultime(1)[0]?.comando ?? "", /Clic su "Paga ora"/);
  assert.match(
    motivoDi(await b.fai({ operazione: "agisci", azione: "scrivi", elemento: riferimento(dentro, "textbox", "Numero della carta"), testo: "4111111111111111" })),
    /Divieto fisso: pagare/,
  );
  // Invio in un campo del modulo di pagamento lo invierebbe: stesso divieto.
  assert.match(
    motivoDi(await b.fai({ operazione: "agisci", azione: "scrivi", elemento: riferimento(dentro, "textbox", "Note per la consegna"), testo: "citofono rotto", invio: true })),
    /Divieto fisso: pagare/,
  );
  assert.match(motivoDi(await b.fai({ operazione: "agisci", azione: "clicca", elemento: riferimento(dentro, "link", "Elimina account") })), /Divieto fisso: cancellare un account/);
  assert.match(motivoDi(await b.fai({ operazione: "agisci", azione: "clicca", elemento: riferimento(dentro, "link", "Cambia password") })), /Divieto fisso: cambiare una password/);

  // Anche arrivandoci dall'indirizzo, in un modulo che cambia la password il vault non scrive.
  await b.fai({ operazione: "apri", indirizzo: `${s.origine}/nuova-password` });
  assert.match(motivoDi(await b.fai({ operazione: "inserisci", credenziale: "sito-prova" })), /più campi password/);
  const nuova = testoDi(await b.fai({ operazione: "leggi" }));
  assert.match(
    motivoDi(await b.fai({ operazione: "inserisci", credenziale: "sito-prova", campoPassword: riferimento(nuova, "textbox", "Password attuale") })),
    /Divieto fisso: questo modulo serve a scegliere o cambiare una password/,
  );
  assert.deepEqual(s.inviati, []);

  // Ciò che non è vietato si fa: una ricerca con Invio.
  const tornato = testoDi(await b.fai({ operazione: "apri", indirizzo: `${s.origine}/dentro` }));
  const cercato = testoDi(
    await b.fai({ operazione: "agisci", azione: "scrivi", elemento: riferimento(tornato, "textbox", "Cerca nel sito"), testo: "orari", invio: true }),
  );
  assert.match(cercato, /Richiesta ricevuta: \/cerca/);
  assert.deepEqual(s.inviati, ["/cerca"]);
  await maiVista(b);
});

test("accesso in due passi: prima il nome utente, poi la password", { skip: salta }, async (t) => {
  const b = await banco(t);
  const s = await sito(t);
  await b.vault.inserisci({ nome: "sito-prova", tipo: "sito", utente: UTENTE, host: [s.origine], segreto: PASSWORD });

  await b.fai({ operazione: "apri", indirizzo: `${s.origine}/due-passi` });
  const primo = testoDi(await b.fai({ operazione: "inserisci", credenziale: "sito-prova" }));
  assert.match(primo, /ha inserito il nome utente della credenziale/);
  const secondo = testoDi(await b.fai({ operazione: "agisci", azione: "clicca", elemento: riferimento(primo, "button", "Avanti") }));
  assert.match(secondo, /textbox "Password"/);
  const inserita = testoDi(await b.fai({ operazione: "inserisci", credenziale: "sito-prova" }));
  assert.match(inserita, /ha inserito la password della credenziale/);
  assert.match(testoDi(await b.fai({ operazione: "agisci", azione: "premi", testo: "Invio", elemento: riferimento(inserita, "textbox", "Password") })), /Benvenuto/);
  assert.deepEqual(s.tentativi, [{ utente: UTENTE, password: PASSWORD }]);
  await maiVista(b);
});

test("il browser lavora solo a vault aperto, e la sessione di un sito resta tra una conversazione e l'altra", { skip: salta }, async (t) => {
  const b = await banco(t);
  const s = await sito(t);
  await b.vault.inserisci({ nome: "sito-prova", tipo: "sito", utente: UTENTE, host: [s.origine], segreto: PASSWORD });

  await b.fai({ operazione: "apri", indirizzo: s.origine });
  const inserita = testoDi(await b.fai({ operazione: "inserisci", credenziale: "sito-prova" }));
  await b.fai({ operazione: "agisci", azione: "clicca", elemento: riferimento(inserita, "button", "Entra") });
  assert.match(testoDi(await b.fai({ operazione: "chiudi" })), /Pagina chiusa/);
  assert.match(motivoDi(await b.fai({ operazione: "leggi" })), /non c'è una pagina aperta/);

  // Un'altra conversazione ha la sua scheda, e nel sito si trova già dentro.
  const altra = await b.browser.esegui({ conversazione: 'Progetto "Prova"', chiave: "progetto-1", operazione: "apri", indirizzo: `${s.origine}/dentro` });
  assert.match(testoDi(altra), /Benvenuto/);

  // Il proprietario chiude il vault e lo riapre: il browser è ripartito, il sito ricorda ancora chi è.
  b.vault.chiudi();
  assert.match(motivoDi(await b.fai({ operazione: "apri", indirizzo: s.origine })), /lavora solo a vault aperto/);
  assert.ok(await b.vault.sblocca(FRASE));
  assert.match(motivoDi(await b.fai({ operazione: "leggi" })), /non c'è una pagina aperta/);
  assert.match(testoDi(await b.fai({ operazione: "apri", indirizzo: `${s.origine}/dentro` })), /Benvenuto/);
  assert.equal(s.tentativi.length, 1);
});

test("il browser apre solo siti veri, non le pagine del gateway, e a una domanda della pagina risponde annulla", { skip: salta }, async (t) => {
  const proibito = await sito(t, { nome: "Pagina del gateway" });
  const b = await banco(t, (indirizzo) => indirizzo.origin === proibito.origine);
  const s = await sito(t, { altroSito: proibito.origine });
  await b.vault.inserisci({ nome: "sito-prova", tipo: "sito", utente: UTENTE, host: [s.origine], segreto: PASSWORD });

  assert.match(motivoDi(await b.fai({ operazione: "apri", indirizzo: "file:///etc/passwd" })), /solo indirizzi che cominciano con https/);
  assert.match(motivoDi(await b.fai({ operazione: "apri", indirizzo: `http://utente:parola@127.0.0.1:${s.porta}/` })), /non si scrivono credenziali/);
  assert.match(motivoDi(await b.fai({ operazione: "apri", indirizzo: proibito.origine })), /pagina del gateway/);
  assert.match(motivoDi(await b.fai({ operazione: "agisci", azione: "clicca", elemento: "e1" })), /non c'è una pagina aperta/);

  // Nemmeno dentro una cornice di un altro sito la pagina del gateway si carica.
  const conCornice = testoDi(await b.fai({ operazione: "apri", indirizzo: `${s.origine}/cornice` }));
  assert.ok(!conCornice.includes("Pagina del gateway"));

  const avviso = testoDi(await b.fai({ operazione: "apri", indirizzo: `${s.origine}/avviso` }));
  const dopo = testoDi(await b.fai({ operazione: "agisci", azione: "clicca", elemento: riferimento(avviso, "button", "Chiedi conferma") }));
  assert.match(dopo, /Avviso della pagina, chiuso dal gateway: Sei sicuro\?/);
  assert.match(dopo, /Pagina: annullato/);
  assert.match(motivoDi(await b.fai({ operazione: "agisci", azione: "clicca", elemento: "bottone" })), /non è un riferimento/);
  assert.match(motivoDi(await b.fai({ operazione: "agisci", azione: "clicca", elemento: "e9999" })), /rileggi la pagina/);
});
