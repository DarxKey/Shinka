/**
 * Il lavoro di un nodo nel suo ambiente: creare le cartelle dei progetti, far girare
 * le loro conversazioni ed eseguire le azioni della Home, su richiesta del centro.
 */

import type { EsitoAccessi, RichiestaAccessi } from "../protocollo/accessi.ts";
import type { RisorseDellAmbiente } from "../protocollo/risorse.ts";
import type { Motore } from "../protocollo/impostazioni.ts";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { CARTELLA_HOME } from "../protocollo/azioni.ts";
import type { PortaConversazione, RispostaAParte } from "../protocollo/eventi.ts";
import type { ImpostazioniConversazione } from "../protocollo/impostazioni.ts";
import type { ChiaviConsegnate } from "../protocollo/estensioni.ts";
import type { ComandoPerNodo, RiferitoDalNodo } from "../protocollo/nodi.ts";
import { TramiteAnteprima } from "./anteprima.ts";
import { Applicazioni, type OpzioniApplicazioni } from "./applicazioni.ts";
import { FileDeiProgettiQui } from "./file-progetto.ts";
import { eseguiAzione, eseguiAzioneInCartella } from "./azioni.ts";
import { Terminali, type AccendiShell } from "./terminali.ts";
import { adottaCartella, CartellaNonCreata, creaCartellaProgetto } from "./cartelle.ts";
import type { ConfigurazioneConversazione } from "./conversazione.ts";
import { apriConversazione } from "./motore.ts";
import { eIncarico } from "../protocollo/incarichi.ts";
import { configurazioneDiProgetto } from "./profili.ts";
import { nomeDiCartella } from "../protocollo/modifiche.ts";
import { EstensioniInAmbiente, soloLeScelte } from "./estensioni.ts";
import { preparaProgetto } from "./preparazione.ts";
import { scriviSkill } from "./skill.ts";
import type { SkillDistribuita } from "../protocollo/skill.ts";
import { attesaDelloStrumento, type ChiamaStrumento, type EsitoStrumento } from "../protocollo/strumenti.ts";

export interface ContestoLavoro {
  /** Cartella in cui nascono le cartelle dei progetti nuovi. */
  radiceProgetti: string;
  /** Manda al centro ciò che accade. */
  riferisci(messaggio: RiferitoDalNodo): void;
  /** Come le applicazioni dei progetti guardano la loro porta e quanto aspettano. Nei test si cambia. */
  applicazioni?: OpzioniApplicazioni;
  /** Come si prepara la cartella di un progetto nuovo. Nei test se ne mette uno finto. */
  preparaProgetto?: typeof preparaProgetto;
  /** Dove questo ambiente tiene la copia delle skill di Shinka. Senza, le skill non arrivano qui. */
  cartellaSkill?: string;
  /** Dove questo ambiente tiene le modifiche dei turni, una cartella per progetto. Senza, restano in memoria. */
  cartellaModifiche?: string;
  /**
   * Le estensioni che il centro accende in questo ambiente, se il nodo le sa tenere. Riceve il modo
   * di chiedere al centro le chiavi di una di loro, e quello di far ripartire le conversazioni aperte.
   */
  estensioni?(chiavi: (estensione: string) => Promise<ChiaviConsegnate>, alCambio: () => void): EstensioniInAmbiente;
  /** Vero se i progetti di questo ambiente possono usare il browser della macchina. */
  browserDelPc?: boolean;
  /** Come questo nodo passa alla versione del centro. Senza, il nodo non sa aggiornarsi da solo. */
  aggiorna?(comando: Extract<ComandoPerNodo, { tipo: "aggiorna" }>): void;
  /** Quanto si aspetta la risposta del centro a uno strumento. */
  attesaStrumentoMs?: number;
  /** Come si apre una conversazione. Nei test se ne mette una finta. */
  apriConversazione?: (configurazione: ConfigurazioneConversazione, motorePredefinito?: Motore) => PortaConversazione;
  /** Gli accessi dei motori in questo ambiente. Senza, il nodo non sa dirli. */
  accessi?: { esegui(richiesta: RichiestaAccessi): Promise<EsitoAccessi> };
  /** Le risorse di questa macchina, per la pagina dell'ambiente. Senza, il nodo non le dice. */
  risorse?: { leggi(): Promise<RisorseDellAmbiente> };
  /** Su Windows: il collegamento che fa partire il nodo a ogni accesso. Senza, il nodo non lo sa cambiare. */
  avvioConWindows?: { imposta(attivo: boolean): Promise<{ attivo: boolean } | { motivo: string }> };
  /** Come si accende la shell di un terminale. Nei test se ne mette una finta. */
  accendiShell?: AccendiShell;
}

