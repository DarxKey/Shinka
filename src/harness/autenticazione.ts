/**
 * Unico punto in cui Shinka sceglie come l'harness si autentica.
 * Vedi shinka.md, sezione 3: la fonte di autenticazione si sceglie in un solo punto del codice.
 */

export type FonteAutenticazione = "abbonamento" | "api-key";

/** Variabile d'ambiente che sceglie la fonte. Assente o vuota significa abbonamento. */
export const VARIABILE_FONTE = "SHINKA_AUTENTICAZIONE";

/** Credenziali a consumo: se arrivano all'harness hanno la precedenza sul login del piano. */
const VARIABILI_A_CONSUMO = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"] as const;

type Ambiente = Record<string, string | undefined>;

export function fonteConfigurata(ambiente: Ambiente = process.env): FonteAutenticazione {
  const valore = ambiente[VARIABILE_FONTE]?.trim().toLowerCase();
  if (valore === undefined || valore === "" || valore === "abbonamento") return "abbonamento";
  if (valore === "api-key") return "api-key";
  throw new Error(
    `${VARIABILE_FONTE} deve valere "abbonamento" oppure "api-key", ma vale "${valore}".`,
  );
}

/**
 * Ambiente da passare al processo dell'harness.
 *
 * Con l'abbonamento le credenziali a consumo vengono tolte: una chiave dimenticata
 * nell'ambiente sposterebbe la spesa sul consumo senza che nessuno se ne accorga.
 */
export function ambientePerHarness(
  fonte: FonteAutenticazione,
  ambiente: Ambiente = process.env,
): Ambiente {
  const risultato: Ambiente = { ...ambiente };
  if (fonte === "abbonamento") {
    for (const nome of VARIABILI_A_CONSUMO) delete risultato[nome];
  }
  return risultato;
}

/**
 * Controlla che la sessione usi davvero la fonte configurata.
 *
 * `sorgenteChiave` è il campo `apiKeySource` del messaggio di avvio dell'harness:
 * vale "none" quando non c'è alcuna API key e la sessione usa il login del piano.
 */
export function verificaFonte(attesa: FonteAutenticazione, sorgenteChiave: string): void {
  const senzaChiave = sorgenteChiave === "none";
  if (attesa === "abbonamento" && !senzaChiave) {
    throw new Error(
      `Shinka è configurato per l'abbonamento, ma la sessione usa una API key (${sorgenteChiave}).`,
    );
  }
  if (attesa === "api-key" && senzaChiave) {
    throw new Error("Shinka è configurato per una API key, ma la sessione non ne ha trovata nessuna.");
  }
}
