/**
 * Il motore di una conversazione: Claude Code oppure Codex, scelto per conversazione come il
 * modello (sezione 4.12, ADR 0030). Il resto di Shinka parla con la stessa porta della
 * conversazione e non sa quale motore ci sia dietro.
 *
 * Una conversazione tiene un motore alla volta. Quando il proprietario lo cambia, finito il turno
 * in corso, quello di prima si chiude e il nuovo riceve, con il messaggio successivo, gli ultimi
 * scambi della conversazione: le sessioni dei due motori non si passano il contesto. Ogni motore
 * ha la sua sessione, e tornando a un motore si riprende la sua.
 */

import type { Allegato } from "../protocollo/allegati.ts";
import type {
  AnteprimaRiavvolgimento,
  DecisionePermesso,
  EsitoBiforcazione,
  EventoConversazione,
  PortaConversazione,
  RispostaAParte,
  RispostaAlleDomande,
  ScambioDellaStoria,
  UscitaAttivita,
} from "../protocollo/eventi.ts";
import { MOTORI, NOMI_MOTORI, type ImpostazioniConversazione, type ModelloDisponibile, type Motore } from "../protocollo/impostazioni.ts";
import type { EsitoAnnullamento, VersioniDiUnFile } from "../protocollo/modifiche.ts";
import { leggiSessioni, scriviSessioni, type SessioniDeiMotori } from "../protocollo/sessioni.ts";
import { ConversazioneCodex, motoreConfigurato } from "./codex/conversazione-codex.ts";
import { Conversazione, type ConfigurazioneConversazione } from "./conversazione.ts";
import { modelliDeiMotori, type ModelliDeiMotori } from "./sonde-motori.ts";

export { motoreConfigurato, type Motore };

export interface OpzioniMotore {
  /** Come si apre la conversazione di un motore. Nei test, una finta. */
  apri?: (cfg: ConfigurazioneConversazione, motore: Motore) => PortaConversazione;
  /** Il motore delle conversazioni che non ne hanno scelto uno. */
  predefinito?: Motore;
  modelli?: ModelliDeiMotori;
}

let predefinitoImpostato: Motore | undefined;

/** Il motore delle conversazioni nuove: quello scelto nella pagina Impostazioni, o la variabile SHINKA_MOTORE. */
export function motorePredefinito(): Motore {
  return predefinitoImpostato ?? motoreConfigurato();
}

/** La pagina Impostazioni ha scelto il motore predefinito; undefined torna alla variabile. */
export function impostaMotorePredefinito(motore: Motore | undefined): void {
  predefinitoImpostato = motore;
}

/** Apre una conversazione con il motore scelto nelle sue impostazioni. */
export function apriConversazione(cfg: ConfigurazioneConversazione, opzioni: OpzioniMotore = {}): PortaConversazione {
  return new ConversazioneConMotore(cfg, opzioni);
}

function apriMotore(cfg: ConfigurazioneConversazione, motore: Motore): PortaConversazione {
  return motore === "codex" ? new ConversazioneCodex(cfg) : new Conversazione(cfg);
}

/** Quanti caratteri della conversazione passano al motore nuovo, e quanti al massimo per messaggio. */
const PASSAGGIO_MASSIMO = 24_000;
const INIZIO_DELLA_NOTA = "[Shinka] Il proprietario ha passato questa conversazione";
const MESSAGGIO_MASSIMO = 3_000;

/**
 * La nota che il motore nuovo riceve con il primo messaggio: gli ultimi scambi, dal più vecchio,
 * finché ci stanno. Undefined se non c'è nulla da passare.
 */
