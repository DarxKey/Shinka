import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import {
  CODICE_RIAVVIO,
  FILE_COLLEGATO,
  Guardiano,
  leggiInstallazione,
  nodoCollegato,
  scambia,
  scriviInstallazione,
  sfoltisci,
  tornaIndietro,
  type Installazione,
} from "./guardiano.ts";

const togli = (cartella: string): Promise<void> => rm(cartella, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });

function cartellaDiProva(t: TestContext): string {
  const cartella = mkdtempSync(join(tmpdir(), "shinka-guardiano-"));
  t.after(() => togli(cartella));
  return cartella;
}

/** Una versione finta del centro: un programma che risponde, che si spegne subito, oppure che tace. */
function versione(cartella: string, nome: string, come: "risponde" | "rotta" | "muta" = "risponde"): string {
  mkdirSync(cartella, { recursive: true });
  const programma =
    come === "rotta"
      ? `process.exit(3);`
      : come === "muta"
        ? `setInterval(() => {}, 1000);`
        : `import { createServer } from "node:http";
createServer((richiesta, risposta) => {
  if (richiesta.url === "/riavvia") {
    risposta.end("ok");
    setTimeout(() => process.exit(${CODICE_RIAVVIO}), 50);
    return;
  }
  if (richiesta.url === "/muori") {
    risposta.end("ok");
    setTimeout(() => process.exit(9), 50);
    return;
  }
  risposta.end(JSON.stringify({ versione: ${JSON.stringify(nome)}, guardiano: process.env.SHINKA_GUARDIANO }));
}).listen(Number(process.env.PORTA_DI_PROVA), "127.0.0.1");
process.on("SIGTERM", () => process.exit(0));`;
  writeFileSync(join(cartella, "centro.mjs"), programma);
  return cartella;
}

function portaLibera(): Promise<number> {
  return new Promise((trovata, fallita) => {
    const server = createServer();
    server.on("error", fallita);
    server.listen(0, "127.0.0.1", () => {
      const indirizzo = server.address();
      const porta = typeof indirizzo === "object" && indirizzo !== null ? indirizzo.port : 0;
      server.close(() => trovata(porta));
    });
  });
}

async function finche<T>(che: () => Promise<T | undefined> | T | undefined, ms = 15_000): Promise<T> {
  const entro = Date.now() + ms;
  for (;;) {
    const valore = await che();
    if (valore !== undefined) return valore;
    if (Date.now() > entro) throw new Error("L'attesa è finita senza esito.");
    await new Promise((fatto) => setTimeout(fatto, 50));
  }
}

async function chiedi(porta: number, percorso: string): Promise<{ versione?: string; guardiano?: string } | undefined> {
  try {
    const risposta = await fetch(`http://127.0.0.1:${porta}${percorso}`, { signal: AbortSignal.timeout(1000) });
    const testo = await risposta.text();
    return testo.startsWith("{") ? (JSON.parse(testo) as { versione?: string }) : {};
  } catch {
    return undefined;
  }
}

async function allestisci(t: TestContext, attesaMs = 6_000) {
  const radice = mkdtempSync(join(tmpdir(), "shinka-guardiano-"));
  const installata = versione(join(radice, "shinka"), "uno");
  const fileInstallazione = join(radice, "installazione.json");
  const porta = await portaLibera();
  process.env.PORTA_DI_PROVA = String(porta);
  const righe: string[] = [];
  const guardiano = new Guardiano({
    installata,
    fileInstallazione,
    comando: { programma: process.execPath, argomenti: ["centro.mjs"] },
    indirizzoDiProva: `http://127.0.0.1:${porta}/api/stato`,
    attesaMs,
    pausaMs: 100,
    scrivi: (riga) => righe.push(riga),
  });
  const finito = guardiano.avvia();
  // Prima si ferma il guardiano, poi si toglie la cartella: un processo acceso la tiene occupata.
  t.after(async () => {
    guardiano.spegni();
    await finito.catch(() => {});
    await togli(radice);
  });
  await finche(async () => ((await chiedi(porta, "/api/stato"))?.versione === "uno" ? true : undefined));
  const approva = async (nuova: string, nome: string): Promise<void> => {
    await scriviInstallazione(fileInstallazione, {
      fase: "da-installare",
      versione: nome,
      riassunto: "Una prova.",
      quando: new Date().toISOString(),
      nuova,
    });
    await chiedi(porta, "/riavvia");
  };
  const fase = (voluta: Installazione["fase"]): Promise<Installazione> =>
    finche(() => {
      const letta = leggiInstallazione(fileInstallazione);
      return letta?.fase === voluta ? letta : undefined;
    });
  return { radice, installata, fileInstallazione, porta, guardiano, finito, approva, fase, righe };
}

