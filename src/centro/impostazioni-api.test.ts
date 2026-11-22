import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import type { EventoArchiviato } from "../protocollo/eventi.ts";
import { allestisci, avviaNodoAccettato, finche, ID_NODO, type Banco } from "../prove/banco.ts";
import { COOKIE_SESSIONE } from "./centro.ts";
import { CustodiaImmagini } from "./immagini.ts";
import { StatoHome } from "./stato-home.ts";

/** Un'immagine PNG di un solo punto. */
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

async function chiama(banco: Banco, url: string, corpo: unknown): Promise<{ stato: number; dati: Record<string, unknown> }> {
  const risposta = await banco.centro.inject({
    method: "POST",
    url,
    cookies: { [COOKIE_SESSIONE]: await banco.entra() },
    payload: corpo as Record<string, unknown>,
  });
  return { stato: risposta.statusCode, dati: risposta.json() };
}

async function nuovoProgetto(banco: Banco, idAmbiente = "centro"): Promise<string> {
  return (await banco.lavori.crea("Videogioco", idAmbiente, "Un gioco di piattaforme.")).id;
}

function ricordati(banco: Banco, idProgetto?: string): EventoArchiviato["evento"][] {
  const canale = idProgetto === undefined ? banco.canale : banco.lavori.canale(idProgetto);
  const ricevuti: EventoArchiviato["evento"][] = [];
  canale?.iscrivi(({ n, evento }) => {
    if (n === 0) ricevuti.push(evento);
  })();
  return ricevuti;
}

test("le scelte sulla Home vengono applicate, salvate e mostrate a chi si collega", async (t) => {
  const banco = await allestisci(t);
  const { stato, dati } = await chiama(banco, "/api/home/impostazioni", { modello: "sonnet", impegno: "high" });
  assert.equal(stato, 200);
  const attese = { modello: "sonnet", impegno: "high", permessi: "chiedi" };
  assert.deepEqual(dati.impostazioni, attese);
  assert.deepEqual(banco.home.impostazioni, [attese]);
  assert.deepEqual(ricordati(banco), [{ tipo: "impostazioni", impostazioni: attese }]);

  // Restano dopo il riavvio del centro.
  const riaperto = StatoHome.apri(join(banco.cartella, "home.json"), { permessi: "chiedi" });
  assert.deepEqual(riaperto.impostazioni, attese);
});

test("la Home salvata con il modello piccolo di una volta passa a quello di partenza di oggi", async (t) => {
  const banco = await allestisci(t);
  const file = join(banco.cartella, "home-di-prima.json");
  const oggi = { modello: "sonnet", permessi: "chiedi" } as const;

  // Così la salvava il centro prima degli argomenti, anche senza una scelta del proprietario.
  await writeFile(file, JSON.stringify({ idSessione: "sessione-di-prima", impostazioni: { modello: "haiku", permessi: "automatico" } }));
  const ereditata = StatoHome.apri(file, oggi);
  assert.deepEqual(ereditata.impostazioni, { modello: "sonnet", permessi: "automatico" });
  assert.equal(ereditata.idSessioneEreditata, "sessione-di-prima");

  // Un altro modello era una scelta del proprietario, e resta.
  await writeFile(file, JSON.stringify({ impostazioni: { modello: "opus", permessi: "chiedi" } }));
  assert.equal(StatoHome.apri(file, oggi).impostazioni.modello, "opus");

  // E da oggi anche il modello piccolo è una scelta: una volta salvata, resta.
  const scelta = StatoHome.apri(file, oggi);
  await scelta.cambia({ modello: "haiku" });
  assert.equal(StatoHome.apri(file, oggi).impostazioni.modello, "haiku");
});

test("una voce si riporta al valore predefinito, e un modo sconosciuto viene rifiutato", async (t) => {
  const banco = await allestisci(t);
  const predefinito = await chiama(banco, "/api/home/impostazioni", { modello: null });
  assert.deepEqual(predefinito.dati.impostazioni, { permessi: "chiedi" });

  for (const corpo of [{ permessi: "tutto-libero" }, { impegno: "enorme" }, { modello: "x".repeat(101) }]) {
    const rifiutata = await chiama(banco, "/api/home/impostazioni", corpo);
    assert.equal(rifiutata.stato, 400, JSON.stringify(corpo));
  }
  assert.equal(banco.home.impostazioni.length, 1);
});

