/**
 * Le domande che il gateway fa al proprietario, lui stesso.
 *
 * Quasi tutto ciò che il proprietario approva passa dal centro: è il centro a mostrare la
 * richiesta e a riferire la risposta. Va bene finché si tratta di una procedura; non basta dove
 * serve un confine, perché un centro che sbaglia (o una conversazione ingannata da una pagina)
 * potrebbe riferire un sì che nessuno ha dato. Per quelle cose il sì lo raccoglie il gateway:
 *
 * - su Telegram, con un pulsante che solo il gateway può creare e che, premuto, non passa dal centro;
 * - nella pagina del vault, dove il proprietario entra con la sua frase.
 *
 * Il centro può soltanto ritirare una domanda (un no): mai rispondere di sì.
 */

import { randomBytes } from "node:crypto";
import { PREFISSO_PULSANTE_DEL_GATEWAY, TESTO_TELEGRAM_MASSIMO } from "../protocollo/telegram.ts";
import type { DomandaDelGateway } from "../protocollo/vault.ts";
import type { Telegram } from "./telegram.ts";

export type RispostaAllaDomanda = "approvata" | "negata" | "scaduta";

/** Da dove arriva una risposta: conta per ciò che può dire. */
export type DaDove = "telegram" | "pagina" | "centro" | "tempo";

/** Quante domande possono restare aperte insieme. */
export const DOMANDE_APERTE = 20;

export interface DaChiedere {
  tipo: DomandaDelGateway["tipo"];
  titolo: string;
  testo: string;
  /** La scritta del pulsante del sì. */
  si: string;
  attesaMs: number;
}

export interface DomandaFatta {
  id: string;
  scadeIl: string;
  /** Si compie quando il proprietario decide, o quando il tempo finisce. */
  decisa: Promise<RispostaAllaDomanda>;
}

interface Aperta {
  domanda: DomandaDelGateway;
  timer: NodeJS.Timeout;
  /** Il messaggio su Telegram, quando è partito. */
  messaggio: Promise<number | undefined>;
  /** Vero se su Telegram c'è anche il pulsante del sì: manca quando il testo non ci sta per intero. */
  siSuTelegram: boolean;
  risolvi: (risposta: RispostaAllaDomanda) => void;
}

const COM_E_FINITA: Record<RispostaAllaDomanda, Record<DaDove, string>> = {
  approvata: { telegram: "✅ Hai detto di sì.", pagina: "✅ Hai detto di sì dalla pagina del vault.", centro: "", tempo: "" },
  negata: {
    telegram: "✖️ Hai detto di no.",
    pagina: "✖️ Hai detto di no dalla pagina del vault.",
    centro: "✖️ Ritirata: non è stato fatto nulla.",
    tempo: "",
  },
  scaduta: { telegram: "", pagina: "", centro: "", tempo: "⌛ Scaduta senza risposta: non è stato fatto nulla." },
};

export class DomandeAlProprietario {
  readonly #telegram: Telegram | undefined;
  readonly #adesso: () => number;
  readonly #aperte = new Map<string, Aperta>();

  constructor(opzioni: { telegram?: Telegram; adesso?: () => number } = {}) {
    this.#telegram = opzioni.telegram;
    this.#adesso = opzioni.adesso ?? Date.now;
    this.#telegram?.ascoltaPulsantiDelGateway((dato, messaggio) => void this.#premuto(dato, messaggio));
  }

  /** Vero se c'è posto per un'altra domanda. */
  get cePosto(): boolean {
    return this.#aperte.size < DOMANDE_APERTE;
  }

