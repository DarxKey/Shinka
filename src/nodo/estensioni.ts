/**
 * Le estensioni viste da un ambiente: quelle che il centro vi ha acceso, pronte per le
 * conversazioni che partono lì; la prova con cui un'estensione viene avviata una volta prima di
 * essere accesa; e lo sguardo a ciò che il proprietario ha già installato per conto suo.
 *
 * La prova e lo sguardo usano l'harness stesso, senza nessun turno: un processo di Claude Code a
 * cui non si scrive nulla risponde comunque a chi gli chiede dei suoi server e dei suoi plugin.
 * Così un'estensione viene provata da chi poi la userà, e non costa nulla all'abbonamento.
 *
 * Nella configurazione personale di Claude Code dell'ambiente qui non si scrive mai.
 */

import { query, type McpServerConfig, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { ambientePerHarness, fonteConfigurata } from "../harness/autenticazione.ts";
import {
  ATTESA_PROVA_MS,
  SKILL_ELENCATE,
  type AggancioDiPlugin,
  type ChiaviConsegnate,
  type ContenutoPlugin,
  type DefinizioneEstensione,
  type EsitoProva,
  type EstensioneDistribuita,
  type EstensioniDellAmbiente,
} from "../protocollo/estensioni.ts";

type DefinizionePlugin = Extract<DefinizioneEstensione, { tipo: "plugin" }>;

/** Com'è andato un comando di git: il codice di uscita e ciò che ha scritto. */
export type Git = (cartella: string, argomenti: string[]) => Promise<{ codice: number; uscita: string }>;

/** Git non deve mai fermarsi a chiedere un nome utente: un repository che lo vuole non si prende. */
export const gitVero: Git = (cartella, argomenti) =>
  new Promise((risolvi) => {
    execFile(
      "git",
      argomenti,
      {
        cwd: cartella,
        windowsHide: true,
        timeout: 120_000,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" },
      },
      (errore, stdout, stderr) => {
        const codice = errore === null ? 0 : typeof errore.code === "number" ? errore.code : 1;
        risolvi({ codice, uscita: `${stdout}${stderr}`.trim() });
      },
    );
  });

/** Ciò che serve dell'harness per provare un'estensione e per guardare un ambiente. */
export interface HarnessSenzaTurni {
  setMcpServers(server: Record<string, McpServerConfig>): Promise<{ errors: Record<string, string> }>;
  mcpServerStatus(): Promise<{ name: string; status: string; error?: string; scope?: string; source?: string; tools?: { name: string }[] }[]>;
  reloadPlugins(): Promise<{
    plugins: { name: string; path: string; source?: string; version?: string }[];
    mcpServers: { name: string; scope?: string; source?: string }[];
    commands: { name: string; builtin?: boolean }[];
    error_count: number;
  }>;
  close(): void;
}

export interface AperturaHarness {
  cartella: string;
  /** Vero se non devono valere le impostazioni dell'ambiente: l'harness vede solo ciò che gli si dà. */
  isolata: boolean;
  /** Cartelle di plugin da caricare. */
  plugin?: string[];
}

export type ApriHarness = (apertura: AperturaHarness) => HarnessSenzaTurni;

/** Una conversazione a cui nessuno scrive: resta aperta finché non la si chiude. */
async function* nessunMessaggio(fine: Promise<void>): AsyncGenerator<SDKUserMessage> {
  await fine;
}

const apriHarnessVero: ApriHarness = ({ cartella, isolata, plugin = [] }) => {
  let basta: () => void = () => {};
  const fine = new Promise<void>((fatto) => (basta = fatto));
  const sessione = query({
    prompt: nessunMessaggio(fine),
    options: {
      cwd: cartella,
      env: ambientePerHarness(fonteConfigurata()),
      ...(isolata ? { settingSources: [], strictMcpConfig: true } : {}),
      ...(plugin.length === 0 ? {} : { plugins: plugin.map((path) => ({ type: "local" as const, path })) }),
    },
  });
  // L'harness lavora solo se qualcuno legge ciò che dice: qui non dirà nulla.
  void (async () => {
    for await (const messaggio of sessione) void messaggio;
  })().catch(() => {});
  return {
    setMcpServers: (server) => sessione.setMcpServers(server),
    mcpServerStatus: () => sessione.mcpServerStatus(),
    reloadPlugins: () => sessione.reloadPlugins(),
    close: () => {
      basta();
      sessione.close();
    },
  };
};

function entro<T>(promessa: Promise<T>, ms: number, motivo: string): Promise<T> {
  return new Promise<T>((risolvi, rifiuta) => {
    const sveglia = setTimeout(() => rifiuta(new Error(motivo)), ms);
    sveglia.unref();
    promessa.then(
      (valore) => {
        clearTimeout(sveglia);
        risolvi(valore);
      },
      (errore: unknown) => {
        clearTimeout(sveglia);
        rifiuta(errore instanceof Error ? errore : new Error(String(errore)));
      },
    );
  });
}

function inParole(errore: unknown): string {
  return errore instanceof Error ? errore.message : String(errore);
}

/** Come l'harness vuole la definizione di un server, con le sue chiavi al loro posto. Nulla per un plugin. */
export function configurazioneDelServer(
  definizione: DefinizioneEstensione,
  chiavi: Record<string, string> = {},
): McpServerConfig | undefined {
  switch (definizione.tipo) {
    case "mcp-locale":
      return { command: definizione.comando, args: definizione.argomenti, env: { ...definizione.variabili, ...chiavi } };
    case "mcp-remoto":
      return { type: definizione.trasporto, url: definizione.indirizzo, ...(Object.keys(chiavi).length === 0 ? {} : { headers: chiavi }) };
    case "plugin":
      return undefined;
  }
}

/** Il file che dice che la cartella di un plugin è stata presa per intero. */
const PRONTO = ".shinka-pronto";

/**
 * Prende un plugin dal suo repository, fermo al commit indicato, in una cartella sotto `base`.
 * Se c'è già non lo riprende. Non esegue nulla di ciò che il repository contiene.
 */
export async function preparaPlugin(
  base: string,
  chiave: string,
  definizione: DefinizionePlugin,
  git: Git = gitVero,
): Promise<{ radice: string } | { motivo: string }> {
  const dove = join(base, cartellaDelPlugin(chiave, definizione));
  const radice = definizione.cartella === undefined ? dove : resolve(dove, definizione.cartella);
  const dentro = relative(dove, radice);
  if (dentro.startsWith("..") || isAbsolute(dentro)) return { motivo: "La cartella indicata esce dal repository." };
  if (!existsSync(join(dove, PRONTO))) {
    await rm(dove, { recursive: true, force: true });
    await mkdir(dove, { recursive: true });
    const { repository, commit } = definizione;
    for (const passo of [
      ["init", "--quiet"],
      ["remote", "add", "origin", repository],
    ]) {
      const fatto = await git(dove, passo);
      if (fatto.codice !== 0) return { motivo: `Git non ha preparato la cartella: ${fatto.uscita}` };
    }
    // Prima solo quel commit; se il repository non lo concede, tutto.
    let preso = await git(dove, ["fetch", "--quiet", "--depth", "1", "origin", commit]);
    if (preso.codice !== 0) preso = await git(dove, ["fetch", "--quiet", "origin"]);
    if (preso.codice !== 0) return { motivo: `Il repository non si è potuto leggere: ${preso.uscita.slice(0, 400)}` };
    // Un collegamento dentro il repository non deve portare fuori dalla cartella.
    const fuori = await git(dove, ["-c", "core.symlinks=false", "checkout", "--quiet", "--detach", commit]);
    if (fuori.codice !== 0) return { motivo: `Il commit ${commit.slice(0, 12)} non c'è in quel repository: ${fuori.uscita.slice(0, 400)}` };
    await writeFile(join(dove, PRONTO), `${repository}\n${commit}\n`);
  }
  if (!existsSync(join(radice, ".claude-plugin", "plugin.json"))) {
    const altri = await pluginDelMercato(dove);
    return {
      motivo:
        "In quella cartella non c'è un plugin di Claude Code (manca .claude-plugin/plugin.json)." +
        (altri.length === 0 ? "" : ` Il repository ne raccoglie più d'uno, in queste cartelle: ${altri.join(", ")}.`),
    };
  }
  return { radice };
}

function cartellaDelPlugin(chiave: string, definizione: DefinizionePlugin): string {
  return `${chiave}-${definizione.commit.slice(0, 12)}`;
}

/** Le cartelle dei plugin che un repository raccoglie, se è una raccolta. */
async function pluginDelMercato(cartella: string): Promise<string[]> {
  const letto = await leggiJson(join(cartella, ".claude-plugin", "marketplace.json"));
  const plugin = oggetto(letto)?.plugins;
  if (!Array.isArray(plugin)) return [];
  return plugin
    .map((uno) => oggetto(uno)?.source)
    .filter((fonte): fonte is string => typeof fonte === "string")
    .map((fonte) => fonte.replace(/^\.\//, ""))
    .slice(0, 30);
}

/**
 * Trova il commit a cui un riferimento (un ramo, un'etichetta, oppure nulla per quello predefinito)
 * punta adesso in un repository. Un commit scritto per intero resta com'è.
 */
export async function risolviCommit(
  repository: string,
  riferimento: string | undefined,
  git: Git = gitVero,
  cartella: string = process.cwd(),
): Promise<{ commit: string } | { motivo: string }> {
  const scritto = riferimento?.trim() ?? "";
  if (/^[0-9a-f]{40}$/i.test(scritto)) return { commit: scritto.toLowerCase() };
  if (scritto.startsWith("-")) return { motivo: "Il riferimento non è valido." };
  const cosa = scritto === "" ? ["HEAD"] : [scritto, `${scritto}^{}`];
  const letto = await git(cartella, ["ls-remote", repository, ...cosa]);
  if (letto.codice !== 0) return { motivo: `Il repository non si è potuto leggere: ${letto.uscita.slice(0, 400)}` };
  const righe = letto.uscita
    .split(/\r?\n/)
    .map((riga) => riga.trim().split(/\s+/))
    .filter((parti) => /^[0-9a-f]{40}$/.test(parti[0] ?? ""));
  // Un'etichetta annotata ha due righe: quella che finisce con ^{} è il commit.
  const scelta = righe.find((parti) => parti[1]?.endsWith("^{}")) ?? righe[0];
  if (scelta?.[0] === undefined) {
    return {
      motivo:
        scritto === ""
          ? "Il repository non dice qual è il suo ramo predefinito."
          : `Nel repository non c'è un ramo o un'etichetta "${scritto}". Un commit va scritto per intero, con tutti i quaranta caratteri.`,
    };
  }
  return { commit: scelta[0] };
}

async function leggiJson(file: string): Promise<unknown> {
  try {
    return JSON.parse((await readFile(file, "utf8")).replace(/^﻿/, ""));
  } catch {
    return undefined;
  }
}

function oggetto(valore: unknown): Record<string, unknown> | undefined {
  return typeof valore === "object" && valore !== null && !Array.isArray(valore) ? (valore as Record<string, unknown>) : undefined;
}

function testo(valore: unknown): string | undefined {
  return typeof valore === "string" && valore.trim() !== "" ? valore.trim() : undefined;
}

async function nomiIn(cartella: string, vale: (nome: string, eCartella: boolean) => string | undefined): Promise<string[]> {
  try {
    const voci = await readdir(cartella, { withFileTypes: true });
    return voci
      .map((voce) => vale(voce.name, voce.isDirectory()))
      .filter((nome): nome is string => nome !== undefined)
      .sort();
  } catch {
    return [];
  }
}

/** I comandi che una dichiarazione di agganci fa partire, evento per evento. */
function agganciDi(dichiarati: unknown): AggancioDiPlugin[] {
  const dichiarazione = oggetto(dichiarati);
  if (dichiarazione === undefined) return [];
  const trovati: AggancioDiPlugin[] = [];
  // Un modulo è codice del plugin che l'harness carica da sé: conta quanto un comando che parte da solo.
  if (Array.isArray(dichiarazione.modules)) {
    for (const modulo of dichiarazione.modules) trovati.push({ evento: "codice del plugin", comando: testo(modulo) ?? "modulo non leggibile" });
  }
  const eventi = oggetto(dichiarazione.hooks ?? dichiarazione);
  if (eventi === undefined) return trovati;
  for (const [evento, gruppi] of Object.entries(eventi)) {
    if (!Array.isArray(gruppi) || evento === "modules") continue;
    for (const gruppo of gruppi) {
      const azioni = oggetto(gruppo)?.hooks;
      if (!Array.isArray(azioni)) continue;
      for (const azione of azioni) {
        const dati = oggetto(azione);
        const comando = testo(dati?.command) ?? testo(dati?.prompt) ?? testo(dati?.url) ?? testo(dati?.type) ?? "comando non leggibile";
        trovati.push({ evento, comando: comando.length > 240 ? `${comando.slice(0, 240)}…` : comando });
      }
    }
  }
  return trovati;
}

/** Le voci del manifesto di un plugin di cui la scheda sa dire qualcosa, o che non fanno nulla. */
const VOCI_NOTE_DEL_MANIFESTO = new Set([
  "$schema",
  "name",
  "version",
  "description",
  "author",
  "homepage",
  "repository",
  "license",
  "keywords",
  "skills",
  "commands",
  "agents",
  "hooks",
  "mcpServers",
  "lspServers",
  "monitors",
]);

/** Ciò che nella cartella di un plugin la scheda descrive già, o che è di Shinka e di git. */
const FILE_NOTI_DEL_PLUGIN = new Set([".claude-plugin", "skills", "commands", "agents", "hooks", ".mcp.json", ".lsp.json", "bin", "monitors", ".git", PRONTO]);

/** File che non fanno nulla: documentazione, licenze, impostazioni di git. */
const FILE_SENZA_PESO = /^(readme|license|licence|changelog|notice|contributing)(\..*)?$|\.md$|^\.git(ignore|attributes)$/i;

/** Pochi nomi, e quanti ne restano. */
function alcuni(nomi: string[], quanti = 8): string {
  return nomi.length <= quanti ? nomi.join(", ") : `${nomi.slice(0, quanti).join(", ")} e altri ${nomi.length - quanti}`;
}

/** I nomi dei server che una dichiarazione elenca: sotto `mcpServers`, oppure direttamente. */
function serverDi(dichiarati: unknown): string[] {
  const dentro = oggetto(dichiarati);
  if (dentro === undefined) return [];
  return Object.keys(oggetto(dentro.mcpServers) ?? dentro);
}

/** Ciò che una voce del manifesto dichiara: scritto lì, oppure in un file accanto. */
async function dichiarato(radice: string, voce: unknown): Promise<unknown> {
  if (typeof voce !== "string") return voce;
  const file = resolve(radice, voce);
  const dentro = relative(radice, file);
  return dentro.startsWith("..") || isAbsolute(dentro) ? undefined : leggiJson(file);
}

/** Che cosa c'è dentro un plugin: lo dicono i suoi file, senza eseguire nulla. */
export async function leggiContenutoPlugin(radice: string): Promise<ContenutoPlugin> {
  const manifesto = oggetto(await leggiJson(join(radice, ".claude-plugin", "plugin.json"))) ?? {};
  const nome = testo(manifesto.name);
  const versione = testo(manifesto.version);
  const descrizione = testo(manifesto.description);
  const skill = await nomiIn(join(radice, "skills"), (voce, eCartella) =>
    eCartella && existsSync(join(radice, "skills", voce, "SKILL.md")) ? voce : undefined,
  );
  const soloMd = (voce: string, eCartella: boolean): string | undefined =>
    !eCartella && voce.toLowerCase().endsWith(".md") ? voce.slice(0, -3) : undefined;
  const comandi = await nomiIn(join(radice, "commands"), soloMd);
  const agenti = await nomiIn(join(radice, "agents"), soloMd);
  const agganci = [
    ...agganciDi(await leggiJson(join(radice, "hooks", "hooks.json"))),
    ...agganciDi(await dichiarato(radice, manifesto.hooks)),
  ];
  // Agganci scritti in una forma che Shinka non conosce restano codice che può partire da solo: la scheda lo dice.
  if (agganci.length === 0 && (existsSync(join(radice, "hooks")) || manifesto.hooks !== undefined)) {
    agganci.push({ evento: "non letto", comando: "agganci dichiarati in una forma che Shinka non sa leggere" });
  }
  const server = [
    ...new Set([...serverDi(await leggiJson(join(radice, ".mcp.json"))), ...serverDi(await dichiarato(radice, manifesto.mcpServers))]),
  ];
  const altro: string[] = [];
  if (existsSync(join(radice, ".lsp.json")) || manifesto.lspServers !== undefined) altro.push("server di linguaggio (LSP), che l'harness avvia da sé");
  if (existsSync(join(radice, "bin"))) altro.push("programmi nella cartella bin");
  if (existsSync(join(radice, "monitors")) || manifesto.monitors !== undefined) altro.push("monitor, che restano in esecuzione durante la conversazione");
  // Ciò che la scheda non sa descrivere lo nomina almeno: il proprietario non conferma credendo che non ci sia altro.
  if (["skills", "commands", "agents"].some((voce) => manifesto[voce] !== undefined)) {
    altro.push("skill, comandi o agenti in cartelle scelte dal plugin, che questa scheda non elenca");
  }
  const sconosciute = Object.keys(manifesto).filter((voce) => !VOCI_NOTE_DEL_MANIFESTO.has(voce));
  if (sconosciute.length > 0) altro.push(`voci del manifesto che Shinka non conosce (${alcuni(sconosciute)})`);
  const altriFile = await nomiIn(radice, (voce) => (FILE_NOTI_DEL_PLUGIN.has(voce) || FILE_SENZA_PESO.test(voce) ? undefined : voce));
  if (altriFile.length > 0) altro.push(`altri file e cartelle (${alcuni(altriFile)})`);
  return {
    ...(nome === undefined ? {} : { nome }),
    ...(versione === undefined ? {} : { versione }),
    ...(descrizione === undefined ? {} : { descrizione }),
    skill,
    comandi,
    agenti,
    agganci: agganci.slice(0, 20),
    server,
    altro,
  };
}

/**
 * Guarda un plugin prima di proporlo: trova il commit, lo prende in una cartella provvisoria,
 * legge che cosa contiene e butta via la cartella. Serve al centro per scrivere la scheda.
 */
export async function esaminaPlugin(
  provvisoria: string,
  repository: string,
  riferimento: string | undefined,
  cartella: string | undefined,
  git: Git = gitVero,
): Promise<{ definizione: DefinizionePlugin; contenuto: ContenutoPlugin } | { motivo: string }> {
  await mkdir(provvisoria, { recursive: true });
  const trovato = await risolviCommit(repository, riferimento, git, provvisoria);
  if ("motivo" in trovato) return trovato;
  const definizione: DefinizionePlugin = { tipo: "plugin", repository, commit: trovato.commit, ...(cartella === undefined ? {} : { cartella }) };
  try {
    const preso = await preparaPlugin(provvisoria, "esame", definizione, git);
    if ("motivo" in preso) return preso;
    return { definizione, contenuto: await leggiContenutoPlugin(preso.radice) };
  } finally {
    await rm(join(provvisoria, cartellaDelPlugin("esame", definizione)), { recursive: true, force: true }).catch(() => {});
  }
}

/** I server delle estensioni accese, pronti per una conversazione che parte, e quelle che non possono partire. */
export interface ServerDelleEstensioni {
  server: Record<string, McpServerConfig>;
  nonPartite: { nome: string; motivo: string }[];
}

/** Da dove una conversazione prende le estensioni dell'ambiente in cui gira, ogni volta che il suo processo parte. */
export interface FonteEstensioni {
  /** Le cartelle dei plugin accesi; con `solo`, di quelli con quei nomi soltanto. */
  plugin(solo?: readonly string[]): string[];
  /** I server accesi, con le chiavi chieste al vault in quel momento; con `solo`, quelli con quei nomi soltanto. */
  server(solo?: readonly string[]): Promise<ServerDelleEstensioni>;
}

/**
 * Le estensioni di un progetto: tra quelle accese nell'ambiente, solo quelle che il proprietario
 * ha scelto per lui, chieste ogni volta che il processo parte. Senza una scelta valgono tutte,
 * come per i progetti nati prima che si potesse scegliere.
 */
export function soloLeScelte(fonte: FonteEstensioni, scelte: () => readonly string[] | undefined): FonteEstensioni {
  return {
    plugin: () => fonte.plugin(scelte()),
    server: () => fonte.server(scelte()),
  };
}

export interface OpzioniEstensioniInAmbiente {
  /** Dove questo ambiente tiene i plugin presi dai repository, e da dove partono le prove. */
  cartella: string;
  /** La cartella dei progetti dell'ambiente: da lì si guarda ciò che l'ambiente ha già. */
  radiceProgetti: string;
  /** Chiede al vault le chiavi di un'estensione, per nome, nel momento in cui parte. Senza, un'estensione che ne vuole non parte. */
  chiavi?(estensione: string): Promise<ChiaviConsegnate>;
  /** Chiamata quando ciò che le conversazioni devono avere è cambiato: quelle aperte ripartono. */
  alCambio?(): void;
  /** Come si apre l'harness. Nei test se ne mette uno finto. */
  apriHarness?: ApriHarness;
  git?: Git;
  attesaProvaMs?: number;
}

export class EstensioniInAmbiente implements FonteEstensioni {
  readonly #o: OpzioniEstensioniInAmbiente;
  #accese: EstensioneDistribuita[] = [];
  /** Le cartelle dei plugin accesi che sono già qui, per identificativo dell'estensione. */
  readonly #pluginPronti = new Map<string, string>();
  /** I cambiamenti si applicano uno alla volta, nell'ordine in cui arrivano. */
  #lavoro: Promise<void> = Promise.resolve();

  constructor(opzioni: OpzioniEstensioniInAmbiente) {
    this.#o = opzioni;
  }

  get #cartellaPlugin(): string {
    return join(this.#o.cartella, "plugin");
  }

  /**
   * Il centro ha mandato le estensioni accese qui, tutte. I plugin che mancano vengono presi;
   * quando è tutto pronto, le conversazioni aperte ripartono. Si può aspettare che abbia finito.
   */
  imposta(estensioni: EstensioneDistribuita[]): Promise<void> {
    this.#lavoro = this.#lavoro.then(() => this.#applica(estensioni)).catch(() => {});
    return this.#lavoro;
  }

  async #applica(estensioni: EstensioneDistribuita[]): Promise<void> {
    const prima = JSON.stringify([this.#accese, [...this.#pluginPronti]]);
    this.#accese = estensioni;
    const cartelle = new Set<string>();
    for (const id of [...this.#pluginPronti.keys()]) {
      if (!estensioni.some((una) => una.id === id)) this.#pluginPronti.delete(id);
    }
    for (const estensione of estensioni) {
      if (estensione.definizione.tipo !== "plugin") continue;
      cartelle.add(cartellaDelPlugin(estensione.id, estensione.definizione));
      const preso = await preparaPlugin(this.#cartellaPlugin, estensione.id, estensione.definizione, this.#o.git).catch(
        (errore: unknown) => ({ motivo: inParole(errore) }),
      );
      if ("radice" in preso) this.#pluginPronti.set(estensione.id, preso.radice);
      else this.#pluginPronti.delete(estensione.id);
    }
    // Ciò che non è più acceso qui non resta sul disco.
    for (const voce of await nomiIn(this.#cartellaPlugin, (nome, eCartella) => (eCartella ? nome : undefined))) {
      if (!cartelle.has(voce)) await rm(join(this.#cartellaPlugin, voce), { recursive: true, force: true }).catch(() => {});
    }
    if (JSON.stringify([this.#accese, [...this.#pluginPronti]]) !== prima) this.#o.alCambio?.();
  }

  plugin(solo?: readonly string[]): string[] {
    return this.#scelte(solo)
      .map((una) => this.#pluginPronti.get(una.id))
      .filter((cartella): cartella is string => cartella !== undefined);
  }

  async server(solo?: readonly string[]): Promise<ServerDelleEstensioni> {
    const esito: ServerDelleEstensioni = { server: {}, nonPartite: [] };
    for (const estensione of this.#scelte(solo)) {
      if (estensione.definizione.tipo === "plugin") continue;
      const pronto = await this.#configura(estensione);
      if ("motivo" in pronto) esito.nonPartite.push({ nome: estensione.nome, motivo: pronto.motivo });
      else esito.server[estensione.nome] = pronto.configurazione;
    }
    return esito;
  }

  #scelte(solo: readonly string[] | undefined): EstensioneDistribuita[] {
    return solo === undefined ? this.#accese : this.#accese.filter((una) => solo.includes(una.nome));
  }

  async #configura(
    estensione: EstensioneDistribuita,
  ): Promise<{ configurazione: McpServerConfig } | { motivo: string; perLeChiavi?: true }> {
    let chiavi: Record<string, string> = {};
    if (estensione.chiavi.length > 0) {
      if (this.#o.chiavi === undefined) return { motivo: "vuole una chiave dal vault, e questo ambiente non sa chiederla", perLeChiavi: true };
      const consegnate = await this.#o.chiavi(estensione.nome).catch((errore: unknown) => ({ motivo: inParole(errore) }));
      if ("motivo" in consegnate) return { motivo: consegnate.motivo, perLeChiavi: true };
      const mancano = estensione.chiavi.filter((nome) => consegnate.valori[nome] === undefined);
      if (mancano.length > 0) return { motivo: `nel vault manca la chiave ${mancano.join(", ")}`, perLeChiavi: true };
      chiavi = Object.fromEntries(estensione.chiavi.map((nome) => [nome, consegnate.valori[nome] ?? ""]));
    }
    const configurazione = configurazioneDelServer(estensione.definizione, chiavi);
    return configurazione === undefined ? { motivo: "non è un server" } : { configurazione };
  }

  /**
   * Avvia un'estensione una volta, fuori da ogni conversazione, e dice se parte: per un server
   * gli strumenti che offre, per un plugin ciò che contiene. Non la accende: quello lo decide il centro.
   */
  async prova(estensione: EstensioneDistribuita): Promise<EsitoProva> {
    try {
      return estensione.definizione.tipo === "plugin"
        ? await this.#provaPlugin(estensione.id, estensione.definizione)
        : await this.#provaServer(estensione);
    } catch (errore) {
      return { riuscita: false, motivo: inParole(errore) };
    }
  }

  async #provaServer(estensione: EstensioneDistribuita): Promise<EsitoProva> {
    const pronto = await this.#configura(estensione);
    if ("motivo" in pronto) {
      return { riuscita: false, motivo: `Non è partita: ${pronto.motivo}.`, ...(pronto.perLeChiavi === true ? { riprovabile: true as const } : {}) };
    }
    await mkdir(this.#o.cartella, { recursive: true });
    const attesa = this.#o.attesaProvaMs ?? ATTESA_PROVA_MS;
    const harness = (this.#o.apriHarness ?? apriHarnessVero)({ cartella: this.#o.cartella, isolata: true });
    try {
      const { nome } = estensione;
      const avvio = await entro(harness.setMcpServers({ [nome]: pronto.configurazione }), attesa, "Non ha risposto in tempo.");
      const errore = avvio.errors[nome];
      if (errore !== undefined) return { riuscita: false, motivo: `Non è partita: ${errore}` };
      const scade = Date.now() + attesa;
      for (;;) {
        const stato = (await entro(harness.mcpServerStatus(), attesa, "L'harness non ha risposto in tempo.")).find((uno) => uno.name === nome);
        if (stato === undefined) return { riuscita: false, motivo: "L'harness non l'ha presa in carico." };
        if (stato.status === "connected") return { riuscita: true, strumenti: (stato.tools ?? []).map((uno) => uno.name) };
        if (stato.status === "needs-auth") {
          return { riuscita: false, motivo: "Vuole un accesso con il browser (OAuth), che Shinka non sa fare: serve una chiave dal vault, oppure un altro modo di collegarsi." };
        }
        if (stato.status !== "pending") return { riuscita: false, motivo: `Non è partita: ${stato.error ?? stato.status}` };
        if (Date.now() > scade) return { riuscita: false, motivo: "Non è partita in tempo." };
        await new Promise((fatto) => setTimeout(fatto, 400));
      }
    } finally {
      harness.close();
    }
  }

  async #provaPlugin(id: string, definizione: DefinizionePlugin): Promise<EsitoProva> {
    const preso = await preparaPlugin(this.#cartellaPlugin, id, definizione, this.#o.git);
    if ("motivo" in preso) return { riuscita: false, motivo: preso.motivo };
    const contenuto = await leggiContenutoPlugin(preso.radice);
    const harness = (this.#o.apriHarness ?? apriHarnessVero)({ cartella: this.#o.cartella, isolata: true, plugin: [preso.radice] });
    try {
      const letto = await entro(harness.reloadPlugins(), this.#o.attesaProvaMs ?? ATTESA_PROVA_MS, "L'harness non ha risposto in tempo.");
      const caricato = letto.plugins.some((uno) => stessaCartella(uno.path, preso.radice));
      if (!caricato) return { riuscita: false, motivo: "L'harness non ha caricato il plugin: il suo manifesto non è valido." };
      return { riuscita: true, strumenti: [], contenuto };
    } finally {
      harness.close();
    }
  }

  /**
   * Guarda ciò che il proprietario ha già installato in questo ambiente, per conto suo: server,
   * plugin e skill, come li vedrebbe un progetto. Si vede e basta: qui nulla viene toccato.
   */
  async guarda(): Promise<EstensioniDellAmbiente> {
    await mkdir(this.#o.radiceProgetti, { recursive: true });
    const harness = (this.#o.apriHarness ?? apriHarnessVero)({ cartella: this.#o.radiceProgetti, isolata: false });
    try {
      const letto = await entro(harness.reloadPlugins(), 60_000, "L'harness non ha risposto in tempo.");
      const skill = letto.commands.filter((uno) => uno.builtin !== true).map((uno) => uno.name);
      return {
        quando: new Date().toISOString(),
        // Quelli che l'harness porta con sé non li ha installati nessuno.
        plugin: letto.plugins
          .filter((uno) => uno.source?.endsWith("@builtin") !== true)
          .map((uno) => ({ nome: uno.name, ...(uno.version === undefined ? {} : { versione: uno.version }) })),
        server: letto.mcpServers
          .filter((uno) => uno.source !== "sdk" && uno.source !== "dynamic")
          .map((uno) => ({ nome: uno.name, provenienza: uno.source ?? uno.scope ?? "ambiente" })),
        skill: skill.slice(0, SKILL_ELENCATE),
        quanteSkill: skill.length,
      };
    } finally {
      harness.close();
    }
  }
}

function stessaCartella(a: string, b: string): boolean {
  const [una, altra] = [resolve(a), resolve(b)];
  return process.platform === "win32" ? una.toLowerCase() === altra.toLowerCase() : una === altra;
}
