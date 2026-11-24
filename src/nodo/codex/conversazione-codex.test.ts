import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { EventoConversazione } from "../../protocollo/eventi.ts";
import { ConversazioneCodex, effortPerCodex, modelliDiCodex, modelloPerCodex, motoreConfigurato, nellaCartella, nelleCartelle, politicaDi, scambiDiCodex, skillDiCodex } from "./conversazione-codex.ts";
import { comandoLeggibile } from "./traduzione.ts";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const FINTO = [process.execPath, join(import.meta.dirname, "..", "..", "prove", "app-server-finto.ts")];

async function finche(condizione: () => boolean, che: string): Promise<void> {
  for (const fine = Date.now() + 10_000; Date.now() < fine; ) {
    if (condizione()) return;
    await new Promise((fatto) => setTimeout(fatto, 20));
  }
  throw new Error(`non è successo in tempo: ${che}`);
}

function apri(
  t: { after(fn: () => unknown): void },
  opzioni: {
    idSessione?: string;
    permessi?: "chiedi" | "modifiche-libere";
    strumentoLibero?: boolean;
    conFotografie?: boolean;
    strumentiNostri?: () => Record<string, ReturnType<typeof createSdkMcpServer>>;
  } = {},
) {
  const cartella = mkdtempSync(join(tmpdir(), "shinka-codex-"));
  // Con una cartella per le versioni il registro fotografa i file: così vede anche ciò che cambiano i comandi.
  const cartellaModifiche = opzioni.conFotografie === true ? mkdtempSync(join(tmpdir(), "shinka-codex-modifiche-")) : undefined;
  const eventi: EventoConversazione[] = [];
  const sessioni: string[] = [];
  const conversazione = new ConversazioneCodex(
    {
      cartella,
      istruzioni: "claude-code",
      istruzioniAggiunte: "Tieni aggiornato STATO.md.",
      strumenti: "claude-code",
      strumentiSenzaRichiesta: opzioni.strumentoLibero === true ? ["mcp__shinka__segreto"] : [],
      strumentiNostri: opzioni.strumentiNostri ?? (() => ({
        shinka: createSdkMcpServer({
          name: "shinka",
          version: "1.0.0",
          tools: [tool("segreto", "Dice il segreto.", { per: z.string() }, async ({ per }) => ({ content: [{ type: "text", text: `GIRASOLE per ${per}` }] }))],
        }),
      })),
      impostazioni: { permessi: opzioni.permessi ?? "modifiche-libere", stile: { id: "conciso", nome: "Conciso", istruzioni: "Breve." } },
      ...(opzioni.idSessione === undefined ? {} : { idSessione: opzioni.idSessione }),
      ...(cartellaModifiche === undefined ? {} : { cartellaModifiche }),
      alEvento: (evento) => eventi.push(evento),
      alIdSessione: (id) => sessioni.push(id),
    },
    { comando: FINTO },
  );
  t.after(async () => {
    conversazione.chiudi();
    await rm(cartella, { recursive: true, force: true });
    if (cartellaModifiche !== undefined) await rm(cartellaModifiche, { recursive: true, force: true });
  });
  return { conversazione, eventi, sessioni, cartella };
}

test("un messaggio diventa un turno di Codex: testo a frammenti, ragionamento, token, limiti e modelli", async (t) => {
  const { conversazione, eventi, sessioni } = apri(t);
  conversazione.annota("[Shinka] Una nota per il prossimo messaggio.");
  conversazione.invia("Ciao");
  await finche(() => eventi.some((evento) => evento.tipo === "turno-concluso"), "il turno finisce");
  await finche(() => eventi.some((evento) => evento.tipo === "stato" && evento.stato.modelli !== undefined), "arrivano i modelli");
  assert.deepEqual(sessioni, ["thread-1"]);
  const tipi = eventi.map((evento) => evento.tipo).filter((tipo) => tipo !== "stato");
  assert.deepEqual(tipi, ["messaggio-proprietario", "turno-iniziato", "ragionamento", "testo-iniziato", "testo-frammento", "testo-frammento", "testo-concluso", "turno-concluso"]);
  assert.deepEqual(eventi.find((evento) => evento.tipo === "ragionamento"), { tipo: "ragionamento", idRagionamento: "r1", testo: "Penso a come rispondere." });
  assert.deepEqual(eventi.find((evento) => evento.tipo === "turno-concluso"), { tipo: "turno-concluso", riuscito: true, durataMs: 1234, token: { ingresso: 1000, uscita: 100 } });
  const stati = eventi.flatMap((evento) => (evento.tipo === "stato" ? [evento.stato] : []));
  assert.deepEqual(stati.find((stato) => stato.contesto !== undefined)?.contesto, { usati: 1100, massimo: 200000, percento: 1 });
  assert.deepEqual(stati.find((stato) => stato.limiti !== undefined)?.limiti, {
    cinqueOre: { percento: 12, azzeraIl: new Date(1795000000 * 1000).toISOString() },
    setteGiorni: { percento: 40, azzeraIl: new Date(1795500000 * 1000).toISOString() },
  });
  // Gli effort che Shinka non conosce restano fuori.
  assert.deepEqual(stati.find((stato) => stato.modelli !== undefined)?.modelli, [{ valore: "gpt-5.5", nome: "GPT-5.5", descrizione: "Il più capace", impegni: ["low", "high"] }]);
});

