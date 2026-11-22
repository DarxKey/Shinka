/**
 * Il guardiano: il piccolo programma che tiene acceso il centro di Shinka e ne cambia la versione.
 * Lo stesso programma tiene acceso un nodo, su un'altra macchina: cambia solo come si avvia chi
 * tiene acceso e come si capisce che la versione nuova è partita.
 *
 * Quando il proprietario approva un'installazione, il centro scrive che cosa va installato e si
 * spegne. Il guardiano mette la versione nuova al posto di quella in funzione, la avvia e aspetta
 * che risponda: se non parte, rimette quella di prima e lo annota. Le cartelle le sposta solo lui.
 *
 * Non usa nulla del resto di Shinka, solo ciò che Node ha di suo: gira da una copia che
 * un'installazione non tocca, così una versione sbagliata non può rompere chi la toglie.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

/** Il codice con cui il centro esce quando chiede di essere riavviato, e non di spegnersi. */
export const CODICE_RIAVVIO = 75;
/**
 * Il codice con cui il nodo si chiude quando il centro lo rifiuta o lo ha rimosso: chi lo tiene
 * acceso da fuori (il servizio di systemd scritto dalla preparazione) non lo fa ripartire, perché
 * ricomparirebbe ogni volta tra le richieste in attesa.
 */
export const CODICE_RIFIUTATO = 78;

/** Il file, tra i dati del centro, in cui centro e guardiano si dicono a che punto è un'installazione. */
export const FILE_INSTALLAZIONE = "installazione.json";

/** Quante versioni di prima restano, per tornare indietro a mano. */
export const VERSIONI_TENUTE = 3;

/** Il file, tra i dati di un nodo, in cui il nodo scrive con quale versione si è collegato al centro. */
export const FILE_COLLEGATO = "collegato.json";

/** Vero se il nodo ha scritto di essersi collegato al centro con quella versione. */
export function nodoCollegato(file: string, versione: string | undefined): boolean {
  if (versione === undefined) return false;
  try {
    const letto = JSON.parse(readFileSync(file, "utf8")) as { versione?: unknown };
    return letto.versione === versione;
  } catch {
    return false;
  }
}

export type FaseInstallazione =
  /** Il proprietario ha approvato: la versione nuova è pronta, e aspetta il guardiano. */
  | "da-installare"
  /** La versione nuova è al suo posto, ma non ha ancora risposto. */
  | "in-prova"
  /** La versione nuova ha risposto: è quella in funzione. */
  | "confermata"
  /** La versione nuova non è partita: è tornata quella di prima. */
  | "tornata-indietro";

export interface Installazione {
  fase: FaseInstallazione;
  /** La versione, come la conosce il repository di Shinka. */
  versione: string;
  /** Che cosa cambia, nelle parole mostrate al proprietario. */
  riassunto: string;
  /** Quando il proprietario ha approvato. */
  quando: string;
  /** La cartella con la versione nuova, provata e pronta. Vale finché la fase è "da-installare". */
  nuova?: string;
  /** Dove è finita la versione di prima. */
  precedente?: string;
  /** Quante volte la versione nuova è stata avviata senza arrivare a rispondere. */
  tentativi?: number;
  /** Perché si è tornati indietro. */
  motivo?: string;
  /** Vero da quando il centro lo ha detto al proprietario. */
  riferita?: boolean;
  /** I nodi collegati al centro quando il proprietario ha approvato: dopo l'installazione si aggiornano anche loro. */
  nodi?: string[];
}

/** Legge lo stato dell'installazione; nulla se non ce n'è una, o se il file non si legge. */
export function leggiInstallazione(file: string): Installazione | undefined {
  try {
    const letto = JSON.parse(readFileSync(file, "utf8")) as Installazione;
    return typeof letto === "object" && letto !== null && typeof letto.fase === "string" ? letto : undefined;
  } catch {
    return undefined;
  }
}

export async function scriviInstallazione(file: string, installazione: Installazione): Promise<void> {
  const provvisorio = `${file}.tmp`;
  await writeFile(provvisorio, `${JSON.stringify(installazione, null, 2)}\n`);
  await rename(provvisorio, file);
}

