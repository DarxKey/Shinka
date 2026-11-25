import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { ESTENSIONE_CLAUDE_IN_CHROME } from "../protocollo/browser-del-pc.ts";
import { rilevaChrome, type DoveGuardare } from "./chrome.ts";

function dove(piattaforma: NodeJS.Platform, file: string[], chiavi: string[] = []): DoveGuardare {
  return {
    piattaforma,
    ambiente: { LOCALAPPDATA: "C:\\Users\\io\\AppData\\Local", ProgramFiles: "C:\\Program Files" },
    casa: piattaforma === "win32" ? "C:\\Users\\io" : "/Users/io",
    esiste: (percorso) => file.some((uno) => uno === percorso),
    cartelle: (percorso) => [...new Set(file.filter((uno) => uno.startsWith(`${percorso}/`) || uno.startsWith(`${percorso}\\`)).map((uno) => uno.slice(percorso.length + 1).split(/[\\/]/)[0] ?? ""))],
    chiave: async (percorso) => chiavi.includes(percorso),
  };
}

test("su Windows si guardano Chrome, l'estensione in un profilo e il collegamento nel registro", async () => {
  const datiUtente = join("C:\\Users\\io\\AppData\\Local", "Google", "Chrome", "User Data");
  const pieno = dove(
    "win32",
    [join("C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"), join(datiUtente, "Profile 2", "Extensions", ESTENSIONE_CLAUDE_IN_CHROME)],
    ["HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.anthropic.claude_browser_extension"],
  );
  assert.deepEqual(await rilevaChrome(pieno), { chrome: true, estensione: true, collegamento: true });
  assert.deepEqual(await rilevaChrome(dove("win32", [])), { chrome: false, estensione: false, collegamento: false });
});

test("su macOS anche; su Linux il browser del PC non c'è", async () => {
  const supporto = join("/Users/io", "Library", "Application Support", "Google", "Chrome");
  assert.deepEqual(await rilevaChrome(dove("darwin", ["/Applications/Google Chrome.app", join(supporto, "Default", "Extensions", ESTENSIONE_CLAUDE_IN_CHROME)])), {
    chrome: true,
    estensione: true,
    collegamento: false,
  });
  assert.equal(await rilevaChrome(dove("linux", [])), undefined);
});
