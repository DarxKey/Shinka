import assert from "node:assert/strict";
import { test } from "node:test";
import type { EventoArchiviato, EventoConversazione } from "../protocollo/eventi.ts";
import { COOKIE_SESSIONE } from "./centro.ts";
import { allestisci } from "../prove/banco.ts";
import { azioneIntera, LUNGHEZZA_RIASSUNTO, storiaLeggera } from "./storia-leggera.ts";

const LUNGO = "x".repeat(5000);

function archivia(eventi: EventoConversazione[]): EventoArchiviato[] {
  return eventi.map((evento, posizione) => ({ n: posizione + 1, quando: "2026-11-15T10:00:00.000Z", evento }));
}

const STORIA = archivia([
  { tipo: "azione-iniziata", idAzione: "a1", strumento: "Write", ingresso: { file_path: "/p/a.ts", content: LUNGO } },
  { tipo: "azione-conclusa", idAzione: "a1", esito: LUNGO, errore: false },
  { tipo: "azione-iniziata", idAzione: "a2", strumento: "Bash", ingresso: { command: "ls" } },
  { tipo: "azione-conclusa", idAzione: "a2", esito: "a.ts", errore: false },
  // Ancora in corso, magari in attesa di un permesso: resta intera.
  { tipo: "azione-iniziata", idAzione: "a3", strumento: "Write", ingresso: { file_path: "/p/b.ts", content: LUNGO } },
  { tipo: "messaggio-proprietario", id: "m1", testo: LUNGO },
]);

test("delle azioni concluse la storia porta un riassunto segnato; il resto resta com'è", () => {
  const leggera = storiaLeggera(STORIA);
  const [scritta, esito, comando, finito, inCorso, messaggio] = leggera.map((a) => a.evento);
  assert.equal(scritta?.tipo === "azione-iniziata" && scritta.accorciato, true);
  const ingresso = (scritta as { ingresso: { file_path: string; content: string } }).ingresso;
  assert.equal(ingresso.file_path, "/p/a.ts");
  assert.equal(ingresso.content.length, LUNGHEZZA_RIASSUNTO + 1);
  assert.equal(esito?.tipo === "azione-conclusa" && esito.accorciato, true);
  assert.equal((esito as { esito: string }).esito.length, LUNGHEZZA_RIASSUNTO + 1);
  // Ciò che è già breve non cambia, nemmeno nel segno.
  assert.deepEqual(comando, STORIA[2]?.evento);
  assert.deepEqual(finito, STORIA[3]?.evento);
  assert.deepEqual(inCorso, STORIA[4]?.evento);
  assert.deepEqual(messaggio, STORIA[5]?.evento);
  // L'archivio non si tocca.
  assert.equal((STORIA[0]?.evento as { ingresso: { content: string } }).ingresso.content, LUNGO);
  assert.deepEqual(azioneIntera(STORIA, "a1"), { ingresso: { file_path: "/p/a.ts", content: LUNGO }, esito: LUNGO });
  assert.deepEqual(azioneIntera(STORIA, "a3"), { ingresso: { file_path: "/p/b.ts", content: LUNGO } });
  assert.equal(azioneIntera(STORIA, "nessuna"), undefined);
});

test("l'interfaccia riceve la storia leggera, e chiede l'azione per intero quando la apre", async (t) => {
  const banco = await allestisci(t);
  const cookies = { [COOKIE_SESSIONE]: await banco.entra() };
  banco.home.emetti({ tipo: "azione-iniziata", idAzione: "a1", strumento: "Write", ingresso: { file_path: "/p/a.ts", content: LUNGO } });
  banco.home.emetti({ tipo: "azione-conclusa", idAzione: "a1", esito: LUNGO, errore: false });

  const ricevuti: EventoArchiviato[] = [];
  const scollega = banco.canale.iscrivi((archiviato) => ricevuti.push(archiviato));
  scollega();
  const iniziata = ricevuti.find((a) => a.evento.tipo === "azione-iniziata")?.evento;
  assert.equal(iniziata?.tipo === "azione-iniziata" && iniziata.accorciato, true);

  const intera = await banco.centro.inject({ method: "GET", url: "/api/home/azioni/a1", cookies });
  assert.equal(intera.statusCode, 200);
  assert.deepEqual(intera.json(), { ingresso: { file_path: "/p/a.ts", content: LUNGO }, esito: LUNGO });
  assert.equal((await banco.centro.inject({ method: "GET", url: "/api/home/azioni/altra", cookies })).statusCode, 404);
  // Senza sessione nulla.
  assert.equal((await banco.centro.inject({ method: "GET", url: "/api/home/azioni/a1" })).statusCode, 401);

  const progetto = await banco.lavori.crea("Blog", "centro", "Un blog.");
  const conversazione = banco.conversazioniLocali.at(-1);
  conversazione?.emetti({ tipo: "azione-iniziata", idAzione: "b1", strumento: "Bash", ingresso: { command: LUNGO } });
  const delProgetto = await banco.centro.inject({ method: "GET", url: `/api/progetti/${progetto.id}/azioni/b1`, cookies });
  assert.deepEqual(delProgetto.json(), { ingresso: { command: LUNGO } });
});
