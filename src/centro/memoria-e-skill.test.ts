import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import type { DettaglioSkill, VersioniSkill } from "../protocollo/skill.ts";
import {
  allestisci,
  avviaNodoAccettato,
  finche,
  ID_NODO,
  usaStrumento,
  type Banco,
} from "../prove/banco.ts";
import { COOKIE_SESSIONE } from "./centro.ts";

const BRIEF = "Sviluppare un videogioco di piattaforme in due dimensioni.";

const BACKUP = {
  nome: "backup-foto",
  descrizione: "Quando il proprietario chiede di salvare le foto del telefono sul NAS.",
  contenuto: "1. Collega il telefono.\n2. Copia la cartella DCIM in /mnt/foto.",
  motivo: "Il backup di oggi è riuscito al primo colpo",
};

async function chiedi(
  banco: Banco,
  method: "GET" | "POST",
  url: string,
  payload?: Record<string, unknown>,
): Promise<{ stato: number; dati: Record<string, unknown> }> {
  const risposta = await banco.centro.inject({
    method,
    url,
    cookies: { [COOKIE_SESSIONE]: await banco.entra() },
    ...(payload === undefined ? {} : { payload }),
  });
  return { stato: risposta.statusCode, dati: risposta.json() };
}

async function leggiQuadro(t: TestContext, banco: Banco, atteso: string): Promise<string> {
  if (!banco.centro.server.listening) await banco.centro.listen({ host: "127.0.0.1", port: 0 });
  const { port } = banco.centro.server.address() as AddressInfo;
  const controllo = new AbortController();
  t.after(() => controllo.abort());
  const risposta = await fetch(`http://127.0.0.1:${port}/api/quadro/eventi`, {
    headers: { cookie: `${COOKIE_SESSIONE}=${await banco.entra()}` },
    signal: controllo.signal,
  });
  assert.ok(risposta.body);
  const lettore = risposta.body.pipeThrough(new TextDecoderStream()).getReader();
  let ricevuto = "";
  while (!ricevuto.includes(atteso)) {
    const { value, done } = await lettore.read();
    if (done) throw new Error(`il flusso si è chiuso prima di "${atteso}"`);
    ricevuto += value;
  }
  return ricevuto;
}

test("senza sessione memoria e skill non si leggono e non si cambiano", async (t) => {
  const { centro } = await allestisci(t);
  for (const [method, url] of [
    ["POST", "/api/memoria"],
    ["POST", "/api/memoria/abc123"],
    ["POST", "/api/memoria/abc123/cancellazione"],
    ["GET", "/api/skill/backup-foto"],
    ["GET", `/api/skill/backup-foto/modifiche/${"0".repeat(40)}`],
    ["POST", `/api/skill/backup-foto/modifiche/${"0".repeat(40)}/annullamento`],
  ] as const) {
    const risposta = await centro.inject({ method, url, payload: method === "POST" ? { testo: "x" } : undefined });
    assert.equal(risposta.statusCode, 401, `${method} ${url}`);
  }
});

