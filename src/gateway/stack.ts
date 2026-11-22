/**
 * Gli stack di prova: i container che Claude avvia sugli host Docker del lab, accanto ai servizi
 * del proprietario. Per questo c'è un recinto, e lo applica il gateway nel momento in cui esegue:
 *
 * - si lavora solo sugli host che il proprietario ha dichiarato, con la credenziale del vault;
 * - uno stack si chiama `shinka-nome` e ogni suo container porta l'etichetta di Shinka: ciò che
 *   su un host ha quel nome ma non l'etichetta non viene toccato;
 * - le porte sull'host stanno nell'intervallo dedicato, e i volumi sono cartelle dello stack
 *   sotto la radice dedicata, segnate come di Shinka;
 * - la descrizione di uno stack ha pochi campi, e da quella il gateway scrive da sé ciò che
 *   Docker deve fare: non c'è modo di chiedere un container privilegiato, la rete dell'host o
 *   il montaggio di un percorso qualunque.
 *
 * Ogni operazione finisce nel registro, anche quella rifiutata.
 */

import { contenitoriDa, type DockerDiUnHost } from "../protocollo/risorse.ts";
import {
  ETICHETTA_STACK,
  FILE_PER_STACK,
  FILE_STACK_MASSIMO,
  MEMORIA_SERVIZIO_MASSIMA_MB,
  MEMORIA_SERVIZIO_MB,
  MEMORIA_SERVIZIO_MINIMA_MB,
  NOME_NELLO_STACK,
  NOME_STACK,
  PAROLE_DEL_COMANDO,
  PORTE_PER_SERVIZIO,
  PREFISSO_STACK,
  RIGHE_STACK,
  RIGHE_STACK_MASSIME,
  SECONDI_AVVIO_STACK,
  SECONDI_OPERAZIONE_STACK,
  SEGNO_DI_SHINKA,
  SERVIZI_PER_STACK,
  VALORE_VARIABILE_MASSIMO,
  VARIABILI_PER_SERVIZIO,
  VOLUMI_PER_SERVIZIO,
  type DescrizioneStack,
  type EsitoStack,
  type FileStack,
  type PortaStack,
  type RecintoStack,
  type RichiestaStack,
  type ServizioStack,
  type VolumeStack,
} from "../protocollo/stack.ts";
import type { VoceRegistro } from "../protocollo/vault.ts";
import { ErroreSsh, eseguiSuHost, type EsitoComando } from "./ssh.ts";
import { daNascondere, nascondi } from "./uso.ts";
import { UsoRifiutato, VaultChiuso, type CredenzialePerUso, type HostPerGliStack } from "./vault.ts";

/** Come il gateway esegue un comando su un host per gli stack. */
export type EseguiPerStack = (credenziale: CredenzialePerUso, comando: string, durataMs: number, ingresso?: string) => Promise<EsitoComando>;

/** Da dove vengono gli host per gli stack, con la loro credenziale e il loro recinto: il vault. */
export interface FonteDegliHost {
  hostPerGliStack(): HostPerGliStack[];
  perStack(host: string): { credenziale: CredenzialePerUso; recinto: RecintoStack; host: string };
  annotaUso(nome: string, host: string, impronta: string): Promise<void>;
}

/** Dove finisce ciò che è stato fatto. */
export interface RegistroDegliStack {
  annota(voce: VoceRegistro): Promise<void>;
}

/** La descrizione non è stata accettata, o l'operazione non si può fare: il messaggio dice perché. */
class Rifiuto extends Error {}

/** L'host non ha fatto ciò che gli era stato chiesto. */
class Fallimento extends Error {}

const IMMAGINE = /^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,254}$/;
const VARIABILE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const PERCORSO_NEL_CONTAINER = /^(\/[A-Za-z0-9._-]+)+$/;
const PERCORSO_NEL_VOLUME = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;

const CAMPI_DELLO_STACK = ["host", "nome", "servizi", "file"];
const CAMPI_DEL_SERVIZIO = ["nome", "immagine", "comando", "ambiente", "porte", "volumi", "dipende_da", "memoria_mb"];

function oggetto(valore: unknown, cosa: string): Record<string, unknown> {
  if (typeof valore !== "object" || valore === null || Array.isArray(valore)) throw new Rifiuto(`${cosa} non è scritto come ci si aspetta.`);
  return valore as Record<string, unknown>;
}

function elenco(valore: unknown, cosa: string, massimo: number): unknown[] {
  if (valore === undefined || valore === null) return [];
  if (!Array.isArray(valore)) throw new Rifiuto(`${cosa} va scritto come un elenco.`);
  if (valore.length > massimo) throw new Rifiuto(`${cosa}: al massimo ${massimo}.`);
  return valore;
}

/** Un campo che la descrizione non prevede viene detto, non ignorato: Claude non deve crederlo accettato. */
function soloCampi(scritto: Record<string, unknown>, previsti: readonly string[], cosa: string): void {
  const estraneo = Object.keys(scritto).find((campo) => !previsti.includes(campo));
  if (estraneo !== undefined) {
    throw new Rifiuto(
      `${cosa} non ha un campo "${estraneo}": i campi sono ${previsti.join(", ")}. Uno stack di prova non può chiedere altro: né privilegi, né la rete dell'host, né percorsi dell'host.`,
    );
  }
}

