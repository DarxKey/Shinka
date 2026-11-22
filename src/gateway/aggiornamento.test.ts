import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { leggiInstallazione, scriviInstallazione } from "../guardiano/guardiano.ts";
import { versioneDi, type FileDiVersione } from "../protocollo/versione.ts";
import { AggiornamentoDelGateway, cheCosaCambia } from "./aggiornamento.ts";
import { DomandeAlProprietario } from "./domande.ts";
import { Registro } from "./registro.ts";

const PRIMA = "1111111111111111111111111111111111111111";
const NUOVA = "2222222222222222222222222222222222222222";

const b64 = (testo: string): string => Buffer.from(testo).toString("base64");

/** Ciò che c'è nella cartella del gateway in funzione, e che un pacchetto uguale riporta tale e quale. */
const IN_FUNZIONE: Record<string, string> = {
  "package.json": "{}",
  "package-lock.json": "{\"lock\":1}",
  "src/gateway/avvio.ts": "console.log('prima');\n",
  "src/gateway/pagina/vault.js": "// la pagina di prima\n",
  "src/protocollo/vault.ts": "export const uno = 1;\n",
};

function pacchetto(versione: string, cambi: Record<string, string | undefined> = {}): FileDiVersione[] {
  const file = { ...IN_FUNZIONE, "versione.json": JSON.stringify({ versione }), ...cambi };
  return Object.entries(file).flatMap(([percorso, testo]) => (testo === undefined ? [] : [{ percorso, dati: b64(testo) }]));
}

/** Al posto di npm: un comando che lascia un segno nella cartella in cui gira. */
const DIPENDENZE_FINTE = { comando: `node -e "require('fs').mkdirSync('node_modules/scaricata',{recursive:true})"`, secondi: 30 };

