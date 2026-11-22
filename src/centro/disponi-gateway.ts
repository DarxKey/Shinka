/**
 * Scrive in una cartella nuova la parte del gateway della versione da cui viene lanciato: i file
 * che il gateway carica, la sua pagina, l'elenco delle dipendenze e il nome della versione. È ciò
 * che il centro propone al gateway dopo un'installazione, quindi un gateway disposto così, alla
 * stessa versione del centro, alla prima proposta risponde che non cambia nulla.
 *
 * Serve una volta, da fuori, per mettere un gateway sotto il suo guardiano (STATO.md, "Comandi").
 * Le dipendenze non le installa: si installano nella cartella scritta, con `npm ci --omit=dev`.
 *
 * Uso, dalla cartella di una versione che ha il suo versione.json:
 *   node src/centro/disponi-gateway.ts <cartella di destinazione>
 */

import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pacchettoDelGateway } from "./pacchetto.ts";

const destinazione = process.argv[2];
if (destinazione === undefined || destinazione === "") {
  console.error("Uso: node src/centro/disponi-gateway.ts <cartella di destinazione>");
  process.exit(2);
}
const cartella = resolve(destinazione);
const giaDentro = await readdir(cartella).catch(() => [] as string[]);
if (giaDentro.length > 0) {
  console.error(`La cartella ${cartella} non è vuota: ne serve una nuova, perché il gateway confronta tutto ciò che trova.`);
  process.exit(1);
}

let file: Awaited<ReturnType<typeof pacchettoDelGateway>>;
try {
  file = await pacchettoDelGateway(process.cwd());
} catch (errore) {
  console.error(`Da qui la parte del gateway non si legge: ${errore instanceof Error ? errore.message : String(errore)}`);
  console.error("Va lanciato dalla cartella di una versione, con il suo versione.json.");
  process.exit(1);
}
for (const uno of file) {
  const percorso = join(cartella, uno.percorso);
  await mkdir(dirname(percorso), { recursive: true });
  await writeFile(percorso, Buffer.from(uno.dati, "base64"));
}
console.log(`Scritti ${file.length} file in ${cartella}.`);