function senzaPuntini(percorso: string): boolean {
  return !percorso.split("/").some((parte) => parte === "." || parte === "..");
}

function leggiPorta(scritta: unknown, servizio: string, recinto: RecintoStack): PortaStack {
  const campi = oggetto(scritta, `Una porta del servizio "${servizio}"`);
  soloCampi(campi, ["host", "container", "protocollo"], `Una porta del servizio "${servizio}"`);
  const { host, container } = campi;
  const protocollo = campi.protocollo ?? "tcp";
  if (typeof host !== "number" || !Number.isInteger(host) || host < recinto.porte.da || host > recinto.porte.a) {
    throw new Rifiuto(
      `Il servizio "${servizio}" chiede la porta ${String(host)} dell'host: gli stack di prova usano solo le porte da ${recinto.porte.da} a ${recinto.porte.a}.`,
    );
  }
  if (typeof container !== "number" || !Number.isInteger(container) || container < 1 || container > 65535) {
    throw new Rifiuto(`Il servizio "${servizio}" indica una porta del container che non è una porta: ${String(container)}.`);
  }
  if (protocollo !== "tcp" && protocollo !== "udp") throw new Rifiuto(`Il protocollo di una porta è tcp oppure udp.`);
  return { host, container, protocollo };
}

function leggiVolume(scritto: unknown, servizio: string): VolumeStack {
  const campi = oggetto(scritto, `Un volume del servizio "${servizio}"`);
  soloCampi(campi, ["nome", "percorso", "sola_lettura"], `Un volume del servizio "${servizio}"`);
  const { nome, percorso } = campi;
  if (typeof nome !== "string" || !NOME_NELLO_STACK.test(nome)) {
    throw new Rifiuto(
      `Un volume del servizio "${servizio}" non ha un nome valido: lettere minuscole, cifre e trattini. Un volume è una cartella dello stack: non si indica un percorso dell'host.`,
    );
  }
  if (typeof percorso !== "string" || percorso.length > 200 || !PERCORSO_NEL_CONTAINER.test(percorso) || !senzaPuntini(percorso)) {
    throw new Rifiuto(`Il volume "${nome}" del servizio "${servizio}" va montato in un percorso assoluto del container, per esempio /usr/share/nginx/html.`);
  }
  return { nome, percorso, solaLettura: campi.sola_lettura === true };
}

function leggiServizio(scritto: unknown, recinto: RecintoStack): ServizioStack {
  const campi = oggetto(scritto, "Un servizio");
  const nome = campi.nome;
  if (typeof nome !== "string" || !NOME_NELLO_STACK.test(nome)) {
    throw new Rifiuto("Ogni servizio ha un nome fatto di lettere minuscole, cifre e trattini, per esempio \"web\".");
  }
  soloCampi(campi, CAMPI_DEL_SERVIZIO, `Il servizio "${nome}"`);
  const immagine = campi.immagine;
  if (typeof immagine !== "string" || !IMMAGINE.test(immagine) || immagine.includes("..")) {
    throw new Rifiuto(`Il servizio "${nome}" non indica un'immagine valida: per esempio nginx:alpine, oppure ghcr.io/utente/immagine:1.2.`);
  }
  let comando: string[] | undefined;
  if (campi.comando !== undefined && campi.comando !== null) {
    comando = elenco(campi.comando, `Il comando del servizio "${nome}"`, PAROLE_DEL_COMANDO).map((parola) => {
      if (typeof parola !== "string" || parola.length > VALORE_VARIABILE_MASSIMO || parola.includes("\0")) {
        throw new Rifiuto(`Il comando del servizio "${nome}" è un elenco di parole, per esempio ["sh", "-c", "echo ciao"].`);
      }
      return parola;
    });
  }
  const ambiente: Record<string, string> = {};
  if (campi.ambiente !== undefined && campi.ambiente !== null) {
    const variabili = Object.entries(oggetto(campi.ambiente, `L'ambiente del servizio "${nome}"`));
    if (variabili.length > VARIABILI_PER_SERVIZIO) throw new Rifiuto(`Il servizio "${nome}" ha troppe variabili d'ambiente: al massimo ${VARIABILI_PER_SERVIZIO}.`);
    for (const [variabile, valore] of variabili) {
      const testo = typeof valore === "number" || typeof valore === "boolean" ? String(valore) : valore;
      if (!VARIABILE.test(variabile) || typeof testo !== "string" || testo.length > VALORE_VARIABILE_MASSIMO || testo.includes("\0")) {
        throw new Rifiuto(`La variabile d'ambiente "${variabile}" del servizio "${nome}" non è valida: nome con lettere, cifre e trattini bassi, e un testo come valore.`);
      }
      ambiente[variabile] = testo;
    }
  }
  const dipendeDa = elenco(campi.dipende_da, `Le dipendenze del servizio "${nome}"`, SERVIZI_PER_STACK).map((altro) => {
    if (typeof altro !== "string") throw new Rifiuto(`Le dipendenze del servizio "${nome}" sono nomi di altri servizi dello stack.`);
    return altro;
  });
  const memoria = campi.memoria_mb ?? MEMORIA_SERVIZIO_MB;
  if (typeof memoria !== "number" || !Number.isInteger(memoria) || memoria < MEMORIA_SERVIZIO_MINIMA_MB || memoria > MEMORIA_SERVIZIO_MASSIMA_MB) {
    throw new Rifiuto(`La memoria del servizio "${nome}" va da ${MEMORIA_SERVIZIO_MINIMA_MB} a ${MEMORIA_SERVIZIO_MASSIMA_MB} MB.`);
  }
  return {
    nome,
    immagine,
    ...(comando === undefined ? {} : { comando }),
    ambiente,
    porte: elenco(campi.porte, `Le porte del servizio "${nome}"`, PORTE_PER_SERVIZIO).map((porta) => leggiPorta(porta, nome, recinto)),
    volumi: elenco(campi.volumi, `I volumi del servizio "${nome}"`, VOLUMI_PER_SERVIZIO).map((volume) => leggiVolume(volume, nome)),
    dipendeDa,
    memoriaMb: memoria,
  };
}

