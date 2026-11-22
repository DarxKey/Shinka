/**
 * Gli elaborati degli argomenti della Home: i file che stanno nella cartella di un argomento, in
 * ciascun ambiente. Il centro li elenca e li legge per il pannello dell'interfaccia: nel proprio
 * ambiente direttamente, negli altri chiedendolo al nodo. Non li copia e non li conserva: restano
 * dove la Home li ha scritti.
 */

import type { AzioneInAmbiente, ElencoFile, EsitoAzione } from "../protocollo/azioni.ts";
import {
  DURATA_AGGIORNA_MS,
  ELABORATO_MASSIMO,
  MODIFICA_MASSIMA,
  modificabileAMano,
  type ElaboratoConsegnato,
  percorsoDiElaboratoValido,
  type ElaboratiDellArgomento,
  type ElaboratiInAmbiente,
  type VoceElaborato,
} from "../protocollo/elaborati.ts";
import type { EventoArchiviato } from "../protocollo/eventi.ts";
import type { Ambiente } from "../protocollo/nodi.ts";
import { elencaFile, esegui, leggiElaborato } from "../nodo/azioni.ts";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AmbienteSpento } from "./esecutori.ts";
import { fileScritti } from "./storia.ts";

export interface OpzioniElaborati {
  ambienti: () => readonly Ambiente[];
  /** La storia di un argomento, aperto o archiviato; nulla se l'argomento non esiste. */
  storia: (idArgomento: string) => Promise<readonly EventoArchiviato[] | undefined>;
  /** La cartella di un argomento nell'ambiente del centro, dove lavora la Home. */
  cartellaAlCentro: (idArgomento: string) => string;
  /** Compie un'azione in un ambiente diverso da quello del centro. */
  agisci: (idAmbiente: string, idArgomento: string, azione: AzioneInAmbiente) => Promise<EsitoAzione>;
  /** Gli argomenti della Home, l'aperto e gli archiviati, con il titolo se ce l'hanno. */
  argomenti?: () => { id: string; titolo?: string }[];
}

/** Perché un elaborato non si è potuto leggere, con il codice HTTP che lo dice al browser. */
export interface ProblemaElaborato {
  problema: string;
  codice: 400 | 404 | 409 | 502;
}

const NODO_DI_PRIMA =
  "L'ambiente non ha risposto. Se il suo nodo è di una versione precedente non sa ancora mostrare gli elaborati: va aggiornato.";

export class Elaborati {
  readonly #o: OpzioniElaborati;

  constructor(opzioni: OpzioniElaborati) {
    this.#o = opzioni;
  }