test("un comando che chiede il permesso passa dal proprietario, e il no arriva a Codex", async (t) => {
  const { conversazione, eventi } = apri(t, { permessi: "chiedi" });
  conversazione.invia("Lancia un comando");
  await finche(() => eventi.some((evento) => evento.tipo === "permesso-richiesto"), "arriva la richiesta");
  const richiesta = eventi.find((evento) => evento.tipo === "permesso-richiesto");
  assert.deepEqual(richiesta, { tipo: "permesso-richiesto", idPermesso: "c1", idAzione: "c1", strumento: "Bash", ingresso: { command: "ls -la", cwd: "/progetto" }, motivo: "Serve elencare i file" });
  assert.equal(conversazione.decidiPermesso("c1", "negato"), true);
  assert.equal(conversazione.decidiPermesso("c1", "negato"), false);
  await finche(() => eventi.some((evento) => evento.tipo === "turno-concluso"), "il turno finisce");
  assert.deepEqual(eventi.find((evento) => evento.tipo === "azione-conclusa"), { tipo: "azione-conclusa", idAzione: "c1", esito: "Il comando non è partito.", errore: true });

  // Con un sì il comando parte.
  conversazione.invia("Ancora un comando");
  await finche(() => eventi.filter((evento) => evento.tipo === "permesso-richiesto").length === 2, "seconda richiesta");
  conversazione.decidiPermesso("c1", "approvato");
  await finche(() => eventi.filter((evento) => evento.tipo === "turno-concluso").length === 2, "il turno finisce");
  assert.deepEqual(eventi.filter((evento) => evento.tipo === "azione-conclusa").at(-1), { tipo: "azione-conclusa", idAzione: "c1", esito: "file.txt\n", errore: false });
});

test("una conversazione che non si riprende ricomincia, e lo dice", async (t) => {
  const { conversazione, eventi, sessioni } = apri(t, { idSessione: "sparito" });
  conversazione.invia("Ciao");
  await finche(() => eventi.some((evento) => evento.tipo === "turno-concluso"), "il turno finisce");
  assert.deepEqual(sessioni, ["", "thread-1"]);
  assert.match(JSON.stringify(eventi.find((evento) => evento.tipo === "errore")), /non si può riprendere/);
});

test("se gli strumenti non si collegano Codex non parte, lo dice, e il messaggio dopo riprova con strumenti nuovi", async (t) => {
  // La prima volta arriva un server già collegato ad altri, come quando lo teneva il motore di prima.
  const crea = () =>
    createSdkMcpServer({ name: "shinka", version: "1.0.0", tools: [tool("segreto", "Dice il segreto.", { per: z.string() }, async () => ({ content: [{ type: "text", text: "GIRASOLE" }] }))] });
  const giaCollegato = crea();
  const [, lato] = (await import("@modelcontextprotocol/sdk/inMemory.js")).InMemoryTransport.createLinkedPair();
  await giaCollegato.instance.connect(lato);
  let volte = 0;
  const { conversazione, eventi } = apri(t, {
    strumentiNostri: () => {
      volte += 1;
      return { shinka: volte === 1 ? giaCollegato : crea() };
    },
  });
  conversazione.invia("Ciao");
  await finche(() => eventi.some((evento) => evento.tipo === "turno-concluso"), "il primo turno finisce");
  assert.match(JSON.stringify(eventi.find((evento) => evento.tipo === "errore")), /Codex non è partito: Already connected/);
  assert.equal(eventi.find((evento) => evento.tipo === "turno-concluso")?.errore, "Codex non è partito.");
  conversazione.invia("Ancora");
  await finche(() => eventi.filter((evento) => evento.tipo === "turno-concluso").length === 2, "il secondo turno finisce");
  assert.equal(volte, 2);
  assert.deepEqual(eventi.filter((evento) => evento.tipo === "turno-concluso").at(-1), { tipo: "turno-concluso", riuscito: true, durataMs: 1234, token: { ingresso: 1000, uscita: 100 } });
});