/**
 * Legge la descrizione di uno stack come l'ha scritta Claude e la controlla contro il recinto
 * dell'host. Lancia `Rifiuto`, con il motivo, se qualcosa non va.
 */
export function leggiDescrizione(scritta: unknown, recinto: RecintoStack): DescrizioneStack {
  const campi = oggetto(scritta, "La descrizione dello stack");
  soloCampi(campi, CAMPI_DELLO_STACK, "Uno stack");
  const nome = campi.nome;
  if (typeof nome !== "string" || !NOME_STACK.test(nome)) {
    throw new Rifiuto("Il nome dello stack è fatto di lettere minuscole, cifre e trattini, da 2 a 31 caratteri: per esempio \"prova-blog\".");
  }
  const scritti = elenco(campi.servizi, "I servizi dello stack", SERVIZI_PER_STACK);
  if (scritti.length === 0) throw new Rifiuto("Uno stack ha almeno un servizio.");
  const servizi = scritti.map((servizio) => leggiServizio(servizio, recinto));

  const nomi = servizi.map((servizio) => servizio.nome);
  const doppio = nomi.find((uno, posto) => nomi.indexOf(uno) !== posto);
  if (doppio !== undefined) throw new Rifiuto(`Due servizi si chiamano "${doppio}".`);
  const porteViste = new Set<string>();
  for (const servizio of servizi) {
    for (const altro of servizio.dipendeDa) {
      if (altro === servizio.nome || !nomi.includes(altro)) throw new Rifiuto(`Il servizio "${servizio.nome}" dipende da "${altro}", che non è un altro servizio dello stack.`);
    }
    const montati = new Set<string>();
    for (const volume of servizio.volumi) {
      if (montati.has(volume.percorso)) throw new Rifiuto(`Il servizio "${servizio.nome}" monta due volumi in ${volume.percorso}.`);
      montati.add(volume.percorso);
    }
    for (const porta of servizio.porte) {
      const chiave = `${porta.host}/${porta.protocollo}`;
      if (porteViste.has(chiave)) throw new Rifiuto(`La porta ${porta.host} dell'host è chiesta due volte.`);
      porteViste.add(chiave);
    }
  }

  const volumi = new Set(servizi.flatMap((servizio) => servizio.volumi.map((volume) => volume.nome)));
  const file: FileStack[] = [];
  let caratteri = 0;
  for (const scritto of elenco(campi.file, "I file dello stack", FILE_PER_STACK)) {
    const dati = oggetto(scritto, "Un file dello stack");
    soloCampi(dati, ["volume", "percorso", "contenuto"], "Un file dello stack");
    const { volume, percorso, contenuto } = dati;
    if (typeof volume !== "string" || !volumi.has(volume)) {
      throw new Rifiuto(`Un file indica il volume "${String(volume)}", che nessun servizio monta: i file si scrivono in un volume dello stack.`);
    }
    if (typeof percorso !== "string" || percorso.length > 200 || !PERCORSO_NEL_VOLUME.test(percorso) || !senzaPuntini(percorso)) {
      throw new Rifiuto(`Il percorso di un file è relativo al suo volume, senza barra iniziale e senza "..": per esempio conf/default.conf.`);
    }
    if (typeof contenuto !== "string") throw new Rifiuto(`Al file ${percorso} manca il contenuto.`);
    if (file.some((altro) => altro.volume === volume && altro.percorso === percorso)) throw new Rifiuto(`Il file ${percorso} del volume "${volume}" è scritto due volte.`);
    caratteri += contenuto.length;
    file.push({ volume, percorso, contenuto });
  }
  if (caratteri > FILE_STACK_MASSIMO) {
    throw new Rifiuto(`I file dello stack sono troppo lunghi: insieme al massimo ${FILE_STACK_MASSIMO} caratteri. Servono per configurazioni e pagine piccole.`);
  }
  // Un volume in cui Shinka scrive dei file è riscritto da capo a ogni avvio, e i container lo
  // vedono in sola lettura: così ciò che gira in un container non può preparare lì una trappola.
  const conFile = new Set(file.map((uno) => uno.volume));
  for (const servizio of servizi) {
    for (const volume of servizio.volumi) if (conFile.has(volume.nome)) volume.solaLettura = true;
  }
  return { nome, servizi, file };
}

