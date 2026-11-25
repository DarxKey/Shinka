/**
 * L'operazione che il gateway offre con le credenziali: eseguire un comando su un host.
 * Ogni richiesta viene verificata qui, nel momento in cui si esegue, qualunque cosa abbia
 * detto il modello: il divieto fisso, il vault aperto, la credenziale prevista per quell'host.
 * Ogni richiesta finisce nel registro, anche quella rifiutata.
 *
 * Su un host per gli stack di prova un comando libero tocca i servizi del proprietario: il
 * gateway lo tiene da parte, e lo esegue com'è soltanto quando arriva la sua approvazione.
 */

import { randomBytes } from "node:crypto";
import {
  APPROVAZIONE_MS,
  APPROVAZIONI_IN_ATTESA,
  COMANDO_SU_HOST_MASSIMO,
  SECONDI_COMANDO_SU_HOST,
  SECONDI_COMANDO_SU_HOST_MASSIMI,
  type DecisioneApprovazione,
  type EsitoAttesa,
  type EsitoUso,
  type RichiestaUso,
  type UsoDelegato,
  type VoceRegistro,
} from "../protocollo/vault.ts";
import { divietoFisso } from "./divieti.ts";
import type { DomandeAlProprietario } from "./domande.ts";
import type { Registro } from "./registro.ts";
import { ErroreSsh, eseguiSuHost } from "./ssh.ts";
import { UsoRifiutato, VaultChiuso, type CredenzialePerUso, type Vault } from "./vault.ts";

/** Ciò che prende il posto del valore di una credenziale, se compare in un testo che esce dal gateway. */
export const AL_POSTO_DEL_VALORE = "[credenziale del vault]";

/** I testi che non devono uscire dal gateway: il valore, la frase della chiave, le righe della chiave. */
export function daNascondere(credenziale: CredenzialePerUso): string[] {
  // Il valore di una credenziale in chiaro Claude lo può già leggere: nasconderlo confonderebbe l'uscita.
  if (credenziale.inChiaro === true) return [];
  const valori = [credenziale.fraseDellaChiave ?? ""];
  if (credenziale.tipo === "password") valori.push(credenziale.segreto);
  else valori.push(...credenziale.segreto.split("\n").filter((riga) => !riga.startsWith("-----")));
  // Un testo cortissimo non si nasconde: toglierlo ovunque rovinerebbe l'uscita senza proteggere nulla.
  return valori.map((valore) => valore.trim()).filter((valore) => valore.length >= 4);
}

export function nascondi(testo: string, valori: readonly string[]): string {
  let pulito = testo;
  for (const valore of valori) pulito = pulito.split(valore).join(AL_POSTO_DEL_VALORE);
  return pulito;
}

/** Un comando che aspetta l'approvazione del proprietario: si esegue com'è scritto qui, o non si esegue. */
interface InAttesa {
  richiesta: RichiestaUso;
  secondi: number;
  scade: number;
  /** Manca quando il tempo lo tiene la domanda che il gateway ha fatto al proprietario. */
  timer?: NodeJS.Timeout;
  /** Vero se il sì lo raccoglie il gateway: il centro non lo può dare. */
  alGateway?: true;
}

/** Per quanto il gateway ricorda com'è finito un comando che aspettava il sì dato a lui. */
const ESITO_TENUTO_MS = 10 * 60 * 1000;

/**
 * Per quanto il gateway ricorda di non aver raggiunto un host che un ambiente raggiunge (ADR 0062):
 * intanto i comandi lì passano subito dal nodo, senza aspettare un altro collegamento che non arriva.
 */
const NON_RAGGIUNTO_MS = 30 * 60 * 1000;

