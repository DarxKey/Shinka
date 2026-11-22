/**
 * La preparazione di una versione nuova di Shinka: dal repository del progetto Shinka a una
 * cartella pronta per essere messa in funzione, dopo aver superato le stesse prove che fa chi
 * sviluppa. Il centro la rifà da capo su una copia pulita: conta ciò che è registrato nel
 * repository, non ciò che il modello dice di aver provato.
 */

import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FILE_VERSIONE, inBreve, versioneDi } from "../protocollo/versione.ts";

export { FILE_VERSIONE, inBreve, versioneDi };

/** Quanto dell'uscita di una prova fallita viene riportato a chi sviluppa. */
const USCITA_RIPORTATA = 6000;

/** Quanti file cambiati e quante modifiche compaiono nella scheda: il conto dice comunque quanti sono. */
const FILE_MOSTRATI = 30;
const MODIFICHE_MOSTRATE = 20;

export interface Passo {
  /** Come lo si nomina a chi sviluppa: "controllo dei tipi". */
  nome: string;
  comando: string;
  secondi: number;
}

/** Le prove che una versione deve superare, nell'ordine. */
export const PASSI: Passo[] = [
  { nome: "controllo dei tipi", comando: "npm run typecheck", secondi: 600 },
  { nome: "test", comando: "npm test", secondi: 1500 },
  { nome: "costruzione dell'interfaccia", comando: "npm run costruisci", secondi: 600 },
];

/** Come si scaricano le dipendenze quando sono cambiate. */
const DIPENDENZE: Passo = { nome: "dipendenze", comando: "npm ci", secondi: 900 };

export interface OpzioniPreparazione {
  /** La cartella del progetto Shinka: una copia di lavoro del repository. */
  progetto: string;
  /** La cartella della versione in funzione. */
  installata: string;
  /** Dove preparare la versione nuova: viene svuotata e riempita. */
  nuova: string;
  /** Il ramo del repository che la versione deve contenere per intero. */
  ramo?: string;
  passi?: Passo[];
  dipendenze?: Passo;
}

export interface VersionePronta {
  pronta: true;
  /** La versione per intero, come la conosce il repository. */
  versione: string;
  /** Le modifiche registrate dalla versione in funzione a questa, dalla più recente. */
  modifiche: string[];
  /** I primi file cambiati, e quanti sono in tutto. */
  file: string[];
  quantiFile: number;
  /** Ciò che il proprietario deve sapere prima di approvare. */
  avvisi: string[];
}

export type EsitoPreparazione = VersionePronta | { pronta: false; motivo: string };

interface Uscita {
  codice: number | null;
  uscita: string;
}

