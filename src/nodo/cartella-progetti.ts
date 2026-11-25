/**
 * La cartella in cui nascono i progetti nuovi di un ambiente, scelta dal proprietario dalla pagina
 * degli ambienti. Il nodo la accetta solo se è un percorso completo di questa macchina, la crea se
 * manca e controlla di poterci scrivere: così un progetto nuovo non fallisce più tardi. I progetti
 * che esistono restano dove sono.
 */

import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { posix, win32 } from "node:path";

/** Il percorso pronto da usare, oppure perché non va. */
export async function preparaCartellaProgetti(scritto: string, piattaforma: NodeJS.Platform = process.platform): Promise<{ percorso: string } | { motivo: string }> {
  const percorsi = piattaforma === "win32" ? win32 : posix;
  const pulito = scritto.trim();
  if (pulito === "") return { motivo: "Scrivi il percorso della cartella." };
  if (!percorsi.isAbsolute(pulito) || (piattaforma === "win32" && !/^[A-Za-z]:[\\/]/.test(pulito) && !pulito.startsWith("\\\\"))) {
    return { motivo: `Serve un percorso completo di questa macchina, per esempio ${piattaforma === "win32" ? "C:\\Users\\io\\Progetti" : "/home/io/progetti"}.` };
  }
  const percorso = percorsi.resolve(pulito);
  if (percorsi.parse(percorso).root === percorso) return { motivo: "La radice di un disco non va bene: scegli una cartella dentro." };
  try {
    await mkdir(percorso, { recursive: true });
    // Ci si deve poter scrivere: lo si prova con un file che poi si toglie.
    const prova = percorsi.join(percorso, `.shinka-prova-${randomUUID()}`);
    await writeFile(prova, "");
    await rm(prova, { force: true });
  } catch (errore) {
    return { motivo: `La cartella non si può usare: ${errore instanceof Error ? errore.message : String(errore)}` };
  }
  return { percorso };
}
