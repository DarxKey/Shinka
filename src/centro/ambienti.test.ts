import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { codiceDiVerifica } from "../protocollo/codice.ts";
import { SILENZIO_MASSIMO_MS, type MessaggioCentro, type MessaggioNodo } from "../protocollo/nodi.ts";
import { RegistroAmbienti, RICHIESTE_MASSIME, type CanaleNodo } from "./ambienti.ts";

type Presentazione = Extract<MessaggioNodo, { tipo: "presentazione" }>;

const SEGRETO = "segreto-di-prova-lungo-almeno-trentadue-caratteri";

function presentazione(modifiche: Partial<Presentazione> = {}): Presentazione {
  return {
    tipo: "presentazione",
    idNodo: "nodo-pc-windows",
    segreto: SEGRETO,
    nome: "PC Windows",
    descrizione: "Unity, Blender",
    sistema: "Windows 11",
    radiceProgetti: "C:\Progetti",
    ...modifiche,
  };
}

/** Collegamento finto: ricorda ciò che il registro manda al nodo. */
class CanaleFinto implements CanaleNodo {
  ricevuti: MessaggioCentro[] = [];
  chiuso = false;
  cifrato: boolean;
  constructor(cifrato = false) {
    this.cifrato = cifrato;
  }
  invia(messaggio: MessaggioCentro): void {
    this.ricevuti.push(messaggio);
  }
  chiudi(): void {
    this.chiuso = true;
  }
}

async function fileProvvisorio(t: TestContext): Promise<string> {
  const cartella = await mkdtemp(join(tmpdir(), "shinka-ambienti-"));
  t.after(() => rm(cartella, { recursive: true, force: true }));
  return join(cartella, "ambienti.json");
}

function apri(file: string): Promise<RegistroAmbienti> {
  return RegistroAmbienti.apri(file, {
    nome: "Unraid",
    descrizione: "Linux, Docker",
    sistema: "Linux",
    radiceProgetti: "/home/node/progetti",
  });
}

test("l'ambiente del centro c'è sempre ed è attivo", async (t) => {
  const registro = await apri(await fileProvvisorio(t));
  assert.deepEqual(registro.stato(), {
    ambienti: [
      {
        id: "centro",
        nome: "Unraid",
        descrizione: "Linux, Docker",
        sistema: "Linux",
        radiceProgetti: "/home/node/progetti",
        attivo: true,
        delCentro: true,
      },
    ],
    richieste: [],
  });
});

test("un nodo sconosciuto resta in attesa, con lo stesso codice che vede lui", async (t) => {
  const registro = await apri(await fileProvvisorio(t));
  const canale = new CanaleFinto();
  assert.equal(await registro.presenta(presentazione(), canale), "in-attesa");

  const codice = codiceDiVerifica("nodo-pc-windows", SEGRETO);
  assert.deepEqual(canale.ricevuti, [{ tipo: "in-attesa", codice }]);
  const stato = registro.stato();
  assert.equal(stato.ambienti.length, 1);
  assert.equal(stato.richieste.length, 1);
  assert.equal(stato.richieste[0]?.codice, codice);
  assert.equal(stato.richieste[0]?.nome, "PC Windows");
});

test("dopo il consenso del proprietario il nodo diventa un ambiente attivo", async (t) => {
  const registro = await apri(await fileProvvisorio(t));
  const canale = new CanaleFinto();
  await registro.presenta(presentazione(), canale);

  assert.equal(await registro.decidi("nodo-pc-windows", "approvato"), true);
  assert.deepEqual(canale.ricevuti.at(-1), { tipo: "accolto", nome: "PC Windows" });
  const stato = registro.stato();
  assert.deepEqual(stato.richieste, []);
  assert.deepEqual(stato.ambienti.map((a) => [a.nome, a.attivo]), [
    ["Unraid", true],
    ["PC Windows", true],
  ]);
  assert.equal(await registro.decidi("nodo-pc-windows", "approvato"), false);
});

