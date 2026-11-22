/**
 * I divieti fissi del gateway: pagare, cambiare una password e cancellare un account non si
 * fanno con ciò che il gateway offre, qualunque sia il modo dei permessi della conversazione e
 * anche con l'approvazione del proprietario.
 *
 * Sui comandi è un controllo sul testo del comando: ferma la richiesta diretta, non chi la
 * nasconde apposta dentro uno script o una variabile. Nei siti è un controllo sulle parole del
 * bottone e sui nomi dei campi: ferma il sito che chiama le cose con il loro nome, non quello
 * che le chiama in un altro modo o le disegna in un'immagine.
 */

/** Dove può cominciare un comando dentro una riga di shell. */
const INIZIO = String.raw`(?:^|[;&|(\n{]|\b(?:sudo|doas|exec|env|nohup|xargs)\s+(?:-\S+\s+)*)\s*(?:\S*/)?`;

const VIETATI: readonly { schema: RegExp; motivo: string }[] = [
  {
    schema: new RegExp(`${INIZIO}(?:passwd|chpasswd|smbpasswd|pdbedit)\\b`, "im"),
    motivo: "cambiare una password",
  },
  { schema: new RegExp(`${INIZIO}(?:usermod|chage)\\b[^;&|\\n]*\\s(?:-p|--password)\\b`, "im"), motivo: "cambiare una password" },
  { schema: new RegExp(`${INIZIO}(?:userdel|deluser)\\b`, "im"), motivo: "cancellare un account" },
  { schema: /\bnet(?:\.exe)?\s+user\s+\S+.*\/delete\b/i, motivo: "cancellare un account" },
  { schema: /\bSet-(?:LocalUser|ADAccountPassword)\b[^;|\n]*-(?:Password|NewPassword|Reset)\b/i, motivo: "cambiare una password" },
  { schema: /\bRemove-(?:LocalUser|ADUser)\b/i, motivo: "cancellare un account" },
];

/** Se il comando è un divieto fisso, dice quale; altrimenti nulla. */
export function divietoFisso(comando: string): string | undefined {
  return VIETATI.find((vietato) => vietato.schema.test(comando))?.motivo;
}

const ARTICOLO = String.raw`(?:(?:il mio|il tuo|la mia|la tua|il|lo|la|un|una|my|your|the|this|an?)\s+|l['’]\s*|un['’]\s*)?`;

const VIETATI_NEI_SITI: readonly { schema: RegExp; motivo: string }[] = [
  { schema: /^(?:paga|pay)\b/i, motivo: "pagare" },
  { schema: /\b(?:acquista|compra|ordina|buy|purchase|order)\s+(?:ora|adesso|subito|now)\b/i, motivo: "pagare" },
  {
    schema: new RegExp(
      String.raw`\b(?:conferma|completa|invia|effettua|concludi|esegui|disponi|autorizza|place|confirm|complete|submit|authori[sz]e)\s+${ARTICOLO}(?:ordine|acquisto|pagamento|bonifico|ricarica|trasferimento|order|purchase|payment|transfer)\b`,
      "i",
    ),
    motivo: "pagare",
  },
  { schema: /\b(?:procedi|vai)\s+(?:al|alla|all['’]|con il|con l['’])\s*(?:pagamento|cassa|acquisto|ordine)\b/i, motivo: "pagare" },
  { schema: /\b(?:proceed|continue|go)\s+to\s+(?:checkout|payment)\b/i, motivo: "pagare" },
  { schema: /\b(?:send|transfer)\s+(?:money|funds)\b/i, motivo: "pagare" },
  {
    schema: new RegExp(String.raw`\b(?:cambia|modifica|reimposta|aggiorna|change|reset|update)\s+${ARTICOLO}password\b`, "i"),
    motivo: "cambiare una password",
  },
  {
    schema: /\b(?:password dimenticata|hai dimenticato la password|forgot(?:ten)?\s+(?:your\s+|my\s+)?password)\b/i,
    motivo: "cambiare una password",
  },
  {
    schema: new RegExp(
      String.raw`\b(?:elimina|cancella|chiudi|disattiva|rimuovi|delete|close|deactivate|remove)\s+${ARTICOLO}(?:account|profilo|conto|utenza)\b`,
      "i",
    ),
    motivo: "cancellare un account",
  },
];

/** Se le parole di un bottone o di un collegamento dicono un divieto fisso, dice quale; altrimenti nulla. */
export function divietoNelSito(parole: string): string | undefined {
  const pulite = parole.replace(/\s+/g, " ").trim();
  if (pulite === "") return undefined;
  return VIETATI_NEI_SITI.find((vietato) => vietato.schema.test(pulite))?.motivo;
}

const CARTA =
  /\bcc-(?:number|csc|exp|name|type)|card[\s_-]?(?:number|num|no)\b|cardnumber|numero.{0,10}carta|\bcvv2?\b|\bcvc2?\b|\bcsc\b|security[\s_-]?code|codice.{0,10}sicurezza/i;

/** Vero se nome, etichetta o `autocomplete` di un campo dicono che vuole i dati di una carta di pagamento. */
export function campoDiCarta(descrizione: string): boolean {
  return CARTA.test(descrizione);
}
