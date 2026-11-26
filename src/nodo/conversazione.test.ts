import assert from "node:assert/strict";
import { STRUMENTI_DELLA_LISTA } from "../protocollo/cose-da-fare.ts";
import { ISTRUZIONI_DISEGNI } from "../protocollo/disegni.ts";
import { test } from "node:test";
import type { ImpostazioniConversazione } from "../protocollo/impostazioni.ts";
import {
  ATTESA_DEL_CONSENSO_NEL_BROWSER_S,
  opzioniHarness,
  scambiDiClaude,
  type ChiediConsenso,
  type ConfigurazioneConversazione,
  type Consenso,
} from "./conversazione.ts";
import {
  configurazioneDiProgetto,
  IMPOSTAZIONI_DI_PROGETTO,
  ISTRUZIONI_BROWSER_DEL_PC,
  ISTRUZIONI_DI_PROGETTO,
} from "./profili.ts";
import { esitoDelleDomande, type ChiediRisposte } from "./domande.ts";

const nessunPermesso = async (): Promise<{ behavior: "deny"; message: string }> => ({
  behavior: "deny",
  message: "prova",
});

const DELLA_HOME: ImpostazioniConversazione = { modello: "haiku", permessi: "chiedi" };

function dellaHome(): ConfigurazioneConversazione {
  return {
    cartella: "/home/node/dati/home",
    impostazioni: DELLA_HOME,
    istruzioni: "Sei la Home di Shinka.",
    strumenti: ["Read", "Bash"],
    strumentiSenzaRichiesta: ["WebSearch"],
    alEvento: () => {},
    alIdSessione: () => {},
  };
}

function delProgetto(idSessione?: string): ConfigurazioneConversazione {
  return configurazioneDiProgetto(
    "/home/node/progetti/videogioco",
    idSessione,
    IMPOSTAZIONI_DI_PROGETTO,
    () => {},
    () => {},
  );
}

test("le istruzioni nostre non restano fissate a una conversazione ripresa", () => {
  const opzioni = opzioniHarness(dellaHome(), "abbonamento", "sessione-vecchia", DELLA_HOME, nessunPermesso);
  // Senza questo la Home ripresa dopo un aggiornamento seguirebbe le istruzioni di prima.
  assert.deepEqual(opzioni.systemPrompt, {
    type: "custom",
    prompt: "Sei la Home di Shinka.",
    snapshot: false,
  });
  assert.equal(opzioni.resume, "sessione-vecchia");
});

test("lo stile scelto si aggiunge alle istruzioni, della Home e di un progetto, e vale da ogni avvio del processo", () => {
  const stile = { id: "conciso", nome: "Conciso", istruzioni: "Rispondi breve." };
  const home = opzioniHarness(dellaHome(), "abbonamento", "sessione-vecchia", { ...DELLA_HOME, stile }, nessunPermesso);
  assert.deepEqual(home.systemPrompt, {
    type: "custom",
    prompt: "Sei la Home di Shinka.\n\n# Stile delle risposte: Conciso\n\nIl proprietario ha scelto questo stile per le tue risposte in questa conversazione:\n\nRispondi breve.",
    snapshot: false,
  });
  const progetto = opzioniHarness(delProgetto("sessione-7"), "abbonamento", "sessione-7", { ...IMPOSTAZIONI_DI_PROGETTO, stile }, nessunPermesso);
  const istruzioni = progetto.systemPrompt as { append?: string; snapshot?: boolean };
  assert.ok(istruzioni.append?.startsWith(ISTRUZIONI_DI_PROGETTO));
  assert.ok(istruzioni.append?.endsWith("Rispondi breve."));
  // Un cambio di stile vale dalla ripartenza del processo, anche in una conversazione ripresa.
  assert.equal(istruzioni.snapshot, false);
});

