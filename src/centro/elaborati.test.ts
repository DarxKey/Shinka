import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import type { ElaboratiDellArgomento } from "../protocollo/elaborati.ts";
import { allestisci, avviaNodoAccettato, finche, ID_NODO } from "../prove/banco.ts";
import { COOKIE_SESSIONE, POLITICA_ELABORATO } from "./centro.ts";
import { Elaborati, relativoAllaCartella } from "./elaborati.ts";
import type { EventoArchiviato } from "../protocollo/eventi.ts";
import { azioniDellaHome } from "./strumenti-home.ts";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02]);

test("il pannello elenca gli elaborati dell'argomento, i più recenti per primi, e li serve nel recinto", async (t) => {
  const banco = await allestisci(t);
  const id = banco.casa.idArgomentoAperto;
  const cookies = { [COOKIE_SESSIONE]: await banco.entra() };
  const cartella = banco.casa.cartellaAperta;

  // Un argomento che non ha ancora prodotto nulla non ha elaborati, ma l'ambiente del centro c'è.
  const vuoto = await banco.centro.inject({ method: "GET", url: `/api/argomenti/${id}/elaborati`, cookies });
  assert.equal(vuoto.statusCode, 200);
  assert.deepEqual(vuoto.json(), { idArgomento: id, ambienti: [] });

  await mkdir(join(cartella, "tokyo"), { recursive: true });
  await mkdir(join(cartella, ".claude"), { recursive: true });
  await writeFile(join(cartella, "tokyo", "itinerario.md"), "# Giro dei negozi\n\n- Akihabara\n");
  await writeFile(join(cartella, "mappa.png"), PNG);
  await writeFile(join(cartella, "mappa.html"), "<!doctype html><script>document.title='mappa'</script>");
  await writeFile(join(cartella, ".claude", "impostazioni.json"), "{}");
  await utimes(join(cartella, "tokyo", "itinerario.md"), new Date("2026-11-10"), new Date("2026-11-10"));
  await utimes(join(cartella, "mappa.html"), new Date("2026-11-11"), new Date("2026-11-11"));
  await utimes(join(cartella, "mappa.png"), new Date("2026-11-12"), new Date("2026-11-12"));

  const elenco = (await banco.centro.inject({ method: "GET", url: `/api/argomenti/${id}/elaborati`, cookies })).json() as ElaboratiDellArgomento;
  assert.equal(elenco.ambienti.length, 1);
  const [centro] = elenco.ambienti;
  assert.equal(centro?.idAmbiente, "centro");
  assert.equal(centro?.attivo, true);
  // I file nascosti, come le impostazioni degli strumenti, non sono elaborati.
  assert.deepEqual(centro?.file.map((voce) => voce.percorso), ["mappa.png", "mappa.html", "tokyo/itinerario.md"]);
  assert.equal(centro?.quanti, 3);
  assert.equal(centro?.file[0]?.byte, PNG.length);
  assert.equal(centro?.file[0]?.modificatoIl, new Date("2026-11-12").toISOString());

  const indirizzo = (percorso: string, altro = "") =>
    `/api/argomenti/${id}/elaborati/file?ambiente=centro&percorso=${encodeURIComponent(percorso)}${altro}`;
  const immagine = await banco.centro.inject({ method: "GET", url: indirizzo("mappa.png"), cookies });
  assert.equal(immagine.statusCode, 200);
  assert.equal(immagine.headers["content-type"], "image/png");
  assert.deepEqual(immagine.rawPayload, PNG);
  assert.match(String(immagine.headers["content-disposition"]), /^inline; filename\*=UTF-8''mappa\.png$/);
  // Ogni elaborato ha il suo recinto, al posto della politica dell'interfaccia.
  assert.equal(immagine.headers["content-security-policy"], POLITICA_ELABORATO);
  assert.equal(immagine.headers["x-content-type-options"], "nosniff");

  const pagina = await banco.centro.inject({ method: "GET", url: indirizzo("mappa.html"), cookies });
  assert.equal(pagina.headers["content-type"], "text/html; charset=utf-8");
  assert.match(String(pagina.headers["content-security-policy"]), /^sandbox allow-scripts /);
  assert.doesNotMatch(String(pagina.headers["content-security-policy"]), /allow-same-origin/);
  assert.match(String(pagina.headers["content-security-policy"]), /frame-ancestors 'self'/);

  const testo = await banco.centro.inject({ method: "GET", url: indirizzo("tokyo/itinerario.md", "&scarica=1"), cookies });
  assert.equal(testo.body, "# Giro dei negozi\n\n- Akihabara\n");
  assert.match(String(testo.headers["content-disposition"]), /^attachment; filename\*=UTF-8''itinerario\.md$/);

  // L'interfaccia, invece, tiene la sua politica, e ammette gli elaborati in un riquadro.
  const stato = await banco.centro.inject({ method: "GET", url: "/api/stato" });
  assert.match(String(stato.headers["content-security-policy"]), /frame-src 'self'/);

  // Fuori dalla cartella, da un altro argomento o senza sessione non si legge nulla.
  assert.equal((await banco.centro.inject({ method: "GET", url: indirizzo("../argomenti.json"), cookies })).statusCode, 400);
  assert.equal((await banco.centro.inject({ method: "GET", url: indirizzo("non-ce.txt"), cookies })).statusCode, 404);
  assert.equal(
    (await banco.centro.inject({ method: "GET", url: indirizzo("mappa.png").replace("ambiente=centro", "ambiente=marte"), cookies })).statusCode,
    404,
  );
  assert.equal((await banco.centro.inject({ method: "GET", url: "/api/argomenti/mai-esistito/elaborati", cookies })).statusCode, 404);
  assert.equal(
    (await banco.centro.inject({ method: "GET", url: indirizzo("mappa.png").replace(id, "mai-esistito"), cookies })).statusCode,
    404,
  );
  assert.equal((await banco.centro.inject({ method: "GET", url: indirizzo("mappa.png") })).statusCode, 401);
  assert.equal((await banco.centro.inject({ method: "GET", url: `/api/argomenti/${id}/elaborati` })).statusCode, 401);
});

