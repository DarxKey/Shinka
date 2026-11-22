/**
 * Un Claude Code finto, per le prove degli accessi: conosce `auth status`, `auth login` e
 * `auth logout`. Se ha un accesso lo dice il file indicato da FINTO_CLAUDE_ACCESSO. Il codice
 * giusto per entrare è "codice-giusto".
 */

import { existsSync, rmSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const file = process.env.FINTO_CLAUDE_ACCESSO ?? "";
const [gruppo, comando] = process.argv.slice(2);

if (gruppo === "auth" && comando === "status") {
  const dentro = file !== "" && existsSync(file);
  process.stdout.write(JSON.stringify(dentro ? { loggedIn: true, authMethod: "claude.ai", subscriptionType: "max" } : { loggedIn: false, authMethod: "none" }));
} else if (gruppo === "auth" && comando === "login") {
  process.stdout.write("Opening browser to sign in…\nIf the browser didn't open, visit: \x1b[1mhttps://claude.com/cai/oauth/authorize?code=true&state=prova\x1b[0m\nPaste code here if prompted > ");
  createInterface({ input: process.stdin }).once("line", (riga) => {
    if (riga.trim() === "codice-giusto") {
      writeFileSync(file, "sì");
      process.stdout.write("\nLogin successful.\n");
      process.exit(0);
    }
    process.stderr.write("\nOAuth error: Invalid code\n");
    process.exit(1);
  });
} else if (gruppo === "auth" && comando === "logout") {
  rmSync(file, { force: true });
  process.stdout.write("Successfully logged out.\n");
} else {
  process.stderr.write("comando sconosciuto\n");
  process.exit(2);
}