/** In ciò che Docker Compose legge, un `$` da solo chiederebbe una variabile dell'host: si raddoppia. */
function letterale(testo: string): string {
  return testo.split("$").join("$$");
}

/** Il nome che lo stack ha su Docker. */
export function nomeSuDocker(nome: string): string {
  return `${PREFISSO_STACK}${nome}`;
}

/**
 * Ciò che Docker Compose deve fare per questo stack. È scritto in JSON, che Compose legge come
 * YAML: nessun campo viene dalla descrizione senza essere passato da `leggiDescrizione`.
 */
export function componi(stack: DescrizioneStack, recinto: RecintoStack): Record<string, unknown> {
  return {
    name: nomeSuDocker(stack.nome),
    services: Object.fromEntries(
      stack.servizi.map((servizio) => [
        servizio.nome,
        {
          image: letterale(servizio.immagine),
          labels: { [ETICHETTA_STACK]: stack.nome },
          restart: "no",
          security_opt: ["no-new-privileges:true"],
          mem_limit: `${servizio.memoriaMb}m`,
          pids_limit: 1024,
          ...(servizio.comando === undefined ? {} : { command: servizio.comando.map(letterale) }),
          ...(Object.keys(servizio.ambiente).length === 0
            ? {}
            : { environment: Object.fromEntries(Object.entries(servizio.ambiente).map(([nome, valore]) => [nome, letterale(valore)])) }),
          ...(servizio.porte.length === 0
            ? {}
            : { ports: servizio.porte.map((porta) => ({ target: porta.container, published: String(porta.host), protocol: porta.protocollo })) }),
          ...(servizio.volumi.length === 0
            ? {}
            : {
                volumes: servizio.volumi.map((volume) => ({
                  type: "bind",
                  source: `${recinto.radice}/${stack.nome}/${volume.nome}`,
                  target: volume.percorso,
                  read_only: volume.solaLettura,
                })),
              }),
          ...(servizio.dipendeDa.length === 0 ? {} : { depends_on: servizio.dipendeDa }),
        },
      ]),
    ),
  };
}

/** Un testo tra apici per la shell dell'host. Qui arrivano solo nomi e percorsi già controllati. */
function tra(testo: string): string {
  return `'${testo.split("'").join("'\\''")}'`;
}

/**
 * Lo script che prepara sull'host la cartella dello stack: la segna come di Shinka, crea i
 * volumi e scrive i file. I volumi con file si rifanno da capo; quelli di dati restano.
 */
export function preparazione(stack: DescrizioneStack, recinto: RecintoStack): string {
  const cartella = `${recinto.radice}/${stack.nome}`;
  const conFile = new Set(stack.file.map((file) => file.volume));
  const volumi = [...new Set(stack.servizi.flatMap((servizio) => servizio.volumi.map((volume) => volume.nome)))];
  const righe = ["set -e", "umask 022", `mkdir -p ${tra(cartella)}`, `: > ${tra(`${cartella}/${SEGNO_DI_SHINKA}`)}`];
  for (const volume of volumi) {
    const percorso = `${cartella}/${volume}`;
    if (conFile.has(volume)) righe.push(`rm -rf -- ${tra(percorso)}`, `mkdir -p ${tra(percorso)}`);
    // Un volume di dati lo scrive il container, che spesso non gira come amministratore.
    else righe.push(`[ -d ${tra(percorso)} ] || { mkdir -p ${tra(percorso)} && chmod 0777 ${tra(percorso)}; }`);
  }
  for (const file of stack.file) {
    const percorso = `${cartella}/${file.volume}/${file.percorso}`;
    const codificato = Buffer.from(file.contenuto, "utf8").toString("base64").replace(/(.{76})/g, "$1\n");
    righe.push(
      `mkdir -p ${tra(percorso.slice(0, percorso.lastIndexOf("/")))}`,
      `base64 -d > ${tra(percorso)} <<'SHINKA_FILE'`,
      codificato.trimEnd(),
      "SHINKA_FILE",
    );
  }
  return `${righe.join("\n")}\n`;
}

/** Un container come lo riferisce Docker. */
interface Container {
  nome: string;
  etichetta: string;
  immagine: string;
  stato: string;
  dettaglio: string;
  porte: string;
}

const FORMATO = `{{.Names}}\\t{{.Label "${ETICHETTA_STACK}"}}\\t{{.Image}}\\t{{.State}}\\t{{.Status}}\\t{{.Ports}}`;
const SEPARATORE = "::cartella::";

function leggiContainer(uscita: string): Container[] {
  return uscita
    .split("\n")
    .filter((riga) => riga.trim() !== "")
    .map((riga) => {
      const [nome = "", etichetta = "", immagine = "", stato = "", dettaglio = "", porte = ""] = riga.split("\t");
      return { nome, etichetta, immagine, stato, dettaglio, porte: porte.trim() };
    });
}