test("una preferenza detta nella Home vale in un progetto di un altro ambiente, e il proprietario la corregge e la cancella", async (t) => {
  const banco = await allestisci(t);
  const nodo = await avviaNodoAccettato(t, banco);

  // Finché la memoria è vuota nessuna conversazione riceve nulla.
  banco.casa.invia("D'ora in poi rispondimi in breve.");
  assert.deepEqual(banco.home.annotazioni, []);

  // Claude, nella Home, annota la preferenza da solo.
  const annotata = await banco.comuniDellaHome("ricorda", { testo: "Preferisce risposte brevi." });
  assert.equal(annotata.errore, undefined);
  const [voce] = banco.memoria.voci();
  assert.ok(voce);
  assert.match(annotata.testo, new RegExp(`\\[${voce.id}\\] Preferisce risposte brevi\\.`));
  assert.match(readFileSync(join(banco.cartella, "memoria.md"), "utf8"), /Preferisce risposte brevi\./);

  // La conversazione che l'ha annotata la conosce già: non le viene ripetuta.
  banco.casa.invia("Grazie.");
  assert.deepEqual(banco.home.annotazioni, []);

  // Un progetto in un altro ambiente la riceve prima del suo primo messaggio.
  const progetto = await banco.lavori.crea("Videogioco", ID_NODO, BRIEF);
  await finche(() => nodo.conversazioni[0]?.inviati.length === 1, "il brief arriva al nodo");
  const remota = nodo.conversazioni[0];
  assert.ok(remota);
  assert.equal(remota.annotazioni.length, 1);
  assert.match(remota.annotazioni[0] ?? "", /^\[Shinka\] Memoria del proprietario/);
  assert.ok(remota.annotazioni[0]?.endsWith(`- [${voce.id}] Preferisce risposte brevi.`));
  // Al messaggio seguente non le viene ripetuta.
  banco.lavori.invia(progetto.id, "Continua.");
  await finche(() => remota.inviati.length === 2, "il secondo messaggio arriva al nodo");
  assert.equal(remota.annotazioni.length, 1);

  // E così un progetto nell'ambiente del centro.
  await banco.lavori.crea("Sito del club", "centro", "Un sito.");
  assert.equal(banco.conversazioniLocali[0]?.annotazioni.length, 1);

  // Il proprietario la vede nel quadro e la corregge dalla sua pagina.
  assert.match(await leggiQuadro(t, banco, "event: memoria"), new RegExp(`event: memoria\\ndata: \\{"voci":\\[\\{"id":"${voce.id}"`));
  const corretta = await chiedi(banco, "POST", `/api/memoria/${voce.id}`, { testo: "Preferisce risposte brevi, in italiano." });
  assert.equal(corretta.stato, 200);
  assert.equal(banco.memoria.voci()[0]?.testo, "Preferisce risposte brevi, in italiano.");
  // Un segreto non entra nemmeno dalla pagina.
  const segreto = await chiedi(banco, "POST", `/api/memoria/${voce.id}`, { testo: "password: Fritz!2024" });
  assert.equal(segreto.stato, 400);
  assert.equal((await chiedi(banco, "POST", "/api/memoria/zzzzzz", { testo: "Altro." })).stato, 404);

  // Ogni conversazione riceve la memoria corretta al messaggio seguente: anche la Home.
  banco.lavori.invia(progetto.id, "Vai avanti.");
  await finche(() => remota.inviati.length === 3, "il terzo messaggio arriva al nodo");
  assert.equal(remota.annotazioni.length, 2);
  assert.match(remota.annotazioni[1] ?? "", /Preferisce risposte brevi, in italiano\.$/);
  banco.casa.invia("Che ore sono?");
  assert.match(banco.home.annotazioni.at(-1) ?? "", /Preferisce risposte brevi, in italiano\.$/);

  // Può aggiungerne una a mano, e cancellarle.
  const aggiunta = await chiedi(banco, "POST", "/api/memoria", { testo: "Abita a Udine." });
  assert.equal(aggiunta.stato, 200);
  assert.equal(banco.memoria.voci().length, 2);
  for (const { id } of banco.memoria.voci()) {
    assert.equal((await chiedi(banco, "POST", `/api/memoria/${id}/cancellazione`)).stato, 200);
  }
  assert.equal((await chiedi(banco, "POST", `/api/memoria/${voce.id}/cancellazione`)).stato, 404);
  banco.lavori.invia(progetto.id, "E adesso?");
  await finche(() => remota.inviati.length === 4, "il quarto messaggio arriva al nodo");
  assert.match(remota.annotazioni.at(-1) ?? "", /ora è vuota/);
});

