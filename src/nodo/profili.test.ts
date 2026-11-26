import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import type { EventoConversazione } from "../protocollo/eventi.ts";
import { STATO_PROGETTO_MASSIMO } from "../protocollo/progetti.ts";
import { finche } from "../prove/banco.ts";
import { configurazioneDiProgetto, IMPOSTAZIONI_DI_PROGETTO, leggiStatoProgetto } from "./profili.ts";

async function cartellaDiProgetto(t: TestContext): Promise<string> {
  const cartella = await mkdtemp(join(tmpdir(), "shinka-profili-"));
  t.after(() => rm(cartella, { recursive: true, force: true }));
  return cartella;
}

const FINE_TURNO: EventoConversazione = { tipo: "turno-concluso", riuscito: true, durataMs: 1 };

test("lo stato del progetto si legge dalla sua cartella, ripulito e mai troppo lungo", async (t) => {
  const cartella = await cartellaDiProgetto(t);
  assert.equal(await leggiStatoProgetto(cartella), undefined);

  await writeFile(join(cartella, "STATO.md"), "  \n");
  assert.equal(await leggiStatoProgetto(cartella), undefined);

  await writeFile(join(cartella, "STATO.md"), "\uFEFF# Stato\n\nIl cubo salta.\n\n");
  assert.equal(await leggiStatoProgetto(cartella), "# Stato\n\nIl cubo salta.");

  await writeFile(join(cartella, "STATO.md"), "x".repeat(STATO_PROGETTO_MASSIMO + 500));
  const lungo = await leggiStatoProgetto(cartella);
  assert.equal(lungo, `${"x".repeat(STATO_PROGETTO_MASSIMO)}\n… [tagliato]`);
});

test("alla fine di un turno il progetto riferisce il suo stato, ma solo se è cambiato", async (t) => {
  const cartella = await cartellaDiProgetto(t);
  const eventi: EventoConversazione[] = [];
  const cfg = configurazioneDiProgetto(cartella, undefined, IMPOSTAZIONI_DI_PROGETTO, (e) => eventi.push(e), () => {});
  const stati = (): string[] => eventi.flatMap((e) => (e.tipo === "stato-progetto" ? [e.testo] : []));
  const turno = async (attesi: number): Promise<void> => {
    const prima = eventi.length;
    cfg.alEvento(FINE_TURNO);
    // La fine del turno passa sempre, subito; lo stato la segue quando il file è stato letto.
    assert.deepEqual(eventi[prima], FINE_TURNO);
    await new Promise((fatto) => setTimeout(fatto, 50));
    await finche(() => stati().length === attesi, `gli stati riferiti sono ${attesi}`);
  };

  // Finché il progetto non ha scritto il file non c'è nulla da riferire.
  await turno(0);

  await writeFile(join(cartella, "STATO.md"), "Fatto il personaggio.");
  await turno(1);
  // Un turno che non tocca il file non riferisce di nuovo lo stesso stato.
  await turno(1);
  await writeFile(join(cartella, "STATO.md"), "Fatto il personaggio e il primo livello.");
  await turno(2);
  assert.deepEqual(stati(), ["Fatto il personaggio.", "Fatto il personaggio e il primo livello."]);

  // Gli altri eventi non fanno leggere nulla.
  await writeFile(join(cartella, "STATO.md"), "Mai riferito prima della fine del turno.");
  cfg.alEvento({ tipo: "testo-concluso", idTesto: "t1", testo: "Ancora al lavoro." });
  await new Promise((fatto) => setTimeout(fatto, 50));
  assert.equal(stati().length, 2);
});

test("scrivere lo stato del progetto non chiede consenso, il resto segue i permessi", async (t) => {
  const cartella = await cartellaDiProgetto(t);
  const cfg = configurazioneDiProgetto(cartella, undefined, { permessi: "chiedi" }, () => {}, () => {});
  const consente = (strumento: string, ingresso: unknown): boolean =>
    cfg.consenteDaSe?.(strumento, ingresso, "chiedi") === true;

  assert.equal(consente("Write", { file_path: join(cartella, "STATO.md"), content: "x" }), true);
  assert.equal(consente("Edit", { file_path: "STATO.md", old_string: "a", new_string: "b" }), true);
  assert.equal(consente("Write", { file_path: join(cartella, "main.c"), content: "x" }), false);
  assert.equal(consente("Write", { file_path: join(cartella, "docs", "STATO.md"), content: "x" }), false);
  assert.equal(consente("Write", { file_path: join(cartella, "..", "STATO.md"), content: "x" }), false);
  assert.equal(consente("Bash", { command: "echo x > STATO.md" }), false);
  assert.equal(consente("Write", "STATO.md"), false);
});

test("un progetto sa dei disegni nelle risposte; chi svolge un incarico no, perché riporta a chi guida", async (t) => {
  const cartella = await cartellaDiProgetto(t);
  const progetto = configurazioneDiProgetto(cartella, undefined, { permessi: "chiedi" }, () => {}, () => {});
  assert.match(progetto.istruzioniAggiunte ?? "", /# Disegni nelle risposte/);
  const incarico = configurazioneDiProgetto(cartella, undefined, { permessi: "chiedi" }, () => {}, () => {}, { incarico: true });
  assert.doesNotMatch(incarico.istruzioniAggiunte ?? "", /# Disegni nelle risposte/);
});
