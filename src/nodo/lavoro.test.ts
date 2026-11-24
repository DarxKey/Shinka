import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import type { RiferitoDalNodo } from "../protocollo/nodi.ts";
import { ConversazioneFinta, finche } from "../prove/banco.ts";
import { LavoroDelNodo } from "./lavoro.ts";

const IMPOSTAZIONI = { modello: "opus", permessi: "modifiche-libere" } as const;

interface Banchetto {
  lavoro: LavoroDelNodo;
  radice: string;
  riferiti: RiferitoDalNodo[];
  conversazioni: ConversazioneFinta[];
}

async function allestisci(t: TestContext): Promise<Banchetto> {
  const radice = await mkdtemp(join(tmpdir(), "shinka-lavoro-"));
  t.after(() => rm(radice, { recursive: true, force: true }));
  const riferiti: RiferitoDalNodo[] = [];
  const conversazioni: ConversazioneFinta[] = [];
  const lavoro = new LavoroDelNodo({
    radiceProgetti: radice,
    riferisci: (messaggio) => riferiti.push(messaggio),
    apriConversazione: (configurazione) => {
      const conversazione = new ConversazioneFinta(configurazione);
      conversazioni.push(conversazione);
      return conversazione;
    },
  });
  return { lavoro, radice, riferiti, conversazioni };
}

test("su richiesta del centro il nodo crea la cartella e ne riferisce il percorso", async (t) => {
  const { lavoro, radice, riferiti } = await allestisci(t);
  lavoro.esegui({ tipo: "crea-cartella", idRichiesta: "r1", nomeCartella: "videogioco", brief: "Brief." });
  await finche(() => riferiti.length === 1, "il nodo riferisce l'esito");
  assert.deepEqual(riferiti[0], {
    tipo: "cartella-creata",
    idRichiesta: "r1",
    percorso: join(radice, "videogioco"),
  });
  assert.ok(existsSync(join(radice, "videogioco", "BRIEF.md")));
});

test("se la cartella esiste già il nodo lo riferisce senza toccarla", async (t) => {
  const { lavoro, riferiti } = await allestisci(t);
  lavoro.esegui({ tipo: "crea-cartella", idRichiesta: "r1", nomeCartella: "videogioco", brief: "Brief." });
  await finche(() => riferiti.length === 1, "prima creazione");
  lavoro.esegui({ tipo: "crea-cartella", idRichiesta: "r2", nomeCartella: "videogioco", brief: "Altro." });
  await finche(() => riferiti.length === 2, "seconda risposta");
  assert.equal(riferiti[1]?.tipo, "cartella-non-creata");
  assert.ok(riferiti[1]?.tipo === "cartella-non-creata" && /esiste già/.test(riferiti[1].motivo));
});

test("una conversazione si apre nella cartella indicata, come quella di un progetto", async (t) => {
  const { lavoro, radice, conversazioni } = await allestisci(t);
  const cartella = join(radice, "videogioco");
  lavoro.esegui({ tipo: "apri-conversazione", idConversazione: "c1", cartella, idSessione: "sessione-7", impostazioni: IMPOSTAZIONI });

  assert.equal(conversazioni.length, 1);
  const configurazione = conversazioni[0]?.configurazione;
  assert.equal(configurazione?.cartella, cartella);
  assert.equal(configurazione?.idSessione, "sessione-7");
  assert.equal(configurazione?.istruzioni, "claude-code");
  assert.equal(configurazione?.strumenti, "claude-code");
  assert.deepEqual(configurazione?.impostazioni, IMPOSTAZIONI);

  // Aprirla due volte non ne crea una seconda.
  lavoro.esegui({ tipo: "apri-conversazione", idConversazione: "c1", cartella, impostazioni: IMPOSTAZIONI });
  assert.equal(conversazioni.length, 1);
});

test("aperta perché il proprietario la guarda, la conversazione si prepara: nuova o già aperta", async (t) => {
  const { lavoro, radice, conversazioni } = await allestisci(t);
  const cartella = join(radice, "videogioco");
  lavoro.esegui({ tipo: "apri-conversazione", idConversazione: "c1", cartella, impostazioni: IMPOSTAZIONI });
  assert.equal(conversazioni[0]?.preparazioni, 0);
  // Dopo un riavvio di Shinka il centro la riapre per il proprietario: il motore parte e dice i modelli.
  lavoro.esegui({ tipo: "apri-conversazione", idConversazione: "c1", cartella, impostazioni: IMPOSTAZIONI, prepara: true });
  lavoro.esegui({ tipo: "apri-conversazione", idConversazione: "c2", cartella, impostazioni: IMPOSTAZIONI, prepara: true });
  assert.deepEqual(
    conversazioni.map((conversazione) => conversazione.preparazioni),
    [1, 1],
  );
  // Le stesse impostazioni, ripetute a ogni apertura, non fanno ripartire il motore; quelle cambiate sì.
  assert.deepEqual(conversazioni[0]?.impostazioni, []);
  lavoro.esegui({ tipo: "imposta", idConversazione: "c1", impostazioni: { ...IMPOSTAZIONI } });
  assert.deepEqual(conversazioni[0]?.impostazioni, []);
  const cambiate = { ...IMPOSTAZIONI, modello: "sonnet" };
  lavoro.esegui({ tipo: "apri-conversazione", idConversazione: "c1", cartella, impostazioni: cambiate, prepara: true });
  assert.deepEqual(conversazioni[0]?.impostazioni, [cambiate]);
  lavoro.esegui({ tipo: "imposta", idConversazione: "c1", impostazioni: cambiate });
  assert.equal(conversazioni[0]?.impostazioni.length, 1);
});

