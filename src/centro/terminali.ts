/**
 * I terminali dei progetti visti dal centro: per ogni progetto, chi lo sta guardando da un
 * browser e la strada verso l'ambiente in cui il terminale vive.
 *
 * Il centro non tiene nulla del terminale: sta nell'ambiente del progetto, e chi lo apre riceve
 * da lì l'uscita recente. Così un terminale sopravvive alla pagina chiusa e al centro riavviato.
 */

import type {
  ComandoTerminale,
  DalBrowserAlTerminale,
  DalTerminaleAlBrowser,
  PortaTerminali,
  RiferitoTerminale,
} from "../protocollo/terminale.ts";
import { progettoDelTerminale, SCHEDE_MASSIME, terminaleDellaScheda } from "../protocollo/terminale.ts";
import { ID_AMBIENTE_DEL_CENTRO, type RegistroAmbienti } from "./ambienti.ts";
import type { RegistroProgetti } from "./progetti.ts";

export interface OpzioniTerminali {
  progetti: Pick<RegistroProgetti, "trova">;
  ambienti: RegistroAmbienti;
  /** Chi tiene i terminali dell'ambiente del centro: riceve dove riferire ciò che ne esce. */
  locale(riferisci: (messaggio: RiferitoTerminale) => void): PortaTerminali;
}

/** Un browser collegato al terminale di un progetto. */
export interface CollegamentoTerminale {
  ricevi(messaggio: DalBrowserAlTerminale): void;
  scollega(): void;
}

interface Spettatore {
  manda(messaggio: DalTerminaleAlBrowser): void;
  /** Ha chiesto di aprire il terminale e aspetta che l'ambiente risponda. */
  inAttesa: boolean;
  /** Ha ricevuto l'uscita recente: da qui in poi gli arriva quella nuova. */
  pronto: boolean;
}

export class TerminaliDeiProgetti {
  readonly #o: OpzioniTerminali;
  readonly #locale: PortaTerminali;
  readonly #spettatori = new Map<string, Set<Spettatore>>();

