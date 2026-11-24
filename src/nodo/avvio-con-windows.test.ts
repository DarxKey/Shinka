import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { AvvioConWindows, COLLEGAMENTO_DEL_NODO } from "./avvio-con-windows.ts";

test("acceso, il collegamento avvia l'icona del nodo; spento, si tolgono anche gli avvii di prima", async (t) => {
  const esecuzione = await mkdtemp(join(tmpdir(), "shinka-esecuzione-"));
  t.after(() => rm(esecuzione, { recursive: true, force: true }));
  const script: string[] = [];
  const collegamento = join(esecuzione, COLLEGAMENTO_DEL_NODO);
  const avvio = new AvvioConWindows({
    cartella: "C:\\Users\\mario\\Shinka\\nodo",
    esecuzioneAutomatica: esecuzione,
    powershell: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0",
    // Il PowerShell finto fa ciò che lo script chiede al file del collegamento.
    esegui: async (testo) => {
      script.push(testo);
      if (testo.includes("$c.Save()")) await writeFile(collegamento, "");
      else await rm(collegamento, { force: true });
      return { codice: 0, uscita: "" };
    },
  });
  assert.equal(avvio.attivo(), false);
  assert.deepEqual(await avvio.imposta(true), { attivo: true });
  assert.ok(existsSync(collegamento));
  assert.match(script[0] ?? "", /\$c\.Arguments = '-NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File "C:\\Users\\mario\\Shinka\\nodo\\guardiano\\icona-windows\.ps1"'/);
  assert.match(script[0] ?? "", /\$c\.TargetPath = 'C:\\Windows\\System32\\WindowsPowerShell\\v1\.0[\\/]powershell\.exe'/);

  assert.deepEqual(await avvio.imposta(false), { attivo: false });
  assert.match(script[1] ?? "", /avvia-guardiano\|avvio-nodo/);

  const rotto = new AvvioConWindows({ cartella: "C:\\x", esecuzioneAutomatica: esecuzione, esegui: async () => ({ codice: 1, uscita: "Accesso negato" }) });
  assert.deepEqual(await rotto.imposta(true), { motivo: "PowerShell non ci è riuscito: Accesso negato" });
});

test("fuori da Windows non c'è nulla da cambiare", () => {
  if (process.platform !== "win32") assert.equal(AvvioConWindows.diQuestaMacchina(), undefined);
});

test("il nodo accetta dal centro il comando per l'avvio con Windows e il consenso per sempre", async () => {
  const { leggiComando } = await import("./collegamento.ts");
  assert.deepEqual(leggiComando({ tipo: "avvio-con-windows", idRichiesta: "r1", attivo: true }), { tipo: "avvio-con-windows", idRichiesta: "r1", attivo: true });
  assert.equal(leggiComando({ tipo: "avvio-con-windows", idRichiesta: "r1", attivo: "si" }), undefined);
  assert.deepEqual(leggiComando({ tipo: "decidi-permesso", idConversazione: "c", idPermesso: "p", decisione: "approvato", sempre: true }), {
    tipo: "decidi-permesso",
    idConversazione: "c",
    idPermesso: "p",
    decisione: "approvato",
    sempre: true,
  });
});