test("un nodo rifiutato viene scollegato e non diventa un ambiente", async (t) => {
  const registro = await apri(await fileProvvisorio(t));
  const canale = new CanaleFinto();
  await registro.presenta(presentazione(), canale);

  assert.equal(await registro.decidi("nodo-pc-windows", "negato"), true);
  assert.equal(canale.ricevuti.at(-1)?.tipo, "rifiutato");
  assert.equal(canale.chiuso, true);
  assert.equal(registro.stato().ambienti.length, 1);
});

test("un nodo accettato rientra da solo dopo il riavvio del centro, senza il segreto su disco", async (t) => {
  const file = await fileProvvisorio(t);
  const primo = await apri(file);
  await primo.presenta(presentazione(), new CanaleFinto());
  await primo.decidi("nodo-pc-windows", "approvato");
  assert.equal((await readFile(file, "utf8")).includes(SEGRETO), false);

  const secondo = await apri(file);
  assert.deepEqual(secondo.stato().ambienti.map((a) => [a.nome, a.attivo]), [
    ["Unraid", true],
    ["PC Windows", false],
  ]);
  const canale = new CanaleFinto();
  assert.equal(await secondo.presenta(presentazione(), canale), "accolto");
  assert.equal(secondo.stato().ambienti[1]?.attivo, true);
});

test("chi si presenta con il segreto sbagliato viene respinto", async (t) => {
  const registro = await apri(await fileProvvisorio(t));
  await registro.presenta(presentazione(), new CanaleFinto());
  await registro.decidi("nodo-pc-windows", "approvato");

  const impostore = new CanaleFinto();
  const esito = await registro.presenta(
    presentazione({ segreto: "un-altro-segreto-lungo-almeno-trentadue-caratteri" }),
    impostore,
  );
  assert.equal(esito, "rifiutato");
  assert.equal(impostore.chiuso, true);
  // Il nodo vero resta collegato.
  assert.equal(registro.stato().ambienti[1]?.attivo, true);
});

test("quando il collegamento si chiude l'ambiente risulta spento", async (t) => {
  const registro = await apri(await fileProvvisorio(t));
  const canale = new CanaleFinto();
  await registro.presenta(presentazione(), canale);
  await registro.decidi("nodo-pc-windows", "approvato");

  registro.scollegato("nodo-pc-windows", canale);
  assert.equal(registro.stato().ambienti[1]?.attivo, false);
});

test("un nodo che si ricollega non viene spento dalla chiusura del canale vecchio", async (t) => {
  const registro = await apri(await fileProvvisorio(t));
  const vecchio = new CanaleFinto();
  await registro.presenta(presentazione(), vecchio);
  await registro.decidi("nodo-pc-windows", "approvato");

  const nuovo = new CanaleFinto();
  await registro.presenta(presentazione(), nuovo);
  assert.equal(vecchio.chiuso, true);
  registro.scollegato("nodo-pc-windows", vecchio);
  assert.equal(registro.stato().ambienti[1]?.attivo, true);
});

test("un nodo che tace troppo a lungo risulta spento; uno che si fa sentire no", async (t) => {
  const registro = await apri(await fileProvvisorio(t));
  const canale = new CanaleFinto();
  await registro.presenta(presentazione(), canale, 1_000);
  await registro.decidi("nodo-pc-windows", "approvato", 1_000);

  registro.battito("nodo-pc-windows", canale, 30_000);
  registro.controllaSilenzi(30_000 + SILENZIO_MASSIMO_MS);
  assert.equal(registro.stato().ambienti[1]?.attivo, true);

  registro.controllaSilenzi(30_000 + SILENZIO_MASSIMO_MS + 1);
  assert.equal(registro.stato().ambienti[1]?.attivo, false);
  assert.equal(canale.chiuso, true);
});

