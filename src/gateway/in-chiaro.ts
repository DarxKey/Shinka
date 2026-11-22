/**
 * Le credenziali in chiaro (ADR 0034): di prova o a basso rischio, scelte così dal proprietario.
 * Claude ne legge il valore per un host o un sito in cui valgono, e ne propone di nuove, per
 * esempio una password che ha generato per un laboratorio. Una proposta il gateway la tiene da
 * parte, com'è scritta: entra nel vault solo se il proprietario la approva dalla scheda nella
 * conversazione, e il centro può riferire soltanto il sì o il no. Ogni lettura e ogni proposta
 * finiscono nel registro, senza il valore.
 */

import { randomBytes } from "node:crypto";
import {
  APPROVAZIONE_MS,
  APPROVAZIONI_IN_ATTESA,
  TIPI_IN_CHIARO,
  type DecisioneApprovazione,
  type EsitoInChiaro,
  type EsitoLettura,
  type RichiestaInChiaro,
  type RichiestaLettura,
  type TipoInChiaro,
  type VoceRegistro,
} from "../protocollo/vault.ts";
import type { Registro } from "./registro.ts";
import { CredenzialeRifiutata, UsoRifiutato, VaultChiuso, type CredenzialeDaCustodire, type Vault } from "./vault.ts";

interface PropostaInAttesa {
  richiesta: RichiestaInChiaro;
  scade: number;
  timer: NodeJS.Timeout;
}

export class CredenzialiInChiaro {
  readonly #vault: Vault;
  readonly #registro: Registro;
  readonly #attesaMs: number;
  readonly #inAttesa = new Map<string, PropostaInAttesa>();

  constructor(vault: Vault, registro: Registro, attesaMs: number = APPROVAZIONE_MS) {
    this.#vault = vault;
    this.#registro = registro;
    this.#attesaMs = attesaMs;
  }

  /** Il valore di una credenziale in chiaro, per un host o un sito in cui vale. Non lancia mai. */
  async leggi(richiesta: RichiestaLettura): Promise<EsitoLettura> {
    const base = { credenziale: richiesta.credenziale.slice(0, 100), host: richiesta.dove.slice(0, 200), conversazione: richiesta.conversazione.slice(0, 200) };
    try {
      const letta = this.#vault.perLettura(richiesta.credenziale, richiesta.dove);
      await this.#vault.annotaLettura(letta.nome);
      await this.#annota({ ...base, credenziale: letta.nome, comando: "Lettura del valore di una credenziale in chiaro", esito: "eseguito" });
      if (!(TIPI_IN_CHIARO as readonly string[]).includes(letta.tipo)) return { esito: "rifiutato", motivo: "Questa credenziale non si legge." };
      return {
        esito: "letta",
        nome: letta.nome,
        tipo: letta.tipo as TipoInChiaro,
        utente: letta.utente,
        segreto: letta.segreto,
        ...(letta.fraseDellaChiave === undefined ? {} : { fraseDellaChiave: letta.fraseDellaChiave }),
        host: [...letta.host],
      };
    } catch (errore) {
      if (!(errore instanceof VaultChiuso || errore instanceof UsoRifiutato)) throw errore;
      await this.#annota({ ...base, comando: "Lettura del valore di una credenziale", esito: "rifiutato", motivo: errore.message });
      return { esito: "rifiutato", motivo: errore.message };
    }
  }