export class Operazioni {
  readonly #vault: Vault;
  readonly #registro: Registro;
  readonly #inAttesa = new Map<string, InAttesa>();
  readonly #attesaMs: number;
  readonly #domande: DomandeAlProprietario | undefined;
  /** Come finiscono i comandi che aspettano il sì dato al gateway: il centro lo viene a chiedere. */
  readonly #esiti = new Map<string, { esito: Promise<EsitoUso>; decisa: Promise<unknown>; decisione?: DecisioneApprovazione }>();
  /** Gli host che il gateway non ha raggiunto, fino a quando lo si ricorda. */
  readonly #nonRaggiunti = new Map<string, number>();

  /** Come si esegue un comando sull'host: nei test se ne mette uno che non lo raggiunge. */
  readonly #suHost: typeof eseguiSuHost;

  constructor(vault: Vault, registro: Registro, attesaMs: number = APPROVAZIONE_MS, domande?: DomandeAlProprietario, suHost: typeof eseguiSuHost = eseguiSuHost) {
    this.#suHost = suHost;
    this.#vault = vault;
    this.#registro = registro;
    this.#attesaMs = attesaMs;
    this.#domande = domande;
  }

  /**
   * Esegue un comando su un host con una credenziale del vault, oppure lo tiene da parte in
   * attesa dell'approvazione. Non lancia mai: l'esito dice com'è andata.
   */
  async usa(richiesta: RichiestaUso): Promise<EsitoUso> {
    const comando = richiesta.comando;
    if (comando.trim() === "" || comando.length > COMANDO_SU_HOST_MASSIMO) {
      return this.#rifiuta(richiesta, "Il comando manca, oppure è troppo lungo.", comando.slice(0, 500));
    }
    const vietato = divietoFisso(comando);
    if (vietato !== undefined) {
      return this.#rifiuta(
        richiesta,
        `Divieto fisso: ${vietato} non si fa con una credenziale del vault, nemmeno con l'approvazione del proprietario e nemmeno senza permessi. Dillo al proprietario: se serve, lo fa lui.`,
        comando,
      );
    }

    let credenziale: CredenzialePerUso;
    try {
      credenziale = this.#vault.perUso(richiesta.credenziale, richiesta.host);
    } catch (errore) {
      if (errore instanceof VaultChiuso || errore instanceof UsoRifiutato) return this.#rifiuta(richiesta, errore.message, comando);
      throw errore;
    }
    const secondi = Math.min(Math.max(richiesta.secondi ?? SECONDI_COMANDO_SU_HOST, 1), SECONDI_COMANDO_SU_HOST_MASSIMI);

    const alGateway = this.#vault.chiedeIlSiAlGateway(credenziale.nome, richiesta.host);
    if (alGateway || this.#vault.chiedeApprovazione(credenziale.nome, richiesta.host)) {
      if (this.#inAttesa.size >= APPROVAZIONI_IN_ATTESA || (alGateway && this.#domande?.cePosto === false)) {
        return this.#rifiuta(
          richiesta,
          "Ci sono già troppi comandi in attesa dell'approvazione del proprietario: aspetta che decida su quelli.",
          nascondi(comando, daNascondere(credenziale)),
        );
      }
      if (alGateway) return this.#chiediAlGateway(richiesta, credenziale, secondi);
      const approvazione = randomBytes(16).toString("base64url");
      const scade = Date.now() + this.#attesaMs;
      const timer = setTimeout(() => void this.decidi(approvazione, "scaduta"), this.#attesaMs);
      timer.unref();
      this.#inAttesa.set(approvazione, { richiesta: { ...richiesta, credenziale: credenziale.nome }, secondi, scade, timer });
      return { esito: "da-approvare", approvazione, scadeIl: new Date(scade).toISOString() };
    }
    // Un host che il gateway di recente non ha raggiunto, se un ambiente ha la credenziale, passa subito da lì.
    const ambienti = this.#vault.ambientiDi(credenziale.nome);
    if (ambienti.length > 0 && (this.#nonRaggiunti.get(this.#chiaveHost(richiesta)) ?? 0) > Date.now()) return this.#daDelegare(ambienti);
    return this.#esegui(richiesta, credenziale, secondi);
  }

  #chiaveHost(richiesta: RichiestaUso): string {
    return `${richiesta.credenziale.trim().toLowerCase()} ${richiesta.host.trim().toLowerCase()}`;
  }

