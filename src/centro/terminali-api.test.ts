import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test, type TestContext } from "node:test";
import { allestisci, avviaNodoAccettato, finche, ID_NODO, type Banco } from "../prove/banco.ts";
import type { DalBrowserAlTerminale, DalTerminaleAlBrowser } from "../protocollo/terminale.ts";
import { COOKIE_SESSIONE } from "./centro.ts";

async function portaDelCentro(banco: Banco): Promise<number> {
  if (!banco.centro.server.listening) await banco.centro.listen({ host: "127.0.0.1", port: 0 });
  return (banco.centro.server.address() as AddressInfo).port;
}

interface BrowserInProva {
  ricevuti: DalTerminaleAlBrowser[];
  manda(messaggio: DalBrowserAlTerminale): void;
  chiudi(): Promise<void>;
  /** Il codice con cui il collegamento si è chiuso, se si è chiuso. */
  chiuso: number | undefined;
  /** Vero se il collegamento non si è mai aperto. */
  rifiutato: boolean;
}

/** Il terminale di un progetto come lo apre l'interfaccia: un WebSocket con il cookie del proprietario. */
async function collega(
  t: TestContext,
  banco: Banco,
  idProgetto: string,
  opzioni: { senzaSessione?: boolean; origine?: string; scheda?: number } = {},
): Promise<BrowserInProva> {
  const porta = await portaDelCentro(banco);
  const intestazioni: Record<string, string> = { origin: opzioni.origine ?? `http://127.0.0.1:${porta}` };
  if (opzioni.senzaSessione !== true) intestazioni.cookie = `${COOKIE_SESSIONE}=${await banco.entra()}`;
  // Il WebSocket di Node accetta le intestazioni, quello dei tipi del browser no.
  const Socket = WebSocket as unknown as new (indirizzo: string, opzioni: { headers: Record<string, string> }) => WebSocket;
  const socket = new Socket(`ws://127.0.0.1:${porta}/api/progetti/${idProgetto}/terminale${opzioni.scheda === undefined ? "" : `?scheda=${opzioni.scheda}`}`, { headers: intestazioni });
  const browser: BrowserInProva = {
    ricevuti: [],
    manda: (messaggio) => socket.send(JSON.stringify(messaggio)),
    chiudi: async () => {
      socket.close();
      await finche(() => browser.chiuso !== undefined, "il collegamento si chiude");
    },
    chiuso: undefined,
    rifiutato: false,
  };
  let aperto = false;
  socket.addEventListener("open", () => (aperto = true));
  socket.addEventListener("message", (evento) => browser.ricevuti.push(JSON.parse(String(evento.data)) as DalTerminaleAlBrowser));
  socket.addEventListener("close", (evento) => {
    browser.chiuso = evento.code;
    if (!aperto) browser.rifiutato = true;
  });
  socket.addEventListener("error", () => {});
  t.after(() => socket.close());
  await finche(() => aperto || browser.chiuso !== undefined, "il collegamento si apre o viene rifiutato");
  return browser;
}

const di = (browser: BrowserInProva, tipo: DalTerminaleAlBrowser["tipo"]): DalTerminaleAlBrowser[] =>
  browser.ricevuti.filter((messaggio) => messaggio.tipo === tipo);

test("il terminale di un progetto si apre nella sua cartella, nell'ambiente del centro", async (t) => {
  const banco = await allestisci(t);
  const progetto = await banco.lavori.crea("Sito", "centro", "Un sito.");
  const browser = await collega(t, banco, progetto.id);

  // Prima di aprirlo non si può scrivere: non c'è ancora nulla.
  browser.manda({ tipo: "scrivi", dati: "troppo presto" });
  browser.manda({ tipo: "apri", colonne: 90, righe: 30 });
  await finche(() => di(browser, "aperto").length === 1, "il terminale si apre");
  const shell = banco.shellLocali[0];
  assert.ok(shell);
  assert.equal(shell.cartella, banco.progetti.trova(progetto.id)?.cartella);
  assert.deepEqual(shell.misure, [[90, 30]]);
  assert.deepEqual(shell.scritti, []);

  browser.manda({ tipo: "scrivi", dati: "npm run dev\r" });
  browser.manda({ tipo: "misura", colonne: 100, righe: 40 });
  await finche(() => shell.misure.length === 2, "le misure nuove arrivano alla shell");
  assert.deepEqual(shell.scritti, ["npm run dev\r"]);
  assert.deepEqual(shell.misure.at(-1), [100, 40]);

  shell.emetti("in ascolto su http://localhost:5173\r\n");
  await finche(() => di(browser, "uscita").length === 1, "l'uscita arriva al browser");
  assert.deepEqual(di(browser, "uscita")[0], { tipo: "uscita", dati: "in ascolto su http://localhost:5173\r\n" });
});

