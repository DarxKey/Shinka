/**
 * Le copie di sicurezza viste dal centro in funzione (ADR 0042): prepararne una da scaricare,
 * riceverne una caricata, aprirla con la sua password, portare qui memoria e skill, oppure chiedere
 * che al prossimo avvio i dati siano i suoi. Ciò che è in lavorazione sta nella cartella delle
 * copie, tra i dati: lì un ripristino trova la copia aperta, sullo stesso disco.
 */

import { randomBytes } from "node:crypto";
import { createWriteStream, existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  COPIA_MASSIMA,
  PASSWORD_DELLA_COPIA_MINIMA,
  type ContenutoDellaCopia,
  type CopiaCaricata,
  type CopiaPronta,
  type EsitoRipristino,
  type EsitoTrasloco,
  type ScelteDelTrasloco,
  type SkillNellaCopia,
  type StatoCopie,
} from "../protocollo/copia.ts";
import { FILE_SKILL, NOME_SKILL, scomponiSkill } from "../protocollo/skill.ts";
import { apriCopia, CARTELLA_DELLE_COPIE, CopiaNonValida, leggiTestata, scriviCopia, segnaIlRipristino, type TestataDellaCopia } from "./copia-di-sicurezza.ts";
import { testiDellaMemoria, VoceRifiutata, type Memoria } from "./memoria.ts";
import { SkillRifiutata, type RegistroSkill } from "./skill.ts";

/** Per quanto una copia preparata aspetta di essere scaricata. */
const ATTESA_DELLO_SCARICAMENTO_MS = 60 * 60_000;

/** La richiesta non si può fare, e il messaggio dice perché in parole per il proprietario. */
export class CopiaRifiutata extends Error {}

export interface OpzioniCopie {
  /** La cartella dei dati del centro. */
  dati: string;
  memoria: Memoria;
  skill: RegistroSkill;
  /** La versione di Shinka in funzione. */
  versione?: string;
  /** Come il centro riparte da solo; senza, dopo un ripristino lo riavvia il proprietario. */
  riavvia?: () => void;
  /** Dice se la cartella di un progetto dell'ambiente del centro c'è. */
  cartellaPresente?: (cartella: string) => boolean;
  adesso?: () => Date;
  /** Quanto costa ricavare la chiave: solo le prove lo abbassano. */
  costo?: number;
  /** Quanto può pesare una copia caricata. */
  massimo?: number;
}

interface Preparata extends CopiaPronta {
  percorso: string;
  scade: number;
}

export class CopieDiSicurezza {
  readonly #o: OpzioniCopie;
  readonly #base: string;
  #preparate = new Map<string, Preparata>();
  /** Un lavoro pesante alla volta: preparare, ricevere, aprire. */
  #occupata: string | undefined;
  #contenuto: ContenutoDellaCopia | undefined;
  #ripristinoChiesto = false;

  constructor(opzioni: OpzioniCopie) {
    this.#o = opzioni;
    this.#base = join(opzioni.dati, CARTELLA_DELLE_COPIE);
  }

