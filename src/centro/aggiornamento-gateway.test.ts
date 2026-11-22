import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import type { StatoVault } from "../protocollo/vault.ts";
import type { AggiornamentoDelGateway, EsitoProposta, PropostaDiVersione } from "../protocollo/versione.ts";
import { GatewayAllaVersione } from "./aggiornamento-gateway.ts";
import type { PortaGateway } from "./gateway.ts";

const VERSIONE = "0123456789abcdef0123456789abcdef01234567";

/** Una versione finta di Shinka: il gateway carica il suo avvio, ciò che quello importa, e la sua pagina. */
async function versioneFinta(t: TestContext): Promise<string> {
  const cartella = await mkdtemp(join(tmpdir(), "shinka-gateway-versione-"));
  t.after(() => rm(cartella, { recursive: true, force: true }));
  const file: Record<string, string> = {
    "package.json": "{}",
    "package-lock.json": "{}",
    "versione.json": JSON.stringify({ versione: VERSIONE }),
    "src/gateway/avvio.ts": 'import { uno } from "../protocollo/vault.ts";\nconsole.log(uno);\n',
    "src/gateway/pagina/vault.js": "// la pagina\n",
    "src/protocollo/vault.ts": "export const uno = 1;\n",
    "src/centro/avvio.ts": "console.log('centro');\n",
  };
  for (const [percorso, testo] of Object.entries(file)) {
    await mkdir(join(cartella, percorso, ".."), { recursive: true });
    await writeFile(join(cartella, percorso), testo);
  }
  return cartella;
}

/** Un gateway finto: risponde alla proposta ciò che il test decide, e dice lo stato che il test gli mette. */
function gatewayFinto(risposta: EsitoProposta) {
  const proposte: PropostaDiVersione[] = [];
  const finto = {
    stato: { gateway: "attivo", condizione: "aperto", credenziali: [], pagina: "http://gateway.lan", versione: "prima", siAggiorna: true } as StatoVault,
    risposta,
    proposte,
    porta: undefined as unknown as PortaGateway,
    /** Ciò che il gateway dice dell'ultima versione proposta, e da quale versione gira. */
    diventa(versione: string, aggiornamento?: AggiornamentoDelGateway, condizione: "aperto" | "chiuso" = "aperto"): void {
      const { aggiornamento: _prima, ...resto } = finto.stato as StatoVault & { aggiornamento?: unknown };
      finto.stato = { ...resto, versione, condizione, ...(aggiornamento === undefined ? {} : { aggiornamento }) } as StatoVault;
    },
  };
  finto.porta = {
    stato: async () => finto.stato,
    proponiVersione: async (proposta: PropostaDiVersione) => {
      proposte.push(proposta);
      return finto.risposta;
    },
  } as unknown as PortaGateway;
  return finto;
}

async function finche(condizione: () => boolean, cosa: string, ms = 5000): Promise<void> {
  const scadenza = Date.now() + ms;
  while (!condizione()) {
    if (Date.now() > scadenza) throw new Error(`Dopo ${ms} ms non è successo: ${cosa}.`);
    await new Promise((fatto) => setTimeout(fatto, 5));
  }
}

function inFunzione(t: TestContext, installata: string, finto: ReturnType<typeof gatewayFinto>, codaMs = 60_000) {
  const riferito: string[] = [];
  const alla = new GatewayAllaVersione({ gateway: finto.porta, installata, riferisci: (testo) => riferito.push(testo), pausaMs: 5, codaMs });
  t.after(() => alla.chiudi());
  return { alla, riferito };
}

const DA_APPROVARE: EsitoProposta = { esito: "da-approvare", scadeIl: new Date(Date.now() + 60_000).toISOString(), cambiano: ["src/gateway/avvio.ts"] };

test("al gateway arriva solo la sua parte; se è già quella non c'è nulla da aspettare", async (t) => {
  const installata = await versioneFinta(t);
  const finto = gatewayFinto({ esito: "uguale" });
  const { alla, riferito } = inFunzione(t, installata, finto);
  const esito = await alla.proponi("  Cambia solo il centro.  ");
  assert.equal(esito.esito, "uguale");
  assert.equal(esito.errore, undefined);
  assert.match(esito.testo, /ha già il codice della versione 01234567/);
  assert.equal(finto.proposte[0]?.versione, VERSIONE);
  assert.equal(finto.proposte[0]?.riassunto, "Cambia solo il centro.");
  assert.deepEqual(
    finto.proposte[0]?.file.map((uno) => uno.percorso).sort(),
    ["package-lock.json", "package.json", "src/gateway/avvio.ts", "src/gateway/pagina/vault.js", "src/protocollo/vault.ts", "versione.json"],
  );
  await new Promise((fatto) => setTimeout(fatto, 30));
  assert.deepEqual(riferito, []);
});