test("un progetto in un altro ambiente annota, corregge e dimentica attraverso il centro", async (t) => {
  const banco = await allestisci(t);
  const nodo = await avviaNodoAccettato(t, banco);
  await banco.lavori.crea("Videogioco", ID_NODO, BRIEF);
  await finche(() => nodo.conversazioni.length === 1, "la conversazione del progetto nasce sul nodo");
  const remota = nodo.conversazioni[0];
  assert.ok(remota);

  // Gli strumenti di Shinka non chiedono consenso, in nessun modo dei permessi.
  const senzaRichiesta = remota.configurazione?.strumentiSenzaRichiesta ?? [];
  for (const nome of ["ricorda", "correggi_memoria", "dimentica", "leggi_skill", "salva_skill"]) {
    assert.ok(senzaRichiesta.includes(`mcp__shinka__${nome}`), nome);
  }

  const annotata = await usaStrumento(remota, "ricorda", { testo: "Usa pnpm, non npm." });
  assert.equal(annotata.errore, false);
  const [voce] = banco.memoria.voci();
  assert.equal(voce?.testo, "Usa pnpm, non npm.");
  assert.ok(voce);

  const corretta = await usaStrumento(remota, "correggi_memoria", { voce: `[${voce.id}]`, testo: "Usa pnpm, mai npm." });
  assert.equal(corretta.errore, false);
  assert.equal(banco.memoria.voci()[0]?.testo, "Usa pnpm, mai npm.");

  // Un segreto viene rifiutato, e la risposta dice a Claude perché.
  const segreto = await usaStrumento(remota, "ricorda", { testo: "La password del router è Fritz!2024" });
  assert.equal(segreto.errore, true);
  assert.match(segreto.testo, /segreto/);
  assert.equal(banco.memoria.voci().length, 1);

  const sconosciuta = await usaStrumento(remota, "dimentica", { voce: "zzzzzz" });
  assert.equal(sconosciuta.errore, true);
  assert.match(sconosciuta.testo, /Usa pnpm, mai npm\./);
  assert.equal((await usaStrumento(remota, "dimentica", { voce: voce.id })).errore, false);
  assert.deepEqual(banco.memoria.voci(), []);
});

