import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { finche, ShellFinta } from "../prove/banco.ts";
import { leggiComandoTerminale, leggiDalBrowser, leggiRiferitoTerminale, TERMINALI_MASSIMI, type RiferitoTerminale } from "../protocollo/terminale.ts";
import { ambienteDellaShell, recente, Terminali } from "./terminali.ts";

async function allestisci(t: TestContext, inattivitaMassimaMs?: number) {
  const cartella = await mkdtemp(join(tmpdir(), "shinka-terminali-"));
  const riferiti: RiferitoTerminale[] = [];
  const shell: ShellFinta[] = [];
  const terminali = new Terminali((messaggio) => riferiti.push(messaggio), {
    controlloMs: 0,
    raccoltaMs: 1,
    ...(inattivitaMassimaMs === undefined ? {} : { inattivitaMassimaMs }),
    accendi: async (dove, colonne, righe) => {
      const accesa = new ShellFinta(dove, colonne, righe);
      shell.push(accesa);
      return accesa;
    },
  });
  t.after(async () => {
    terminali.spegniTutti();
    await rm(cartella, { recursive: true, force: true });
  });
  const apri = (idTerminale = "p1", colonne = 80, righe = 24): void =>
    terminali.esegui({ tipo: "terminale-apri", idTerminale, cartella, colonne, righe });
  const di = (tipo: RiferitoTerminale["tipo"]): RiferitoTerminale[] => riferiti.filter((m) => m.tipo === tipo);
  return { cartella, riferiti, shell, terminali, apri, di };
}

test("un terminale si accende nella cartella del progetto, riceve ciò che si scrive e riferisce ciò che esce", async (t) => {
  const { cartella, shell, terminali, apri, di } = await allestisci(t);
  apri();
  await finche(() => di("terminale-aperto").length === 1, "il terminale si accende");
  assert.deepEqual(di("terminale-aperto")[0], { tipo: "terminale-aperto", idTerminale: "p1", finora: "" });
  const accesa = shell[0];
  assert.ok(accesa);
  assert.equal(accesa.cartella, cartella);
  assert.deepEqual(accesa.misure, [[80, 24]]);

  terminali.esegui({ tipo: "terminale-scrivi", idTerminale: "p1", dati: "ls\r" });
  terminali.esegui({ tipo: "terminale-misura", idTerminale: "p1", colonne: 120, righe: 40 });
  assert.deepEqual(accesa.scritti, ["ls\r"]);
  assert.deepEqual(accesa.misure.at(-1), [120, 40]);

  // Una shell scrive a pezzetti: arrivano raccolti in un messaggio solo.
  accesa.emetti("uno\r\n");
  accesa.emetti("due\r\n");
  await finche(() => di("terminale-uscita").length === 1, "l'uscita viene riferita");
  assert.deepEqual(di("terminale-uscita")[0], { tipo: "terminale-uscita", idTerminale: "p1", dati: "uno\r\ndue\r\n" });
});

test("chi riapre un terminale acceso ritrova l'uscita recente, e la shell è la stessa", async (t) => {
  const { shell, terminali, apri, di } = await allestisci(t);
  apri();
  await finche(() => di("terminale-aperto").length === 1, "il terminale si accende");
  shell[0]?.emetti("npm run dev\r\nin ascolto su 5173\r\n");
  await finche(() => di("terminale-uscita").length === 1, "l'uscita viene riferita");

  apri("p1", 100, 30);
  await finche(() => di("terminale-aperto").length === 2, "il terminale viene ritrovato");
  assert.equal(shell.length, 1);
  assert.equal(terminali.accesi, 1);
  assert.deepEqual(di("terminale-aperto")[1], {
    tipo: "terminale-aperto",
    idTerminale: "p1",
    finora: "npm run dev\r\nin ascolto su 5173\r\n",
  });
  assert.deepEqual(shell[0]?.misure.at(-1), [100, 30]);
});

test("due richieste di aprire lo stesso terminale accendono una shell sola", async (t) => {
  const { shell, apri, di } = await allestisci(t);
  apri();
  apri();
  await finche(() => di("terminale-aperto").length === 2, "tutte e due ricevono risposta");
  assert.equal(shell.length, 1);
});

test("un terminale si chiude quando lo chiude il proprietario, e quando la shell finisce", async (t) => {
  const { shell, terminali, apri, di } = await allestisci(t);
  apri("p1");
  apri("p2");
  await finche(() => di("terminale-aperto").length === 2, "i terminali si accendono");

  terminali.esegui({ tipo: "terminale-chiudi", idTerminale: "p1" });
  assert.equal(shell[0]?.spenta, true);
  assert.deepEqual(di("terminale-chiuso"), [{ tipo: "terminale-chiuso", idTerminale: "p1", motivo: "Terminale chiuso." }]);

  shell[1]?.emetti("exit\r\n");
  shell[1]?.finisci(3);
  // Ciò che la shell aveva scritto arriva prima della notizia che è finita.
  assert.deepEqual(di("terminale-uscita"), [{ tipo: "terminale-uscita", idTerminale: "p2", dati: "exit\r\n" }]);
  assert.match(JSON.stringify(di("terminale-chiuso")[1]), /codice 3/);
  assert.equal(terminali.accesi, 0);

  // A un terminale chiuso non arriva più nulla, senza errori.
  terminali.esegui({ tipo: "terminale-scrivi", idTerminale: "p1", dati: "x" });
  assert.deepEqual(shell[0]?.scritti, []);
});

