/**
 * Lo sportello del nodo (ADR 0056): risponde solo con il suo gettone e solo ai programmi della
 * macchina; senza centro manda avanti i progetti con le rotte del centro; con il centro tornato dice
 * di passare da lì.
 */

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { FILE_SPORTELLO, type IndirizzoDelloSportello, type StatoDelloSportello } from "../protocollo/offline.ts";
import { ConversazioneFinta } from "../prove/banco.ts";
import { configurazioneDiProgetto } from "./profili.ts";
import { LavoroOffline } from "./offline.ts";
import { Sportello } from "./sportello.ts";

const ID = "11111111-2222-3333-4444-555555555555";

async function prepara(t: TestContext): Promise<{ offline: LavoroOffline; indirizzo: IndirizzoDelloSportello; dati: string; conversazioni: ConversazioneFinta[]; chiedi: (percorso: string, opzioni?: RequestInit) => Promise<Response> }> {
  const dati = mkdtempSync(join(tmpdir(), "sportello-"));
  t.after(() => rmSync(dati, { recursive: true, force: true }));
  const conversazioni: ConversazioneFinta[] = [];
  const offline = await LavoroOffline.apri({
    cartella: join(dati, "offline"),
    nome: "Portatile",
    radiceProgetti: join(dati, "progetti"),
    apri: (progetto, _motore, alEvento, alIdSessione) => {
      const conversazione = new ConversazioneFinta(configurazioneDiProgetto(progetto.cartella, progetto.idSessione, progetto.impostazioni, alEvento, alIdSessione));
      conversazioni.push(conversazione);
      return conversazione;
    },
    riferisci: () => {},
    creaCartella: async (radice, nome) => ({ percorso: join(radice, nome) }),
  });
  await offline.progetti([{ id: ID, nome: "Videogioco", cartella: join(dati, "progetti", "videogioco"), brief: "Un gioco.", creatoIl: "2026-11-20T10:00:00.000Z", impostazioni: { permessi: "chiedi" } }], undefined);
  const sportello = new Sportello({ offline, dati, idAmbiente: "nodo-1", nome: "Portatile", sistema: "Windows 11", radiceProgetti: join(dati, "progetti") });
  const indirizzo = await sportello.apri();
  t.after(async () => {
    offline.chiudiTutto();
    await sportello.chiudi();
  });
  const chiedi = (percorso: string, opzioni: RequestInit = {}): Promise<Response> =>
    fetch(`http://127.0.0.1:${indirizzo.porta}${percorso}`, {
      ...opzioni,
      headers: { Authorization: `Bearer ${indirizzo.gettone}`, "Content-Type": "application/json", ...(opzioni.headers as Record<string, string> | undefined) },
    });
  return { offline, indirizzo, dati, conversazioni, chiedi };
}

test("lo sportello scrive dove trovarlo e risponde solo con il suo gettone, e non alle pagine web", async (t) => {
  const { indirizzo, dati, chiedi } = await prepara(t);
  const scritto = JSON.parse(readFileSync(join(dati, FILE_SPORTELLO), "utf8")) as IndirizzoDelloSportello;
  assert.deepEqual(scritto, indirizzo);
  assert.equal((await fetch(`http://127.0.0.1:${indirizzo.porta}/api/sportello`)).status, 401);
  assert.equal((await fetch(`http://127.0.0.1:${indirizzo.porta}/api/sportello`, { headers: { Authorization: "Bearer sbagliato" } })).status, 401);
  assert.equal((await chiedi("/api/sportello", { headers: { Origin: "https://un-sito.example" } })).status, 403);
  const stato = (await (await chiedi("/api/sportello")).json()) as StatoDelloSportello;
  assert.equal(stato.collegato, false);
  assert.deepEqual(stato.progetti.map((uno) => uno.nome), ["Videogioco"]);
});

