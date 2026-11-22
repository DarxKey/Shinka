/**
 * La custodia delle immagini delle conversazioni: quelle prodotte dalle azioni di Claude
 * e quelle allegate dal proprietario. Arrivano dentro gli eventi, in base64; il centro le salva
 * come file e nell'archivio della conversazione lascia solo il loro nome.
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { TIPI_IMMAGINE, type Immagine } from "../protocollo/allegati.ts";
import type { EventoConversazione } from "../protocollo/eventi.ts";

const NOME_CONVERSAZIONE = /^[a-z0-9-]{1,64}$/;
const NOME_IMMAGINE = /^[0-9a-f-]{36}\.(png|jpg|gif|webp)$/;

export class CustodiaImmagini {
  readonly #cartella: string;

  constructor(cartella: string) {
    this.#cartella = cartella;
  }

  /** Restituisce l'evento con le immagini prese in custodia: al posto dei dati, il loro nome. */
  prendi(idConversazione: string, evento: EventoConversazione): EventoConversazione {
    if (evento.tipo !== "azione-conclusa" && evento.tipo !== "messaggio-proprietario") return evento;
    if (evento.immagini === undefined) return evento;
    const { immagini: inViaggio, ...resto } = evento;
    const custodite = inViaggio.flatMap((immagine) => this.#salva(idConversazione, immagine));
    return custodite.length === 0 ? resto : { ...resto, immagini: custodite };
  }

  /** Dove si trova un'immagine in custodia e di che tipo è; nulla se il nome non è uno dei nostri. */
  /** La cartella delle immagini di una conversazione, per sapere quanto occupa. */
  cartellaDi(idConversazione: string): string | undefined {
    return NOME_CONVERSAZIONE.test(idConversazione) ? join(this.#cartella, idConversazione) : undefined;
  }

  /** Toglie le immagini di una conversazione che non c'è più. */
  async dimentica(idConversazione: string): Promise<void> {
    if (!NOME_CONVERSAZIONE.test(idConversazione)) return;
    await rm(join(this.#cartella, idConversazione), { recursive: true, force: true });
  }

  trova(idConversazione: string, id: string): { file: string; tipo: string } | undefined {
    if (!NOME_CONVERSAZIONE.test(idConversazione) || !NOME_IMMAGINE.test(id)) return undefined;
    const file = join(this.#cartella, idConversazione, id);
    if (!existsSync(file)) return undefined;
    const estensione = id.slice(id.lastIndexOf(".") + 1);
    const tipo = Object.entries(TIPI_IMMAGINE).find(([, e]) => e === estensione)?.[0];
    return tipo === undefined ? undefined : { file, tipo };
  }

  #salva(idConversazione: string, immagine: Immagine): Immagine[] {
    // Già in custodia: succede quando un evento viene ripubblicato.
    if (immagine.dati === undefined) return immagine.id === undefined ? [] : [immagine];
    const estensione = TIPI_IMMAGINE[immagine.tipo];
    if (estensione === undefined || !NOME_CONVERSAZIONE.test(idConversazione)) return [];
    try {
      const cartella = join(this.#cartella, idConversazione);
      mkdirSync(cartella, { recursive: true });
      const id = `${randomUUID()}.${estensione}`;
      writeFileSync(join(cartella, id), Buffer.from(immagine.dati, "base64"));
      return [{ tipo: immagine.tipo, id }];
    } catch {
      // Un'immagine che non si riesce a salvare non deve fermare la conversazione.
      return [];
    }
  }
}