export function notaDelPassaggio(da: Motore, a: Motore, tutta: readonly ScambioDellaStoria[]): string | undefined {
  // La nota di un passaggio di prima è già nella storia dell'altro motore: non si ricopia.
  const storia = tutta.filter((scambio) => !scambio.testo.startsWith(INIZIO_DELLA_NOTA));
  const righe: string[] = [];
  let lunghezza = 0;
  for (let i = storia.length - 1; i >= 0; i--) {
    const scambio = storia[i]!;
    const testo = scambio.testo.length > MESSAGGIO_MASSIMO ? `${scambio.testo.slice(0, MESSAGGIO_MASSIMO)}… [tagliato]` : scambio.testo;
    const riga = `${scambio.chi === "proprietario" ? "Proprietario" : NOMI_MOTORI[da]}: ${testo}`;
    if (lunghezza + riga.length > PASSAGGIO_MASSIMO && righe.length > 0) break;
    righe.unshift(riga);
    lunghezza += riga.length;
  }
  if (righe.length === 0) return undefined;
  const parziale = righe.length < storia.length ? " (gli ultimi; quelli prima non ci stanno)" : "";
  return [
    `${INIZIO_DELLA_NOTA} da ${NOMI_MOTORI[da]} a ${NOMI_MOTORI[a]}: fin qui ha risposto ${NOMI_MOTORI[da]}, in una sessione che tu non vedi. Questi sono i suoi scambi con il proprietario${parziale}, perché tu possa continuare da dove sono arrivati. Le azioni fatte allora non sono ripetute qui: i file sono come li hanno lasciati.`,
    "",
    ...righe,
  ].join("\n\n");
}

class ConversazioneConMotore implements PortaConversazione {
  readonly #cfg: ConfigurazioneConversazione;
  readonly #apri: (cfg: ConfigurazioneConversazione, motore: Motore) => PortaConversazione;
  readonly #predefinito: Motore;
  readonly #modelli: ModelliDeiMotori;
  #impostazioni: ImpostazioniConversazione;
  #sessioni: SessioniDeiMotori;
  #motore: Motore;
  #interna: PortaConversazione;
  /** Il passaggio da un altro motore, finché la sua nota non è arrivata al motore nuovo. */
  #passaggio: Promise<string | undefined> | undefined;
  /** Ciò che aspetta la fine del passaggio, nell'ordine in cui è arrivato. */
  #coda: Promise<void> | undefined;
  #inTurno = false;
  /** Un cambio di motore chiesto durante un turno: si fa quando il turno finisce. */
  #cambioRimandato = false;
  #sondaggioChiesto = false;

  constructor(cfg: ConfigurazioneConversazione, opzioni: OpzioniMotore) {
    this.#cfg = cfg;
    this.#apri = opzioni.apri ?? apriMotore;
    this.#predefinito = opzioni.predefinito ?? motorePredefinito();
    this.#modelli = opzioni.modelli ?? modelliDeiMotori;
    this.#impostazioni = cfg.impostazioni;
    const sessioni = leggiSessioni(cfg.idSessione);
    this.#sessioni = sessioni ?? { ultimo: this.#predefinito, sessioni: {} };
    this.#motore = this.#scelto();
    this.#interna = this.#apri(this.#configurazione(this.#motore), this.#motore);
    // Il motore è cambiato mentre la conversazione era chiusa: il passaggio si fa adesso.
    const ultimo = this.#sessioni.ultimo;
    if (ultimo !== this.#motore && this.#sessioni.sessioni[ultimo] !== undefined) {
      const vecchia = this.#apri(this.#configurazione(ultimo), ultimo);
      this.#avviaPassaggio(ultimo, vecchia);
    }
  }

  /**
   * Il motore scelto nelle impostazioni; se non ce n'è uno, quello che ha lavorato per ultimo; per
   * una conversazione che non ha ancora lavorato, il predefinito. Così cambiare il predefinito
   * vale per le conversazioni nuove, e quelle già cominciate restano con il loro motore.
   */
  #scelto(): Motore {
    if (this.#impostazioni.motore !== undefined) return this.#impostazioni.motore;
    const conStoria = MOTORI.some((motore) => this.#sessioni.sessioni[motore] !== undefined);
    return conStoria ? this.#sessioni.ultimo : this.#predefinito;
  }

  #configurazione(motore: Motore): ConfigurazioneConversazione {
    const { idSessione: _di, ...resto } = this.#cfg;
    const idSessione = this.#sessioni.sessioni[motore];
    return {
      ...resto,
      impostazioni: this.#impostazioni,
      ...(idSessione === undefined ? {} : { idSessione }),
      alEvento: (evento) => this.#evento(motore, evento),
      alIdSessione: (id) => this.#idSessione(motore, id),
    };
  }

  #idSessione(motore: Motore, id: string): void {
    if (id === "") delete this.#sessioni.sessioni[motore];
    else this.#sessioni.sessioni[motore] = id;
    if (motore === this.#motore && id !== "") this.#sessioni.ultimo = motore;
    this.#ricordaSessioni();
  }

