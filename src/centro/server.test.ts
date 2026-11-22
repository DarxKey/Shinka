import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { DomandeAlProprietario } from "../gateway/domande.ts";
import { Registro } from "../gateway/registro.ts";
import { creaGateway } from "../gateway/servizio.ts";
import { Telegram } from "../gateway/telegram.ts";
import { Operazioni } from "../gateway/uso.ts";
import { Vault } from "../gateway/vault.ts";
import { allestisci, finche, type Banco } from "../prove/banco.ts";
import { avviaHostDiProva } from "../prove/host-di-prova.ts";
import { TelegramDiProva, type MessaggioDelBot } from "../prove/telegram-di-prova.ts";
import type { EventoConversazione } from "../protocollo/eventi.ts";
import { PREFISSO_PULSANTE_DEL_GATEWAY } from "../protocollo/telegram.ts";
import type { Canale } from "./canale.ts";
import { COOKIE_SESSIONE } from "./centro.ts";
import { ClienteGateway } from "./gateway.ts";

const FRASE = "una frase di sblocco di prova";
const PASSWORD = "P4ssword-di-prova-da-non-vedere";
const GETTONE = "gettone-di-prova-del-centro-lungo-quanto-serve";
const PROPRIETARIO = { id: 111, nome: "Mario", utente: "mario" };

interface Lab {
  banco: Banco;
  finto: TelegramDiProva;
  domande: DomandeAlProprietario;
  registro: Registro;
  /** Il server, com'è scritto nel vault. */
  host: string;
  comandi: string[];
  /** I messaggi del bot dopo quello che conferma l'abbinamento. */
  mandati(): MessaggioDelBot[];
}

/**
 * Un gateway vero che sa fare domande al proprietario, con il bot abbinato; un host finto che nel
 * vault è dichiarato "il server su cui gira Shinka"; e il centro, con il ponte verso Telegram acceso.
 */