  constructor(opzioni: OpzioniTerminali) {
    this.#o = opzioni;
    this.#locale = opzioni.locale((messaggio) => this.#riferito(ID_AMBIENTE_DEL_CENTRO, messaggio));
    opzioni.ambienti.iscriviRiferiti((idNodo, messaggio) => {
      if (
        messaggio.tipo === "terminale-aperto" ||
        messaggio.tipo === "terminale-uscita" ||
        messaggio.tipo === "terminale-chiuso"
      ) {
        this.#riferito(idNodo, messaggio);
      }
    });
    opzioni.ambienti.iscriviScollegamenti((idNodo) => this.#scollegato(idNodo));
  }

  /** Un browser si collega al terminale di un progetto. Nulla se il progetto non esiste. */
  /** Spegne il terminale di un progetto, per esempio quando il progetto viene eliminato. */
  spegni(progetto: { id: string; idAmbiente: string }): void {
    for (let scheda = 1; scheda <= SCHEDE_MASSIME; scheda++) {
      const idTerminale = terminaleDellaScheda(progetto.id, scheda);
      const comando: ComandoTerminale = { tipo: "terminale-chiudi", idTerminale };
      if (progetto.idAmbiente === ID_AMBIENTE_DEL_CENTRO) this.#locale.esegui(comando);
      else this.#o.ambienti.inviaAlNodo(progetto.idAmbiente, comando);
      for (const spettatore of this.#spettatori.get(idTerminale) ?? []) spettatore.manda({ tipo: "chiuso", motivo: "Questo progetto è stato eliminato." });
    }
  }

  /** Un browser si collega al terminale di una scheda di un progetto; la prima se non si dice. */
  collega(idProgetto: string, manda: (messaggio: DalTerminaleAlBrowser) => void, scheda = 1): CollegamentoTerminale | undefined {
    if (this.#o.progetti.trova(idProgetto) === undefined || !Number.isInteger(scheda) || scheda < 1 || scheda > SCHEDE_MASSIME) return undefined;
    const idTerminale = terminaleDellaScheda(idProgetto, scheda);
    const spettatore: Spettatore = { manda, inAttesa: false, pronto: false };
    const insieme = this.#spettatori.get(idTerminale) ?? new Set<Spettatore>();
    insieme.add(spettatore);
    this.#spettatori.set(idTerminale, insieme);
    return {
      ricevi: (messaggio) => this.#dalBrowser(idTerminale, spettatore, messaggio),
      scollega: () => {
        insieme.delete(spettatore);
        if (insieme.size === 0 && this.#spettatori.get(idTerminale) === insieme) this.#spettatori.delete(idTerminale);
      },
    };
  }

  #dalBrowser(idTerminale: string, spettatore: Spettatore, messaggio: DalBrowserAlTerminale): void {
    const progetto = this.#o.progetti.trova(progettoDelTerminale(idTerminale));
    if (progetto === undefined) {
      spettatore.manda({ tipo: "chiuso", motivo: "Questo progetto non esiste più." });
      return;
    }
    const invia = (comando: ComandoTerminale): boolean =>
      progetto.idAmbiente === ID_AMBIENTE_DEL_CENTRO
        ? (this.#locale.esegui(comando), true)
        : this.#o.ambienti.inviaAlNodo(progetto.idAmbiente, comando);
    switch (messaggio.tipo) {
      case "apri": {
        spettatore.pronto = false;
        spettatore.inAttesa = true;
        const inviato = invia({
          tipo: "terminale-apri",
          idTerminale,
          cartella: progetto.cartella,
          colonne: messaggio.colonne,
          righe: messaggio.righe,
        });
        if (!inviato) {
          spettatore.inAttesa = false;
          spettatore.manda({
            tipo: "chiuso",
            motivo: "L'ambiente del progetto è spento. Se il terminale era acceso lo ritrovi quando l'ambiente torna attivo.",
          });
        }
        return;
      }
      case "scrivi":
        if (spettatore.pronto) invia({ tipo: "terminale-scrivi", idTerminale, dati: messaggio.dati });
        return;
      case "misura":
        if (spettatore.pronto) {
          invia({ tipo: "terminale-misura", idTerminale, colonne: messaggio.colonne, righe: messaggio.righe });
        }
        return;
      case "chiudi":
        invia({ tipo: "terminale-chiudi", idTerminale });
        return;
    }
  }

  #riferito(idAmbiente: string, messaggio: RiferitoTerminale): void {
    // Un ambiente riferisce solo dei terminali dei propri progetti.
    if (this.#o.progetti.trova(progettoDelTerminale(messaggio.idTerminale))?.idAmbiente !== idAmbiente) return;
    const insieme = this.#spettatori.get(messaggio.idTerminale);
    if (insieme === undefined) return;
    for (const spettatore of insieme) {
      switch (messaggio.tipo) {
        case "terminale-aperto":
          // L'uscita recente serve solo a chi sta aprendo: gli altri l'hanno già vista arrivare.
          if (!spettatore.inAttesa) break;
          spettatore.inAttesa = false;
          spettatore.pronto = true;
          spettatore.manda({ tipo: "aperto", finora: messaggio.finora });
          break;
        case "terminale-uscita":
          if (spettatore.pronto) spettatore.manda({ tipo: "uscita", dati: messaggio.dati });
          break;
        case "terminale-chiuso":
          if (!spettatore.pronto && !spettatore.inAttesa) break;
          spettatore.pronto = false;
          spettatore.inAttesa = false;
          spettatore.manda({ tipo: "chiuso", motivo: messaggio.motivo });
          break;
      }
    }
  }

  /** L'ambiente si è scollegato: il terminale resta acceso lì, ma da qui non si vede più. */
  #scollegato(idAmbiente: string): void {
    for (const [idTerminale, insieme] of this.#spettatori) {
      if (this.#o.progetti.trova(progettoDelTerminale(idTerminale))?.idAmbiente !== idAmbiente) continue;
      for (const spettatore of insieme) {
        if (!spettatore.pronto && !spettatore.inAttesa) continue;
        spettatore.pronto = false;
        spettatore.inAttesa = false;
        spettatore.manda({
          tipo: "chiuso",
          motivo: "L'ambiente si è scollegato. Il terminale è ancora acceso lì: lo ritrovi quando l'ambiente torna attivo.",
        });
      }
    }
  }
}
