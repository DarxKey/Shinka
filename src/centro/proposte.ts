/**
 * Le proposte di progetto fatte dalla Home. Una proposta non crea nulla:
 * il progetto nasce solo quando il proprietario la conferma.
 *
 * Il proprietario può anche creare un progetto da sé, dalla sua pagina, con le stesse scelte della
 * scheda: lì è lui a scrivere nome e brief, e la Home ne viene avvisata.
 */

import { randomUUID } from "node:crypto";
import type { OrigineFile } from "../protocollo/azioni.ts";
import type { FileDaPortare } from "../protocollo/eventi.ts";
import type { ConfermaProposta, NuovoProgettoAMano, SchedaNuovoProgetto } from "../protocollo/progetti.ts";
import type { RegistroAmbienti } from "./ambienti.ts";
import type { Canale } from "./canale.ts";
import { ProgettoNonCreato, type AvvioDelProgetto, type LavoriDeiProgetti, type ProgettoNato } from "./lavori.ts";
import {
  haLeSkillDiPartenza,
  PLUGIN_DELLE_SKILL_DI_PARTENZA,
  sceltePredefinite,
  skillPredefinita,
  type EstensioniDegliAmbienti,
  type PreparazioneDelProgetto,
} from "../protocollo/avvio-progetto.ts";
import { IMPOSTAZIONI_DI_PROGETTO } from "../nodo/profili.ts";
import type { ModelloDisponibile } from "../protocollo/impostazioni.ts";

/** Quanti percorsi per ambiente compaiono nella scheda: il conto dice comunque quanti sono. */
const PERCORSI_MOSTRATI = 30;

/** I file che l'argomento in cui nasce una proposta ha negli ambienti attivi. */
export interface DaPortare {
  origine: OrigineFile;
  /** Solo gli ambienti in cui l'argomento ha almeno un file. */
  file: FileDaPortare[];
}

interface Proposta {
  nome: string;
  brief: string;
  idAmbiente: string;
  /** Presente se l'argomento ha già prodotto file: il progetto può nascere con quelli del suo ambiente. */
  daPortare?: DaPortare;
  /** Una cartella che esiste già, già controllata: il progetto nasce lì. */
  cartellaEsistente?: string;
  /** Ciò che il proprietario deve sapere di quella cartella. */
  avvisoCartella?: string;
}

interface PropostaInAttesa extends Proposta {
  /** L'archivio dell'argomento in cui la proposta è stata fatta: lì va anche la decisione. */
  canale: Canale;
}

export interface OpzioniProposte {
  /** L'archivio dell'argomento aperto nella Home, chiesto nel momento in cui serve. */
  canaleHome(): Canale;
  /** Aggiunge un'informazione al contesto della Home, senza farla rispondere. */
  annotaHome(testo: string): void;
  /** L'argomento aperto nella Home: da lì vengono i file che un progetto può portare con sé. */
  argomentoAperto(): OrigineFile;
  lavori: LavoriDeiProgetti;
  ambienti: RegistroAmbienti;
  /** Che cosa un progetto nuovo può avere in ciascun ambiente; senza, i progetti hanno tutte le estensioni accese. */
  estensioniPerProgetto?(): EstensioniDegliAmbienti;
}

export class Proposte {
  readonly #o: OpzioniProposte;
  readonly #inAttesa = new Map<string, PropostaInAttesa>();

  constructor(opzioni: OpzioniProposte) {
    this.#o = opzioni;
  }

