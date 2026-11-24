/**
 * Le skill al centro: una cartella che è insieme un repository Git e un plugin di Claude Code.
 * Ogni creazione e ogni modifica è un commit, così il proprietario ne vede la storia
 * e può tornare a com'era prima di una modifica.
 *
 *   <cartella>/.claude-plugin/plugin.json
 *   <cartella>/skills/<nome>/SKILL.md
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  componiSkill,
  CONTENUTO_SKILL_MASSIMO,
  DESCRIZIONE_SKILL_MASSIMA,
  FILE_SKILL,
  MANIFESTO_PLUGIN,
  MOTIVO_SKILL_MASSIMO,
  NOME_SKILL,
  scomponiSkill,
  type DettaglioSkill,
  type ModificaSkill,
  type SkillDistribuita,
  type StatoSkill,
  type TipoModifica,
  type VersioniSkill,
  type VoceSkill,
} from "../protocollo/skill.ts";
import { RIFIUTO_SEGRETO, sembraUnSegreto } from "./segreti.ts";

/** La skill non è stata salvata, e il messaggio dice perché in parole per chi l'ha proposta. */
export class SkillRifiutata extends Error {}

export interface SkillDaSalvare {
  nome: string;
  descrizione: string;
  contenuto: string;
  /** Perché nasce o perché cambia: finisce nella storia. */
  motivo: string;
}

type Ascoltatore = (stato: StatoSkill) => void;

const TIPI: readonly TipoModifica[] = ["creata", "modificata", "annullata"];
const SEPARATORE = "\x1f";
const FINE = "\x1e";

