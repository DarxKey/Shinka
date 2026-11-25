/**
 * Il vault: la custodia delle credenziali del proprietario dentro il gateway.
 *
 * Su disco è un solo file cifrato con una chiave ricavata dalla frase di sblocco, che il
 * proprietario scrive dopo ogni riavvio del gateway e che resta soltanto in memoria: una copia
 * del file non basta a leggere le credenziali. Il valore di una credenziale esce da qui solo
 * con `perUso`, verso l'host per cui è stata inserita, e con `perSito`, verso il sito per cui è
 * stata inserita. `valoriDaNascondere` serve al gateway per toglierli da ciò che restituisce.
 *
 * La chiave di un'estensione è un'eccezione che il proprietario ha scelto: `perEstensione` la
 * consegna al centro, che la porta al programma di quell'estensione nell'ambiente scritto accanto.
 * Vale solo per le voci di quel tipo: una password o una chiave SSH da lì non escono.
 *
 * La credenziale in chiaro è l'altra (ADR 0034): una voce di prova o a basso rischio, segnata così
 * quando la si inserisce, il cui valore `perLettura` dà a Claude per un host o un sito in cui vale.
 * Una credenziale protetta non diventa mai in chiaro; una in chiaro può diventare protetta.
 */

import { createCipheriv, createDecipheriv, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import ssh2 from "ssh2";
import { difettoDelNome, nomeDiChiaveValido } from "../protocollo/estensioni.ts";
import { leggiRecinto, type RecintoStack } from "../protocollo/stack.ts";
import {
  AMBIENTE_MASSIMO,
  FRASE_MINIMA,
  HOST_PER_CREDENZIALE,
  hostInChiaro,
  leggiHost,
  leggiSito,
  NOME_CREDENZIALE,
  SEGRETO_MASSIMO,
  UTENTE_MASSIMO,
  UTENTE_SITO_MASSIMO,
  type AmbientePerIlVault,
  type CondizioneVault,
  type CredenzialeDelegata,
  type CredenzialeInVista,
  type TipoCredenziale,
} from "../protocollo/vault.ts";

/** Il vault è chiuso, o non è ancora stato impostato: nessuna credenziale si può usare o vedere. */
export class VaultChiuso extends Error {}

/** La credenziale proposta non è stata accettata, e il messaggio dice perché. */
export class CredenzialeRifiutata extends Error {}

/** La credenziale non si può usare come richiesto, e il messaggio dice perché. */
export class UsoRifiutato extends Error {}

/** Ciò che il proprietario scrive per inserire o sostituire una credenziale. */
export interface CredenzialeDaCustodire {
  nome: string;
  tipo: TipoCredenziale;
  utente: string;
  /** Gli host su cui vale: nome o indirizzo, con la porta se non è quella solita. */
  host: string[];
  /** La password, oppure la chiave privata per intero. */
  segreto: string;
  /** La frase che protegge la chiave privata, se ne ha una. */
  fraseDellaChiave?: string;
  /** Presente se gli host di questa credenziale sono host per gli stack di prova. */
  stack?: RecintoStack;
  /**
   * Vero se gli host di questa credenziale sono il server su cui gira Shinka: lì ogni comando
   * aspetta il sì del proprietario, dato al gateway.
   */
  server?: boolean;
  /**
   * Per la chiave di un'estensione: il nome dell'estensione. Allora `utente` è il nome della
   * chiave, `host` sono i nomi degli ambienti in cui viene consegnata e `segreto` il suo valore.
   */
  estensione?: string;
  /** Vero per una credenziale in chiaro: Claude ne può leggere il valore. */
  inChiaro?: boolean;
}

/** Un host per gli stack di prova, come lo vede chi non è il gateway. */
export interface HostPerGliStack {
  host: string;
  credenziale: string;
  recinto: RecintoStack;
}

/** Ciò che serve per collegarsi a un host con una credenziale. Non deve uscire dal gateway. */
export interface CredenzialePerUso {
  nome: string;
  tipo: TipoCredenziale;
  utente: string;
  host: string;
  porta: number;
  segreto: string;
  fraseDellaChiave?: string;
  /** L'impronta della chiave dell'host vista al primo collegamento, se c'è già stato. */
  impronta?: string;
  /** Vero per una credenziale in chiaro: il suo valore non va nascosto, Claude lo conosce. */
  inChiaro?: true;
}

/** Ciò che serve per entrare in un sito con una credenziale. Non deve uscire dal gateway. */
export interface CredenzialePerSito {
  nome: string;
  utente: string;
  segreto: string;
}

interface Custodita {
  nome: string;
  tipo: TipoCredenziale;
  utente: string;
  host: string[];
  segreto: string;
  fraseDellaChiave?: string;
  stack?: RecintoStack;
  server?: true;
  estensione?: string;
  inChiaro?: true;
  /** Per ogni host, l'impronta della sua chiave vista al primo collegamento. */
  impronte: Record<string, string>;
  inseritaIl: string;
  usataIl?: string;
  /**
   * Gli ambienti a cui il proprietario l'ha data (ADR 0062), ciascuno con la chiave del suo nodo
   * fissata quando l'ha scelto: un nodo con un'altra chiave non la riceve.
   */
  ambienti?: AmbientePerIlVault[];
}

interface Derivazione {
  sale: string;
  N: number;
  r: number;
  p: number;
}

interface FileDelVault {
  versione: 1;
  derivazione: Derivazione;
  nonce: string;
  cifrato: string;
  sigillo: string;
}

/**
 * La copia del vault che il proprietario scarica dalla pagina del vault: il file com'è sul disco,
 * cifrato con la sua frase. Chi ha la copia senza la frase non legge nulla.
 */
export interface CopiaDelVault {
  tipo: "shinka-copia-del-vault";
  formato: 1;
  quando: string;
  vault: FileDelVault;
}

/** Quanto può pesare, in caratteri, il cifrato di una copia del vault. */
const CIFRATO_MASSIMO = 6 * 1024 * 1024;

/** Il vault dentro una copia, se ha la forma giusta e non chiede un lavoro senza misura per ricavare la chiave. */
function leggiCopia(valore: unknown): FileDelVault | undefined {
  if (typeof valore !== "object" || valore === null) return undefined;
  const { tipo, formato, vault } = valore as Record<string, unknown>;
  if (tipo !== "shinka-copia-del-vault" || formato !== 1 || typeof vault !== "object" || vault === null) return undefined;
  const { versione, derivazione, nonce, cifrato, sigillo } = vault as Record<string, unknown>;
  if (versione !== 1 || typeof derivazione !== "object" || derivazione === null) return undefined;
  const { sale, N, r, p } = derivazione as Record<string, unknown>;
  if (typeof sale !== "string" || sale.length > 100 || typeof N !== "number" || !Number.isInteger(N) || N < 2 ** 10 || N > 2 ** 20 || (N & (N - 1)) !== 0) return undefined;
  if (r !== 8 || p !== 1) return undefined;
  if (typeof nonce !== "string" || nonce.length > 100 || typeof sigillo !== "string" || sigillo.length > 100) return undefined;
  if (typeof cifrato !== "string" || cifrato.length > CIFRATO_MASSIMO) return undefined;
  return { versione, derivazione: { sale, N, r, p }, nonce, cifrato, sigillo };
}

/** Vero se ciò che esce da una copia ha la forma delle credenziali che il vault custodisce. */
function sonoCredenziali(valore: unknown): valore is Custodita[] {
  return (
    Array.isArray(valore) &&
    valore.every(
      (voce: unknown) =>
        typeof voce === "object" &&
        voce !== null &&
        typeof (voce as Custodita).nome === "string" &&
        typeof (voce as Custodita).tipo === "string" &&
        typeof (voce as Custodita).utente === "string" &&
        typeof (voce as Custodita).segreto === "string" &&
        Array.isArray((voce as Custodita).host) &&
        typeof (voce as Custodita).impronte === "object" &&
        (voce as Custodita).impronte !== null,
    )
  );
}

/** Quanto costa ricavare la chiave dalla frase: abbastanza da rendere lento chi prova a indovinarla. */
const COSTO_PREDEFINITO = 2 ** 17;

function ricava(frase: string, derivazione: Derivazione): Promise<Buffer> {
  return new Promise((risolvi, rifiuta) => {
    scrypt(
      frase.normalize("NFKC"),
      Buffer.from(derivazione.sale, "base64"),
      32,
      { N: derivazione.N, r: derivazione.r, p: derivazione.p, maxmem: 256 * derivazione.N * derivazione.r },
      (errore, chiave) => (errore === null ? risolvi(chiave) : rifiuta(errore)),
    );
  });
}

function inVista(credenziale: Custodita): CredenzialeInVista {
  return {
    nome: credenziale.nome,
    tipo: credenziale.tipo,
    utente: credenziale.utente,
    host: [...credenziale.host],
    inseritaIl: credenziale.inseritaIl,
    ...(credenziale.usataIl === undefined ? {} : { usataIl: credenziale.usataIl }),
    ...(credenziale.stack === undefined ? {} : { stack: { porte: { ...credenziale.stack.porte }, radice: credenziale.stack.radice } }),
    ...(credenziale.server === true ? { server: true as const } : {}),
    ...(credenziale.estensione === undefined ? {} : { estensione: credenziale.estensione }),
    ...(credenziale.inChiaro === true ? { inChiaro: true as const } : {}),
    ...(credenziale.ambienti === undefined || credenziale.ambienti.length === 0 ? {} : { ambienti: credenziale.ambienti.map(({ id, nome }) => ({ id, nome })) }),
  };
}

/**
 * Vero se una credenziale si può dare a un ambiente (ADR 0062): solo quelle per SSH, e non quella
 * del server di Shinka né quella di un host per gli stack, che restano sempre e solo nel gateway.
 */
export function siPuoDelegare(credenziale: Pick<Custodita, "tipo" | "server" | "stack" | "estensione">): boolean {
  return (credenziale.tipo === "password" || credenziale.tipo === "chiave") && credenziale.server !== true && credenziale.stack === undefined && credenziale.estensione === undefined;
}

export class Vault {
  readonly #file: string;
  readonly #costo: number;
  #derivazione: Derivazione | undefined;
  /** Presente solo a vault aperto. */
  #chiave: Buffer | undefined;
  #credenziali: Custodita[] = [];
  #scritture: Promise<void> = Promise.resolve();

  private constructor(file: string, costo: number, derivazione: Derivazione | undefined) {
    this.#file = file;
    this.#costo = costo;
    this.#derivazione = derivazione;
  }

  /** Apre il file del vault, che resta chiuso finché il proprietario non scrive la frase. */
  static async apri(file: string, costo: number = COSTO_PREDEFINITO): Promise<Vault> {
    await mkdir(dirname(file), { recursive: true });
    if (!existsSync(file)) return new Vault(file, costo, undefined);
    const letto = JSON.parse(readFileSync(file, "utf8")) as FileDelVault;
    if (letto.versione !== 1) throw new Error(`Il file del vault ha una versione che non conosco: ${String(letto.versione)}`);
    return new Vault(file, costo, letto.derivazione);
  }

  get condizione(): CondizioneVault {
    if (this.#derivazione === undefined) return "da-impostare";
    return this.#chiave === undefined ? "chiuso" : "aperto";
  }

  /** Il proprietario sceglie la frase di sblocco: si può fare una volta sola, a vault mai impostato. */
  async imposta(frase: string): Promise<void> {
    if (this.#derivazione !== undefined) throw new CredenzialeRifiutata("Il vault ha già una frase di sblocco.");
    if (frase.length < FRASE_MINIMA) {
      throw new CredenzialeRifiutata(`La frase di sblocco deve avere almeno ${FRASE_MINIMA} caratteri.`);
    }
    const derivazione: Derivazione = { sale: randomBytes(16).toString("base64"), N: this.#costo, r: 8, p: 1 };
    this.#chiave = await ricava(frase, derivazione);
    this.#derivazione = derivazione;
    this.#credenziali = [];
    await this.#salva();
  }

  /**
   * Apre il vault con la frase. Restituisce falso se la frase non è quella. A vault già aperto
   * dice soltanto se la frase è giusta: serve a riconoscere il proprietario.
   */
  async sblocca(frase: string): Promise<boolean> {
    if (this.#derivazione === undefined) return false;
    const chiave = await ricava(frase, this.#derivazione);
    if (this.#chiave !== undefined) return timingSafeEqual(chiave, this.#chiave);
    const letto = JSON.parse(readFileSync(this.#file, "utf8")) as FileDelVault;
    try {
      const decifra = createDecipheriv("aes-256-gcm", chiave, Buffer.from(letto.nonce, "base64"));
      decifra.setAuthTag(Buffer.from(letto.sigillo, "base64"));
      const chiaro = Buffer.concat([decifra.update(Buffer.from(letto.cifrato, "base64")), decifra.final()]);
      this.#credenziali = (JSON.parse(chiaro.toString("utf8")) as { credenziali: Custodita[] }).credenziali;
    } catch {
      return false;
    }
    this.#chiave = chiave;
    return true;
  }

  /**
   * La copia del vault, com'è sul disco in questo momento: cifrata con la frase, come il file.
   * Nulla se il vault non è mai stato impostato.
   */
  async copia(ora: number = Date.now()): Promise<CopiaDelVault | undefined> {
    if (this.#derivazione === undefined) return undefined;
    // Ciò che sta per essere scritto deve esserci.
    await this.#scritture;
    if (!existsSync(this.#file)) return undefined;
    const vault = JSON.parse(readFileSync(this.#file, "utf8")) as FileDelVault;
    return { tipo: "shinka-copia-del-vault", formato: 1, quando: new Date(ora).toISOString(), vault };
  }

  /**
   * Mette al posto del vault quello di una copia, se la frase scritta è quella della copia: da
   * allora la frase del vault è quella. Il file di prima resta accanto, cifrato com'era. Falso se
   * la frase non apre la copia; `CredenzialeRifiutata` se non è una copia del vault.
   */
  async ripristina(copia: unknown, frase: string, ora: number = Date.now()): Promise<boolean> {
    const file = leggiCopia(copia);
    if (file === undefined) throw new CredenzialeRifiutata("Questo file non è una copia del vault di Shinka.");
    const chiave = await ricava(frase, file.derivazione);
    let credenziali: unknown;
    try {
      const decifra = createDecipheriv("aes-256-gcm", chiave, Buffer.from(file.nonce, "base64"));
      decifra.setAuthTag(Buffer.from(file.sigillo, "base64"));
      const chiaro = Buffer.concat([decifra.update(Buffer.from(file.cifrato, "base64")), decifra.final()]);
      credenziali = (JSON.parse(chiaro.toString("utf8")) as { credenziali?: unknown }).credenziali;
    } catch {
      return false;
    }
    if (!sonoCredenziali(credenziali)) throw new CredenzialeRifiutata("La copia si apre, ma dentro non c'è un vault che questa versione di Shinka sa leggere.");
    await this.#scritture;
    if (existsSync(this.#file)) {
      await copyFile(this.#file, `${this.#file}.prima-${new Date(ora).toISOString().replace(/[:.]/g, "-")}`);
    }
    this.#chiave?.fill(0);
    this.#chiave = chiave;
    this.#derivazione = file.derivazione;
    this.#credenziali = credenziali;
    await this.#salva();
    return true;
  }

  /** Richiude il vault: chiave e credenziali spariscono dalla memoria. */
  chiudi(): void {
    this.#chiave?.fill(0);
    this.#chiave = undefined;
    this.#credenziali = [];
  }

  /** Le credenziali senza il loro valore. */
  elenco(): CredenzialeInVista[] {
    this.#aperto();
    return this.#credenziali.map(inVista);
  }

  async inserisci(nuova: CredenzialeDaCustodire, ora: number = Date.now()): Promise<CredenzialeInVista> {
    this.#aperto();
    const accettata = this.#accetta(nuova, ora);
    if (this.#credenziali.some((c) => c.nome === accettata.nome)) {
      throw new CredenzialeRifiutata(`Esiste già una credenziale di nome "${accettata.nome}": sostituiscila, oppure scegli un altro nome.`);
    }
    this.#unSoloRecinto(accettata);
    this.#unaSolaChiave(accettata);
    this.#credenziali.push(accettata);
    await this.#salva();
    return inVista(accettata);
  }

  /**
   * Sostituisce una credenziale per intero: valore, utente e host insieme. Dove vale una
   * credenziale non si cambia senza riscriverne il valore, così nessuno può spostare su un altro
   * host un valore che non conosce. Restituisce nulla se la credenziale non esiste.
   */
  async sostituisci(nome: string, nuova: CredenzialeDaCustodire, ora: number = Date.now()): Promise<CredenzialeInVista | undefined> {
    this.#aperto();
    const posto = this.#credenziali.findIndex((c) => c.nome === nome);
    if (posto === -1) return undefined;
    const accettata = this.#accetta({ ...nuova, nome }, ora);
    if (accettata.inChiaro === true && this.#credenziali[posto]?.inChiaro !== true) {
      throw new CredenzialeRifiutata(
        "Una credenziale protetta non diventa in chiaro, nemmeno sostituendola: se ne serve una in chiaro, inseriscila con un altro nome.",
      );
    }
    this.#unSoloRecinto(accettata);
    this.#unaSolaChiave(accettata);
    // Gli ambienti a cui era data restano, finché la credenziale si può ancora dare.
    const ambienti = this.#credenziali[posto]?.ambienti;
    if (ambienti !== undefined && ambienti.length > 0 && siPuoDelegare(accettata)) accettata.ambienti = ambienti;
    this.#credenziali[posto] = accettata;
    await this.#salva();
    return inVista(accettata);
  }

  /**
   * Il proprietario sceglie a quali ambienti dare una credenziale per SSH (ADR 0062), dalla pagina
   * del vault: con ciascuno si fissa la chiave del suo nodo di adesso. Restituisce nulla se la
   * credenziale non esiste; lancia `CredenzialeRifiutata` se non è di quelle che si danno.
   */
  async impostaAmbienti(nome: string, ambienti: readonly AmbientePerIlVault[]): Promise<CredenzialeInVista | undefined> {
    this.#aperto();
    const credenziale = this.#credenziali.find((c) => c.nome === nome);
    if (credenziale === undefined) return undefined;
    if (ambienti.length > 0 && !siPuoDelegare(credenziale)) {
      throw new CredenzialeRifiutata(
        "Si danno a un ambiente solo le credenziali per SSH, e non quella del server di Shinka né quella di un host per gli stack: quelle restano solo nel gateway.",
      );
    }
    if (ambienti.length === 0) delete credenziale.ambienti;
    else credenziale.ambienti = ambienti.map(({ id, nome: nomeAmbiente, chiave }) => ({ id, nome: nomeAmbiente, chiave }));
    await this.#salva();
    return inVista(credenziale);
  }

  /**
   * Le credenziali date a un ambiente, per il suo nodo: solo se la chiave con cui si presenta è
   * quella fissata dal proprietario. Il vault dev'essere aperto.
   */
  perAmbiente(idAmbiente: string, chiave: string): CredenzialeDelegata[] {
    this.#aperto();
    return this.#credenziali.flatMap((c) => {
      if (!siPuoDelegare(c) || !(c.ambienti ?? []).some((uno) => uno.id === idAmbiente && uno.chiave === chiave)) return [];
      return [
        {
          nome: c.nome,
          tipo: c.tipo as "password" | "chiave",
          utente: c.utente,
          host: [...c.host],
          segreto: c.segreto,
          ...(c.fraseDellaChiave === undefined ? {} : { fraseDellaChiave: c.fraseDellaChiave }),
          impronte: { ...c.impronte },
        },
      ];
    });
  }

  /** Gli ambienti a cui una credenziale è data: i loro nodi la usano dove il gateway non arriva. */
  ambientiDi(nome: string): AmbientePerIlVault[] {
    if (this.#chiave === undefined) return [];
    const credenziale = this.#credenziali.find((c) => c.nome === nome.trim().toLowerCase());
    return credenziale === undefined || !siPuoDelegare(credenziale) ? [] : [...(credenziale.ambienti ?? [])];
  }

  /** Rende protetta una credenziale in chiaro: da qui Claude non ne legge più il valore. Il contrario non si fa. */
  async rendiProtetta(nome: string): Promise<CredenzialeInVista | undefined> {
    this.#aperto();
    const credenziale = this.#credenziali.find((c) => c.nome === nome);
    if (credenziale === undefined) return undefined;
    if (credenziale.inChiaro === true) {
      delete credenziale.inChiaro;
      await this.#salva();
    }
    return inVista(credenziale);
  }

  /**
   * Controlla una credenziale in chiaro proposta da Claude, senza salvarla: com'è scritta, se il
   * nome è libero. Lancia `CredenzialeRifiutata` con il motivo. Restituisce come la si vedrà.
   */
  valutaInChiaro(nuova: CredenzialeDaCustodire, ora: number = Date.now()): CredenzialeInVista {
    this.#aperto();
    const accettata = this.#accetta({ ...nuova, inChiaro: true }, ora);
    if (accettata.stack !== undefined || accettata.server === true) {
      throw new CredenzialeRifiutata("Una credenziale proposta da Claude non può dichiarare un host per gli stack né il server: lo fa solo il proprietario.");
    }
    if (this.#credenziali.some((c) => c.nome === accettata.nome)) {
      throw new CredenzialeRifiutata(`Esiste già una credenziale di nome "${accettata.nome}": scegline un altro.`);
    }
    return inVista(accettata);
  }

  /**
   * Il valore di una credenziale in chiaro, per l'host o il sito `dove`. Lancia `UsoRifiutato` se
   * non esiste, se è protetta, o se non vale lì: conta com'è scritto, come per l'uso.
   */
  perLettura(nome: string, dove: string): Custodita & { inChiaro: true } {
    this.#aperto();
    const credenziale = this.#credenziali.find((c) => c.nome === nome.trim().toLowerCase());
    if (credenziale === undefined) {
      const inChiaro = this.#credenziali.filter((c) => c.inChiaro === true).map((c) => `"${c.nome}"`).join(", ");
      throw new UsoRifiutato(
        `Nel vault non c'è una credenziale di nome "${nome}".` + (inChiaro === "" ? " Non ci sono credenziali in chiaro." : ` Quelle in chiaro sono: ${inChiaro}.`),
      );
    }
    if (credenziale.inChiaro !== true) {
      throw new UsoRifiutato(
        `"${credenziale.nome}" è una credenziale protetta: il suo valore non si legge, nemmeno su richiesta del proprietario. Si usa per nome, con esegui_su_host o inserisci_credenziale.`,
      );
    }
    let scritto: string;
    if (credenziale.tipo === "sito") {
      const sito = leggiSito(dove);
      if (sito === undefined) throw new UsoRifiutato(`"${dove}" non è un sito scritto in un modo che si capisce: per esempio "https://www.esempio.it".`);
      scritto = sito;
    } else {
      const host = leggiHost(dove);
      if (host === undefined) throw new UsoRifiutato(`"${dove}" non è un host scritto in un modo che si capisce: nome o indirizzo, con la porta dopo i due punti se non è la 22.`);
      scritto = hostInChiaro(host);
    }
    if (!credenziale.host.includes(scritto)) {
      throw new UsoRifiutato(
        `La credenziale "${credenziale.nome}" non vale per ${scritto}: vale solo per ${credenziale.host.join(", ")}. Solo il proprietario può cambiarlo, dalla pagina del vault.`,
      );
    }
    return credenziale as Custodita & { inChiaro: true };
  }

  /** Dopo una lettura: ricorda quando la credenziale è stata usata. */
  async annotaLettura(nome: string, ora: number = Date.now()): Promise<void> {
    return this.annotaUsoNelSito(nome, ora);
  }

  async rimuovi(nome: string): Promise<boolean> {
    this.#aperto();
    const prima = this.#credenziali.length;
    this.#credenziali = this.#credenziali.filter((c) => c.nome !== nome);
    if (this.#credenziali.length === prima) return false;
    await this.#salva();
    return true;
  }

  /**
   * Ciò che serve per collegarsi a `host` con la credenziale `nome`. Lancia `UsoRifiutato` se la
   * credenziale non esiste o non è prevista per quell'host: l'host conta com'è scritto, senza
   * chiedere a nessuno se due nomi indicano la stessa macchina.
   */
  perUso(nome: string, host: string): CredenzialePerUso {
    this.#aperto();
    const credenziale = this.#credenziali.find((c) => c.nome === nome.trim().toLowerCase());
    if (credenziale === undefined) {
      const nomi = this.#credenziali.map((c) => `"${c.nome}"`).join(", ");
      throw new UsoRifiutato(
        `Nel vault non c'è una credenziale di nome "${nome}".` +
          (nomi === "" ? " Il vault è vuoto." : ` Ci sono: ${nomi}.`),
      );
    }
    if (credenziale.tipo === "estensione") {
      throw new UsoRifiutato(
        `"${credenziale.nome}" è la chiave dell'estensione "${credenziale.estensione ?? ""}": la riceve solo il programma di quell'estensione, e non si usa per i comandi sugli host.`,
      );
    }
    const chiesto = leggiHost(host);
    if (chiesto === undefined) throw new UsoRifiutato(`"${host}" non è un host scritto in un modo che si capisce.`);
    const scritto = hostInChiaro(chiesto);
    if (credenziale.tipo === "sito") {
      throw new UsoRifiutato(
        `La credenziale "${credenziale.nome}" serve per entrare in un sito, non per i comandi sugli host: si usa con inserisci_credenziale.`,
      );
    }
    if (!credenziale.host.includes(scritto)) {
      throw new UsoRifiutato(
        `La credenziale "${credenziale.nome}" non è prevista per l'host ${scritto}: vale solo per ${credenziale.host.join(", ")}. ` +
          "Solo il proprietario può cambiarlo, dalla pagina del vault.",
      );
    }
    const impronta = credenziale.impronte[scritto];
    return {
      nome: credenziale.nome,
      tipo: credenziale.tipo,
      utente: credenziale.utente,
      host: chiesto.nome,
      porta: chiesto.porta,
      segreto: credenziale.segreto,
      ...(credenziale.fraseDellaChiave === undefined ? {} : { fraseDellaChiave: credenziale.fraseDellaChiave }),
      ...(impronta === undefined ? {} : { impronta }),
      ...(credenziale.inChiaro === true ? { inChiaro: true as const } : {}),
    };
  }

  /** Gli host per gli stack di prova, ciascuno con la sua credenziale e il suo recinto. */
  hostPerGliStack(): HostPerGliStack[] {
    this.#aperto();
    return this.#credenziali.flatMap((c) =>
      c.stack === undefined ? [] : c.host.map((host) => ({ host, credenziale: c.nome, recinto: c.stack as RecintoStack })),
    );
  }

  /**
   * Ciò che serve per gestire gli stack di prova su `host`: la credenziale con cui collegarsi e
   * il recinto. Lancia `UsoRifiutato` se il proprietario non ha dichiarato quell'host.
   */
  perStack(host: string): { credenziale: CredenzialePerUso; recinto: RecintoStack; host: string } {
    this.#aperto();
    const chiesto = leggiHost(host);
    if (chiesto === undefined) throw new UsoRifiutato(`"${host}" non è un host scritto in un modo che si capisce.`);
    const scritto = hostInChiaro(chiesto);
    const credenziale = this.#credenziali.find((c) => c.stack !== undefined && c.host.includes(scritto));
    if (credenziale?.stack === undefined) {
      const dichiarati = this.hostPerGliStack().map((voce) => voce.host);
      throw new UsoRifiutato(
        `${scritto} non è un host per gli stack di prova. ` +
          (dichiarati.length === 0
            ? "Il proprietario non ne ha ancora dichiarato nessuno: lo fa dalla pagina del vault, inserendo la credenziale dell'host."
            : `Gli host per gli stack sono: ${dichiarati.join(", ")}.`),
      );
    }
    return { credenziale: this.perUso(credenziale.nome, scritto), recinto: credenziale.stack, host: scritto };
  }

  /**
   * Vero se un comando su `host` con la credenziale `nome` deve aspettare l'approvazione del
   * proprietario: l'host è un host per gli stack, oppure la credenziale è quella di uno di loro.
   * Lì Claude fa da solo soltanto le operazioni sugli stack di Shinka.
   */
  chiedeApprovazione(nome: string, host: string): boolean {
    if (this.#chiave === undefined) return false;
    const letto = leggiHost(host);
    const scritto = letto === undefined ? "" : hostInChiaro(letto);
    return this.#credenziali.some((c) => c.stack !== undefined && (c.nome === nome.trim().toLowerCase() || c.host.includes(scritto)));
  }

  /**
   * Vero se il sì a un comando su `host` con la credenziale `nome` lo deve raccogliere il gateway
   * stesso: l'host è il server su cui gira Shinka, oppure la credenziale è quella del server. Chi
   * comanda lì può tutto, gateway compreso: un sì riferito dal centro non basta.
   */
  chiedeIlSiAlGateway(nome: string, host: string): boolean {
    if (this.#chiave === undefined) return false;
    const letto = leggiHost(host);
    const scritto = letto === undefined ? "" : hostInChiaro(letto);
    return this.#credenziali.some((c) => c.server === true && (c.nome === nome.trim().toLowerCase() || c.host.includes(scritto)));
  }

  /**
   * Ciò che serve per entrare nel sito `origine` con la credenziale `nome`. Lancia `UsoRifiutato`
   * se la credenziale non esiste, non è di un sito, o non è prevista per quel sito: conta l'origine
   * esatta, protocollo e porta compresi, così un sito dal nome simile non la riceve.
   */
  perSito(nome: string, origine: string): CredenzialePerSito {
    this.#aperto();
    const credenziale = this.#credenziali.find((c) => c.nome === nome.trim().toLowerCase());
    if (credenziale === undefined) {
      const nomi = this.#credenziali.filter((c) => c.tipo === "sito").map((c) => `"${c.nome}"`).join(", ");
      throw new UsoRifiutato(
        `Nel vault non c'è una credenziale di nome "${nome}".` +
          (nomi === "" ? " Nel vault non ci sono credenziali per i siti." : ` Per i siti ci sono: ${nomi}.`),
      );
    }
    if (credenziale.tipo === "estensione") {
      throw new UsoRifiutato(`"${credenziale.nome}" è la chiave di un'estensione: la riceve solo il programma di quell'estensione, e non si inserisce in un sito.`);
    }
    if (credenziale.tipo !== "sito") {
      throw new UsoRifiutato(`La credenziale "${credenziale.nome}" serve per i comandi sugli host, non per entrare in un sito.`);
    }
    if (!credenziale.host.includes(origine)) {
      throw new UsoRifiutato(
        `La credenziale "${credenziale.nome}" non è prevista per il sito ${origine}: vale solo per ${credenziale.host.join(", ")}. ` +
          "Solo il proprietario può cambiarlo, dalla pagina del vault.",
      );
    }
    return { nome: credenziale.nome, utente: credenziale.utente, segreto: credenziale.segreto };
  }

  /**
   * Le chiavi che un'estensione dichiara, per l'ambiente in cui sta per partire: il valore di
   * ognuna, e i nomi delle voci del vault da cui vengono. Si consegnano solo le voci inserite come
   * chiave di quell'estensione e per quell'ambiente, e solo se ci sono tutte: altrimenti lancia
   * `UsoRifiutato`, che dice quale manca. Nessun'altra credenziale esce da qui.
   */
  perEstensione(estensione: string, ambiente: string, chiavi: readonly string[]): { valori: Record<string, string>; credenziali: string[] } {
    this.#aperto();
    const dove = ambiente.trim().toLowerCase();
    const diQuesta = this.#credenziali.filter((c) => c.tipo === "estensione" && c.estensione === estensione);
    const valori: Record<string, string> = {};
    const credenziali: string[] = [];
    const mancano: string[] = [];
    for (const chiave of chiavi) {
      const trovata = diQuesta.find((c) => c.utente === chiave && c.host.some((uno) => uno.toLowerCase() === dove));
      if (trovata === undefined) {
        mancano.push(chiave);
        continue;
      }
      valori[chiave] = trovata.segreto;
      if (!credenziali.includes(trovata.nome)) credenziali.push(trovata.nome);
    }
    if (mancano.length > 0) {
      const altrove = [...new Set(diQuesta.filter((c) => mancano.includes(c.utente)).flatMap((c) => c.host))];
      throw new UsoRifiutato(
        `Nel vault ${mancano.length === 1 ? "manca la chiave" : "mancano le chiavi"} ${mancano.join(", ")} dell'estensione "${estensione}" per l'ambiente "${ambiente}".` +
          (altrove.length === 0 ? "" : ` C'è per ${altrove.join(", ")}: vale solo negli ambienti scritti accanto alla chiave.`) +
          " Il proprietario la scrive nella pagina del vault, come chiave di un'estensione.",
      );
    }
    return { valori, credenziali };
  }

  /** Dopo la consegna delle chiavi a un'estensione: ricorda quando sono state usate. */
  async annotaConsegna(nomi: readonly string[], ora: number = Date.now()): Promise<void> {
    if (this.#chiave === undefined) return;
    const quando = new Date(ora).toISOString();
    for (const credenziale of this.#credenziali) if (nomi.includes(credenziale.nome)) credenziale.usataIl = quando;
    await this.#salva();
  }

  /**
   * I valori che non devono comparire in nulla di ciò che il gateway restituisce: password, frasi
   * delle chiavi, righe delle chiavi private. Vuoto a vault chiuso. Un valore cortissimo non c'è:
   * toglierlo ovunque rovinerebbe i testi senza proteggere nulla.
   */
  valoriDaNascondere(): string[] {
    const valori = new Set<string>();
    for (const credenziale of this.#credenziali) {
      // Il valore di una credenziale in chiaro Claude lo conosce già: nasconderlo confonderebbe soltanto.
      if (credenziale.inChiaro === true) continue;
      if (credenziale.fraseDellaChiave !== undefined) valori.add(credenziale.fraseDellaChiave);
      if (credenziale.tipo === "chiave") {
        for (const riga of credenziale.segreto.split("\n")) if (!riga.startsWith("-----")) valori.add(riga.trim());
      } else {
        valori.add(credenziale.segreto);
        valori.add(credenziale.segreto.trim());
      }
    }
    return [...valori].filter((valore) => valore.length >= 4);
  }

  /** Dopo l'inserimento in un sito: ricorda quando la credenziale è stata usata. */
  async annotaUsoNelSito(nome: string, ora: number = Date.now()): Promise<void> {
    if (this.#chiave === undefined) return;
    const credenziale = this.#credenziali.find((c) => c.nome === nome);
    if (credenziale === undefined) return;
    credenziale.usataIl = new Date(ora).toISOString();
    await this.#salva();
  }

  /** Dopo un collegamento riuscito: ricorda quando, e l'impronta dell'host se era la prima volta. */
  async annotaUso(nome: string, host: string, impronta: string, ora: number = Date.now()): Promise<void> {
    if (this.#chiave === undefined) return;
    const credenziale = this.#credenziali.find((c) => c.nome === nome);
    const letto = leggiHost(host);
    if (credenziale === undefined || letto === undefined) return;
    credenziale.usataIl = new Date(ora).toISOString();
    credenziale.impronte[hostInChiaro(letto)] ??= impronta;
    await this.#salva();
  }

  #aperto(): void {
    if (this.#chiave === undefined) {
      throw new VaultChiuso(
        this.#derivazione === undefined
          ? "Il vault non è ancora stato impostato: il proprietario deve scegliere la frase di sblocco dalla pagina del vault."
          : "Il vault è chiuso: il proprietario deve sbloccarlo dalla pagina del vault con la sua frase.",
      );
    }
  }

  /** Un host ha un solo recinto: due credenziali non possono dichiararlo tutte e due host per gli stack. */
  #unSoloRecinto(accettata: Custodita): void {
    if (accettata.stack === undefined) return;
    for (const altra of this.#credenziali) {
      if (altra.nome === accettata.nome || altra.stack === undefined) continue;
      const comune = altra.host.find((host) => accettata.host.includes(host));
      if (comune !== undefined) {
        throw new CredenzialeRifiutata(`${comune} è già un host per gli stack con la credenziale "${altra.nome}": un host ha un solo recinto.`);
      }
    }
  }

  /** Di una chiave di un'estensione ce n'è una sola per ambiente: due voci non possono contendersela. */
  #unaSolaChiave(accettata: Custodita): void {
    if (accettata.tipo !== "estensione") return;
    for (const altra of this.#credenziali) {
      if (altra.nome === accettata.nome || altra.tipo !== "estensione") continue;
      if (altra.estensione !== accettata.estensione || altra.utente !== accettata.utente) continue;
      const comune = altra.host.find((uno) => accettata.host.some((ambiente) => ambiente.toLowerCase() === uno.toLowerCase()));
      if (comune !== undefined) {
        throw new CredenzialeRifiutata(
          `La chiave ${accettata.utente} dell'estensione "${accettata.estensione ?? ""}" per l'ambiente "${comune}" è già nel vault, con il nome "${altra.nome}": sostituisci quella.`,
        );
      }
    }
  }

  /** La chiave di un'estensione: a chi va, come si chiama, in quali ambienti, e il suo valore. */
  #accettaChiave(nuova: CredenzialeDaCustodire, nome: string, ora: number): Custodita {
    const estensione = (nuova.estensione ?? "").trim();
    const difetto = difettoDelNome(estensione);
    if (difetto !== undefined) {
      throw new CredenzialeRifiutata(`Serve il nome dell'estensione che riceve la chiave, com'è scritto nella pagina Estensioni di Shinka. ${difetto}`);
    }
    const chiave = nuova.utente.trim();
    if (!nomeDiChiaveValido(chiave)) {
      throw new CredenzialeRifiutata(
        "Serve il nome della chiave come l'estensione lo dichiara: quello di una variabile d'ambiente o di un'intestazione, per esempio \"GITHUB_TOKEN\".",
      );
    }
    const ambienti: string[] = [];
    for (const scritto of nuova.host) {
      const pulito = scritto.trim().replace(/\s+/g, " ");
      if (pulito === "") continue;
      if (pulito.length > AMBIENTE_MASSIMO) throw new CredenzialeRifiutata(`"${pulito.slice(0, 40)}…" è troppo lungo per essere il nome di un ambiente.`);
      if (!ambienti.some((uno) => uno.toLowerCase() === pulito.toLowerCase())) ambienti.push(pulito);
    }
    if (ambienti.length === 0) {
      throw new CredenzialeRifiutata("Serve almeno un ambiente in cui la chiave viene consegnata: il suo nome, com'è scritto nella pagina Ambienti di Shinka.");
    }
    if (ambienti.length > HOST_PER_CREDENZIALE) throw new CredenzialeRifiutata(`Una chiave vale al massimo in ${HOST_PER_CREDENZIALE} ambienti.`);
    // Copiando una chiave si prende spesso uno spazio o un a capo in più.
    const segreto = nuova.segreto.trim();
    if (segreto === "" || segreto.length > SEGRETO_MASSIMO) throw new CredenzialeRifiutata("Manca il valore della chiave.");
    if (/[\r\n]/.test(segreto)) throw new CredenzialeRifiutata("Il valore della chiave sta su una riga sola.");
    if (nuova.stack !== undefined) throw new CredenzialeRifiutata("La chiave di un'estensione non può dichiarare un host per gli stack.");
    if (nuova.server === true) throw new CredenzialeRifiutata("La chiave di un'estensione non può essere la credenziale del server.");
    if (nuova.inChiaro === true) throw new CredenzialeRifiutata("La chiave di un'estensione non può essere in chiaro: la riceve solo il suo programma.");
    return { nome, tipo: "estensione", utente: chiave, host: ambienti, segreto, estensione, impronte: {}, inseritaIl: new Date(ora).toISOString() };
  }

  #accetta(nuova: CredenzialeDaCustodire, ora: number): Custodita {
    const nome = nuova.nome.trim().toLowerCase();
    if (!NOME_CREDENZIALE.test(nome)) {
      throw new CredenzialeRifiutata("Il nome è fatto di lettere minuscole, cifre e trattini, da 2 a 48 caratteri: per esempio \"nas-root\".");
    }
    if (nuova.tipo === "estensione") return this.#accettaChiave(nuova, nome, ora);
    if (nuova.tipo !== "password" && nuova.tipo !== "chiave" && nuova.tipo !== "sito") {
      throw new CredenzialeRifiutata("Il tipo è password, chiave, sito oppure estensione.");
    }
    const perSito = nuova.tipo === "sito";
    const utente = nuova.utente.trim();
    if (utente === "" || utente.length > (perSito ? UTENTE_SITO_MASSIMO : UTENTE_MASSIMO) || /\s/.test(utente)) {
      throw new CredenzialeRifiutata(
        perSito ? "Serve il nome utente o l'indirizzo email con cui entri nel sito, senza spazi." : "Serve il nome dell'utente con cui collegarsi, senza spazi.",
      );
    }
    const host: string[] = [];
    for (const scritto of nuova.host) {
      if (scritto.trim() === "") continue;
      let chiaro: string;
      if (perSito) {
        const sito = leggiSito(scritto);
        if (sito === undefined) {
          throw new CredenzialeRifiutata(`"${scritto}" non è un sito scritto in un modo che si capisce: per esempio "https://www.esempio.it".`);
        }
        chiaro = sito;
      } else {
        const letto = leggiHost(scritto);
        if (letto === undefined) throw new CredenzialeRifiutata(`"${scritto}" non è un host scritto in un modo che si capisce: nome o indirizzo, con la porta dopo i due punti se non è la 22.`);
        chiaro = hostInChiaro(letto);
      }
      if (!host.includes(chiaro)) host.push(chiaro);
    }
    if (host.length === 0) {
      throw new CredenzialeRifiutata(perSito ? "Serve almeno un sito in cui la credenziale vale." : "Serve almeno un host su cui la credenziale vale.");
    }
    if (host.length > HOST_PER_CREDENZIALE) {
      throw new CredenzialeRifiutata(`Una credenziale vale al massimo su ${HOST_PER_CREDENZIALE} ${perSito ? "siti" : "host"}.`);
    }
    const frase = nuova.fraseDellaChiave === undefined || nuova.fraseDellaChiave === "" ? undefined : nuova.fraseDellaChiave;
    // Una password vale com'è scritta; una chiave ha in coda un a capo, che copiandola si perde spesso.
    const segreto = nuova.tipo === "chiave" ? `${nuova.segreto.replace(/\r\n/g, "\n").trim()}\n` : nuova.segreto;
    if (nuova.segreto === "" || segreto.length > SEGRETO_MASSIMO) {
      throw new CredenzialeRifiutata(nuova.tipo === "chiave" ? "Manca la chiave privata." : "Manca la password.");
    }
    if (nuova.tipo === "chiave") {
      const letta = ssh2.utils.parseKey(segreto, frase);
      if (letta instanceof Error) {
        throw new CredenzialeRifiutata(
          /passphrase|encrypted/i.test(letta.message)
            ? "La chiave privata è protetta da una frase: scrivila nel campo apposito, e controlla che sia giusta."
            : "La chiave privata non si legge: va incollata per intero, dalla riga BEGIN alla riga END.",
        );
      }
    }
    let stack: RecintoStack | undefined;
    if (nuova.stack !== undefined) {
      if (perSito) throw new CredenzialeRifiutata("Una credenziale per un sito non può dichiarare un host per gli stack.");
      const recinto = leggiRecinto(nuova.stack);
      if (typeof recinto === "string") throw new CredenzialeRifiutata(recinto);
      stack = recinto;
    }
    if (nuova.server === true && perSito) throw new CredenzialeRifiutata("Una credenziale per un sito non può essere la credenziale del server.");
    return {
      nome,
      tipo: nuova.tipo,
      utente,
      host,
      segreto,
      ...(nuova.tipo === "chiave" && frase !== undefined ? { fraseDellaChiave: frase } : {}),
      ...(stack === undefined ? {} : { stack }),
      ...(nuova.server === true ? { server: true as const } : {}),
      ...(nuova.inChiaro === true ? { inChiaro: true as const } : {}),
      impronte: {},
      inseritaIl: new Date(ora).toISOString(),
    };
  }

  /** Riscrive il file cifrato. Le scritture si fanno una alla volta. */
  #salva(): Promise<void> {
    const scrittura = this.#scritture.then(() => this.#scrivi());
    this.#scritture = scrittura.catch(() => {});
    return scrittura;
  }

  async #scrivi(): Promise<void> {
    if (this.#chiave === undefined || this.#derivazione === undefined) return;
    const nonce = randomBytes(12);
    const cifra = createCipheriv("aes-256-gcm", this.#chiave, nonce);
    const cifrato = Buffer.concat([
      cifra.update(JSON.stringify({ credenziali: this.#credenziali }), "utf8"),
      cifra.final(),
    ]);
    const file: FileDelVault = {
      versione: 1,
      derivazione: this.#derivazione,
      nonce: nonce.toString("base64"),
      cifrato: cifrato.toString("base64"),
      sigillo: cifra.getAuthTag().toString("base64"),
    };
    const provvisorio = `${this.#file}.tmp`;
    await writeFile(provvisorio, `${JSON.stringify(file)}\n`, { mode: 0o600 });
    await rename(provvisorio, this.#file);
  }
}