/** Git, nella cartella del progetto. Non lancia: il codice dice com'è andata. */
export function git(cartella: string, argomenti: string[], ambiente: NodeJS.ProcessEnv = process.env): Promise<Uscita> {
  return new Promise((fatto) => {
    execFile("git", argomenti, { cwd: cartella, env: ambiente, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (errore, stdout, stderr) => {
      const codice = errore === null ? 0 : typeof errore.code === "number" ? errore.code : 1;
      fatto({ codice, uscita: `${stdout}${stderr}`.trim() });
    });
  });
}

/** L'ambiente delle prove: senza le variabili di questo centro, che non devono arrivare ai test. */
function ambienteDiProva(): NodeJS.ProcessEnv {
  const ambiente: NodeJS.ProcessEnv = {};
  for (const [nome, valore] of Object.entries(process.env)) {
    if (!nome.startsWith("SHINKA_")) ambiente[nome] = valore;
  }
  return {
    ...ambiente,
    CI: "1",
    GIT_AUTHOR_NAME: "Shinka",
    GIT_AUTHOR_EMAIL: "shinka@localhost",
    GIT_COMMITTER_NAME: "Shinka",
    GIT_COMMITTER_EMAIL: "shinka@localhost",
  };
}

/** Esegue un passo nella cartella indicata, e lo ferma se dura troppo. */
function esegui(passo: Passo, cartella: string): Promise<Uscita & { scaduto: boolean }> {
  return new Promise((fatto) => {
    const figlio = spawn(passo.comando, {
      cwd: cartella,
      env: ambienteDiProva(),
      shell: true,
      windowsHide: true,
      // Su Linux il passo sta in un gruppo suo: fermandolo si fermano anche i processi che ha avviato.
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

function avvisiPer(file: string[]): string[] {
  const tocca = (prefisso: string): boolean => file.some((percorso) => percorso.startsWith(prefisso));
  const avvisi: string[] = [];
  // Del gateway dice chi installa, che sa se la sua parte cambia davvero e se sa aggiornarsi da dentro.
  if (tocca("src/guardiano/guardiano.ts") || tocca("src/guardiano/avvio")) {
    avvisi.push("Cambia anche il guardiano: quello in funzione resta quello di prima finché non lo si aggiorna da fuori.");
  }
  if (tocca("src/nodo/") || tocca("src/protocollo/")) {
    avvisi.push(
      "Cambia anche ciò che usano i nodi: un nodo che non sa aggiornarsi da solo resta alla versione di prima finché non lo aggiorni su quella macchina. " +
        "Nella pagina Ambienti si vede quali sono indietro.",
    );
  }
  if (file.includes("package-lock.json")) avvisi.push("Cambiano le dipendenze: sono state scaricate di nuovo.");
  return avvisi;
}

/**
 * Prepara in `nuova` la versione registrata nel repository del progetto, e la prova.
 * Se qualcosa non va la cartella viene tolta, e il motivo dice a chi sviluppa che cosa correggere.
 */
export async function preparaVersione(opzioni: OpzioniPreparazione): Promise<EsitoPreparazione> {
  const { progetto, installata, nuova } = opzioni;
  const ramo = opzioni.ramo ?? "main";
  const no = async (motivo: string): Promise<EsitoPreparazione> => {
    await rm(nuova, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
    return { pronta: false, motivo };
  };

  const stato = await git(progetto, ["status", "--porcelain"]);
  if (stato.codice !== 0) return no(`La cartella del progetto non è un repository Git che si possa leggere:\n${stato.uscita}`);
  if (stato.uscita !== "") {
    return no(
      "Nella cartella del progetto ci sono modifiche non registrate nel repository: si installa solo ciò che è registrato. " +
        `Registrale con un commit, oppure toglile, e richiedi l'installazione.\n${stato.uscita.split("\n").slice(0, 20).join("\n")}`,
    );
  }
  const testa = await git(progetto, ["rev-parse", "HEAD"]);
  if (testa.codice !== 0 || !/^[0-9a-f]{40,64}$/.test(testa.uscita)) return no("Il repository del progetto non ha ancora nessuna versione registrata.");
  const versione = testa.uscita;

  // Ciò che è arrivato nel repository da fuori deve stare dentro la versione: altrimenti installarla lo cancellerebbe.
  await git(progetto, ["fetch", "--quiet", "origin"]);
  const remoto = `refs/remotes/origin/${ramo}`;
  if ((await git(progetto, ["rev-parse", "--verify", "--quiet", remoto])).codice === 0) {
    if ((await git(progetto, ["merge-base", "--is-ancestor", remoto, versione])).codice !== 0) {
      return no(
        `Nel repository di Shinka, sul ramo ${ramo}, ci sono modifiche che questa versione non contiene. ` +
          `Uniscile (git pull origin ${ramo}), riprova i test e richiedi l'installazione.`,
      );
    }
  }

  const inFunzione = await versioneDi(installata);
  if (inFunzione === versione) return no(`La versione ${inBreve(versione)} è già quella in funzione: non c'è nulla da installare.`);

  // La copia pulita: ciò che il repository ha registrato in quella versione, e nient'altro.
  await rm(nuova, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  await mkdir(nuova, { recursive: true });
  const indice = join(tmpdir(), `shinka-indice-${process.pid}-${Date.now()}`);
  const conIndice = { ...process.env, GIT_INDEX_FILE: indice };
  try {
    const letta = await git(progetto, ["read-tree", versione], conIndice);
    const estratta = letta.codice === 0 ? await git(progetto, ["checkout-index", "--all", "--force", `--prefix=${nuova.replace(/\\/g, "/")}/`], conIndice) : letta;
    if (estratta.codice !== 0) return no(`Non è stato possibile estrarre la versione dal repository:\n${estratta.uscita}`);
  } finally {
    await rm(indice, { force: true }).catch(() => {});
  }
  await writeFile(join(nuova, FILE_VERSIONE), `${JSON.stringify({ versione, preparataIl: new Date().toISOString() }, null, 2)}\n`);

  // Le dipendenze: se non sono cambiate valgono quelle della versione in funzione.
  const stesseDipendenze =
    existsSync(join(installata, "node_modules")) && (await stessoFile(join(installata, "package-lock.json"), join(nuova, "package-lock.json")));
  if (stesseDipendenze) {
    await cp(join(installata, "node_modules"), join(nuova, "node_modules"), { recursive: true, verbatimSymlinks: true });
  }
  const passi = [...(stesseDipendenze ? [] : [opzioni.dipendenze ?? DIPENDENZE]), ...(opzioni.passi ?? PASSI)];
  for (const passo of passi) {
    const esito = await esegui(passo, nuova);
    if (esito.scaduto) return no(`Il passo "${passo.nome}" (${passo.comando}) è stato fermato dopo ${passo.secondi} secondi.\n${esito.uscita}`);
    if (esito.codice !== 0) {
      return no(`Il passo "${passo.nome}" (${passo.comando}) non è riuscito, sulla copia pulita della versione ${inBreve(versione)}:\n${esito.uscita}`);
    }
  }

  // Che cosa cambia rispetto alla versione in funzione, se si sa qual è.
  const nota = inFunzione !== undefined && (await git(progetto, ["cat-file", "-e", `${inFunzione}^{commit}`])).codice === 0;
  const intervallo = nota ? [`${inFunzione}..${versione}`] : ["-n", String(MODIFICHE_MOSTRATE), versione];
  const registro = await git(progetto, ["log", "--format=%s", ...intervallo]);
  const modifiche = registro.codice === 0 && registro.uscita !== "" ? registro.uscita.split("\n") : [];
  let file: string[] = [];
  if (nota) {
    const cambiati = await git(progetto, ["diff", "--name-only", `${inFunzione}..${versione}`]);
    file = cambiati.codice === 0 && cambiati.uscita !== "" ? cambiati.uscita.split("\n") : [];
  }
  return {
    pronta: true,
    versione,
    modifiche: modifiche.slice(0, MODIFICHE_MOSTRATE),
    file: file.slice(0, FILE_MOSTRATI),
    quantiFile: file.length,
    avvisi: [
      ...(nota ? [] : ["Non è scritto quale versione sia in funzione adesso: l'elenco dei file cambiati non c'è."]),
      ...avvisiPer(file),
    ],
  };
}