test("una skill creata in un progetto vale in ogni ambiente, la sua storia si vede e una modifica si annulla", async (t) => {
  const banco = await allestisci(t);
  const nodo = await avviaNodoAccettato(t, banco);
  const fileSulNodo = join(nodo.cartellaSkill, "skills", "backup-foto", "SKILL.md");
  // Appena accolto, il nodo ha la sua copia delle skill: per ora vuota, ma già un plugin valido.
  await finche(() => existsSync(join(nodo.cartellaSkill, ".claude-plugin", "plugin.json")), "il nodo prepara la cartella delle skill");

  await banco.lavori.crea("Videogioco", ID_NODO, BRIEF);
  await finche(() => nodo.conversazioni.length === 1, "la conversazione del progetto nasce sul nodo");
  const remota = nodo.conversazioni[0];
  assert.ok(remota);
  // La conversazione carica le skill dalla copia del suo ambiente, e usarle non chiede consenso.
  assert.equal(remota.configurazione?.cartellaSkill, nodo.cartellaSkill);
  assert.equal(remota.configurazione?.consenteDaSe?.("Skill", { skill: "shinka:backup-foto" }, "chiedi"), true);
  assert.equal(remota.configurazione?.consenteDaSe?.("Skill", { skill: "altro:qualcosa" }, "chiedi"), false);

  // Claude, nel progetto, crea la skill dopo un lavoro riuscito.
  assert.match((await usaStrumento(remota, "leggi_skill", {})).testo, /nessuna skill/);
  const creata = await usaStrumento(remota, "salva_skill", BACKUP);
  assert.equal(creata.errore, false);
  assert.match(creata.testo, /Skill "backup-foto" creata/);
  await finche(() => existsSync(fileSulNodo), "la skill arriva sul nodo");
  assert.match(readFileSync(fileSulNodo, "utf8"), /Copia la cartella DCIM/);
  // Le conversazioni già aperte la rileggono, qui e là.
  await finche(() => remota.ricariche === 1, "la conversazione sul nodo rilegge le skill");
  assert.equal(banco.home.ricariche, 1);

  // Più tardi, dalla Home, la migliora: prima la legge, poi la salva intera.
  const letta = await banco.comuniDellaHome("leggi_skill", { nome: "shinka:backup-foto" });
  assert.match(letta.testo, /Copia la cartella DCIM/);
  const migliorata = await banco.comuniDellaHome("salva_skill", {
    ...BACKUP,
    contenuto: `${BACKUP.contenuto}\n3. Controlla che il numero dei file coincida.`,
    motivo: "Mancava la verifica",
  });
  assert.match(migliorata.testo, /aggiornata/);
  await finche(() => readFileSync(fileSulNodo, "utf8").includes("Controlla che il numero"), "la skill migliorata arriva sul nodo");

  // Il proprietario vede l'elenco nel quadro e la storia nella pagina della skill.
  assert.match(await leggiQuadro(t, banco, "event: skill"), /event: skill\ndata: \{"skill":\[\{"nome":"backup-foto"/);
  const dettaglio = (await chiedi(banco, "GET", "/api/skill/backup-foto")).dati as unknown as DettaglioSkill;
  assert.partialDeepStrictEqual(dettaglio.storia, [
    { tipo: "modificata", motivo: "Mancava la verifica", origine: "Home" },
    { tipo: "creata", motivo: BACKUP.motivo, origine: 'Progetto "Videogioco"' },
  ]);
  const [modifica, creazione] = dettaglio.storia;
  assert.ok(modifica !== undefined && creazione !== undefined);
  const versioni = (await chiedi(banco, "GET", `/api/skill/backup-foto/modifiche/${modifica.id}`)).dati as VersioniSkill;
  assert.equal(versioni.prima?.contenuto, BACKUP.contenuto);
  assert.match(versioni.dopo?.contenuto ?? "", /Controlla che il numero/);
  assert.equal((await chiedi(banco, "GET", "/api/skill/non-esiste")).stato, 404);
  assert.equal((await chiedi(banco, "GET", `/api/skill/backup-foto/modifiche/${"0".repeat(40)}`)).stato, 404);

  // Annulla la modifica: la skill torna com'era, ovunque, e l'annullamento resta nella storia.
  assert.equal((await chiedi(banco, "POST", `/api/skill/backup-foto/modifiche/${modifica.id}/annullamento`)).stato, 200);
  await finche(() => !readFileSync(fileSulNodo, "utf8").includes("Controlla che il numero"), "la skill torna com'era sul nodo");
  const dopo = (await chiedi(banco, "GET", "/api/skill/backup-foto")).dati as unknown as DettaglioSkill;
  assert.equal(dopo.contenuto, BACKUP.contenuto);
  assert.partialDeepStrictEqual(dopo.storia[0], { tipo: "annullata", origine: "Proprietario" });
  assert.equal(dopo.storia.length, 3);
  // Annullata due volte non cambia nulla e non lascia un'altra riga nella storia.
  assert.equal((await chiedi(banco, "POST", `/api/skill/backup-foto/modifiche/${modifica.id}/annullamento`)).stato, 200);
  assert.equal(((await chiedi(banco, "GET", "/api/skill/backup-foto")).dati as unknown as DettaglioSkill).storia.length, 3);
  assert.equal((await chiedi(banco, "POST", `/api/skill/backup-foto/modifiche/${"0".repeat(40)}/annullamento`)).stato, 404);

  // Annullare la creazione toglie la skill, anche dal nodo.
  assert.equal((await chiedi(banco, "POST", `/api/skill/backup-foto/modifiche/${creazione.id}/annullamento`)).stato, 200);
  await finche(() => !existsSync(fileSulNodo), "la skill sparisce dal nodo");
  assert.deepEqual(banco.skill.elenco(), []);
});

test("un nodo che si collega dopo riceve le skill che esistono già, e una skill con un segreto non nasce", async (t) => {
  const banco = await allestisci(t);
  assert.equal((await banco.comuniDellaHome("salva_skill", BACKUP)).errore, undefined);
  const rifiutata = await banco.comuniDellaHome("salva_skill", {
    ...BACKUP,
    nome: "entra-nel-nas",
    contenuto: "Entra con password: Fritz!2024 e copia.",
  });
  assert.equal(rifiutata.errore, true);
  assert.deepEqual(
    banco.skill.elenco().map((voce) => voce.nome),
    ["backup-foto"],
  );

  const nodo = await avviaNodoAccettato(t, banco);
  const fileSulNodo = join(nodo.cartellaSkill, "skills", "backup-foto", "SKILL.md");
  await finche(() => existsSync(fileSulNodo), "la skill arriva al nodo appena accolto");
  assert.equal(readFileSync(fileSulNodo, "utf8"), readFileSync(join(banco.skill.cartella, "skills", "backup-foto", "SKILL.md"), "utf8"));
});