test("quando il gateway chiede il sì al proprietario, il progetto Shinka viene a sapere com'è finita", async (t) => {
  const installata = await versioneFinta(t);
  const finto = gatewayFinto(DA_APPROVARE);
  const { alla, riferito } = inFunzione(t, installata, finto);

  // Il gateway riparte con la versione nuova, e il vault è chiuso.
  const chiesto = await alla.proponi("Il gateway impara una cosa nuova.");
  assert.equal(chiesto.esito, "chiesto");
  assert.match(chiesto.testo, /ha chiesto al proprietario il sì[\s\S]*tu non puoi darlo né sollecitarlo/);
  // Mentre aspetta, un'altra proposta non parte.
  const doppia = await alla.proponi("Di nuovo.");
  assert.equal(doppia.esito, "non-accolto");
  assert.equal(finto.proposte.length, 1);
  finto.diventa("prima", { stato: "in-attesa", versione: VERSIONE, scadeIl: DA_APPROVARE.scadeIl });
  await new Promise((fatto) => setTimeout(fatto, 30));
  finto.diventa("prima", { stato: "in-corso", versione: VERSIONE });
  await new Promise((fatto) => setTimeout(fatto, 30));
  assert.deepEqual(riferito, []);
  finto.diventa(VERSIONE, undefined, "chiuso");
  await finche(() => riferito.length === 1, "il centro riferisce che il gateway è passato alla versione nuova");
  assert.match(riferito[0] ?? "", /^\[Shinka\] Il gateway è passato alla versione 01234567\. Il vault è chiuso: lo riapre il proprietario/);

  // Un no, il silenzio, una versione che non parte: ognuno detto con le sue parole.
  for (const [stato, atteso] of [
    [{ stato: "negato", versione: VERSIONE }, /ha detto di no alla versione 01234567 del gateway/],
    [{ stato: "scaduto", versione: VERSIONE }, /è scaduta senza risposta[\s\S]*aggiorna_gateway/],
    [{ stato: "non-riuscito", versione: VERSIONE, motivo: "non ha risposto in tempo" }, /non è entrata in funzione \(non ha risposto in tempo\)/],
  ] as [AggiornamentoDelGateway, RegExp][]) {
    finto.diventa("prima");
    const quanti = riferito.length;
    assert.equal((await alla.proponi("Ancora.")).esito, "chiesto");
    finto.diventa("prima", stato);
    await finche(() => riferito.length === quanti + 1, `il centro riferisce: ${stato.stato}`);
    assert.match(riferito.at(-1) ?? "", atteso);
  }
});

test("un gateway che non accoglie la proposta lo dice, e se il gateway tace il centro smette di aspettare", async (t) => {
  const installata = await versioneFinta(t);
  const finto = gatewayFinto({ esito: "rifiutato", motivo: "Il gateway installato non sa ancora cambiare versione da dentro: questa volta lo deve aggiornare da fuori chi ha accesso al server." });
  const { alla, riferito } = inFunzione(t, installata, finto, -60_000);
  const rifiutato = await alla.proponi("Una cosa nuova.");
  assert.equal(rifiutato.esito, "non-accolto");
  assert.equal(rifiutato.errore, true);
  assert.match(rifiutato.testo, /non ha accolto la versione 01234567[\s\S]*dillo al proprietario/);

  finto.risposta = { ...DA_APPROVARE, scadeIl: new Date(Date.now() - 1000).toISOString() };
  finto.stato = { gateway: "irraggiungibile" } as StatoVault;
  assert.equal((await alla.proponi("Una cosa nuova.")).esito, "chiesto");
  await finche(() => riferito.length === 1, "il centro dice che non sa com'è finita");
  assert.match(riferito[0] ?? "", /Non si sa com'è finita l'installazione della versione 01234567 del gateway/);
});

test("la scheda dell'installazione dice del gateway solo se la sua parte cambia davvero", async (t) => {
  const installata = await versioneFinta(t);
  const nuova = await mkdtemp(join(tmpdir(), "shinka-gateway-nuova-"));
  t.after(() => rm(nuova, { recursive: true, force: true }));
  await cp(installata, nuova, { recursive: true });
  const finto = gatewayFinto({ esito: "uguale" });
  const { alla } = inFunzione(t, installata, finto);

  // Cambiano il centro e il nome della versione: per il gateway non cambia nulla.
  await writeFile(join(nuova, "src", "centro", "avvio.ts"), "console.log('centro nuovo');\n");
  await writeFile(join(nuova, "versione.json"), JSON.stringify({ versione: "f".repeat(40) }));
  assert.equal(await alla.avviso(nuova), undefined);

  // Cambia un file che il gateway importa.
  await writeFile(join(nuova, "src", "protocollo", "vault.ts"), "export const uno = 2;\n");
  assert.match((await alla.avviso(nuova)) ?? "", /Cambia anche il gateway: dopo l'installazione sarà lui a chiederti il sì[\s\S]*il vault si chiude/);
  // Un gateway che non sa aggiornarsi da dentro resta quello di prima.
  finto.stato = { ...finto.stato, siAggiorna: undefined } as unknown as StatoVault;
  assert.match((await alla.avviso(nuova)) ?? "", /non sa aggiornarsi da dentro: resta quello di prima/);
  // Senza gateway non c'è nulla da dire.
  finto.stato = { gateway: "non-configurato" } as StatoVault;
  assert.equal(await alla.avviso(nuova), undefined);
});
