/**
 * Le fotografie dei file di un progetto: com'erano tutti in un certo momento. Dal confronto tra
 * due fotografie si sa che cosa è cambiato nel mezzo, chiunque l'abbia cambiato: così nel pannello
 * Modifiche entrano anche i file cambiati dai comandi, con la versione di prima.
 *
 * Le tiene un deposito Git a parte, tra i dati di Shinka: è Git a sapere quali file sono cambiati
 * senza rileggerli tutti, e a lasciare fuori ciò che il progetto gli fa ignorare. Il repository del
 * progetto, se c'è, non viene toccato. Se nell'ambiente Git manca, o il progetto è troppo grande,
 * le fotografie non si fanno, e lo si dice.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { access, constants, lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { CARTELLE_SALTATE } from "../protocollo/file-progetto.ts";
import { FILE_MASSIMO, type FileDeiComandi } from "../protocollo/modifiche.ts";

/** Una fotografia: l'albero di Git che la tiene, e ciò che non vi è entrato. */
export interface Fotografia {
  albero: string;
  /** I percorsi lasciati fuori perché troppo grandi, illeggibili, o perché non sono file normali. */
  saltati: ReadonlySet<string>;
  /** L'impronta delle regole su che cosa ignorare, per come le conosce Shinka. */
  regole: string;
  /** Quando è stata scattata. */
  quando: number;
}

/** Un file cambiato tra due fotografie, con il testo che aveva nella prima: null se non c'era. */
export interface FileFotografato {
  /** Relativo alla cartella del progetto, con le barre in avanti. */
  percorso: string;
  prima: string | null;
}

export interface CambiatiTraLeFoto {
  file: FileFotografato[];
  /** Quanti altri file sono cambiati senza che se ne tenga la versione: erano troppi. */
  altri: number;
}

export interface LimitiDelleFotografie {
  /** Oltre questi file da guardare in una volta, il progetto è troppo grande. */
  candidati: number;
  /** Oltre questi byte da copiare in una volta, il progetto è troppo grande. */
  byte: number;
  /** Di quanti file cambiati tra due fotografie si tiene la versione di prima. */
  file: number;
  /** Quanti byte di versioni di prima si leggono in una volta. */
  byteDiPrima: number;
  /** Quanto può durare un comando di Git. */
  attesaMs: number;
  /** Oltre quanti oggetti sparsi il deposito viene riordinato. */
  oggettiSparsi: number;
}

const LIMITI: LimitiDelleFotografie = { candidati: 60_000, byte: 300 * 1024 * 1024, file: 300, byteDiPrima: 32 * 1024 * 1024, attesaMs: 20_000, oggettiSparsi: 2000 };

/** Dopo quanti scatti falliti di fila si smette di provare. */
const FALLIMENTI_TOLLERATI = 3;

/** Quanto può scrivere un comando di Git prima che lo si fermi. */
const USCITA_MASSIMA = 96 * 1024 * 1024;

/**
 * Le scelte di Git che non devono dipendere dalla macchina: il testo entra ed esce com'è, senza
 * cambiare i fine riga, e Git non riordina il deposito da sé.
 */
const SCELTE = [
  ["core.autocrlf", "false"],
  ["core.safecrlf", "false"],
  ["core.fsmonitor", "false"],
  ["core.untrackedCache", "false"],
  ["core.quotePath", "false"],
  ["core.longpaths", "true"],
  // Copiare in fretta conta più che occupare poco: il riordino poi raccoglie tutto.
  ["core.looseCompression", "1"],
  ["gc.auto", "0"],
].flatMap(([nome, valore]) => ["-c", `${nome}=${valore}`]);

/** Nessun filtro e nessuna conversione, qualunque cosa dicano i `.gitattributes` del progetto. */
const ATTRIBUTI = "* -text -filter -ident -working-tree-encoding\n";

const FILE_NORMALE = new Set(["100644", "100755"]);

class Rinuncia extends Error {}

export class Fotografo {
  readonly #progetto: string;
  readonly #deposito: string;
  readonly #limiti: LimitiDelleFotografie;
  readonly #eseguibile: string;
  readonly #alStato: ((stato: FileDeiComandi) => void) | undefined;
  /** Un'operazione alla volta: il deposito ha un indice solo. */
  #coda: Promise<unknown> = Promise.resolve();
  #preparato = false;
  #regoleScritte: string | undefined;
  #fallimenti = 0;
  #stato: FileDeiComandi | undefined;