  #daDelegare(ambienti: readonly { id: string; nome: string }[]): EsitoUso {
    return {
      esito: "da-delegare",
      ambienti: ambienti.map((uno) => uno.id),
      motivo: `Il gateway non raggiunge l'host: il comando passa dal nodo di ${ambienti.map((uno) => `«${uno.nome}»`).join(" o ")}, a cui il proprietario ha dato questa credenziale.`,
    };
  }

  /**
   * Il centro riferisce un comando che il nodo di un ambiente ha eseguito al posto del gateway (ADR
   * 0062): finisce nel registro come gli altri, e l'impronta dell'host si ricorda se era la prima volta.
   * Vale solo per un ambiente a cui la credenziale è data.
   */
  async delegato(uso: UsoDelegato): Promise<{ annotato: boolean }> {
    const ambiente = this.#vault.ambientiDi(uso.credenziale).find((uno) => uno.nome === uso.ambiente || uno.id === uso.ambiente);
    if (ambiente === undefined) return { annotato: false };
    const richiesta: RichiestaUso = { credenziale: uso.credenziale, host: uso.host, comando: uso.comando, conversazione: uso.conversazione };
    const motivo = [`Passato dal nodo di «${ambiente.nome}».`, uso.motivo].filter((parte) => parte !== undefined && parte !== "").join(" ");
    await this.#annota({
      ...this.#base(richiesta),
      comando: nascondi(uso.comando.slice(0, COMANDO_SU_HOST_MASSIMO), this.#vault.valoriDaNascondere()),
      esito: uso.esito,
      motivo,
      ...(uso.codice === undefined ? {} : { codice: uso.codice }),
      ...(uso.durataMs === undefined ? {} : { durataMs: uso.durataMs }),
    });
    if (uso.esito === "eseguito" && uso.impronta !== undefined) await this.#vault.annotaUso(uso.credenziale.trim().toLowerCase(), uso.host, uso.impronta);
    return { annotato: true };
  }

  /**
   * Un comando sul server di Shinka: il gateway lo tiene da parte e chiede il sì al proprietario
   * lui stesso. Il centro riceve soltanto il nome dell'attesa, con cui venire a chiedere com'è finita.
   */
  async #chiediAlGateway(richiesta: RichiestaUso, credenziale: CredenzialePerUso, secondi: number): Promise<EsitoUso> {
    const scritto = nascondi(richiesta.comando, daNascondere(credenziale));
    if (this.#domande === undefined) {
      return this.#rifiuta(richiesta, "Questo gateway non sa chiedere il sì al proprietario: il comando non è stato eseguito.", scritto);
    }
    const fatta = this.#domande.chiedi({
      tipo: "comando",
      titolo: `Eseguire questo comando su ${richiesta.host}?`,
      testo:
        `Con la credenziale "${credenziale.nome}", che è quella del server: chi comanda lì può tutto.\n` +
        `Lo chiede la conversazione ${richiesta.conversazione.slice(0, 200)}.\n\n${scritto}`,
      si: "Esegui",
      attesaMs: this.#attesaMs,
    });
    const approvazione = fatta.id;
    this.#inAttesa.set(approvazione, {
      richiesta: { ...richiesta, credenziale: credenziale.nome },
      secondi,
      scade: Date.parse(fatta.scadeIl),
      alGateway: true,
    });
    const voce: { esito: Promise<EsitoUso>; decisa: Promise<unknown>; decisione?: DecisioneApprovazione } = {
      decisa: fatta.decisa,
      esito: fatta.decisa.then((risposta) => {
        voce.decisione = risposta;
        return this.#decisa(approvazione, risposta, "Approvato dal proprietario, con il sì dato al gateway.");
      }),
    };
    const { esito } = voce;
    this.#esiti.set(approvazione, voce);
    void esito.finally(() => setTimeout(() => this.#esiti.delete(approvazione), ESITO_TENUTO_MS).unref());
    return { esito: "da-approvare", approvazione, scadeIl: fatta.scadeIl, alGateway: true };
  }

  /**
   * Com'è finito un comando che aspettava il sì dato al gateway. Se non è ancora finito aspetta
   * fino a `attesaMs`, e poi dice che è ancora in attesa; risponde prima se nel frattempo il
   * proprietario decide, perché chi chiede lo sappia subito anche quando il comando dura.
   */
  async attendi(approvazione: string, attesaMs: number): Promise<EsitoAttesa> {
    const voce = this.#esiti.get(approvazione);
    if (voce === undefined) {
      return { esito: "rifiutato", motivo: "Questa approvazione non c'è più: è scaduta da tempo, oppure non era di quelle che il gateway chiede da sé." };
    }
    const scadeIl = new Date(this.#inAttesa.get(approvazione)?.scade ?? Date.now()).toISOString();
    const giaDecisa = voce.decisione !== undefined;
    let timer: NodeJS.Timeout | undefined;
    const ancora = new Promise<EsitoUso>((fatto) => {
      const inAttesa = (): void => fatto({ esito: "da-approvare", approvazione, scadeIl, alGateway: true });
      timer = setTimeout(inAttesa, Math.max(attesaMs, 0));
      timer.unref();
      if (!giaDecisa) void voce.decisa.then(() => setImmediate(inAttesa));
    });
    try {
      const esito = await Promise.race([voce.esito, ancora]);
      return voce.decisione === undefined ? esito : { ...esito, decisione: voce.decisione };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Il centro riferisce che il proprietario ha deciso di un comando in attesa, oppure che il
   * tempo è finito. Approvato, il comando si esegue com'era stato chiesto; un'approvazione vale
   * una volta sola. Dove il sì lo raccoglie il gateway, il centro può soltanto ritirare la richiesta.
   */
  async decidi(approvazione: string, decisione: DecisioneApprovazione): Promise<EsitoUso> {
    const attesa = this.#inAttesa.get(approvazione);
    if (attesa?.alGateway === true) {
      if (decisione === "approvata") {
        return {
          esito: "rifiutato",
          motivo: "Questo sì lo può dare solo il proprietario, al gateway: su Telegram, con il pulsante che gli ha mandato il gateway, o nella pagina del vault.",
        };
      }
      this.#domande?.decidi(approvazione, "negata", "centro");
      // Un no non esegue nulla: l'esito arriva subito, e chi ritira lo riceve per intero.
      const voce = this.#esiti.get(approvazione);
      return voce === undefined ? { esito: "rifiutato", motivo: "Questa approvazione non c'è più: è scaduta, oppure è già stata usata." } : voce.esito;
    }
    return this.#decisa(approvazione, decisione, "Approvato dal proprietario.");
  }

  async #decisa(approvazione: string, decisione: DecisioneApprovazione, nota: string): Promise<EsitoUso> {
    const attesa = this.#inAttesa.get(approvazione);
    if (attesa === undefined) {
      return { esito: "rifiutato", motivo: "Questa approvazione non c'è più: è scaduta, oppure è già stata usata." };
    }
    this.#inAttesa.delete(approvazione);
    clearTimeout(attesa.timer);
    const { richiesta } = attesa;
    const scaduta = decisione === "scaduta" || Date.now() > attesa.scade;
    if (scaduta || decisione !== "approvata") {
      return this.#rifiuta(
        richiesta,
        scaduta
          ? "L'approvazione del proprietario non è arrivata in tempo: il comando non è stato eseguito."
          : "Il proprietario ha negato l'approvazione: il comando non è stato eseguito.",
        this.#scritto(richiesta),
      );
    }
    // Tra la richiesta e l'approvazione il vault può essere stato chiuso, o la credenziale cambiata.
    let credenziale: CredenzialePerUso;
    try {
      credenziale = this.#vault.perUso(richiesta.credenziale, richiesta.host);
    } catch (errore) {
      if (errore instanceof VaultChiuso || errore instanceof UsoRifiutato) return this.#rifiuta(richiesta, errore.message, richiesta.comando.slice(0, 500));
      throw errore;
    }
    return this.#esegui(richiesta, credenziale, attesa.secondi, nota);
  }

  /** Il comando com'è scritto nel registro: senza i valori della credenziale, se il vault è aperto. */
  #scritto(richiesta: RichiestaUso): string {
    try {
      return nascondi(richiesta.comando, daNascondere(this.#vault.perUso(richiesta.credenziale, richiesta.host)));
    } catch {
      return nascondi(richiesta.comando, this.#vault.valoriDaNascondere());
    }
  }

  async #esegui(richiesta: RichiestaUso, credenziale: CredenzialePerUso, secondi: number, nota?: string): Promise<EsitoUso> {
    const valori = daNascondere(credenziale);
    const scritto = nascondi(richiesta.comando, valori);
    try {
      const eseguito = await this.#suHost(credenziale, richiesta.comando, secondi * 1000);
      await this.#vault.annotaUso(credenziale.nome, richiesta.host, eseguito.impronta);
      const motivo = [nota, eseguito.scaduto ? `Fermato dopo ${secondi} secondi.` : undefined].filter((parte) => parte !== undefined).join(" ");
      await this.#annota({
        ...this.#base(richiesta),
        credenziale: credenziale.nome,
        comando: scritto,
        esito: "eseguito",
        codice: eseguito.codice,
        durataMs: eseguito.durataMs,
        ...(motivo === "" ? {} : { motivo }),
      });
      return {
        esito: "eseguito",
        codice: eseguito.codice,
        uscita: nascondi(eseguito.uscita, valori),
        errori: nascondi(eseguito.errori, valori),
        scaduto: eseguito.scaduto,
        durataMs: eseguito.durataMs,
      };
    } catch (errore) {
      const motivo =
        errore instanceof ErroreSsh
          ? errore.message
          : `Il comando non è stato eseguito: ${errore instanceof Error ? errore.message : String(errore)}`;
      // Un host che il gateway non raggiunge, se un ambiente ha la credenziale, passa dal suo nodo (ADR 0062).
      const ambienti = this.#vault.ambientiDi(credenziale.nome);
      if (errore instanceof ErroreSsh && errore.causaSsh === "collegamento" && ambienti.length > 0) {
        this.#nonRaggiunti.set(this.#chiaveHost(richiesta), Date.now() + NON_RAGGIUNTO_MS);
        return this.#daDelegare(ambienti);
      }
      // Un host che si presenta con un'altra chiave è un rifiuto del gateway; il resto è un collegamento non riuscito.
      const esito = errore instanceof ErroreSsh && errore.causaSsh === "impronta" ? "rifiutato" : "fallito";
      return this.#rifiuta(richiesta, nascondi(motivo, valori), scritto, esito);
    }
  }

  #base(richiesta: RichiestaUso): Pick<VoceRegistro, "quando" | "credenziale" | "host" | "conversazione"> {
    return {
      quando: new Date().toISOString(),
      credenziale: richiesta.credenziale.slice(0, 100),
      host: richiesta.host.slice(0, 200),
      conversazione: richiesta.conversazione.slice(0, 200),
    };
  }

  async #rifiuta(richiesta: RichiestaUso, motivo: string, comando: string, esito: "rifiutato" | "fallito" = "rifiutato"): Promise<EsitoUso> {
    await this.#annota({ ...this.#base(richiesta), comando, esito, motivo });
    return { esito, motivo };
  }

  async #annota(voce: VoceRegistro): Promise<void> {
    try {
      await this.#registro.annota(voce);
    } catch (errore) {
      // Il registro che non si scrive non deve far credere a Claude che il comando non sia partito:
      // l'esito torna com'è, e il guasto resta nell'uscita del gateway.
      console.error(`Registro non scritto (${voce.quando}, ${voce.esito}): ${errore instanceof Error ? errore.message : String(errore)}`);
    }
  }
}
