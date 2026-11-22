/**
 * La copia pubblica di Shinka: il ramo che va su GitHub (ADR 0044).
 *
 * Il repository di lavoro resta sul server con tutta la sua storia, ed è quello da cui Shinka
 * si installa: non viene riscritto. La copia pubblica ha una storia sua, che comincia dalla
 * prima pubblicazione: da lì in poi un commit per ogni commit del ramo di lavoro, con lo stesso
 * messaggio e gli stessi file, tranne quelli esclusi. L'autore è sempre Shinka.
 *
 * Ciò che è pubblico non si ritira. Per questo nulla viene preparato se in un file o in un
 * messaggio compare un'espressione vietata: l'elenco lo tiene il proprietario fuori dal
 * repository, perché contiene proprio ciò che non deve uscire.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Il ramo locale con la storia pubblica. Su GitHub diventa `main`. */
export const RAMO_PUBBLICO = "pubblico";

/** Fin dove il ramo di lavoro è già stato portato nella copia pubblica. */
const RIFERIMENTO_ORIGINE = "refs/pubblicazione/origine";

/**
 * Ciò che resta sul server. `STATO.md` racconta anche l'installazione del proprietario:
 * la sua rete, il suo server, ciò che non è ancora stato provato.
 */
export const ESCLUSI_DALLA_COPIA: readonly string[] = ["STATO.md"];

const AUTORE = { nome: "Shinka", email: "shinka@localhost" };
const PRIMO_MESSAGGIO = "Prima pubblicazione di Shinka";
const TROVATI_AL_MASSIMO = 20;

export interface OpzioniCopiaPubblica {
  /** La cartella del repository di lavoro. */
  cartella: string;
  /** Le espressioni che non devono comparire in ciò che diventa pubblico. */
  vietati: readonly RegExp[];
  /** Il ramo di lavoro. Se manca, `main`. */
  ramo?: string;
  /** I percorsi che non entrano nella copia. Se manca, `ESCLUSI_DALLA_COPIA`. */
  esclusi?: readonly string[];
  /** L'ora della prima pubblicazione. Nei test, una finta. */
  adesso?: () => Date;
}

export interface EsitoCopiaPubblica {
  /** Quanti commit sono stati aggiunti alla copia pubblica. */
  nuovi: number;
  /** Il commit in cima al ramo pubblico. */
  punta: string;
}

/** La copia pubblica non è stata toccata: il messaggio dice perché. */
export class PubblicazioneRifiutata extends Error {}

interface Passo {
  albero: string;
  messaggio: string;
  data: string;
  /** Come chiamarlo in un rifiuto. */
  nome: string;
}

/**
 * Porta nel ramo pubblico i commit del ramo di lavoro che non ci sono ancora.
 * Non manda nulla fuori: scrive solo il ramo locale. O li porta tutti, o nessuno.
 */