  /**
   * Claude propone una credenziale in chiaro: il gateway la controlla e la tiene da parte finché
   * il proprietario non decide. Non lancia mai: l'esito dice com'è andata.
   */
  async proponi(richiesta: RichiestaInChiaro): Promise<EsitoInChiaro> {
    const dove = richiesta.host.join(", ").slice(0, 200);
    const base = { credenziale: richiesta.nome.slice(0, 100), host: dove, conversazione: richiesta.conversazione.slice(0, 200) };
    const comando = "Proposta di una credenziale in chiaro";
    if (!(TIPI_IN_CHIARO as readonly string[]).includes(richiesta.tipo)) {
      return this.#rifiuta(base, comando, "Una credenziale in chiaro è una password, una chiave SSH o l'accesso a un sito.");
    }
    if (this.#inAttesa.size >= APPROVAZIONI_IN_ATTESA) {
      return this.#rifiuta(base, comando, "Ci sono già troppe richieste in attesa del proprietario: aspetta che decida su quelle.");
    }
    if ([...this.#inAttesa.values()].some((attesa) => attesa.richiesta.nome.trim().toLowerCase() === richiesta.nome.trim().toLowerCase())) {
      return this.#rifiuta(base, comando, `Una credenziale di nome "${richiesta.nome}" aspetta già la decisione del proprietario.`);
    }
    let vista;
    try {
      vista = this.#vault.valutaInChiaro(this.#daCustodire(richiesta));
    } catch (errore) {
      if (errore instanceof VaultChiuso || errore instanceof CredenzialeRifiutata) return this.#rifiuta(base, comando, errore.message);
      throw errore;
    }
    const approvazione = randomBytes(16).toString("base64url");
    const scade = Date.now() + this.#attesaMs;
    const timer = setTimeout(() => void this.decidi(approvazione, "scaduta"), this.#attesaMs);
    timer.unref();
    this.#inAttesa.set(approvazione, { richiesta, scade, timer });
    return { esito: "da-approvare", approvazione, scadeIl: new Date(scade).toISOString(), credenziale: vista };
  }

  /** Il centro riferisce la decisione del proprietario: approvata, la credenziale entra nel vault com'era stata proposta. */
  async decidi(approvazione: string, decisione: DecisioneApprovazione): Promise<EsitoInChiaro> {
    const attesa = this.#inAttesa.get(approvazione);
    if (attesa === undefined) return { esito: "rifiutato", motivo: "Questa proposta non c'è più: è scaduta, oppure è già stata decisa." };
    this.#inAttesa.delete(approvazione);
    clearTimeout(attesa.timer);
    const { richiesta } = attesa;
    const base = { credenziale: richiesta.nome.slice(0, 100), host: richiesta.host.join(", ").slice(0, 200), conversazione: richiesta.conversazione.slice(0, 200) };
    const comando = "Salvataggio di una credenziale in chiaro proposta da Claude";
    const scaduta = decisione === "scaduta" || Date.now() > attesa.scade;
    if (scaduta || decisione !== "approvata") {
      return this.#rifiuta(
        base,
        comando,
        scaduta ? "Il proprietario non ha deciso in tempo: la credenziale non è stata salvata." : "Il proprietario non l'ha approvata: la credenziale non è stata salvata.",
      );
    }
    try {
      const salvata = await this.#vault.inserisci(this.#daCustodire(richiesta));
      await this.#annota({ ...base, comando, esito: "eseguito", motivo: "Approvata dal proprietario." });
      return { esito: "salvata", credenziale: salvata };
    } catch (errore) {
      // Tra la proposta e il sì il vault può essersi chiuso, o il nome essere stato preso.
      if (errore instanceof VaultChiuso || errore instanceof CredenzialeRifiutata) return this.#rifiuta(base, comando, errore.message);
      throw errore;
    }
  }

  #daCustodire(richiesta: RichiestaInChiaro): CredenzialeDaCustodire {
    return {
      nome: richiesta.nome,
      tipo: richiesta.tipo,
      utente: richiesta.utente,
      host: richiesta.host,
      segreto: richiesta.segreto,
      ...(richiesta.fraseDellaChiave === undefined ? {} : { fraseDellaChiave: richiesta.fraseDellaChiave }),
      inChiaro: true,
    };
  }

  async #rifiuta(base: Pick<VoceRegistro, "credenziale" | "host" | "conversazione">, comando: string, motivo: string): Promise<EsitoInChiaro> {
    await this.#annota({ ...base, comando, esito: "rifiutato", motivo });
    return { esito: "rifiutato", motivo };
  }

  async #annota(voce: Omit<VoceRegistro, "quando">): Promise<void> {
    try {
      await this.#registro.annota({ quando: new Date().toISOString(), ...voce });
    } catch (errore) {
      console.error(`Registro non scritto (${voce.esito}): ${errore instanceof Error ? errore.message : String(errore)}`);
    }
  }
}