test("un terminale fermo da troppo tempo si chiude da solo; uno usato da poco resta", async (t) => {
  const { shell, terminali, apri, di } = await allestisci(t, 60_000);
  apri("fermo");
  apri("vivo");
  await finche(() => di("terminale-aperto").length === 2, "i terminali si accendono");
  const tra = Date.now() + 90_000;
  // Poco prima del controllo, in quello vivo esce qualcosa.
  const vero = Date.now;
  Date.now = () => tra - 1_000;
  try {
    shell[1]?.emetti("ancora qui\r\n");
  } finally {
    Date.now = vero;
  }
  terminali.chiudiInattivi(tra);
  assert.equal(shell[0]?.spenta, true);
  assert.equal(shell[1]?.spenta, false);
  assert.equal(terminali.accesi, 1);
  assert.match(JSON.stringify(di("terminale-chiuso")), /senza attività/);
});

test("un ambiente tiene accesi solo un certo numero di terminali, e solo in cartelle che esistono", async (t) => {
  const { cartella, riferiti, terminali, apri, di } = await allestisci(t);
  for (let n = 0; n < TERMINALI_MASSIMI; n += 1) apri(`p${n}`);
  await finche(() => di("terminale-aperto").length === TERMINALI_MASSIMI, "i terminali si accendono");
  apri("di-troppo");
  await finche(() => di("terminale-chiuso").length === 1, "quello di troppo viene rifiutato");
  assert.match(JSON.stringify(riferiti.at(-1)), /chiudine uno/);

  terminali.esegui({ tipo: "terminale-chiudi", idTerminale: "p0" });
  terminali.esegui({ tipo: "terminale-apri", idTerminale: "altrove", cartella: join(cartella, "non-esiste"), colonne: 80, righe: 24 });
  await finche(() => di("terminale-chiuso").length === 3, "la cartella che manca viene detta");
  assert.match(JSON.stringify(riferiti.at(-1)), /non c'è in questo ambiente/);
});

test("quando l'ambiente si ferma i terminali si spengono con lui", async (t) => {
  const { shell, terminali, apri, di } = await allestisci(t);
  apri();
  await finche(() => di("terminale-aperto").length === 1, "il terminale si accende");
  terminali.spegniTutti();
  assert.equal(shell[0]?.spenta, true);
  assert.equal(terminali.accesi, 0);
});

test("dell'uscita si tiene la parte finale, dall'inizio di una riga", () => {
  assert.equal(recente("breve", 100), "breve");
  assert.equal(recente("prima riga\nseconda riga\nterza", 20), "seconda riga\nterza");
  assert.equal(recente("x".repeat(50), 10), "x".repeat(10));
});

test("la shell non eredita le impostazioni di Shinka", () => {
  const ambiente = ambienteDellaShell({ PATH: "/bin", SHINKA_GATEWAY_GETTONE: "segreto", Shinka_Dati: "/dati", VUOTA: undefined });
  assert.deepEqual(ambiente, { PATH: "/bin", TERM: "xterm-256color", COLORTERM: "truecolor" });
});

test("i messaggi del terminale scritti male non passano", () => {
  assert.deepEqual(leggiComandoTerminale({ tipo: "terminale-apri", idTerminale: "p1", cartella: "/p", colonne: 80, righe: 24 }), {
    tipo: "terminale-apri",
    idTerminale: "p1",
    cartella: "/p",
    colonne: 80,
    righe: 24,
  });
  assert.equal(leggiComandoTerminale({ tipo: "terminale-apri", idTerminale: "p1", cartella: "/p", colonne: 0, righe: 24 }), undefined);
  assert.equal(leggiComandoTerminale({ tipo: "terminale-apri", idTerminale: "p1", cartella: "/p", colonne: 80, righe: 9999 }), undefined);
  assert.equal(leggiComandoTerminale({ tipo: "terminale-scrivi", idTerminale: "", dati: "x" }), undefined);
  assert.equal(leggiComandoTerminale({ tipo: "altro", idTerminale: "p1" }), undefined);
  assert.deepEqual(leggiRiferitoTerminale({ tipo: "terminale-uscita", idTerminale: "p1", dati: "ciao" }), {
    tipo: "terminale-uscita",
    idTerminale: "p1",
    dati: "ciao",
  });
  assert.equal(leggiRiferitoTerminale({ tipo: "terminale-uscita", idTerminale: "p1", dati: 7 }), undefined);

  assert.deepEqual(leggiDalBrowser(JSON.stringify({ tipo: "apri", colonne: 80, righe: 24, altro: true })), {
    tipo: "apri",
    colonne: 80,
    righe: 24,
  });
  assert.deepEqual(leggiDalBrowser(JSON.stringify({ tipo: "scrivi", dati: "ls\r" })), { tipo: "scrivi", dati: "ls\r" });
  assert.equal(leggiDalBrowser(JSON.stringify({ tipo: "misura", colonne: 80.5, righe: 24 })), undefined);
  assert.equal(leggiDalBrowser("non è json"), undefined);
  assert.equal(leggiDalBrowser(JSON.stringify(["apri"])), undefined);
});
