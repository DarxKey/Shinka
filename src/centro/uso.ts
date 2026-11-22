/**
 * Il conto dell'uso e dello spazio, per le pagine Uso e Archiviazione. L'uso viene dalla storia
 * delle conversazioni (i token che l'harness dice a fine turno); lo spazio dai file che Shinka tiene.
 */

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { EventoArchiviato } from "../protocollo/eventi.ts";
import type { Uso, UsoDelGiorno, UsoDiUnaConversazione } from "../protocollo/uso.ts";

export interface FonteDiUso {
  genere: UsoDiUnaConversazione["genere"];
  id: string;
  nome: string;
  storia: readonly EventoArchiviato[];
}

/** Il giorno di un momento, nel fuso del centro: AAAA-MM-GG. */
export function giornoDi(quando: Date): string {
  const anno = quando.getFullYear();
  const mese = String(quando.getMonth() + 1).padStart(2, "0");
  const giorno = String(quando.getDate()).padStart(2, "0");
  return `${anno}-${mese}-${giorno}`;
}

/** I token degli ultimi `giorni` giorni, compreso oggi: per giorno e per conversazione. */
export function contaUso(fonti: readonly FonteDiUso[], giorni = 14, adesso: Date = new Date()): Omit<Uso, "limiti"> {
  const elenco: UsoDelGiorno[] = [];
  for (let indietro = giorni - 1; indietro >= 0; indietro -= 1) {
    const giorno = new Date(adesso.getFullYear(), adesso.getMonth(), adesso.getDate() - indietro);
    elenco.push({ giorno: giornoDi(giorno), ingresso: 0, uscita: 0, turni: 0 });
  }
  const perGiorno = new Map(elenco.map((voce) => [voce.giorno, voce]));
  const conversazioni: UsoDiUnaConversazione[] = [];
  for (const fonte of fonti) {
    const totale: UsoDiUnaConversazione = { genere: fonte.genere, id: fonte.id, nome: fonte.nome, ingresso: 0, uscita: 0, turni: 0 };
    for (const { quando, evento } of fonte.storia) {
      if (evento.tipo !== "turno-concluso" || evento.token === undefined) continue;
      const giorno = perGiorno.get(giornoDi(new Date(quando)));
      if (giorno === undefined) continue;
      giorno.ingresso += evento.token.ingresso;
      giorno.uscita += evento.token.uscita;
      giorno.turni += 1;
      totale.ingresso += evento.token.ingresso;
      totale.uscita += evento.token.uscita;
      totale.turni += 1;
    }
    if (totale.turni > 0) conversazioni.push(totale);
  }
  conversazioni.sort((a, b) => b.ingresso + b.uscita - (a.ingresso + a.uscita));
  return { giorni: elenco, conversazioni };
}

/** Quante voci al massimo si guardano contando una cartella: oltre, il conto è per difetto. */
const VOCI_CONTATE_MASSIME = 20_000;

/** Quanto occupa un file o una cartella, con le sue sottocartelle; 0 se non c'è. */
export async function spazioDi(percorso: string): Promise<{ byte: number; perDifetto: boolean }> {
  let byte = 0;
  let contate = 0;
  let perDifetto = false;
  const visita = async (qui: string): Promise<void> => {
    if (contate > VOCI_CONTATE_MASSIME) {
      perDifetto = true;
      return;
    }
    const info = await stat(qui).catch(() => undefined);
    contate += 1;
    if (info === undefined) return;
    if (!info.isDirectory()) {
      byte += info.size;
      return;
    }
    const voci = await readdir(qui).catch(() => []);
    for (const voce of voci) await visita(join(qui, voce));
  };
  await visita(percorso);
  return { byte, perDifetto };
}
