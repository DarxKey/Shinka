/**
 * Il centro e il lavoro offline dei nodi (ADR 0056). A ogni nodo che si collega, e quando cambiano,
 * il centro manda i progetti del suo ambiente e il testo della memoria: senza centro, il nodo sa
 * quali progetti ha e come riprenderli. Quando il nodo torna, riceve ciò che è stato fatto offline:
 * gli eventi, che vanno negli archivi dei progetti, e gli strumenti di memoria e skill annotati.
 */

import type { Motore } from "../protocollo/impostazioni.ts";
import type { RiferitoDalNodo } from "../protocollo/nodi.ts";
import type { EsitoStrumento } from "../protocollo/strumenti.ts";
import type { RegistroAmbienti } from "./ambienti.ts";
import type { LavoriDeiProgetti } from "./lavori.ts";
import type { RegistroProgetti } from "./progetti.ts";

export interface OpzioniLavoroOffline {
  ambienti: RegistroAmbienti;
  lavori: LavoriDeiProgetti;
  progetti: RegistroProgetti;
  /** Il testo della memoria come lo riceve una conversazione, e chi avvisa quando cambia. */
  memoria: { testoIntero(): string | undefined; iscrivi(ascoltatore: () => void): () => void };
  /** Come si esegue uno strumento di Shinka per una conversazione di progetto. */
  strumento(idConversazione: string, nome: unknown, argomenti: unknown): Promise<EsitoStrumento>;
  /** Il motore predefinito dell'installazione, per le conversazioni che il nodo apre da sé. */
  motorePredefinito?(): Motore | undefined;
}

export function colLavoroOffline(o: OpzioniLavoroOffline): () => void {
  const mandaProgetti = (idNodo: string): void => {
    const motorePredefinito = o.motorePredefinito?.();
    o.ambienti.inviaAlNodo(idNodo, { tipo: "progetti", progetti: o.lavori.progettiDelNodo(idNodo), ...(motorePredefinito === undefined ? {} : { motorePredefinito }) });
  };
  const mandaMemoria = (idNodo: string): void => {
    const testo = o.memoria.testoIntero();
    o.ambienti.inviaAlNodo(idNodo, { tipo: "memoria", ...(testo === undefined ? {} : { testo }) });
  };
  // Le consegne di un nodo si fanno una alla volta, nell'ordine in cui arrivano.
  const code = new Map<string, Promise<void>>();
  const inCoda = (idNodo: string, lavoro: () => Promise<void>): void => {
    const prima = code.get(idNodo) ?? Promise.resolve();
    const dopo = prima.then(lavoro).catch((errore: unknown) => {
      console.error(`Lavoro offline di un ambiente non ricevuto: ${errore instanceof Error ? errore.message : String(errore)}`);
    });
    code.set(idNodo, dopo);
  };
  const riferito = (idNodo: string, messaggio: RiferitoDalNodo): void => {
    if (messaggio.tipo === "offline-eventi") {
      inCoda(idNodo, async () => {
        const fino = await o.lavori.riceviOffline(idNodo, messaggio);
        o.ambienti.inviaAlNodo(idNodo, { tipo: "offline-preso", idProgetto: messaggio.idProgetto, versione: messaggio.versione, fino });
        // Un progetto nato offline è ora del centro: il nodo lo riceve con gli altri.
        if (messaggio.nuovo !== undefined && fino >= messaggio.ultimo) mandaProgetti(idNodo);
      });
      return;
    }
    if (messaggio.tipo === "offline-annotati") {
      inCoda(idNodo, async () => {
        for (const annotato of messaggio.strumenti) {
          // Solo per i progetti di quell'ambiente: un nodo non parla per le conversazioni degli altri.
          const progetto = o.progetti.trova(annotato.idConversazione);
          if (progetto !== undefined && progetto.idAmbiente !== idNodo) continue;
          await o.strumento(annotato.idConversazione, annotato.nome, annotato.argomenti);
        }
        // Anche quelli non riusciti si tolgono: ripeterli darebbe lo stesso esito.
        o.ambienti.inviaAlNodo(idNodo, { tipo: "annotati-presi", id: messaggio.strumenti.map((annotato) => annotato.id) });
      });
    }
  };
  const disiscrivi = [
    o.ambienti.iscriviCollegamenti((idNodo) => {
      o.lavori.inConsegnaDa(idNodo, o.ambienti.offlineDichiarato(idNodo));
      mandaProgetti(idNodo);
      mandaMemoria(idNodo);
    }),
    o.ambienti.iscriviRiferiti(riferito),
    o.progetti.iscrivi(() => {
      for (const idNodo of o.ambienti.collegati()) mandaProgetti(idNodo);
    }),
    o.memoria.iscrivi(() => {
      for (const idNodo of o.ambienti.collegati()) mandaMemoria(idNodo);
    }),
  ];
  return () => {
    for (const smetti of disiscrivi) smetti();
  };
}
