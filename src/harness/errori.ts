/** Spiegazioni in italiano degli errori che l'harness segnala su un messaggio di Claude. */
const SPIEGAZIONI: Record<string, string> = {
  authentication_failed:
    "Claude Code non è autenticato in questo ambiente. Esegui `claude auth login` e riprova.",
  oauth_org_not_allowed: "L'organizzazione dell'account non consente questo accesso.",
  account_on_hold: "L'account è sospeso.",
  billing_error: "C'è un problema di fatturazione sull'account.",
  rate_limit: "La quota del piano è esaurita per ora.",
  overloaded: "Il servizio è sovraccarico, riprova tra poco.",
  model_not_found: "Il modello richiesto non è disponibile per questo account.",
  server_error: "Errore del servizio, riprova tra poco.",
};

export function spiegaErroreHarness(codice: string): string {
  return SPIEGAZIONI[codice] ?? `L'harness ha segnalato l'errore "${codice}".`;
}
