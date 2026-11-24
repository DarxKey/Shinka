/**
 * I modelli locali in rete (ADR 0053): un modello acceso in un ambiente, che il proprietario ha messo
 * in rete, lo usano anche le conversazioni del centro, come la Home. Il centro chiede al nodo di
 * quell'ambiente di accendere il server e di tenerlo acceso; Claude Code lo raggiunge all'indirizzo
 * dell'ambiente, con la chiave del server. Finita la conversazione, il centro lo lascia, e il server
 * si spegne dopo il solito tempo.
 */

import { randomUUID } from "node:crypto";
import { valoreDelModelloLocale, estensioneDelModello } from "../protocollo/estensioni.ts";
import type { Impegno, ModelloDisponibile } from "../protocollo/impostazioni.ts";
import type { FonteModelliLocali, PresaDelModello } from "../nodo/modelli-locali.ts";
import type { RegistroAmbienti } from "./ambienti.ts";
import type { ModelloInRete } from "./estensioni.ts";

/** Quanto si aspetta che il nodo accenda il server: un modello grande si carica in qualche minuto. */
const ATTESA_MS = 10 * 60_000;

export interface OpzioniModelliInRete {
  /** I modelli accesi e in rete, ambiente per ambiente. */
  modelli(): ModelloInRete[];
  ambienti: Pick<RegistroAmbienti, "stato" | "inviaAlNodo" | "iscriviRiferiti" | "iscriviScollegamenti">;
  attesaMs?: number;
}

interface InAttesa {
  idAmbiente: string;
  risolvi(): void;
  rifiuta(errore: Error): void;
  scadenza: NodeJS.Timeout;
}

export class ModelliInRete implements FonteModelliLocali {
  readonly #o: OpzioniModelliInRete;
  readonly #inAttesa = new Map<string, InAttesa>();

  constructor(opzioni: OpzioniModelliInRete) {
    this.#o = opzioni;
    opzioni.ambienti.iscriviRiferiti((idNodo, messaggio) => {
      if (messaggio.tipo !== "modello-preso") return;
      const attesa = this.#inAttesa.get(messaggio.idPresa);
      if (attesa === undefined || attesa.idAmbiente !== idNodo) return;
      this.#inAttesa.delete(messaggio.idPresa);
      clearTimeout(attesa.scadenza);
      if (messaggio.porta !== undefined && messaggio.motivo === undefined) attesa.risolvi();
      else attesa.rifiuta(new Error(messaggio.motivo ?? "Il nodo non ha acceso il modello."));
    });
    opzioni.ambienti.iscriviScollegamenti((idNodo) => {
      for (const [idPresa, attesa] of this.#inAttesa) {
        if (attesa.idAmbiente !== idNodo) continue;
        this.#inAttesa.delete(idPresa);
        clearTimeout(attesa.scadenza);
        attesa.rifiuta(new Error("L'ambiente del modello si è scollegato."));
      }
    });
  }

  /** I modelli in rete degli ambienti accesi, come voci della scelta del modello. */
  modelli(): ModelloDisponibile[] {
    const ambienti = new Map(this.#o.ambienti.stato().ambienti.map((uno) => [uno.id, uno]));
    const visti = new Set<string>();
    const voci: ModelloDisponibile[] = [];
    for (const modello of this.#o.modelli()) {
      const ambiente = ambienti.get(modello.idAmbiente);
      if (ambiente?.attivo !== true || visti.has(modello.nome)) continue;
      visti.add(modello.nome);
      voci.push({
        valore: valoreDelModelloLocale(modello.nome),
        nome: `${modello.definizione.modello} (in rete, ${ambiente.nome})`,
        descrizione: `Gira su «${ambiente.nome}», con ${Math.round(modello.definizione.contesto / 1024)}K token di contesto: si accende quando serve.`,
        impegni: modello.definizione.impegni,
        motore: "claude",
      });
    }
    return voci;
  }

  /** Prende un modello in rete: il nodo del suo ambiente accende il server, se serve. */
  prendi(modello: string, impegno?: Impegno): PresaDelModello | { motivo: string } {
    const nome = estensioneDelModello(modello);
    const attivi = new Set(this.#o.ambienti.stato().ambienti.filter((uno) => uno.attivo).map((uno) => uno.id));
    const trovato = this.#o.modelli().find((uno) => uno.nome === nome && attivi.has(uno.idAmbiente));
    if (nome === undefined || trovato === undefined) {
      return { motivo: `Il modello "${nome ?? modello}" non è in rete in nessun ambiente acceso.` };
    }
    const { definizione } = trovato;
    const voluto = impegno ?? definizione.impegni[0] ?? "medium";
    if (!definizione.impegni.includes(voluto)) return { motivo: `Il modello locale "${nome}" accetta questi impegni: ${definizione.impegni.join(", ")}.` };
    const idPresa = randomUUID();
    const pronto = new Promise<void>((risolvi, rifiuta) => {
      const scadenza = setTimeout(() => {
        this.#inAttesa.delete(idPresa);
        rifiuta(new Error(`Il nodo non ha acceso il modello entro ${Math.round((this.#o.attesaMs ?? ATTESA_MS) / 60_000)} minuti.`));
      }, this.#o.attesaMs ?? ATTESA_MS);
      this.#inAttesa.set(idPresa, { idAmbiente: trovato.idAmbiente, risolvi, rifiuta, scadenza });
    });
    // Chi non aspetta il server non deve vedere il suo rifiuto come un errore non raccolto.
    pronto.catch(() => {});
    if (!this.#o.ambienti.inviaAlNodo(trovato.idAmbiente, { tipo: "prendi-modello", idPresa, modello, impegno: voluto })) {
      const attesa = this.#inAttesa.get(idPresa);
      this.#inAttesa.delete(idPresa);
      if (attesa !== undefined) {
        clearTimeout(attesa.scadenza);
        attesa.rifiuta(new Error("L'ambiente del modello non è collegato."));
      }
    }
    let lasciato = false;
    const host = trovato.indirizzo.includes(":") && !trovato.indirizzo.startsWith("[") ? `[${trovato.indirizzo}]` : trovato.indirizzo;
    return {
      modello: definizione.modello,
      indirizzo: `http://${host}:${definizione.porta}`,
      chiave: trovato.chiave,
      contesto: definizione.contesto,
      uscita: definizione.uscita,
      pronto,
      vramPiccoMb: () => undefined,
      lascia: () => {
        if (lasciato) return;
        lasciato = true;
        const attesa = this.#inAttesa.get(idPresa);
        if (attesa !== undefined) {
          this.#inAttesa.delete(idPresa);
          clearTimeout(attesa.scadenza);
        }
        this.#o.ambienti.inviaAlNodo(trovato.idAmbiente, { tipo: "lascia-modello", idPresa });
      },
    };
  }
}

/**
 * I modelli locali di questo ambiente e quelli in rete degli altri, insieme: a parità di nome vale
 * quello di qui.
 */
export function unisciModelli(qui: FonteModelliLocali, inRete: FonteModelliLocali): FonteModelliLocali {
  const diQui = (modello: string): boolean => qui.modelli().some((voce) => voce.valore === modello);
  return {
    modelli: () => {
      const propri = qui.modelli();
      return [...propri, ...inRete.modelli().filter((voce) => !propri.some((una) => una.valore === voce.valore))];
    },
    prendi: (modello, impegno, chi) => (diQui(modello) ? qui.prendi(modello, impegno, chi) : inRete.prendi(modello, impegno)),
  };
}
