/**
 * La porta solo per i nodi (ADR 0065): quella che il proprietario può aprire su Internet, perché un
 * nodo fuori casa raggiunga il centro, senza pubblicare l'interfaccia. Accetta soltanto il
 * collegamento cifrato che chiede il nome dei nodi (`nodi.shinka.invalid`). Il resto si chiude:
 * le pagine, le API e l'entrata con la password non si raggiungono da qui.
 *
 * Una connessione accettata passa al server del centro così com'è, con il suo indirizzo: lì la
 * stretta di mano si fa con il certificato dei nodi, e dentro si ammettono solo le rotte dei nodi
 * (`soloPerINodi` in `centro.ts`). Il centro sa che è arrivata da qui, e lì un nodo che non conosce
 * si presenta solo mentre c'è un invito aperto.
 */

import { createServer, type Server, type Socket } from "node:net";
import { NOME_TLS_DEI_NODI } from "../protocollo/nodi.ts";
import { nomeChiesto } from "../nodo/ponte.ts";

/** Quanto può essere lungo il primo messaggio cifrato prima di sapere a chi è rivolto. */
const SALUTO_MASSIMO = 16 * 1024;
/** Quanto si aspetta il primo messaggio. */
const ATTESA_SALUTO_MS = 10_000;

/** Le connessioni si riconoscono da indirizzo e porta di chi le apre: anche quella cifrata che le avvolge. */
function chiaveDi(presa: { remoteAddress?: string | undefined; remotePort?: number | undefined }): string | undefined {
  return presa.remoteAddress === undefined || presa.remotePort === undefined ? undefined : `${presa.remoteAddress}|${presa.remotePort}`;
}

export class PortaDeiNodi {
  #server: Server | undefined;
  readonly #aperte = new Set<Socket>();
  readonly #passate = new Set<string>();

  /** La porta su cui ascolta, se è aperta. */
  get porta(): number | undefined {
    const indirizzo = this.#server?.address();
    return typeof indirizzo === "object" && indirizzo !== null ? indirizzo.port : undefined;
  }

  /** Vero se la connessione, o quella cifrata che la avvolge, è arrivata da questa porta. */
  da(presa: { remoteAddress?: string | undefined; remotePort?: number | undefined }): boolean {
    const chiave = chiaveDi(presa);
    return chiave !== undefined && this.#passate.has(chiave);
  }

  /**
   * Apre la porta e passa al server del centro ciò che accetta. Lancia se la porta non si apre.
   * `verso` è il server su cui il centro ascolta, con la sua parte cifrata.
   */
  async apri(verso: Server, porta: number, host: string): Promise<number> {
    await this.chiudi();
    const server = createServer((presa) => this.#accogli(presa, verso));
    await new Promise<void>((risolvi, rifiuta) => {
      server.once("error", rifiuta);
      server.listen({ host, port: porta }, () => risolvi());
    });
    this.#server = server;
    return this.porta ?? porta;
  }

  async chiudi(): Promise<void> {
    const server = this.#server;
    this.#server = undefined;
    for (const presa of this.#aperte) presa.destroy();
    this.#aperte.clear();
    this.#passate.clear();
    if (server !== undefined) await new Promise<void>((risolvi) => server.close(() => risolvi()));
  }

  #accogli(presa: Socket, verso: Server): void {
    this.#aperte.add(presa);
    presa.on("error", () => presa.destroy());
    const chiave = chiaveDi(presa);
    presa.once("close", () => {
      this.#aperte.delete(presa);
      if (chiave !== undefined) this.#passate.delete(chiave);
    });
    let ricevuti = Buffer.alloc(0);
    const scadenza = setTimeout(() => presa.destroy(), ATTESA_SALUTO_MS);
    const leggi = (): void => {
      let pezzo: Buffer | null;
      while ((pezzo = presa.read() as Buffer | null) !== null) ricevuti = Buffer.concat([ricevuti, pezzo]);
      if (ricevuti.length === 0) return;
      // Solo TLS: qui non si parla in chiaro, nemmeno per scaricare l'installazione.
      if (ricevuti[0] !== 0x16) return void chiudi();
      const nome = nomeChiesto(ricevuti);
      if (nome === undefined && ricevuti.length < SALUTO_MASSIMO) return;
      if (nome !== NOME_TLS_DEI_NODI || chiave === undefined) return void chiudi();
      presa.off("readable", leggi);
      clearTimeout(scadenza);
      this.#passate.add(chiave);
      // Ciò che si è letto torna al suo posto, e il server del centro la prende come una sua: al
      // giro dopo, quando la connessione ha smesso di avvisare questo ascoltatore e avviserà il suo.
      setImmediate(() => {
        if (presa.destroyed) return;
        presa.unshift(ricevuti);
        verso.emit("connection", presa);
      });
    };
    const chiudi = (): void => {
      clearTimeout(scadenza);
      presa.off("readable", leggi);
      presa.destroy();
    };
    presa.on("readable", leggi);
  }
}
