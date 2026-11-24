/**
 * Le estensioni di Shinka: l'elenco tenuto al centro, con gli ambienti in cui ognuna è accesa.
 *
 * Un'estensione è codice di terzi. La propone la Home con una scheda che dice che cosa è, da dove
 * viene, che cosa viene eseguito e in quale ambiente: nulla viene installato né avviato finché il
 * proprietario non conferma. Confermata, l'ambiente la avvia una volta, fuori da ogni conversazione:
 * entra nell'elenco, accesa, solo se parte. Da lì la usano i progetti di quell'ambiente e, per
 * l'ambiente del centro, la Home. Spegnerla e toglierla lo fa il proprietario dalla pagina.
 *
 * Ciò che il proprietario ha già installato in un ambiente per conto suo si vede accanto alle
 * estensioni di Shinka, ma non si tocca: non viene copiato qui, né spento, né tolto.
 */

import type { ProposteRicordate } from "./proposte-ricordate.ts";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { esaminaPlugin } from "../nodo/estensioni.ts";
import {
  avvisiDellaDefinizione,
  difettoDelNome,
  inUnaRiga,
  leggiDefinizione,
  nomeDiChiaveValido,
  NOMI_RISERVATI,
  tipoInParole,
  type ContenutoPlugin,
  type DefinizioneEstensione,
  type EsitoProva,
  type Estensione,
  type EstensioneDistribuita,
  type EstensioniDellAmbiente,
  type StatoEstensioni,
} from "../protocollo/estensioni.ts";
import type { Ambiente } from "../protocollo/nodi.ts";
import {
  preparazioneDa,
  preparazioneDelNome,
  type EstensioniDegliAmbienti,
  type EstensionePerProgetto,
} from "../protocollo/avvio-progetto.ts";
import { ID_AMBIENTE_DEL_CENTRO } from "./ambienti.ts";
import type { Canale } from "./canale.ts";

/** Come il centro raggiunge le estensioni di un ambiente: da sé per il suo, attraverso il nodo per gli altri. */
export interface PortaEstensioni {
  prova(estensione: EstensioneDistribuita): Promise<EsitoProva>;
  guarda(): Promise<EstensioniDellAmbiente>;
}

/** Ciò che la Home scrive quando propone un'estensione. Senza definizione, è una già in elenco da accendere altrove. */
export interface RichiestaEstensione {
  nome: string;
  descrizione: string;
  idAmbiente: string;
  definizione?:
    | { tipo: "mcp-locale"; comando: string; argomenti: string[]; variabili: Record<string, string> }
    | { tipo: "mcp-remoto"; indirizzo: string; trasporto: "http" | "sse" }
    | { tipo: "plugin"; repository: string; riferimento?: string; cartella?: string }
    | Extract<DefinizioneEstensione, { tipo: "modello-locale" }>;
  chiavi: string[];
}

type Esame = { definizione: Extract<DefinizioneEstensione, { tipo: "plugin" }>; contenuto: ContenutoPlugin } | { motivo: string };

export interface OpzioniEstensioni {
  /** Il file in cui l'elenco resta scritto. */
  file: string;
  /** Gli ambienti come sono adesso. */
  ambienti(): Ambiente[];
  inAmbiente(idAmbiente: string): PortaEstensioni;
  /** L'archivio dell'argomento aperto nella Home, chiesto nel momento in cui serve. */
  canaleHome(): Canale;
  /** Aggiunge un'informazione al contesto della Home, senza farla rispondere: nella chat del canale indicato, o nella principale. */
  annotaHome(testo: string, canale?: Canale): void;
  /** Come si guarda un plugin prima di proporlo. Nei test se ne mette uno finto. */
  esamina?(repository: string, riferimento: string | undefined, cartella: string | undefined): Promise<Esame>;
  /** Quali repository si accettano: di suo solo quelli raggiunti in https. */
  accettaRepository?(indirizzo: string): boolean;
  adesso?(): Date;
  /** Dove le proposte in attesa restano scritte, perché un riavvio del centro non le perda. */
  ricordate?: ProposteRicordate;
}

interface PropostaInAttesa {
  nome: string;
  descrizione: string;
  definizione: DefinizioneEstensione;
  chiavi: string[];
  contenuto?: ContenutoPlugin;
  idAmbiente: string;
  /** L'archivio dell'argomento in cui la proposta è stata fatta: lì va anche la decisione. */
  canale: Canale;
  /** Vero mentre l'ambiente la sta provando. */
  inProva: boolean;
}

/** Com'è finita la conferma di una proposta, o l'accensione chiesta dalla pagina. */
export type EsitoAccensione =
  | { stato: "accesa"; estensione: Estensione; strumenti: string[] }
  /** Non è partita: la proposta è chiusa. */
  | { stato: "non-partita"; motivo: string }
  /** Manca qualcosa che il proprietario può mettere a posto: la proposta resta in attesa. */
  | { stato: "da-riprovare"; motivo: string }
  /** L'ambiente la sta già provando. */
  | { stato: "in-prova" };