function descrivi(container: Container): string {
  return `- ${container.nome}: ${container.immagine}, ${container.stato} (${container.dettaglio})${container.porte === "" ? "" : `, porte ${container.porte}`}`;
}

/** Ciò che c'è sull'host con il nome di uno stack: i suoi container e la sua cartella. */
interface Situazione {
  container: Container[];
  cartella: "nostra" | "estranea" | "assente";
}

/** Un'operazione in corso: l'host, la credenziale, e ciò che va scritto nel registro. */
interface Lavoro {
  credenziale: CredenzialePerUso;
  recinto: RecintoStack;
  host: string;
  valori: string[];
  annotato: boolean;
}

/** Il comando, sempre questo, con cui il gateway legge i container di un host e le loro risorse. */
const SEPARATORE_RISORSE = "::risorse::";
export const LEGGI_I_CONTAINER = `docker ps -a --no-trunc --format '{{json .}}' && echo '${SEPARATORE_RISORSE}' && docker stats --no-stream --format '{{json .}}'`;
const SECONDI_LETTURA_CONTAINER = 25;
const LETTURA_ANNOTATA_OGNI_MS = 15 * 60 * 1000;

export class StackDiProva {
  readonly #fonte: FonteDegliHost;
  readonly #registro: RegistroDegliStack;
  readonly #esegui: EseguiPerStack;
  /** Su un host le operazioni si fanno una alla volta. */
  readonly #code = new Map<string, Promise<unknown>>();
  /** Quando, per ogni host, la lettura dei container è finita l'ultima volta nel registro. */
  readonly #lettureAnnotate = new Map<string, number>();

  constructor(fonte: FonteDegliHost, registro: RegistroDegliStack, esegui: EseguiPerStack = eseguiSuHost) {
    this.#fonte = fonte;
    this.#registro = registro;
    this.#esegui = esegui;
  }

  /** Esegue un'operazione su uno stack. Non lancia mai: l'esito dice com'è andata. */
  async esegui(richiesta: RichiestaStack): Promise<EsitoStack> {
    const inizio = Date.now();
    const host = richiesta.operazione === "elenca" ? (richiesta.host ?? "") : richiesta.host;
    let credenziale = "";
    let esito: EsitoStack;
    try {
      if (richiesta.operazione === "elenca") {
        esito = { esito: "fatto", testo: await this.#elenca(richiesta.host) };
      } else {
        const lavoro = this.#lavoro(richiesta.host);
        credenziale = lavoro.credenziale.nome;
        esito = { esito: "fatto", testo: await this.#inFila(lavoro.host, () => this.#opera(lavoro, richiesta)) };
      }
    } catch (errore) {
      if (errore instanceof Rifiuto || errore instanceof VaultChiuso || errore instanceof UsoRifiutato) {
        esito = { esito: "rifiutato", motivo: errore.message };
      } else if (errore instanceof ErroreSsh) {
        esito = { esito: errore.causaSsh === "impronta" ? "rifiutato" : "fallito", motivo: errore.message };
      } else {
        esito = { esito: "fallito", motivo: errore instanceof Error ? errore.message : String(errore) };
      }
    }
    await this.#annota({
      quando: new Date().toISOString(),
      credenziale,
      host: host.slice(0, 200),
      conversazione: richiesta.conversazione.slice(0, 200),
      comando: inParole(richiesta),
      esito: esito.esito === "fatto" ? "eseguito" : esito.esito,
      ...(esito.esito === "fatto" ? {} : { motivo: esito.motivo.slice(0, 2000) }),
      durataMs: Date.now() - inizio,
    });
    return esito;
  }