test("un progetto nasce con le sue impostazioni e ricorda quelle scelte dal proprietario", async (t) => {
  const banco = await allestisci(t);
  const idProgetto = await nuovoProgetto(banco);
  const conversazione = banco.conversazioniLocali[0];
  assert.deepEqual(conversazione?.configurazione?.impostazioni, { permessi: "modifiche-libere" });
  assert.deepEqual(ricordati(banco, idProgetto), [
    { tipo: "impostazioni", impostazioni: { permessi: "modifiche-libere" } },
  ]);

  const { stato } = await chiama(banco, `/api/progetti/${idProgetto}/impostazioni`, {
    modello: "opus",
    permessi: "senza-permessi",
  });
  assert.equal(stato, 200);
  const attese = { modello: "opus", permessi: "senza-permessi" };
  assert.deepEqual(conversazione?.impostazioni, [attese]);
  assert.deepEqual(banco.progetti.impostazioni(idProgetto), attese);
  assert.deepEqual(ricordati(banco, idProgetto), [{ tipo: "impostazioni", impostazioni: attese }]);
  // Le scelte non entrano nella storia della conversazione.
  assert.equal(JSON.stringify(banco.lavori.canale(idProgetto)?.archiviati).includes("impostazioni"), false);

  const inesistente = await chiama(banco, "/api/progetti/mai-esistito/impostazioni", { modello: "opus" });
  assert.equal(inesistente.stato, 404);
});

test("le impostazioni di un progetto arrivano al nodo, all'apertura e a ogni cambio", async (t) => {
  const banco = await allestisci(t);
  const nodo = await avviaNodoAccettato(t, banco);
  const idProgetto = await nuovoProgetto(banco, ID_NODO);
  await finche(() => nodo.conversazioni.length === 1, "la conversazione nasce sul nodo");
  assert.deepEqual(nodo.conversazioni[0]?.configurazione?.impostazioni, { permessi: "modifiche-libere" });

  await chiama(banco, `/api/progetti/${idProgetto}/impostazioni`, { impegno: "max", permessi: "automatico" });
  await finche(() => nodo.conversazioni[0]?.impostazioni.length === 1, "il nodo riceve le scelte nuove");
  assert.deepEqual(nodo.conversazioni[0]?.impostazioni, [{ impegno: "max", permessi: "automatico" }]);
});

test("gli allegati di un messaggio arrivano alla conversazione, anche senza testo", async (t) => {
  const banco = await allestisci(t);
  const foto = { nome: "schermata.png", tipo: "image/png", dati: PNG };
  const nota = { nome: "appunti.txt", tipo: "text/plain", dati: "Y2lhbw==" };

  const allaHome = await chiama(banco, "/api/home/messaggi", { testo: "", allegati: [foto] });
  assert.equal(allaHome.stato, 202);
  assert.deepEqual(banco.home.inviati, [""]);
  assert.deepEqual(banco.home.allegati, [[foto]]);

  const idProgetto = await nuovoProgetto(banco);
  const alProgetto = await chiama(banco, `/api/progetti/${idProgetto}/messaggi`, {
    testo: "Guarda questi.",
    allegati: [foto, nota],
  });
  assert.equal(alProgetto.stato, 202);
  assert.deepEqual(banco.conversazioniLocali[0]?.allegati, [[foto, nota]]);
});

test("allegati non validi e messaggi del tutto vuoti vengono rifiutati", async (t) => {
  const banco = await allestisci(t);
  const foto = { nome: "schermata.png", tipo: "image/png", dati: PNG };
  for (const corpo of [
    { testo: "   " },
    { testo: "", allegati: [] },
    { testo: "troppi", allegati: Array.from({ length: 9 }, () => foto) },
    { testo: "rovinato", allegati: [{ ...foto, dati: "non è base64!" }] },
    { testo: "senza nome", allegati: [{ tipo: "image/png", dati: PNG }] },
  ]) {
    const risposta = await chiama(banco, "/api/home/messaggi", corpo);
    assert.equal(risposta.stato, 400, corpo.testo);
  }
  assert.deepEqual(banco.home.inviati, []);
});

test("un allegato arriva anche a un progetto che vive su un nodo", async (t) => {
  const banco = await allestisci(t);
  const nodo = await avviaNodoAccettato(t, banco);
  const idProgetto = await nuovoProgetto(banco, ID_NODO);
  await finche(() => nodo.conversazioni.length === 1, "la conversazione nasce sul nodo");
  const foto = { nome: "schermata.png", tipo: "image/png", dati: PNG };

  await chiama(banco, `/api/progetti/${idProgetto}/messaggi`, { testo: "Ecco lo schermo.", allegati: [foto] });
  await finche(() => nodo.conversazioni[0]?.allegati.length === 1, "il nodo riceve l'allegato");
  assert.deepEqual(nodo.conversazioni[0]?.allegati, [[foto]]);
});

