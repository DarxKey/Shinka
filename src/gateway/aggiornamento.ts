/**
 * Il gateway che cambia versione da dentro.
 *
 * Il centro, dopo un'installazione approvata, propone al gateway i file della sua parte. Il
 * gateway non si fida di quel che il centro dice: guarda da sé che cosa cambierebbe e, se cambia
 * qualcosa, chiede il sì al proprietario lui stesso (un pulsante su Telegram che solo il gateway
 * può creare, o la pagina del vault). Senza quel sì non si installa nulla: il centro può proporre,
 * mai decidere.
 *
 * Con il sì, il gateway prepara la versione nuova accanto a quella in funzione e si spegne; il suo
 * guardiano scambia le cartelle, lo riavvia e, se la versione nuova non risponde, rimette quella
 * di prima. Dopo il riavvio il vault è chiuso: lo riapre il proprietario con la sua frase.
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { leggiInstallazione, scriviInstallazione } from "../guardiano/guardiano.ts";
import { preparaVersioneNuova, type ComandoDipendenze } from "../guardiano/versione-nuova.ts";
import {
  CARTELLE_DEL_GATEWAY,
  FILE_VERSIONE,
  inBreve,
  leggiFileDiVersione,
  percorsoDelGatewayValido,
  RIASSUNTO_DI_VERSIONE_MASSIMO,
  SI_ALLA_VERSIONE_MS,
  versioneDi,
  versioneValida,
  type AggiornamentoDelGateway as StatoAggiornamento,
  type EsitoProposta,
  type FileDiVersione,
} from "../protocollo/versione.ts";
import type { DomandeAlProprietario } from "./domande.ts";
import type { Registro } from "./registro.ts";
import type { Telegram } from "./telegram.ts";

/** Il gateway scarica le dipendenze senza eseguire ciò che i pacchetti vorrebbero eseguire all'installazione. */
const DIPENDENZE_DEL_GATEWAY: ComandoDipendenze = { comando: "npm ci --ignore-scripts", secondi: 900 };

/** Quanti nomi di file stanno nella domanda al proprietario: gli altri si contano. */
const FILE_NOMINATI = 12;

export interface OpzioniAggiornamentoDelGateway {
  /** La cartella della versione in funzione: il gateway gira da lì. */
  installata: string;
  /** Il file in cui il gateway e il suo guardiano si dicono a che punto è un'installazione. */
  fileInstallazione: string;
  /** Vero se il gateway è tenuto acceso dal suo guardiano: senza, una versione nuova si mette solo da fuori. */
  colGuardiano: boolean;
  domande: DomandeAlProprietario;
  telegram?: Telegram;
  registro: Registro;
  /** Spegne il gateway perché il guardiano lo riavvii con la versione nuova. */
  riavvia: () => void;
  /** Per quanto si aspetta il sì del proprietario. */
  attesaMs?: number;
  dipendenze?: ComandoDipendenze;
  /** Per quanto, all'avvio, si aspetta che il guardiano dica com'è finita l'installazione. */
  attesaEsitoMs?: number;
}

async function fileSotto(radice: string, relativa: string): Promise<string[]> {
  let voci;
  try {
    voci = await readdir(join(radice, relativa), { withFileTypes: true });
  } catch {
    return [];
  }
  const trovati: string[] = [];
  for (const voce of voci) {
    const percorso = `${relativa}/${voce.name}`;
    if (voce.isDirectory()) trovati.push(...(await fileSotto(radice, percorso)));
    else if (voce.isFile() && !voce.name.endsWith(".test.ts")) trovati.push(percorso);
  }
  return trovati;
}

/**
 * Che cosa cambierebbe nel gateway con quei file: quelli diversi o nuovi, e quelli che oggi ci
 * sono e nel pacchetto mancano. Il file che dice la versione non conta: è un'etichetta.
 */
export async function cheCosaCambia(installata: string, file: readonly FileDiVersione[]): Promise<string[]> {
  const cambiano: string[] = [];
  const nelPacchetto = new Set<string>();
  for (const uno of file) {
    nelPacchetto.add(uno.percorso);
    if (uno.percorso === FILE_VERSIONE) continue;
    let adesso: Buffer | undefined;
    try {
      adesso = await readFile(join(installata, ...uno.percorso.split("/")));
    } catch {
      adesso = undefined;
    }
    if (adesso === undefined || !adesso.equals(Buffer.from(uno.dati, "base64"))) cambiano.push(uno.percorso);
  }
  for (const cartella of CARTELLE_DEL_GATEWAY) {
    for (const percorso of await fileSotto(installata, cartella)) {
      if (!nelPacchetto.has(percorso)) cambiano.push(`${percorso} (tolto)`);
    }
  }
  return cambiano.sort();
}