test("un ambiente rimosso deve chiedere di nuovo il consenso", async (t) => {
  const registro = await apri(await fileProvvisorio(t));
  const canale = new CanaleFinto();
  await registro.presenta(presentazione(), canale);
  await registro.decidi("nodo-pc-windows", "approvato");

  assert.equal(await registro.rimuovi("nodo-pc-windows"), true);
  assert.equal(canale.chiuso, true);
  assert.equal(registro.stato().ambienti.length, 1);
  assert.equal(await registro.presenta(presentazione(), new CanaleFinto()), "in-attesa");
  assert.equal(await registro.rimuovi("centro"), false);
});

test("le richieste in attesa hanno un tetto", async (t) => {
  const registro = await apri(await fileProvvisorio(t));
  for (let i = 0; i < RICHIESTE_MASSIME; i += 1) {
    const esito = await registro.presenta(presentazione({ idNodo: `nodo-numero-${i}` }), new CanaleFinto());
    assert.equal(esito, "in-attesa");
  }
  const inPiu = new CanaleFinto();
  assert.equal(await registro.presenta(presentazione({ idNodo: "nodo-di-troppo" }), inPiu), "rifiutato");
  assert.equal(inPiu.chiuso, true);
  assert.equal(registro.stato().richieste.length, RICHIESTE_MASSIME);
});

test("una presentazione malformata viene respinta", async (t) => {
  const registro = await apri(await fileProvvisorio(t));
  for (const difettosa of [
    presentazione({ nome: "   " }),
    presentazione({ segreto: "corto" }),
    presentazione({ idNodo: "centro" }),
    presentazione({ descrizione: "x".repeat(201) }),
  ]) {
    const canale = new CanaleFinto();
    assert.equal(await registro.presenta(difettosa, canale), "rifiutato");
    assert.equal(canale.chiuso, true);
  }
  assert.deepEqual(registro.stato().richieste, []);
});

test("chi ascolta riceve lo stato subito e a ogni cambiamento", async (t) => {
  const registro = await apri(await fileProvvisorio(t));
  const visti: number[] = [];
  const smetti = registro.iscrivi((stato) => visti.push(stato.richieste.length));
  await registro.presenta(presentazione(), new CanaleFinto());
  smetti();
  await registro.decidi("nodo-pc-windows", "approvato");
  assert.deepEqual(visti, [0, 1]);
});

const DEL_CENTRO = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const DI_PRIMA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function apriConVersione(file: string, versione: string | null = DEL_CENTRO): Promise<RegistroAmbienti> {
  return RegistroAmbienti.apri(file, {
    nome: "Unraid",
    descrizione: "Linux, Docker",
    sistema: "Linux",
    radiceProgetti: "/home/node/progetti",
    ...(versione === null ? {} : { versione }),
  });
}

/** Ciò che la pagina degli ambienti viene a sapere della versione del nodo. */
function versioneDelNodo(registro: RegistroAmbienti) {
  const { versione, indietro, siAggiorna, aggiornamento } = registro.stato().ambienti[1] ?? {};
  return { versione, indietro, siAggiorna, aggiornamento };
}

test("di ogni nodo collegato si sa a che versione è, e se è indietro rispetto al centro", async (t) => {
  const registro = await apriConVersione(await fileProvvisorio(t));
  assert.equal(registro.stato().ambienti[0]?.versione, "aaaaaaaa");
  assert.equal(registro.nodo("nodo-pc-windows"), undefined);

  // Un nodo alla versione di prima, tenuto acceso dal suo guardiano.
  await registro.presenta(presentazione({ versione: DI_PRIMA, siAggiorna: true }), new CanaleFinto());
  await registro.decidi("nodo-pc-windows", "approvato");
  assert.deepEqual(versioneDelNodo(registro), { versione: "bbbbbbbb", indietro: true, siAggiorna: true, aggiornamento: undefined });
  assert.deepEqual(registro.nodo("nodo-pc-windows"), { versione: DI_PRIMA, siAggiorna: true });

  // Lo stesso nodo alla versione del centro.
  await registro.presenta(presentazione({ versione: DEL_CENTRO, siAggiorna: true }), new CanaleFinto());
  assert.deepEqual(versioneDelNodo(registro), { versione: "aaaaaaaa", indietro: undefined, siAggiorna: true, aggiornamento: undefined });

  // Un nodo che non dice a che versione è: di una versione di prima, oppure avviato da una cartella qualunque.
  const canale = new CanaleFinto();
  await registro.presenta(presentazione(), canale);
  assert.deepEqual(versioneDelNodo(registro), { versione: undefined, indietro: true, siAggiorna: undefined, aggiornamento: undefined });
  assert.deepEqual(registro.nodo("nodo-pc-windows"), { siAggiorna: false });

  // Spento, non si sa più nulla.
  registro.scollegato("nodo-pc-windows", canale);
  assert.deepEqual(versioneDelNodo(registro), { versione: undefined, indietro: undefined, siAggiorna: undefined, aggiornamento: undefined });
  assert.equal(registro.nodo("nodo-pc-windows"), undefined);
});

