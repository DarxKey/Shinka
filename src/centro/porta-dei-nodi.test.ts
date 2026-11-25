/**
 * La porta solo per i nodi (ADR 0065): da lì passa solo il collegamento cifrato che chiede il nome
 * dei nodi, e dentro solo le loro rotte; un nodo sconosciuto si presenta solo con un invito aperto;
 * un nodo accolto riceve l'indirizzo da Internet e lo usa quando quello di sempre non risponde.
 */

import assert from "node:assert/strict";
import { request } from "node:https";
import { connect, createServer, type AddressInfo } from "node:net";
import { connect as connettiTls } from "node:tls";
import { test, type TestContext } from "node:test";
import { allestisci, avviaNodo, avviaNodoAccettato, finche, ID_NODO, type Banco } from "../prove/banco.ts";
import { NOME_TLS_DEI_NODI } from "../protocollo/nodi.ts";
import type { StatoSicurezza } from "../protocollo/sicurezza.ts";
import { InvitiDegliAmbienti } from "./ambiente-nuovo.ts";
import { COOKIE_SESSIONE } from "./centro.ts";
import { NodiDaFuoriDelCentro, PortaDeiNodi } from "./porta-dei-nodi.ts";
import { indirizzoDaFuori } from "../nodo/collegamento.ts";

/**
 * Un banco con la porta solo per i nodi aperta, come al centro vero: `indirizzo` è quello di
 * partenza, `daFuori` sceglie quello da Internet uguale all'indirizzo della porta stessa.
 */
async function conLaPorta(t: TestContext, indirizzo?: string | "la-porta"): Promise<{ banco: Banco; portaNodi: number; inviti: InvitiDegliAmbienti }> {
  const porta = new PortaDeiNodi();
  const inviti = new InvitiDegliAmbienti();
  let annuncia: (daFuori: string | undefined) => void = () => {};
  const nodiDaFuori = new NodiDaFuoriDelCentro(porta, indirizzo === "la-porta" ? undefined : indirizzo, (daFuori) => annuncia(daFuori));
  const banco = await allestisci(t, { inviti, nodiDaFuori });
  annuncia = (daFuori) => banco.ambienti.indirizzoDaFuori(daFuori);
  await banco.centro.listen({ host: "127.0.0.1", port: 0 });
  const portaNodi = await porta.apri(banco.centro.server, 0, "127.0.0.1");
  t.after(() => porta.chiudi());
  nodiDaFuori.scegli(indirizzo === "la-porta" ? `http://127.0.0.1:${portaNodi}` : undefined);
  return { banco, portaNodi, inviti };
}

/** Ciò che rispondono richieste in chiaro sulla stessa connessione: vuoto se si chiude senza risposta. */
function inChiaro(porta: number, righe: string[]): Promise<string> {
  return new Promise((fatto) => {
    let risposta = "";
    const presa = connect({ host: "127.0.0.1", port: porta }, () => {
      presa.write(righe.map((riga, i) => `${riga} HTTP/1.1\r\nHost: x\r\n${i === righe.length - 1 ? "Connection: close\r\n" : ""}\r\n`).join(""));
    });
    setTimeout(() => presa.destroy(), 3_000).unref();
    presa.on("data", (dati) => (risposta += dati.toString()));
    presa.on("error", () => {});
    presa.on("close", () => fatto(risposta));
  });
}

/** Una richiesta cifrata, con il nome chiesto: lo stato della risposta, o "chiuso" se non si arriva a parlare. */
function cifrata(porta: number, percorso: string, nome?: string): Promise<number | "chiuso"> {
  return new Promise((fatto) => {
    const richiesta = request({ host: "127.0.0.1", port: porta, path: percorso, rejectUnauthorized: false, agent: false, ...(nome === undefined ? {} : { servername: nome }) }, (risposta) => {
      risposta.resume();
      fatto(risposta.statusCode ?? 0);
    });
    richiesta.on("error", () => fatto("chiuso"));
    richiesta.end();
  });
}

/** Vero se una stretta di mano TLS con quel nome va a buon fine. */
function strettaRiuscita(porta: number, nome: string | undefined): Promise<boolean> {
  return new Promise((fatto) => {
    const presa = connettiTls({ host: "127.0.0.1", port: porta, rejectUnauthorized: false, ...(nome === undefined ? {} : { servername: nome }) }, () => {
      presa.destroy();
      fatto(true);
    });
    presa.on("error", () => fatto(false));
    presa.on("close", () => fatto(false));
  });
}

/** Una porta su cui non ascolta nessuno. */
async function portaMorta(): Promise<number> {
  const server = createServer();
  await new Promise<void>((fatto) => server.listen(0, "127.0.0.1", fatto));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((fatto) => server.close(() => fatto()));
  return port;
}