test("il terminale resta acceso quando la pagina si chiude, e chi torna ritrova ciò che è uscito", async (t) => {
  const banco = await allestisci(t);
  const progetto = await banco.lavori.crea("Sito", "centro", "Un sito.");
  const prima = await collega(t, banco, progetto.id);
  prima.manda({ tipo: "apri", colonne: 80, righe: 24 });
  await finche(() => di(prima, "aperto").length === 1, "il terminale si apre");
  const shell = banco.shellLocali[0];
  assert.ok(shell);
  shell.emetti("prima riga\r\n");
  await finche(() => di(prima, "uscita").length === 1, "l'uscita arriva");
  await prima.chiudi();

  // Nessuno guarda, ma la shell va avanti.
  assert.equal(shell.spenta, false);
  shell.emetti("seconda riga\r\n");

  const dopo = await collega(t, banco, progetto.id);
  dopo.manda({ tipo: "apri", colonne: 80, righe: 24 });
  await finche(() => di(dopo, "aperto").length === 1, "il terminale viene ritrovato");
  assert.deepEqual(di(dopo, "aperto")[0], { tipo: "aperto", finora: "prima riga\r\nseconda riga\r\n" });
  assert.equal(banco.shellLocali.length, 1);

  // Chiuderlo lo spegne davvero, e lo vede anche chi lo stava guardando da un'altra pagina.
  const altro = await collega(t, banco, progetto.id);
  altro.manda({ tipo: "apri", colonne: 80, righe: 24 });
  await finche(() => di(altro, "aperto").length === 1, "anche l'altra pagina lo vede");
  dopo.manda({ tipo: "chiudi" });
  await finche(() => di(dopo, "chiuso").length === 1 && di(altro, "chiuso").length === 1, "tutti vedono la chiusura");
  assert.equal(shell.spenta, true);

  // Riaprirlo ne accende uno nuovo.
  dopo.manda({ tipo: "apri", colonne: 80, righe: 24 });
  await finche(() => di(dopo, "aperto").length === 2, "se ne accende uno nuovo");
  assert.equal(banco.shellLocali.length, 2);
  assert.deepEqual(di(dopo, "aperto")[1], { tipo: "aperto", finora: "" });
});

test("il terminale di un progetto su un nodo gira su quel nodo, e sopravvive alla caduta del collegamento", async (t) => {
  const banco = await allestisci(t);
  const nodo = await avviaNodoAccettato(t, banco);
  const progetto = await banco.lavori.crea("Videogioco", ID_NODO, "Un gioco.");
  const browser = await collega(t, banco, progetto.id);
  browser.manda({ tipo: "apri", colonne: 80, righe: 24 });
  await finche(() => di(browser, "aperto").length === 1, "il terminale si apre sul nodo");
  const shell = nodo.shell[0];
  assert.ok(shell);
  assert.equal(banco.shellLocali.length, 0);
  assert.equal(shell.cartella, banco.progetti.trova(progetto.id)?.cartella);
  assert.ok(shell.cartella.startsWith(nodo.radiceProgetti));

  browser.manda({ tipo: "scrivi", dati: "dir\r" });
  await finche(() => shell.scritti.length === 1, "ciò che si scrive arriva alla shell del nodo");
  shell.emetti("Cartella di C:\\Progetti\r\n");
  await finche(() => di(browser, "uscita").length === 1, "l'uscita torna al browser");

  // Il centro crede che il nodo taccia da troppo e chiude il collegamento: il terminale resta acceso lì.
  banco.ambienti.controllaSilenzi(Date.now() + 10 * 60 * 1000);
  await finche(() => di(browser, "chiuso").length === 1, "il browser viene avvisato");
  assert.match(JSON.stringify(di(browser, "chiuso")[0]), /ancora acceso/);
  assert.equal(shell.spenta, false);
  shell.emetti("intanto il lavoro va avanti\r\n");

  await finche(() => nodo.stati.filter((s) => s.stato === "attivo").length === 2, "il nodo si ricollega");
  browser.manda({ tipo: "apri", colonne: 80, righe: 24 });
  await finche(() => di(browser, "aperto").length === 2, "il terminale viene ritrovato");
  assert.equal(nodo.shell.length, 1);
  assert.match(JSON.stringify(di(browser, "aperto")[1]), /Cartella di C:.*intanto il lavoro va avanti/);

  // Quando il nodo si ferma, i suoi terminali si spengono con lui.
  nodo.lavoro.spegni();
  assert.equal(shell.spenta, true);
});

