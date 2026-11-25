/**
 * Le credenziali per SSH che il proprietario dà a un ambiente (ADR 0062), viste dal centro. Il centro
 * le passa senza poterle leggere:
 * - dice al gateway quali ambienti collegati hanno una chiave per riceverle;
 * - quando un nodo si collega, quando il vault si apre e a ogni giro, chiede al gateway quelle di
 *   ciascun ambiente, in un sigillo per la chiave del suo nodo, e gliele manda;
 * - quando il vault si chiude, dice ai nodi di dimenticarle;
 * - un comando che il gateway non riesce a eseguire perché non raggiunge l'host lo manda al nodo di
 *   un ambiente che ha la credenziale, e riferisce l'esito al gateway per il registro.
 */

import { randomUUID } from "node:crypto";
import type { EsitoSuHost } from "../protocollo/nodi.ts";
import type { EsitoUso, RichiestaUso } from "../protocollo/vault.ts";
import type { RegistroAmbienti } from "./ambienti.ts";
import type { PortaGateway } from "./gateway.ts";

/** Ogni quanto si ridicono al gateway gli ambienti e si riconsegnano le credenziali. */
const GIRO_MS = 2 * 60 * 1000;
/** Quanto si aspetta il nodo oltre la durata del comando: il collegamento all'host, e la risposta. */
const MARGINE_MS = 60_000;

export interface OpzioniCredenzialiNegliAmbienti {
  ambienti: Pick<RegistroAmbienti, "perIlVault" | "inviaAlNodo" | "attivo" | "stato" | "iscrivi" | "iscriviCollegamenti" | "iscriviScollegamenti" | "iscriviRiferiti">;
  gateway: Pick<PortaGateway, "stato" | "ambientiPerIlVault" | "delega" | "usoDelegato">;
  giroMs?: number;
}

interface InAttesa {
  idAmbiente: string;
  risolvi(esito: EsitoSuHost): void;
  scadenza: NodeJS.Timeout;
}

export class CredenzialiNegliAmbienti {
  readonly #o: OpzioniCredenzialiNegliAmbienti;
  readonly #inAttesa = new Map<string, InAttesa>();
  /** Gli ambienti a cui il centro ha mandato credenziali: a vault chiuso vanno fatte dimenticare. */
  readonly #consegnate = new Set<string>();
  #timer: NodeJS.Timeout | undefined;
  #ambientiDetti = "";