  /**
   * Gli elaborati di un argomento, ambiente per ambiente, i più recenti per primi. Compaiono gli
   * ambienti in cui l'argomento ha file, e quelli in cui non si è potuto guardare ma la storia dice
   * che vi ha scritto. Nulla se l'argomento non esiste.
   */
  async elenca(idArgomento: string): Promise<ElaboratiDellArgomento | undefined> {
    const storia = await this.#o.storia(idArgomento);
    if (storia === undefined) return undefined;
    const nominati = new Set(
      fileScritti(storia)
        .map((file) => file.ambiente?.toLowerCase())
        .filter((nome) => nome !== undefined),
    );
    const elenchi = await Promise.all(
      this.#o.ambienti().map(async (ambiente): Promise<ElaboratiInAmbiente | undefined> => {
        const base = { idAmbiente: ambiente.id, nomeAmbiente: ambiente.nome, attivo: ambiente.attivo };
        const vale = (problema: string): ElaboratiInAmbiente | undefined =>
          ambiente.delCentro || nominati.has(ambiente.nome.toLowerCase())
            ? { ...base, file: [], quanti: 0, problema }
            : undefined;
        if (!ambiente.attivo && !ambiente.delCentro) {
          return vale("L'ambiente è spento: i suoi file si vedranno quando tornerà attivo.");
        }
        let elenco: ElencoFile;
        try {
          elenco = await this.#elencoIn(ambiente, idArgomento);
        } catch (errore) {
          return vale(
            errore instanceof AmbienteSpento
              ? "L'ambiente si è appena spento."
              : `Non sono riuscito a guardare: ${errore instanceof Error ? errore.message : String(errore)}`,
          );
        }
        const voci = vociVisibili(elenco);
        if (voci.length === 0) return undefined;
        return { ...base, file: voci, quanti: elenco.quanti - (elenco.percorsi.length - voci.length) };
      }),
    );
    return {
      idArgomento,
      ambienti: elenchi.filter((voce): voce is ElaboratiInAmbiente => voce !== undefined),
    };
  }

  /**
   * Gli elaborati definitivi di tutti gli argomenti: quelli che la Home ha mostrato al proprietario,
   * una volta sola ciascuno, con l'ultima volta che li ha mostrati. I più recenti per primi.
   */
  async consegnati(): Promise<ElaboratoConsegnato[]> {
    const tutti = new Map<string, ElaboratoConsegnato>();
    // A parità di ora conta l'ordine in cui la Home li ha mostrati.
    const ordine = new Map<string, number>();
    let contati = 0;
    for (const argomento of this.#o.argomenti?.() ?? []) {
      const storia = await this.#o.storia(argomento.id);
      for (const { quando, evento } of storia ?? []) {
        if (evento.tipo !== "elaborato-mostrato") continue;
        const chiave = `${evento.idArgomento}\n${evento.idAmbiente}\n${evento.percorso}`;
        const prima = tutti.get(chiave);
        // Mostrato di nuovo, magari dopo una modifica: resta uno, con la data e il titolo più recenti.
        if (prima !== undefined && prima.quando > quando) continue;
        const titolo = evento.titolo ?? prima?.titolo;
        // Il comando che lo rifà è quello dell'ultima volta che è stato mostrato.
        const aggiorna = evento.aggiorna;
        ordine.set(chiave, (contati += 1));
        tutti.set(chiave, {
          idArgomento: evento.idArgomento,
          ...(argomento.titolo === undefined ? {} : { titoloArgomento: argomento.titolo }),
          idAmbiente: evento.idAmbiente,
          nomeAmbiente: evento.nomeAmbiente,
          percorso: evento.percorso,
          ...(titolo === undefined ? {} : { titolo }),
          ...(aggiorna === undefined ? {} : { aggiorna }),
          quando,
        });
      }
    }
    const chiaveDi = (voce: ElaboratoConsegnato): string => `${voce.idArgomento}\n${voce.idAmbiente}\n${voce.percorso}`;
    return [...tutti.values()].sort(
      (a, b) => b.quando.localeCompare(a.quando) || (ordine.get(chiaveDi(b)) ?? 0) - (ordine.get(chiaveDi(a)) ?? 0),
    );
  }

  /**
   * Il contenuto di un elaborato, così com'è. Nell'ambiente del centro vale `massimo`; negli altri
   * il limite lo tiene il nodo.
   */
  async leggi(
    idArgomento: string,
    idAmbiente: string,
    percorso: string,
    massimo: number = ELABORATO_MASSIMO,
  ): Promise<{ dati: Buffer } | ProblemaElaborato> {
    if (!percorsoDiElaboratoValido(percorso)) return { problema: "Percorso non valido.", codice: 400 };
    if ((await this.#o.storia(idArgomento)) === undefined) return { problema: "Argomento non trovato.", codice: 404 };
    const ambiente = this.#o.ambienti().find((voce) => voce.id === idAmbiente);
    if (ambiente === undefined) return { problema: "Ambiente non trovato.", codice: 404 };
    if (ambiente.delCentro) {
      const letto = await leggiElaborato(this.#o.cartellaAlCentro(idArgomento), percorso, massimo);
      return "dati" in letto ? letto : { problema: letto.problema, codice: 404 };
    }
    if (!ambiente.attivo) {
      return { problema: `L'ambiente «${ambiente.nome}» è spento: il file si vedrà quando tornerà attivo.`, codice: 409 };
    }
    let esito: EsitoAzione;
    try {
      esito = await this.#o.agisci(ambiente.id, idArgomento, { tipo: "leggi-elaborato", percorso });
    } catch (errore) {
      return errore instanceof AmbienteSpento
        ? { problema: `L'ambiente «${ambiente.nome}» si è appena spento.`, codice: 409 }
        : { problema: NODO_DI_PRIMA, codice: 502 };
    }
    if (!esito.riuscita) return { problema: esito.testo, codice: 404 };
    return { dati: Buffer.from(esito.testo, "base64") };
  }

  /**
   * Rifà un elaborato vivo con il comando che la Home gli ha dato mostrandolo l'ultima volta: il
   * comando viene dalla storia dell'argomento, mai da chi chiede. Parte nella cartella
   * dell'argomento, nel suo ambiente. L'uscita, oppure perché non si è potuto.
   */
  async aggiorna(idArgomento: string, idAmbiente: string, percorso: string): Promise<{ riuscita: boolean; uscita: string } | ProblemaElaborato> {
    const storia = await this.#o.storia(idArgomento);
    if (storia === undefined) return { problema: "Argomento non trovato.", codice: 404 };
    const mostrato = storia.findLast(
      ({ evento }) => evento.tipo === "elaborato-mostrato" && evento.idAmbiente === idAmbiente && evento.percorso === percorso,
    )?.evento;
    if (mostrato?.tipo !== "elaborato-mostrato") return { problema: "Questo elaborato non è tra quelli consegnati.", codice: 404 };
    if (mostrato.aggiorna === undefined) return { problema: "Questo elaborato non ha un comando che lo aggiorna.", codice: 409 };
    const ambiente = this.#o.ambienti().find((voce) => voce.id === idAmbiente);
    if (ambiente === undefined) return { problema: "Ambiente non trovato.", codice: 404 };
    let esito: EsitoAzione;
    if (ambiente.delCentro) {
      esito = await esegui(this.#o.cartellaAlCentro(idArgomento), mostrato.aggiorna, DURATA_AGGIORNA_MS);
    } else {
      if (!ambiente.attivo) return { problema: `L'ambiente «${ambiente.nome}» è spento: si aggiorna quando tornerà attivo.`, codice: 409 };
      try {
        esito = await this.#o.agisci(ambiente.id, idArgomento, { tipo: "esegui", comando: mostrato.aggiorna, durataMs: DURATA_AGGIORNA_MS });
      } catch (errore) {
        return errore instanceof AmbienteSpento ? { problema: `L'ambiente «${ambiente.nome}» si è appena spento.`, codice: 409 } : { problema: NODO_DI_PRIMA, codice: 502 };
      }
    }
    return { riuscita: esito.riuscita, uscita: esito.testo.slice(-4000) };
  }

  /**
   * Il proprietario riscrive a mano un elaborato di testo che la Home gli ha consegnato. Il
   * motivo, se non si può.
   */
  async scrivi(idArgomento: string, idAmbiente: string, percorso: string, contenuto: string): Promise<ProblemaElaborato | undefined> {
    if (!percorsoDiElaboratoValido(percorso)) return { problema: "Percorso non valido.", codice: 400 };
    if (!modificabileAMano(percorso)) return { problema: "A mano si modificano solo gli elaborati di testo e Markdown.", codice: 400 };
    if (Buffer.byteLength(contenuto) > MODIFICA_MASSIMA) return { problema: "Il testo è troppo lungo.", codice: 400 };
    const storia = await this.#o.storia(idArgomento);
    if (storia === undefined) return { problema: "Argomento non trovato.", codice: 404 };
    const consegnato = storia.some(({ evento }) => evento.tipo === "elaborato-mostrato" && evento.idAmbiente === idAmbiente && evento.percorso === percorso);
    if (!consegnato) return { problema: "Questo elaborato non è tra quelli consegnati.", codice: 404 };
    const ambiente = this.#o.ambienti().find((voce) => voce.id === idAmbiente);
    if (ambiente === undefined) return { problema: "Ambiente non trovato.", codice: 404 };
    if (ambiente.delCentro) {
      try {
        await writeFile(join(this.#o.cartellaAlCentro(idArgomento), ...percorso.split("/")), contenuto);
        return undefined;
      } catch (errore) {
        return { problema: `Non sono riuscito a salvarlo: ${errore instanceof Error ? errore.message : String(errore)}`, codice: 409 };
      }
    }
    if (!ambiente.attivo) return { problema: `L'ambiente «${ambiente.nome}» è spento: si salva quando tornerà attivo.`, codice: 409 };
    try {
      const esito = await this.#o.agisci(ambiente.id, idArgomento, { tipo: "scrivi-file", percorso, contenuto });
      return esito.riuscita ? undefined : { problema: esito.testo, codice: 409 };
    } catch (errore) {
      return errore instanceof AmbienteSpento ? { problema: `L'ambiente «${ambiente.nome}» si è appena spento.`, codice: 409 } : { problema: NODO_DI_PRIMA, codice: 502 };
    }
  }

  /**
   * Ritrova un elaborato che la Home vuole mostrare: l'ambiente per nome e il percorso, relativo
   * alla cartella dell'argomento o completo dentro di essa. Controlla che il file ci sia.
   */
  async trova(
    idArgomento: string,
    nomeAmbiente: string,
    percorso: string,
  ): Promise<{ ambiente: Ambiente; percorso: string } | { problema: string }> {
    const cercato = nomeAmbiente.trim().toLowerCase();
    const tutti = this.#o.ambienti();
    const ambiente =
      tutti.find((voce) => voce.nome.toLowerCase() === cercato) ??
      tutti.find((voce) => cercato !== "" && (voce.nome.toLowerCase().includes(cercato) || cercato.includes(voce.nome.toLowerCase())));
    if (ambiente === undefined) {
      return { problema: `Nessun ambiente si chiama "${nomeAmbiente}". Gli ambienti sono: ${tutti.map((a) => `"${a.nome}"`).join(", ")}.` };
    }
    if (!ambiente.attivo && !ambiente.delCentro) {
      return { problema: `L'ambiente "${ambiente.nome}" è spento: il file non si può mostrare adesso.` };
    }
    const cartella = ambiente.delCentro
      ? this.#o.cartellaAlCentro(idArgomento)
      : cartellaRemota(ambiente.radiceProgetti, idArgomento);
    const relativo = relativoAllaCartella(cartella, percorso, !ambiente.delCentro && diWindows(ambiente.radiceProgetti));
    if (relativo === undefined) {
      return {
        problema:
          `Il file "${percorso}" non sta nella cartella di questo argomento in "${ambiente.nome}" (${cartella}). ` +
          "Si possono mostrare solo i file dell'argomento: copialo lì, poi riprova.",
      };
    }
    let elenco: ElencoFile;
    try {
      elenco = await this.#elencoIn(ambiente, idArgomento);
    } catch (errore) {
      return { problema: `Non sono riuscito a guardare in "${ambiente.nome}": ${errore instanceof Error ? errore.message : String(errore)}` };
    }
    // Un elenco troncato non dice tutto: oltre il massimo il file si dà per buono.
    const completo = elenco.percorsi.length >= elenco.quanti;
    if (completo && !elenco.percorsi.includes(relativo)) {
      return { problema: `Il file "${relativo}" non c'è nella cartella di questo argomento in "${ambiente.nome}".` };
    }
    return { ambiente, percorso: relativo };
  }

  async #elencoIn(ambiente: Ambiente, idArgomento: string): Promise<ElencoFile> {
    if (ambiente.delCentro) return elencaFile(this.#o.cartellaAlCentro(idArgomento));
    const esito = await this.#o.agisci(ambiente.id, idArgomento, { tipo: "elenca-file" });
    if (!esito.riuscita) throw new Error(esito.testo);
    const percorsi = esito.file ?? [];
    return {
      percorsi,
      quanti: esito.quantiFile ?? percorsi.length,
      ...(esito.dettagli === undefined ? {} : { dettagli: esito.dettagli }),
    };
  }
}

/** I file da mostrare, i più recenti per primi: non quelli nascosti, come le impostazioni degli strumenti. */
function vociVisibili(elenco: ElencoFile): VoceElaborato[] {
  const voci: VoceElaborato[] = [];
  elenco.percorsi.forEach((percorso, posizione) => {
    if (percorso.split("/").some((pezzo) => pezzo.startsWith("."))) return;
    const dettaglio = elenco.dettagli?.[posizione];
    voci.push({
      percorso,
      ...(dettaglio === undefined ? {} : { byte: dettaglio.byte, modificatoIl: dettaglio.modificatoIl }),
    });
  });
  return voci.sort(
    (a, b) => (b.modificatoIl ?? "").localeCompare(a.modificatoIl ?? "") || a.percorso.localeCompare(b.percorso),
  );
}

function diWindows(percorso: string): boolean {
  return /^[A-Za-z]:|\\/.test(percorso);
}

function cartellaRemota(radiceProgetti: string, idArgomento: string): string {
  const separatore = diWindows(radiceProgetti) ? "\\" : "/";
  return [radiceProgetti.replace(/[\\/]+$/, ""), "_home", idArgomento].join(separatore);
}

/**
 * Il percorso di un file relativo alla cartella dell'argomento, con la barra dritta. Un percorso
 * completo vale solo se sta dentro la cartella. Nulla se ne esce.
 */
export function relativoAllaCartella(cartella: string, percorso: string, windows: boolean): string | undefined {
  const uniforma = (testo: string): string => testo.trim().replace(/\\/g, "/").replace(/\/+/g, "/");
  const completo = /^([A-Za-z]:|\/)/.test(uniforma(percorso));
  let relativo = uniforma(percorso);
  if (completo) {
    const radice = `${uniforma(cartella).replace(/\/$/, "")}/`;
    const confronta = (testo: string): string => (windows ? testo.toLowerCase() : testo);
    if (!confronta(relativo).startsWith(confronta(radice))) return undefined;
    relativo = relativo.slice(radice.length);
  }
  relativo = relativo.replace(/^(\.\/)+/, "");
  return percorsoDiElaboratoValido(relativo) ? relativo : undefined;
}