  /** Fa una domanda al proprietario: su Telegram, se il bot è abbinato, e nella pagina del vault. */
  chiedi(daChiedere: DaChiedere): DomandaFatta {
    const id = randomBytes(16).toString("base64url");
    const scade = this.#adesso() + daChiedere.attesaMs;
    const domanda: DomandaDelGateway = {
      id,
      tipo: daChiedere.tipo,
      titolo: daChiedere.titolo,
      testo: daChiedere.testo,
      si: daChiedere.si,
      scadeIl: new Date(scade).toISOString(),
    };
    let risolvi: (risposta: RispostaAllaDomanda) => void = () => {};
    const decisa = new Promise<RispostaAllaDomanda>((fatto) => {
      risolvi = fatto;
    });
    const timer = setTimeout(() => this.decidi(id, "scaduta", "tempo"), daChiedere.attesaMs);
    timer.unref();

    const intero = `${domanda.titolo}\n\n${domanda.testo}`;
    // Un sì vale per ciò che si è letto: se il testo su Telegram non ci sta per intero, lì il sì non c'è.
    const siSuTelegram = intero.length <= TESTO_TELEGRAM_MASSIMO - 200;
    const testo = siSuTelegram
      ? intero
      : `${intero.slice(0, TESTO_TELEGRAM_MASSIMO - 400)}…\n\nIl testo è troppo lungo per Telegram: leggilo per intero e decidi dalla pagina del vault.`;
    const dato = (lettera: "s" | "n"): string => `${PREFISSO_PULSANTE_DEL_GATEWAY}${id}:${lettera}`;
    const messaggio =
      this.#telegram === undefined
        ? Promise.resolve(undefined)
        : this.#telegram
            .invia(
              {
                testo: `${testo}\n\nLo chiede il gateway: la risposta la leggo solo io.`,
                pulsanti: [[...(siSuTelegram ? [{ testo: domanda.si, dato: dato("s") }] : []), { testo: "No", dato: dato("n") }]],
              },
              true,
            )
            .then((esito) => (esito.esito === "inviato" && esito.messaggio !== 0 ? esito.messaggio : undefined));
    this.#aperte.set(id, { domanda, timer, messaggio, siSuTelegram, risolvi });
    return { id, scadeIl: domanda.scadeIl, decisa };
  }

  /**
   * Arriva una risposta. Vale una volta sola; il sì vale soltanto se viene dal proprietario, cioè
   * da Telegram o dalla pagina del vault. Torna vero se la risposta è stata presa.
   */
  decidi(id: string, risposta: RispostaAllaDomanda, da: DaDove): boolean {
    const aperta = this.#aperte.get(id);
    if (aperta === undefined) return false;
    if (risposta === "approvata" && da !== "telegram" && da !== "pagina") return false;
    if (risposta === "scaduta" && da !== "tempo") return false;
    this.#aperte.delete(id);
    clearTimeout(aperta.timer);
    aperta.risolvi(risposta);
    void this.#chiudiSuTelegram(aperta, COM_E_FINITA[risposta][da]);
    return true;
  }

  /** Le domande aperte, per la pagina del vault. */
  inVista(): DomandaDelGateway[] {
    return [...this.#aperte.values()].map((aperta) => ({ ...aperta.domanda }));
  }

  /** Allo spegnimento: le domande aperte finiscono senza risposta. */
  ferma(): void {
    for (const id of [...this.#aperte.keys()]) this.decidi(id, "scaduta", "tempo");
  }

  async #premuto(dato: string, messaggio: number): Promise<void> {
    const letto = /^([A-Za-z0-9_-]{22}):([sn])$/.exec(dato.slice(PREFISSO_PULSANTE_DEL_GATEWAY.length));
    if (letto === null) return;
    const aperta = this.#aperte.get(letto[1] as string);
    if (aperta === undefined) {
      // La domanda non c'è più (scaduta, o il gateway è ripartito): i pulsanti non devono restare lì a promettere.
      await this.#telegram?.modifica(messaggio, { testo: "Questa richiesta non vale più: non è stato fatto nulla." }, true);
      return;
    }
    // Il pulsante deve essere quello del messaggio con cui la domanda è stata fatta.
    if ((await aperta.messaggio) !== messaggio) return;
    if (letto[2] === "s" && !aperta.siSuTelegram) return;
    this.decidi(aperta.domanda.id, letto[2] === "s" ? "approvata" : "negata", "telegram");
  }

  async #chiudiSuTelegram(aperta: Aperta, comeFinita: string): Promise<void> {
    const messaggio = await aperta.messaggio;
    if (messaggio === undefined || this.#telegram === undefined) return;
    const intero = `${aperta.domanda.titolo}\n\n${aperta.domanda.testo}`;
    const testo = intero.length <= TESTO_TELEGRAM_MASSIMO - 200 ? intero : `${intero.slice(0, TESTO_TELEGRAM_MASSIMO - 400)}…`;
    await this.#telegram.modifica(messaggio, { testo: `${testo}\n\n${comeFinita}` }, true);
  }
}