  /**
   * I file che l'argomento aperto ha in ciascun ambiente attivo; nulla se non ne ha.
   * Un ambiente che non risponde conta come senza file: la proposta non deve aspettarlo.
   */
  async fileDellArgomento(): Promise<DaPortare | undefined> {
    const origine = this.#o.argomentoAperto();
    const attivi = this.#o.ambienti.stato().ambienti.filter((ambiente) => ambiente.attivo);
    const elenchi = await Promise.allSettled(
      attivi.map((ambiente) => this.#o.lavori.elencaFile(ambiente.id, origine)),
    );
    const file: FileDaPortare[] = [];
    elenchi.forEach((elenco, posizione) => {
      const ambiente = attivi[posizione];
      if (ambiente === undefined || elenco.status !== "fulfilled" || elenco.value.quanti === 0) return;
      file.push({
        idAmbiente: ambiente.id,
        percorsi: elenco.value.percorsi.slice(0, PERCORSI_MOSTRATI),
        quanti: elenco.value.quanti,
      });
    });
    return file.length === 0 ? undefined : { origine, file };
  }

  /** Ciò che serve alla scheda con cui il proprietario crea un progetto da sé. */
  schedaNuovoProgetto(): SchedaNuovoProgetto {
    const modelli = modelliDa(this.#o.canaleHome());
    return {
      impostazioni: IMPOSTAZIONI_DI_PROGETTO,
      ...(modelli === undefined ? {} : { modelli }),
      ...(this.#o.estensioniPerProgetto === undefined ? {} : { estensioni: this.#o.estensioniPerProgetto() }),
    };
  }

  /**
   * Il proprietario crea un progetto da sé: nome, ambiente e brief li scrive lui, con le stesse
   * scelte della scheda di una proposta. Lancia `ProgettoNonCreato` se non può nascere.
   */
  async creaAMano(nuovo: NuovoProgettoAMano): Promise<ProgettoNato> {
    const cartellaEsistente = (nuovo.cartellaEsistente ?? "").trim();
    const avvio = this.#avvio(nuovo.idAmbiente, cartellaEsistente, nuovo);
    const progetto = await this.#o.lavori.crea(
      nuovo.nome,
      nuovo.idAmbiente,
      nuovo.brief,
      undefined,
      cartellaEsistente === "" ? undefined : cartellaEsistente,
      {
        ...(nuovo.motore === undefined ? {} : { motore: nuovo.motore }),
        ...(nuovo.modello === undefined ? {} : { modello: nuovo.modello }),
        ...(nuovo.impegno === undefined ? {} : { impegno: nuovo.impegno }),
        ...(nuovo.permessi === undefined ? {} : { permessi: nuovo.permessi }),
      },
      avvio,
    );
    // La Home sa tutto dei progetti: anche di quelli che non ha proposto lei.
    this.#o.annotaHome(
      `[Shinka] Il proprietario ha creato da sé, dall'interfaccia, il progetto "${progetto.nome}" ` +
        `nell'ambiente "${this.#nomeAmbiente(progetto.idAmbiente)}": il lavoro si svolge lì, non qui.`,
    );
    return progetto;
  }

  /** La Home propone un progetto: compare la scheda, e nient'altro. */
  proponi(proposta: Proposta): string {
    const idProposta = randomUUID();
    const canale = this.#o.canaleHome();
    this.#inAttesa.set(idProposta, { ...proposta, canale });
    canale.pubblica({
      tipo: "proposta-progetto",
      idProposta,
      nome: proposta.nome,
      idAmbiente: proposta.idAmbiente,
      brief: proposta.brief,
      ...(proposta.daPortare === undefined ? {} : { file: proposta.daPortare.file }),
      ...(proposta.cartellaEsistente === undefined ? {} : { cartellaEsistente: proposta.cartellaEsistente }),
      ...(proposta.avvisoCartella === undefined ? {} : { avvisoCartella: proposta.avvisoCartella }),
      // Le impostazioni con cui il progetto nascerebbe, e i modelli tra cui scegliere.
      impostazioni: IMPOSTAZIONI_DI_PROGETTO,
      ...(modelliDa(canale) === undefined ? {} : { modelli: modelliDa(canale) }),
      ...(this.#o.estensioniPerProgetto === undefined ? {} : { estensioni: this.#o.estensioniPerProgetto() }),
    });
    return idProposta;
  }

  /**
   * Il proprietario conferma, eventualmente cambiando nome o ambiente.
   * Restituisce il progetto nato, oppure nulla se la proposta non è più in attesa.
   * Se il progetto non può nascere lancia l'errore e la proposta resta in attesa.
   */
  async conferma(idProposta: string, modifiche: ConfermaProposta): Promise<ProgettoNato | undefined> {
    const proposta = this.#inAttesa.get(idProposta);
    if (proposta === undefined) return undefined;
    const idAmbiente = modifiche.idAmbiente ?? proposta.idAmbiente;
    // Il proprietario può cambiare la cartella a mano, o svuotarla per averne una nuova.
    const cartellaEsistente = (modifiche.cartellaEsistente ?? proposta.cartellaEsistente ?? "").trim();
    // Un progetto nasce con i file del proprio ambiente: quelli rimasti altrove non lo seguono.
    // In una cartella che esiste già non si copia nulla.
    const haFileLi = proposta.daPortare?.file.some((voce) => voce.idAmbiente === idAmbiente) === true;
    const origine =
      cartellaEsistente === "" && modifiche.portaFile !== false && haFileLi ? proposta.daPortare?.origine : undefined;
    const avvio = this.#avvio(idAmbiente, cartellaEsistente, modifiche);
    const progetto = await this.#o.lavori.crea(
      modifiche.nome ?? proposta.nome,
      idAmbiente,
      proposta.brief,
      origine,
      cartellaEsistente === "" ? undefined : cartellaEsistente,
      {
        ...(modifiche.motore === undefined ? {} : { motore: modifiche.motore }),
        ...(modifiche.modello === undefined ? {} : { modello: modifiche.modello }),
        ...(modifiche.impegno === undefined ? {} : { impegno: modifiche.impegno }),
        ...(modifiche.permessi === undefined ? {} : { permessi: modifiche.permessi }),
      },
      avvio,
    );
    const filePortati = progetto.filePortati ?? 0;
    this.#inAttesa.delete(idProposta);
    proposta.canale.pubblica({
      tipo: "proposta-decisa",
      idProposta,
      esito: "confermata",
      idProgetto: progetto.id,
      nome: progetto.nome,
      ...(filePortati === 0 ? {} : { filePortati }),
      ...(progetto.adottata === undefined ? {} : { cartellaAdottata: { percorso: progetto.cartella, git: progetto.adottata.git } }),
      ...(avvio.estensioni === undefined ? {} : { estensioni: avvio.estensioni }),
      ...(avvio.skillDiPartenza === undefined ? {} : { skillDiPartenza: avvio.skillDiPartenza }),
    });
    this.#o.annotaHome(
      `[Shinka] Il proprietario ha confermato la proposta: il progetto "${progetto.nome}" è stato creato ` +
        `nell'ambiente "${this.#nomeAmbiente(progetto.idAmbiente)}" e il lavoro prosegue lì, non qui.` +
        (filePortati === 0
          ? ""
          : ` È nato con una copia di ${filePortati === 1 ? "un file" : `${filePortati} file`} di questo argomento.`) +
        (progetto.adottata === undefined
          ? ""
          : ` Lavora nella cartella che esisteva già, ${progetto.cartella}, senza che Shinka l'abbia toccata` +
            (progetto.adottata.git ? "." : ": non è un repository Git, e Shinka non l'ha inizializzato.")) +
        (avvio.skillDiPartenza === undefined ? "" : ` Il suo primo messaggio comincia con la skill ${avvio.skillDiPartenza}.`),
    );
    return progetto;
  }

