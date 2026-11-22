/**
 * La preparazione di una versione nuova, per chi è tenuto acceso da un guardiano e deve cambiare
 * versione da solo: un nodo, il gateway.
 *
 * Il centro manda i file della versione che ha in funzione. Chi li riceve li scrive in una
 * cartella accanto a quella da cui gira, ci mette le dipendenze per il suo sistema e lascia
 * scritto che cosa va installato: poi si spegne, e il suo guardiano scambia le cartelle, lo
 * riavvia e, se la versione nuova non parte, rimette quella di prima.
 *
 * Questo file non fa parte della copia del guardiano che sta fuori dalla versione: lo usa chi è
 * tenuto acceso, non chi tiene acceso.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { scriviInstallazione } from "./guardiano.ts";
import {
  inBreve,
  percorsoDiVersioneValido,
  versioneDi,
  versioneValida,
  type FileDiVersione,
} from "../protocollo/versione.ts";

/** Come si scaricano le dipendenze quando sono cambiate, e per quanto si aspetta. */
export interface ComandoDipendenze {
  comando: string;
  secondi: number;
}

export const DIPENDENZE: ComandoDipendenze = { comando: "npm ci", secondi: 900 };

/** Quanto dell'uscita di un comando fallito viene riportato al proprietario. */
const USCITA_RIPORTATA = 1500;

export interface OpzioniVersioneNuova {
  /** La cartella della versione in funzione: chi si aggiorna gira da lì. */
  installata: string;
  /** Il file in cui chi si aggiorna e il suo guardiano si dicono a che punto è un'installazione. */
  fileInstallazione: string;
  /** La versione a cui passare, e i suoi file. */
  versione: string;
  file: FileDiVersione[];
  /** Che cosa resta scritto dell'installazione, in parole per il proprietario. */
  riassunto: string;
  /** Quali percorsi il pacchetto può portare: se non è detto, tutti quelli di una versione di Shinka. */
  percorsoValido?: (percorso: unknown) => boolean;
  /** Vero se la stessa versione si può installare di nuovo: serve dove conta il contenuto, non il nome. */
  ancheLaStessa?: boolean;
  dipendenze?: ComandoDipendenze;
  adesso?: () => number;
}

export type EsitoVersioneNuova = { pronta: true } | { pronta: false; motivo: string };

/** Esegue un comando nella cartella indicata e lo ferma, con ciò che ha avviato, se dura troppo. */
function esegui(passo: ComandoDipendenze, cartella: string): Promise<{ codice: number | null; uscita: string; scaduto: boolean }> {
  return new Promise((fatto) => {
    const figlio = spawn(passo.comando, {
      cwd: cartella,
      shell: true,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let uscita = "";
    const raccogli = (pezzo: Buffer): void => {
      uscita = (uscita + pezzo.toString("utf8")).slice(-USCITA_RIPORTATA * 2);
    };
    figlio.stdout.on("data", raccogli);
    figlio.stderr.on("data", raccogli);
    let scaduto = false;
    const sveglia = setTimeout(() => {
      scaduto = true;
      if (figlio.pid === undefined) return;
      if (process.platform === "win32") {
        spawn("taskkill", ["/pid", String(figlio.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      } else {
        try {
          process.kill(-figlio.pid, "SIGKILL");
        } catch {
          figlio.kill("SIGKILL");
        }
      }
    }, passo.secondi * 1000);
    const chiudi = (codice: number | null): void => {
      clearTimeout(sveglia);
      fatto({ codice, uscita: uscita.slice(-USCITA_RIPORTATA).trim(), scaduto });
    };
    figlio.on("error", (errore) => {
      uscita += `\n${errore.message}`;
      chiudi(1);
    });
    figlio.on("close", (codice) => chiudi(codice));
  });
}

async function stessoFile(a: string, b: string): Promise<boolean> {
  try {
    const [primo, secondo] = await Promise.all([readFile(a), readFile(b)]);
    return primo.equals(secondo);
  } catch {
    return false;
  }
}

/**
 * Prepara la versione nuova accanto a quella in funzione e lascia scritto al guardiano di
 * installarla. Se qualcosa non va la cartella nuova viene tolta, e il nodo resta com'è.
 */
export async function preparaVersioneNuova(opzioni: OpzioniVersioneNuova): Promise<EsitoVersioneNuova> {
  const { installata, fileInstallazione, versione, file } = opzioni;
  const percorsoValido = opzioni.percorsoValido ?? percorsoDiVersioneValido;
  const nuova = `${installata}-nuovo`;
  const no = async (motivo: string): Promise<EsitoVersioneNuova> => {
    await rm(nuova, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
    return { pronta: false, motivo };
  };

  if (!versioneValida(versione)) return { pronta: false, motivo: "La versione indicata dal centro non è scritta come una versione." };
  if (opzioni.ancheLaStessa !== true && (await versioneDi(installata)) === versione) {
    return { pronta: false, motivo: `La versione ${inBreve(versione)} è già quella in funzione qui.` };
  }
  if (file.some((uno) => !percorsoValido(uno.percorso))) {
    return { pronta: false, motivo: "Il pacchetto del centro contiene un file che qui non può stare." };
  }
  if (!file.some((uno) => uno.percorso === "package.json") || !file.some((uno) => uno.percorso === "package-lock.json")) {
    return { pronta: false, motivo: "Nel pacchetto del centro manca l'elenco delle dipendenze." };
  }

  try {
    await rm(nuova, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    for (const uno of file) {
      const destinazione = join(nuova, ...uno.percorso.split("/"));
      await mkdir(dirname(destinazione), { recursive: true });
      await writeFile(destinazione, Buffer.from(uno.dati, "base64"));
    }
    // La versione che il pacchetto dichiara deve essere quella chiesta: altrimenti si direbbe una cosa e se ne eseguirebbe un'altra.
    if ((await versioneDi(nuova)) !== versione) {
      return await no(`Il pacchetto del centro non è quello della versione ${inBreve(versione)}.`);
    }

    // Le dipendenze: se non sono cambiate valgono quelle della versione in funzione.
    const stesse =
      existsSync(join(installata, "node_modules")) && (await stessoFile(join(installata, "package-lock.json"), join(nuova, "package-lock.json")));
    if (stesse) {
      await cp(join(installata, "node_modules"), join(nuova, "node_modules"), { recursive: true, verbatimSymlinks: true });
    } else {
      const passo = opzioni.dipendenze ?? DIPENDENZE;
      const esito = await esegui(passo, nuova);
      if (esito.scaduto) return await no(`Lo scaricamento delle dipendenze (${passo.comando}) è stato fermato dopo ${passo.secondi} secondi.\n${esito.uscita}`);
      if (esito.codice !== 0) return await no(`Lo scaricamento delle dipendenze (${passo.comando}) non è riuscito:\n${esito.uscita}`);
    }

    await mkdir(dirname(fileInstallazione), { recursive: true });
    await scriviInstallazione(fileInstallazione, {
      fase: "da-installare",
      versione,
      riassunto: opzioni.riassunto,
      quando: new Date(opzioni.adesso?.() ?? Date.now()).toISOString(),
      nuova,
    });
    return { pronta: true };
  } catch (errore) {
    return await no(`La versione nuova non si è potuta preparare: ${errore instanceof Error ? errore.message : String(errore)}`);
  }
}
