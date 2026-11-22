/**
 * L'aggiornamento dei nodi alla versione del centro.
 *
 * Un nodo tenuto acceso dal suo guardiano sa cambiare versione da solo: il centro gli passa i file
 * della versione che ha in funzione, il nodo li prepara e riparte con quelli, e se la versione
 * nuova non si collega torna quella di prima. Succede in due casi: dopo un'installazione approvata
 * dal proprietario, per i nodi che erano collegati in quel momento, e quando il proprietario lo
 * chiede dalla pagina degli ambienti per un nodo rimasto indietro.
 */

import { randomUUID } from "node:crypto";
import type { RiferitoDalNodo } from "../protocollo/nodi.ts";
import { inBreve, type FileDiVersione } from "../protocollo/versione.ts";
import { ID_AMBIENTE_DEL_CENTRO, type RegistroAmbienti } from "./ambienti.ts";
import { pacchettoDellaVersione } from "./pacchetto.ts";

/** Quanto si aspetta che un nodo torni con la versione nuova: deve anche scaricare le dipendenze. */
const ATTESA_MS = 25 * 60 * 1000;

/** Per quanto, dopo un'installazione, un nodo che era collegato può ancora ricollegarsi ed essere aggiornato. */
const FINESTRA_MS = 10 * 60 * 1000;

export interface OpzioniAggiornamentoNodi {
  ambienti: RegistroAmbienti;
  /** La cartella della versione in funzione al centro: da lì si prendono i file per i nodi. */
  installata: string;
  /** La versione in funzione al centro; se non è scritta, non c'è nulla da passare ai nodi. */
  versione: string | undefined;
  /** Vero se in quell'ambiente una conversazione sta lavorando o aspetta il proprietario. */
  occupato?(idAmbiente: string): boolean;
  /** Come si leggono i file della versione. Nei test se ne mette uno finto. */
  pacchetto?: (installata: string) => Promise<FileDiVersione[]>;
  attesaMs?: number;
  finestraMs?: number;
}

export type EsitoRichiestaDiAggiornamento = { avviato: true } | { avviato: false; motivo: string };

export class AggiornamentoDeiNodi {
  readonly #o: OpzioniAggiornamentoNodi;
  /** I file della versione in funzione: si leggono una volta, e valgono finché il centro è acceso. */
  #pacchetto: Promise<FileDiVersione[]> | undefined;
  readonly #inCorso = new Map<string, { idRichiesta: string; sveglia: NodeJS.Timeout }>();
  /** I nodi che dopo un'installazione vanno aggiornati appena si ricollegano. */
  readonly #daPropagare = new Set<string>();
  #finestra: NodeJS.Timeout | undefined;
  readonly #disiscrivi: (() => void)[];

