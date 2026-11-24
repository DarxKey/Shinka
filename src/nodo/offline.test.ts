/**
 * Il lavoro offline del nodo (ADR 0056), senza centro e senza sportello: l'archivio offline resta
 * dopo un riavvio del nodo e si consegna a pezzi; un progetto nato offline senza eventi si consegna
 * lo stesso; un centro che non va avanti non fa rimandare lo stesso pezzo all'infinito.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import type { RiferitoDalNodo } from "../protocollo/nodi.ts";
import { ConversazioneFinta } from "../prove/banco.ts";
import { LavoroOffline, type OpzioniOffline } from "./offline.ts";
import { configurazioneDiProgetto } from "./profili.ts";

const ID = "11111111-2222-3333-4444-555555555555";

function opzioni(t: TestContext): { o: OpzioniOffline; mandati: RiferitoDalNodo[]; conversazioni: ConversazioneFinta[]; cartella: string } {
  const dati = mkdtempSync(join(tmpdir(), "offline-"));
  t.after(() => rmSync(dati, { recursive: true, force: true }));
  const mandati: RiferitoDalNodo[] = [];
  const conversazioni: ConversazioneFinta[] = [];
  const cartella = join(dati, "offline");
  return {
    cartella,
    mandati,
    conversazioni,
    o: {
      cartella,
      nome: "Portatile",
      radiceProgetti: join(dati, "progetti"),
      apri: (progetto, _motore, alEvento, alIdSessione) => {
        const conversazione = new ConversazioneFinta(configurazioneDiProgetto(progetto.cartella, progetto.idSessione, progetto.impostazioni, alEvento, alIdSessione));
        conversazioni.push(conversazione);
        return conversazione;
      },
      riferisci: (messaggio) => mandati.push(messaggio),
      creaCartella: async (radice, nome) => ({ percorso: join(radice, nome) }),
    },
  };
}

test("l'archivio offline resta dopo un riavvio del nodo, e si consegna a pezzi fino in fondo", async (t) => {
  const { o, mandati, conversazioni, cartella } = opzioni(t);
  const prima = await LavoroOffline.apri(o);
  await prima.progetti([{ id: ID, nome: "Videogioco", cartella: "/progetti/videogioco", brief: "Un gioco.", creatoIl: "2026-11-20T10:00:00.000Z", impostazioni: { permessi: "chiedi" } }], undefined);
  await prima.invia(ID, "Primo.");
  for (let numero = 0; numero < 250; numero += 1) conversazioni[0]?.emetti({ tipo: "nota", testo: `nota ${numero}` });
  conversazioni[0]?.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 1 });
  prima.chiudiTutto();

  // Il nodo riparte: l'archivio c'è ancora, e il progetto ha lavoro da consegnare.
  const dopo = await LavoroOffline.apri(o);
  assert.deepEqual(dopo.daConsegnare(), [ID]);
  dopo.collegato(true);
  const primo = mandati.at(-1);
  assert.ok(primo?.tipo === "offline-eventi");
  assert.equal(primo.eventi.length, 200);
  assert.equal(primo.ultimo, 253);
  assert.deepEqual(primo.impostazioni, { permessi: "chiedi" });
  await dopo.preso(ID, primo.versione, 200);
  const secondo = mandati.at(-1);
  assert.ok(secondo?.tipo === "offline-eventi");
  assert.equal(secondo.eventi[0]?.n, 201);
  // Il centro non va avanti: lo stesso pezzo non si rimanda.
  const quanti = mandati.length;
  await dopo.preso(ID, primo.versione, 200);
  assert.equal(mandati.length, quanti);
  // Al prossimo collegamento si riprende, e quando il centro arriva in fondo l'archivio se ne va.
  dopo.collegato(false);
  dopo.collegato(true);
  await dopo.preso(ID, primo.versione, 253);
  assert.deepEqual(dopo.daConsegnare(), []);
  assert.equal(existsSync(join(cartella, "archivi", `${ID}.jsonl`)), false);
});

test("un progetto nato offline si consegna anche senza eventi, e resta tra i progetti finché il centro non lo conosce", async (t) => {
  const { o, mandati } = opzioni(t);
  const offline = await LavoroOffline.apri({ ...o, apri: () => new ConversazioneFinta() });
  const nato = await offline.creaProgetto("Appunti", "Raccogli gli appunti.");
  // Il centro manda i suoi progetti, che non lo comprendono ancora: resta.
  await offline.progetti([], undefined);
  assert.deepEqual(offline.elenco().map((uno) => uno.id), [nato.id]);
  offline.collegato(true);
  const consegna = mandati.at(-1);
  assert.ok(consegna?.tipo === "offline-eventi");
  assert.equal(consegna.nuovo?.nome, "Appunti");
  await offline.preso(nato.id, consegna.versione, consegna.ultimo);
  assert.deepEqual(offline.daConsegnare(), []);
  assert.equal(offline.elenco().find((uno) => uno.id === nato.id)?.nuovo, undefined);
});

test("offline, leggere le skill risponde dalla copia del nodo", async (t) => {
  const { o } = opzioni(t);
  const cartellaSkill = join(o.cartella, "..", "skill");
  mkdirSync(join(cartellaSkill, "skills", "backup-foto"), { recursive: true });
  writeFileSync(join(cartellaSkill, "skills", "backup-foto", "SKILL.md"), '---\nname: backup-foto\ndescription: "Come fare il backup delle foto."\n---\n\nPrimo passo.\n');
  const offline = await LavoroOffline.apri({ ...o, cartellaSkill });
  const chiama = offline.chiama(ID);
  assert.deepEqual(await chiama("leggi_skill", {}), { testo: "- backup-foto: Come fare il backup delle foto." });
  assert.match((await chiama("leggi_skill", { nome: "shinka:backup-foto" })).testo, /Primo passo\./);
  assert.equal((await chiama("leggi_skill", { nome: "non-esiste" })).errore, true);
});