  #ricordaSessioni(): void {
    const nessuna = MOTORI.every((motore) => this.#sessioni.sessioni[motore] === undefined);
    this.#cfg.alIdSessione(nessuna ? "" : scriviSessioni(this.#sessioni));
  }

  #evento(motore: Motore, evento: EventoConversazione): void {
    if (motore !== this.#motore) {
      // Del motore di prima passa solo ciò che chiude il suo ultimo turno.
      if (evento.tipo !== "turno-concluso" && evento.tipo !== "errore") return;
    }
    if (evento.tipo === "turno-iniziato") this.#inTurno = true;
    if (evento.tipo === "stato") {
      const { modelli, ...resto } = evento.stato;
      if (modelli !== undefined) this.#modelli.ricorda(motore, modelli);
      this.#cfg.alEvento({ tipo: "stato", stato: { ...resto, motore: this.#motore, ...this.#elencoModelli() } });
      if (modelli !== undefined) this.#sondaGliAltri();
      return;
    }
    this.#cfg.alEvento(evento);
    if (evento.tipo === "turno-concluso" && motore === this.#motore) {
      this.#inTurno = false;
      if (this.#cambioRimandato) {
        this.#cambioRimandato = false;
        if (this.#scelto() !== this.#motore) this.#cambia(this.#scelto());
      }
    }
  }