test("dalla porta solo per i nodi passa solo il loro collegamento cifrato, e dentro solo le loro rotte", { timeout: 30_000 }, async (t) => {
  const { banco, portaNodi } = await conLaPorta(t, "http://nodi.esempio.it:7853");
  const portaCentro = (banco.centro.server.address() as AddressInfo).port;

  // In chiaro passa solo lo scaricamento dell'installazione, come lo chiede PowerShell; il resto si chiude.
  assert.match(await inChiaro(portaNodi, ["GET /api/ambienti/preparazione?invito=sbagliato"]), /^HTTP\/1\.1 200[\s\S]*L'invito non vale più/);
  assert.equal(await inChiaro(portaNodi, ["GET / "]), "");
  assert.equal(await inChiaro(portaNodi, ["GET /api/nodi/collegamento"]), "");
  assert.equal(await inChiaro(portaNodi, ["POST /api/accesso"]), "");
  // Dopo lo scaricamento, sulla stessa connessione, non si chiede altro.
  const dopo = await inChiaro(portaNodi, ["GET /api/ambienti/preparazione?invito=x", "GET /api/sicurezza"]);
  assert.match(dopo, /HTTP\/1\.1 403[\s\S]*serve solo ai nodi/);
  // Senza il nome dei nodi, o con un altro, la stretta di mano non si fa.
  assert.equal(await strettaRiuscita(portaNodi, undefined), false);
  assert.equal(await strettaRiuscita(portaNodi, "shinka.esempio.it"), false);
  assert.equal(await strettaRiuscita(portaNodi, NOME_TLS_DEI_NODI), true);

  // Con il nome dei nodi: le pagine, le API e l'entrata non ci sono.
  assert.equal(await cifrata(portaNodi, "/", NOME_TLS_DEI_NODI), 403);
  assert.equal(await cifrata(portaNodi, "/api/sicurezza", NOME_TLS_DEI_NODI), 403);
  assert.equal(await cifrata(portaNodi, "/api/accesso", NOME_TLS_DEI_NODI), 403);
  // Lo scaricamento dell'installazione sì: con un invito che non vale risponde lo script che lo dice.
  assert.equal(await cifrata(portaNodi, "/api/ambienti/preparazione?invito=sbagliato", NOME_TLS_DEI_NODI), 200);

  // Lo stesso vale sulla porta di sempre per chi chiede il nome dei nodi, come chi passa da un ponte;
  // chi apre Shinka senza quel nome la trova come prima.
  assert.equal(await cifrata(portaCentro, "/api/sicurezza", NOME_TLS_DEI_NODI), 403);
  assert.equal(await cifrata(portaCentro, "/api/sicurezza"), 401);

  // La pagina Sicurezza dice la porta e l'indirizzo da Internet, e il registro le richieste rifiutate.
  const sicurezza = (await banco.centro.inject({ method: "GET", url: "/api/sicurezza", cookies: { [COOKIE_SESSIONE]: await banco.entra() } })).json<StatoSicurezza>();
  assert.equal(sicurezza.nodi?.porta, portaNodi);
  assert.equal(sicurezza.nodi?.daFuori, "http://nodi.esempio.it:7853");
  assert.ok(sicurezza.voci.some((voce) => voce.tipo === "fuori-dai-nodi"));
});

test("da Internet un nodo sconosciuto si presenta solo mentre c'è un invito aperto", { timeout: 30_000 }, async (t) => {
  const { banco, portaNodi, inviti } = await conLaPorta(t);
  const senzaInvito = await avviaNodo(t, banco, { centro: `http://127.0.0.1:${portaNodi}` });
  await finche(() => senzaInvito.stati.some((stato) => stato.stato === "rifiutato"), "il nodo sconosciuto è rifiutato");
  assert.equal(banco.ambienti.stato().richieste.length, 0, "non resta nemmeno in attesa");
  const voci = (await banco.centro.inject({ method: "GET", url: "/api/sicurezza", cookies: { [COOKIE_SESSIONE]: await banco.entra() } })).json<StatoSicurezza>().voci;
  assert.ok(voci.some((voce) => voce.tipo === "nodo-da-fuori-rifiutato"));
  senzaInvito.collegamento.ferma();

  // Con un invito aperto, preparato dal proprietario, si presenta e aspetta il consenso come sempre.
  inviti.crea({ sistema: "linux", centro: `http://127.0.0.1:${portaNodi}`, nome: "PC ATES" });
  const conInvito = await avviaNodoAccettato(t, banco, { centro: `http://127.0.0.1:${portaNodi}` });
  assert.ok(conInvito.stati.some((stato) => stato.stato === "attivo"));
  assert.equal(banco.ambienti.stato().ambienti.find((ambiente) => ambiente.id === ID_NODO)?.cifrato, true);
});

test("un nodo accolto riceve l'indirizzo da Internet, e lo usa quando quello di sempre non risponde", { timeout: 30_000 }, async (t) => {
  const { banco, portaNodi } = await conLaPorta(t, "la-porta");
  const daFuori = `http://127.0.0.1:${portaNodi}`;

  // A casa: il nodo si collega all'indirizzo di sempre, e ricorda quello da Internet con l'impronta.
  const ricordati: (string | undefined)[] = [];
  let impronta: string | undefined;
  const aCasa = await avviaNodoAccettato(t, banco, { collegamento: { alDaFuori: (indirizzo) => ricordati.push(indirizzo), alImpronta: (vista) => (impronta = vista) } });
  await finche(() => ricordati.length === 1, "il nodo ricorda l'indirizzo da Internet");
  assert.deepEqual(ricordati, [daFuori]);
  assert.ok(impronta !== undefined);
  aCasa.collegamento.ferma();
  await finche(() => !banco.ambienti.attivo(ID_NODO), "il nodo si scollega");

  // Fuori casa: l'indirizzo di sempre non risponde, e il nodo passa dalla porta solo per i nodi.
  const fuori = await avviaNodo(t, banco, { centro: `http://127.0.0.1:${await portaMorta()}`, collegamento: { impronta, daFuori } });
  await finche(() => fuori.stati.some((stato) => stato.stato === "attivo"), "il nodo entra da Internet");
  assert.equal(fuori.collegamento.indirizzo, daFuori);

  // Senza un'impronta ricordata l'indirizzo da Internet non si usa: al primo incontro solo quello di sempre.
  fuori.collegamento.ferma();
  await finche(() => !banco.ambienti.attivo(ID_NODO), "il nodo si scollega");
  const nuovo = await avviaNodo(t, banco, { centro: `http://127.0.0.1:${await portaMorta()}`, collegamento: { daFuori } });
  await finche(() => nuovo.stati.filter((stato) => stato.stato === "scollegato").length >= 3, "il nodo riprova");
  assert.ok(!nuovo.stati.some((stato) => stato.stato === "attivo"));
  assert.notEqual(nuovo.collegamento.indirizzo, daFuori);
});

test("l'indirizzo da Internet si accetta solo scritto bene: http o https, con un host e nient'altro", () => {
  assert.equal(indirizzoDaFuori("http://nodi.esempio.it:7853/qualcosa?x=1"), "http://nodi.esempio.it:7853");
  assert.equal(indirizzoDaFuori("https://nodi.esempio.it"), "https://nodi.esempio.it");
  assert.equal(indirizzoDaFuori("ftp://nodi.esempio.it"), undefined);
  assert.equal(indirizzoDaFuori("http://io:segreto@nodi.esempio.it"), undefined);
  assert.equal(indirizzoDaFuori("non un indirizzo"), undefined);
  assert.equal(indirizzoDaFuori(42), undefined);
});

test("l'indirizzo da Internet si cambia dalla pagina Sicurezza, e i nodi collegati lo ricevono subito", { timeout: 30_000 }, async (t) => {
  const { banco } = await conLaPorta(t, "http://centro-prova.esempio:7853");
  const cookies = { [COOKIE_SESSIONE]: await banco.entra() };
  const nodi = async () => (await banco.centro.inject({ method: "GET", url: "/api/sicurezza", cookies })).json<StatoSicurezza>().nodi;
  const cambia = (nodiDaFuori: string | null) => banco.centro.inject({ method: "PUT", url: "/api/impostazioni", cookies, payload: { nodiDaFuori } });
  const ricordati: (string | undefined)[] = [];
  await avviaNodoAccettato(t, banco, { collegamento: { alDaFuori: (indirizzo) => ricordati.push(indirizzo) } });
  await finche(() => ricordati.length === 1, "il nodo riceve quello di partenza");
  assert.deepEqual(ricordati, ["http://centro-prova.esempio:7853"]);
  assert.equal((await nodi())?.daFuoriScelto, undefined);

  // Scritto male non si prende.
  assert.equal((await cambia("ftp://altro")).statusCode, 400);

  // Uno nuovo: lo vede la pagina, e il nodo collegato lo riceve senza ricollegarsi.
  assert.equal((await cambia(" http://nodi.esempio.it:9000/ ")).statusCode, 200);
  await finche(() => ricordati.length === 2, "il nodo riceve quello nuovo");
  assert.equal(ricordati[1], "http://nodi.esempio.it:9000");
  assert.deepEqual(await nodi(), { ...(await nodi()), daFuori: "http://nodi.esempio.it:9000", daFuoriScelto: true, daFuoriDiPartenza: "http://centro-prova.esempio:7853" });

  // Vuoto: nessuno, e il nodo lo dimentica. Poi si torna a quello di partenza.
  await cambia("");
  await finche(() => ricordati.length === 3, "il nodo lo dimentica");
  assert.equal(ricordati[2], undefined);
  assert.equal((await nodi())?.daFuori, undefined);
  await cambia(null);
  await finche(() => ricordati.length === 4, "il nodo riceve di nuovo quello di partenza");
  assert.equal(ricordati[3], "http://centro-prova.esempio:7853");
  assert.equal((await nodi())?.daFuoriScelto, undefined);
});