test("con il modo che chiede, ogni permesso passa dal proprietario", () => {
  const opzioni = opzioniHarness(dellaHome(), "abbonamento", undefined, DELLA_HOME, nessunPermesso);
  assert.equal(opzioni.permissionMode, "default");
  assert.equal(opzioni.canUseTool, nessunPermesso);
  assert.deepEqual(opzioni.allowedTools, ["WebSearch", ...STRUMENTI_DELLA_LISTA]);
  assert.deepEqual(opzioni.tools, ["Read", "Bash"]);
  assert.equal(opzioni.model, "haiku");
  assert.equal("effort" in opzioni, false);
  assert.equal("allowDangerouslySkipPermissions" in opzioni, false);
  assert.equal("resume" in opzioni, false);
});

test("una conversazione nostra non vede impostazioni e strumenti dell'ambiente", () => {
  const opzioni = opzioniHarness(dellaHome(), "abbonamento", undefined, DELLA_HOME, nessunPermesso);
  assert.deepEqual(opzioni.settingSources, []);
  assert.equal(opzioni.strictMcpConfig, true);
});

test("un progetto lavora con Claude Code completo, nella sua cartella", () => {
  const opzioni = opzioniHarness(
    delProgetto("sessione-7"),
    "abbonamento",
    "sessione-7",
    IMPOSTAZIONI_DI_PROGETTO,
    nessunPermesso,
  );
  assert.equal(opzioni.cwd, "/home/node/progetti/videogioco");
  // Alle istruzioni di Claude Code si aggiunge solo il compito di tenere lo stato del progetto.
  assert.deepEqual(opzioni.systemPrompt, { type: "preset", preset: "claude_code", append: `${ISTRUZIONI_DI_PROGETTO}\n\n${ISTRUZIONI_DISEGNI}`, snapshot: false });
  assert.match(ISTRUZIONI_DI_PROGETTO, /STATO\.md/);
  assert.match(ISTRUZIONI_DI_PROGETTO, /mai password, chiavi o altri segreti/);
  assert.deepEqual(opzioni.tools, { type: "preset", preset: "claude_code" });
  // Valgono impostazioni, skill e strumenti che il proprietario ha installato nell'ambiente.
  assert.equal("settingSources" in opzioni, false);
  assert.equal("strictMcpConfig" in opzioni, false);
  // Senza una scelta del proprietario valgono modello e impegno predefiniti di Claude Code.
  assert.equal("model" in opzioni, false);
  assert.equal("effort" in opzioni, false);
  assert.equal(opzioni.resume, "sessione-7");
});

test("un progetto nasce con le modifiche ai file libere e il permesso richiesto per il resto", () => {
  const opzioni = opzioniHarness(delProgetto(), "abbonamento", undefined, IMPOSTAZIONI_DI_PROGETTO, nessunPermesso);
  assert.equal(opzioni.permissionMode, "acceptEdits");
  // Solo la lista delle cose da fare, che tocca solo sé stessa.
  assert.deepEqual(opzioni.allowedTools, STRUMENTI_DELLA_LISTA);
  assert.equal(opzioni.canUseTool, nessunPermesso);
  // Le domande di Claude hanno la loro scheda: nessuno strumento è tolto.
  assert.equal(opzioni.disallowedTools, undefined);
});

test("modello, impegno e modo dei permessi sono quelli scelti dal proprietario", () => {
  const scelte: ImpostazioniConversazione = { modello: "sonnet", impegno: "xhigh", permessi: "automatico" };
  const opzioni = opzioniHarness(delProgetto(), "abbonamento", undefined, scelte, nessunPermesso);
  assert.equal(opzioni.model, "sonnet");
  assert.equal(opzioni.effort, "xhigh");
  assert.equal(opzioni.permissionMode, "auto");
  assert.equal("allowDangerouslySkipPermissions" in opzioni, false);
});