test("i quattro modi dei permessi diventano politiche di approvazione di Codex, senza sandbox; il motore si sceglie in un punto", () => {
  assert.deepEqual(
    (["chiedi", "modifiche-libere", "automatico", "senza-permessi"] as const).map((modo) => [modo, politicaDi(modo).approvalPolicy, politicaDi(modo).sandbox]),
    [
      ["chiedi", "untrusted", "danger-full-access"],
      ["modifiche-libere", "untrusted", "danger-full-access"],
      ["automatico", "on-request", "danger-full-access"],
      ["senza-permessi", "never", "danger-full-access"],
    ],
  );
  assert.equal(nellaCartella(["src/a.ts", "/progetto/b.ts"], "/progetto"), true);
  assert.equal(nellaCartella(["../fuori.ts"], "/progetto"), false);
  assert.equal(nellaCartella(["/etc/passwd"], "/progetto"), false);
  assert.equal(nellaCartella([], "/progetto"), false);
  // Le cartelle in più del progetto valgono come la sua.
  assert.equal(nelleCartelle(["/srv/dati/a.txt", "src/b.ts"], "/progetto", ["/srv/dati"]), true);
  assert.equal(nelleCartelle(["/srv/altro/a.txt"], "/progetto", ["/srv/dati"]), false);
  assert.equal(nelleCartelle(["/srv/dati"], "/progetto", ["/srv/dati"]), false);
  assert.equal(comandoLeggibile("/bin/bash -lc ls"), "ls");
  assert.equal(comandoLeggibile("/bin/bash -lc 'touch b.txt'"), "touch b.txt");
  assert.equal(comandoLeggibile(`/bin/bash -lc 'echo '\\''ciao'\\'''`), "echo 'ciao'");
  assert.equal(comandoLeggibile("npm test"), "npm test");
  assert.equal(modelloPerCodex("sonnet"), undefined);
  assert.equal(modelloPerCodex("claude-opus-5-5"), undefined);
  assert.equal(modelloPerCodex("gpt-6.2-sol"), "gpt-6.2-sol");
  assert.equal(effortPerCodex("max"), "xhigh");
  assert.equal(effortPerCodex("low"), "low");
  assert.equal(motoreConfigurato({}), "claude");
  assert.equal(motoreConfigurato({ SHINKA_MOTORE: " Codex " }), "codex");
  assert.equal(motoreConfigurato({ SHINKA_MOTORE: "altro" }), "claude");
});

test("uno strumento di Shinka lo esegue Shinka, dopo il consenso se lo chiede; libero, senza", async (t) => {
  const { conversazione, eventi } = apri(t, { permessi: "chiedi" });
  conversazione.invia("Usa lo strumento");
  await finche(() => eventi.some((evento) => evento.tipo === "permesso-richiesto"), "il consenso è chiesto");
  assert.deepEqual(eventi.find((evento) => evento.tipo === "permesso-richiesto"), { tipo: "permesso-richiesto", idPermesso: "s1", idAzione: "s1", strumento: "mcp__shinka__segreto", ingresso: { per: "prova" } });
  conversazione.decidiPermesso("s1", "approvato");
  await finche(() => eventi.some((evento) => evento.tipo === "turno-concluso"), "il turno finisce");
  assert.deepEqual(eventi.find((evento) => evento.tipo === "azione-conclusa"), { tipo: "azione-conclusa", idAzione: "s1", esito: "GIRASOLE per prova", errore: false });
  assert.equal(eventi.flatMap((evento) => (evento.tipo === "testo-concluso" ? [evento.testo] : [])).at(-1), "Lo strumento ha detto: GIRASOLE per prova");

  // Negato, lo strumento non parte.
  conversazione.invia("Ancora lo strumento");
  await finche(() => eventi.filter((evento) => evento.tipo === "permesso-richiesto").length === 2, "seconda richiesta");
  conversazione.decidiPermesso("s1", "negato");
  await finche(() => eventi.filter((evento) => evento.tipo === "turno-concluso").length === 2, "il turno finisce");
  assert.equal(eventi.flatMap((evento) => (evento.tipo === "testo-concluso" ? [evento.testo] : [])).at(-1), "Lo strumento ha detto: Il proprietario ha negato questa azione.");
});