  /**
   * Come comincia il progetto: le estensioni scelte nella scheda, che devono essere accese nel suo
   * ambiente, la skill di partenza, che vuole il suo plugin, e ciò che va preparato nella cartella.
   * Lancia `ProgettoNonCreato` se una scelta non sta in piedi.
   */
  #avvio(idAmbiente: string, cartellaEsistente: string, modifiche: ConfermaProposta): AvvioDelProgetto {
    if (this.#o.estensioniPerProgetto === undefined) return {};
    const disponibili = this.#o.estensioniPerProgetto()[idAmbiente]?.voci ?? [];
    const scelte = modifiche.estensioni ?? sceltePredefinite(disponibili);
    for (const nome of scelte) {
      const voce = disponibili.find((una) => una.nome === nome && una.provenienza === "shinka");
      if (voce === undefined) throw new ProgettoNonCreato(`L'estensione «${nome}» non è nell'elenco di Shinka.`);
      if (!voce.accesa) {
        throw new ProgettoNonCreato(`L'estensione «${nome}» non è accesa in «${this.#nomeAmbiente(idAmbiente)}»: accendila dalla pagina Estensioni, oppure toglila.`);
      }
    }
    const conLeSkill = haLeSkillDiPartenza(disponibili, scelte);
    const skill = modifiche.skillDiPartenza === undefined ? (conLeSkill ? skillPredefinita(cartellaEsistente) : undefined) : modifiche.skillDiPartenza ?? undefined;
    if (skill !== undefined && !conLeSkill) {
      throw new ProgettoNonCreato(`La skill ${skill} viene dal plugin ${PLUGIN_DELLE_SKILL_DI_PARTENZA}, che il progetto non avrebbe.`);
    }
    // Ciò che va preparato: per le estensioni scelte, e per quelle installate nell'ambiente, che ci sono sempre.
    const preparazioni: PreparazioneDelProgetto[] = [];
    for (const voce of disponibili) {
      const presente = voce.provenienza === "ambiente" || scelte.includes(voce.nome);
      if (!presente || voce.preparazione === undefined) continue;
      if (preparazioni.some((una) => una.tipo === voce.preparazione?.tipo)) continue;
      preparazioni.push(voce.preparazione);
    }
    return {
      estensioni: [...new Set(scelte)],
      ...(skill === undefined ? {} : { skillDiPartenza: skill }),
      ...(preparazioni.length === 0 ? {} : { preparazioni }),
    };
  }

  /** Il proprietario annulla. Falso se la proposta non è più in attesa. */
  annulla(idProposta: string): boolean {
    const proposta = this.#inAttesa.get(idProposta);
    if (proposta === undefined) return false;
    this.#inAttesa.delete(idProposta);
    proposta.canale.pubblica({ tipo: "proposta-decisa", idProposta, esito: "annullata" });
    this.#o.annotaHome(
      `[Shinka] Il proprietario ha annullato la proposta del progetto "${proposta.nome}": non è stato creato nulla.`,
    );
    return true;
  }

  #nomeAmbiente(idAmbiente: string): string {
    return this.#o.ambienti.stato().ambienti.find((a) => a.id === idAmbiente)?.nome ?? idAmbiente;
  }
}

/** I modelli che l'harness ha riferito in una conversazione, se lo ha fatto. */
function modelliDa(canale: Canale): ModelloDisponibile[] | undefined {
  const stato = canale.ricordato("stato");
  return stato?.tipo === "stato" && stato.stato.modelli !== undefined && stato.stato.modelli.length > 0 ? stato.stato.modelli : undefined;
}
