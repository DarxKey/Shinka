/**
 * Prepara la copia pubblica di Shinka e, con `--invia`, la manda su GitHub.
 *
 *   npm run pubblica              prepara il ramo pubblico e dice che cosa c'è di nuovo
 *   npm run pubblica -- --invia   lo manda anche al remoto `github`, sul suo ramo `main`
 *
 * Si lancia dalla cartella del repository di lavoro. L'elenco delle espressioni vietate sta
 * fuori dal repository: in SHINKA_PUBBLICAZIONE_VIETATI, oppure in
 * ~/.config/shinka/pubblicazione-vietati.txt. Una riga per espressione; le righe con # sono commenti.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { leggiVietati, preparaCopiaPubblica, PubblicazioneRifiutata, RAMO_PUBBLICO } from "./copia-pubblica.ts";

const REMOTO = "github";

function principale(): void {
  const invia = process.argv.includes("--invia");
  const cartella = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const elenco = process.env.SHINKA_PUBBLICAZIONE_VIETATI ?? join(homedir(), ".config", "shinka", "pubblicazione-vietati.txt");
  if (!existsSync(elenco)) {
    throw new PubblicazioneRifiutata(`Manca l'elenco delle espressioni vietate (${elenco}): senza, non si pubblica nulla.`);
  }

  const esito = preparaCopiaPubblica({ cartella, vietati: leggiVietati(readFileSync(elenco, "utf8")) });
  console.log(
    esito.nuovi === 0
      ? `La copia pubblica è già aggiornata (${esito.punta.slice(0, 8)}).`
      : `Copia pubblica: ${esito.nuovi === 1 ? "un commit nuovo" : `${esito.nuovi} commit nuovi`}, in cima ${esito.punta.slice(0, 8)}.`,
  );
  if (!invia) {
    console.log("Non ho mandato nulla. Per mandarla: npm run pubblica -- --invia");
    return;
  }

  const remoti = execFileSync("git", ["remote"], { cwd: cartella, encoding: "utf8" }).split("\n");
  if (!remoti.includes(REMOTO)) {
    throw new PubblicazioneRifiutata(
      `Manca il remoto «${REMOTO}». Si aggiunge con: git remote add ${REMOTO} git@github-shinka:<utente>/<repository>.git`,
    );
  }
  execFileSync("git", ["push", REMOTO, `${RAMO_PUBBLICO}:main`], { cwd: cartella, stdio: "inherit" });
  console.log(`Mandata a «${REMOTO}».`);
}

try {
  principale();
} catch (errore) {
  if (!(errore instanceof PubblicazioneRifiutata)) throw errore;
  console.error(errore.message);
  process.exitCode = 1;
}