export function preparaCopiaPubblica(opzioni: OpzioniCopiaPubblica): EsitoCopiaPubblica {
  const { cartella, vietati } = opzioni;
  if (vietati.length === 0) {
    throw new PubblicazioneRifiutata("L'elenco delle espressioni vietate è vuoto: senza, non si pubblica nulla.");
  }
  const ramo = opzioni.ramo ?? "main";
  const esclusi = opzioni.esclusi ?? ESCLUSI_DALLA_COPIA;
  const cima = git(cartella, ["rev-parse", "--verify", "--quiet", `refs/heads/${ramo}^{commit}`]);
  const origine = riferimento(cartella, RIFERIMENTO_ORIGINE);
  const partenza = riferimento(cartella, `refs/heads/${RAMO_PUBBLICO}`);
  if ((origine === undefined) !== (partenza === undefined)) {
    throw new PubblicazioneRifiutata(
      `Il ramo «${RAMO_PUBBLICO}» e ${RIFERIMENTO_ORIGINE} devono esserci tutti e due o nessuno dei due: uno manca.`,
    );
  }

  const passi: Passo[] = [];
  if (origine === undefined) {
    passi.push({
      albero: alberoPubblico(cartella, cima, esclusi),
      messaggio: PRIMO_MESSAGGIO,
      data: (opzioni.adesso?.() ?? new Date()).toISOString(),
      nome: "la prima pubblicazione",
    });
  } else {
    if (!antenato(cartella, origine, cima)) {
      throw new PubblicazioneRifiutata(
        `Il ramo «${ramo}» non continua dal commit pubblicato l'ultima volta (${origine.slice(0, 8)}): la sua storia è stata riscritta.`,
      );
    }
    for (const commit of righe(git(cartella, ["rev-list", "--reverse", "--first-parent", `${origine}..${cima}`]))) {
      passi.push({
        albero: alberoPubblico(cartella, commit, esclusi),
        messaggio: git(cartella, ["log", "-1", "--format=%B", commit]),
        data: git(cartella, ["log", "-1", "--format=%aI", commit]),
        nome: `il commit ${commit.slice(0, 8)}`,
      });
    }
  }

  // Prima si controlla tutto, poi si scrive: un rifiuto a metà non lascia commit pubblici a metà.
  let alberoPrima = partenza === undefined ? undefined : git(cartella, ["rev-parse", `${partenza}^{tree}`]);
  const daScrivere: Passo[] = [];
  for (const passo of passi) {
    // Un commit che tocca solo file esclusi non cambia nulla nella copia pubblica.
    if (passo.albero === alberoPrima) continue;
    controlla(cartella, passo, alberoPrima, vietati);
    daScrivere.push(passo);
    alberoPrima = passo.albero;
  }

  let punta = partenza;
  for (const passo of daScrivere) {
    punta = git(cartella, ["commit-tree", passo.albero, ...(punta === undefined ? [] : ["-p", punta]), "-F", "-"], {
      ingresso: passo.messaggio,
      ambiente: {
        GIT_AUTHOR_NAME: AUTORE.nome,
        GIT_AUTHOR_EMAIL: AUTORE.email,
        GIT_AUTHOR_DATE: passo.data,
        GIT_COMMITTER_NAME: AUTORE.nome,
        GIT_COMMITTER_EMAIL: AUTORE.email,
        GIT_COMMITTER_DATE: passo.data,
      },
    });
  }
  if (punta === undefined) throw new PubblicazioneRifiutata("Non c'è nulla da pubblicare.");
  if (punta !== partenza) git(cartella, ["update-ref", `refs/heads/${RAMO_PUBBLICO}`, punta]);
  if (cima !== origine) git(cartella, ["update-ref", RIFERIMENTO_ORIGINE, cima]);
  return { nuovi: daScrivere.length, punta };
}

/** Legge l'elenco delle espressioni vietate: una per riga, senza distinguere maiuscole e minuscole. */
export function leggiVietati(testo: string): RegExp[] {
  return righe(testo)
    .map((riga) => riga.trim())
    .filter((riga) => riga !== "" && !riga.startsWith("#"))
    .map((riga) => new RegExp(riga, "i"));
}

/** L'albero di un commit senza i percorsi esclusi. */
function alberoPubblico(cartella: string, commit: string, esclusi: readonly string[]): string {
  const provvisoria = mkdtempSync(join(tmpdir(), "shinka-copia-pubblica-"));
  try {
    const ambiente = { GIT_INDEX_FILE: join(provvisoria, "indice") };
    git(cartella, ["read-tree", commit], { ambiente });
    if (esclusi.length > 0) {
      const daTogliere = git(cartella, ["ls-files", "-z", "--", ...esclusi], { ambiente });
      if (daTogliere !== "") {
        git(cartella, ["update-index", "--force-remove", "-z", "--stdin"], { ambiente, ingresso: daTogliere });
      }
    }
    return git(cartella, ["write-tree"], { ambiente });
  } finally {
    rmSync(provvisoria, { recursive: true, force: true });
  }
}