test("uno strumento libero parte senza chiedere", async (t) => {
  const { conversazione, eventi } = apri(t, { permessi: "chiedi", strumentoLibero: true });
  conversazione.invia("Usa lo strumento");
  await finche(() => eventi.some((evento) => evento.tipo === "turno-concluso"), "il turno finisce");
  assert.equal(eventi.some((evento) => evento.tipo === "permesso-richiesto"), false);
  assert.equal(eventi.flatMap((evento) => (evento.tipo === "testo-concluso" ? [evento.testo] : [])).at(-1), "Lo strumento ha detto: GIRASOLE per prova");
});

test("le domande di Codex compaiono nella scheda di Shinka, e la risposta torna a Codex; anche scritta in chat", async (t) => {
  const { conversazione, eventi } = apri(t);
  conversazione.invia("Fammi una domanda");
  await finche(() => eventi.some((evento) => evento.tipo === "domande-poste"), "arrivano le domande");
  assert.deepEqual(eventi.find((evento) => evento.tipo === "domande-poste"), {
    tipo: "domande-poste",
    idDomande: "d1",
    domande: [{ domanda: "Che colore vuoi?", intestazione: "Colore", opzioni: [{ etichetta: "Blu", descrizione: "Il solito" }, { etichetta: "Rosso" }], piuScelte: false }],
  });
  assert.equal(conversazione.rispondiDomande("d1", { tipo: "risposte", risposte: ["Blu"] }), true);
  await finche(() => eventi.some((evento) => evento.tipo === "turno-concluso"), "il turno finisce");
  assert.equal(eventi.flatMap((evento) => (evento.tipo === "testo-concluso" ? [evento.testo] : [])).at(-1), 'Hai risposto: {"colore":{"answers":["Blu"]}}');

  conversazione.invia("Un'altra domanda");
  await finche(() => eventi.filter((evento) => evento.tipo === "domande-poste").length === 2, "seconde domande");
  conversazione.invia("Verde, grazie");
  await finche(() => eventi.filter((evento) => evento.tipo === "turno-concluso").length === 2, "il turno finisce");
  assert.equal(eventi.flatMap((evento) => (evento.tipo === "testo-concluso" ? [evento.testo] : [])).at(-1), 'Hai risposto: {"colore":{"answers":["Verde, grazie"]}}');
});

test("la storia di un thread: i messaggi del proprietario e le risposte, senza le azioni", () => {
  const turni = [
    {
      items: [
        { type: "userMessage", content: [{ type: "text", text: "Ciao" }, { type: "localImage", path: "/x.png" }] },
        { type: "commandExecution", command: "ls" },
        { type: "agentMessage", text: "Ciao a te." },
      ],
    },
  ];
  assert.deepEqual(scambiDiCodex(turni), [
    { chi: "proprietario", testo: "Ciao" },
    { chi: "motore", testo: "Ciao a te." },
  ]);
  assert.deepEqual(scambiDiCodex(undefined), []);
  assert.deepEqual(modelliDiCodex({ data: [{ model: "gpt-5.5", displayName: "GPT-5.5", hidden: false, supportedReasoningEfforts: [{ reasoningEffort: "high" }, { reasoningEffort: "none" }] }, { model: "segreto", hidden: true }] }), [
    { valore: "gpt-5.5", nome: "GPT-5.5", descrizione: "", impegni: ["high"] },
  ]);
});

const concluso = (eventi: EventoConversazione[], quanti: number) => () => eventi.filter((evento) => evento.tipo === "turno-concluso").length >= quanti;
const idDelMessaggio = (eventi: EventoConversazione[], posizione: number): string => {
  const messaggio = eventi.filter((evento) => evento.tipo === "messaggio-proprietario")[posizione];
  assert.ok(messaggio?.tipo === "messaggio-proprietario");
  return messaggio.id;
};

