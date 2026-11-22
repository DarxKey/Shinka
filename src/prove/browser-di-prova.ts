/**
 * Quale browser usare nei test del browser del gateway, se su questa macchina ce n'è uno.
 * Dove non c'è, quei test si saltano: lo dicono, e non falliscono.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

export interface BrowserDiProva {
  canale?: string;
  eseguibile?: string;
  recinto: boolean;
}

export function browserDiProva(ambiente: NodeJS.ProcessEnv = process.env): BrowserDiProva | undefined {
  const recinto = ambiente.SHINKA_BROWSER_RECINTO !== "0";
  if (ambiente.SHINKA_BROWSER_ESEGUIBILE !== undefined && ambiente.SHINKA_BROWSER_ESEGUIBILE !== "") {
    return { eseguibile: ambiente.SHINKA_BROWSER_ESEGUIBILE, recinto };
  }
  if (ambiente.SHINKA_BROWSER_CANALE !== undefined && ambiente.SHINKA_BROWSER_CANALE !== "") {
    return { canale: ambiente.SHINKA_BROWSER_CANALE, recinto };
  }
  if (process.platform === "win32") {
    const cartelle = [ambiente["ProgramFiles(x86)"], ambiente.ProgramFiles].filter((cartella) => cartella !== undefined);
    if (cartelle.some((cartella) => existsSync(join(cartella, "Microsoft", "Edge", "Application", "msedge.exe")))) {
      return { canale: "msedge", recinto };
    }
  }
  try {
    if (existsSync(chromium.executablePath())) return { recinto };
  } catch {
    // Playwright non sa dove sarebbe il suo Chromium: non c'è.
  }
  return undefined;
}