  /** All'avvio: via ciò che una volta di prima ha lasciato a metà. */
  async riordina(): Promise<void> {
    await rm(join(this.#base, "da-scaricare"), { recursive: true, force: true });
    await rm(join(this.#base, "in-arrivo.shinka"), { force: true });
    // Una copia aperta senza che il ripristino sia stato chiesto resta: il proprietario può ancora decidere.
  }

  get #caricata(): string {
    return join(this.#base, "caricata.shinka");
  }

  get #aperta(): string {
    return join(this.#base, "aperta");
  }

  #adesso(): Date {
    return this.#o.adesso?.() ?? new Date();
  }

  async #solo<T>(che: string, lavoro: () => Promise<T>): Promise<T> {
    if (this.#occupata !== undefined) throw new CopiaRifiutata(`Shinka sta già ${this.#occupata}: aspetta che finisca.`);
    if (this.#ripristinoChiesto) throw new CopiaRifiutata("È stato chiesto un ripristino: Shinka sta per ripartire.");
    this.#occupata = che;
    try {
      return await lavoro();
    } finally {
      this.#occupata = undefined;
    }
  }

  /** Prepara una copia dei dati, cifrata con questa password, che il proprietario scarica subito dopo. */
  async prepara(password: string): Promise<CopiaPronta> {
    if (password.length < PASSWORD_DELLA_COPIA_MINIMA) {
      throw new CopiaRifiutata(`La password della copia deve avere almeno ${PASSWORD_DELLA_COPIA_MINIMA} caratteri.`);
    }
    return this.#solo("preparando una copia", async () => {
      const adesso = this.#adesso();
      // Una alla volta: quelle di prima, scaricate o no, non servono più.
      await rm(join(this.#base, "da-scaricare"), { recursive: true, force: true });
      this.#preparate.clear();
      const id = randomBytes(12).toString("hex");
      const percorso = join(this.#base, "da-scaricare", `${id}.shinka`);
      const scritta = await scriviCopia({
        dati: this.#o.dati,
        destinazione: percorso,
        password,
        adesso,
        ...(this.#o.versione === undefined ? {} : { versione: this.#o.versione }),
        ...(this.#o.costo === undefined ? {} : { costo: this.#o.costo }),
      });
      const giorno = adesso.toISOString().slice(0, 16).replace("T", "-").replace(":", "");
      const pronta: Preparata = { id, nome: `shinka-copia-${giorno}.shinka`, byte: scritta.byte, file: scritta.file, saltati: scritta.saltati.slice(0, 50), percorso, scade: adesso.getTime() + ATTESA_DELLO_SCARICAMENTO_MS };
      this.#preparate.set(id, pronta);
      return { id, nome: pronta.nome, byte: pronta.byte, file: pronta.file, saltati: pronta.saltati };
    });
  }

  /** Il file di una copia preparata, finché non scade. */
  daScaricare(id: string): { percorso: string; nome: string; byte: number } | undefined {
    const pronta = this.#preparate.get(id);
    if (pronta === undefined || pronta.scade < this.#adesso().getTime() || !existsSync(pronta.percorso)) return undefined;
    return { percorso: pronta.percorso, nome: pronta.nome, byte: pronta.byte };
  }

  /** Le copie preparate che nessuno ha più tempo di scaricare lasciano il server. */
  async #sfoltisci(): Promise<void> {
    for (const [id, pronta] of this.#preparate) {
      if (pronta.scade >= this.#adesso().getTime()) continue;
      this.#preparate.delete(id);
      await rm(pronta.percorso, { force: true });
    }
  }

  /** Riceve una copia caricata dal proprietario: prende il posto di quella di prima. */
  ricevi(sorgente: AsyncIterable<Buffer>): Promise<CopiaCaricata> {
    return this.#solo("ricevendo una copia", async () => {
      const massimo = this.#o.massimo ?? COPIA_MASSIMA;
      const arrivo = join(this.#base, "in-arrivo.shinka");
      await mkdir(this.#base, { recursive: true });
      const uscita = createWriteStream(arrivo, { mode: 0o600 });
      let byte = 0;
      try {
        for await (const pezzo of sorgente) {
          byte += pezzo.length;
          if (byte > massimo) throw new CopiaRifiutata("Il file è più grande di quanto Shinka accetta per una copia.");
          if (!uscita.write(pezzo)) await new Promise<void>((fatto) => uscita.once("drain", fatto));
        }
        await new Promise<void>((fatto, rifiuta) => {
          uscita.once("error", rifiuta);
          uscita.end(fatto);
        });
        // Che sia una copia lo si guarda subito: un file qualunque non resta sul server.
        await leggiTestata(arrivo);
      } catch (errore) {
        uscita.destroy();
        await rm(arrivo, { force: true });
        throw errore;
      }
      await this.#scarta();
      await rename(arrivo, this.#caricata);
      const caricata = await this.#letta();
      if (caricata === undefined) throw new CopiaNonValida("La copia non si legge.");
      return caricata;
    });
  }

  /** Apre la copia caricata con la sua password, e dice che cosa c'è dentro. */
  apri(password: string): Promise<CopiaCaricata> {
    return this.#solo("aprendo una copia", async () => {
      if (!existsSync(this.#caricata)) throw new CopiaRifiutata("Non c'è una copia caricata.");
      this.#contenuto = undefined;
      const aperta = await apriCopia({ file: this.#caricata, password, destinazione: this.#aperta });
      this.#contenuto = await this.#guarda(aperta);
      const caricata = await this.#letta();
      if (caricata === undefined) throw new CopiaNonValida("La copia non si legge.");
      return caricata;
    });
  }

  /** Porta qui memoria e skill della copia aperta, senza toccare il resto. */
  trasloca(scelte: ScelteDelTrasloco): Promise<EsitoTrasloco> {
    return this.#solo("portando qui memoria e skill", async () => {
      if (!existsSync(join(this.#aperta, "dati"))) throw new CopiaRifiutata("La copia va prima aperta con la sua password.");
      const esito: EsitoTrasloco = { memoria: 0, skillCreate: [], skillCambiate: [], rifiutati: [] };
      if (scelte.memoria) {
        for (const testo of await this.#memoriaDellaCopia()) {
          if (this.#o.memoria.conosce(testo)) continue;
          try {
            await this.#o.memoria.annota(testo, this.#adesso().getTime(), "copia di sicurezza");
            esito.memoria += 1;
          } catch (errore) {
            if (!(errore instanceof VoceRifiutata)) throw errore;
            esito.rifiutati.push({ che: `La voce di memoria «${testo.slice(0, 80)}»`, motivo: errore.message });
          }
        }
      }
      const nellaCopia = await this.#skillDellaCopia();
      for (const nome of scelte.skill) {
        const skill = nellaCopia.get(nome);
        if (skill === undefined) {
          esito.rifiutati.push({ che: `La skill ${nome}`, motivo: "Nella copia non c'è." });
          continue;
        }
        try {
          const fatto = await this.#o.skill.salva({ nome, ...skill, motivo: "Portata da una copia di sicurezza" }, "copia di sicurezza");
          if (fatto === "creata") esito.skillCreate.push(nome);
          if (fatto === "modificata") esito.skillCambiate.push(nome);
        } catch (errore) {
          if (!(errore instanceof SkillRifiutata)) throw errore;
          esito.rifiutati.push({ che: `La skill ${nome}`, motivo: errore.message });
        }
      }
      // Ciò che è già qui cambia ciò che la copia ha di nuovo.
      this.#contenuto = undefined;
      return esito;
    });
  }

  /**
   * Chiede che al prossimo avvio i dati siano quelli della copia aperta. Se il centro sa ripartire
   * da solo, riparte; altrimenti lo riavvia il proprietario. Vero se riparte da solo.
   */
  async chiediRipristino(): Promise<boolean> {
    if (this.#occupata !== undefined) throw new CopiaRifiutata(`Shinka sta già ${this.#occupata}: aspetta che finisca.`);
    if (!existsSync(join(this.#aperta, "dati"))) throw new CopiaRifiutata("La copia va prima aperta con la sua password.");
    const { testata } = await leggiTestata(this.#caricata);
    segnaIlRipristino(this.#aperta, { quando: testata.quando, ...(testata.versione === undefined ? {} : { versione: testata.versione }) }, this.#adesso());
    this.#ripristinoChiesto = true;
    this.#o.riavvia?.();
    return this.#o.riavvia !== undefined;
  }

  /** Butta via la copia caricata e ciò che ne è stato aperto. */
  scarta(): Promise<void> {
    return this.#solo("togliendo la copia caricata", () => this.#scarta());
  }

  async #scarta(): Promise<void> {
    this.#contenuto = undefined;
    await rm(this.#aperta, { recursive: true, force: true, maxRetries: 3 });
    await rm(this.#caricata, { force: true });
  }

  /** Toglie i dati di prima dell'ultimo ripristino, tenuti da parte. */
  async eliminaDatiDiPrima(): Promise<void> {
    for (const nome of await this.#primaDelRipristino()) await rm(join(this.#base, nome), { recursive: true, force: true, maxRetries: 3 });
  }

  async stato(): Promise<StatoCopie> {
    await this.#sfoltisci();
    const caricata = await this.#letta();
    const prima = await this.#primaDelRipristino();
    let byte = 0;
    for (const nome of prima) byte += await peso(join(this.#base, nome));
    return {
      riparte: this.#o.riavvia !== undefined,
      ...(caricata === undefined ? {} : { caricata }),
      ...(this.ultimoRipristino === undefined ? {} : { ultimoRipristino: this.ultimoRipristino }),
      ...(prima.length === 0 ? {} : { datiDiPrima: { byte } }),
    };
  }

  /** Com'è andato l'ultimo ripristino, se ce n'è stato uno. */
  get ultimoRipristino(): EsitoRipristino | undefined {
    try {
      const letto = JSON.parse(readFileSync(join(this.#base, "esito.json"), "utf8")) as Partial<EsitoRipristino>;
      if (typeof letto.quando !== "string" || typeof letto.riuscito !== "boolean" || typeof letto.copia?.quando !== "string") return undefined;
      return {
        quando: letto.quando,
        riuscito: letto.riuscito,
        copia: { quando: letto.copia.quando, ...(typeof letto.copia.versione === "string" ? { versione: letto.copia.versione } : {}) },
        ...(typeof letto.errore === "string" ? { errore: letto.errore } : {}),
      };
    } catch {
      return undefined;
    }
  }

  async #primaDelRipristino(): Promise<string[]> {
    try {
      return (await readdir(this.#base)).filter((nome) => nome.startsWith("prima-"));
    } catch {
      return [];
    }
  }

  async #letta(): Promise<CopiaCaricata | undefined> {
    if (!existsSync(this.#caricata)) return undefined;
    let testata: TestataDellaCopia;
    try {
      testata = (await leggiTestata(this.#caricata)).testata;
    } catch {
      return undefined;
    }
    // Dopo un riavvio la copia aperta c'è ancora: che cosa contiene si riguarda.
    if (this.#contenuto === undefined && existsSync(join(this.#aperta, "manifesto.json"))) this.#contenuto = await this.#guarda();
    return {
      quando: testata.quando,
      ...(testata.versione === undefined ? {} : { versione: testata.versione }),
      byte: (await stat(this.#caricata)).size,
      ...(this.#contenuto === undefined ? {} : { contenuto: this.#contenuto }),
    };
  }

  async #memoriaDellaCopia(): Promise<string[]> {
    try {
      return testiDellaMemoria(await readFile(join(this.#aperta, "dati", "memoria.md"), "utf8"));
    } catch {
      return [];
    }
  }

  async #skillDellaCopia(): Promise<Map<string, { descrizione: string; contenuto: string }>> {
    const trovate = new Map<string, { descrizione: string; contenuto: string }>();
    const cartella = join(this.#aperta, "dati", "skill", "skills");
    let nomi: string[];
    try {
      nomi = (await readdir(cartella)).sort();
    } catch {
      return trovate;
    }
    for (const nome of nomi) {
      if (!NOME_SKILL.test(nome)) continue;
      try {
        const parti = scomponiSkill(await readFile(join(cartella, nome, FILE_SKILL), "utf8"));
        if (parti !== undefined) trovate.set(nome, parti);
      } catch {
        // Una cartella senza la sua skill.
      }
    }
    return trovate;
  }

  /** Che cosa c'è nella copia aperta, a confronto con ciò che c'è qui. */
  async #guarda(misure?: { file: number; byte: number }): Promise<ContenutoDellaCopia> {
    const dati = join(this.#aperta, "dati");
    const { testata } = await leggiTestata(this.#caricata);
    const voci = await this.#memoriaDellaCopia();
    const skill: SkillNellaCopia[] = [];
    for (const [nome, parti] of await this.#skillDellaCopia()) {
      const qui = await this.#o.skill.leggi(nome);
      skill.push({
        nome,
        descrizione: parti.descrizione,
        ...(qui === undefined ? {} : { qui: qui.descrizione === parti.descrizione && qui.contenuto === parti.contenuto ? ("uguale" as const) : ("diversa" as const) }),
      });
    }
    let progetti: { nome?: unknown; cartella?: unknown; idAmbiente?: unknown }[] = [];
    try {
      const letti = JSON.parse(await readFile(join(dati, "progetti.json"), "utf8")) as unknown;
      if (Array.isArray(letti)) progetti = letti as typeof progetti;
    } catch {
      // Una copia senza progetti.
    }
    let argomenti = 0;
    try {
      const letti = JSON.parse(await readFile(join(dati, "argomenti.json"), "utf8")) as { argomenti?: unknown };
      if (Array.isArray(letti.argomenti)) argomenti = letti.argomenti.length;
    } catch {
      // Una copia senza argomenti.
    }
    const presente = this.#o.cartellaPresente ?? existsSync;
    const pesata = misure ?? (await misura(this.#aperta));
    return {
      stessaVersione: testata.versione === this.#o.versione,
      memoria: { voci: voci.length, nuove: voci.filter((testo) => !this.#o.memoria.conosce(testo)).length },
      skill,
      progetti: progetti.length,
      progettiSenzaCartella: progetti
        .filter((progetto) => progetto.idAmbiente === "centro" && typeof progetto.cartella === "string" && !presente(progetto.cartella))
        .map((progetto) => (typeof progetto.nome === "string" ? progetto.nome : "senza nome"))
        .slice(0, 100),
      argomenti,
      file: pesata.file,
      byteAperti: pesata.byte,
    };
  }
}

/** Quanti file ci sono sotto una cartella, e quanto occupano. */
async function misura(cartella: string): Promise<{ file: number; byte: number }> {
  let file = 0;
  let byte = 0;
  let voci;
  try {
    voci = await readdir(cartella, { withFileTypes: true });
  } catch {
    return { file, byte };
  }
  for (const voce of voci) {
    const qui = join(cartella, voce.name);
    if (voce.isDirectory()) {
      const sotto = await misura(qui);
      file += sotto.file;
      byte += sotto.byte;
    } else if (voce.isFile()) {
      file += 1;
      byte += (await stat(qui).catch(() => ({ size: 0 }))).size;
    }
  }
  return { file, byte };
}

async function peso(cartella: string): Promise<number> {
  return (await misura(cartella)).byte;
}
