/**
 * Un server che sulla stessa porta parla HTTP e HTTPS: guarda il primo byte di ogni connessione,
 * e se è l'inizio di una stretta di mano TLS la passa alla parte cifrata. Così il proprietario apre
 * Shinka in HTTPS, mentre gateway e guardiano continuano a collegarsi in HTTP all'indirizzo di
 * sempre, e un problema con l'HTTPS non rende mai il centro irraggiungibile.
 *
 * La parte cifrata ha due certificati: quello dell'HTTPS, per i browser, se il proprietario lo ha
 * acceso; e quello dei nodi (ADR 0040), che c'è sempre e risponde a chi lo chiede con il suo nome.
 * Senza HTTPS, quello dei nodi risponde a tutti.
 *
 * Restituisce il server HTTP, che Fastify usa come suo: ascolta, si chiude e riceve anche le
 * richieste di WebSocket arrivate in HTTPS.
 */

import { createServer, type IncomingMessage, type RequestListener, type Server, type ServerResponse } from "node:http";
import { createServer as createServerTls } from "node:https";
import type { Socket } from "node:net";
import { createSecureContext } from "node:tls";
import { NOME_TLS_DEI_NODI } from "../protocollo/nodi.ts";

/** Il primo byte di una connessione TLS: un record di stretta di mano. */
const STRETTA_DI_MANO = 0x16;

export interface CredenzialiTls {
  chiave: string;
  /** Il certificato del server, seguito da quello di chi l'ha firmato. */
  catena: string;
}

export function serverPoliglotta(
  gestore: RequestListener<typeof IncomingMessage, typeof ServerResponse>,
  tls: CredenzialiTls | undefined,
  perINodi?: CredenzialiTls,
): Server {
  const predefinite = tls ?? perINodi;
  if (predefinite === undefined) throw new Error("Per la parte cifrata serve almeno un certificato.");
  const inChiaro = createServer(gestore);
  const contestoDeiNodi = perINodi === undefined ? undefined : createSecureContext({ key: perINodi.chiave, cert: perINodi.catena });
  const cifrato = createServerTls(
    {
      key: predefinite.chiave,
      cert: predefinite.catena,
      // Chi chiede il nome dei nodi riceve il loro certificato; gli altri quello di sempre.
      ...(contestoDeiNodi === undefined ? {} : { SNICallback: (nome: string, fatto: (errore: Error | null, contesto?: ReturnType<typeof createSecureContext>) => void) => fatto(null, nome === NOME_TLS_DEI_NODI ? contestoDeiNodi : undefined) }),
    },
    gestore,
  );
  // I WebSocket aperti in HTTPS arrivano a chi ascolta il server HTTP, come gli altri.
  cifrato.on("upgrade", (richiesta, presa, testa) => inChiaro.emit("upgrade", richiesta, presa, testa));
  // Una stretta di mano sbagliata, per esempio con un certificato non accettato, chiude solo quella connessione.
  cifrato.on("tlsClientError", (_errore, presa) => presa.destroy());

  // Le connessioni passate alla parte cifrata il server HTTP non le conosce: allo spegnimento
  // vanno chiuse anche loro, o un flusso di eventi aperto in HTTPS lo terrebbe acceso per sempre.
  const cifrate = new Set<Socket>();
  const chiudiTutte = inChiaro.closeAllConnections.bind(inChiaro);
  inChiaro.closeAllConnections = (): void => {
    chiudiTutte();
    for (const presa of cifrate) presa.destroy();
  };

  const perHttp = inChiaro.listeners("connection") as ((presa: Socket) => void)[];
  inChiaro.removeAllListeners("connection");
  inChiaro.on("connection", (presa: Socket) => {
    // Una connessione che non dice nulla non va tenuta per sempre.
    presa.setTimeout(30_000, () => presa.destroy());
    const leggi = (): void => {
      const primo = presa.read(1) as Buffer | null;
      if (primo === null) {
        presa.once("readable", leggi);
        return;
      }
      presa.setTimeout(0);
      presa.unshift(primo);
      if (primo[0] === STRETTA_DI_MANO) {
        cifrate.add(presa);
        presa.once("close", () => cifrate.delete(presa));
        cifrato.emit("connection", presa);
      } else for (const ascoltatore of perHttp) ascoltatore.call(inChiaro, presa);
      // Il byte rimesso al suo posto torna a scorrere verso chi ora legge la connessione.
      presa.resume();
    };
    presa.once("readable", leggi);
  });
  return inChiaro;
}