async function allestisciLab(t: TestContext, attesaMs?: number): Promise<Lab> {
  const finto = await TelegramDiProva.avvia();
  const cartella = await mkdtemp(join(tmpdir(), "shinka-gateway-"));
  const vault = await Vault.apri(join(cartella, "vault.json"), 2 ** 10);
  await vault.imposta(FRASE);
  const registro = await Registro.apri(join(cartella, "registro.jsonl"));
  const telegram = await Telegram.apri({ file: join(cartella, "telegram.json"), api: finto.indirizzo, attesaSecondi: 1, pausaMs: () => 20 });
  const domande = new DomandeAlProprietario({ telegram });
  const app = await creaGateway({ vault, registro, operazioni: new Operazioni(vault, registro, attesaMs, domande), telegram, domande, gettone: GETTONE });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const cliente = new ClienteGateway({ indirizzo: `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`, gettone: GETTONE });
  const avviato = await avviaHostDiProva({ utente: "root", password: PASSWORD, esegui: (comando) => ({ uscita: `fatto: ${comando}\n` }) });
  t.after(async () => {
    cliente.chiudi();
    await avviato.chiudi();
    await app.close();
    await finto.chiudi();
    await rm(cartella, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  const host = `127.0.0.1:${avviato.porta}`;
  await vault.inserisci({ nome: "unraid", tipo: "password", utente: "root", host: [host], segreto: PASSWORD, server: true });

  await telegram.imposta(finto.gettone);
  telegram.nuovoCodice();
  finto.scrive(PROPRIETARIO, telegram.inVista().codice?.valore);
  await finto.attendi(() => finto.messaggi.length === 1, 5000, "il bot conferma l'abbinamento");
  const banco = await allestisci(t, { gateway: cliente, telegram: { attesaEventiS: 1, ritardoRichiesteMs: 50, lavoroLungoMs: 60_000, pausaMs: 20 } });
  // Il ponte sa in che stato è il bot appena il gateway gli ha risposto la prima volta.
  await new Promise((fatto) => setTimeout(fatto, 100));
  return { banco, finto, domande, registro, host, comandi: avviato.comandi, mandati: () => finto.messaggi.slice(1) };
}

type Richiesta = Extract<EventoConversazione, { tipo: "approvazione-richiesta" }>;

function richieste(canale: Canale): Richiesta[] {
  return canale.archiviati.map((archiviato) => archiviato.evento).filter((evento): evento is Richiesta => evento.tipo === "approvazione-richiesta");
}

function decise(canale: Canale): string[] {
  return canale.archiviati.flatMap(({ evento }) => (evento.tipo === "approvazione-decisa" ? [evento.esito] : []));
}

async function decidi(banco: Banco, id: string, decisione: string): Promise<number> {
  const risposta = await banco.centro.inject({
    method: "POST",
    url: `/api/approvazioni/${id}`,
    payload: { decisione },
    cookies: { [COOKIE_SESSIONE]: await banco.entra() },
  });
  return risposta.statusCode;
}

test("un comando sul server di Shinka parte solo con il sì dato al gateway: dal centro non si approva", async (t) => {
  const { banco, finto, domande, registro, host, comandi, mandati } = await allestisciLab(t);

  const elenco = await banco.comuniDellaHome("elenca_credenziali", {});
  assert.match(elenco.testo, /unraid[\s\S]*è il server su cui gira Shinka: ogni comando con esegui_su_host aspetta il sì del proprietario, che lo dà al gateway/);

  const esito = banco.comuniDellaHome("esegui_su_host", { credenziale: "unraid", host, comando: "docker restart shinka-gateway" });
  await finche(() => richieste(banco.canale).length === 1, "la scheda compare nella Home");
  const scheda = richieste(banco.canale)[0];
  assert.ok(scheda);
  // La scheda dice che cosa aspetta, e che il sì non si dà lì.
  assert.deepEqual(
    { host: scheda.host, credenziale: scheda.credenziale, comando: scheda.comando, alGateway: scheda.alGateway },
    { host, credenziale: "unraid", comando: "docker restart shinka-gateway", alGateway: true },
  );
  assert.equal(await decidi(banco, scheda.idApprovazione, "approvata"), 404);

  // Su Telegram c'è un messaggio solo, quello del gateway: il centro non ne manda uno suo.
  await finto.attendi(() => mandati().length === 1, 5000, "il gateway manda la domanda");
  await new Promise((fatto) => setTimeout(fatto, 300));
  assert.equal(mandati().length, 1);
  const messaggio = mandati()[0];
  assert.ok(messaggio);
  assert.match(messaggio.text, /Eseguire questo comando su 127\.0\.0\.1:\d+\?[\s\S]*docker restart shinka-gateway\n\nLo chiede il gateway/);
  const si = messaggio.pulsanti.flat().find((uno) => uno.text === "Esegui")?.callback_data ?? "";
  assert.ok(si.startsWith(PREFISSO_PULSANTE_DEL_GATEWAY));
  assert.deepEqual(comandi, []);
  assert.equal(domande.inVista().length, 1);

  // Il proprietario preme il pulsante del gateway: il comando parte, com'era scritto.
  finto.preme(PROPRIETARIO, messaggio.message_id, si);
  const finito = await esito;
  assert.equal(finito.errore, undefined, finito.testo);
  assert.equal(finito.testo, "Codice di uscita: 0\nfatto: docker restart shinka-gateway");
  assert.deepEqual(comandi, ["docker restart shinka-gateway"]);
  assert.deepEqual(decise(banco.canale), ["approvata"]);
  assert.equal(registro.ultime(1)[0]?.motivo, "Approvato dal proprietario, con il sì dato al gateway.");
  await finto.attendi(() => messaggio.modifiche === 1, 5000, "il messaggio dice com'è finita");
  assert.match(messaggio.text, /✅ Hai detto di sì\.$/);
  // Di ciò che il proprietario ha premuto, al centro non è arrivato nulla da riferire: nessun altro messaggio.
  assert.equal(mandati().length, 1);
  assert.equal(banco.canale.sospesi.permessi, 0);
});

test("dalla scheda del centro un comando sul server si può solo negare, e allora non parte", async (t) => {
  const { banco, finto, domande, host, comandi, mandati } = await allestisciLab(t);
  const esito = banco.comuniDellaHome("esegui_su_host", { credenziale: "unraid", host, comando: "docker rm -f shinka" });
  await finche(() => richieste(banco.canale).length === 1, "la scheda compare nella Home");
  await finto.attendi(() => mandati().length === 1, 5000, "il gateway manda la domanda");
  assert.equal(await decidi(banco, richieste(banco.canale)[0]?.idApprovazione ?? "", "negata"), 200);
  const finito = await esito;
  assert.equal(finito.errore, true);
  assert.match(finito.testo, /ha negato l'approvazione/);
  assert.deepEqual(decise(banco.canale), ["negata"]);
  assert.deepEqual(comandi, []);
  assert.equal(domande.inVista().length, 0);
  // Il messaggio del gateway non resta lì con i pulsanti a promettere.
  const messaggio = mandati()[0];
  assert.ok(messaggio);
  await finto.attendi(() => messaggio.modifiche === 1, 5000, "il messaggio del gateway viene chiuso");
  assert.match(messaggio.text, /Ritirata: non è stato fatto nulla\.$/);
  assert.deepEqual(messaggio.pulsanti, []);
});

test("un comando sul server a cui nessuno risponde scade, e non parte", async (t) => {
  const { banco, host, comandi } = await allestisciLab(t, 200);
  const finito = await banco.comuniDellaHome("esegui_su_host", { credenziale: "unraid", host, comando: "docker restart shinka" });
  assert.equal(finito.errore, true);
  assert.match(finito.testo, /non è arrivata in tempo/);
  assert.deepEqual(decise(banco.canale), ["scaduta"]);
  assert.deepEqual(comandi, []);
});
