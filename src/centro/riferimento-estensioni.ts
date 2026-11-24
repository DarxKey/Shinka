/**
 * Il riferimento per chi scrive un'estensione dell'interfaccia (ADR 0057): è il file
 * docs/estensioni-interfaccia.md, che la Home legge con uno strumento prima di scriverne una.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const FILE = join(import.meta.dirname, "..", "..", "docs", "estensioni-interfaccia.md");

export function riferimentoEstensioniInterfaccia(): string {
  try {
    return readFileSync(FILE, "utf8");
  } catch {
    return "Il riferimento delle estensioni dell'interfaccia non si trova in questa installazione (docs/estensioni-interfaccia.md).";
  }
}