test("le modifiche di un turno di Codex: dal diff del turno la versione di prima, da rivedere e da annullare", async (t) => {
  const { conversazione, eventi, cartella } = apri(t);
  writeFileSync(join(cartella, "a.txt"), "uno\ndue\ntre\n");
  conversazione.invia("Fai una modifica");
  await finche(() => eventi.some((evento) => evento.tipo === "modifiche"), "arrivano le modifiche del turno");
  const modifiche = eventi.find((evento) => evento.tipo === "modifiche");
  assert.ok(modifiche?.tipo === "modifiche");
  assert.equal(modifiche.idTurno, "turno-1");
  assert.deepEqual(modifiche.file, [
    { percorso: "a.txt", aggiunte: 1, tolte: 1, stato: "cambiato" },
    { percorso: "b.txt", aggiunte: 1, tolte: 0, stato: "nuovo" },
  ]);
  assert.deepEqual(await conversazione.versioniModificate("turno-1", "a.txt"), { prima: "uno\ndue\ntre\n", dopo: "uno\nDUE\ntre\n" });

  const esito = await conversazione.annullaModifiche("turno-1", ["a.txt"]);
  assert.deepEqual(esito, { annullati: ["a.txt"], nonAnnullati: [] });
  assert.equal(readFileSync(join(cartella, "a.txt"), "utf8"), "uno\ndue\ntre\n");
  assert.ok(existsSync(join(cartella, "b.txt")));
  assert.ok(eventi.some((evento) => evento.tipo === "modifiche-decise" && evento.esito === "annullate"));
});

test("ciò che cambia un comando di Codex entra tra le modifiche del turno, con la versione di prima, e si riporta", async (t) => {
  const { conversazione, eventi, cartella } = apri(t, { conFotografie: true });
  writeFileSync(join(cartella, "a.txt"), "uno\ndue\ntre\n");
  writeFileSync(join(cartella, "fermo.txt"), "fermo\n");
  // Nello stesso turno una modifica di Codex, che sta nel diff del turno, e un comando, che non ci sta.
  conversazione.invia("Fai una modifica e poi lancia lo script");
  await finche(() => eventi.some((evento) => evento.tipo === "modifiche"), "arrivano le modifiche del turno");
  const modifiche = eventi.find((evento) => evento.tipo === "modifiche");
  assert.ok(modifiche?.tipo === "modifiche");
  assert.equal(modifiche.idTurno, "turno-1");
  // a.txt l'hanno cambiato tutti e due: il diff di Codex non torna più, e com'era lo dice la fotografia.
  assert.deepEqual(modifiche.file, [
    { percorso: "b.txt", aggiunte: 1, tolte: 0, stato: "nuovo" },
    { percorso: "a.txt", aggiunte: 2, tolte: 2, stato: "cambiato" },
    { percorso: "da-script.txt", aggiunte: 1, tolte: 0, stato: "nuovo", daComando: true },
  ]);
  // La versione di prima è quella di quando il turno è cominciato, non quella ricostruita dal diff.
  assert.deepEqual(await conversazione.versioniModificate("turno-1", "a.txt"), { prima: "uno\ndue\ntre\n", dopo: "UNO\nDUE\ntre\n" });
  assert.ok(eventi.some((evento) => evento.tipo === "stato" && evento.stato.fileDeiComandi?.guardati === true));

  // Un turno con il solo comando: ciò che ha fatto si riporta com'era, come una modifica di Codex.
  writeFileSync(join(cartella, "a.txt"), "uno\n");
  rmSync(join(cartella, "da-script.txt"));
  conversazione.invia("Lancia lo script");
  await finche(() => eventi.filter((evento) => evento.tipo === "modifiche").length === 2, "le modifiche del secondo turno");
  const seconde = eventi.filter((evento) => evento.tipo === "modifiche")[1];
  assert.ok(seconde?.tipo === "modifiche");
  assert.equal(seconde.idTurno, "turno-2");
  assert.deepEqual(seconde.file, [
    { percorso: "a.txt", aggiunte: 1, tolte: 1, stato: "cambiato", daComando: true },
    { percorso: "da-script.txt", aggiunte: 1, tolte: 0, stato: "nuovo", daComando: true },
  ]);
  await finche(() => eventi.filter((evento) => evento.tipo === "turno-concluso").length === 2, "il secondo turno finisce");
  assert.deepEqual(await conversazione.annullaModifiche("turno-2"), { annullati: ["a.txt", "da-script.txt"], nonAnnullati: [] });
  assert.equal(readFileSync(join(cartella, "a.txt"), "utf8"), "uno\n");
  assert.equal(existsSync(join(cartella, "da-script.txt")), false);
});