test("un'immagine prodotta da un'azione resta al centro come file e si può aprire", async (t) => {
  const banco = await allestisci(t);
  const idProgetto = await nuovoProgetto(banco);
  banco.conversazioniLocali[0]?.emetti({
    tipo: "azione-conclusa",
    idAzione: "a1",
    esito: "[immagine]",
    errore: false,
    immagini: [{ tipo: "image/png", dati: PNG }, { tipo: "image/svg+xml", dati: PNG }],
  });

  // Nell'archivio resta il nome, non il contenuto; un tipo che non mostriamo viene scartato.
  const archiviato = banco.lavori.canale(idProgetto)?.archiviati.at(-1)?.evento;
  assert.ok(archiviato?.tipo === "azione-conclusa" && archiviato.immagini?.length === 1);
  const immagine = archiviato.immagini[0];
  assert.ok(immagine?.id !== undefined && immagine.dati === undefined && immagine.tipo === "image/png");
  const salvata = await readFile(join(banco.cartella, "immagini", idProgetto, immagine.id));
  assert.deepEqual(salvata, Buffer.from(PNG, "base64"));

  const cookies = { [COOKIE_SESSIONE]: await banco.entra() };
  const indirizzo = `/api/progetti/${idProgetto}/immagini/${immagine.id}`;
  const aperta = await banco.centro.inject({ method: "GET", url: indirizzo, cookies });
  assert.equal(aperta.statusCode, 200);
  assert.equal(aperta.headers["content-type"], "image/png");
  assert.equal(aperta.headers["x-content-type-options"], "nosniff");
  assert.deepEqual(aperta.rawPayload, Buffer.from(PNG, "base64"));

  const senzaSessione = await banco.centro.inject({ method: "GET", url: indirizzo });
  assert.equal(senzaSessione.statusCode, 401);
  for (const altro of [
    `/api/progetti/${idProgetto}/immagini/inventata.png`,
    `/api/progetti/${idProgetto}/immagini/..%2F..%2Fproprietario.json`,
    `/api/progetti/altro-progetto/immagini/${immagine.id}`,
    `/api/home/immagini/${immagine.id}`,
  ]) {
    const risposta = await banco.centro.inject({ method: "GET", url: altro, cookies });
    assert.equal(risposta.statusCode, 404, altro);
  }
});

test("la custodia accetta solo nomi suoi e lascia intatti gli eventi senza immagini", async (t) => {
  const banco = await allestisci(t);
  const custodia = new CustodiaImmagini(join(banco.cartella, "immagini"));
  const messaggio = { tipo: "messaggio-proprietario", id: "m1", testo: "ciao" } as const;
  assert.equal(custodia.prendi("home", messaggio), messaggio);

  const conFoto = custodia.prendi("home", { ...messaggio, immagini: [{ tipo: "image/png", dati: PNG }] });
  assert.ok(conFoto.tipo === "messaggio-proprietario" && conFoto.immagini?.[0]?.id !== undefined);
  assert.ok(custodia.trova("home", conFoto.immagini[0].id));
  assert.equal(custodia.trova("../dati", conFoto.immagini[0].id), undefined);
  assert.equal(custodia.trova("home", "../proprietario.json"), undefined);

  // Un nome di conversazione non valido non crea cartelle fuori posto.
  const scartata = custodia.prendi("../fuori", { ...messaggio, immagini: [{ tipo: "image/png", dati: PNG }] });
  assert.ok(scartata.tipo === "messaggio-proprietario" && scartata.immagini === undefined);
});

test("lo stato di una conversazione arriva a pezzi e chi si collega lo riceve intero", async (t) => {
  const banco = await allestisci(t);
  banco.canale.pubblica({ tipo: "stato", stato: { modelli: [{ valore: "opus", nome: "Opus", descrizione: "" }] } });
  banco.canale.pubblica({ tipo: "stato", stato: { modello: "claude-haiku-5-5", contesto: { usati: 1200, massimo: 200000, percento: 1 } } });
  banco.canale.pubblica({ tipo: "stato", stato: { contesto: { usati: 46000, massimo: 200000, percento: 23 } } });

  assert.deepEqual(ricordati(banco).filter((evento) => evento.tipo === "stato"), [
    {
      tipo: "stato",
      stato: {
        modelli: [{ valore: "opus", nome: "Opus", descrizione: "" }],
        modello: "claude-haiku-5-5",
        contesto: { usati: 46000, massimo: 200000, percento: 23 },
      },
    },
  ]);
  assert.deepEqual(banco.canale.archiviati, []);
});