test("gli elaborati in un altro ambiente si vedono attraverso il suo nodo, e da spento si sa che ci sono", async (t) => {
  const banco = await allestisci(t);
  const id = banco.casa.idArgomentoAperto;
  const cookies = { [COOKIE_SESSIONE]: await banco.entra() };
  const nodo = await avviaNodoAccettato(t, banco);
  await banco.agisci(ID_NODO, id, { tipo: "scrivi-file", percorso: "rinomina.ps1", contenuto: "Get-ChildItem\n" });
  // La storia ricorda che la Home ha scritto in quell'ambiente.
  banco.home.emetti({
    tipo: "azione-iniziata",
    idAzione: "a1",
    strumento: "mcp__shinka__scrivi_file",
    ingresso: { ambiente: "PC Windows", percorso: "rinomina.ps1", contenuto: "Get-ChildItem\n" },
  });
  banco.home.emetti({ tipo: "azione-conclusa", idAzione: "a1", esito: "File scritto", errore: false });

  const elenco = (await banco.centro.inject({ method: "GET", url: `/api/argomenti/${id}/elaborati`, cookies })).json() as ElaboratiDellArgomento;
  const remoto = elenco.ambienti.find((voce) => voce.idAmbiente === ID_NODO);
  assert.equal(remoto?.nomeAmbiente, "PC Windows");
  assert.deepEqual(remoto?.file.map((voce) => voce.percorso), ["rinomina.ps1"]);
  // Su Windows uno script di PowerShell viene scritto con il segno iniziale: un carattere, tre byte.
  const segno = process.platform === "win32" ? "﻿" : "";
  assert.equal(remoto?.file[0]?.byte, Buffer.byteLength(`${segno}Get-ChildItem\n`));

  const letto = await banco.centro.inject({
    method: "GET",
    url: `/api/argomenti/${id}/elaborati/file?ambiente=${ID_NODO}&percorso=rinomina.ps1`,
    cookies,
  });
  assert.equal(letto.statusCode, 200);
  assert.equal(letto.body, `${segno}Get-ChildItem\n`);
  assert.equal(letto.headers["content-type"], "text/plain; charset=utf-8");

  nodo.collegamento.ferma();
  await finche(() => banco.ambienti.stato().ambienti.find((a) => a.id === ID_NODO)?.attivo === false, "il nodo si spegne");
  const spento = (await banco.centro.inject({ method: "GET", url: `/api/argomenti/${id}/elaborati`, cookies })).json() as ElaboratiDellArgomento;
  const daSpento = spento.ambienti.find((voce) => voce.idAmbiente === ID_NODO);
  assert.equal(daSpento?.attivo, false);
  assert.match(daSpento?.problema ?? "", /spento/);
  const nonLetto = await banco.centro.inject({
    method: "GET",
    url: `/api/argomenti/${id}/elaborati/file?ambiente=${ID_NODO}&percorso=rinomina.ps1`,
    cookies,
  });
  assert.equal(nonLetto.statusCode, 409);
});