test("se il centro non sa a che versione è, nessun nodo risulta indietro", async (t) => {
  const registro = await apriConVersione(await fileProvvisorio(t), null);
  await registro.presenta(presentazione({ versione: DI_PRIMA, siAggiorna: true }), new CanaleFinto());
  await registro.decidi("nodo-pc-windows", "approvato");
  assert.equal(registro.stato().ambienti[0]?.versione, undefined);
  assert.deepEqual(versioneDelNodo(registro), { versione: "bbbbbbbb", indietro: undefined, siAggiorna: true, aggiornamento: undefined });
});

test("com'è finito un aggiornamento si capisce dalla versione con cui il nodo si ripresenta", async (t) => {
  const registro = await apriConVersione(await fileProvvisorio(t));
  const diPrima = presentazione({ versione: DI_PRIMA, siAggiorna: true });
  const primo = new CanaleFinto();
  await registro.presenta(diPrima, primo);
  await registro.decidi("nodo-pc-windows", "approvato");

  // Riuscito: il nodo torna con la versione del centro, e non resta nulla in sospeso.
  registro.segnaAggiornamento("nodo-pc-windows", { stato: "in-corso", versione: DEL_CENTRO });
  assert.deepEqual(versioneDelNodo(registro).aggiornamento, { stato: "in-corso", versione: "aaaaaaaa" });
  // Mentre il nodo riparte l'ambiente è spento, ma si vede ancora che sta cambiando versione.
  registro.scollegato("nodo-pc-windows", primo);
  assert.deepEqual(versioneDelNodo(registro).aggiornamento, { stato: "in-corso", versione: "aaaaaaaa" });
  await registro.presenta(presentazione({ versione: DEL_CENTRO, siAggiorna: true }), new CanaleFinto());
  assert.deepEqual(versioneDelNodo(registro), { versione: "aaaaaaaa", indietro: undefined, siAggiorna: true, aggiornamento: undefined });

  // Non riuscito: il guardiano ha rimesso la versione di prima, e il nodo dice perché.
  registro.segnaAggiornamento("nodo-pc-windows", { stato: "in-corso", versione: DEL_CENTRO });
  await registro.presenta({ ...diPrima, aggiornamentoFallito: { versione: DEL_CENTRO, motivo: "non si è collegata in tempo" } }, new CanaleFinto());
  assert.deepEqual(versioneDelNodo(registro).aggiornamento, {
    stato: "non-riuscito",
    versione: "aaaaaaaa",
    motivo: "La versione nuova non è partita (non si è collegata in tempo): il nodo è tornato a quella di prima.",
  });
  // Resta scritto anche se il nodo si ricollega ancora, finché non si aggiorna davvero.
  await registro.presenta(diPrima, new CanaleFinto());
  assert.equal(versioneDelNodo(registro).aggiornamento?.stato, "non-riuscito");

  // Non riuscito senza che il nodo dica perché.
  registro.segnaAggiornamento("nodo-pc-windows", { stato: "in-corso", versione: DEL_CENTRO });
  await registro.presenta(diPrima, new CanaleFinto());
  assert.deepEqual(versioneDelNodo(registro).aggiornamento, {
    stato: "non-riuscito",
    versione: "aaaaaaaa",
    motivo: "Il nodo si è ricollegato con la versione di prima.",
  });

  // Tolto il segno, non si vede più nulla; e di un ambiente che non c'è non si segna nulla.
  registro.segnaAggiornamento("nodo-pc-windows", undefined);
  assert.equal(versioneDelNodo(registro).aggiornamento, undefined);
  registro.segnaAggiornamento("un-altro-nodo", { stato: "in-corso", versione: DEL_CENTRO });
  assert.equal(registro.stato().ambienti.length, 2);
});