/** Un nome che mette le cartelle in ordine di tempo: 20261112-153000. */
function marca(adesso: number): string {
  return new Date(adesso).toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
}

/** Su Windows una cartella appena lasciata da un processo può restare occupata per un attimo. */
async function sposta(da: string, a: string): Promise<void> {
  for (let prova = 0; ; prova += 1) {
    try {
      await rename(da, a);
      return;
    } catch (errore) {
      const codice = errore instanceof Error && "code" in errore ? errore.code : undefined;
      if (prova >= 10 || (codice !== "EPERM" && codice !== "EBUSY" && codice !== "EACCES")) throw errore;
      await new Promise((fatto) => setTimeout(fatto, 300));
    }
  }
}

/**
 * Mette la versione nuova al posto di quella in funzione, e dice dove è finita quella di prima.
 * Se la nuova non si riesce a mettere, quella di prima torna dov'era.
 */
export async function scambia(installata: string, nuova: string, adesso: number = Date.now()): Promise<string> {
  if (!existsSync(nuova)) throw new Error("La cartella con la versione nuova non c'è più.");
  const precedente = `${installata}-prima-${marca(adesso)}`;
  await sposta(installata, precedente);
  try {
    await sposta(nuova, installata);
  } catch (errore) {
    await sposta(precedente, installata);
    throw errore;
  }
  return precedente;
}

/** Toglie la versione che non è partita e rimette quella di prima. Dice dove è finita quella tolta. */
export async function tornaIndietro(installata: string, precedente: string, adesso: number = Date.now()): Promise<string> {
  if (!existsSync(precedente)) throw new Error("La versione di prima non c'è più: non si può tornare indietro.");
  const scartata = `${installata}-scartata-${marca(adesso)}`;
  await sposta(installata, scartata);
  await sposta(precedente, installata);
  return scartata;
}

/**
 * Tiene le ultime versioni di prima e l'ultima scartata, e toglie le più vecchie. Tocca solo le
 * cartelle che ha fatto lui, riconoscibili dal nome: le altre copie restano dove sono.
 */
export async function sfoltisci(installata: string, tenute: number = VERSIONI_TENUTE): Promise<string[]> {
  const dove = dirname(installata);
  const nome = basename(installata);
  let voci: string[];
  try {
    voci = (await readdir(dove, { withFileTypes: true })).filter((voce) => voce.isDirectory()).map((voce) => voce.name);
  } catch {
    return [];
  }
  const tolte: string[] = [];
  const togli = async (prefisso: string, quante: number): Promise<void> => {
    const sue = voci.filter((voce) => voce.startsWith(prefisso) && /^\d{8}-\d{6}$/.test(voce.slice(prefisso.length))).sort();
    for (const vecchia of sue.slice(0, Math.max(sue.length - quante, 0))) {
      await rm(join(dove, vecchia), { recursive: true, force: true });
      tolte.push(vecchia);
    }
  };
  await togli(`${nome}-prima-`, tenute);
  await togli(`${nome}-scartata-`, 1);
  return tolte;
}

export interface OpzioniGuardiano {
  /** La cartella della versione in funzione: il centro si avvia da lì. */
  installata: string;
  /** Il file in cui centro e guardiano si dicono a che punto è un'installazione. */
  fileInstallazione: string;
  /** Come si avvia il centro: programma e argomenti, nella cartella della versione in funzione. */
  comando: { programma: string; argomenti: string[] };
  /** L'indirizzo a cui il centro deve rispondere perché una versione nuova valga come partita. */
  indirizzoDiProva?: string;
  /** Un altro modo di capire che la versione nuova è partita, per chi non risponde a un indirizzo: un nodo. */
  risponde?: () => Promise<boolean>;
  /** Quanto si aspetta che una versione nuova risponda. */
  attesaMs?: number;
  /** Ogni quanto si prova a chiederle se c'è. */
  pausaMs?: number;
  /** Ciò che il guardiano ha da dire: finisce nel registro del container. */
  scrivi?: (riga: string) => void;
  adesso?: () => number;
}