test("senza permessi si lavora solo se il proprietario lo ha scelto", () => {
  const scelte: ImpostazioniConversazione = { permessi: "senza-permessi" };
  const opzioni = opzioniHarness(delProgetto(), "abbonamento", undefined, scelte, nessunPermesso);
  assert.equal(opzioni.permissionMode, "bypassPermissions");
  assert.equal(opzioni.allowDangerouslySkipPermissions, true);

  for (const permessi of ["chiedi", "modifiche-libere", "automatico"] as const) {
    const altre = opzioniHarness(delProgetto(), "abbonamento", undefined, { permessi }, nessunPermesso);
    assert.notEqual(altre.permissionMode, "bypassPermissions", permessi);
    assert.equal("allowDangerouslySkipPermissions" in altre, false, permessi);
  }
});

test("il browser del PC resta spento finché il proprietario non lo accende nell'ambiente", () => {
  const opzioni = opzioniHarness(delProgetto(), "abbonamento", undefined, IMPOSTAZIONI_DI_PROGETTO, nessunPermesso);
  assert.equal("extraArgs" in opzioni, false);
  assert.doesNotMatch(JSON.stringify(opzioni.systemPrompt), /claude-in-chrome/);
});

test("il browser del PC: in «Chiedi sempre» e «Modifiche libere» ogni azione passa dal proprietario, negli altri due no (ADR 0064)", async () => {
  const conIlBrowser = (): ConfigurazioneConversazione =>
    configurazioneDiProgetto(
      "/home/node/progetti/videogioco",
      undefined,
      IMPOSTAZIONI_DI_PROGETTO,
      () => {},
      () => {},
      { browserDelPc: true },
    );
  const decisione = (esito: unknown): { permissionDecision?: string; permissionDecisionReason?: string } =>
    (esito as { hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string } }).hookSpecificOutput ?? {};
  const azione = { hook_event_name: "PreToolUse", tool_name: "mcp__claude-in-chrome__tabs_close_mcp", tool_input: { tabId: 7 }, tool_use_id: "azione-1" } as never;
  // In «Automatico» e «Senza permessi» il proprietario ha scelto di non essere chiesto: l'azione parte.
  for (const permessi of ["automatico", "senza-permessi"] as const) {
    const chieste: string[] = [];
    const chiedi: ChiediConsenso = async (strumento) => {
      chieste.push(strumento);
      return { approvato: false, motivo: "no" };
    };
    const opzioni = opzioniHarness(conIlBrowser(), "abbonamento", undefined, { permessi, browserChrome: true }, nessunPermesso, [], chiedi);
    assert.deepEqual(opzioni.extraArgs, { chrome: null }, permessi);
    const controllo = opzioni.hooks?.PreToolUse?.find((voce) => voce.matcher === "mcp__claude-in-chrome__.*");
    const libera = decisione(await controllo?.hooks[0]?.(azione, "azione-1", { signal: new AbortController().signal }));
    assert.equal(libera.permissionDecision, "allow", permessi);
    assert.deepEqual(chieste, [], permessi);
  }
  // Negli altri due il consenso lo chiede il controllo, non l'harness.
  for (const permessi of ["chiedi", "modifiche-libere"] as const) {
    const chieste: { strumento: string; ingresso: unknown; idAzione: string; motivo: string | undefined }[] = [];
    let risposta: Consenso = { approvato: true };
    const chiedi: ChiediConsenso = async (strumento, ingresso, idAzione, _segnale, motivo) => {
      chieste.push({ strumento, ingresso, idAzione, motivo });
      return risposta;
    };
    // Acceso per l'ambiente ma spento nella sessione, Claude Code parte senza Chrome (ADR 0063).
    assert.equal("extraArgs" in opzioniHarness(conIlBrowser(), "abbonamento", undefined, { permessi }, nessunPermesso, [], chiedi), false, permessi);
    const opzioni = opzioniHarness(conIlBrowser(), "abbonamento", undefined, { permessi, browserChrome: true }, nessunPermesso, [], chiedi);
    assert.deepEqual(opzioni.extraArgs, { chrome: null }, permessi);
    // Ogni strumento del browser viene chiesto, anche quelli che l'harness lascerebbe passare da sé.
    assert.equal(opzioni.hooks?.PreToolUse?.length, 2, permessi);
    const controllo = opzioni.hooks?.PreToolUse?.find((voce) => voce.matcher === "mcp__claude-in-chrome__.*");
    assert.equal(controllo?.matcher, "mcp__claude-in-chrome__.*", permessi);
    // Se il controllo non riesce, o il proprietario non risponde in tempo, l'azione non parte.
    assert.equal(controllo?.onFailure, "block", permessi);
    assert.equal(controllo?.timeout, ATTESA_DEL_CONSENSO_NEL_BROWSER_S, permessi);
    const segnale = new AbortController().signal;

    const approvata = decisione(await controllo?.hooks[0]?.(azione, "azione-1", { signal: segnale }));
    assert.equal(approvata.permissionDecision, "allow", permessi);
    assert.equal(chieste.length, 1, permessi);
    assert.deepEqual({ ...chieste[0], motivo: undefined }, { strumento: "mcp__claude-in-chrome__tabs_close_mcp", ingresso: { tabId: 7 }, idAzione: "azione-1", motivo: undefined }, permessi);
    assert.match(chieste[0]?.motivo ?? "", /ogni azione passa dal proprietario/, permessi);

    risposta = { approvato: false, motivo: "Il proprietario ha negato questa azione." };
    const negata = decisione(await controllo?.hooks[0]?.(azione, "azione-1", { signal: segnale }));
    assert.equal(negata.permissionDecision, "deny", permessi);
    assert.equal(negata.permissionDecisionReason, "Il proprietario ha negato questa azione.", permessi);
    // Il controllo non risponde mai "chiedi": in due modi l'harness non lo farebbe.
    assert.equal(chieste.length, 2, permessi);

    // Gli strumenti del browser non sono tra quelli che non chiedono consenso.
    assert.deepEqual(opzioni.allowedTools, STRUMENTI_DELLA_LISTA, permessi);

    // Senza un modo di chiedere, nel browser del PC non parte nulla.
    const senzaChiedere = opzioniHarness(conIlBrowser(), "abbonamento", undefined, { permessi, browserChrome: true }, nessunPermesso);
    const muta = decisione(await senzaChiedere.hooks?.PreToolUse?.find((voce) => voce.matcher === controllo?.matcher)?.hooks[0]?.(azione, "azione-1", { signal: segnale }));
    assert.equal(muta.permissionDecision, "deny", permessi);
  }
  const opzioni = opzioniHarness(conIlBrowser(), "abbonamento", undefined, IMPOSTAZIONI_DI_PROGETTO, nessunPermesso);
  assert.deepEqual(opzioni.systemPrompt, {
    type: "preset",
    preset: "claude_code",
    append: ISTRUZIONI_DI_PROGETTO + "\n\n" + ISTRUZIONI_DISEGNI + "\n\n" + ISTRUZIONI_BROWSER_DEL_PC,
    snapshot: false,
  });
  assert.match(ISTRUZIONI_BROWSER_DEL_PC, /non scrivere mai nomi utente, password o codici/);
  assert.match(ISTRUZIONI_BROWSER_DEL_PC, /non pagare/);
});

