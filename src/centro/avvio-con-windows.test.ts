/**
 * Dalla pagina degli ambienti: l'indirizzo con cui un nodo raggiunge il centro (per reinstallarlo con
 * quello) e la scelta di farlo partire a ogni accesso a Windows.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { MessaggioCentro, MessaggioNodo } from "../protocollo/nodi.ts";
import { RegistroAmbienti, type CanaleNodo } from "./ambienti.ts";
import { AvvioConWindows } from "./avvio-con-windows.ts";

type Presentazione = Extract<MessaggioNodo, { tipo: "presentazione" }>;

const PRESENTAZIONE: Presentazione = {
  tipo: "presentazione",
  idNodo: "nodo-pc-windows",
  segreto: "segreto-di-prova-lungo-almeno-trentadue-caratteri",
  nome: "PC Windows",
  descrizione: "Unity",
  sistema: "Windows 11",
  radiceProgetti: "C:\\Progetti",
  centro: "http://192.168.1.20:7850",
  avvioConWindows: false,
};

class CanaleFinto implements CanaleNodo {
  ricevuti: MessaggioCentro[] = [];
  invia(messaggio: MessaggioCentro): void {
    this.ricevuti.push(messaggio);
  }
  chiudi(): void {}
}

test("il nodo dice da quale indirizzo raggiunge il centro, e dalla pagina si sceglie se parte con Windows", async (t) => {
  const cartella = await mkdtemp(join(tmpdir(), "shinka-avvio-"));
  t.after(() => rm(cartella, { recursive: true, force: true }));
  const file = join(cartella, "ambienti.json");
  const registro = await RegistroAmbienti.apri(file, { nome: "Unraid", descrizione: "", sistema: "Linux", radiceProgetti: "/p" });
  const canale = new CanaleFinto();
  await registro.presenta(PRESENTAZIONE, canale);
  await registro.decidi("nodo-pc-windows", "approvato");
  // Ripresentato, ora che è registrato, lascia il suo indirizzo.
  await registro.presenta(PRESENTAZIONE, canale);
  const ambiente = () => registro.stato().ambienti.find((uno) => uno.id === "nodo-pc-windows");
  assert.equal(ambiente()?.indirizzoDelCentro, "http://192.168.1.20:7850");
  assert.equal(ambiente()?.avvioConWindows, false);

  const avvio = new AvvioConWindows(registro, 500);
  const chiesto = avvio.imposta("nodo-pc-windows", true);
  const comando = canale.ricevuti.at(-1);
  assert.ok(comando?.tipo === "avvio-con-windows" && comando.attivo === true);
  registro.riferito("nodo-pc-windows", canale, { tipo: "avvio-con-windows-esito", idRichiesta: comando.idRichiesta, attivo: true });
  assert.deepEqual(await chiesto, { attivo: true });
  assert.equal(ambiente()?.avvioConWindows, true);

  // Un nodo che non risponde, o che non ci riesce, lo si dice.
  assert.deepEqual(await avvio.imposta("nodo-pc-windows", false), { motivo: "Il nodo non ha risposto in tempo." });
  const negato = avvio.imposta("nodo-pc-windows", false);
  const secondo = canale.ricevuti.at(-1);
  assert.ok(secondo?.tipo === "avvio-con-windows");
  registro.riferito("nodo-pc-windows", canale, { tipo: "avvio-con-windows-esito", idRichiesta: secondo.idRichiesta, motivo: "Accesso negato" });
  assert.deepEqual(await negato, { motivo: "Accesso negato" });
  assert.equal(ambiente()?.avvioConWindows, true);

  // Spento il nodo l'indirizzo resta, per reinstallarlo; la scelta non si può cambiare.
  registro.scollegato("nodo-pc-windows", canale);
  assert.equal(ambiente()?.indirizzoDelCentro, "http://192.168.1.20:7850");
  assert.equal(ambiente()?.avvioConWindows, undefined);
  assert.match(((await avvio.imposta("nodo-pc-windows", true)) as { motivo: string }).motivo, /spento/);
  const riaperto = await RegistroAmbienti.apri(file, { nome: "Unraid", descrizione: "", sistema: "Linux", radiceProgetti: "/p" });
  assert.equal(riaperto.stato().ambienti.find((uno) => uno.id === "nodo-pc-windows")?.indirizzoDelCentro, "http://192.168.1.20:7850");

  // Un nodo installato a mano non dice nulla: da qui non si cambia.
  const { avvioConWindows: _, ...senza } = PRESENTAZIONE;
  await registro.presenta(senza, canale);
  assert.match(((await avvio.imposta("nodo-pc-windows", true)) as { motivo: string }).motivo, /Reinstalla/);
});

test("un nodo vero dice al centro l'indirizzo con cui lo raggiunge", async (t) => {
  const { allestisci, avviaNodoAccettato, finche, ID_NODO } = await import("../prove/banco.ts");
  const banco = await allestisci(t);
  await avviaNodoAccettato(t, banco);
  await finche(() => banco.ambienti.stato().ambienti.find((uno) => uno.id === ID_NODO)?.indirizzoDelCentro !== undefined, "l'indirizzo arriva");
  assert.match(banco.ambienti.stato().ambienti.find((uno) => uno.id === ID_NODO)?.indirizzoDelCentro ?? "", /^http:\/\/127\.0\.0\.1:\d+$/);
});