/** Come è finito il centro: il codice con cui è uscito, o il segnale che lo ha fermato. */
interface Uscita {
  codice: number | null;
  segnale: NodeJS.Signals | null;
}

/** Come si è spento un centro che nessuno ha fermato, in parole per il proprietario. */
function comeSiESpenta(uscita: Uscita): string {
  if (uscita.codice !== null) return `si è spenta da sola, con il codice ${uscita.codice}`;
  if (uscita.segnale !== null) return `si è spenta da sola, per il segnale ${uscita.segnale}`;
  return "si è spenta da sola";
}

export class Guardiano {
  readonly #o: OpzioniGuardiano;
  #figlio: ChildProcess | undefined;
  #spegnimento = false;

  constructor(opzioni: OpzioniGuardiano) {
    this.#o = opzioni;
  }

  /**
   * Tiene acceso il centro finché non si spegne da sé o non viene fermato, e restituisce il codice
   * con cui il guardiano deve uscire. Un'uscita con il codice di riavvio non lo ferma.
   */
  async avvia(): Promise<number> {
    for (;;) {
      if (this.#spegnimento) return 0;
      await this.#installaSeServe();
      if (this.#spegnimento) return 0;
      const inProva = leggiInstallazione(this.#o.fileInstallazione)?.fase === "in-prova";
      const uscita = await this.#tieniAcceso(inProva);
      if (this.#spegnimento) return uscita.codice ?? 0;
      const adesso = leggiInstallazione(this.#o.fileInstallazione);
      if (adesso?.fase === "in-prova") {
        await this.#indietro(adesso, uscita.motivo ?? comeSiESpenta(uscita));
        continue;
      }
      if (uscita.codice === CODICE_RIAVVIO) continue;
      return uscita.codice ?? 1;
    }
  }

  /** Ferma il centro e, con lui, il guardiano. */
  spegni(segnale: NodeJS.Signals = "SIGTERM"): void {
    this.#spegnimento = true;
    this.#figlio?.kill(segnale);
  }

  #scrivi(riga: string): void {
    (this.#o.scrivi ?? console.log)(`[guardiano] ${riga}`);
  }

  #adesso(): number {
    return this.#o.adesso?.() ?? Date.now();
  }

  /** Se c'è una versione approvata che aspetta, la mette al posto di quella in funzione. */
  async #installaSeServe(): Promise<void> {
    const { fileInstallazione, installata } = this.#o;
    const attesa = leggiInstallazione(fileInstallazione);
    if (attesa === undefined) return;
    if (attesa.fase === "in-prova") {
      // Il guardiano è stato riavviato a metà della prova: la versione nuova ha un'altra possibilità, una sola.
      const tentativi = (attesa.tentativi ?? 0) + 1;
      if (tentativi > 2) await this.#indietro(attesa, "non è arrivata a rispondere nemmeno al secondo avvio");
      else await scriviInstallazione(fileInstallazione, { ...attesa, tentativi });
      return;
    }
    if (attesa.fase !== "da-installare") return;
    const { nuova, ...resto } = attesa;
    try {
      if (nuova === undefined) throw new Error("Manca la cartella della versione nuova.");
      const precedente = await scambia(installata, nuova, this.#adesso());
      await scriviInstallazione(fileInstallazione, { ...resto, fase: "in-prova", precedente, tentativi: 1 });
      this.#scrivi(`Versione ${attesa.versione} messa al suo posto; quella di prima è in ${precedente}.`);
    } catch (errore) {
      const motivo = `non è stato possibile metterla al suo posto: ${errore instanceof Error ? errore.message : String(errore)}`;
      await scriviInstallazione(fileInstallazione, { ...resto, fase: "tornata-indietro", motivo });
      this.#scrivi(`Versione ${attesa.versione} non installata: ${motivo}`);
    }
  }

  async #indietro(attesa: Installazione, motivo: string): Promise<void> {
    const { fileInstallazione, installata } = this.#o;
    const { tentativi: _tentativi, ...resto } = attesa;
    let esito = motivo;
    try {
      if (attesa.precedente === undefined) throw new Error("Non è scritto dove sia la versione di prima.");
      const scartata = await tornaIndietro(installata, attesa.precedente, this.#adesso());
      this.#scrivi(`La versione ${attesa.versione} non è partita (${motivo}): è tornata quella di prima. Quella tolta è in ${scartata}.`);
    } catch (errore) {
      esito = `${motivo}; e non è stato possibile rimettere quella di prima: ${errore instanceof Error ? errore.message : String(errore)}`;
      this.#scrivi(`La versione ${attesa.versione} non è partita, e ${esito}`);
    }
    const { precedente: _precedente, ...senzaPrecedente } = resto;
    await scriviInstallazione(fileInstallazione, { ...senzaPrecedente, fase: "tornata-indietro", motivo: esito });
    await sfoltisci(installata).catch(() => {});
  }

  /** Avvia il centro e aspetta che esca. In prova, lo ferma se non risponde in tempo. */
  #tieniAcceso(inProva: boolean): Promise<Uscita & { motivo?: string }> {
    const { comando, installata } = this.#o;
    return new Promise((uscito) => {
      const figlio = spawn(comando.programma, comando.argomenti, {
        cwd: installata,
        stdio: "inherit",
        env: { ...process.env, SHINKA_GUARDIANO: "1" },
      });
      this.#figlio = figlio;
      let motivo: string | undefined;
      let prova: NodeJS.Timeout | undefined;
      let colpo: NodeJS.Timeout | undefined;
      const chiudi = (uscita: Uscita): void => {
        if (this.#figlio !== figlio) return;
        this.#figlio = undefined;
        clearTimeout(prova);
        clearTimeout(colpo);
        uscito({ ...uscita, ...(motivo === undefined ? {} : { motivo }) });
      };
      figlio.on("error", (errore) => {
        motivo = `non si è avviata: ${errore.message}`;
        chiudi({ codice: 1, segnale: null });
      });
      figlio.on("exit", (codice, segnale) => chiudi({ codice, segnale }));
      if (!inProva) return;

      const entro = this.#adesso() + (this.#o.attesaMs ?? 120_000);
      const chiedi = async (): Promise<void> => {
        if (this.#figlio !== figlio) return;
        if (await this.#risponde()) {
          await this.#confermata();
          return;
        }
        if (this.#adesso() >= entro) {
          motivo = "non ha risposto in tempo";
          figlio.kill("SIGTERM");
          // Se non si ferma con le buone, si ferma con le cattive.
          colpo = setTimeout(() => figlio.kill("SIGKILL"), 10_000);
          return;
        }
        prova = setTimeout(() => void chiedi(), this.#o.pausaMs ?? 1_000);
      };
      prova = setTimeout(() => void chiedi(), this.#o.pausaMs ?? 1_000);
    });
  }

  async #risponde(): Promise<boolean> {
    if (this.#o.risponde !== undefined) return this.#o.risponde().catch(() => false);
    if (this.#o.indirizzoDiProva === undefined) return false;
    try {
      const risposta = await fetch(this.#o.indirizzoDiProva, { signal: AbortSignal.timeout(3_000) });
      await risposta.arrayBuffer().catch(() => {});
      return risposta.status < 500;
    } catch {
      return false;
    }
  }

  async #confermata(): Promise<void> {
    const { fileInstallazione, installata } = this.#o;
    const attesa = leggiInstallazione(fileInstallazione);
    if (attesa?.fase !== "in-prova") return;
    const { tentativi: _tentativi, ...resto } = attesa;
    await scriviInstallazione(fileInstallazione, { ...resto, fase: "confermata" });
    this.#scrivi(`La versione ${attesa.versione} risponde: è quella in funzione.`);
    const tolte = await sfoltisci(installata).catch(() => []);
    if (tolte.length > 0) this.#scrivi(`Tolte le versioni più vecchie: ${tolte.join(", ")}.`);
  }
}
