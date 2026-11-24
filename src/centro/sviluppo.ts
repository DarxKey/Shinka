/**
 * Lo sviluppo di Shinka da dentro Shinka.
 *
 * Il progetto Shinka è un progetto come gli altri, ma la sua cartella è una copia di lavoro del
 * repository di Shinka stessa. Un pezzo nuovo lo propone il proprietario o la Home, con una scheda:
 * confermata, la richiesta passa al progetto. Quando il lavoro è registrato nel repository, il
 * progetto chiede di installarlo: il centro prepara la versione su una copia pulita, la prova, e
 * solo se le prove passano mostra al proprietario la scheda con ciò che cambia. Approvata, il
 * centro si spegne e il guardiano la mette in funzione; se non parte, torna quella di prima.
 */

import type { ProposteRicordate } from "./proposte-ricordate.ts";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { leggiInstallazione, scriviInstallazione, type Installazione } from "../guardiano/guardiano.ts";
import type { EsitoApprovazione } from "../protocollo/eventi.ts";
import { NOME_PROGETTO_SHINKA, nomeCartellaDa, type Progetto } from "../protocollo/progetti.ts";
import type { EsitoStrumento } from "../protocollo/strumenti.ts";
import { ID_AMBIENTE_DEL_CENTRO } from "./ambienti.ts";
import type { Canale } from "./canale.ts";
import type { LavoriDeiProgetti } from "./lavori.ts";
import { applicaModifica, type ModelloDisponibile, type ModificaImpostazioni } from "../protocollo/impostazioni.ts";
import { git, inBreve, preparaVersione, type EsitoPreparazione, type OpzioniPreparazione } from "./preparazione.ts";

/** Il brief del progetto Shinka: ciò che il proprietario legge aprendolo. */
export const BRIEF_DEL_PROGETTO_SHINKA =
  "Lo sviluppo di Shinka stessa. La cartella di questo progetto è il codice di Shinka: qui si scrive un pezzo nuovo, " +
  "lo si prova e si chiede di installarlo. Una versione entra in funzione solo dopo che le prove sono passate e il proprietario l'ha approvata.";

/** Quanto si aspetta, dopo l'approvazione, prima di spegnere il centro: il tempo che la scheda cambi sotto gli occhi del proprietario. */
const ATTESA_RIAVVIO_MS = 1_500;

/** Per quanto, all'avvio, si aspetta che il guardiano dica com'è finita l'installazione. */
const ATTESA_ESITO_MS = 4 * 60 * 1000;

export interface OpzioniSviluppo {
  /** Il repository di Shinka: la cartella del progetto ne è una copia di lavoro. */
  repository: string;
  /** Dove nascono i progetti dell'ambiente del centro. */
  radiceProgetti: string;
  /** La cartella della versione in funzione. */
  installata: string;
  /** Il file in cui centro e guardiano si dicono a che punto è un'installazione. */
  fileInstallazione: string;
  /** Vero se il centro è tenuto acceso dal guardiano: solo allora può installare una versione. */
  guardiano: boolean;
  lavori: LavoriDeiProgetti;
  /** L'archivio dell'argomento aperto nella Home, chiesto nel momento in cui serve. */
  canaleHome(): Canale;
  /** Aggiunge un'informazione al contesto della Home, senza farla rispondere. */
  annotaHome(testo: string, canale?: Canale): void;
  /** Spegne il centro perché il guardiano lo riaccenda con la versione nuova. */
  riavvia(): void;
  /** Dove le proposte in attesa restano scritte, perché un riavvio del centro non le perda. */
  ricordate?: ProposteRicordate;
  /** I nodi collegati che sanno aggiornarsi: dopo l'installazione passano anche loro alla versione nuova. */
  nodi?(): { id: string; nome: string }[];
  /** Dopo un'installazione riuscita: fa passare alla versione nuova i nodi che erano collegati all'approvazione. */
  propaga?(idNodi: string[]): void;
  /**
   * Il gateway: che cosa dire al proprietario se la versione preparata ne cambia la parte, e come
   * proporgliela. Il centro la propone soltanto: il sì lo chiede il gateway al proprietario.
   */
  gateway?: {
    avviso(nuova: string): Promise<string | undefined>;
    proponi(riassunto: string): Promise<EsitoStrumento & { esito?: "uguale" | "chiesto" | "non-accolto" }>;
  };
  /** Come si prepara una versione. Nei test se ne mette una finta. */
  prepara?: (opzioni: OpzioniPreparazione) => Promise<EsitoPreparazione>;
  attesaRiavvioMs?: number;
  attesaEsitoMs?: number;
  adesso?: () => number;
}