const DOMANDE_DELL_HARNESS = {
  questions: [{ question: "Quale database usiamo?", header: "Database", options: [{ label: "Postgres" }, { label: "SQLite" }], multiSelect: false }],
};

test("le domande di Claude passano dal proprietario in ogni modo dei permessi, anche senza il browser del PC", async () => {
  const segnale = new AbortController().signal;
  const ingresso = { hook_event_name: "PreToolUse", tool_name: "AskUserQuestion", tool_input: DOMANDE_DELL_HARNESS, tool_use_id: "azione-2" } as never;
  for (const permessi of ["chiedi", "modifiche-libere", "automatico", "senza-permessi"] as const) {
    const poste: { domande: unknown; idDomande: string }[] = [];
    const chiedi: ChiediRisposte = async (domande, idDomande) => {
      poste.push({ domande, idDomande });
      return { esito: "risposte", risposte: ["Postgres", "Ricerca"] };
    };
    for (const cfg of [dellaHome(), delProgetto()]) {
      const opzioni = opzioniHarness(cfg, "abbonamento", undefined, { permessi }, nessunPermesso, [], undefined, chiedi);
      const controllo = opzioni.hooks?.PreToolUse?.find((voce) => voce.matcher === "AskUserQuestion");
      assert.equal(controllo?.onFailure, "block", permessi);
      assert.equal(controllo?.timeout, ATTESA_DEL_CONSENSO_NEL_BROWSER_S, permessi);
      const esito = (await controllo?.hooks[0]?.(ingresso, "azione-2", { signal: segnale })) as ReturnType<typeof esitoDelleDomande>;
      assert.equal(esito.hookSpecificOutput.permissionDecision, "allow", permessi);
      // Senza un modo di chiedere le domande non partono.
      const senza = opzioniHarness(cfg, "abbonamento", undefined, { permessi }, nessunPermesso);
      const muto = (await senza.hooks?.PreToolUse?.find((voce) => voce.matcher === "AskUserQuestion")?.hooks[0]?.(ingresso, "azione-2", { signal: segnale })) as ReturnType<typeof esitoDelleDomande>;
      assert.equal(muto.hookSpecificOutput.permissionDecision, "deny", permessi);
    }
    assert.equal(poste.length, 2, permessi);
    assert.equal(poste[0]?.idDomande, "azione-2");
  }
});