async function gatewayInstallato(t: TestContext, colGuardiano = true) {
  const radice = await mkdtemp(join(tmpdir(), "shinka-gateway-versione-"));
  t.after(() => rm(radice, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const installata = join(radice, "shinka");
  for (const [percorso, testo] of Object.entries({ ...IN_FUNZIONE, "versione.json": JSON.stringify({ versione: PRIMA }) })) {
    await mkdir(join(installata, percorso, ".."), { recursive: true });
    await writeFile(join(installata, percorso), testo);
  }
  await mkdir(join(installata, "node_modules", "una-dipendenza"), { recursive: true });
  // Un test accanto al codice non fa parte di ciò che il gateway carica.
  await writeFile(join(installata, "src", "gateway", "avvio.test.ts"), "// un test\n");
  const fileInstallazione = join(radice, "dati", "installazione.json");
  const registro = await Registro.apri(join(radice, "dati", "registro.jsonl"));
  const domande = new DomandeAlProprietario();
  t.after(() => domande.ferma());
  let riavvii = 0;
  const apri = () =>
    AggiornamentoDelGateway.apri({
      installata,
      fileInstallazione,
      colGuardiano,
      domande,
      registro,
      riavvia: () => {
        riavvii += 1;
      },
      dipendenze: DIPENDENZE_FINTE,
      attesaEsitoMs: 50,
    });
  return { radice, installata, nuova: `${installata}-nuovo`, fileInstallazione, registro, domande, apri, aggiornamento: await apri(), riavvii: () => riavvii };
}

async function finche(condizione: () => boolean, cosa: string, ms = 10_000): Promise<void> {
  const scadenza = Date.now() + ms;
  while (!condizione()) {
    if (Date.now() > scadenza) throw new Error(`Dopo ${ms} ms non è successo: ${cosa}.`);
    await new Promise((fatto) => setTimeout(fatto, 10));
  }
}

test("se il codice del gateway è già quello, cambia solo il nome della versione e al proprietario non si chiede nulla", async (t) => {
  const g = await gatewayInstallato(t);
  assert.equal(g.aggiornamento.versione, PRIMA);
  assert.deepEqual(await g.aggiornamento.proponi({ versione: NUOVA, riassunto: "Cambia solo il centro.", file: pacchetto(NUOVA) }), { esito: "uguale" });
  assert.equal(g.domande.inVista().length, 0);
  assert.equal(g.aggiornamento.versione, NUOVA);
  assert.equal(await versioneDi(g.installata), NUOVA);
  assert.equal(g.aggiornamento.stato, undefined);
  assert.equal(existsSync(g.nuova), false);
  assert.equal(g.riavvii(), 0);
});

test("che cosa cambia lo guarda il gateway: file diversi, file nuovi, e file che non ci sarebbero più", async (t) => {
  const g = await gatewayInstallato(t);
  assert.deepEqual(await cheCosaCambia(g.installata, pacchetto(NUOVA)), []);
  assert.deepEqual(
    await cheCosaCambia(
      g.installata,
      pacchetto(NUOVA, { "src/gateway/avvio.ts": "console.log('nuovo');\n", "src/gateway/nuovo.ts": "export {};\n", "src/protocollo/vault.ts": undefined }),
    ),
    ["src/gateway/avvio.ts", "src/gateway/nuovo.ts", "src/protocollo/vault.ts (tolto)"],
  );
});

test("una versione che cambia il gateway aspetta il sì del proprietario: con un no resta tutto com'è", async (t) => {
  const g = await gatewayInstallato(t);
  const file = pacchetto(NUOVA, { "src/gateway/avvio.ts": "console.log('nuovo');\n" });
  const esito = await g.aggiornamento.proponi({ versione: NUOVA, riassunto: "Il gateway impara una cosa nuova.", file });
  assert.ok(esito.esito === "da-approvare");
  assert.deepEqual(esito.cambiano, ["src/gateway/avvio.ts"]);
  assert.deepEqual(g.aggiornamento.stato, { stato: "in-attesa", versione: NUOVA, scadeIl: esito.scadeIl });

  // La domanda dice che cosa cambia, con le parole del centro riportate come sue.
  const domanda = g.domande.inVista()[0];
  assert.ok(domanda);
  assert.equal(domanda.tipo, "versione");
  assert.match(domanda.titolo, /Installare la versione 22222222 del gateway\?/);
  assert.match(domanda.testo, /Ora è in funzione la 11111111\.\nCambiano un file:\nsrc\/gateway\/avvio\.ts/);
  assert.match(domanda.testo, /Il centro dice: «Il gateway impara una cosa nuova\.»/);
  assert.match(domanda.testo, /il vault si chiude/);

  // Finché il proprietario non decide, il centro non può proporne un'altra né dire di sì.
  const altra = await g.aggiornamento.proponi({ versione: NUOVA, riassunto: "", file });
  assert.match(altra.esito === "rifiutato" ? altra.motivo : "", /sta già aspettando il sì/);
  assert.equal(g.domande.decidi(domanda.id, "approvata", "centro"), false);

  assert.equal(g.domande.decidi(domanda.id, "negata", "pagina"), true);
  await finche(() => g.aggiornamento.stato?.stato === "negato", "il gateway annota il no");
  assert.equal(existsSync(g.nuova), false);
  assert.equal(leggiInstallazione(g.fileInstallazione), undefined);
  assert.equal(g.riavvii(), 0);
  assert.equal(await readFile(join(g.installata, "src", "gateway", "avvio.ts"), "utf8"), "console.log('prima');\n");
});

test("con il sì dato al gateway la versione viene preparata, annotata nel registro, e il gateway si riavvia", async (t) => {
  const g = await gatewayInstallato(t);
  const file = pacchetto(NUOVA, { "src/gateway/avvio.ts": "console.log('nuovo');\n", "package-lock.json": "{\"lock\":2}" });
  const esito = await g.aggiornamento.proponi({ versione: NUOVA, riassunto: "Il gateway impara una cosa nuova.", file });
  assert.ok(esito.esito === "da-approvare");
  assert.deepEqual(esito.cambiano, ["package-lock.json", "src/gateway/avvio.ts"]);
  assert.equal(g.domande.decidi(g.domande.inVista()[0]?.id ?? "", "approvata", "pagina"), true);
  await finche(() => g.riavvii() === 1, "il gateway chiede al guardiano di riavviarlo");

  // Accanto alla versione in funzione, che resta com'è finché il guardiano non le scambia.
  assert.equal(await readFile(join(g.nuova, "src", "gateway", "avvio.ts"), "utf8"), "console.log('nuovo');\n");
  assert.equal(await readFile(join(g.installata, "src", "gateway", "avvio.ts"), "utf8"), "console.log('prima');\n");
  assert.equal(await versioneDi(g.nuova), NUOVA);
  // Le dipendenze sono cambiate: scaricate per la versione nuova, non copiate.
  assert.equal(existsSync(join(g.nuova, "node_modules", "scaricata")), true);
  const scritta = leggiInstallazione(g.fileInstallazione);
  assert.equal(scritta?.fase, "da-installare");
  assert.equal(scritta?.versione, NUOVA);
  assert.equal(scritta?.nuova, g.nuova);
  assert.deepEqual(g.aggiornamento.stato, { stato: "in-corso", versione: NUOVA });

  const voce = g.registro.ultime(1)[0];
  assert.equal(voce?.esito, "eseguito");
  assert.equal(voce?.host, "gateway");
  assert.match(voce?.comando ?? "", /Installazione della versione 22222222 del gateway, con il sì del proprietario dato al gateway/);
});

test("un gateway senza guardiano, o un pacchetto che esce dalla sua parte, non chiedono nemmeno", async (t) => {
  const senza = await gatewayInstallato(t, false);
  const cambiato = pacchetto(NUOVA, { "src/gateway/avvio.ts": "console.log('nuovo');\n" });
  const rifiutato = await senza.aggiornamento.proponi({ versione: NUOVA, riassunto: "", file: cambiato });
  assert.match(rifiutato.esito === "rifiutato" ? rifiutato.motivo : "", /non è tenuto acceso dal suo guardiano/);
  // Se non cambia nulla, però, anche senza guardiano non c'è nulla da rifiutare.
  assert.deepEqual(await senza.aggiornamento.proponi({ versione: NUOVA, riassunto: "", file: pacchetto(NUOVA) }), { esito: "uguale" });

  const g = await gatewayInstallato(t);
  for (const percorso of ["src/centro/avvio.ts", "../fuori.ts", "node_modules/x/index.js", "src/gateway/../../fuori.ts", ".env"]) {
    const esito = await g.aggiornamento.proponi({ versione: NUOVA, riassunto: "", file: pacchetto(NUOVA, { [percorso]: "x" }) });
    assert.match(esito.esito === "rifiutato" ? esito.motivo : "", /non può stare/, percorso);
  }
  assert.equal((await g.aggiornamento.proponi({ versione: "main", riassunto: "", file: cambiato })).esito, "rifiutato");
  assert.equal((await g.aggiornamento.proponi({ versione: NUOVA, riassunto: "", file: "non è un elenco" })).esito, "rifiutato");
  assert.equal(senza.domande.inVista().length + g.domande.inVista().length, 0);
});

test("se la versione nuova non si riesce a preparare, il gateway resta com'è e dice perché", async (t) => {
  const g = await gatewayInstallato(t);
  // Manca l'elenco delle dipendenze: la preparazione si ferma.
  const file = pacchetto(NUOVA, { "src/gateway/avvio.ts": "console.log('nuovo');\n", "package-lock.json": undefined });
  assert.equal((await g.aggiornamento.proponi({ versione: NUOVA, riassunto: "", file })).esito, "da-approvare");
  assert.equal(g.domande.decidi(g.domande.inVista()[0]?.id ?? "", "approvata", "pagina"), true);
  await finche(() => g.aggiornamento.stato?.stato === "non-riuscito", "il gateway dice che non è riuscita");
  assert.equal(g.riavvii(), 0);
  assert.equal(existsSync(g.nuova), false);
  assert.equal(g.registro.ultime(1)[0]?.esito, "fallito");
  // Si può riproporre, anche con lo stesso nome di versione.
  const dinuovo = await g.aggiornamento.proponi({ versione: NUOVA, riassunto: "", file: pacchetto(NUOVA, { "src/gateway/avvio.ts": "console.log('nuovo');\n" }) });
  assert.equal(dinuovo.esito, "da-approvare");
});

test("dopo il riavvio il gateway sa com'è finita, e una versione tornata indietro resta da dire", async (t) => {
  const g = await gatewayInstallato(t);
  const base = { versione: NUOVA, riassunto: "Una prova.", quando: new Date().toISOString(), nuova: g.nuova };

  // Il guardiano ha rimesso la versione di prima.
  await scriviInstallazione(g.fileInstallazione, { ...base, fase: "tornata-indietro", motivo: "non ha risposto in tempo" });
  const tornato = await g.apri();
  assert.deepEqual(tornato.stato, { stato: "non-riuscito", versione: NUOVA, motivo: "non ha risposto in tempo" });
  await tornato.riferisci();
  assert.equal(leggiInstallazione(g.fileInstallazione)?.riferita, true);
  // Una proposta nuova prende il posto di ciò che restava da dire.
  assert.deepEqual(await tornato.proponi({ versione: NUOVA, riassunto: "", file: pacchetto(NUOVA) }), { esito: "uguale" });
  assert.equal(tornato.stato, undefined);

  // Il guardiano ha confermato la versione nuova: non resta nulla da dire al centro.
  await scriviInstallazione(g.fileInstallazione, { ...base, fase: "confermata" });
  const confermato = await g.apri();
  assert.equal(confermato.stato, undefined);
  await confermato.riferisci();
  assert.equal(leggiInstallazione(g.fileInstallazione)?.riferita, true);
});
