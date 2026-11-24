/**
 * Su Windows il nodo parte a ogni accesso grazie a un collegamento in Esecuzione automatica, che
 * avvia la sua icona; l'icona avvia il nodo. Il proprietario lo accende e lo spegne dalla pagina degli
 * ambienti: qui si mette o si toglie quel collegamento, scritto come lo scrive il comando di una riga.
 * Spegnendolo si tolgono anche gli avvii di prima (per esempio un .vbs fatto a mano).
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, win32 } from "node:path";

/** Il nome del collegamento, lo stesso che scrive `prepara-ambiente.ps1`. */
export const COLLEGAMENTO_DEL_NODO = "Shinka nodo.lnk";

/** Esegue uno script di PowerShell; nei test, uno finto. */
export type EseguiPowerShell = (script: string) => Promise<{ codice: number; uscita: string }>;

const powershellVero: EseguiPowerShell = (script) =>
  new Promise((risolvi) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true, timeout: 15_000 },
      (errore, stdout, stderr) => risolvi({ codice: errore === null ? 0 : typeof errore.code === "number" ? errore.code : 1, uscita: `${stdout}${stderr}`.trim() }),
    );
  });

export interface OpzioniAvvioConWindows {
  /** La cartella del nodo: quella con guardiano\, shinka\ e dati-nodo\. */
  cartella: string;
  /** La cartella Esecuzione automatica dell'utente. */
  esecuzioneAutomatica: string;
  /** La cartella di PowerShell, per il programma del collegamento. */
  powershell?: string;
  esegui?: EseguiPowerShell;
}

/** Una stringa per PowerShell tra apici singoli. */
function tra(testo: string): string {
  return `'${testo.replaceAll("'", "''")}'`;
}

export class AvvioConWindows {
  readonly #o: OpzioniAvvioConWindows;

  constructor(opzioni: OpzioniAvvioConWindows) {
    this.#o = opzioni;
  }

  /**
   * Quello di questa macchina, se il nodo è stato installato con il comando di una riga (ha l'icona);
   * nulla fuori da Windows o con un'installazione fatta a mano, dove da qui non si sa cambiarlo.
   */
  static diQuestaMacchina(): AvvioConWindows | undefined {
    const dati = process.env.SHINKA_DATI_NODO;
    const appdata = process.env.APPDATA;
    if (process.platform !== "win32" || dati === undefined || appdata === undefined) return undefined;
    const cartella = dirname(dati);
    if (!existsSync(join(cartella, "guardiano", "icona-windows.ps1"))) return undefined;
    return new AvvioConWindows({
      cartella,
      esecuzioneAutomatica: join(appdata, "Microsoft", "Windows", "Start Menu", "Programs", "Startup"),
      powershell: join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0"),
    });
  }

  /** Vero se adesso il nodo parte a ogni accesso. */
  attivo(): boolean {
    return existsSync(join(this.#o.esecuzioneAutomatica, COLLEGAMENTO_DEL_NODO));
  }

  /** Mette o toglie il collegamento; com'è dopo, o perché non si è potuto. */
  async imposta(attivo: boolean): Promise<{ attivo: boolean } | { motivo: string }> {
    const collegamento = join(this.#o.esecuzioneAutomatica, COLLEGAMENTO_DEL_NODO);
    // Percorsi di Windows, scritti nel collegamento così come li leggerà Windows.
    const icona = win32.join(this.#o.cartella, "guardiano", "icona-windows.ps1");
    const powershell = win32.join(this.#o.powershell ?? "", "powershell.exe");
    const script = attivo
      ? [
          "$shell = New-Object -ComObject WScript.Shell",
          `$c = $shell.CreateShortcut(${tra(collegamento)})`,
          `$c.TargetPath = ${tra(powershell)}`,
          `$c.Arguments = ${tra(`-NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File "${icona}"`)}`,
          `$c.WorkingDirectory = ${tra(this.#o.cartella)}`,
          "$c.WindowStyle = 7",
          "$c.Description = 'Nodo di Shinka'",
          "$c.Save()",
        ].join("; ")
      : [
          "$shell = New-Object -ComObject WScript.Shell",
          `foreach ($l in @(Get-ChildItem -LiteralPath ${tra(this.#o.esecuzioneAutomatica)} -Filter '*.lnk' -ErrorAction SilentlyContinue)) {`,
          `  $t = $shell.CreateShortcut($l.FullName); if ($l.Name -eq ${tra(COLLEGAMENTO_DEL_NODO)} -or "$($t.TargetPath) $($t.Arguments)" -match 'avvia-guardiano|avvio-nodo\\.ts|icona-windows\\.ps1') { Remove-Item -LiteralPath $l.FullName -Force }`,
          "}",
        ].join("\n");
    const esito = await (this.#o.esegui ?? powershellVero)(script);
    if (esito.codice !== 0) return { motivo: `PowerShell non ci è riuscito: ${esito.uscita.slice(0, 500) || `codice ${esito.codice}`}` };
    const adesso = this.attivo();
    return adesso === attivo ? { attivo: adesso } : { motivo: "Il collegamento in Esecuzione automatica non è cambiato." };
  }
}
