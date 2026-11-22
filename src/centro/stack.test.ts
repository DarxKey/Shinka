import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { Registro } from "../gateway/registro.ts";
import { creaGateway } from "../gateway/servizio.ts";
import { StackDiProva } from "../gateway/stack.ts";
import { Operazioni } from "../gateway/uso.ts";
import { Vault } from "../gateway/vault.ts";
import { allestisci, avviaNodoAccettato, finche, ID_NODO, usaStrumento, type Banco } from "../prove/banco.ts";
import { DockerDiProva } from "../prove/docker-di-prova.ts";
import { avviaHostDiProva } from "../prove/host-di-prova.ts";
import type { EventoConversazione } from "../protocollo/eventi.ts";
import { STRUMENTI_COMUNI_SENZA_RICHIESTA } from "../protocollo/strumenti.ts";
import type { Canale } from "./canale.ts";
import { COOKIE_SESSIONE } from "./centro.ts";
import { ClienteGateway } from "./gateway.ts";

const FRASE = "una frase di sblocco di prova";
const PASSWORD = "P4ssword-di-prova-da-non-vedere";
const GETTONE = "gettone-di-prova-del-centro-lungo-quanto-serve";
const RECINTO = { porte: { da: 7900, a: 7999 }, radice: "/mnt/user/appdata/shinka-stack" };

interface Lab {
  banco: Banco;
  docker: DockerDiProva;
  /** L'host per gli stack, com'è scritto nel vault. */
  host: string;
  comandi: string[];
  registro: Registro;
}