test("messaggi, decisioni e interruzioni arrivano alla conversazione giusta", async (t) => {
  const { lavoro, radice, conversazioni } = await allestisci(t);
  lavoro.esegui({ tipo: "apri-conversazione", idConversazione: "c1", cartella: join(radice, "a"), impostazioni: IMPOSTAZIONI });
  lavoro.esegui({ tipo: "apri-conversazione", idConversazione: "c2", cartella: join(radice, "b"), impostazioni: IMPOSTAZIONI });
  const [prima, seconda] = conversazioni;
  assert.ok(prima && seconda);

  lavoro.esegui({ tipo: "messaggio", idConversazione: "c2", testo: "ciao" });
  assert.deepEqual(prima.inviati, []);
  assert.deepEqual(seconda.inviati, ["ciao"]);

  seconda.emetti({ tipo: "permesso-richiesto", idPermesso: "p1", idAzione: "p1", strumento: "Bash", ingresso: {} });
  lavoro.esegui({ tipo: "decidi-permesso", idConversazione: "c2", idPermesso: "p1", decisione: "approvato" });
  assert.deepEqual(seconda.decisioni, [["p1", "approvato"]]);

  seconda.emetti({ tipo: "domande-poste", idDomande: "d1", domande: [] });
  lavoro.esegui({ tipo: "rispondi-domande", idConversazione: "c2", idDomande: "d1", risposta: { tipo: "risposte", risposte: ["Sì"] } });
  assert.deepEqual(seconda.risposteAlleDomande, [["d1", { tipo: "risposte", risposte: ["Sì"] }]]);
  assert.deepEqual(prima.risposteAlleDomande, []);

  lavoro.esegui({ tipo: "interrompi", idConversazione: "c2" });
  assert.equal(seconda.interruzioni, 1);
  assert.equal(prima.interruzioni, 0);
});

test("ciò che accade in una conversazione viene riferito al centro con il suo identificativo", async (t) => {
  const { lavoro, radice, riferiti, conversazioni } = await allestisci(t);
  lavoro.esegui({ tipo: "apri-conversazione", idConversazione: "c1", cartella: join(radice, "a"), impostazioni: IMPOSTAZIONI });
  lavoro.esegui({ tipo: "messaggio", idConversazione: "c1", testo: "ciao" });
  conversazioni[0]?.configurazione?.alIdSessione("sessione-nuova");

  assert.deepEqual(riferiti.map((r) => r.tipo), ["evento", "evento", "id-sessione"]);
  assert.deepEqual(riferiti[0], {
    tipo: "evento",
    idConversazione: "c1",
    evento: { tipo: "messaggio-proprietario", id: "m1", testo: "ciao", modificabile: true },
  });
  assert.deepEqual(riferiti[2], { tipo: "id-sessione", idConversazione: "c1", idSessione: "sessione-nuova" });
});

test("un comando per una conversazione sconosciuta non fa nulla", async (t) => {
  const { lavoro, riferiti } = await allestisci(t);
  lavoro.esegui({ tipo: "messaggio", idConversazione: "mai-aperta", testo: "ciao" });
  lavoro.esegui({ tipo: "interrompi", idConversazione: "mai-aperta" });
  assert.deepEqual(riferiti, []);
});

test("quando il centro sparisce le conversazioni si chiudono", async (t) => {
  const { lavoro, radice, conversazioni } = await allestisci(t);
  lavoro.esegui({ tipo: "apri-conversazione", idConversazione: "c1", cartella: join(radice, "a"), impostazioni: IMPOSTAZIONI });
  lavoro.chiudiTutto();
  assert.equal(conversazioni[0]?.chiusa, true);

  // Dopo, la stessa conversazione si può riaprire.
  lavoro.esegui({ tipo: "apri-conversazione", idConversazione: "c1", cartella: join(radice, "a"), impostazioni: IMPOSTAZIONI });
  assert.equal(conversazioni.length, 2);
});