test("se il centro è ripartito nel frattempo, che l'aggiornamento non è riuscito lo dice il nodo", async (t) => {
  const file = await fileProvvisorio(t);
  const primo = await apriConVersione(file);
  await primo.presenta(presentazione({ versione: DI_PRIMA, siAggiorna: true }), new CanaleFinto());
  await primo.decidi("nodo-pc-windows", "approvato");

  const secondo = await apriConVersione(file);
  await secondo.presenta(
    presentazione({ versione: DI_PRIMA, siAggiorna: true, aggiornamentoFallito: { versione: DEL_CENTRO, motivo: "si è spenta da sola, con il codice 1" } }),
    new CanaleFinto(),
  );
  assert.deepEqual(versioneDelNodo(secondo).aggiornamento, {
    stato: "non-riuscito",
    versione: "aaaaaaaa",
    motivo: "La versione nuova non è partita (si è spenta da sola, con il codice 1): il nodo è tornato a quella di prima.",
  });
});

test("il segreto nuovo di un nodo si prende solo da un collegamento cifrato, e una conferma persa si ripete", async (t) => {
  const file = await fileProvvisorio(t);
  const registro = await apri(file);
  const primo = new CanaleFinto(true);
  await registro.presenta(presentazione(), primo);
  await registro.decidi("nodo-pc-windows", "approvato");
  const NUOVO = "un-segreto-nuovo-lungo-almeno-trentadue-caratteri";

  // In chiaro il segreto proposto non si guarda: il nodo è accolto con quello di prima, senza conferma.
  const inChiaro = new CanaleFinto(false);
  assert.equal(await registro.presenta(presentazione({ segretoProssimo: NUOVO }), inChiaro), "accolto");
  assert.deepEqual(inChiaro.ricevuti, [{ tipo: "accolto", nome: "PC Windows" }]);
  assert.equal(await registro.presenta(presentazione({ segreto: NUOVO }), new CanaleFinto(true)), "rifiutato");

  // Cifrato, il centro lo prende e lo conferma.
  const cifrato = new CanaleFinto(true);
  assert.equal(await registro.presenta(presentazione({ segretoProssimo: NUOVO }), cifrato), "accolto");
  assert.deepEqual(cifrato.ricevuti, [{ tipo: "accolto", nome: "PC Windows", segretoCambiato: true }]);
  assert.equal(registro.stato().ambienti.find((ambiente) => ambiente.id === "nodo-pc-windows")?.cifrato, true);

  // La conferma si è persa: il nodo ripropone, il centro ha già quello nuovo e lo riconferma. Anche dopo un riavvio.
  const riaperto = await apri(file);
  const ancora = new CanaleFinto(true);
  assert.equal(await riaperto.presenta(presentazione({ segretoProssimo: NUOVO }), ancora), "accolto");
  assert.deepEqual(ancora.ricevuti, [{ tipo: "accolto", nome: "PC Windows", segretoCambiato: true }]);
  // Da qui vale solo quello nuovo.
  assert.equal(await riaperto.presenta(presentazione({ segreto: NUOVO }), new CanaleFinto(true)), "accolto");
  assert.equal(await riaperto.presenta(presentazione(), new CanaleFinto(true)), "rifiutato");
  // Un segreto proposto troppo corto è una presentazione sbagliata.
  assert.equal(await riaperto.presenta(presentazione({ segreto: NUOVO, segretoProssimo: "corto" }), new CanaleFinto(true)), "rifiutato");
});