/** Un gateway vero con gli stack, un host Docker finto dichiarato host per gli stack, e il centro che gli parla. */
async function allestisciLab(t: TestContext, attesaMs?: number): Promise<Lab> {
  const cartella = await mkdtemp(join(tmpdir(), "shinka-gateway-"));
  const vault = await Vault.apri(join(cartella, "vault.json"), 2 ** 10);
  await vault.imposta(FRASE);
  const registro = await Registro.apri(join(cartella, "registro.jsonl"));
  const app = await creaGateway({
    vault,
    registro,
    operazioni: new Operazioni(vault, registro, attesaMs),
    stack: new StackDiProva(vault, registro),
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
    await rm(cartella, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  const host = `127.0.0.1:${avviato.porta}`;
  await vault.inserisci({ nome: "lab", tipo: "password", utente: "root", host: [host], segreto: PASSWORD, stack: RECINTO });
  const banco = await allestisci(t, { gateway: cliente });
  return { banco, docker, host, comandi: avviato.comandi, registro };
}

type Richiesta = Extract<EventoConversazione, { tipo: "approvazione-richiesta" }>;

function richieste(canale: Canale): Richiesta[] {
  return canale.archiviati.map((archiviato) => archiviato.evento).filter((evento): evento is Richiesta => evento.tipo === "approvazione-richiesta");
}

function decise(canale: Canale): string[] {
  return canale.archiviati.flatMap(({ evento }) => (evento.tipo === "approvazione-decisa" ? [evento.esito] : []));
}

async function decidi(banco: Banco, id: string, decisione: string, conAccesso = true): Promise<number> {
  const risposta = await banco.centro.inject({
    method: "POST",
    url: `/api/approvazioni/${id}`,
    payload: { decisione },
    ...(conAccesso ? { cookies: { [COOKIE_SESSIONE]: await banco.entra() } } : {}),
  });
  return risposta.statusCode;
}

const BLOG = { nome: "prova-blog", servizi: [{ nome: "web", immagine: "nginx:alpine", porte: [{ host: 7900, container: 80 }] }] };

test("gli stack di prova non chiedono consenso; un comando su un host sì", () => {
  for (const nome of ["elenca_stack", "avvia_stack", "leggi_stack", "ferma_stack", "rimuovi_stack"] as const) {
    assert.ok(STRUMENTI_COMUNI_SENZA_RICHIESTA.includes(nome), nome);
  }
  assert.ok(!STRUMENTI_COMUNI_SENZA_RICHIESTA.includes("esegui_su_host"));
});

test("la Home avvia uno stack di prova senza approvazione, e resta annotato nel registro", async (t) => {
  const { banco, docker, host, registro } = await allestisciLab(t);

  const elenco = await banco.comuniDellaHome("elenca_stack", {});
  assert.equal(elenco.errore, undefined, elenco.testo);
  assert.match(elenco.testo, /porte dedicate da 7900 a 7999/);
  assert.match(elenco.testo, /\(nessuno stack\)/);
  assert.match((await banco.comuniDellaHome("elenca_credenziali", {})).testo, /nome: "lab";.*host per gli stack di prova \(porte 7900-7999\)/);

  const avviato = await banco.comuniDellaHome("avvia_stack", { host, ...BLOG });
  assert.equal(avviato.errore, undefined, avviato.testo);
  assert.match(avviato.testo, /Stack "prova-blog" avviato/);
  assert.deepEqual(docker.container.map((uno) => [uno.nome, uno.stato]), [
    ["plex", "running"],
    ["shinka-prova-blog-web-1", "running"],
  ]);
  // Nessuna scheda è comparsa: il proprietario non ha dovuto fare nulla.
  assert.deepEqual(richieste(banco.canale), []);
  assert.equal(banco.canale.sospesi.permessi, 0);
  const voce = registro.ultime(1)[0];
  assert.equal(voce?.esito, "eseguito");
  assert.equal(voce?.conversazione, "Home");
  assert.match(voce?.comando ?? "", /^Stack "prova-blog": avvio/);

  assert.match((await banco.comuniDellaHome("leggi_stack", { host, nome: "prova-blog" })).testo, /pronto/);
  assert.match((await banco.comuniDellaHome("ferma_stack", { host, nome: "prova-blog" })).testo, /fermato/);
  assert.match((await banco.comuniDellaHome("rimuovi_stack", { host, nome: "prova-blog", tieni_dati: true })).testo, /rimosso/);
  assert.deepEqual(docker.container.map((uno) => uno.nome), ["plex"]);

  // Fuori dal recinto il gateway rifiuta, e Claude lo legge.
  const fuori = await banco.comuniDellaHome("avvia_stack", { host, nome: "fuori", servizi: [{ nome: "web", immagine: "nginx", privileged: true }] });
  assert.equal(fuori.errore, true);
  assert.match(fuori.testo, /Rifiutato dal gateway: Il servizio "web" non ha un campo "privileged"/);
  const servizioAltrui = await banco.comuniDellaHome("ferma_stack", { host, nome: "plex" });
  assert.equal(servizioAltrui.errore, true);
  assert.equal(docker.container[0]?.stato, "running");
});

test("fermare un servizio che non è di Shinka chiede l'approvazione: senza, non avviene", async (t) => {
  const { banco, docker, host, comandi, registro } = await allestisciLab(t);
  const argomenti = { credenziale: "lab", host, comando: "docker stop plex" };

  // Il proprietario nega.
  const negato = banco.comuniDellaHome("esegui_su_host", argomenti);
  await finche(() => richieste(banco.canale).length === 1, "la scheda di approvazione compare nella Home");
  const scheda = richieste(banco.canale)[0];
  assert.ok(scheda);
  assert.deepEqual(
    { host: scheda.host, credenziale: scheda.credenziale, comando: scheda.comando },
    { host, credenziale: "lab", comando: "docker stop plex" },
  );
  assert.ok(Date.parse(scheda.scadeIl) > Date.now());
  assert.equal(banco.canale.sospesi.permessi, 1);
  assert.deepEqual(comandi, []);
  // Decide solo il proprietario, e solo ciò che la scheda prevede.
  assert.equal(await decidi(banco, scheda.idApprovazione, "approvata", false), 401);
  assert.equal(await decidi(banco, scheda.idApprovazione, "forse"), 400);
  assert.equal(await decidi(banco, "inventata", "approvata"), 404);
  assert.equal(await decidi(banco, scheda.idApprovazione, "negata"), 200);
  const esitoNegato = await negato;
  assert.equal(esitoNegato.errore, true);
  assert.match(esitoNegato.testo, /Il proprietario ha negato l'approvazione/);
  assert.equal(docker.container[0]?.stato, "running");
  assert.deepEqual(comandi, []);
  assert.equal(banco.canale.sospesi.permessi, 0);
  // Una scheda già decisa non si decide un'altra volta.
  assert.equal(await decidi(banco, scheda.idApprovazione, "approvata"), 404);

  // Il proprietario approva: parte il comando della scheda.
  const approvato = banco.comuniDellaHome("esegui_su_host", argomenti);
  await finche(() => richieste(banco.canale).length === 2, "la seconda scheda compare");
  assert.equal(await decidi(banco, richieste(banco.canale)[1]?.idApprovazione ?? "", "approvata"), 200);
  const esitoApprovato = await approvato;
  assert.equal(esitoApprovato.errore, undefined, esitoApprovato.testo);
  assert.equal(esitoApprovato.testo, "Codice di uscita: 0\nplex");
  assert.equal(docker.container[0]?.stato, "exited");
  assert.deepEqual(comandi, ["docker stop plex"]);
  assert.deepEqual(decise(banco.canale), ["negata", "approvata"]);
  assert.deepEqual(
    registro.ultime(2).map((voce) => [voce.esito, voce.comando, voce.motivo]),
    [
      ["eseguito", "docker stop plex", "Approvato dal proprietario."],
      ["rifiutato", "docker stop plex", "Il proprietario ha negato l'approvazione: il comando non è stato eseguito."],
    ],
  );
  // L'identificativo con cui il gateway conosce l'attesa non esce dal centro.
  assert.ok(!JSON.stringify(banco.canale.archiviati).includes('"approvazione":'));
});

test("un'approvazione che non arriva in tempo scade, e il comando non parte", async (t) => {
  const { banco, docker, host, comandi } = await allestisciLab(t, 150);
  const esito = await banco.comuniDellaHome("esegui_su_host", { credenziale: "lab", host, comando: "docker stop plex" });
  assert.equal(esito.errore, true);
  assert.match(esito.testo, /non è arrivata in tempo|non c'è più/);
  assert.deepEqual(decise(banco.canale), ["scaduta"]);
  assert.equal(await decidi(banco, richieste(banco.canale)[0]?.idApprovazione ?? "", "approvata"), 404);
  assert.equal(docker.container[0]?.stato, "running");
  assert.deepEqual(comandi, []);
});

test("il consenso dato dalla scheda dei permessi vale come approvazione, per quel comando e una volta sola", async (t) => {
  const { banco, docker, host, comandi } = await allestisciLab(t);
  const argomenti = { credenziale: "lab", host, comando: "docker stop plex" };
  const cookies = { [COOKIE_SESSIONE]: await banco.entra() };

  // La conversazione chiede il permesso per il comando, e il proprietario lo dà dall'interfaccia.
  banco.home.emetti({ tipo: "permesso-richiesto", idPermesso: "p1", idAzione: "a1", strumento: "mcp__shinka__esegui_su_host", ingresso: argomenti });
  const consenso = await banco.centro.inject({ method: "POST", url: "/api/home/permessi/p1", cookies, payload: { decisione: "approvato" } });
  assert.equal(consenso.statusCode, 200);

  const esito = await banco.comuniDellaHome("esegui_su_host", argomenti);
  assert.equal(esito.errore, undefined, esito.testo);
  assert.equal(docker.container[0]?.stato, "exited");
  // Non gli è stato chiesto due volte.
  assert.deepEqual(richieste(banco.canale), []);

  // Lo stesso comando un'altra volta, senza un nuovo consenso, chiede l'approvazione.
  const dinuovo = banco.comuniDellaHome("esegui_su_host", argomenti);
  await finche(() => richieste(banco.canale).length === 1, "la scheda compare");
  assert.equal(await decidi(banco, richieste(banco.canale)[0]?.idApprovazione ?? "", "negata"), 200);
  assert.equal((await dinuovo).errore, true);

  // Il consenso a un comando non vale per un altro, e un consenso negato non vale.
  banco.home.emetti({ tipo: "permesso-richiesto", idPermesso: "p2", idAzione: "a2", strumento: "mcp__shinka__esegui_su_host", ingresso: argomenti });
  await banco.centro.inject({ method: "POST", url: "/api/home/permessi/p2", cookies, payload: { decisione: "approvato" } });
  const altro = banco.comuniDellaHome("esegui_su_host", { ...argomenti, comando: "docker rm -f plex" });
  await finche(() => richieste(banco.canale).length === 2, "per un altro comando la scheda compare");
  assert.equal(richieste(banco.canale)[1]?.comando, "docker rm -f plex");
  assert.equal(await decidi(banco, richieste(banco.canale)[1]?.idApprovazione ?? "", "negata"), 200);
  await altro;

  banco.home.emetti({ tipo: "permesso-richiesto", idPermesso: "p3", idAzione: "a3", strumento: "mcp__shinka__esegui_su_host", ingresso: { ...argomenti, comando: "docker start plex" } });
  await banco.centro.inject({ method: "POST", url: "/api/home/permessi/p3", cookies, payload: { decisione: "negato" } });
  const negato = banco.comuniDellaHome("esegui_su_host", { ...argomenti, comando: "docker start plex" });
  await finche(() => richieste(banco.canale).length === 3, "dopo un consenso negato la scheda compare");
  assert.equal(await decidi(banco, richieste(banco.canale)[2]?.idApprovazione ?? "", "negata"), 200);
  await negato;
  assert.deepEqual(comandi, ["docker stop plex"]);
});

test("un progetto in un altro ambiente gestisce i suoi stack da sé, e per il resto aspetta il proprietario", async (t) => {
  const { banco, docker, host, registro } = await allestisciLab(t);
  const nodo = await avviaNodoAccettato(t, banco);
  const progetto = await banco.lavori.crea("Blog", ID_NODO, "Provare un blog in un container.");
  await finche(() => nodo.conversazioni.length === 1, "la conversazione del progetto nasce sul nodo");
  const remota = nodo.conversazioni[0];
  assert.ok(remota);
  const canale = banco.lavori.canale(progetto.id);
  assert.ok(canale);

  const senzaRichiesta = remota.configurazione?.strumentiSenzaRichiesta ?? [];
  assert.ok(senzaRichiesta.includes("mcp__shinka__avvia_stack"));
  assert.ok(senzaRichiesta.includes("mcp__shinka__rimuovi_stack"));
  assert.match(remota.configurazione?.istruzioniAggiunte ?? "", /# Stack di prova/);

  const avviato = await usaStrumento(remota, "avvia_stack", { host, ...BLOG });
  assert.equal(avviato.errore, false, avviato.testo);
  assert.equal(docker.container[1]?.nome, "shinka-prova-blog-web-1");
  assert.equal(registro.ultime(1)[0]?.conversazione, 'Progetto "Blog"');
  assert.deepEqual(richieste(canale), []);

  const chiesto = usaStrumento(remota, "esegui_su_host", { credenziale: "lab", host, comando: "docker stop plex" });
  await finche(() => richieste(canale).length === 1, "la scheda compare nella conversazione del progetto");
  // Il progetto risulta in attesa del proprietario, e nella Home non compare nulla.
  assert.equal(banco.lavori.stato().progetti.find((uno) => uno.id === progetto.id)?.condizione, "aspetta-te");
  assert.deepEqual(richieste(banco.canale), []);
  assert.equal(await decidi(banco, richieste(canale)[0]?.idApprovazione ?? "", "approvata"), 200);
  const esito = await chiesto;
  assert.equal(esito.errore, false, esito.testo);
  assert.equal(docker.container[0]?.stato, "exited");
  assert.notEqual(banco.lavori.stato().progetti.find((uno) => uno.id === progetto.id)?.condizione, "aspetta-te");
});

test("un campo che la descrizione non prevede arriva al gateway, che lo rifiuta: non viene tolto in silenzio", async (t) => {
  const { banco } = await allestisciLab(t);
  await banco.lavori.crea("Locale", "centro", "Un progetto nell'ambiente del centro.").catch(() => undefined);
  const nodo = await avviaNodoAccettato(t, banco);
  await banco.lavori.crea("Blog", ID_NODO, "Provare un blog in un container.");
  await finche(() => nodo.conversazioni.length === 1, "la conversazione del progetto nasce sul nodo");
  const gruppo = nodo.conversazioni[0]?.configurazione?.strumentiNostri?.().shinka;
  assert.ok(gruppo !== undefined && gruppo.type === "sdk");
  const registrati = (gruppo.instance as unknown as { _registeredTools: Record<string, { inputSchema?: { parse(valore: unknown): unknown } }> })._registeredTools;
  const schema = registrati.avvia_stack?.inputSchema;
  assert.ok(schema, "lo strumento avvia_stack ha il suo schema");
  const letto = schema.parse({
    host: "nas.lan",
    nome: "prova",
    servizi: [{ nome: "web", immagine: "nginx", privileged: true, porte: [{ host: 7900, container: 80, ip: "0.0.0.0" }] }],
  }) as { servizi: { privileged?: unknown; porte: { ip?: unknown }[] }[] };
  assert.equal(letto.servizi[0]?.privileged, true);
  assert.equal(letto.servizi[0]?.porte[0]?.ip, "0.0.0.0");
});