test("la Home mostra nella chat un elaborato della cartella dell'argomento, e nient'altro", async (t) => {
  const banco = await allestisci(t);
  const azioni = azioniDellaHome({
    ambienti: banco.ambienti,
    lavori: banco.lavori,
    proposte: banco.proposte,
    home: () => banco.casa,
    agisci: banco.agisci,
    elaborati: banco.elaborati,
  });
  const cartella = banco.casa.cartellaAperta;
  await mkdir(join(cartella, "tokyo"), { recursive: true });
  await writeFile(join(cartella, "tokyo", "mappa.html"), "<p>mappa</p>");
  const mostrati = () => banco.canale.archiviati.map((voce) => voce.evento).filter((evento) => evento.tipo === "elaborato-mostrato");

  const relativo = await azioni.mostraElaborato({ ambiente: "Unraid", percorso: "tokyo/mappa.html", titolo: " Mappa dei negozi " });
  assert.equal(relativo.isError, undefined);
  assert.match(relativo.content[0].text, /tokyo\/mappa\.html/);
  // Anche con il percorso completo, come lo scrive Write, il file è lo stesso.
  await azioni.mostraElaborato({ ambiente: "unraid", percorso: join(cartella, "tokyo", "mappa.html") });
  assert.deepEqual(mostrati(), [
    {
      tipo: "elaborato-mostrato",
      idArgomento: banco.casa.idArgomentoAperto,
      idAmbiente: "centro",
      nomeAmbiente: "Unraid",
      percorso: "tokyo/mappa.html",
      titolo: "Mappa dei negozi",
    },
    {
      tipo: "elaborato-mostrato",
      idArgomento: banco.casa.idArgomentoAperto,
      idAmbiente: "centro",
      nomeAmbiente: "Unraid",
      percorso: "tokyo/mappa.html",
    },
  ]);

  for (const [percorso, motivo] of [
    ["tokyo/altro.html", /non c'è/],
    ["/etc/passwd", /non sta nella cartella/],
    ["../argomenti.json", /non sta nella cartella/],
  ] as const) {
    const rifiuto = await azioni.mostraElaborato({ ambiente: "Unraid", percorso });
    assert.equal(rifiuto.isError, true, percorso);
    assert.match(rifiuto.content[0].text, motivo);
  }
  const altrove = await azioni.mostraElaborato({ ambiente: "Marte", percorso: "tokyo/mappa.html" });
  assert.match(altrove.content[0].text, /Nessun ambiente si chiama "Marte"/);
  assert.equal(mostrati().length, 2);
});

test("un percorso completo vale solo dentro la cartella dell'argomento, anche su Windows", () => {
  assert.equal(relativoAllaCartella("/dati/_home/a1", "/dati/_home/a1/tokyo/mappa.png", false), "tokyo/mappa.png");
  assert.equal(relativoAllaCartella("/dati/_home/a1", "./mappa.png", false), "mappa.png");
  assert.equal(relativoAllaCartella("/dati/_home/a1", "/dati/_home/a10/mappa.png", false), undefined);
  assert.equal(relativoAllaCartella("/dati/_home/a1", "/dati/_home/a1/../segreti", false), undefined);
  assert.equal(relativoAllaCartella("C:\\Progetti\\_home\\a1", "c:\\progetti\\_home\\A1\\mappa.png", true), "mappa.png");
  assert.equal(relativoAllaCartella("C:\\Progetti\\_home\\a1", "C:\\Windows\\win.ini", true), undefined);
});

test("tra gli elaborati consegnati ci sono solo quelli mostrati, una volta sola, dal più recente, in tutti gli argomenti", async () => {
  const mostrato = (idArgomento: string, percorso: string, quando: string, titolo?: string) => ({
    n: 1,
    quando,
    evento: {
      tipo: "elaborato-mostrato" as const,
      idArgomento,
      idAmbiente: "centro",
      nomeAmbiente: "Unraid",
      percorso,
      ...(titolo === undefined ? {} : { titolo }),
    },
  });
  const storie: Record<string, EventoArchiviato[]> = {
    aperto: [mostrato("aperto", "mappa.png", "2026-11-14T09:00:00.000Z", "Mappa di Shinjuku")],
    vecchio: [
      { n: 1, quando: "2026-11-12T08:00:00.000Z", evento: { tipo: "azione-iniziata", idAzione: "a", strumento: "Write", ingresso: { file_path: "bozza.md" } } },
      mostrato("vecchio", "itinerario.md", "2026-11-12T10:00:00.000Z", "Itinerario"),
      // Mostrato di nuovo dopo una modifica: resta uno, con la data nuova e il titolo di prima.
      mostrato("vecchio", "itinerario.md", "2026-11-13T18:00:00.000Z"),
    ],
  };
  const elaborati = new Elaborati({
    ambienti: () => [],
    storia: async (id) => storie[id],
    cartellaAlCentro: () => "/x",
    agisci: async () => ({ riuscita: false, testo: "" }),
    argomenti: () => [{ id: "aperto" }, { id: "vecchio", titolo: "Giro a Tokyo" }],
  });
  assert.deepEqual(await elaborati.consegnati(), [
    { idArgomento: "aperto", idAmbiente: "centro", nomeAmbiente: "Unraid", percorso: "mappa.png", titolo: "Mappa di Shinjuku", quando: "2026-11-14T09:00:00.000Z" },
    {
      idArgomento: "vecchio",
      titoloArgomento: "Giro a Tokyo",
      idAmbiente: "centro",
      nomeAmbiente: "Unraid",
      percorso: "itinerario.md",
      titolo: "Itinerario",
      quando: "2026-11-13T18:00:00.000Z",
    },
  ]);
});

test("gli elaborati consegnati li legge solo il proprietario", async (t) => {
  const banco = await allestisci(t);
  assert.equal((await banco.centro.inject({ method: "GET", url: "/api/elaborati" })).statusCode, 401);
  banco.home.emetti({ tipo: "elaborato-mostrato", idArgomento: banco.casa.idArgomentoAperto, idAmbiente: "centro", nomeAmbiente: "Unraid", percorso: "mappa.png" });
  const letti = await banco.centro.inject({ method: "GET", url: "/api/elaborati", cookies: { [COOKIE_SESSIONE]: await banco.entra() } });
  assert.equal(letti.statusCode, 200);
  assert.deepEqual(letti.json().elaborati.map((voce: { percorso: string }) => voce.percorso), ["mappa.png"]);
});

test("un elaborato vivo si rifà con il comando che la Home gli ha dato, mai con uno che arriva da fuori", async (t) => {
  const banco = await allestisci(t);
  const id = banco.casa.idArgomentoAperto;
  const cookies = { [COOKIE_SESSIONE]: await banco.entra() };
  const azioni = azioniDellaHome({ ambienti: banco.ambienti, lavori: banco.lavori, proposte: banco.proposte, home: () => banco.casa, agisci: banco.agisci, elaborati: banco.elaborati });
  const cartella = banco.casa.cartellaAperta;
  await writeFile(join(cartella, "cruscotto.md"), "# Prezzi\n\nvecchi\n");
  await writeFile(join(cartella, "statico.md"), "fermo\n");
  await azioni.mostraElaborato({ ambiente: "Unraid", percorso: "cruscotto.md", aggiorna: "printf '# Prezzi\\n\\nnuovi\\n' > cruscotto.md && echo rifatto" });
  await azioni.mostraElaborato({ ambiente: "Unraid", percorso: "statico.md" });

  const consegnati = (await banco.centro.inject({ method: "GET", url: "/api/elaborati", cookies })).json() as { elaborati: { percorso: string; aggiorna?: string }[] };
  assert.match(consegnati.elaborati.find((voce) => voce.percorso === "cruscotto.md")?.aggiorna ?? "", /printf/);
  assert.equal(consegnati.elaborati.find((voce) => voce.percorso === "statico.md")?.aggiorna, undefined);

  const aggiorna = (percorso: string, altro: Record<string, unknown> = {}) =>
    banco.centro.inject({ method: "POST", url: `/api/argomenti/${id}/elaborati/aggiorna`, cookies, payload: { ambiente: "centro", percorso, ...altro } });
  const fatto = await aggiorna("cruscotto.md");
  assert.equal(fatto.statusCode, 200);
  assert.deepEqual(fatto.json(), { riuscita: true, uscita: "Codice di uscita: 0\nrifatto" });
  const letto = await banco.centro.inject({ method: "GET", url: `/api/argomenti/${id}/elaborati/file?ambiente=centro&percorso=cruscotto.md`, cookies });
  assert.equal(letto.body, "# Prezzi\n\nnuovi\n");
  assert.equal((await aggiorna("statico.md")).statusCode, 409);
  assert.equal((await aggiorna("mai-mostrato.md")).statusCode, 404);
  // Un comando mandato dal browser non vale: si ignora, e parte solo quello della storia.
  assert.equal((await aggiorna("cruscotto.md", { comando: "touch rubato.txt" })).statusCode, 200);
  assert.equal(existsSync(join(cartella, "rubato.txt")), false);
});

test("il proprietario riscrive a mano un elaborato di testo consegnato, qui e su un nodo; gli altri no", async (t) => {
  const banco = await allestisci(t);
  const id = banco.casa.idArgomentoAperto;
  const cookies = { [COOKIE_SESSIONE]: await banco.entra() };
  const azioni = azioniDellaHome({ ambienti: banco.ambienti, lavori: banco.lavori, proposte: banco.proposte, home: () => banco.casa, agisci: banco.agisci, elaborati: banco.elaborati });
  const cartella = banco.casa.cartellaAperta;
  await mkdir(join(cartella, "tokyo"), { recursive: true });
  await writeFile(join(cartella, "tokyo", "itinerario.md"), "# Giorno 1\n");
  await writeFile(join(cartella, "mappa.png"), PNG);
  await writeFile(join(cartella, "bozza.md"), "non consegnata\n");
  await azioni.mostraElaborato({ ambiente: "Unraid", percorso: "tokyo/itinerario.md" });
  await azioni.mostraElaborato({ ambiente: "Unraid", percorso: "mappa.png" });

  const scrivi = (ambiente: string, percorso: string, contenuto: string) =>
    banco.centro.inject({ method: "PUT", url: `/api/argomenti/${id}/elaborati/file`, cookies, payload: { ambiente, percorso, contenuto } });
  assert.equal((await scrivi("centro", "tokyo/itinerario.md", "# Giorno 1\n\nKyoto\n")).statusCode, 200);
  const letto = await banco.centro.inject({ method: "GET", url: `/api/argomenti/${id}/elaborati/file?ambiente=centro&percorso=tokyo/itinerario.md`, cookies });
  assert.equal(letto.body, "# Giorno 1\n\nKyoto\n");
  assert.equal((await scrivi("centro", "mappa.png", "x")).statusCode, 400);
  assert.equal((await scrivi("centro", "bozza.md", "x")).statusCode, 404);
  assert.equal((await scrivi("centro", "../argomenti.json", "x")).statusCode, 400);

  // Su un nodo il file si scrive attraverso il suo collegamento.
  await avviaNodoAccettato(t, banco);
  await banco.agisci(ID_NODO, id, { tipo: "scrivi-file", percorso: "note.txt", contenuto: "prima\n" });
  await azioni.mostraElaborato({ ambiente: "PC Windows", percorso: "note.txt" });
  assert.equal((await scrivi(ID_NODO, "note.txt", "dopo\n")).statusCode, 200);
  const remoto = await banco.centro.inject({ method: "GET", url: `/api/argomenti/${id}/elaborati/file?ambiente=${ID_NODO}&percorso=note.txt`, cookies });
  assert.equal(remoto.body, "dopo\n");
});