test("con l'abbonamento le credenziali a consumo non arrivano all'harness", () => {
  const prima = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "chiave-di-prova";
  try {
    const opzioni = opzioniHarness(dellaHome(), "abbonamento", undefined, DELLA_HOME, nessunPermesso);
    assert.equal(opzioni.env?.ANTHROPIC_API_KEY, undefined);
  } finally {
    if (prima === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prima;
  }
});

test("i plugin delle estensioni accese partono con la conversazione, accanto alle skill di Shinka", () => {
  const cartelle = ["/dati/estensioni/plugin/uno-0123456789ab", "/dati/estensioni/plugin/due-ba9876543210"];
  const senza = opzioniHarness(delProgetto(), "abbonamento", undefined, IMPOSTAZIONI_DI_PROGETTO, nessunPermesso);
  const con = opzioniHarness(delProgetto(), "abbonamento", undefined, IMPOSTAZIONI_DI_PROGETTO, nessunPermesso, cartelle);
  const prima = senza.plugins ?? [];
  assert.deepEqual(con.plugins, [...prima, ...cartelle.map((path) => ({ type: "local", path }))]);
  // I server delle estensioni non passano di qui: con le loro chiavi finirebbero tra gli argomenti del processo.
  assert.deepEqual(con.mcpServers, senza.mcpServers);
});

test("la storia di una sessione di Claude: il testo scritto, senza strumenti e loro esiti", () => {
  const messaggi = [
    { type: "user", message: { role: "user", content: "Ciao" } },
    { type: "assistant", message: { content: [{ type: "thinking", thinking: "…" }, { type: "text", text: "Ciao a te." }, { type: "tool_use", name: "Bash" }] } },
    { type: "user", message: { content: [{ type: "tool_result", content: "file.txt" }] } },
    { type: "system", message: {} },
  ];
  assert.deepEqual(scambiDiClaude(messaggi), [
    { chi: "proprietario", testo: "Ciao" },
    { chi: "motore", testo: "Ciao a te." },
  ]);
});
