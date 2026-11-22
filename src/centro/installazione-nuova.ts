/**
 * Il pacchetto da cui nasce un'installazione nuova di Shinka (ADR 0032): il codice della versione
 * in funzione, l'interfaccia già costruita e i file per installarla con Docker (cartella
 * `installazione` del repository). Solo codice: niente dati, memoria, skill o vault.
 */

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { FILE_IN_CIMA, inBreve, versioneDi } from "../protocollo/versione.ts";
import { archivioTarGz, type VoceArchivio } from "./archivio-tar.ts";

/** I file da lanciare, che nell'archivio devono restare eseguibili. */
const ESEGUIBILI = new Set(["installa.sh"]);

/**
 * I file per installare: nel repository stanno nella cartella `installazione`; in
 * un'installazione nata da un pacchetto stanno in cima, accanto al codice.
 */
const FILE_PER_INSTALLARE = [".dockerignore", "Dockerfile.centro", "Dockerfile.gateway", "LEGGIMI.md", "compose.yaml", "installa.sh", "seccomp-chromium.json"];

async function fileSotto(radice: string, relativa: string, escludi: (percorso: string) => boolean): Promise<string[]> {
  let voci;
  try {
    voci = await readdir(join(radice, relativa), { withFileTypes: true });
  } catch {
    return [];
  }
  const trovati: string[] = [];
  for (const voce of voci.sort((a, b) => a.name.localeCompare(b.name))) {
    const percorso = relativa === "" ? voce.name : `${relativa}/${voce.name}`;
    if (escludi(percorso)) continue;
    if (voce.isDirectory()) trovati.push(...(await fileSotto(radice, percorso, escludi)));
    else if (voce.isFile()) trovati.push(percorso);
  }
  return trovati;
}

/** Ciò che non serve a un'installazione: i test e gli strumenti delle prove. */
function nonServe(percorso: string): boolean {
  return percorso.endsWith(".test.ts") || percorso === "src/prove";
}

export interface PacchettoDiInstallazione {
  nome: string;
  dati: Buffer;
}

export async function pacchettoDiInstallazione(installata: string): Promise<PacchettoDiInstallazione> {
  const versione = await versioneDi(installata);
  const radice = `shinka-${versione === undefined ? "senza-versione" : inBreve(versione)}`;
  const cartellaInstallazione = existsSync(join(installata, "installazione", "compose.yaml")) ? join(installata, "installazione") : installata;
  const daInstallazione =
    cartellaInstallazione === installata
      ? FILE_PER_INSTALLARE.filter((nome) => existsSync(join(installata, nome)))
      : await fileSotto(cartellaInstallazione, "", () => false);
  if (!daInstallazione.includes("compose.yaml")) {
    throw new Error("Questa versione di Shinka non ha i file per un'installazione nuova: va aggiornata.");
  }
  const delCodice = [
    ...FILE_IN_CIMA.filter((nome) => nome !== "versione.json" || versione !== undefined),
    ...(await fileSotto(installata, "src", nonServe)),
    ...(await fileSotto(installata, "web/dist", () => false)),
  ];
  if (!delCodice.includes("web/dist/index.html")) throw new Error("In questa versione manca l'interfaccia costruita.");
  const voci: VoceArchivio[] = [];
  for (const percorso of delCodice) voci.push({ percorso: `${radice}/${percorso}`, dati: await readFile(join(installata, percorso)) });
  for (const percorso of daInstallazione) {
    voci.push({
      percorso: `${radice}/${percorso}`,
      dati: await readFile(join(cartellaInstallazione, percorso)),
      ...(ESEGUIBILI.has(percorso) ? { modo: 0o755 } : {}),
    });
  }
  return { nome: `${radice}.tar.gz`, dati: archivioTarGz(voci) };
}