interface Salvato {
  estensioni: Estensione[];
  dellAmbiente: Record<string, EstensioniDellAmbiente>;
  /** Le chiavi dei modelli locali in rete, per "id dell'estensione:id dell'ambiente": non escono nello stato. */
  chiaviDiRete?: Record<string, string>;
}

/** Un modello locale raggiungibile in rete, come lo usa il centro (ADR 0053). */
export interface ModelloInRete {
  nome: string;
  idAmbiente: string;
  indirizzo: string;
  chiave: string;
  definizione: Extract<DefinizioneEstensione, { tipo: "modello-locale" }>;
}

/** Parole che in un nome fanno pensare a un segreto: quello va tra le chiavi, e il valore nel vault. */
const SA_DI_SEGRETO = /(key|token|secret|password|passwd|pwd|credential|bearer|chiave|segreto)/i;

function soloHttps(indirizzo: string): boolean {
  return /^https:\/\/[^\s]+$/.test(indirizzo);
}

export class Estensioni {
  readonly #o: OpzioniEstensioni;
  #estensioni: Estensione[];
  readonly #dellAmbiente: Record<string, EstensioniDellAmbiente>;
  readonly #chiaviDiRete: Record<string, string>;
  readonly #proposte = new Map<string, PropostaInAttesa>();
  readonly #ascoltatori = new Set<() => void>();
  readonly #pagine = new Set<(stato: StatoEstensioni) => void>();
  /** Le scritture si fanno una alla volta. */
  #scritture: Promise<void> = Promise.resolve();

  private constructor(opzioni: OpzioniEstensioni, salvato: Salvato) {
    this.#o = opzioni;
    this.#estensioni = salvato.estensioni;
    this.#dellAmbiente = salvato.dellAmbiente;
    this.#chiaviDiRete = salvato.chiaviDiRete ?? {};
  }

  static async apri(opzioni: OpzioniEstensioni): Promise<Estensioni> {
    let salvato: Salvato = { estensioni: [], dellAmbiente: {} };
    if (existsSync(opzioni.file)) {
      const letto = JSON.parse(await readFile(opzioni.file, "utf8")) as Partial<Salvato>;
      salvato = { estensioni: letto.estensioni ?? [], dellAmbiente: letto.dellAmbiente ?? {}, ...(letto.chiaviDiRete === undefined ? {} : { chiaviDiRete: letto.chiaviDiRete }) };
    }
    return new Estensioni(opzioni, salvato);
  }

  #adesso(): string {
    return (this.#o.adesso?.() ?? new Date()).toISOString();
  }