function git(cartella: string, argomenti: string[]): Promise<string> {
  return new Promise((risolvi, rifiuta) => {
    execFile(
      "git",
      // L'autore è sempre Shinka: il repository non deve dipendere da come è configurato Git nell'ambiente.
      ["-c", "user.name=Shinka", "-c", "user.email=shinka@localhost", "-c", "core.autocrlf=false", ...argomenti],
      { cwd: cartella, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (errore, uscita, errori) => {
        if (errore === null) risolvi(uscita);
        else rifiuta(new Error(errori.trim() || errore.message));
      },
    );
  });
}

export class RegistroSkill {
  /** La cartella delle skill: è anche il plugin che le conversazioni dell'ambiente del centro caricano. */
  readonly cartella: string;
  #voci: VoceSkill[] = [];
  /** I file delle skill come sono adesso, pronti per essere mandati a un nodo. */
  #file: SkillDistribuita[] = [];
  readonly #ascoltatori = new Set<Ascoltatore>();
  /** Le modifiche si fanno una alla volta: due commit insieme si pesterebbero i piedi. */
  #coda: Promise<unknown> = Promise.resolve();

  private constructor(cartella: string) {
    this.cartella = cartella;
  }

  static async apri(cartella: string): Promise<RegistroSkill> {
    await mkdir(join(cartella, ".claude-plugin"), { recursive: true });
    await mkdir(join(cartella, "skills"), { recursive: true });
    const manifesto = join(cartella, ".claude-plugin", "plugin.json");
    const registro = new RegistroSkill(cartella);
    if (!existsSync(join(cartella, ".git"))) {
      await writeFile(manifesto, MANIFESTO_PLUGIN);
      await git(cartella, ["init", "--quiet", "--initial-branch=main"]);
      await git(cartella, ["add", "-A"]);
      await git(cartella, ["commit", "--quiet", "-m", "Nasce il repository delle skill"]);
    } else if (!existsSync(manifesto)) {
      await writeFile(manifesto, MANIFESTO_PLUGIN);
    }
    await registro.#rileggi();
    return registro;
  }

  elenco(): VoceSkill[] {
    return this.#voci.map((voce) => ({ ...voce }));
  }

  stato(): StatoSkill {
    return { skill: this.elenco() };
  }

  /** Collega un ascoltatore: riceve subito l'elenco com'è, poi ogni cambiamento. */
  iscrivi(ascoltatore: Ascoltatore): () => void {
    ascoltatore(this.stato());
    return this.ascolta(ascoltatore);
  }

  /** Collega un ascoltatore ai soli cambiamenti. */
  ascolta(ascoltatore: Ascoltatore): () => void {
    this.#ascoltatori.add(ascoltatore);
    return () => this.#ascoltatori.delete(ascoltatore);
  }

  /** Tutte le skill con il loro file intero, come vanno mandate a un nodo. */
  daDistribuire(): SkillDistribuita[] {
    return this.#file.map((skill) => ({ ...skill }));
  }

  /** Una skill con la sua storia. Nulla se non esiste. */
  async leggi(nome: string): Promise<DettaglioSkill | undefined> {
    if (!NOME_SKILL.test(nome)) return undefined;
    const file = await this.#leggiFile(nome);
    const parti = file === undefined ? undefined : scomponiSkill(file);
    if (parti === undefined) return undefined;
    return { nome, ...parti, storia: await this.#storia(nome) };
  }

  /**
   * Crea una skill, o la sostituisce per intero se esiste già. Restituisce che cosa è successo;
   * `invariata` se il testo era già quello. Lancia `SkillRifiutata` se qualcosa non va.
   */
  salva(skill: SkillDaSalvare, origine: string): Promise<"creata" | "modificata" | "invariata"> {
    return this.#inCoda(async () => {
      const nome = skill.nome.trim();
      const descrizione = skill.descrizione.replace(/\s+/g, " ").trim();
      const contenuto = skill.contenuto.replace(/\r\n/g, "\n").trim();
      const motivo = skill.motivo.replace(/\s+/g, " ").trim().slice(0, MOTIVO_SKILL_MASSIMO);
      if (!NOME_SKILL.test(nome)) {
        throw new SkillRifiutata(
          `"${nome}" non va bene come nome: servono da 2 a 48 caratteri tra lettere minuscole, cifre e trattini.`,
        );
      }
      if (descrizione === "" || descrizione.length > DESCRIZIONE_SKILL_MASSIMA) {
        throw new SkillRifiutata(
          `Serve una descrizione di ${DESCRIZIONE_SKILL_MASSIMA} caratteri al massimo, che dica quando usare la skill.`,
        );
      }
      if (contenuto === "" || contenuto.length > CONTENUTO_SKILL_MASSIMO) {
        throw new SkillRifiutata(
          `Serve il testo della skill, di ${CONTENUTO_SKILL_MASSIMO} caratteri al massimo.`,
        );
      }
      if (sembraUnSegreto(`${descrizione}\n${contenuto}`)) throw new SkillRifiutata(RIFIUTO_SEGRETO);

      const file = componiSkill(nome, descrizione, contenuto);
      const prima = await this.#leggiFile(nome);
      if (prima === file) return "invariata";
      const tipo: TipoModifica = prima === undefined ? "creata" : "modificata";
      await mkdir(join(this.cartella, "skills", nome), { recursive: true });
      await writeFile(this.#percorso(nome), file);
      await this.#commit(nome, tipo, motivo === "" ? "nessun motivo indicato" : motivo, origine);
      return tipo;
    });
  }

  /** Com'era la skill prima e dopo una modifica della sua storia. Nulla se la modifica non è sua. */
  async versioni(nome: string, idModifica: string): Promise<VersioniSkill | undefined> {
    if (!(await this.#nellaStoria(nome, idModifica))) return undefined;
    const prima = await this.#versione(`${idModifica}^`, nome);
    const dopo = await this.#versione(idModifica, nome);
    return { ...(prima === undefined ? {} : { prima }), ...(dopo === undefined ? {} : { dopo }) };
  }

  /**
   * Annulla una modifica: la skill torna a com'era subito prima, e ciò che è venuto dopo si perde
   * dal testo ma resta nella storia. Annullare la creazione toglie la skill.
   * Restituisce falso se la modifica non appartiene alla storia di quella skill.
   */
  annulla(nome: string, idModifica: string, origine: string): Promise<boolean> {
    return this.#inCoda(async () => {
      const storia = await this.#storia(nome);
      const modifica = storia.find((voce) => voce.id === idModifica);
      if (modifica === undefined) return false;
      let prima: string | undefined;
      try {
        prima = await git(this.cartella, ["show", `${idModifica}^:skills/${nome}/${FILE_SKILL}`]);
      } catch {
        prima = undefined;
      }
      const adesso = await this.#leggiFile(nome);
      if (prima === adesso) return true;
      if (prima === undefined) {
        await rm(join(this.cartella, "skills", nome), { recursive: true, force: true });
      } else {
        await mkdir(join(this.cartella, "skills", nome), { recursive: true });
        await writeFile(this.#percorso(nome), prima);
      }
      const giorno = modifica.quando.slice(0, 10);
      await this.#commit(
        nome,
        "annullata",
        prima === undefined ? `tolta la skill, creata il ${giorno}` : `tornata a com'era prima della modifica del ${giorno}`,
        origine,
      );
      return true;
    });
  }

  #percorso(nome: string): string {
    return join(this.cartella, "skills", nome, FILE_SKILL);
  }

  async #leggiFile(nome: string): Promise<string | undefined> {
    try {
      return await readFile(this.#percorso(nome), "utf8");
    } catch {
      return undefined;
    }
  }

  async #versione(revisione: string, nome: string): Promise<{ descrizione: string; contenuto: string } | undefined> {
    try {
      return scomponiSkill(await git(this.cartella, ["show", `${revisione}:skills/${nome}/${FILE_SKILL}`]));
    } catch {
      return undefined;
    }
  }

  async #nellaStoria(nome: string, idModifica: string): Promise<boolean> {
    if (!NOME_SKILL.test(nome) || !/^[0-9a-f]{40}$/.test(idModifica)) return false;
    return (await this.#storia(nome)).some((voce) => voce.id === idModifica);
  }

  async #commit(nome: string, tipo: TipoModifica, motivo: string, origine: string): Promise<void> {
    await git(this.cartella, ["add", "-A", "--", "skills"]);
    await git(this.cartella, ["commit", "--quiet", "-m", `${tipo} ${nome}: ${motivo}`, "-m", `Origine: ${origine}`]);
    await this.#rileggi();
    const stato = this.stato();
    for (const ascoltatore of this.#ascoltatori) ascoltatore(stato);
  }

  /** La storia di una skill, dalla modifica più recente. */
  async #storia(nome: string): Promise<ModificaSkill[]> {
    if (!NOME_SKILL.test(nome)) return [];
    let uscita: string;
    try {
      uscita = await git(this.cartella, [
        "log",
        `--format=%H${SEPARATORE}%aI${SEPARATORE}%s${SEPARATORE}%b${FINE}`,
        "--",
        `skills/${nome}/${FILE_SKILL}`,
      ]);
    } catch {
      return [];
    }
    const storia: ModificaSkill[] = [];
    for (const blocco of uscita.split(FINE)) {
      const [id, quando, soggetto, corpo] = blocco.trim().split(SEPARATORE);
      if (id === undefined || quando === undefined || soggetto === undefined) continue;
      const trovato = /^(\S+) \S+: (.*)$/.exec(soggetto);
      const tipo = TIPI.find((t) => t === trovato?.[1]) ?? "modificata";
      storia.push({
        id,
        quando,
        tipo,
        motivo: trovato?.[2] ?? soggetto,
        origine: /^Origine: (.+)$/m.exec(corpo ?? "")?.[1] ?? "",
      });
    }
    return storia;
  }

  async #rileggi(): Promise<void> {
    const voci: VoceSkill[] = [];
    const letti: SkillDistribuita[] = [];
    let nomi: string[] = [];
    try {
      nomi = (await readdir(join(this.cartella, "skills"), { withFileTypes: true }))
        .filter((voce) => voce.isDirectory() && NOME_SKILL.test(voce.name))
        .map((voce) => voce.name);
    } catch {
      nomi = [];
    }
    for (const nome of nomi.sort()) {
      const file = await this.#leggiFile(nome);
      const parti = file === undefined ? undefined : scomponiSkill(file);
      if (file === undefined || parti === undefined) continue;
      letti.push({ nome, file });
      const storia = await this.#storia(nome);
      voci.push({
        nome,
        descrizione: parti.descrizione,
        // Senza storia nel repository vale la data del file: «adesso» la farebbe nuova a ogni rilettura.
        modificataIl: storia[0]?.quando ?? (await dataDelFile(this.#percorso(nome))),
        modifiche: storia.length,
      });
    }
    this.#voci = voci;
    this.#file = letti;
  }

  #inCoda<T>(lavoro: () => Promise<T>): Promise<T> {
    const esito = this.#coda.then(lavoro);
    this.#coda = esito.catch(() => {});
    return esito;
  }
}

/** Quando un file è stato cambiato l'ultima volta; l'inizio del 1970 se non si sa, così non risulta nuovo. */
async function dataDelFile(percorso: string): Promise<string> {
  try {
    return (await stat(percorso)).mtime.toISOString();
  } catch {
    return new Date(0).toISOString();
  }
}
