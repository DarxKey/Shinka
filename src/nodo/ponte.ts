/**
 * Il ponte di un nodo (ADR 0058): una macchina che non raggiunge il centro, ma raggiunge questo
 * nodo, si collega al centro attraverso di lui. Il nodo ascolta su una porta scelta dal proprietario
 * e fa passare solo due cose:
 *
 * - il collegamento cifrato dei nodi, riconosciuto dal nome che chiede (`nodi.shinka.invalid`): passa
 *   così com'è, cifrato da capo a capo, e il centro vi riconosce il nodo come sempre;
 * - lo scaricamento dello script e del pacchetto per preparare un ambiente nuovo, in chiaro (come
 *   lo chiede PowerShell): una richiesta sola, rifatta dal ponte, senza nient'altro dopo.
 *
 * Il resto (le pagine e le API dell'interfaccia, qualunque altro nome) si rifiuta: il ponte non
 * apre il centro alla rete da cui arriva la macchina.
 */

import { createServer, connect, type Server, type Socket } from "node:net";
import { NOME_TLS_DEI_NODI } from "../protocollo/nodi.ts";

/** Quanto può essere lungo il primo messaggio cifrato prima di sapere a chi è rivolto. */
const SALUTO_MASSIMO = 16 * 1024;
/** Quanto si aspetta il primo messaggio. */
const ATTESA_SALUTO_MS = 10_000;

/** I percorsi in chiaro che il ponte lascia passare: lo script e il pacchetto per un ambiente nuovo. */
const PERCORSO_AMMESSO = /^GET (\/api\/ambienti\/preparazione(?:\/pacchetto)?(?:\?[A-Za-z0-9=&_%.-]*)?) HTTP\/1\.[01]$/;

/**
 * Il nome che un client chiede nel suo primo messaggio TLS (SNI). `undefined` se il messaggio non è
 * ancora intero; `null` se è intero e non dice un nome, o non è un saluto TLS.
 */
export function nomeChiesto(dati: Buffer): string | null | undefined {
  if (dati.length < 5) return undefined;
  if (dati[0] !== 0x16) return null;
  const lunghezza = dati.readUInt16BE(3);
  if (dati.length < 5 + lunghezza) return undefined;
  const saluto = dati.subarray(5, 5 + lunghezza);
  try {
    if (saluto[0] !== 0x01) return null;
    let punto = 4 + 2 + 32;
    punto += 1 + (saluto[punto] ?? 0);
    punto += 2 + saluto.readUInt16BE(punto);
    punto += 1 + (saluto[punto] ?? 0);
    const fine = punto + 2 + saluto.readUInt16BE(punto);
    punto += 2;
    while (punto + 4 <= fine) {
      const tipo = saluto.readUInt16BE(punto);
      const lungo = saluto.readUInt16BE(punto + 2);
      punto += 4;
      if (tipo === 0) {
        // L'elenco dei nomi: si prende il primo, di tipo nome host.
        const nome = saluto.readUInt16BE(punto + 3);
        return saluto[punto + 2] === 0 ? saluto.subarray(punto + 5, punto + 5 + nome).toString("latin1") : null;
      }
      punto += lungo;
    }
    return null;
  } catch {
    return null;
  }
}

export interface OpzioniPonte {
  /** L'indirizzo del centro come lo usa questo nodo, per esempio http://192.168.1.20:7850. */
  centro: string;
  /** Su quale indirizzo ascoltare: di solito tutti. */
  ascolta?: string;
}

export class Ponte {
  readonly #host: string;
  readonly #porta: number;
  readonly #ascolta: string;
  #server: Server | undefined;
  readonly #aperti = new Set<Socket>();

  constructor(opzioni: OpzioniPonte) {
    const indirizzo = new URL(opzioni.centro);
    this.#host = indirizzo.hostname.replace(/^\[|\]$/g, "");
    this.#porta = Number(indirizzo.port === "" ? (indirizzo.protocol === "https:" ? 443 : 80) : indirizzo.port);
    this.#ascolta = opzioni.ascolta ?? "0.0.0.0";
  }