test("il piano di Codex diventa la scheda delle cose da fare; /compact compatta la conversazione", async (t) => {
  const { conversazione, eventi } = apri(t);
  conversazione.invia("Fai un piano");
  await finche(concluso(eventi, 1), "il turno finisce");
  assert.deepEqual(eventi.find((evento) => evento.tipo === "azione-iniziata"), {
    tipo: "azione-iniziata",
    idAzione: "piano-turno-1",
    strumento: "TodoWrite",
    ingresso: {
      todos: [
        { content: "Leggere i file", activeForm: "Leggere i file", status: "completed" },
        { content: "Scrivere la prova", activeForm: "Scrivere la prova", status: "in_progress" },
        { content: "Provare", activeForm: "Provare", status: "pending" },
      ],
    },
  });
  conversazione.invia("/compact");
  await finche(concluso(eventi, 2), "la compattazione finisce");
  assert.ok(eventi.some((evento) => evento.tipo === "nota" && /compattata/.test(evento.testo)));
  const ultimo = eventi.filter((evento) => evento.tipo === "messaggio-proprietario").at(-1);
  assert.equal(ultimo?.tipo === "messaggio-proprietario" ? ultimo.testo : undefined, "/compact");
});

test("ripartire da un messaggio: Codex toglie quel turno e quelli dopo, e i file tornano com'erano", async (t) => {
  const { conversazione, eventi, cartella } = apri(t);
  writeFileSync(join(cartella, "a.txt"), "uno\ndue\ntre\n");
  conversazione.invia("Ciao");
  await finche(concluso(eventi, 1), "primo turno");
  conversazione.invia("Fai una modifica");
  await finche(() => eventi.some((evento) => evento.tipo === "modifiche"), "le modifiche del secondo turno");
  const secondo = idDelMessaggio(eventi, 1);

  assert.deepEqual(await conversazione.anteprimaRiavvolgimento(secondo), { file: ["a.txt", "b.txt"], aggiunte: 2, tolte: 1 });
  assert.deepEqual(await conversazione.anteprimaRiavvolgimento("inventato"), { motivo: "Questo messaggio non è nella storia di Codex: non si può ripartire da qui." });
  assert.equal(await conversazione.riprendiDa(secondo, { file: true }), undefined);
  assert.deepEqual(eventi.at(-1), { tipo: "riavvolto", idMessaggio: secondo, fileRiportati: ["a.txt", "b.txt"] });
  assert.equal(readFileSync(join(cartella, "a.txt"), "utf8"), "uno\ndue\ntre\n");
  assert.equal(existsSync(join(cartella, "b.txt")), false);
  // Nella storia di Codex resta solo il primo scambio.
  assert.deepEqual(await conversazione.storia(), [
    { chi: "proprietario", testo: "Ciao" },
    { chi: "motore", testo: "Ciao, fatto." },
  ]);
});

test("un ramo nasce da una copia del thread fino a prima del messaggio; dal primo, da capo", async (t) => {
  const { conversazione, eventi } = apri(t);
  conversazione.invia("Ciao");
  await finche(concluso(eventi, 1), "primo turno");
  conversazione.invia("Ancora");
  await finche(concluso(eventi, 2), "secondo turno");
  assert.deepEqual(await conversazione.biforca(idDelMessaggio(eventi, 0)), { riuscita: true });
  const ramo = await conversazione.biforca(idDelMessaggio(eventi, 1));
  assert.ok(ramo.riuscita && ramo.idSessione?.startsWith("ramo-"), JSON.stringify(ramo));
});

test("una domanda a parte risponde da una copia effimera, senza toccare la conversazione", async (t) => {
  const { conversazione, eventi } = apri(t);
  conversazione.invia("Ciao");
  await finche(concluso(eventi, 1), "primo turno");
  const prima = eventi.length;
  // Il testo della domanda a parte contiene "domanda": il Codex finto chiede allora al proprietario, e
  // in una domanda a parte nessuno risponde.
  assert.deepEqual(await conversazione.chiediAParte("Di che cosa parlavamo?"), { testo: "Hai risposto: {}" });
  // Nella conversazione non è arrivato nulla.
  assert.equal(eventi.length, prima);
});