  constructor(opzioni: OpzioniCredenzialiNegliAmbienti) {
    this.#o = opzioni;
    opzioni.ambienti.iscriviRiferiti((idNodo, messaggio) => {
      if (messaggio.tipo !== "esito-su-host") return;
      const attesa = this.#inAttesa.get(messaggio.idRichiesta);
      if (attesa === undefined || attesa.idAmbiente !== idNodo) return;
      this.#inAttesa.delete(messaggio.idRichiesta);
      clearTimeout(attesa.scadenza);
      attesa.risolvi(messaggio.esito);
    });
    opzioni.ambienti.iscriviScollegamenti((idNodo) => {
      this.#consegnate.delete(idNodo);
      for (const [id, attesa] of this.#inAttesa) {
        if (attesa.idAmbiente !== idNodo) continue;
        this.#inAttesa.delete(id);
        clearTimeout(attesa.scadenza);
        attesa.risolvi({ esito: "fallito", motivo: "Il nodo si è scollegato prima di dire com'è finito il comando: non è detto che non sia stato eseguito." });
      }
    });
    opzioni.ambienti.iscriviCollegamenti((idNodo) => void this.#consegna(idNodo));
    opzioni.ambienti.iscrivi(() => void this.#diciAmbienti());
  }

  /** Comincia i giri: subito, e poi ogni pochi minuti. */
  avvia(): void {
    const giro = (): void => {
      void this.giro().finally(() => {
        this.#timer = setTimeout(giro, this.#o.giroMs ?? GIRO_MS);
        this.#timer.unref();
      });
    };
    giro();
  }

  chiudi(): void {
    clearTimeout(this.#timer);
  }

  /** Un giro: gli ambienti al gateway, e le credenziali ai nodi, o il loro oblio se il vault è chiuso. */
  async giro(): Promise<void> {
    await this.#diciAmbienti(true);
    const aperto = (await this.#o.gateway.stato().catch(() => undefined))?.condizione === "aperto";
    if (!aperto) {
      this.#dimenticaTutto();
      return;
    }
    for (const { id } of this.#o.ambienti.perIlVault()) await this.#consegna(id);
  }

  async #diciAmbienti(sempre = false): Promise<void> {
    const ambienti = this.#o.ambienti.perIlVault();
    const detti = JSON.stringify(ambienti);
    if (!sempre && detti === this.#ambientiDetti) return;
    this.#ambientiDetti = detti;
    await this.#o.gateway.ambientiPerIlVault?.(ambienti);
  }

  /** Chiede al gateway le credenziali dell'ambiente e le manda al suo nodo; senza, gli fa dimenticare quelle di prima. */
  async #consegna(idAmbiente: string): Promise<void> {
    const ambiente = this.#o.ambienti.perIlVault().find((uno) => uno.id === idAmbiente);
    if (ambiente === undefined || this.#o.gateway.delega === undefined) return;
    await this.#diciAmbienti();
    const esito = await this.#o.gateway.delega(idAmbiente, ambiente.chiave);
    if ("motivo" in esito || esito.sigillo === undefined) {
      if (this.#consegnate.delete(idAmbiente)) this.#o.ambienti.inviaAlNodo(idAmbiente, { tipo: "dimentica-credenziali" });
      return;
    }
    if (this.#o.ambienti.inviaAlNodo(idAmbiente, { tipo: "credenziali", sigillo: esito.sigillo })) this.#consegnate.add(idAmbiente);
  }

  #dimenticaTutto(): void {
    for (const idAmbiente of this.#consegnate) this.#o.ambienti.inviaAlNodo(idAmbiente, { tipo: "dimentica-credenziali" });
    this.#consegnate.clear();
  }

  /**
   * Il gateway non raggiunge l'host: il comando lo esegue il nodo del primo degli ambienti indicati
   * che è collegato. L'esito va al gateway per il registro, e torna come se lo avesse eseguito lui.
   */
  async esegui(ambienti: readonly string[], richiesta: RichiestaUso & { secondi: number }): Promise<EsitoUso & { ambiente?: string }> {
    const nomi = new Map(this.#o.ambienti.stato().ambienti.map((uno) => [uno.id, uno.nome]));
    const scelto = ambienti.find((id) => this.#o.ambienti.attivo(id));
    if (scelto === undefined) {
      const quali = ambienti.map((id) => `«${nomi.get(id) ?? id}»`).join(", ");
      return { esito: "fallito", motivo: `Il gateway non raggiunge l'host, e nessuno degli ambienti che hanno la credenziale (${quali}) è collegato adesso.` };
    }
    const nome = nomi.get(scelto) ?? scelto;
    // Se il nodo non l'ha ancora ricevuta, la si consegna adesso.
    if (!this.#consegnate.has(scelto)) await this.#consegna(scelto);
    const esito = await new Promise<EsitoSuHost>((risolvi) => {
      const idRichiesta = randomUUID();
      const scadenza = setTimeout(() => {
        this.#inAttesa.delete(idRichiesta);
        risolvi({ esito: "fallito", motivo: `Il nodo di «${nome}» non ha detto in tempo com'è finito il comando: non è detto che non sia stato eseguito.` });
      }, richiesta.secondi * 1000 + MARGINE_MS);
      scadenza.unref();
      this.#inAttesa.set(idRichiesta, { idAmbiente: scelto, risolvi, scadenza });
      const mandato = this.#o.ambienti.inviaAlNodo(scelto, {
        tipo: "esegui-su-host",
        idRichiesta,
        credenziale: richiesta.credenziale,
        host: richiesta.host,
        comando: richiesta.comando,
        secondi: richiesta.secondi,
      });
      if (!mandato) {
        clearTimeout(scadenza);
        this.#inAttesa.delete(idRichiesta);
        risolvi({ esito: "fallito", motivo: `Il nodo di «${nome}» non è raggiungibile.` });
      }
    });
    await this.#o.gateway.usoDelegato?.({
      credenziale: richiesta.credenziale,
      host: richiesta.host,
      conversazione: richiesta.conversazione,
      ambiente: nome,
      comando: richiesta.comando,
      esito: esito.esito,
      ...(esito.esito === "eseguito" ? { codice: esito.codice, durataMs: esito.durataMs, impronta: esito.impronta } : { motivo: esito.motivo }),
    });
    if (esito.esito !== "eseguito") return { ...esito, motivo: `Passando dal nodo di «${nome}»: ${esito.motivo}`, ambiente: nome };
    const { impronta: _impronta, ...resto } = esito;
    return { ...resto, ambiente: nome };
  }
}