export class AggiornamentoDelGateway {
  readonly #o: OpzioniAggiornamentoDelGateway;
  #stato: StatoAggiornamento | undefined;
  #versione: string | undefined;

  private constructor(opzioni: OpzioniAggiornamentoDelGateway, versione: string | undefined) {
    this.#o = opzioni;
    this.#versione = versione;
    // Una versione che non è partita resta da dire finché il centro non ne propone un'altra.
    const ultima = leggiInstallazione(opzioni.fileInstallazione);
    if (ultima?.fase === "tornata-indietro") {
      this.#stato = { stato: "non-riuscito", versione: ultima.versione, motivo: ultima.motivo ?? "non è partita" };
    }
  }

  static async apri(opzioni: OpzioniAggiornamentoDelGateway): Promise<AggiornamentoDelGateway> {
    return new AggiornamentoDelGateway(opzioni, await versioneDi(opzioni.installata));
  }

  /** La versione da cui il gateway gira; nulla se nella sua cartella non è scritta. */
  get versione(): string | undefined {
    return this.#versione;
  }

  get colGuardiano(): boolean {
    return this.#o.colGuardiano;
  }

  /** A che punto è l'ultima versione proposta dal centro, se c'è qualcosa da dirne. */
  get stato(): StatoAggiornamento | undefined {
    return this.#stato === undefined ? undefined : { ...this.#stato };
  }