  /**
   * I container di ogni host per gli stack, con le loro risorse: per la pagina con cui il
   * proprietario guarda i suoi ambienti (ADR 0038). Legge soltanto, con un comando fisso, e non
   * aspetta le operazioni sugli stack. Nel registro finisce una riga per host ogni quarto d'ora in
   * cui la pagina resta aperta, non una a ogni lettura. Lancia `VaultChiuso` a vault chiuso.
   */
  async contenitori(): Promise<DockerDiUnHost[]> {
    const letti: DockerDiUnHost[] = [];
    for (const dichiarato of this.#fonte.hostPerGliStack()) {
      const lavoro = this.#lavoro(dichiarato.host);
      const inizio = Date.now();
      const daAnnotare = inizio - (this.#lettureAnnotate.get(lavoro.host) ?? 0) > LETTURA_ANNOTATA_OGNI_MS;
      let letto: DockerDiUnHost;
      try {
        const eseguito = await this.#esegui(lavoro.credenziale, LEGGI_I_CONTAINER, SECONDI_LETTURA_CONTAINER * 1000);
        // L'impronta dell'host si ricorda al primo collegamento, come per ogni altro uso.
        if (daAnnotare || lavoro.credenziale.impronta === undefined) await this.#fonte.annotaUso(lavoro.credenziale.nome, lavoro.host, eseguito.impronta);
        const [ps = "", stats = ""] = nascondi(eseguito.uscita, lavoro.valori).split(`${SEPARATORE_RISORSE}\n`);
        if (eseguito.codice === 127) letto = { host: lavoro.host, stato: "assente", contenitori: [] };
        else if (eseguito.scaduto || (eseguito.codice !== 0 && ps.trim() === "")) {
          const detto = (nascondi(eseguito.errori, lavoro.valori).trim().split("\n")[0] ?? "").slice(0, 300);
          letto = { host: lavoro.host, stato: "non-raggiungibile", motivo: eseguito.scaduto ? "L'host non ha risposto in tempo." : detto === "" ? "Docker non ha risposto." : detto, contenitori: [] };
        } else letto = { host: lavoro.host, stato: "attivo", contenitori: contenitoriDa(ps, stats, ETICHETTA_STACK) };
      } catch (errore) {
        if (errore instanceof VaultChiuso) throw errore;
        letto = { host: lavoro.host, stato: "non-raggiungibile", motivo: (errore instanceof Error ? errore.message : String(errore)).slice(0, 300), contenitori: [] };
      }
      if (daAnnotare) {
        this.#lettureAnnotate.set(lavoro.host, inizio);
        await this.#annota({
          quando: new Date(inizio).toISOString(),
          credenziale: lavoro.credenziale.nome,
          host: lavoro.host.slice(0, 200),
          conversazione: "Pagina Ambienti",
          comando: "Lettura dei container e delle loro risorse, per la pagina del proprietario (sola lettura; si ripete finché la pagina è aperta)",
          esito: letto.stato === "non-raggiungibile" ? "fallito" : "eseguito",
          ...(letto.motivo === undefined ? {} : { motivo: letto.motivo }),
          durataMs: Date.now() - inizio,
        });
      }
      letti.push(letto);
    }
    return letti;
  }

  #lavoro(host: string): Lavoro {
    const trovato = this.#fonte.perStack(host);
    return { ...trovato, valori: daNascondere(trovato.credenziale), annotato: false };
  }

  #inFila<T>(host: string, lavoro: () => Promise<T>): Promise<T> {
    const prima = this.#code.get(host) ?? Promise.resolve();
    const adesso = prima.then(lavoro, lavoro);
    this.#code.set(
      host,
      adesso.catch(() => {}),
    );
    return adesso;
  }

  /** Un comando sull'host. Restituisce ciò che ha scritto; se non riesce lancia `Fallimento`. */
  async #lancia(lavoro: Lavoro, comando: string, secondi: number, ingresso?: string): Promise<string> {
    const eseguito = await this.#esegui(lavoro.credenziale, comando, secondi * 1000, ingresso);
    if (!lavoro.annotato) {
      lavoro.annotato = true;
      await this.#fonte.annotaUso(lavoro.credenziale.nome, lavoro.host, eseguito.impronta);
    }
    const uscita = nascondi(eseguito.uscita, lavoro.valori);
    const errori = nascondi(eseguito.errori, lavoro.valori).trim();
    if (eseguito.scaduto) {
      throw new Fallimento(`L'host non ha finito in ${secondi} secondi: non è detto che l'operazione sia arrivata in fondo. Controlla con leggi_stack.\n${errori.slice(-2000)}`);
    }
    if (eseguito.codice !== 0) {
      const dettaglio = (errori === "" ? uscita.trim() : errori).slice(-3000);
      throw new Fallimento(
        /compose.*is not a docker command|unknown shorthand flag: 'p'/i.test(dettaglio)
          ? "Su questo host manca Docker Compose (versione 2): gli stack di prova ne hanno bisogno. Dillo al proprietario."
          : `L'host ha risposto con un errore (codice ${eseguito.codice ?? "sconosciuto"}):\n${dettaglio}`,
      );
    }
    return uscita;
  }

  async #situazione(lavoro: Lavoro, nome: string): Promise<Situazione> {
    const cartella = `${lavoro.recinto.radice}/${nome}`;
    const uscita = await this.#lancia(
      lavoro,
      `docker ps -a --filter ${tra(`label=com.docker.compose.project=${nomeSuDocker(nome)}`)} --format ${tra(FORMATO)} || exit 9; ` +
        `echo ${tra(SEPARATORE)}; ` +
        `if [ -e ${tra(cartella)} ]; then if [ -f ${tra(`${cartella}/${SEGNO_DI_SHINKA}`)} ]; then echo nostra; else echo estranea; fi; else echo assente; fi`,
      SECONDI_OPERAZIONE_STACK,
    );
    const [prima = "", dopo = ""] = uscita.split(SEPARATORE);
    const letta = dopo.trim();
    return { container: leggiContainer(prima), cartella: letta === "nostra" || letta === "estranea" ? letta : "assente" };
  }

  /** Ciò che su Docker ha il nome dello stack ma non l'etichetta di Shinka non è di Shinka: non si tocca. */
  #soloNostri(lavoro: Lavoro, nome: string, situazione: Situazione, consiglio: string): void {
    const estranei = situazione.container.filter((container) => container.etichetta !== nome);
    if (estranei.length > 0) {
      throw new Rifiuto(
        `Su ${lavoro.host} c'è già qualcosa che si chiama ${nomeSuDocker(nome)} e non è stato creato da Shinka (${estranei.map((container) => container.nome).join(", ")}): non lo tocco. ${consiglio}`,
      );
    }
  }

  async #opera(lavoro: Lavoro, richiesta: Exclude<RichiestaStack, { operazione: "elenca" }>): Promise<string> {
    if (richiesta.operazione === "avvia") return this.#avvia(lavoro, richiesta.stack);
    if (!NOME_STACK.test(richiesta.nome)) throw new Rifiuto("Il nome dello stack è fatto di lettere minuscole, cifre e trattini.");
    const nome = richiesta.nome;
    const progetto = nomeSuDocker(nome);
    const situazione = await this.#situazione(lavoro, nome);
    this.#soloNostri(lavoro, nome, situazione, "Per agire su un servizio che non è di Shinka serve l'approvazione del proprietario: si chiede con esegui_su_host.");
    const assente = `Su ${lavoro.host} non c'è uno stack di Shinka di nome "${nome}". Con elenca_stack vedi quelli che ci sono.`;

    switch (richiesta.operazione) {
      case "leggi": {
        if (situazione.container.length === 0) throw new Rifiuto(assente);
        const righe = Math.min(Math.max(Math.round(richiesta.righe ?? RIGHE_STACK), 1), RIGHE_STACK_MASSIME);
        const uscita = await this.#lancia(lavoro, `docker compose -p ${tra(progetto)} logs --no-color --tail ${righe} 2>&1`, SECONDI_OPERAZIONE_STACK);
        return [
          `Stack "${nome}" su ${lavoro.host}:`,
          ...situazione.container.map(descrivi),
          "",
          `Ultime righe scritte dai servizi (al massimo ${righe} ciascuno):`,
          uscita.trim() === "" ? "(nessuna)" : uscita.trimEnd(),
        ].join("\n");
      }
      case "ferma": {
        if (situazione.container.length === 0) throw new Rifiuto(assente);
        await this.#lancia(lavoro, `docker compose -p ${tra(progetto)} stop`, SECONDI_OPERAZIONE_STACK);
        let dopo = await this.#situazione(lavoro, nome);
        // Appena fermato, per qualche istante Docker può ancora riferire il container come acceso.
        if (dopo.container.some((container) => container.stato === "running")) {
          await this.#lancia(lavoro, "sleep 3", SECONDI_OPERAZIONE_STACK);
          dopo = await this.#situazione(lavoro, nome);
        }
        return [`Stack "${nome}" fermato su ${lavoro.host}. I container e i dati restano: avvia_stack lo fa ripartire, rimuovi_stack lo toglie.`, ...dopo.container.map(descrivi)].join("\n");
      }
      case "rimuovi": {
        if (situazione.container.length === 0 && situazione.cartella !== "nostra") throw new Rifiuto(assente);
        if (situazione.container.length > 0) {
          await this.#lancia(lavoro, `docker compose -p ${tra(progetto)} down --remove-orphans`, SECONDI_OPERAZIONE_STACK);
        }
        const cartella = `${lavoro.recinto.radice}/${nome}`;
        const togliDati = richiesta.tieniDati !== true && situazione.cartella === "nostra";
        if (togliDati) {
          // Si cancella soltanto una cartella che porta il segno di Shinka.
          await this.#lancia(
            lavoro,
            `if [ -f ${tra(`${cartella}/${SEGNO_DI_SHINKA}`)} ]; then rm -rf -- ${tra(cartella)}; else echo 'La cartella non porta il segno di Shinka.' >&2; exit 4; fi`,
            SECONDI_OPERAZIONE_STACK,
          );
        }
        return (
          `Stack "${nome}" rimosso da ${lavoro.host}: container e rete non ci sono più.` +
          (togliDati
            ? ` Cancellata anche la sua cartella ${cartella}.`
            : situazione.cartella === "nostra"
              ? ` La sua cartella ${cartella} è rimasta, con i dati.`
              : "")
        );
      }
    }
  }

  async #avvia(lavoro: Lavoro, scritta: unknown): Promise<string> {
    const stack = leggiDescrizione(scritta, lavoro.recinto);
    const situazione = await this.#situazione(lavoro, stack.nome);
    this.#soloNostri(lavoro, stack.nome, situazione, "Scegli un altro nome per lo stack.");
    const cartella = `${lavoro.recinto.radice}/${stack.nome}`;
    if (situazione.cartella === "estranea") {
      throw new Rifiuto(`Su ${lavoro.host} la cartella ${cartella} esiste già e non è di Shinka: non la tocco. Scegli un altro nome per lo stack.`);
    }
    await this.#lancia(lavoro, "sh -s", SECONDI_OPERAZIONE_STACK, preparazione(stack, lavoro.recinto));
    await this.#lancia(
      lavoro,
      `docker compose -p ${tra(nomeSuDocker(stack.nome))} -f - up -d --remove-orphans --quiet-pull`,
      SECONDI_AVVIO_STACK,
      JSON.stringify(componi(stack, lavoro.recinto)),
    );
    const dopo = await this.#situazione(lavoro, stack.nome);
    const macchina = lavoro.host.slice(0, lavoro.host.lastIndexOf(":"));
    const porte = stack.servizi.flatMap((servizio) =>
      servizio.porte.map((porta) => `- ${macchina}:${porta.host} (${porta.protocollo}) → servizio "${servizio.nome}", porta ${porta.container}`),
    );
    const conFile = [...new Set(stack.file.map((file) => file.volume))];
    return [
      `Stack "${stack.nome}" ${situazione.container.length === 0 ? "avviato" : "riavviato con la descrizione di adesso"} su ${lavoro.host}.`,
      ...dopo.container.map(descrivi),
      ...(porte.length === 0 ? [] : ["Porte pubblicate sull'host:", ...porte]),
      ...(conFile.length === 0
        ? []
        : [`Scritti ${stack.file.length} file. I volumi con file (${conFile.join(", ")}) sono in sola lettura per i container, e a ogni avvio si riscrivono da capo.`]),
      "Un container che risulta running può ancora non essere pronto, o essersi chiuso subito: con leggi_stack vedi che cosa ha scritto.",
    ].join("\n");
  }

  async #elenca(host: string | undefined): Promise<string> {
    const dichiarati = host === undefined || host.trim() === "" ? this.#fonte.hostPerGliStack() : [this.#fonte.perStack(host)];
    if (dichiarati.length === 0) {
      return "Il proprietario non ha ancora dichiarato nessun host per gli stack di prova: lo fa dalla pagina del vault, inserendo la credenziale dell'host e segnandolo come host per gli stack.";
    }
    const righe = ["Host per gli stack di prova, e gli stack di Shinka che ci sono:"];
    for (const dichiarato of dichiarati) {
      const recinto = dichiarato.recinto;
      righe.push(`Host ${dichiarato.host}: porte dedicate da ${recinto.porte.da} a ${recinto.porte.a}, volumi sotto ${recinto.radice}`);
      try {
        const lavoro = this.#lavoro(dichiarato.host);
        const uscita = await this.#inFila(lavoro.host, () =>
          this.#lancia(lavoro, `docker ps -a --filter ${tra(`label=${ETICHETTA_STACK}`)} --format ${tra(FORMATO)}`, SECONDI_OPERAZIONE_STACK),
        );
        const container = leggiContainer(uscita);
        const stack = [...new Set(container.map((uno) => uno.etichetta))].sort();
        if (stack.length === 0) righe.push("  (nessuno stack)");
        for (const nome of stack) {
          righe.push(`  Stack "${nome}":`, ...container.filter((uno) => uno.etichetta === nome).map((uno) => `  ${descrivi(uno)}`));
        }
      } catch (errore) {
        if (errore instanceof VaultChiuso) throw errore;
        righe.push(`  Non è stato possibile chiederlo all'host: ${errore instanceof Error ? errore.message : String(errore)}`);
      }
    }
    return righe.join("\n");
  }

  async #annota(voce: VoceRegistro): Promise<void> {
    try {
      await this.#registro.annota(voce);
    } catch (errore) {
      console.error(`Registro non scritto (${voce.quando}, ${voce.esito}): ${errore instanceof Error ? errore.message : String(errore)}`);
    }
  }
}