  constructor(opzioni: OpzioniAggiornamentoNodi) {
    this.#o = opzioni;
    this.#disiscrivi = [
      opzioni.ambienti.iscriviRiferiti((idNodo, messaggio) => this.#riferito(idNodo, messaggio)),
      opzioni.ambienti.iscriviCollegamenti((idNodo) => this.#collegato(idNodo)),
    ];
  }

  /** I nodi collegati che sanno aggiornarsi: dopo un'installazione passano anche loro alla versione nuova. */
  daAggiornare(): { id: string; nome: string }[] {
    return this.#o.ambienti
      .stato()
      .ambienti.filter((ambiente) => !ambiente.delCentro && ambiente.attivo && ambiente.siAggiorna === true)
      .map((ambiente) => ({ id: ambiente.id, nome: ambiente.nome }));
  }

  /** Chiede a un nodo di passare alla versione del centro. Dice subito se la richiesta è partita. */
  async aggiorna(idAmbiente: string): Promise<EsitoRichiestaDiAggiornamento> {
    const { ambienti, versione } = this.#o;
    const no = (motivo: string): EsitoRichiestaDiAggiornamento => ({ avviato: false, motivo });
    if (idAmbiente === ID_AMBIENTE_DEL_CENTRO) return no("L'ambiente del centro cambia versione insieme al centro.");
    const nodo = ambienti.nodo(idAmbiente);
    if (nodo === undefined) return no("L'ambiente è spento: si aggiorna quando il suo nodo è collegato.");
    if (versione === undefined) return no("Non è scritto quale versione sia in funzione al centro: non c'è una versione da passare al nodo.");
    if (nodo.versione === versione) return no("Il nodo è già alla versione del centro.");
    if (!nodo.siAggiorna) return no("Questo nodo non è tenuto acceso dal suo guardiano: va aggiornato su quella macchina.");
    if (this.#inCorso.has(idAmbiente)) return no("L'aggiornamento di questo nodo è già in corso.");
    if (this.#o.occupato?.(idAmbiente) === true) {
      return no("In quell'ambiente una conversazione sta lavorando o aspetta una tua risposta: l'aggiornamento la chiuderebbe. Aspetta che finisca, oppure interrompila.");
    }
    // Segnato subito: mentre si leggono i file una seconda richiesta non deve partire.
    const idRichiesta = randomUUID();
    const sveglia = setTimeout(
      () => this.#concludi(idAmbiente, idRichiesta, `Il nodo non è tornato con la versione nuova entro ${Math.round((this.#o.attesaMs ?? ATTESA_MS) / 60_000)} minuti.`),
      this.#o.attesaMs ?? ATTESA_MS,
    );
    sveglia.unref();
    this.#inCorso.set(idAmbiente, { idRichiesta, sveglia });

    let file: FileDiVersione[];
    try {
      this.#pacchetto ??= (this.#o.pacchetto ?? pacchettoDellaVersione)(this.#o.installata);
      file = await this.#pacchetto;
    } catch (errore) {
      this.#pacchetto = undefined;
      this.#dimentica(idAmbiente);
      return no(`I file della versione ${inBreve(versione)} non si sono potuti leggere: ${errore instanceof Error ? errore.message : String(errore)}`);
    }
    if (!ambienti.inviaAlNodo(idAmbiente, { tipo: "aggiorna", idRichiesta, versione, file })) {
      this.#dimentica(idAmbiente);
      return no("L'ambiente si è spento prima che la richiesta partisse.");
    }
    ambienti.segnaAggiornamento(idAmbiente, { stato: "in-corso", versione });
    return { avviato: true };
  }

  /**
   * Dopo un'installazione approvata: i nodi che erano collegati quando il proprietario ha approvato
   * passano alla versione nuova, adesso se sono già tornati, altrimenti appena si ricollegano.
   */
  propaga(idNodi: string[]): void {
    for (const idNodo of idNodi) this.#daPropagare.add(idNodo);
    clearTimeout(this.#finestra);
    this.#finestra = setTimeout(() => this.#daPropagare.clear(), this.#o.finestraMs ?? FINESTRA_MS);
    this.#finestra.unref();
    for (const idNodo of idNodi) {
      if (this.#o.ambienti.nodo(idNodo) !== undefined) void this.#propagaA(idNodo);
    }
  }

  chiudi(): void {
    for (const disiscrivi of this.#disiscrivi) disiscrivi();
    clearTimeout(this.#finestra);
    for (const { sveglia } of this.#inCorso.values()) clearTimeout(sveglia);
    this.#inCorso.clear();
    this.#daPropagare.clear();
  }

  async #propagaA(idNodo: string): Promise<void> {
    if (!this.#daPropagare.delete(idNodo)) return;
    const { ambienti, versione } = this.#o;
    const nodo = ambienti.nodo(idNodo);
    // Un nodo che non sa aggiornarsi, o che è già alla versione nuova, non ha nulla da fare: lo dice la pagina degli ambienti.
    if (nodo === undefined || versione === undefined || !nodo.siAggiorna || nodo.versione === versione) return;
    const esito = await this.aggiorna(idNodo);
    if (!esito.avviato) ambienti.segnaAggiornamento(idNodo, { stato: "non-riuscito", versione, motivo: esito.motivo });
  }

  #riferito(idNodo: string, messaggio: RiferitoDalNodo): void {
    if (messaggio.tipo !== "aggiornamento-non-riuscito") return;
    this.#concludi(idNodo, messaggio.idRichiesta, messaggio.motivo);
  }

  /** Il nodo si è presentato di nuovo: com'è finita lo ha già scritto il registro, dalla versione che dichiara. */
  #collegato(idNodo: string): void {
    this.#dimentica(idNodo);
    if (this.#daPropagare.has(idNodo)) void this.#propagaA(idNodo);
  }

  #concludi(idNodo: string, idRichiesta: string, motivo: string): void {
    const inCorso = this.#inCorso.get(idNodo);
    if (inCorso?.idRichiesta !== idRichiesta) return;
    this.#dimentica(idNodo);
    const { versione } = this.#o;
    if (versione !== undefined) this.#o.ambienti.segnaAggiornamento(idNodo, { stato: "non-riuscito", versione, motivo });
  }

  #dimentica(idNodo: string): void {
    const inCorso = this.#inCorso.get(idNodo);
    if (inCorso === undefined) return;
    clearTimeout(inCorso.sveglia);
    this.#inCorso.delete(idNodo);
  }
}