test("con l'ambiente spento il terminale dice perché non si apre", async (t) => {
  const banco = await allestisci(t);
  const nodo = await avviaNodoAccettato(t, banco);
  const progetto = await banco.lavori.crea("Videogioco", ID_NODO, "Un gioco.");
  nodo.collegamento.ferma();
  await finche(() => !banco.ambienti.attivo(ID_NODO), "l'ambiente risulta spento");

  const browser = await collega(t, banco, progetto.id);
  browser.manda({ tipo: "apri", colonne: 80, righe: 24 });
  await finche(() => di(browser, "chiuso").length === 1, "il browser riceve il motivo");
  assert.match(JSON.stringify(di(browser, "chiuso")[0]), /ambiente del progetto è spento/);
});

test("il terminale si apre solo dall'interfaccia di Shinka, con la sessione del proprietario", async (t) => {
  const banco = await allestisci(t);
  const progetto = await banco.lavori.crea("Sito", "centro", "Un sito.");
  const porta = await portaDelCentro(banco);

  const senzaSessione = await collega(t, banco, progetto.id, { senzaSessione: true });
  assert.equal(senzaSessione.rifiutato, true);

  // Una pagina servita da un'altra porta dello stesso host, come l'anteprima, porta con sé il cookie
  // del proprietario: non per questo può aprire il terminale.
  const daAltrove = await collega(t, banco, progetto.id, { origine: `http://127.0.0.1:${porta + 1}` });
  assert.equal(daAltrove.rifiutato, true);

  const sconosciuto = await collega(t, banco, "progetto-che-non-esiste");
  await finche(() => sconosciuto.chiuso !== undefined, "il collegamento viene chiuso");
  assert.equal(sconosciuto.chiuso, 1008);
  assert.equal(banco.shellLocali.length, 0);
});

test("un progetto ha più terminali, uno per scheda, ciascuno con la sua shell", async (t) => {
  const banco = await allestisci(t);
  const progetto = await banco.lavori.crea("Sito", "centro", "Un sito.");
  const primo = await collega(t, banco, progetto.id);
  const secondo = await collega(t, banco, progetto.id, { scheda: 2 });
  primo.manda({ tipo: "apri", colonne: 80, righe: 24 });
  secondo.manda({ tipo: "apri", colonne: 80, righe: 24 });
  await finche(() => di(primo, "aperto").length === 1 && di(secondo, "aperto").length === 1, "i due terminali si aprono");
  assert.equal(banco.shellLocali.length, 2);
  primo.manda({ tipo: "scrivi", dati: "npm run dev\r" });
  secondo.manda({ tipo: "scrivi", dati: "git status\r" });
  await finche(() => banco.shellLocali.every((shell) => shell.scritti.length === 1), "ciascuno scrive nella sua shell");
  assert.deepEqual(banco.shellLocali.map((shell) => shell.scritti[0]).sort(), ["git status\r", "npm run dev\r"]);
  banco.shellLocali[1]?.emetti("solo nel secondo\r\n");
  await finche(() => di(secondo, "uscita").length === 1, "l'uscita arriva al suo terminale");
  assert.equal(di(primo, "uscita").length, 0);
  // Oltre le schede che un progetto può avere, il terminale non c'è.
  const troppo = await collega(t, banco, progetto.id, { scheda: 9 });
  await finche(() => troppo.chiuso !== undefined, "il collegamento si chiude");
  assert.equal(troppo.chiuso, 1008);
  // Eliminando il progetto si spengono tutti.
  banco.terminali?.spegni(progetto);
  await finche(() => banco.shellLocali.every((shell) => shell.spenta), "le shell si spengono");
});