  constructor(
    cartellaProgetto: string,
    deposito: string,
    opzioni: { limiti?: Partial<LimitiDelleFotografie>; eseguibile?: string; alStato?: (stato: FileDeiComandi) => void } = {},
  ) {
    this.#progetto = resolve(cartellaProgetto);
    this.#deposito = resolve(deposito);
    this.#limiti = { ...LIMITI, ...opzioni.limiti };
    this.#eseguibile = opzioni.eseguibile ?? "git";
    this.#alStato = opzioni.alStato;
  }

  /** Se i file cambiati dai comandi si vedono, per ciò che si sa finora. */
  get stato(): FileDeiComandi | undefined {
    return this.#stato;
  }

  /** Fotografa i file del progetto. Non fallisce: se non si può, non c'è fotografia. */
  scatta(): Promise<Fotografia | undefined> {
    return this.#inCoda(() => this.#scatta());
  }

  /**
   * Che cosa è cambiato da quella fotografia a adesso: scatta la seconda e le confronta. Va chiesto
   * appena il turno finisce: le operazioni chieste dopo aspettano questa.
   */
  cambiatiDa(prima: Promise<Fotografia | undefined>): Promise<CambiatiTraLeFoto | undefined> {
    return this.#inCoda(async () => {
      const iniziale = await prima.catch(() => undefined);
      if (iniziale === undefined) return undefined;
      const finale = await this.#scatta();
      if (finale === undefined) return undefined;
      try {
        return await this.#confronta(iniziale, finale);
      } catch {
        return undefined;
      } finally {
        await this.#riordina();
      }
    });
  }

  #inCoda<T>(lavoro: () => Promise<T>): Promise<T> {
    const esito = this.#coda.then(lavoro, lavoro);
    this.#coda = esito.catch(() => {});
    return esito;
  }

  async #scatta(): Promise<Fotografia | undefined> {
    if (this.#fallimenti >= FALLIMENTI_TOLLERATI) return undefined;
    try {
      const foto = await this.#fotografa();
      this.#fallimenti = 0;
      this.#dichiara({ guardati: true });
      return foto;
    } catch (errore) {
      const manca = errore instanceof Error && "code" in errore && errore.code === "ENOENT";
      // Ciò che non cambierà da solo non si riprova: Git che manca, un progetto troppo grande.
      this.#fallimenti = manca || errore instanceof Rinuncia ? FALLIMENTI_TOLLERATI : this.#fallimenti + 1;
      if (this.#fallimenti >= FALLIMENTI_TOLLERATI) {
        const motivo = manca ? "in questo ambiente manca Git" : errore instanceof Error ? errore.message : String(errore);
        this.#dichiara({ guardati: false, motivo: motivo.slice(0, 300) });
      }
      return undefined;
    }
  }

  #dichiara(stato: FileDeiComandi): void {
    if (JSON.stringify(this.#stato) === JSON.stringify(stato)) return;
    this.#stato = stato;
    this.#alStato?.(stato);
  }

  async #fotografa(): Promise<Fotografia> {
    const quando = Date.now();
    if (!existsSync(this.#progetto)) throw new Error("la cartella del progetto non c'è");
    await this.#prepara();
    const regole = await this.#scriviLeRegole();
    // Un comando di Git fermato a metà lascia l'indice bloccato: qui lavora uno solo alla volta.
    await rm(join(this.#deposito, "index.lock"), { force: true });
    const elenco = await this.#git(["ls-files", "-z", "--modified", "--others", "--deleted", "--exclude-standard"]);
    const candidati = [...new Set(elenco.toString("utf8").split("\0").filter((voce) => voce !== ""))];
    if (candidati.length > this.#limiti.candidati) throw new Rinuncia(`il progetto ha troppi file da guardare (più di ${this.#limiti.candidati})`);

    const daTenere: string[] = [];
    const daTogliere: string[] = [];
    const saltati = new Set<string>();
    let byte = 0;
    const A_GRUPPI = 128;
    for (let da = 0; da < candidati.length; da += A_GRUPPI) {
      const gruppo = candidati.slice(da, da + A_GRUPPI);
      const giudizi = await Promise.all(gruppo.map((percorso) => this.#giudica(percorso)));
      for (const [posizione, giudizio] of giudizi.entries()) {
        const percorso = (gruppo[posizione] ?? "").replace(/\/+$/, "");
        if (giudizio === "manca") daTogliere.push(percorso);
        else if (giudizio === "saltato") saltati.add(percorso);
        else {
          daTenere.push(percorso);
          byte += giudizio;
        }
      }
      if (byte > this.#limiti.byte) throw new Rinuncia("il progetto ha troppi dati da copiare: si possono far ignorare a Git le cartelle più pesanti");
    }
    if (daTenere.length + daTogliere.length > 0) {
      // La prima volta copia tutti i file del progetto: può volerci di più.
      await this.#git(["update-index", "-z", "--add", "--remove", "--stdin"], [...daTenere, ...daTogliere].map((percorso) => `${percorso}\0`).join(""), { attesaMs: this.#limiti.attesaMs * 2 });
    }
    // Ciò che era nella fotografia di prima e ora non si tiene più ne esce: vale come non guardato.
    if (saltati.size > 0) await this.#git(["update-index", "-z", "--force-remove", "--stdin"], [...saltati].map((percorso) => `${percorso}\0`).join(""));
    const albero = (await this.#git(["write-tree"])).toString("utf8").trim();
    if (!/^[0-9a-f]{40,64}$/.test(albero)) throw new Error("Git non ha dato la fotografia");
    return { albero, saltati, regole, quando };
  }

  /** Che fare di un percorso: quanti byte ha se si tiene, altrimenti perché no. */
  async #giudica(percorso: string): Promise<number | "manca" | "saltato"> {
    // Una cartella con un repository suo: Git la nomina con la barra in fondo, e non ci entra.
    if (percorso.endsWith("/")) return "saltato";
    const assoluto = join(this.#progetto, percorso);
    try {
      const dati = await lstat(assoluto);
      if (!dati.isFile() || dati.size > FILE_MASSIMO) return "saltato";
      await access(assoluto, constants.R_OK);
      return dati.size;
    } catch (errore) {
      return errore instanceof Error && "code" in errore && (errore.code === "ENOENT" || errore.code === "ENOTDIR") ? "manca" : "saltato";
    }
  }

  async #prepara(): Promise<void> {
    if (this.#preparato && existsSync(join(this.#deposito, "HEAD"))) return;
    if (!existsSync(join(this.#deposito, "HEAD"))) {
      await mkdir(this.#deposito, { recursive: true });
      await this.#git(["init", "--quiet", "--bare", this.#deposito], undefined, { fuori: true });
      this.#regoleScritte = undefined;
    }
    await mkdir(join(this.#deposito, "info"), { recursive: true });
    await writeFile(join(this.#deposito, "info", "attributes"), ATTRIBUTI);
    this.#preparato = true;
  }

  /**
   * Che cosa ignorare oltre ai `.gitignore` del progetto, che Git legge da sé: le regole che il
   * progetto tiene nel suo repository senza registrarle; e, per un progetto che a Git non dice
   * nulla, le cartelle delle dipendenze e di ciò che si costruisce. Restituisce la loro impronta.
   */
  async #scriviLeRegole(): Promise<string> {
    const righe: string[] = [];
    try {
      righe.push(await readFile(join(this.#progetto, ".git", "info", "exclude"), "utf8"));
    } catch {
      // Non è un repository, o non ha regole sue.
    }
    if (!existsSync(join(this.#progetto, ".git")) && !existsSync(join(this.#progetto, ".gitignore"))) {
      righe.push(...[...CARTELLE_SALTATE].filter((nome) => nome !== ".git").map((nome) => `${nome}/`));
    }
    const regole = `${righe.join("\n")}\n`;
    if (regole !== this.#regoleScritte) {
      await writeFile(join(this.#deposito, "info", "exclude"), regole);
      this.#regoleScritte = regole;
    }
    return createHash("sha1").update(regole).digest("hex");
  }

  async #confronta(prima: Fotografia, dopo: Fotografia): Promise<CambiatiTraLeFoto> {
    if (prima.albero === dopo.albero) return { file: [], altri: 0 };
    const grezzo = (await this.#git(["diff-tree", "-r", "-z", "--raw", "--no-renames", "--no-abbrev", prima.albero, dopo.albero])).toString("utf8").split("\0");
    let voci: { percorso: string; prima: string | undefined }[] = [];
    let regoleCambiate = prima.regole !== dopo.regole;
    for (let posizione = 0; posizione + 1 < grezzo.length; posizione += 2) {
      const [modoPrima, modoDopo, idPrima, idDopo, stato] = (grezzo[posizione] ?? "").replace(/^:/, "").split(" ");
      const percorso = grezzo[posizione + 1] ?? "";
      if (percorso === "" || stato === undefined || idPrima === undefined || idPrima === idDopo) continue;
      if (basename(percorso) === ".gitignore") regoleCambiate = true;
      const nuovo = stato === "A";
      const tolto = stato === "D";
      // Un collegamento simbolico, o un repository dentro il progetto: non sono testo da riportare.
      if ((!nuovo && !FILE_NORMALE.has(modoPrima ?? "")) || (!tolto && !FILE_NORMALE.has(modoDopo ?? ""))) continue;
      voci.push({ percorso, prima: nuovo ? undefined : idPrima });
    }
    // Un file che nella prima fotografia non c'era è nuovo solo se allora non era stato lasciato fuori.
    voci = voci.filter((voce) => voce.prima !== undefined || !lasciatoFuori(voce.percorso, prima.saltati));
    if (regoleCambiate) {
      // Se nel mezzo sono cambiate le regole, un file può comparire solo perché non è più ignorato:
      // nuovo è quello nato, o arrivato lì, dopo la prima fotografia.
      const nati = await Promise.all(voci.map(async (voce) => voce.prima !== undefined || (await this.#natoDopo(voce.percorso, prima.quando))));
      voci = voci.filter((_, posizione) => nati[posizione]);
    }
    voci.sort((a, b) => (a.percorso < b.percorso ? -1 : a.percorso > b.percorso ? 1 : 0));
    let altri = Math.max(0, voci.length - this.#limiti.file);
    voci = voci.slice(0, this.#limiti.file);

    // Quanto pesano le versioni di prima: se ne legge finché ci stanno.
    const daLeggere = [...new Set(voci.flatMap((voce) => (voce.prima === undefined ? [] : [voce.prima])))];
    const pesi = new Map<string, number>();
    if (daLeggere.length > 0) {
      const righe = (await this.#git(["cat-file", "--batch-check"], daLeggere.map((id) => `${id}\n`).join(""))).toString("utf8").split("\n");
      for (const riga of righe) {
        const [id, tipo, peso] = riga.split(" ");
        if (id !== undefined && tipo === "blob" && peso !== undefined) pesi.set(id, Number(peso));
      }
    }
    let byte = 0;
    const scelte: typeof voci = [];
    for (const voce of voci) {
      const peso = voce.prima === undefined ? 0 : pesi.get(voce.prima);
      if (peso === undefined) continue;
      if (byte + peso > this.#limiti.byteDiPrima) {
        altri += 1;
        continue;
      }
      byte += peso;
      scelte.push(voce);
    }
    const testi = await this.#leggi([...new Set(scelte.flatMap((voce) => (voce.prima === undefined ? [] : [voce.prima])))]);
    const file: FileFotografato[] = [];
    for (const voce of scelte) {
      if (voce.prima === undefined) {
        file.push({ percorso: voce.percorso, prima: null });
        continue;
      }
      const testo = testi.get(voce.prima);
      // Ciò che non è testo non si mostra e non si riporta.
      if (testo !== undefined) file.push({ percorso: voce.percorso, prima: testo });
    }
    return { file, altri };
  }

  /** Il testo di questi oggetti del deposito; quelli che non sono testo mancano. */
  async #leggi(id: readonly string[]): Promise<Map<string, string>> {
    const testi = new Map<string, string>();
    if (id.length === 0) return testi;
    const uscita = await this.#git(["cat-file", "--batch"], id.map((voce) => `${voce}\n`).join(""));
    let posizione = 0;
    while (posizione < uscita.length) {
      const fineRiga = uscita.indexOf(10, posizione);
      if (fineRiga === -1) break;
      const [oggetto, tipo, peso] = uscita.subarray(posizione, fineRiga).toString("utf8").split(" ");
      posizione = fineRiga + 1;
      // Di un oggetto che manca Git scrive una riga sola.
      if (oggetto === undefined || tipo === "missing" || peso === undefined) continue;
      const lungo = Number(peso);
      if (!Number.isInteger(lungo) || lungo < 0) break;
      const contenuto = uscita.subarray(posizione, posizione + lungo);
      posizione += lungo + 1;
      if (tipo === "blob" && !contenuto.includes(0)) testi.set(oggetto, contenuto.toString("utf8"));
    }
    return testi;
  }

  async #natoDopo(percorso: string, quando: number): Promise<boolean> {
    try {
      // Il momento dell'ultimo cambiamento dice anche quando un file è stato creato o spostato.
      return (await lstat(join(this.#progetto, percorso))).ctimeMs >= quando - 2000;
    } catch {
      return false;
    }
  }

  /**
   * Toglie dal deposito ciò che non serve più, quando ce n'è abbastanza: restano, raccolti insieme,
   * i file della fotografia più recente. Si fa solo a turno chiuso, quando nessuna fotografia è in uso.
   */
  async #riordina(): Promise<void> {
    try {
      const sparsi = Number((await this.#git(["count-objects"])).toString("utf8").split(" ")[0]);
      if (!(sparsi > this.#limiti.oggettiSparsi)) return;
      await this.#git(["gc", "--prune=now", "--quiet"], undefined, { attesaMs: 120_000 });
    } catch {
      // Riordinare può aspettare la prossima volta.
    }
  }

  #git(argomenti: readonly string[], ingresso?: string, opzioni: { fuori?: boolean; attesaMs?: number } = {}): Promise<Buffer> {
    const ambiente: NodeJS.ProcessEnv = { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" };
    // Ciò che l'ambiente dice a Git di un altro repository qui non vale.
    for (const nome of Object.keys(ambiente)) {
      if (/^GIT_(DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|COMMON_DIR|PREFIX)$/.test(nome)) delete ambiente[nome];
    }
    if (opzioni.fuori !== true) {
      ambiente.GIT_DIR = this.#deposito;
      ambiente.GIT_WORK_TREE = this.#progetto;
    }
    return new Promise((risolvi, rifiuta) => {
      const figlio = spawn(this.#eseguibile, [...SCELTE, ...argomenti], { cwd: this.#progetto, env: ambiente, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      const pezzi: Buffer[] = [];
      let scritti = 0;
      let errori = "";
      let finito = false;
      const chiudi = (errore?: Error): void => {
        if (finito) return;
        finito = true;
        clearTimeout(scadenza);
        if (errore === undefined) risolvi(Buffer.concat(pezzi));
        else rifiuta(errore);
      };
      const scadenza = setTimeout(() => {
        figlio.kill("SIGKILL");
        chiudi(new Error("Git non ha finito in tempo"));
      }, opzioni.attesaMs ?? this.#limiti.attesaMs);
      figlio.stdout.on("data", (pezzo: Buffer) => {
        scritti += pezzo.length;
        if (scritti > USCITA_MASSIMA) {
          figlio.kill("SIGKILL");
          chiudi(new Rinuncia("il progetto ha troppi file da guardare"));
          return;
        }
        pezzi.push(pezzo);
      });
      figlio.stderr.on("data", (pezzo: Buffer) => {
        if (errori.length < 2000) errori += pezzo.toString("utf8");
      });
      figlio.on("error", (errore) => chiudi(errore));
      figlio.on("close", (codice) => chiudi(codice === 0 ? undefined : new Error(errori.trim().split("\n")[0] || `Git è uscito con ${String(codice)}`)));
      figlio.stdin.on("error", () => {});
      figlio.stdin.end(ingresso ?? "");
    });
  }
}

/** Vero se il percorso, o una cartella che lo contiene, era stato lasciato fuori dalla fotografia. */
function lasciatoFuori(percorso: string, saltati: ReadonlySet<string>): boolean {
  if (saltati.size === 0) return false;
  const parti = percorso.split("/");
  for (let quante = 1; quante <= parti.length; quante += 1) {
    if (saltati.has(parti.slice(0, quante).join("/"))) return true;
  }
  return false;
}
