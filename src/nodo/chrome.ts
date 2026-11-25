/**
 * Che cosa c'è su questa macchina per guidare Chrome con Claude in Chrome (ADR 0063): Chrome,
 * l'estensione in almeno un profilo, e il collegamento dell'estensione con Claude Code. Si guarda
 * senza toccare nulla. Vale su Windows e su macOS; altrove il browser del PC non c'è.
 */

import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ESTENSIONE_CLAUDE_IN_CHROME, HOST_CLAUDE_IN_CHROME, type StatoChrome } from "../protocollo/browser-del-pc.ts";

export interface DoveGuardare {
  piattaforma: NodeJS.Platform;
  ambiente: NodeJS.ProcessEnv;
  casa: string;
  esiste(percorso: string): boolean;
  cartelle(percorso: string): string[];
  /** Vero se la chiave del registro di Windows c'è. */
  chiave(percorso: string): Promise<boolean>;
}

const doveVero: DoveGuardare = {
  piattaforma: process.platform,
  ambiente: process.env,
  casa: homedir(),
  esiste: existsSync,
  cartelle: (percorso) => {
    try {
      return readdirSync(percorso);
    } catch {
      return [];
    }
  },
  chiave: (percorso) =>
    new Promise((risolvi) => {
      execFile("reg", ["query", percorso], { windowsHide: true, timeout: 10_000 }, (errore) => risolvi(errore === null));
    }),
};

/** L'estensione in uno dei profili di Chrome: Default, Profile 1, Profile 2… */
function inUnProfilo(dove: DoveGuardare, datiUtente: string): boolean {
  return dove.cartelle(datiUtente).some((profilo) => dove.esiste(join(datiUtente, profilo, "Extensions", ESTENSIONE_CLAUDE_IN_CHROME)));
}

/** Che cosa c'è; nulla dove il browser del PC non vale. */
export async function rilevaChrome(dove: DoveGuardare = doveVero): Promise<StatoChrome | undefined> {
  if (dove.piattaforma === "win32") {
    const locale = dove.ambiente.LOCALAPPDATA ?? join(dove.casa, "AppData", "Local");
    const programmi = [dove.ambiente.ProgramFiles, dove.ambiente["ProgramFiles(x86)"], locale].filter((una): una is string => una !== undefined);
    return {
      chrome: programmi.some((cartella) => dove.esiste(join(cartella, "Google", "Chrome", "Application", "chrome.exe"))),
      estensione: inUnProfilo(dove, join(locale, "Google", "Chrome", "User Data")),
      collegamento: await dove.chiave(`HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_CLAUDE_IN_CHROME}`),
    };
  }
  if (dove.piattaforma === "darwin") {
    const supporto = join(dove.casa, "Library", "Application Support", "Google", "Chrome");
    return {
      chrome: dove.esiste("/Applications/Google Chrome.app") || dove.esiste(join(dove.casa, "Applications", "Google Chrome.app")),
      estensione: inUnProfilo(dove, supporto),
      collegamento: dove.esiste(join(supporto, "NativeMessagingHosts", `${HOST_CLAUDE_IN_CHROME}.json`)),
    };
  }
  return undefined;
}