interface ProposteInAttesa {
  titolo: string;
  richiesta: string;
  /** L'archivio dell'argomento in cui la proposta è stata fatta: lì va anche la decisione. */
  canale: Canale;
}

interface InstallazioneInAttesa {
  id: string;
  versione: string;
  riassunto: string;
  nuova: string;
  canale: Canale;
}

function riuscito(testo: string): EsitoStrumento {
  return { testo };
}

function fallito(testo: string): EsitoStrumento {
  return { testo, errore: true };
}

export class SviluppoDiShinka {
  readonly #o: OpzioniSviluppo;
  readonly #progetto: Progetto;
  readonly #proposte = new Map<string, ProposteInAttesa>();
  #attesa: InstallazioneInAttesa | undefined;
  #inPreparazione = false;
  /** Ciò che il progetto deve sapere prima del prossimo messaggio: com'è finita una richiesta di installazione. */
  #nota: string | undefined;
  #chiuso = false;

  private constructor(opzioni: OpzioniSviluppo, progetto: Progetto) {
    this.#o = opzioni;
    this.#progetto = progetto;
  }

  /**
   * Trova il progetto Shinka, o lo fa nascere dal repository. Nulla, con il motivo scritto nel
   * registro, se il repository non c'è o non si riesce a copiarlo: Shinka funziona lo stesso.
   */
  static async apri(opzioni: OpzioniSviluppo): Promise<SviluppoDiShinka | undefined> {
    const { lavori, repository, radiceProgetti } = opzioni;
    const esistente = lavori.stato().progetti.find((progetto) => progetto.diShinka === true);
    if (esistente !== undefined) return new SviluppoDiShinka(opzioni, esistente);

    const cartella = join(radiceProgetti, nomeCartellaDa(NOME_PROGETTO_SHINKA));
    if (!existsSync(cartella)) {
      await mkdir(radiceProgetti, { recursive: true });
      const copia = await git(radiceProgetti, ["clone", "--quiet", repository, cartella]);
      if (copia.codice !== 0) {
        console.error(`Sviluppo di Shinka non disponibile: il repository ${repository} non si è potuto copiare.\n${copia.uscita}`);
        return undefined;
      }
    } else if ((await git(cartella, ["rev-parse", "--git-dir"])).codice !== 0) {
      console.error(`Sviluppo di Shinka non disponibile: ${cartella} esiste già e non è una copia del repository.`);
      return undefined;
    }
    // Chi lavora nel progetto registra le sue modifiche: serve un nome, se l'ambiente non ne ha uno.
    if ((await git(cartella, ["config", "user.email"])).uscita === "") {
      await git(cartella, ["config", "user.name", "Shinka"]);
      await git(cartella, ["config", "user.email", "shinka@localhost"]);
    }
    const progetto = await lavori.adotta({
      nome: NOME_PROGETTO_SHINKA,
      cartella,
      idAmbiente: ID_AMBIENTE_DEL_CENTRO,
      brief: BRIEF_DEL_PROGETTO_SHINKA,
      diShinka: true,
    });
    return new SviluppoDiShinka(opzioni, progetto);
  }

  get idProgetto(): string {
    return this.#progetto.id;
  }