export class LavoroDelNodo {
  readonly #contesto: ContestoLavoro;
  /** I terminali dei progetti di questo ambiente: restano accesi anche se il centro si scollega. */
  readonly #terminali: Terminali;
  readonly #anteprima: TramiteAnteprima;
  /** Le applicazioni dei progetti di questo ambiente: come i terminali, restano accese anche se il centro si scollega. */
  readonly #applicazioni: Applicazioni;
  readonly #file: FileDeiProgettiQui;
  readonly #conversazioni = new Map<string, PortaConversazione>();
  /** Gli strumenti chiesti al centro che aspettano risposta. */
  readonly #strumenti = new Map<string, { risolvi(esito: EsitoStrumento): void; scadenza: NodeJS.Timeout }>();
  /** Le scritture della copia delle skill si fanno una alla volta, nell'ordine in cui arrivano. */
  #scritturaSkill: Promise<void> = Promise.resolve();
  readonly #estensioni: EstensioniInAmbiente | undefined;
  /** Le chiavi chieste al centro che aspettano risposta. */
  readonly #chiavi = new Map<string, { risolvi(chiavi: ChiaviConsegnate): void; scadenza: NodeJS.Timeout }>();

  constructor(contesto: ContestoLavoro) {
    this.#contesto = contesto;
    this.#terminali = new Terminali(
      (messaggio) => contesto.riferisci(messaggio),
      contesto.accendiShell === undefined ? {} : { accendi: contesto.accendiShell },
    );
    this.#anteprima = new TramiteAnteprima((messaggio) => contesto.riferisci(messaggio));
    this.#applicazioni = new Applicazioni((messaggio) => contesto.riferisci(messaggio), contesto.applicazioni ?? {});
    this.#file = new FileDeiProgettiQui((messaggio) => contesto.riferisci(messaggio));
    this.#estensioni = contesto.estensioni?.(
      (estensione) => this.#chiediChiavi(estensione),
      () => {
        for (const conversazione of this.#conversazioni.values()) conversazione.ricaricaEstensioni?.();
      },
    );
  }

  /** Chiede al centro le chiavi di un'estensione che sta per partire: escono dal vault in quel momento. */
  #chiediChiavi(estensione: string): Promise<ChiaviConsegnate> {
    return new Promise((risolvi) => {
      const idRichiesta = randomUUID();
      const scadenza = setTimeout(() => {
        this.#chiavi.delete(idRichiesta);
        risolvi({ motivo: "il centro non ha risposto in tempo alla richiesta della chiave" });
      }, 20_000);
      this.#chiavi.set(idRichiesta, { risolvi, scadenza });
      this.#contesto.riferisci({ tipo: "chiavi-richieste", idRichiesta, estensione });
    });
  }

  /** Esegue un comando arrivato dal centro. */
  esegui(comando: ComandoPerNodo): void {
    switch (comando.tipo) {
      case "crea-cartella":
        void this.#creaCartella(comando.idRichiesta, comando.nomeCartella, comando.brief, comando.daArgomento);
        return;
      case "adotta-cartella":
        void this.#adottaCartella(comando.idRichiesta, comando.percorso);
        return;
      case "prepara-progetto": {
        const { idRichiesta, cartella, preparazioni } = comando;
        this.#contesto.riferisci({ tipo: "preparazione-cominciata", idRichiesta });
        void (this.#contesto.preparaProgetto ?? preparaProgetto)(cartella, preparazioni).then((esiti) =>
          this.#contesto.riferisci({ tipo: "progetto-preparato", idRichiesta, esiti }),
        );
        return;
      }
      case "apri-conversazione":
        this.#apri(comando.idConversazione, comando.cartella, comando.idSessione, comando.impostazioni, comando.estensioni, comando.motorePredefinito);
        return;
      case "accessi": {
        const { idRichiesta, richiesta } = comando;
        const esito = this.#contesto.accessi?.esegui(richiesta) ?? Promise.resolve({ motivo: "Questo nodo non sa dire gli accessi dei motori." });
        void esito.then((letto) => this.#contesto.riferisci({ tipo: "accessi-esito", idRichiesta, esito: letto }));
        return;
      }
      case "avvio-con-windows": {
        const { idRichiesta, attivo } = comando;
        const avvio = this.#contesto.avvioConWindows;
        if (avvio === undefined) {
          this.#contesto.riferisci({ tipo: "avvio-con-windows-esito", idRichiesta, motivo: "Questo nodo non sa cambiarlo da qui: rilancia su questa macchina il comando di una riga." });
          return;
        }
        void avvio.imposta(attivo).then(
          (esito) => this.#contesto.riferisci({ tipo: "avvio-con-windows-esito", idRichiesta, ...esito }),
          (errore: unknown) => this.#contesto.riferisci({ tipo: "avvio-con-windows-esito", idRichiesta, motivo: errore instanceof Error ? errore.message : String(errore) }),
        );
        return;
      }
      case "risorse": {
        const { idRichiesta } = comando;
        void this.#contesto.risorse?.leggi().then(
          (risorse) => this.#contesto.riferisci({ tipo: "risorse-esito", idRichiesta, risorse }),
          () => {},
        );
        return;
      }
      case "imposta":
        this.#conversazioni.get(comando.idConversazione)?.imposta(comando.impostazioni);
        return;
      case "messaggio":
        this.#conversazioni.get(comando.idConversazione)?.invia(comando.testo, comando.allegati);
        return;
      case "annota":
        this.#conversazioni.get(comando.idConversazione)?.annota(comando.testo);
        return;
      case "esito-strumento": {
        const inAttesa = this.#strumenti.get(comando.idRichiesta);
        if (inAttesa === undefined) return;
        this.#strumenti.delete(comando.idRichiesta);
        clearTimeout(inAttesa.scadenza);
        inAttesa.risolvi({
          testo: comando.testo,
          ...(comando.errore === true ? { errore: true } : {}),
          ...(comando.immagine === undefined ? {} : { immagine: comando.immagine }),
        });
        return;
      }
      case "skill":
        this.#aggiornaSkill(comando.skill);
        return;
      case "estensioni":
        void this.#estensioni?.imposta(comando.estensioni);
        return;
      case "prova-estensione": {
        const { idRichiesta, estensione } = comando;
        const prova =
          this.#estensioni === undefined
            ? Promise.resolve({ riuscita: false as const, motivo: "Questo nodo non sa tenere le estensioni." })
            : this.#estensioni.prova(estensione);
        void prova.then((esito) => this.#contesto.riferisci({ tipo: "estensione-provata", idRichiesta, esito }));
        return;
      }
      case "guarda-estensioni": {
        const { idRichiesta } = comando;
        if (this.#estensioni === undefined) {
          this.#contesto.riferisci({ tipo: "estensioni-guardate", idRichiesta, motivo: "Questo nodo non sa guardare le estensioni." });
          return;
        }
        void this.#estensioni.guarda().then(
          (viste) => this.#contesto.riferisci({ tipo: "estensioni-guardate", idRichiesta, viste }),
          (errore: unknown) =>
            this.#contesto.riferisci({
              tipo: "estensioni-guardate",
              idRichiesta,
              motivo: errore instanceof Error ? errore.message : String(errore),
            }),
        );
        return;
      }
      case "chiavi-consegnate": {
        const inAttesa = this.#chiavi.get(comando.idRichiesta);
        if (inAttesa === undefined) return;
        this.#chiavi.delete(comando.idRichiesta);
        clearTimeout(inAttesa.scadenza);
        inAttesa.risolvi(comando.chiavi);
        return;
      }
      case "aggiorna":
        if (this.#contesto.aggiorna === undefined) {
          this.#contesto.riferisci({
            tipo: "aggiornamento-non-riuscito",
            idRichiesta: comando.idRichiesta,
            motivo: "Questo nodo non sa aggiornarsi da solo: va aggiornato su quella macchina.",
          });
          return;
        }
        this.#contesto.aggiorna(comando);
        return;
      case "decidi-permesso":
        this.#conversazioni
          .get(comando.idConversazione)
          ?.decidiPermesso(comando.idPermesso, comando.decisione);
        return;
      case "riavvolgi": {
        const { idRichiesta, idMessaggio } = comando;
        const conversazione = this.#conversazioni.get(comando.idConversazione);
        const fatto: Promise<Extract<RiferitoDalNodo, { tipo: "riavvolgimento-esito" }>> =
          conversazione?.anteprimaRiavvolgimento === undefined || conversazione.riprendiDa === undefined
            ? Promise.resolve({ tipo: "riavvolgimento-esito", idRichiesta, motivo: "Questa conversazione non sa ripartire da un messaggio." })
            : comando.prova
              ? conversazione.anteprimaRiavvolgimento(idMessaggio).then((anteprima) => ({ tipo: "riavvolgimento-esito" as const, idRichiesta, anteprima }))
              : conversazione
                  .riprendiDa(idMessaggio, { file: comando.file })
                  .then((motivo) => ({ tipo: "riavvolgimento-esito" as const, idRichiesta, ...(motivo === undefined ? {} : { motivo }) }));
        void fatto.then((esito) => this.#contesto.riferisci(esito));
        return;
      }
      case "alla-conversazione": {
        const { idRichiesta, richiesta } = comando;
        const conversazione = this.#conversazioni.get(comando.idConversazione);
        const nonSa = { motivo: "Questa conversazione non tiene le modifiche dei turni." };
        const fatto: Promise<unknown> =
          richiesta.tipo === "versioni"
            ? (conversazione?.versioniModificate?.(richiesta.idTurno, richiesta.percorso) ?? Promise.resolve(nonSa))
            : richiesta.tipo === "annulla-modifiche"
              ? (conversazione?.annullaModifiche?.(richiesta.idTurno, richiesta.percorsi) ?? Promise.resolve(nonSa))
              : (conversazione?.uscitaAttivita?.(richiesta.idAttivita) ?? Promise.resolve({ motivo: "Questa conversazione non tiene le attività." }));
        void fatto
          .catch((errore: unknown) => ({ motivo: errore instanceof Error ? errore.message : String(errore) }))
          .then((risposta) => this.#contesto.riferisci({ tipo: "risposta-della-conversazione", idRichiesta, risposta }));
        return;
      }
      case "a-parte": {
        const { idRichiesta, domanda } = comando;
        const conversazione = this.#conversazioni.get(comando.idConversazione);
        const fatto: Promise<RispostaAParte> =
          conversazione?.chiediAParte === undefined
            ? Promise.resolve({ motivo: "Questa conversazione non sa rispondere a una domanda a parte." })
            : conversazione.chiediAParte(domanda);
        void fatto.then((risposta) => this.#contesto.riferisci({ tipo: "a-parte-esito", idRichiesta, risposta }));
        return;
      }
      case "rispondi-domande":
        this.#conversazioni.get(comando.idConversazione)?.rispondiDomande?.(comando.idDomande, comando.risposta);
        return;
      case "interrompi":
        void this.#conversazioni.get(comando.idConversazione)?.interrompi();
        return;
      case "chiudi-conversazione":
        this.#conversazioni.get(comando.idConversazione)?.chiudi();
        this.#conversazioni.delete(comando.idConversazione);
        return;
      case "azione":
        void eseguiAzione(this.#contesto.radiceProgetti, comando.idArgomento, comando.azione).then((esito) =>
          this.#contesto.riferisci({ tipo: "azione-conclusa", idRichiesta: comando.idRichiesta, esito }),
        );
        return;
      case "azione-in-cartella":
        void eseguiAzioneInCartella(comando.cartella, comando.azione).then((esito) =>
          this.#contesto.riferisci({ tipo: "azione-conclusa", idRichiesta: comando.idRichiesta, esito }),
        );
        return;
      case "terminale-apri":
      case "terminale-scrivi":
      case "terminale-misura":
      case "terminale-chiudi":
        this.#terminali.esegui(comando);
        return;
      case "anteprima-richiesta":
      case "anteprima-annulla":
      case "anteprima-ws-apri":
      case "anteprima-ws-manda":
      case "anteprima-ws-chiudi":
        this.#anteprima.esegui(comando);
        return;
      case "file-elenca":
      case "file-cerca":
      case "file-leggi":
      case "file-scarica":
      case "file-scarica-avanti":
      case "file-scarica-annulla":
        this.#file.esegui(comando);
        return;
      case "applicazione-avvia":
      case "applicazione-ferma":
      case "applicazione-stato":
        this.#applicazioni.esegui(comando);
        return;
    }
  }

  /** Il nodo si ferma: con lui si fermano le conversazioni e si spengono i terminali. */
  spegni(): void {
    this.chiudiTutto();
    this.#terminali.spegniTutti();
    this.#applicazioni.spegniTutte();
    // I server dei modelli locali accesi da Shinka non devono restare a occupare la scheda video.
    this.#estensioni?.modelliLocali.chiudi();
  }

  /**
   * Il collegamento con il centro è caduto: senza centro nessuno vedrebbe il lavoro, quindi si ferma.
   * I terminali no: restano accesi, e il proprietario li ritrova quando il centro torna.
   */
  chiudiTutto(): void {
    this.#anteprima.chiudiTutto();
    this.#file.annullaTutti();
    for (const conversazione of this.#conversazioni.values()) conversazione.chiudi();
    this.#conversazioni.clear();
    for (const inAttesa of this.#strumenti.values()) {
      clearTimeout(inAttesa.scadenza);
      inAttesa.risolvi({ testo: "Il collegamento con il centro è caduto: riprova più tardi.", errore: true });
    }
    this.#strumenti.clear();
    for (const inAttesa of this.#chiavi.values()) {
      clearTimeout(inAttesa.scadenza);
      inAttesa.risolvi({ motivo: "il collegamento con il centro è caduto" });
    }
    this.#chiavi.clear();
  }

  /** Come una conversazione di questo ambiente usa uno strumento di Shinka: lo chiede al centro e aspetta. */
  #chiama(idConversazione: string): ChiamaStrumento {
    return (nome, argomenti) =>
      new Promise((risolvi) => {
        const idRichiesta = randomUUID();
        const scadenza = setTimeout(() => {
          this.#strumenti.delete(idRichiesta);
          risolvi({ testo: "Il centro non ha risposto in tempo: riprova più tardi.", errore: true });
        }, attesaDelloStrumento(nome, argomenti, this.#contesto.attesaStrumentoMs));
        this.#strumenti.set(idRichiesta, { risolvi, scadenza });
        this.#contesto.riferisci({ tipo: "strumento", idRichiesta, idConversazione, nome, argomenti });
      });
  }

  /** Il centro ha mandato le skill come sono adesso: la copia locale diventa uguale. */
  #aggiornaSkill(skill: SkillDistribuita[]): void {
    const cartella = this.#contesto.cartellaSkill;
    if (cartella === undefined) return;
    this.#scritturaSkill = this.#scritturaSkill
      .then(() => scriviSkill(cartella, skill))
      .then(() => {
        for (const conversazione of this.#conversazioni.values()) conversazione.ricaricaSkill?.();
      })
      // Se la scrittura non riesce restano le skill di prima: arriveranno al prossimo cambiamento.
      .catch(() => {});
  }

  async #creaCartella(
    idRichiesta: string,
    nomeCartella: string,
    brief: string,
    daArgomento: string | undefined,
  ): Promise<void> {
    try {
      const radice = this.#contesto.radiceProgetti;
      const daCartella = daArgomento === undefined ? undefined : join(resolve(radice), CARTELLA_HOME, daArgomento);
      const { percorso, filePortati } = await creaCartellaProgetto(radice, nomeCartella, brief, daCartella);
      this.#contesto.riferisci({
        tipo: "cartella-creata",
        idRichiesta,
        percorso,
        ...(daArgomento === undefined ? {} : { filePortati }),
      });
    } catch (errore) {
      const motivo =
        errore instanceof CartellaNonCreata
          ? errore.message
          : `Non sono riuscito a creare la cartella: ${errore instanceof Error ? errore.message : String(errore)}`;
      this.#contesto.riferisci({ tipo: "cartella-non-creata", idRichiesta, motivo });
    }
  }

  async #adottaCartella(idRichiesta: string, percorso: string): Promise<void> {
    try {
      const adottata = await adottaCartella(percorso);
      this.#contesto.riferisci({ tipo: "cartella-creata", idRichiesta, percorso: adottata.percorso, git: adottata.git });
    } catch (errore) {
      const motivo =
        errore instanceof CartellaNonCreata
          ? errore.message
          : `Non sono riuscito a guardare la cartella: ${errore instanceof Error ? errore.message : String(errore)}`;
      this.#contesto.riferisci({ tipo: "cartella-non-creata", idRichiesta, motivo });
    }
  }

  #apri(
    idConversazione: string,
    cartella: string,
    idSessione: string | undefined,
    impostazioni: ImpostazioniConversazione,
    /** Le estensioni scelte per il progetto; senza, tutte quelle accese qui. */
    scelte?: readonly string[],
    motorePredefinito?: Motore,
  ): void {
    const esistente = this.#conversazioni.get(idConversazione);
    if (esistente !== undefined) {
      // Già aperta: valgono comunque le impostazioni più recenti del centro.
      esistente.imposta(impostazioni);
      return;
    }
    const configurazione = configurazioneDiProgetto(
      cartella,
      idSessione,
      impostazioni,
      (evento) => this.#contesto.riferisci({ tipo: "evento", idConversazione, evento }),
      (id) => this.#contesto.riferisci({ tipo: "id-sessione", idConversazione, idSessione: id }),
      {
        chiama: this.#chiama(idConversazione),
        ...(this.#contesto.cartellaSkill === undefined ? {} : { cartellaSkill: this.#contesto.cartellaSkill }),
        ...(this.#estensioni === undefined
          ? {}
          : { estensioni: scelte === undefined ? this.#estensioni : soloLeScelte(this.#estensioni, () => scelte) }),
        ...(this.#contesto.browserDelPc === true ? { browserDelPc: true } : {}),
        ...(eIncarico(idConversazione) ? { incarico: true } : {}),
        ...(this.#estensioni === undefined ? {} : { modelliLocali: this.#estensioni.modelliLocali }),
        ...(this.#contesto.cartellaModifiche === undefined ? {} : { cartellaModifiche: join(this.#contesto.cartellaModifiche, nomeDiCartella(idConversazione)) }),
      },
    );
    const apri =
      this.#contesto.apriConversazione ??
      ((cfg: ConfigurazioneConversazione, predefinito?: Motore): PortaConversazione =>
        apriConversazione(cfg, predefinito === undefined ? {} : { predefinito }));
    this.#conversazioni.set(idConversazione, apri(configurazione, motorePredefinito));
  }
}
