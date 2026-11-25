/**
 * I blocchi di codice che sono comandi, e il modo di mandarli al terminale di un progetto: il
 * pulsante ▶ accanto a Copia li scrive nel terminale, con Invio, come se li battesse il proprietario.
 */

/** I linguaggi di shell: un blocco scritto in uno di questi si può lanciare nel terminale. */
const LINGUAGGI_DI_SHELL = new Set(["bash", "sh", "shell", "zsh", "console", "powershell", "pwsh", "ps1", "ps", "cmd", "bat"]);

export function eUnComando(linguaggio: string): boolean {
  return LINGUAGGI_DI_SHELL.has(linguaggio.trim().toLowerCase());
}

/** Il prompt in testa a una riga di un blocco "console": "$ ", "> ", "# ", o quello di PowerShell. */
const PROMPT = /^\s*(?:PS [^>\n]*>|[$>#])\s?/;

/**
 * Ciò che va scritto nel terminale. In un blocco "console" le righe con il prompt sono i comandi, e
 * il prompt si toglie; le altre sono ciò che i comandi hanno scritto, e restano fuori. Senza prompt
 * il blocco va com'è.
 */
export function comandoDaEseguire(codice: string, linguaggio: string): string {
  const righe = codice.replace(/\r\n/g, "\n").replace(/\n+$/, "").split("\n");
  if (linguaggio.trim().toLowerCase() !== "console" || !righe.some((riga) => PROMPT.test(riga))) return righe.join("\n");
  return righe
    .filter((riga) => PROMPT.test(riga))
    .map((riga) => riga.replace(PROMPT, ""))
    .join("\n");
}

type Ricevente = (testo: string) => void;
const riceventi = new Map<string, Ricevente>();
const inAttesa = new Map<string, { testo: string; risolvi: (riuscito: boolean) => void; scadenza: ReturnType<typeof setTimeout> }[]>();

/**
 * Il terminale aperto di un progetto si fa trovare: riceve i comandi lanciati dalla chat, anche
 * quelli arrivati mentre si apriva. Restituisce come smettere.
 */
export function registraTerminale(idProgetto: string, ricevente: Ricevente): () => void {
  riceventi.set(idProgetto, ricevente);
  for (const voce of inAttesa.get(idProgetto)?.splice(0) ?? []) {
    clearTimeout(voce.scadenza);
    ricevente(voce.testo);
    voce.risolvi(true);
  }
  return () => {
    if (riceventi.get(idProgetto) === ricevente) riceventi.delete(idProgetto);
  };
}

/** Manda un comando al terminale del progetto: subito, o appena si apre. Falso se non si apre in tempo. */
export function mandaAlTerminale(idProgetto: string, testo: string, attesaMs = 15_000): Promise<boolean> {
  const ricevente = riceventi.get(idProgetto);
  if (ricevente !== undefined) {
    ricevente(testo);
    return Promise.resolve(true);
  }
  return new Promise((risolvi) => {
    const coda = inAttesa.get(idProgetto) ?? [];
    const voce = {
      testo,
      risolvi,
      scadenza: setTimeout(() => {
        const rimasti = (inAttesa.get(idProgetto) ?? []).filter((una) => una !== voce);
        if (rimasti.length === 0) inAttesa.delete(idProgetto);
        else inAttesa.set(idProgetto, rimasti);
        risolvi(false);
      }, attesaMs),
    };
    coda.push(voce);
    inAttesa.set(idProgetto, coda);
  });
}