/** Rifiuta se il messaggio, un nome di file o una riga cambiata contiene un'espressione vietata. */
function controlla(cartella: string, passo: Passo, alberoPrima: string | undefined, vietati: readonly RegExp[]): void {
  const vietato = (testo: string) => vietati.some((espressione) => espressione.test(testo));
  const trovati: string[] = [];
  if (vietato(passo.messaggio)) trovati.push("il messaggio del commit");

  const elenco =
    alberoPrima === undefined
      ? git(cartella, ["ls-tree", "-r", "-z", "--name-only", passo.albero])
      : git(cartella, ["diff-tree", "-r", "-z", "--name-only", "--no-renames", "--diff-filter=AM", alberoPrima, passo.albero]);
  const percorsi = elenco.split("\0").filter((percorso) => percorso !== "");
  for (const percorso of percorsi) {
    if (vietato(percorso)) trovati.push(`il nome del file ${percorso}`);
  }
  const contenuti = contenutiDi(cartella, passo.albero, percorsi);
  for (const [indice, percorso] of percorsi.entries()) {
    const dati = contenuti[indice];
    // Un file binario non si legge a righe: di lui conta solo il nome.
    if (dati === undefined || dati.subarray(0, 8000).includes(0)) continue;
    for (const [numero, riga] of dati.toString("utf8").split("\n").entries()) {
      if (vietato(riga)) trovati.push(`${percorso}:${numero + 1}`);
    }
  }
  if (trovati.length === 0) return;
  const altri = trovati.length > TROVATI_AL_MASSIMO ? ` e altri ${trovati.length - TROVATI_AL_MASSIMO}` : "";
  throw new PubblicazioneRifiutata(
    `Non pubblico ${passo.nome}: c'è un'espressione vietata in ${trovati.slice(0, TROVATI_AL_MASSIMO).join(", ")}${altri}.`,
  );
}

/** I contenuti dei file di un albero, nell'ordine dei percorsi, con un solo processo di Git. */
function contenutiDi(cartella: string, albero: string, percorsi: readonly string[]): (Buffer | undefined)[] {
  if (percorsi.length === 0) return [];
  const uscita = execFileSync("git", ["cat-file", "--batch"], {
    cwd: cartella,
    input: percorsi.map((percorso) => `${albero}:${percorso}\n`).join(""),
    maxBuffer: 1024 * 1024 * 1024,
  });
  const contenuti: (Buffer | undefined)[] = [];
  let posizione = 0;
  for (let indice = 0; indice < percorsi.length; indice++) {
    const fineRiga = uscita.indexOf(10, posizione);
    const intestazione = uscita.subarray(posizione, fineRiga).toString("utf8").split(" ");
    posizione = fineRiga + 1;
    if (intestazione[1] !== "blob") {
      // Un modulo di Git o un percorso che Git non trova: niente contenuto da leggere.
      contenuti.push(undefined);
      if (intestazione[1] !== "missing" && intestazione[2] !== undefined) posizione += Number(intestazione[2]) + 1;
      continue;
    }
    const lunghezza = Number(intestazione[2]);
    contenuti.push(uscita.subarray(posizione, posizione + lunghezza));
    posizione += lunghezza + 1;
  }
  return contenuti;
}

function riferimento(cartella: string, nome: string): string | undefined {
  try {
    return git(cartella, ["rev-parse", "--verify", "--quiet", `${nome}^{commit}`]);
  } catch {
    return undefined;
  }
}

function antenato(cartella: string, vecchio: string, nuovo: string): boolean {
  try {
    git(cartella, ["merge-base", "--is-ancestor", vecchio, nuovo]);
    return true;
  } catch {
    return false;
  }
}

function righe(testo: string): string[] {
  return testo.split("\n").filter((riga) => riga !== "");
}

function git(
  cartella: string,
  argomenti: string[],
  opzioni: { ingresso?: string; ambiente?: Record<string, string> } = {},
): string {
  return execFileSync("git", argomenti, {
    cwd: cartella,
    input: opzioni.ingresso,
    env: { ...process.env, ...opzioni.ambiente },
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
  }).replace(/\n+$/, "");
}