  /**
   * Il centro propone una versione. Non lancia mai: l'esito dice se non c'è nulla da fare, se il
   * gateway ha chiesto il sì al proprietario, o perché la proposta non è stata accolta.
   */
  async proponi(proposta: { versione: unknown; riassunto: unknown; file: unknown }): Promise<EsitoProposta> {
    const { versione } = proposta;
    if (!versioneValida(versione)) return { esito: "rifiutato", motivo: "La versione proposta non è scritta come una versione." };
    const riassunto = typeof proposta.riassunto === "string" ? proposta.riassunto.trim().slice(0, RIASSUNTO_DI_VERSIONE_MASSIMO) : "";
    const file = leggiFileDiVersione(proposta.file);
    if (file === undefined || file.some((uno) => !percorsoDelGatewayValido(uno.percorso))) {
      return { esito: "rifiutato", motivo: "Il pacchetto contiene un file che nel gateway non può stare, oppure non si legge." };
    }
    if (this.#stato?.stato === "in-corso") {
      return { esito: "rifiutato", motivo: `Il gateway sta già installando la versione ${inBreve(this.#stato.versione)}.` };
    }
    if (this.#stato?.stato === "in-attesa") {
      return {
        esito: "rifiutato",
        motivo: `Il gateway sta già aspettando il sì del proprietario per la versione ${inBreve(this.#stato.versione)}: quando avrà deciso si potrà proporne un'altra.`,
      };
    }

    const cambiano = await cheCosaCambia(this.#o.installata, file);
    if (cambiano.length === 0) {
      // Il codice del gateway è già quello: cambia solo il nome della versione, e lo si aggiorna senza disturbare nessuno.
      this.#stato = undefined;
      if (this.#versione !== versione) {
        try {
          await writeFile(join(this.#o.installata, FILE_VERSIONE), `${JSON.stringify({ versione, preparataIl: new Date().toISOString() }, null, 2)}\n`);
          this.#versione = versione;
        } catch {
          // Se la cartella non si può scrivere resta il nome di prima: il codice è comunque quello.
        }
      }
      return { esito: "uguale" };
    }
    if (!this.#o.colGuardiano) {
      return {
        esito: "rifiutato",
        motivo: "Questo gateway non è tenuto acceso dal suo guardiano: una versione nuova la può mettere solo chi lavora da fuori, su richiesta del proprietario.",
      };
    }
    if (!this.#o.domande.cePosto) {
      return { esito: "rifiutato", motivo: "Il gateway ha già troppe domande aperte per il proprietario: prima deve rispondere a quelle." };
    }

    const nominati = cambiano.slice(0, FILE_NOMINATI).join("\n");
    const altri = cambiano.length > FILE_NOMINATI ? `\n… e altri ${cambiano.length - FILE_NOMINATI}.` : "";
    const fatta = this.#o.domande.chiedi({
      tipo: "versione",
      titolo: `Installare la versione ${inBreve(versione)} del gateway?`,
      testo:
        (this.#versione === undefined ? "" : `Ora è in funzione la ${inBreve(this.#versione)}.\n`) +
        `Cambiano ${cambiano.length === 1 ? "un file" : `${cambiano.length} file`}:\n${nominati}${altri}\n\n` +
        (riassunto === "" ? "" : `Il centro dice: «${riassunto}»\n\n`) +
        "Se dici di sì il gateway si riavvia: il vault si chiude e va riaperto con la tua frase. " +
        "Se la versione nuova non parte, torna da sola quella di prima.",
      si: "Installa",
      attesaMs: this.#o.attesaMs ?? SI_ALLA_VERSIONE_MS,
    });
    this.#stato = { stato: "in-attesa", versione, scadeIl: fatta.scadeIl };
    void fatta.decisa.then(async (risposta) => {
      if (risposta !== "approvata") {
        this.#stato = { stato: risposta === "negata" ? "negato" : "scaduto", versione };
        return;
      }
      await this.#installa(versione, riassunto, file);
    });
    return { esito: "da-approvare", scadeIl: fatta.scadeIl, cambiano };
  }

  async #installa(versione: string, riassunto: string, file: FileDiVersione[]): Promise<void> {
    const breve = inBreve(versione);
    this.#stato = { stato: "in-corso", versione };
    const esito = await preparaVersioneNuova({
      installata: this.#o.installata,
      fileInstallazione: this.#o.fileInstallazione,
      versione,
      file,
      riassunto: riassunto === "" ? "Aggiornamento del gateway alla versione del centro." : riassunto,
      percorsoValido: percorsoDelGatewayValido,
      // Per il gateway conta il contenuto: lo stesso nome può arrivare di nuovo dopo un'installazione non riuscita.
      ancheLaStessa: true,
      dipendenze: this.#o.dipendenze ?? DIPENDENZE_DEL_GATEWAY,
    });
    const annota = (esitoVoce: "eseguito" | "fallito", motivo?: string): Promise<void> =>
      this.#o.registro
        .annota({
          quando: new Date().toISOString(),
          credenziale: "",
          host: "gateway",
          conversazione: "",
          comando: `Installazione della versione ${breve} del gateway, con il sì del proprietario dato al gateway.`,
          esito: esitoVoce,
          ...(motivo === undefined ? {} : { motivo }),
        })
        .catch(() => {});
    if (!esito.pronta) {
      this.#stato = { stato: "non-riuscito", versione, motivo: esito.motivo };
      await annota("fallito", esito.motivo.slice(0, 500));
      await this.#o.telegram?.invia({ testo: `La versione ${breve} del gateway non si è potuta preparare: resta in funzione quella di prima.\n\n${esito.motivo.slice(0, 1500)}` }, true);
      return;
    }
    await annota("eseguito");
    await this.#o.telegram?.invia({ testo: `Installo la versione ${breve} del gateway: mi riavvio, e tra poco ti dico com'è andata.` }, true);
    this.#o.riavvia();
  }

  /**
   * All'avvio: se il gateway è appena ripartito dopo un'installazione, dice al proprietario com'è
   * finita, su Telegram. Lo dice una volta sola.
   */
  async riferisci(): Promise<void> {
    const { fileInstallazione } = this.#o;
    let ultima = leggiInstallazione(fileInstallazione);
    if (ultima === undefined || ultima.riferita === true || ultima.fase === "da-installare") return;
    // Il guardiano conferma la versione nuova qualche istante dopo che ha cominciato a rispondere.
    const entro = Date.now() + (this.#o.attesaEsitoMs ?? 60_000);
    while (ultima.fase === "in-prova" && Date.now() < entro) {
      await new Promise((fatto) => setTimeout(fatto, 500).unref());
      ultima = leggiInstallazione(fileInstallazione) ?? ultima;
    }
    if (ultima.fase === "in-prova") return;
    const breve = inBreve(ultima.versione);
    const testo =
      ultima.fase === "confermata"
        ? `Il gateway è passato alla versione ${breve}. Il vault è chiuso: riaprilo con la tua frase dalla pagina del vault.`
        : `La versione ${breve} del gateway non è partita (${ultima.motivo ?? "non ha risposto"}): è tornata quella di prima. ` +
          "Il vault è chiuso: riaprilo con la tua frase dalla pagina del vault.";
    if (ultima.fase === "tornata-indietro") {
      this.#stato = { stato: "non-riuscito", versione: ultima.versione, motivo: ultima.motivo ?? "non è partita" };
    }
    await this.#o.telegram?.invia({ testo }, true);
    await scriviInstallazione(fileInstallazione, { ...ultima, riferita: true }).catch(() => {});
  }
}