  /** I modelli di tutti i motori che si conoscono, ciascuno con il suo motore. */
  #elencoModelli(): { modelli?: ModelloDisponibile[] } {
    const tutti = MOTORI.flatMap((motore) => (this.#modelli.noti(motore) ?? []).map((modello) => ({ ...modello, motore })));
    return tutti.length === 0 ? {} : { modelli: tutti };
  }

  /** La prima volta che il motore in uso dice i suoi modelli, si cercano quelli degli altri. */
  #sondaGliAltri(): void {
    if (this.#sondaggioChiesto) return;
    this.#sondaggioChiesto = true;
    const altri = MOTORI.filter((motore) => motore !== this.#motore && this.#modelli.noti(motore) === undefined);
    if (altri.length === 0) return;
    void Promise.all(altri.map((motore) => this.#modelli.leggi(motore))).then((letti) => {
      if (letti.some((modelli) => modelli !== undefined)) {
        this.#cfg.alEvento({ tipo: "stato", stato: { motore: this.#motore, ...this.#elencoModelli() } });
      }
    });
  }

  /** Passa al motore nuovo: quello di prima si chiude dopo aver detto la sua storia. */
  #cambia(nuovo: Motore): void {
    const vecchio = this.#motore;
    const vecchia = this.#interna;
    this.#motore = nuovo;
    this.#interna = this.#apri(this.#configurazione(nuovo), nuovo);
    this.#avviaPassaggio(vecchio, vecchia);
    this.#cfg.alEvento({
      tipo: "nota",
      testo: `Da qui risponde ${NOMI_MOTORI[nuovo]}: con il prossimo messaggio riceve gli ultimi scambi di questa conversazione.`,
    });
    // Comandi e limiti erano del motore di prima: si tolgono, e quello nuovo dice subito i suoi,
    // senza aspettare il primo messaggio.
    this.#cfg.alEvento({ tipo: "stato", stato: { motore: nuovo, comandi: [], limiti: {}, ...this.#elencoModelli() } });
    this.prepara();
  }

  #avviaPassaggio(da: Motore, vecchia: PortaConversazione): void {
    const a = this.#motore;
    this.#passaggio = (async () => {
      try {
        return notaDelPassaggio(da, a, (await vecchia.storia?.()) ?? []);
      } catch {
        return undefined;
      } finally {
        vecchia.chiudi();
      }
    })();
  }

  /** Esegue subito, oppure dopo il passaggio in corso, rispettando l'ordine. */
  #esegui(azione: () => void): void {
    if (this.#passaggio === undefined && this.#coda === undefined) {
      azione();
      return;
    }
    const passaggio = this.#passaggio;
    const coda: Promise<void> = (this.#coda ?? Promise.resolve())
      .then(async () => {
        if (passaggio !== undefined && this.#passaggio === passaggio) {
          const nota = await passaggio;
          if (this.#passaggio === passaggio) {
            this.#passaggio = undefined;
            if (nota !== undefined) this.#interna.annota(nota);
            this.#sessioni.ultimo = this.#motore;
            if (this.#sessioni.sessioni[this.#motore] !== undefined) this.#ricordaSessioni();
          }
        }
        azione();
      })
      .catch(() => {})
      .finally(() => {
        if (this.#coda === coda) this.#coda = undefined;
      });
    this.#coda = coda;
  }

  prepara(): void {
    this.#esegui(() => this.#interna.prepara());
  }

  invia(testo: string, allegati?: Allegato[]): void {
    this.#esegui(() => this.#interna.invia(testo, allegati));
  }

  annota(testo: string): void {
    this.#esegui(() => this.#interna.annota(testo));
  }

  istruisci(testo: string): void {
    this.#esegui(() => this.#interna.istruisci(testo));
  }

  imposta(impostazioni: ImpostazioniConversazione): void {
    this.#impostazioni = impostazioni;
    const scelto = this.#scelto();
    if (scelto === this.#motore) {
      this.#cambioRimandato = false;
      this.#interna.imposta(impostazioni);
      return;
    }
    if (this.#inTurno) {
      // Come le altre impostazioni, vale dal messaggio successivo: il turno in corso finisce con il suo motore.
      this.#cambioRimandato = true;
      return;
    }
    this.#cambia(scelto);
  }

  #nonCon(cosa: string): string {
    return `Con ${NOMI_MOTORI[this.#motore]} questa conversazione non sa ancora ${cosa}.`;
  }

  anteprimaRiavvolgimento(idMessaggio: string): Promise<AnteprimaRiavvolgimento> {
    return this.#interna.anteprimaRiavvolgimento?.(idMessaggio) ?? Promise.resolve({ motivo: this.#nonCon("ripartire da un messaggio") });
  }

  riprendiDa(idMessaggio: string, opzioni: { file: boolean }): Promise<string | undefined> {
    return this.#interna.riprendiDa?.(idMessaggio, opzioni) ?? Promise.resolve(this.#nonCon("ripartire da un messaggio"));
  }

  async biforca(idMessaggio: string): Promise<EsitoBiforcazione> {
    const motore = this.#motore;
    if (this.#interna.biforca === undefined) return { riuscita: false, motivo: this.#nonCon("far nascere un argomento da un messaggio") };
    const esito = await this.#interna.biforca(idMessaggio);
    // La copia nasce con il motore di adesso: l'argomento nuovo la riprende con quello.
    if (!esito.riuscita || esito.idSessione === undefined) return esito;
    return { riuscita: true, idSessione: scriviSessioni({ ultimo: motore, sessioni: { [motore]: esito.idSessione } }) };
  }

  chiediAParte(domanda: string): Promise<RispostaAParte> {
    return this.#interna.chiediAParte?.(domanda) ?? Promise.resolve({ motivo: this.#nonCon("rispondere a una domanda a parte") });
  }

  versioniModificate(idTurno: string, percorso: string): Promise<VersioniDiUnFile | { motivo: string }> {
    return this.#interna.versioniModificate?.(idTurno, percorso) ?? Promise.resolve({ motivo: this.#nonCon("tenere le modifiche dei turni") });
  }

  uscitaAttivita(idAttivita: string): Promise<UscitaAttivita | { motivo: string }> {
    return this.#interna.uscitaAttivita?.(idAttivita) ?? Promise.resolve({ motivo: this.#nonCon("tenere le attività") });
  }

  annullaModifiche(idTurno: string, percorsi?: readonly string[]): Promise<EsitoAnnullamento | { motivo: string }> {
    return this.#interna.annullaModifiche?.(idTurno, percorsi) ?? Promise.resolve({ motivo: this.#nonCon("tenere le modifiche dei turni") });
  }

  storia(): Promise<ScambioDellaStoria[]> {
    return this.#interna.storia?.() ?? Promise.resolve([]);
  }

  decidiPermesso(idPermesso: string, decisione: DecisionePermesso): boolean {
    return this.#interna.decidiPermesso(idPermesso, decisione);
  }

  rispondiDomande(idDomande: string, risposta: RispostaAlleDomande): boolean {
    return this.#interna.rispondiDomande?.(idDomande, risposta) ?? false;
  }

  interrompi(): Promise<void> {
    return this.#interna.interrompi();
  }

  chiudi(): void {
    this.#interna.chiudi();
  }

  ricaricaSkill(): void {
    this.#interna.ricaricaSkill?.();
  }

  ricaricaEstensioni(): void {
    this.#interna.ricaricaEstensioni?.();
  }
}