  stato(): StatoEstensioni {
    return { estensioni: this.#estensioni, dellAmbiente: this.#dellAmbiente };
  }

  /**
   * Ciò che un progetto nuovo può avere in ciascun ambiente: le estensioni di Shinka, accese lì o
   * no, e ciò che il proprietario vi ha installato per conto suo, l'ultima volta che Shinka ha guardato.
   */
  perProgetto(): EstensioniDegliAmbienti {
    const perAmbiente: EstensioniDegliAmbienti = {};
    for (const ambiente of this.#o.ambienti()) {
      // Un modello locale non si sceglie tra le estensioni del progetto: si sceglie come modello.
      const voci: EstensionePerProgetto[] = this.#estensioni.filter((una) => una.definizione.tipo !== "modello-locale").map((una) => {
        const preparazione = preparazioneDa(una.definizione);
        return {
          nome: una.nome,
          genere: una.definizione.tipo === "plugin" ? "plugin" : "server",
          provenienza: "shinka",
          accesa: una.ambienti.some((dove) => dove.idAmbiente === ambiente.id && dove.accesa),
          ...(una.descrizione === "" ? {} : { descrizione: una.descrizione }),
          ...(preparazione === undefined ? {} : { preparazione }),
        };
      });
      const viste = this.#dellAmbiente[ambiente.id];
      const giaQui = (nome: string): boolean => voci.some((voce) => voce.nome === nome) || NOMI_RISERVATI.includes(nome);
      for (const plugin of viste?.plugin ?? []) {
        if (giaQui(plugin.nome)) continue;
        voci.push({ nome: plugin.nome, genere: "plugin", provenienza: "ambiente", accesa: true });
      }
      for (const server of viste?.server ?? []) {
        if (giaQui(server.nome)) continue;
        const preparazione = preparazioneDelNome(server.nome);
        voci.push({ nome: server.nome, genere: "server", provenienza: "ambiente", accesa: true, ...(preparazione === undefined ? {} : { preparazione }) });
      }
      perAmbiente[ambiente.id] = { voci, ...(viste === undefined ? {} : { guardatoIl: viste.quando }) };
    }
    return perAmbiente;
  }

  /** Le estensioni accese in un ambiente, come l'ambiente deve riceverle. */
  accese(idAmbiente: string): EstensioneDistribuita[] {
    return this.#estensioni
      .filter((una) => una.ambienti.some((dove) => dove.idAmbiente === idAmbiente && dove.accesa))
      .map((una) => {
        const chiave = this.#chiaveDiRete(una, idAmbiente);
        return { ...distribuita(una), ...(chiave === undefined ? {} : { inRete: { chiave } }) };
      });
  }

  /** La chiave di un modello locale in rete in un ambiente, se lì è acceso e in rete. */
  #chiaveDiRete(estensione: Estensione, idAmbiente: string): string | undefined {
    if (estensione.definizione.tipo !== "modello-locale") return undefined;
    const dove = estensione.ambienti.find((uno) => uno.idAmbiente === idAmbiente);
    if (dove?.inRete === undefined) return undefined;
    return this.#chiaviDiRete[`${estensione.id}:${idAmbiente}`];
  }

  /** I modelli locali accesi e in rete, in ogni ambiente: il centro li offre anche alle conversazioni degli altri. */
  modelliInRete(): ModelloInRete[] {
    return this.#estensioni.flatMap((una) => {
      const { definizione } = una;
      if (definizione.tipo !== "modello-locale") return [];
      return una.ambienti.flatMap((dove) => {
        const chiave = this.#chiaveDiRete(una, dove.idAmbiente);
        if (!dove.accesa || dove.inRete === undefined || chiave === undefined) return [];
        return [{ nome: una.nome, idAmbiente: dove.idAmbiente, indirizzo: dove.inRete.indirizzo, chiave, definizione }];
      });
    });
  }

  /**
   * Il proprietario sceglie quanto può essere lunga una risposta di un modello locale. Claude Code
   * tiene da parte per la compattazione la risposta massima più 13.000 token: abbassarla lascia più
   * contesto al lavoro. Vale dal prossimo avvio delle conversazioni. Il motivo, se non si può.
   */
  async impostaUscita(id: string, uscita: number): Promise<string | undefined> {
    const estensione = this.#estensioni.find((una) => una.id === id);
    if (estensione === undefined) return "Estensione non trovata.";
    const { definizione } = estensione;
    if (definizione.tipo !== "modello-locale") return "Solo un modello locale ha una risposta massima.";
    const massima = Math.floor(definizione.contesto / 2);
    if (!Number.isInteger(uscita) || uscita < 1024 || uscita > massima) return `La risposta massima va da 1024 a ${massima} token.`;
    this.#estensioni = this.#estensioni.map((una) => (una.id === id && una.definizione.tipo === "modello-locale" ? { ...una, definizione: { ...una.definizione, uscita } } : una));
    await this.#cambiato();
    return undefined;
  }

  /**
   * Il proprietario mette in rete un modello locale acceso in un ambiente, all'indirizzo che il
   * centro usa per raggiungerlo, oppure lo toglie dalla rete. La chiave nasce la prima volta e
   * cambia ogni volta che lo si rimette in rete. Il motivo, se non si può.
   */
  async impostaInRete(id: string, idAmbiente: string, indirizzo: string | undefined): Promise<string | undefined> {
    const estensione = this.#estensioni.find((una) => una.id === id);
    if (estensione === undefined) return "Estensione non trovata.";
    if (estensione.definizione.tipo !== "modello-locale") return "Solo un modello locale si mette in rete.";
    const dove = estensione.ambienti.find((uno) => uno.idAmbiente === idAmbiente);
    if (dove === undefined || !dove.accesa) return "Il modello non è acceso in questo ambiente.";
    const pulito = indirizzo?.trim();
    if (pulito !== undefined && !/^[A-Za-z0-9.-]{1,253}$|^\[[0-9A-Fa-f:.]+\]$/.test(pulito)) return "L'indirizzo deve essere un nome o un indirizzo IP, senza porta.";
    const chiave = `${id}:${idAmbiente}`;
    if (pulito === undefined) delete this.#chiaviDiRete[chiave];
    else if (dove.inRete === undefined || this.#chiaviDiRete[chiave] === undefined) this.#chiaviDiRete[chiave] = randomBytes(24).toString("base64url");
    this.#estensioni = this.#estensioni.map((una) =>
      una.id !== id
        ? una
        : {
            ...una,
            ambienti: una.ambienti.map((uno) => {
              if (uno.idAmbiente !== idAmbiente) return uno;
              const { inRete: _prima, ...resto } = uno;
              return pulito === undefined ? resto : { ...resto, inRete: { indirizzo: pulito } };
            }),
          },
    );
    await this.#cambiato();
    return undefined;
  }

  /**
   * Le chiavi che un ambiente può chiedere al vault per quell'estensione: quelle che dichiara, se
   * lì è accesa oppure se il proprietario ne ha appena confermato la proposta e l'ambiente la sta
   * provando. Nulla negli altri casi: allora nessuna chiave viene chiesta.
   */
  chiaviRichiedibili(nome: string, idAmbiente: string): string[] | undefined {
    const inProva = [...this.#proposte.values()].find((una) => una.inProva && una.nome === nome && una.idAmbiente === idAmbiente);
    const chiavi =
      inProva?.chiavi ??
      (this.#inProva.has(`${nome}\n${idAmbiente}`) ? this.#estensioni.find((una) => una.nome === nome)?.chiavi : undefined) ??
      this.accese(idAmbiente).find((una) => una.nome === nome)?.chiavi;
    return chiavi === undefined || chiavi.length === 0 ? undefined : chiavi;
  }

  /** Le accensioni chieste dalla pagina che un ambiente sta provando, come "nome\nambiente". */
  readonly #inProva = new Set<string>();

  /** Chiamata a ogni cambiamento dell'elenco: per portarlo agli ambienti. */
  ascolta(ascoltatore: () => void): () => void {
    this.#ascoltatori.add(ascoltatore);
    return () => this.#ascoltatori.delete(ascoltatore);
  }

  /** Collega un ascoltatore: riceve subito lo stato, poi ogni cambiamento. Serve all'interfaccia. */
  iscrivi(ascoltatore: (stato: StatoEstensioni) => void): () => void {
    ascoltatore(this.stato());
    this.#pagine.add(ascoltatore);
    return () => this.#pagine.delete(ascoltatore);
  }

  #avvisaLePagine(): void {
    const stato = this.stato();
    for (const pagina of this.#pagine) pagina(stato);
  }

  #ambiente(idAmbiente: string): Ambiente | undefined {
    return this.#o.ambienti().find((uno) => uno.id === idAmbiente);
  }

  /**
   * La Home propone un'estensione: se la richiesta sta in piedi compare la scheda, e nient'altro.
   * Di un plugin viene letto prima il contenuto, perché la scheda lo dica; non viene eseguito nulla.
   */
  /** Dopo un riavvio del centro: tornano le proposte che aspettavano il proprietario. */
  async ripristina(): Promise<void> {
    for (const { id, dati, canale } of (await this.#o.ricordate?.ripristina<Omit<PropostaInAttesa, "canale" | "inProva">>("estensione")) ?? []) {
      this.#proposte.set(id, { ...dati, canale, inProva: false });
    }
  }

  async proponi(richiesta: RichiestaEstensione, canaleDellaChat?: Canale): Promise<{ idProposta: string } | { motivo: string }> {
    const nome = richiesta.nome.trim();
    const difetto = difettoDelNome(nome);
    if (difetto !== undefined) return { motivo: difetto };
    const ambiente = this.#ambiente(richiesta.idAmbiente);
    if (ambiente === undefined) return { motivo: "Quell'ambiente non esiste." };
    if (!ambiente.attivo) return { motivo: `L'ambiente "${ambiente.nome}" è spento: un'estensione si prova lì prima di accenderla, quindi va proposta quando è attivo.` };
    if ([...this.#proposte.values()].some((una) => una.nome === nome && una.idAmbiente === ambiente.id)) {
      return { motivo: `Il proprietario ha già davanti la scheda di "${nome}" per quell'ambiente: aspetta la sua decisione.` };
    }
    const esistente = this.#estensioni.find((una) => una.nome === nome);
    const avvisi: string[] = [];
    let definizione: DefinizioneEstensione;
    let chiavi: string[];
    let contenuto: ContenutoPlugin | undefined;
    let descrizione = richiesta.descrizione.trim();

    if (richiesta.definizione === undefined) {
      if (esistente === undefined) return { motivo: `Nell'elenco di Shinka non c'è un'estensione "${nome}": per proporne una nuova serve la sua definizione.` };
      if (esistente.ambienti.some((dove) => dove.idAmbiente === ambiente.id && dove.accesa)) {
        return { motivo: `"${nome}" è già accesa nell'ambiente "${ambiente.nome}".` };
      }
      ({ definizione, chiavi, contenuto } = esistente);
      if (descrizione === "") descrizione = esistente.descrizione;
    } else {
      if (descrizione === "") return { motivo: "Serve una descrizione: che cosa fa l'estensione, in parole per il proprietario." };
      chiavi = [...new Set(richiesta.chiavi.map((chiave) => chiave.trim()).filter((chiave) => chiave !== ""))];
      const scorretta = chiavi.find((chiave) => !nomeDiChiaveValido(chiave));
      if (scorretta !== undefined) return { motivo: `"${scorretta}" non è il nome di una chiave: è il nome di una variabile d'ambiente o di un'intestazione, non il suo valore.` };
      const pronta = await this.#definisci(richiesta.definizione, chiavi);
      if ("motivo" in pronta) return pronta;
      ({ definizione, contenuto } = pronta);
      if (esistente !== undefined) {
        if (JSON.stringify(esistente.definizione) === JSON.stringify(definizione) && JSON.stringify(esistente.chiavi) === JSON.stringify(chiavi)) {
          return { motivo: `"${nome}" è già nell'elenco con questa stessa definizione: per accenderla in un altro ambiente proponila senza definizione.` };
        }
        const altrove = esistente.ambienti.filter((dove) => dove.accesa && dove.idAmbiente !== ambiente.id).map((dove) => this.#ambiente(dove.idAmbiente)?.nome ?? dove.idAmbiente);
        avvisi.push(
          `Prende il posto di "${nome}" com'è adesso nell'elenco (${inUnaRiga(esistente.definizione)}).` +
            (altrove.length === 0 ? "" : ` Negli altri ambienti in cui è accesa (${altrove.join(", ")}) verrà spenta: lì va riaccesa dalla pagina Estensioni.`),
        );
      }
    }

    avvisi.unshift(...avvisiDellaDefinizione(definizione, contenuto));
    const gia = this.#dellAmbiente[ambiente.id];
    if (definizione.tipo !== "plugin" && gia?.server.some((uno) => uno.nome === nome) === true) {
      avvisi.push(`Nell'ambiente c'è già un server "${nome}", installato fuori da Shinka: nelle conversazioni dei progetti varrà quello di Shinka.`);
    }
    if (definizione.tipo === "plugin" && contenuto?.nome !== undefined && gia?.plugin.some((uno) => uno.nome === contenuto?.nome) === true) {
      avvisi.push(`Nell'ambiente il plugin "${contenuto.nome}" c'è già, installato fuori da Shinka: nei progetti comparirebbe due volte.`);
    }
    if (chiavi.length > 0) {
      avvisi.push(
        `Vuole ${chiavi.length === 1 ? "una chiave" : "delle chiavi"} dal vault (${chiavi.join(", ")}): scrivila nella pagina Vault, tra le chiavi delle estensioni, prima di confermare. ` +
          "Il programma dell'estensione la riceve per intero, e una conversazione di quell'ambiente potrebbe leggerla.",
      );
    }

    const idProposta = randomUUID();
    const canale = canaleDellaChat ?? this.#o.canaleHome();
    this.#proposte.set(idProposta, { nome, descrizione, definizione, chiavi, ...(contenuto === undefined ? {} : { contenuto }), idAmbiente: ambiente.id, canale, inProva: false });
    this.#o.ricordate?.ricorda("estensione", idProposta, { nome, descrizione, definizione, chiavi, ...(contenuto === undefined ? {} : { contenuto }), idAmbiente: ambiente.id }, canale);
    canale.pubblica({
      tipo: "estensione-proposta",
      idProposta,
      nome,
      descrizione,
      definizione,
      chiavi,
      idAmbiente: ambiente.id,
      nomeAmbiente: ambiente.nome,
      ...(contenuto === undefined ? {} : { contenuto }),
      avvisi,
      ...(richiesta.definizione === undefined ? { giaInElenco: true as const } : {}),
    });
    return { idProposta };
  }

  /** Controlla la definizione scritta dalla Home e la completa: di un plugin trova il commit e legge il contenuto. */
  async #definisci(
    scritta: NonNullable<RichiestaEstensione["definizione"]>,
    chiavi: string[],
  ): Promise<{ definizione: DefinizioneEstensione; contenuto?: ContenutoPlugin } | { motivo: string }> {
    const nelVault = "va dichiarato tra le chiavi, e il valore lo scrive il proprietario nel vault: nella definizione non entra nessun segreto";
    if (scritta.tipo === "mcp-locale") {
      const comando = scritta.comando.trim();
      if (comando === "" || /[\r\n]/.test(comando)) return { motivo: "Serve il comando: il programma da avviare, senza argomenti." };
      if (scritta.argomenti.length > 60 || scritta.argomenti.some((uno) => uno.length > 2000 || /[\r\n]/.test(uno))) {
        return { motivo: "Gli argomenti sono troppi, o troppo lunghi." };
      }
      const segreto = scritta.argomenti.find((uno) => /(key|token|secret|password|passwd|pwd)s?[=:]\S{6,}/i.test(uno));
      if (segreto !== undefined) return { motivo: `L'argomento "${segreto.slice(0, 24)}…" sembra contenere un segreto: ${nelVault}.` };
      for (const [variabile, valore] of Object.entries(scritta.variabili)) {
        if (!nomeDiChiaveValido(variabile)) return { motivo: `"${variabile}" non è il nome di una variabile d'ambiente.` };
        if (chiavi.includes(variabile)) return { motivo: `"${variabile}" è sia tra le variabili sia tra le chiavi: una chiave non ha un valore nella definizione.` };
        if (SA_DI_SEGRETO.test(variabile) && valore.trim() !== "") return { motivo: `La variabile "${variabile}" sembra un segreto: ${nelVault}.` };
      }
      return { definizione: { tipo: "mcp-locale", comando, argomenti: scritta.argomenti, variabili: scritta.variabili } };
    }
    if (scritta.tipo === "modello-locale") {
      if (chiavi.length > 0) return { motivo: "Un modello locale non riceve chiavi dal vault." };
      const comando = scritta.comando.trim();
      if (comando === "" || /[\r\n]/.test(comando)) return { motivo: "Serve il comando: il programma del server, senza argomenti." };
      if (scritta.argomenti.length > 80 || scritta.argomenti.some((uno) => uno.length > 2000 || /[\r\n]/.test(uno))) {
        return { motivo: "Gli argomenti sono troppi, o troppo lunghi." };
      }
      const segreto = scritta.argomenti.find((uno) => /(key|token|secret|password|passwd|pwd)s?[=:]\S{6,}/i.test(uno));
      if (segreto !== undefined) return { motivo: `L'argomento "${segreto.slice(0, 24)}…" sembra contenere un segreto: un modello locale non ne ha bisogno.` };
      for (const [variabile, valore] of Object.entries(scritta.variabili)) {
        if (!nomeDiChiaveValido(variabile)) return { motivo: `"${variabile}" non è il nome di una variabile d'ambiente.` };
        if (SA_DI_SEGRETO.test(variabile) && valore.trim() !== "") return { motivo: `La variabile "${variabile}" sembra un segreto: un modello locale non ne ha bisogno.` };
      }
      const definizione = leggiDefinizione({ ...scritta, comando });
      if (definizione === undefined || definizione.tipo !== "modello-locale") {
        return {
          motivo:
            "Il modello locale non è descritto per intero: servono la porta (da 1 a 65535), il nome del modello come lo chiama il server, il contesto e la lunghezza massima delle risposte in token, e almeno un impegno tra low, medium, high, xhigh e max.",
        };
      }
      if (definizione.porta < 1024) return { motivo: "La porta del server va scelta da 1024 in su." };
      return { definizione };
    }
    if (scritta.tipo === "mcp-remoto") {
      let indirizzo: URL;
      try {
        indirizzo = new URL(scritta.indirizzo.trim());
      } catch {
        return { motivo: "L'indirizzo non è un indirizzo web." };
      }
      if (indirizzo.protocol !== "https:" && indirizzo.protocol !== "http:") return { motivo: "L'indirizzo deve cominciare con https o http." };
      if (indirizzo.username !== "" || indirizzo.password !== "") return { motivo: `L'indirizzo contiene un nome utente o una password: ${nelVault}.` };
      const sospetto = [...indirizzo.searchParams.keys()].find((chiave) => SA_DI_SEGRETO.test(chiave));
      if (sospetto !== undefined) return { motivo: `Nell'indirizzo "${sospetto}" sembra un segreto: ${nelVault}.` };
      return { definizione: { tipo: "mcp-remoto", indirizzo: indirizzo.toString(), trasporto: scritta.trasporto } };
    }
    if (chiavi.length > 0) return { motivo: "Un plugin non riceve chiavi dal vault: le ricevono solo i server." };
    const repository = scritta.repository.trim();
    if (!(this.#o.accettaRepository ?? soloHttps)(repository)) return { motivo: "Il repository va indicato con il suo indirizzo https." };
    const cartella = scritta.cartella?.trim().replace(/^\.?\/+/, "").replace(/\/+$/, "");
    if (cartella !== undefined && (cartella.split(/[\\/]/).includes("..") || /^[A-Za-z]:/.test(cartella))) return { motivo: "La cartella indicata esce dal repository." };
    const riferimento = scritta.riferimento?.trim();
    const esame = await (this.#o.esamina?.(repository, riferimento, cartella === "" ? undefined : cartella) ??
      esaminaPlugin(join(dirname(this.#o.file), "estensioni-in-esame"), repository, riferimento === "" ? undefined : riferimento, cartella === "" ? undefined : cartella));
    return "motivo" in esame ? { motivo: `Il plugin non si può proporre. ${esame.motivo}` } : esame;
  }

  /**
   * Il proprietario conferma la scheda: l'ambiente avvia l'estensione una volta, e solo se parte
   * entra nell'elenco, accesa lì. Nulla se la proposta non è più in attesa.
   */
  async conferma(idProposta: string): Promise<EsitoAccensione | undefined> {
    const proposta = this.#proposte.get(idProposta);
    if (proposta === undefined) return undefined;
    if (proposta.inProva) return { stato: "in-prova" };
    proposta.inProva = true;
    const esistente = this.#estensioni.find((una) => una.nome === proposta.nome);
    const estensione: Estensione = {
      id: esistente?.id ?? randomUUID(),
      nome: proposta.nome,
      descrizione: proposta.descrizione,
      definizione: proposta.definizione,
      chiavi: proposta.chiavi,
      ...(proposta.contenuto === undefined ? {} : { contenuto: proposta.contenuto }),
      // Con una definizione diversa da quella di prima, altrove non è mai stata provata.
      ambienti: esistente !== undefined && JSON.stringify(esistente.definizione) === JSON.stringify(proposta.definizione) ? esistente.ambienti : [],
      aggiunta: esistente?.aggiunta ?? this.#adesso(),
    };
    let esito: EsitoProva;
    try {
      esito = await this.#prova(proposta.idAmbiente, estensione);
    } finally {
      proposta.inProva = false;
    }
    const ambiente = this.#ambiente(proposta.idAmbiente)?.nome ?? proposta.idAmbiente;
    if (!esito.riuscita) {
      if (esito.riprovabile === true) return { stato: "da-riprovare", motivo: esito.motivo };
      this.#proposte.delete(idProposta);
      this.#o.ricordate?.dimentica(idProposta);
    this.#o.ricordate?.dimentica(idProposta);
      proposta.canale.pubblica({ tipo: "estensione-decisa", idProposta, esito: "non-partita", motivo: esito.motivo });
      this.#o.annotaHome(
        `[Shinka] Il proprietario ha confermato l'estensione "${proposta.nome}", ma nell'ambiente "${ambiente}" non è partita, e quindi non è stata accesa. ` +
          `Il motivo: ${esito.motivo} Se sai come correggerla, riproponila corretta; altrimenti di' al proprietario che cosa manca.`,
        proposta.canale,
      );
      return { stato: "non-partita", motivo: esito.motivo };
    }
    this.#proposte.delete(idProposta);
    this.#o.ricordate?.dimentica(idProposta);
    await this.#accendi(estensione, proposta.idAmbiente, esito);
    proposta.canale.pubblica({ tipo: "estensione-decisa", idProposta, esito: "accesa", strumenti: esito.strumenti });
    this.#o.annotaHome(
      `[Shinka] Il proprietario ha confermato l'estensione "${proposta.nome}": nell'ambiente "${ambiente}" è partita ed è accesa. ` +
        (proposta.definizione.tipo === "modello-locale"
          ? `Il modello ${proposta.definizione.modello} si sceglie come modello, o come chi implementa, nei progetti di quell'ambiente: il server si accende quando serve e si spegne dopo dieci minuti fermo.`
          : proposta.definizione.tipo === "plugin"
          ? "Le sue skill valgono nelle conversazioni che partono da adesso."
          : `Offre questi strumenti: ${esito.strumenti.join(", ") || "nessuno"}. Valgono nelle conversazioni che partono da adesso` +
            `${proposta.idAmbiente === ID_AMBIENTE_DEL_CENTRO ? ", questa compresa dal prossimo messaggio" : ""}.`),
      proposta.canale,
    );
    return { stato: "accesa", estensione, strumenti: esito.strumenti };
  }

  /** Il proprietario annulla. Falso se la proposta non è più in attesa, o se l'ambiente la sta già provando. */
  annulla(idProposta: string): boolean {
    const proposta = this.#proposte.get(idProposta);
    if (proposta === undefined || proposta.inProva) return false;
    this.#proposte.delete(idProposta);
    this.#o.ricordate?.dimentica(idProposta);
    proposta.canale.pubblica({ tipo: "estensione-decisa", idProposta, esito: "annullata" });
    this.#o.annotaHome(`[Shinka] Il proprietario ha annullato la proposta dell'estensione "${proposta.nome}": non è stato installato né avviato nulla.`, proposta.canale);
    return true;
  }

  async #prova(idAmbiente: string, estensione: Estensione): Promise<EsitoProva> {
    try {
      return await this.#o.inAmbiente(idAmbiente).prova(distribuita(estensione));
    } catch (errore) {
      return { riuscita: false, motivo: errore instanceof Error ? errore.message : String(errore) };
    }
  }

  async #accendi(estensione: Estensione, idAmbiente: string, esito: Extract<EsitoProva, { riuscita: true }>): Promise<void> {
    const accesa: Estensione = {
      ...estensione,
      ...(esito.contenuto === undefined ? {} : { contenuto: esito.contenuto }),
      ambienti: [
        ...estensione.ambienti.filter((dove) => dove.idAmbiente !== idAmbiente),
        { idAmbiente, accesa: true, strumenti: esito.strumenti, provata: this.#adesso(), ...(esito.token === undefined ? {} : { token: esito.token }) },
      ],
    };
    this.#estensioni = [...this.#estensioni.filter((una) => una.id !== accesa.id), accesa].sort((a, b) => a.nome.localeCompare(b.nome));
    await this.#cambiato();
  }

  /**
   * Il proprietario, dalla pagina, accende in un ambiente un'estensione che è già nell'elenco:
   * anche lì viene provata prima. Nulla se quell'estensione non c'è.
   */
  async accendi(id: string, idAmbiente: string): Promise<EsitoAccensione | undefined> {
    const estensione = this.#estensioni.find((una) => una.id === id);
    const ambiente = this.#ambiente(idAmbiente);
    if (estensione === undefined || ambiente === undefined) return undefined;
    if (!ambiente.attivo) return { stato: "da-riprovare", motivo: `L'ambiente "${ambiente.nome}" è spento: un'estensione si prova lì prima di accenderla.` };
    const chiave = `${estensione.nome}\n${idAmbiente}`;
    if (this.#inProva.has(chiave)) return { stato: "in-prova" };
    this.#inProva.add(chiave);
    let esito: EsitoProva;
    try {
      esito = await this.#prova(idAmbiente, estensione);
    } finally {
      this.#inProva.delete(chiave);
    }
    if (!esito.riuscita) return esito.riprovabile === true ? { stato: "da-riprovare", motivo: esito.motivo } : { stato: "non-partita", motivo: esito.motivo };
    // Nel frattempo può essere stata tolta: allora non si riaccende.
    const adesso = this.#estensioni.find((una) => una.id === id);
    if (adesso === undefined) return undefined;
    await this.#accendi(adesso, idAmbiente, esito);
    return { stato: "accesa", estensione: this.#estensioni.find((una) => una.id === id) ?? adesso, strumenti: esito.strumenti };
  }

  /** Il proprietario la spegne in un ambiente: resta nell'elenco. Falso se lì non era accesa. */
  async spegni(id: string, idAmbiente: string): Promise<boolean> {
    const estensione = this.#estensioni.find((una) => una.id === id);
    const dove = estensione?.ambienti.find((uno) => uno.idAmbiente === idAmbiente);
    if (estensione === undefined || dove === undefined || !dove.accesa) return false;
    this.#estensioni = this.#estensioni.map((una) =>
      una.id !== id ? una : { ...una, ambienti: una.ambienti.map((uno) => (uno.idAmbiente === idAmbiente ? { ...uno, accesa: false } : uno)) },
    );
    await this.#cambiato();
    return true;
  }

  /** Il proprietario la toglie dall'elenco: si spegne dappertutto. Falso se non c'era. */
  async rimuovi(id: string): Promise<boolean> {
    if (!this.#estensioni.some((una) => una.id === id)) return false;
    this.#estensioni = this.#estensioni.filter((una) => una.id !== id);
    await this.#cambiato();
    return true;
  }

  /** Guarda adesso ciò che un ambiente ha già di suo, e se lo ricorda. */
  async guarda(idAmbiente: string): Promise<EstensioniDellAmbiente> {
    const viste = await this.#o.inAmbiente(idAmbiente).guarda();
    this.#dellAmbiente[idAmbiente] = viste;
    this.#avvisaLePagine();
    await this.#salva().catch(() => {});
    return viste;
  }

  async #cambiato(): Promise<void> {
    await this.#salva();
    for (const ascoltatore of this.#ascoltatori) ascoltatore();
    this.#avvisaLePagine();
  }

  #salva(): Promise<void> {
    const scrittura = this.#scritture.then(async () => {
      await mkdir(dirname(this.#o.file), { recursive: true });
      const provvisorio = `${this.#o.file}.tmp`;
      const salvato: Salvato = { estensioni: this.#estensioni, dellAmbiente: this.#dellAmbiente, chiaviDiRete: this.#chiaviDiRete };
      await writeFile(provvisorio, JSON.stringify(salvato, null, 2), { mode: 0o600 });
      await rename(provvisorio, this.#o.file);
    });
    this.#scritture = scrittura.catch(() => {});
    return scrittura;
  }
}

function distribuita(estensione: Estensione): EstensioneDistribuita {
  return { id: estensione.id, nome: estensione.nome, definizione: estensione.definizione, chiavi: estensione.chiavi };
}

/** Un'estensione in poche righe, com'è nell'elenco: per la Home, che la riferisce al proprietario. */
export function inPocheRighe(estensione: Estensione, nomeAmbiente: (idAmbiente: string) => string): string {
  const dove = estensione.ambienti.map((uno) => `${nomeAmbiente(uno.idAmbiente)} (${uno.accesa ? "accesa" : "spenta"})`).join(", ");
  return (
    `- ${estensione.nome}: ${tipoInParole(estensione.definizione.tipo)}. ${estensione.descrizione}\n` +
    `  ${inUnaRiga(estensione.definizione)}\n` +
    `  Ambienti: ${dove || "nessuno"}.` +
    (estensione.chiavi.length === 0 ? "" : ` Chiavi dal vault: ${estensione.chiavi.join(", ")}.`)
  );
}