  /** Vero se questa installazione di Shinka può mettere in funzione una versione da sola. */
  get puoInstallare(): boolean {
    return this.#o.guardiano;
  }

  #adesso(): number {
    return this.#o.adesso?.() ?? Date.now();
  }

  /** La Home propone di sviluppare un pezzo nuovo: compare la scheda, e nient'altro. */
  /** Dopo un riavvio del centro: tornano le proposte che aspettavano il proprietario. */
  async ripristina(): Promise<void> {
    for (const { id, dati, canale } of (await this.#o.ricordate?.ripristina<{ titolo: string; richiesta: string }>("sviluppo")) ?? []) {
      this.#proposte.set(id, { titolo: dati.titolo, richiesta: dati.richiesta, canale });
    }
  }

  proponi(proposta: { titolo: string; richiesta: string }, canale: Canale = this.#o.canaleHome()): string {
    const idProposta = randomUUID();
    this.#proposte.set(idProposta, { ...proposta, canale });
    this.#o.ricordate?.ricorda("sviluppo", idProposta, proposta, canale);
    // La scheda dice con che cosa lavorerebbe il progetto Shinka, e tra quali modelli si può scegliere.
    const modelli = modelliDa(this.#o.lavori.canale(this.#progetto.id)) ?? modelliDa(canale);
    canale.pubblica({
      tipo: "sviluppo-proposto",
      idProposta,
      titolo: proposta.titolo,
      richiesta: proposta.richiesta,
      impostazioni: this.#o.lavori.impostazioni(this.#progetto.id),
      ...(modelli === undefined ? {} : { modelli }),
    });
    return idProposta;
  }

  /**
   * Il proprietario conferma: la richiesta passa al progetto Shinka, che ci lavora nella sua
   * conversazione. Restituisce il progetto, oppure nulla se la proposta non è più in attesa.
   */
  conferma(idProposta: string, scelta: ModificaImpostazioni = {}): string | undefined {
    const proposta = this.#proposte.get(idProposta);
    if (proposta === undefined) return undefined;
    // Ciò che il proprietario ha scelto nella scheda vale per questo lavoro, non per sempre.
    const salvate = this.#o.lavori.impostazioni(this.#progetto.id);
    const usate = applicaModifica(salvate, scelta);
    const diverse = JSON.stringify(usate) !== JSON.stringify(salvate);
    this.#o.lavori.invia(
      this.#progetto.id,
      `[Sviluppo di Shinka: proposta dalla Home, confermata dal proprietario]\n${proposta.titolo}\n\n${proposta.richiesta}`,
      [],
      diverse ? scelta : undefined,
    );
    this.#proposte.delete(idProposta);
    this.#o.ricordate?.dimentica(idProposta);
    proposta.canale.pubblica({
      tipo: "sviluppo-deciso",
      idProposta,
      esito: "confermata",
      idProgetto: this.#progetto.id,
      impostazioni: usate,
      ...(diverse ? { soloPerQuestoLavoro: true } : {}),
    });
    this.#o.annotaHome(
      `[Shinka] Il proprietario ha confermato la proposta di sviluppo "${proposta.titolo}": la richiesta è passata al progetto ` +
        `"${this.#progetto.nome}", e il lavoro prosegue lì, non qui.`,
      proposta.canale,
    );
    return this.#progetto.id;
  }

  /** Il proprietario annulla. Falso se la proposta non è più in attesa. */
  annulla(idProposta: string): boolean {
    const proposta = this.#proposte.get(idProposta);
    if (proposta === undefined) return false;
    this.#proposte.delete(idProposta);
    this.#o.ricordate?.dimentica(idProposta);
    proposta.canale.pubblica({ tipo: "sviluppo-deciso", idProposta, esito: "annullata" });
    this.#o.annotaHome(`[Shinka] Il proprietario ha annullato la proposta di sviluppo "${proposta.titolo}": non è partito nulla.`, proposta.canale);
    return true;
  }

  /**
   * Il progetto Shinka chiede di installare ciò che ha registrato nel repository. Il centro prepara
   * la versione e la prova; se le prove passano mostra la scheda al proprietario e risponde subito:
   * la decisione arriva dopo, e con l'approvazione il centro si riavvia.
   */
  async chiediInstallazione(chiave: string, riassunto: unknown): Promise<EsitoStrumento> {
    if (chiave !== this.#progetto.id) return fallito("Solo il progetto Shinka può chiedere di installare una versione di Shinka.");
    const canale = this.#o.lavori.canale(this.#progetto.id);
    if (canale === undefined) return fallito("Il progetto Shinka non ha il suo archivio: l'installazione non si può chiedere.");
    const inParole = typeof riassunto === "string" ? riassunto.trim() : "";
    if (inParole === "") return fallito("Serve il riassunto di ciò che cambia, nelle parole che leggerà il proprietario.");
    if (this.#inPreparazione) return fallito("Una versione è già in preparazione: aspetta che finisca.");
    this.#inPreparazione = true;
    try {
      // Una richiesta nuova prende il posto di quella che aspettava: la versione è un'altra.
      await this.#chiudi("scaduta", false);
      const nuova = `${this.#o.installata}-nuovo`;
      const esito = await (this.#o.prepara ?? preparaVersione)({
        progetto: this.#progetto.cartella,
        installata: this.#o.installata,
        nuova,
      });
      if (this.#chiuso) return fallito("Il centro si sta spegnendo: richiedi l'installazione quando è di nuovo acceso.");
      if (!esito.pronta) return fallito(`La versione non è pronta per essere installata, e al proprietario non è stato chiesto nulla.\n${esito.motivo}`);
      if (!this.#o.guardiano) {
        await rm(nuova, { recursive: true, force: true }).catch(() => {});
        return riuscito(
          `Le prove sono passate sulla versione ${inBreve(esito.versione)}, ma questa installazione di Shinka non è tenuta accesa dal guardiano, ` +
            "e quindi non può mettere in funzione una versione da sola. Dillo al proprietario: la installa chi ha accesso al server.",
        );
      }
      const id = randomUUID();
      const nodi = this.#o.nodi?.() ?? [];
      const nomi = nodi.map((nodo) => `"${nodo.nome}"`).join(", ");
      const delGateway = await this.#o.gateway?.avviso(nuova);
      const avvisi = [
        ...esito.avvisi,
        ...(delGateway === undefined ? [] : [delGateway]),
        ...(nodi.length === 0
          ? []
          : [
              `Dopo l'installazione ${nodi.length === 1 ? `si aggiorna anche il nodo dell'ambiente ${nomi}` : `si aggiornano anche i nodi degli ambienti ${nomi}`}, ` +
                "se quando approvi è ancora collegato: lì le conversazioni e i terminali aperti si chiudono.",
            ]),
      ];
      // Nessuna scadenza: la richiesta aspetta il proprietario finché non decide. Smette di
      // aspettare solo se ne arriva una nuova, che prende il suo posto, o se il centro riparte.
      this.#attesa = { id, versione: esito.versione, riassunto: inParole, nuova, canale };
      canale.pubblica({
        tipo: "installazione-richiesta",
        idInstallazione: id,
        versione: inBreve(esito.versione),
        riassunto: inParole,
        modifiche: esito.modifiche,
        file: esito.file,
        quantiFile: esito.quantiFile,
        avvisi,
      });
      return riuscito(
        `Le prove sono passate sulla versione ${inBreve(esito.versione)}, e il proprietario ha davanti la scheda con ciò che cambia: ` +
          "la versione entra in funzione solo se la approva, e la richiesta resta in attesa finché non decide. " +
          "Chiudi il turno dicendogli in poche righe che cosa cambia, e non fare altro: con l'approvazione Shinka si riavvia, " +
          "e com'è andata lo saprai da un messaggio [Shinka] prima della sua prossima richiesta." +
          (avvisi.length === 0 ? "" : `\nNella scheda ci sono questi avvisi:\n${avvisi.map((avviso) => `- ${avviso}`).join("\n")}`),
      );
    } finally {
      this.#inPreparazione = false;
    }
  }

  /** Il proprietario ha deciso dalla scheda, o da Telegram. Falso se quell'installazione non è più in attesa. */
  decidi(idInstallazione: string, decisione: "approvata" | "negata"): boolean {
    if (this.#attesa?.id !== idInstallazione) return false;
    void this.#chiudi(decisione);
    return true;
  }

  /**
   * Il progetto Shinka ripropone al gateway la versione in funzione. Qui non si installa nulla: il
   * gateway guarda che cosa cambierebbe e chiede il sì al proprietario lui stesso.
   */
  async aggiornaGateway(chiave: string, riassunto: unknown): Promise<EsitoStrumento> {
    if (chiave !== this.#progetto.id) return fallito("Solo il progetto Shinka può proporre al gateway una versione di Shinka.");
    if (this.#o.gateway === undefined) return fallito("In questa installazione di Shinka il gateway non è configurato.");
    const inParole = typeof riassunto === "string" ? riassunto.trim() : "";
    if (inParole === "") return fallito("Serve il riassunto di ciò che cambia nel gateway, nelle parole che leggerà il proprietario.");
    const { esito: _esito, ...risposta } = await this.#o.gateway.proponi(inParole);
    return risposta;
  }

  /** Aggiunge qualcosa a ciò che il progetto Shinka deve sapere prima del prossimo messaggio. */
  annota(testo: string): void {
    this.#nota = this.#nota === undefined ? testo : `${this.#nota}\n${testo}`;
  }

  /** Quante installazioni aspettano il proprietario. */
  get inAttesa(): number {
    return this.#attesa === undefined ? 0 : 1;
  }

  /** Ciò che il progetto Shinka deve sapere prima del prossimo messaggio del proprietario, se c'è. */
  notaPerIlProgetto(idProgetto: string): string | undefined {
    if (idProgetto !== this.#progetto.id || this.#nota === undefined) return undefined;
    const nota = this.#nota;
    this.#nota = undefined;
    return nota;
  }

  async #chiudi(esito: EsitoApprovazione, conNota = true): Promise<void> {
    const attesa = this.#attesa;
    if (attesa === undefined) return;
    this.#attesa = undefined;
    const breve = inBreve(attesa.versione);
    if (esito !== "approvata") {
      attesa.canale.pubblica({ tipo: "installazione-decisa", idInstallazione: attesa.id, esito });
      if (conNota) {
        this.#nota =
          esito === "negata"
            ? `[Shinka] Il proprietario ha negato l'installazione della versione ${breve}: non è stata installata. Se non ha detto perché, chiediglielo prima di cambiare altro.`
            : `[Shinka] La richiesta di installare la versione ${breve} non aspetta più una decisione: non è stata installata. Se serve ancora, richiedila.`;
      }
      await rm(attesa.nuova, { recursive: true, force: true }).catch(() => {});
      return;
    }
    // Prima si scrive che cosa installare, poi lo si dice: se la scrittura non riesce, non è approvata nulla.
    const richiesta: Installazione = {
      fase: "da-installare",
      versione: attesa.versione,
      riassunto: attesa.riassunto,
      quando: new Date(this.#adesso()).toISOString(),
      nuova: attesa.nuova,
    };
    // I nodi collegati adesso: dopo l'installazione il centro, ripartito, li ritrova scritti qui.
    const nodi = (this.#o.nodi?.() ?? []).map((nodo) => nodo.id);
    if (nodi.length > 0) richiesta.nodi = nodi;
    try {
      await mkdir(dirname(this.#o.fileInstallazione), { recursive: true });
      await scriviInstallazione(this.#o.fileInstallazione, richiesta);
    } catch (errore) {
      attesa.canale.pubblica({ tipo: "installazione-decisa", idInstallazione: attesa.id, esito: "scaduta" });
      attesa.canale.pubblica({
        tipo: "errore",
        messaggio: `L'installazione della versione ${breve} non è partita: ${errore instanceof Error ? errore.message : String(errore)}`,
      });
      return;
    }
    attesa.canale.pubblica({ tipo: "installazione-decisa", idInstallazione: attesa.id, esito: "approvata" });
    const riavvio = setTimeout(() => this.#o.riavvia(), this.#o.attesaRiavvioMs ?? ATTESA_RIAVVIO_MS);
    riavvio.unref();
  }

  /**
   * All'avvio: se il centro è appena ripartito dopo un'installazione, dice al proprietario
   * com'è finita, nella conversazione del progetto Shinka. Lo dice una volta sola.
   */
  async riferisci(): Promise<void> {
    const { fileInstallazione } = this.#o;
    let stato = leggiInstallazione(fileInstallazione);
    if (stato === undefined || stato.riferita === true || stato.fase === "da-installare") return;
    // Il guardiano conferma la versione nuova qualche istante dopo che ha cominciato a rispondere.
    const entro = Date.now() + (this.#o.attesaEsitoMs ?? ATTESA_ESITO_MS);
    while (stato.fase === "in-prova" && Date.now() < entro && !this.#chiuso) {
      await new Promise((fatto) => setTimeout(fatto, 500).unref());
      stato = leggiInstallazione(fileInstallazione) ?? stato;
    }
    if (stato.fase === "in-prova" || this.#chiuso) return;
    const canale = this.#o.lavori.canale(this.#progetto.id);
    const breve = inBreve(stato.versione);
    if (stato.fase === "confermata") {
      canale?.pubblica({ tipo: "installazione-conclusa", versione: breve, esito: "installata" });
      this.#nota = `[Shinka] La versione ${breve} è stata installata, ed è quella in funzione adesso.`;
      // Da adesso è quella la versione di Shinka anche nel repository.
      await git(this.#progetto.cartella, ["push", "--quiet", "origin", `${stato.versione}:refs/heads/main`]);
      if (stato.nodi !== undefined && stato.nodi.length > 0) this.#o.propaga?.(stato.nodi);
      // Anche il gateway: gli si propone la versione, e se la sua parte cambia sarà lui a chiedere il sì al proprietario.
      const alGateway = await this.#o.gateway?.proponi(stato.riassunto).catch(() => undefined);
      if (alGateway !== undefined && alGateway.esito !== "uguale") this.annota(`[Shinka] Gateway: ${alGateway.testo}`);
    } else {
      const motivo = stato.motivo ?? "non è partita";
      canale?.pubblica({ tipo: "installazione-conclusa", versione: breve, esito: "tornata-indietro", motivo });
      this.#nota =
        `[Shinka] La versione ${breve} è stata installata ma non è partita (${motivo}): Shinka è tornata da sola alla versione di prima, ` +
        "che è quella in funzione adesso. Le prove non hanno visto il difetto: trovalo prima di richiedere l'installazione.";
    }
    await scriviInstallazione(fileInstallazione, { ...stato, riferita: true }).catch(() => {});
  }

  /** Il centro si spegne: ciò che aspettava resta com'è, e non parte più nulla. */
  chiudi(): void {
    this.#chiuso = true;
  }
}

/** I modelli che l'harness ha riferito in una conversazione, se lo ha fatto. */
function modelliDa(canale: Canale | undefined): ModelloDisponibile[] | undefined {
  const stato = canale?.ricordato("stato");
  return stato?.tipo === "stato" && stato.stato.modelli !== undefined && stato.stato.modelli.length > 0 ? stato.stato.modelli : undefined;
}