/** L'operazione in parole, per il registro: senza i valori delle variabili né il contenuto dei file. */
function inParole(richiesta: RichiestaStack): string {
  switch (richiesta.operazione) {
    case "elenca":
      return "Stack di prova: elenco";
    case "ferma":
      return `Stack "${richiesta.nome.slice(0, 40)}": fermata`;
    case "leggi":
      return `Stack "${richiesta.nome.slice(0, 40)}": lettura dello stato e dell'uscita`;
    case "rimuovi":
      return `Stack "${richiesta.nome.slice(0, 40)}": rimozione${richiesta.tieniDati === true ? ", tenendo i dati" : ", con i suoi dati"}`;
    case "avvia": {
      const scritta = typeof richiesta.stack === "object" && richiesta.stack !== null ? (richiesta.stack as Record<string, unknown>) : {};
      const servizi = (Array.isArray(scritta.servizi) ? scritta.servizi : []).slice(0, SERVIZI_PER_STACK).map((servizio: unknown) => {
        const campi = typeof servizio === "object" && servizio !== null ? (servizio as Record<string, unknown>) : {};
        const porte = (Array.isArray(campi.porte) ? campi.porte : [])
          .slice(0, PORTE_PER_SERVIZIO)
          .map((porta: unknown) => (typeof porta === "object" && porta !== null ? String((porta as Record<string, unknown>).host).slice(0, 8) : "?"));
        return `${String(campi.nome).slice(0, 40)} (${String(campi.immagine).slice(0, 120)}${porte.length === 0 ? "" : `; porte ${porte.join(", ")}`})`;
      });
      const file = Array.isArray(scritta.file) ? scritta.file.length : 0;
      return `Stack "${String(scritta.nome).slice(0, 40)}": avvio. Servizi: ${servizi.join("; ")}${file === 0 ? "" : `. File scritti: ${file}`}`;
    }
  }
}