test("scambia mette la versione nuova al posto di quella in funzione, e tornaIndietro la toglie", async (t) => {
  const radice = cartellaDiProva(t);
  const installata = versione(join(radice, "shinka"), "uno");
  const nuova = versione(join(radice, "shinka-nuovo"), "due");
  writeFileSync(join(installata, "segno.txt"), "uno");
  writeFileSync(join(nuova, "segno.txt"), "due");

  const precedente = await scambia(installata, nuova, Date.parse("2026-11-12T15:30:00Z"));
  assert.equal(precedente, `${installata}-prima-20261112-153000`);
  assert.equal(readFileSync(join(installata, "segno.txt"), "utf8"), "due");
  assert.equal(readFileSync(join(precedente, "segno.txt"), "utf8"), "uno");
  assert.ok(!existsSync(nuova));

  const scartata = await tornaIndietro(installata, precedente, Date.parse("2026-11-12T15:31:00Z"));
  assert.equal(readFileSync(join(installata, "segno.txt"), "utf8"), "uno");
  assert.equal(readFileSync(join(scartata, "segno.txt"), "utf8"), "due");
  assert.ok(!existsSync(precedente));
});

test("scambia non tocca nulla se la versione nuova non c'è", async (t) => {
  const radice = cartellaDiProva(t);
  const installata = versione(join(radice, "shinka"), "uno");
  await assert.rejects(scambia(installata, join(radice, "manca")), /non c'è più/);
  assert.ok(existsSync(join(installata, "centro.mjs")));
  assert.deepEqual(readdirSync(radice), ["shinka"]);
});

test("sfoltisci tiene le ultime versioni di prima e non tocca le cartelle che non sono sue", async (t) => {
  const radice = cartellaDiProva(t);
  const installata = join(radice, "shinka");
  for (const nome of [
    "shinka",
    "shinka-prima-20261101-100000",
    "shinka-prima-20261102-100000",
    "shinka-prima-20261103-100000",
    "shinka-prima-20261104-100000",
    "shinka-scartata-20261101-100000",
    "shinka-scartata-20261105-100000",
    "shinka-vecchio-8",
    "shinka-prima-di-natale",
    "dati",
  ]) {
    mkdirSync(join(radice, nome));
  }
  const tolte = await sfoltisci(installata, 3);
  assert.deepEqual(tolte.sort(), ["shinka-prima-20261101-100000", "shinka-scartata-20261101-100000"]);
  assert.deepEqual(readdirSync(radice).sort(), [
    "dati",
    "shinka",
    "shinka-prima-20261102-100000",
    "shinka-prima-20261103-100000",
    "shinka-prima-20261104-100000",
    "shinka-prima-di-natale",
    "shinka-scartata-20261105-100000",
    "shinka-vecchio-8",
  ]);
});

test("una versione approvata viene messa in funzione, e resta quando risponde", async (t) => {
  const lab = await allestisci(t);
  assert.equal((await chiedi(lab.porta, "/api/stato"))?.guardiano, "1");
  await lab.approva(versione(join(lab.radice, "shinka-nuovo"), "due"), "due");

  const confermata = await lab.fase("confermata");
  assert.equal((await chiedi(lab.porta, "/api/stato"))?.versione, "due");
  assert.equal(confermata.nuova, undefined);
  assert.equal(confermata.tentativi, undefined);
  assert.ok(confermata.precedente !== undefined && existsSync(join(confermata.precedente, "centro.mjs")));
  assert.ok(lab.righe.some((riga) => riga.includes("risponde")));
});

test("una versione che si spegne subito viene tolta, e torna quella di prima", async (t) => {
  const lab = await allestisci(t);
  await lab.approva(versione(join(lab.radice, "shinka-nuovo"), "rotta", "rotta"), "rotta");

  const tornata = await lab.fase("tornata-indietro");
  assert.match(tornata.motivo ?? "", /si è spenta da sola, con il codice 3/);
  assert.equal(tornata.precedente, undefined);
  await finche(async () => ((await chiedi(lab.porta, "/api/stato"))?.versione === "uno" ? true : undefined));
  assert.ok(readdirSync(lab.radice).some((nome) => nome.startsWith("shinka-scartata-")));
  assert.ok(!readdirSync(lab.radice).some((nome) => nome.startsWith("shinka-prima-")));
});

test("una versione che non risponde in tempo viene fermata, e torna quella di prima", async (t) => {
  const lab = await allestisci(t, 1_200);
  await lab.approva(versione(join(lab.radice, "shinka-nuovo"), "muta", "muta"), "muta");

  const tornata = await lab.fase("tornata-indietro");
  assert.match(tornata.motivo ?? "", /non ha risposto in tempo/);
  await finche(async () => ((await chiedi(lab.porta, "/api/stato"))?.versione === "uno" ? true : undefined));
});

test("se la cartella della versione nuova non c'è, resta quella in funzione", async (t) => {
  const lab = await allestisci(t);
  await lab.approva(join(lab.radice, "manca"), "fantasma");

  const tornata = await lab.fase("tornata-indietro");
  assert.match(tornata.motivo ?? "", /non è stato possibile metterla al suo posto/);
  await finche(async () => ((await chiedi(lab.porta, "/api/stato"))?.versione === "uno" ? true : undefined));
});

test("un riavvio chiesto senza nulla da installare riaccende la stessa versione", async (t) => {
  const lab = await allestisci(t);
  await chiedi(lab.porta, "/riavvia");
  await finche(async () => ((await chiedi(lab.porta, "/api/stato")) === undefined ? true : undefined)).catch(() => {});
  await finche(async () => ((await chiedi(lab.porta, "/api/stato"))?.versione === "uno" ? true : undefined));
  assert.equal(leggiInstallazione(lab.fileInstallazione), undefined);
});

test("se il centro si spegne per conto suo, il guardiano esce con lo stesso codice", async (t) => {
  const lab = await allestisci(t);
  await chiedi(lab.porta, "/muori");
  assert.equal(await lab.finito, 9);
});

test("fermato il guardiano, si ferma anche il centro", async (t) => {
  const lab = await allestisci(t);
  lab.guardiano.spegni();
  await lab.finito;
  await finche(async () => ((await chiedi(lab.porta, "/api/stato")) === undefined ? true : undefined));
});

/**
 * Una versione finta del nodo: non ha un indirizzo a cui rispondere. Dice che è accesa in un file,
 * e, se è di quelle che ci riescono, scrive di essersi collegata al centro come fa il nodo vero.
 */
function versioneDelNodo(cartella: string, nome: string, come: "si-collega" | "non-si-collega" = "si-collega"): string {
  mkdirSync(cartella, { recursive: true });
  writeFileSync(
    join(cartella, "nodo.mjs"),
    `import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const dati = process.env.DATI_DEL_NODO_DI_PROVA;
rmSync(join(dati, "collegato.json"), { force: true });
writeFileSync(join(dati, "acceso.json"), JSON.stringify({ versione: ${JSON.stringify(nome)}, guardiano: process.env.SHINKA_GUARDIANO }));
${come === "si-collega" ? `setTimeout(() => writeFileSync(join(dati, "collegato.json"), JSON.stringify({ versione: ${JSON.stringify(nome)} })), 200);` : ""}
setInterval(() => {
  if (!existsSync(join(dati, "riavvia"))) return;
  rmSync(join(dati, "riavvia"), { force: true });
  process.exit(${CODICE_RIAVVIO});
}, 30);
process.on("SIGTERM", () => process.exit(0));`,
  );
  return cartella;
}

/** Un nodo tenuto acceso dal suo guardiano, come lo allestisce avvio-nodo.ts. */
async function allestisciNodo(t: TestContext, attesaMs = 6_000) {
  const radice = mkdtempSync(join(tmpdir(), "shinka-guardiano-nodo-"));
  const installata = versioneDelNodo(join(radice, "shinka"), "uno");
  const dati = join(radice, "dati-nodo");
  mkdirSync(dati);
  const fileInstallazione = join(dati, "installazione.json");
  process.env.DATI_DEL_NODO_DI_PROVA = dati;
  const guardiano = new Guardiano({
    installata,
    fileInstallazione,
    comando: { programma: process.execPath, argomenti: ["nodo.mjs"] },
    risponde: async () => nodoCollegato(join(dati, FILE_COLLEGATO), leggiInstallazione(fileInstallazione)?.versione),
    attesaMs,
    pausaMs: 100,
    scrivi: () => {},
  });
  const finito = guardiano.avvia();
  t.after(async () => {
    guardiano.spegni();
    await finito.catch(() => {});
    await togli(radice);
  });
  const accesa = (): string | undefined => {
    try {
      return (JSON.parse(readFileSync(join(dati, "acceso.json"), "utf8")) as { versione?: string }).versione;
    } catch {
      return undefined;
    }
  };
  await finche(() => (accesa() === "uno" ? true : undefined));
  /** Ciò che fa il nodo quando il centro gli chiede di cambiare versione: la lascia pronta, lo scrive, e si spegne perché il guardiano lo riavvii. */
  const aggiorna = async (nuova: string, nome: string): Promise<void> => {
    await scriviInstallazione(fileInstallazione, { fase: "da-installare", versione: nome, riassunto: "Una prova.", quando: new Date().toISOString(), nuova });
    writeFileSync(join(dati, "riavvia"), "");
  };
  const fase = (voluta: Installazione["fase"]): Promise<Installazione> =>
    finche(() => {
      const letta = leggiInstallazione(fileInstallazione);
      return letta?.fase === voluta ? letta : undefined;
    });
  return { radice, dati, accesa, aggiorna, fase };
}

test("il nodo ha scritto di essersi collegato solo se lo ha fatto con quella versione", (t) => {
  const file = join(cartellaDiProva(t), FILE_COLLEGATO);
  assert.equal(nodoCollegato(file, "due"), false);
  writeFileSync(file, JSON.stringify({ versione: "uno" }));
  assert.equal(nodoCollegato(file, "due"), false);
  assert.equal(nodoCollegato(file, undefined), false);
  writeFileSync(file, JSON.stringify({ versione: "due" }));
  assert.equal(nodoCollegato(file, "due"), true);
  writeFileSync(file, "non è json");
  assert.equal(nodoCollegato(file, "due"), false);
});

test("un nodo passa alla versione nuova, e ci resta quando con quella si collega al centro", async (t) => {
  const lab = await allestisciNodo(t);
  await lab.aggiorna(versioneDelNodo(join(lab.radice, "shinka-nuovo"), "due"), "due");

  const confermata = await lab.fase("confermata");
  assert.equal(lab.accesa(), "due");
  assert.ok(confermata.precedente !== undefined && existsSync(join(confermata.precedente, "nodo.mjs")));
  assert.equal(JSON.parse(readFileSync(join(lab.dati, "acceso.json"), "utf8")).guardiano, "1");
});

test("un nodo che con la versione nuova non si collega al centro torna a quella di prima", async (t) => {
  const lab = await allestisciNodo(t, 1_200);
  await lab.aggiorna(versioneDelNodo(join(lab.radice, "shinka-nuovo"), "due", "non-si-collega"), "due");

  const tornata = await lab.fase("tornata-indietro");
  assert.match(tornata.motivo ?? "", /non ha risposto in tempo/);
  await finche(() => (lab.accesa() === "uno" ? true : undefined));
  assert.ok(readdirSync(lab.radice).some((nome) => nome.startsWith("shinka-scartata-")));
});