test("senza centro lo sportello manda avanti un progetto: messaggi, eventi, permessi, impostazioni", async (t) => {
  const { offline, conversazioni, chiedi } = await prepara(t);
  const flusso = await chiedi(`/api/progetti/${ID}/eventi`);
  assert.equal(flusso.headers.get("content-type"), "text/event-stream; charset=utf-8");
  const lettore = flusso.body?.getReader();
  let ricevuto = "";
  const leggiFinche = async (atteso: string): Promise<void> => {
    while (!ricevuto.includes(atteso)) {
      const pezzo = await lettore?.read();
      if (pezzo === undefined || pezzo.done) throw new Error(`il flusso si è chiuso senza ${atteso}`);
      ricevuto += new TextDecoder().decode(pezzo.value);
    }
  };
  await leggiFinche("event: storia");

  assert.equal((await chiedi(`/api/progetti/${ID}/messaggi`, { method: "POST", body: JSON.stringify({ testo: "Aggiungi il salto." }) })).status, 202);
  assert.deepEqual(conversazioni[0]?.inviati, ["Aggiungi il salto."]);
  await leggiFinche("Aggiungi il salto.");
  assert.equal((await chiedi(`/api/progetti/${ID}/messaggi`, { method: "POST", body: JSON.stringify({ testo: "  " }) })).status, 400);

  conversazioni[0]?.emetti({ tipo: "permesso-richiesto", idPermesso: "p1", strumento: "Bash", ingresso: { command: "npm test" } } as never);
  assert.equal((await chiedi(`/api/progetti/${ID}/permessi/p1`, { method: "POST", body: JSON.stringify({ decisione: "approvato" }) })).status, 200);
  assert.deepEqual(conversazioni[0]?.decisioni, [["p1", "approvato"]]);
  assert.equal((await chiedi(`/api/progetti/${ID}/permessi/p1`, { method: "POST", body: JSON.stringify({ decisione: "approvato" }) })).status, 404);

  const impostate = await chiedi(`/api/progetti/${ID}/impostazioni`, { method: "PUT", body: JSON.stringify({ impegno: "high" }) });
  assert.equal(impostate.status, 200);
  assert.deepEqual(((await impostate.json()) as { impostazioni: unknown }).impostazioni, { permessi: "chiedi", impegno: "high" });
  assert.equal((await chiedi(`/api/progetti/${ID}/impostazioni`, { method: "PUT", body: JSON.stringify({ permessi: "tutto" }) })).status, 400);

  assert.equal((await chiedi(`/api/progetti/${ID}/interrompi`, { method: "POST" })).status, 200);
  assert.equal(conversazioni[0]?.interruzioni, 1);
  const storia = (await (await chiedi(`/api/progetti/${ID}/storia`)).json()) as { eventi: { evento: { tipo: string } }[] };
  assert.ok(storia.eventi.some(({ evento }) => evento.tipo === "messaggio-proprietario"));
  await lettore?.cancel();

  // Un progetto nuovo nasce dallo sportello, e parte con il suo brief.
  const nato = await chiedi("/api/progetti", { method: "POST", body: JSON.stringify({ nome: "Appunti", brief: "Raccogli gli appunti." }) });
  assert.equal(nato.status, 201);
  assert.equal(((await nato.json()) as { nuovo?: boolean }).nuovo, true);
  assert.deepEqual(conversazioni[1]?.inviati, ["Raccogli gli appunti."]);

  // Il centro torna: un progetto che non sta lavorando si fa dal centro.
  conversazioni[0]?.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 1 });
  conversazioni[1]?.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 1 });
  offline.collegato(true);
  assert.equal(((await (await chiedi("/api/sportello")).json()) as StatoDelloSportello).collegato, true);
  assert.equal((await chiedi(`/api/progetti/${ID}/messaggi`, { method: "POST", body: JSON.stringify({ testo: "Ancora." }) })).status, 409);
  assert.equal((await chiedi("/api/progetti", { method: "POST", body: JSON.stringify({ nome: "Altro", brief: "Altro." }) })).status, 409);
});

test("chiuso lo sportello, il suo file se ne va", async (t) => {
  const dati = mkdtempSync(join(tmpdir(), "sportello-"));
  t.after(() => rmSync(dati, { recursive: true, force: true }));
  const offline = await LavoroOffline.apri({ cartella: join(dati, "offline"), nome: "Portatile", radiceProgetti: dati, apri: () => new ConversazioneFinta(), riferisci: () => {} });
  const sportello = new Sportello({ offline, dati, idAmbiente: "nodo-1", nome: "Portatile", sistema: "Linux", radiceProgetti: dati });
  await sportello.apri();
  assert.equal(existsSync(join(dati, FILE_SPORTELLO)), true);
  await sportello.chiudi();
  assert.equal(existsSync(join(dati, FILE_SPORTELLO)), false);
});