  /** La porta su cui ascolta, se è aperto. */
  get porta(): number | undefined {
    const indirizzo = this.#server?.address();
    return typeof indirizzo === "object" && indirizzo !== null ? indirizzo.port : undefined;
  }

  /** Apre il ponte su una porta (0 ne sceglie una libera). Lancia se la porta non si può aprire. */
  async apri(porta: number): Promise<number> {
    await this.chiudi();
    const server = createServer((socket) => this.#accogli(socket));
    await new Promise<void>((risolvi, rifiuta) => {
      server.once("error", rifiuta);
      server.listen({ host: this.#ascolta, port: porta }, () => risolvi());
    });
    this.#server = server;
    return this.porta ?? porta;
  }

  async chiudi(): Promise<void> {
    const server = this.#server;
    this.#server = undefined;
    for (const socket of this.#aperti) socket.destroy();
    this.#aperti.clear();
    if (server !== undefined) await new Promise<void>((risolvi) => server.close(() => risolvi()));
  }

  #tieni(socket: Socket): void {
    this.#aperti.add(socket);
    socket.once("close", () => this.#aperti.delete(socket));
    socket.on("error", () => socket.destroy());
  }

  #accogli(cliente: Socket): void {
    this.#tieni(cliente);
    let ricevuti = Buffer.alloc(0);
    const scadenza = setTimeout(() => cliente.destroy(), ATTESA_SALUTO_MS);
    const alDato = (dati: Buffer): void => {
      ricevuti = Buffer.concat([ricevuti, dati]);
      if (ricevuti[0] === 0x16) {
        const nome = nomeChiesto(ricevuti);
        if (nome === undefined && ricevuti.length < SALUTO_MASSIMO) return;
        cliente.off("data", alDato);
        clearTimeout(scadenza);
        if (nome !== NOME_TLS_DEI_NODI) return void cliente.destroy();
        this.#passa(cliente, ricevuti);
        return;
      }
      const finePrimaRiga = ricevuti.indexOf("\r\n");
      if (finePrimaRiga < 0 && ricevuti.length < 2048) return;
      cliente.off("data", alDato);
      clearTimeout(scadenza);
      const riga = finePrimaRiga < 0 ? "" : ricevuti.subarray(0, finePrimaRiga).toString("latin1");
      const ammesso = PERCORSO_AMMESSO.exec(riga);
      if (ammesso === null) {
        const testo = "Questo ponte serve solo ai nodi di Shinka.\n";
        cliente.end(`HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(testo)}\r\n\r\n${testo}`);
        return;
      }
      this.#scarica(cliente, ammesso[1] ?? "/");
    };
    cliente.on("data", alDato);
  }

  /** Il collegamento cifrato di un nodo: passa così com'è, nei due versi. */
  #passa(cliente: Socket, primi: Buffer): void {
    const centro = connect({ host: this.#host, port: this.#porta });
    this.#tieni(centro);
    centro.once("connect", () => {
      centro.write(primi);
      cliente.pipe(centro);
      centro.pipe(cliente);
    });
    const chiudi = (): void => {
      cliente.destroy();
      centro.destroy();
    };
    cliente.once("close", chiudi);
    centro.once("close", chiudi);
  }

  /** Lo script o il pacchetto per un ambiente nuovo: una richiesta sola, rifatta qui, e la risposta così com'è. */
  #scarica(cliente: Socket, percorso: string): void {
    const centro = connect({ host: this.#host, port: this.#porta });
    this.#tieni(centro);
    centro.once("connect", () => {
      centro.write(`GET ${percorso} HTTP/1.1\r\nHost: ${this.#host}:${this.#porta}\r\nUser-Agent: ponte-di-shinka\r\nConnection: close\r\n\r\n`);
      centro.pipe(cliente);
    });
    centro.once("close", () => cliente.end());
    cliente.once("close", () => centro.destroy());
  }
}