test("un messaggio scritto mentre Codex lavora entra nel turno in corso, con il turno che Codex si aspetta", async (t) => {
  const { conversazione, eventi } = apri(t);
  conversazione.invia("Fai con calma, lento");
  // Il secondo parte subito, prima ancora che Codex abbia detto quale turno ha aperto.
  conversazione.invia("Anzi, usa il blu");
  await finche(() => eventi.some((evento) => evento.tipo === "turno-concluso"), "il turno finisce");
  assert.deepEqual(eventi.filter((evento) => evento.tipo === "errore"), []);
  assert.equal(eventi.filter((evento) => evento.tipo === "turno-iniziato").length, 1, "un turno solo");
  assert.equal(eventi.filter((evento) => evento.tipo === "messaggio-proprietario").length, 2);
  const detto = eventi.flatMap((evento) => (evento.tipo === "testo-concluso" ? [evento.testo] : []));
  assert.deepEqual(detto, ["Nel turno è entrato: Anzi, usa il blu"]);

  // A turno finito il messaggio successivo ne apre uno nuovo.
  conversazione.invia("Ciao");
  await finche(() => eventi.filter((evento) => evento.tipo === "turno-concluso").length === 2, "il secondo turno finisce");
  assert.equal(eventi.filter((evento) => evento.tipo === "turno-iniziato").length, 2);
});

test("i comandi del menu sono quelli di Codex: /compact e le sue skill accese, detti appena la conversazione si prepara", async (t) => {
  const { conversazione, eventi } = apri(t);
  conversazione.prepara();
  await finche(() => eventi.some((evento) => evento.tipo === "stato" && evento.stato.comandi !== undefined), "arrivano i comandi");
  const stato = eventi.flatMap((evento) => (evento.tipo === "stato" && evento.stato.comandi !== undefined ? [evento.stato] : []))[0];
  assert.deepEqual(stato?.comandi, [
    { nome: "compact", descrizione: "Riassume la conversazione fin qui, per liberare contesto" },
    { nome: "riassumi", descrizione: "Riassume un testo lungo in pochi punti.", argomenti: "[che cosa fare]" },
  ]);
  // Senza aver scritto nulla ci sono già anche i limiti del piano.
  assert.ok(stato?.limiti?.cinqueOre !== undefined);
  assert.equal(eventi.some((evento) => evento.tipo === "turno-iniziato"), false);
});

test("le skill che Codex elenca: solo quelle accese, una volta sola, con una descrizione breve", () => {
  const lunga = "parola ".repeat(60);
  const lette = skillDiCodex({
    data: [
      { skills: [{ name: "uno", description: lunga, path: "/a/SKILL.md", enabled: true }, { name: "spenta", description: "x", path: "/b", enabled: false }, { name: "con spazi", description: "x", path: "/c" }] },
      { skills: [{ name: "uno", description: "doppia", path: "/d" }, { name: "due", description: "lunga", interface: { shortDescription: "In breve" }, path: "/e" }, { name: "compact", description: "x", path: "/f" }] },
    ],
  });
  assert.deepEqual(lette.map((voce) => [voce.comando.nome, voce.percorso]), [["uno", "/a/SKILL.md"], ["due", "/e"]]);
  assert.equal(lette[0]?.comando.descrizione.length, 160);
  assert.equal(lette[1]?.comando.descrizione, "In breve");
  assert.deepEqual(skillDiCodex(undefined), []);
});

test("«/nome» chiama una skill di Codex con il suo nome e il suo percorso; ciò che non è una skill parte com'è scritto", async (t) => {
  const { conversazione, eventi } = apri(t);
  conversazione.invia("/riassumi il verbale di ieri");
  await finche(() => eventi.some((evento) => evento.tipo === "turno-concluso"), "il turno finisce");
  // Al proprietario resta ciò che ha scritto; a Codex arriva la skill.
  assert.equal(eventi.find((evento) => evento.tipo === "messaggio-proprietario")?.testo, "/riassumi il verbale di ieri");
  assert.deepEqual(eventi.flatMap((evento) => (evento.tipo === "testo-concluso" ? [evento.testo] : [])), ["Ho ricevuto: $riassumi il verbale di ieri [skill riassumi /skill/riassumi/SKILL.md]"]);

  conversazione.invia("/context");
  await finche(() => eventi.filter((evento) => evento.tipo === "turno-concluso").length === 2, "il secondo turno finisce");
  assert.deepEqual(eventi.flatMap((evento) => (evento.tipo === "testo-concluso" ? [evento.testo] : [])).at(-1), "Ciao, fatto.");
});
