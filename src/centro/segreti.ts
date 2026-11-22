/**
 * Un controllo grossolano su ciò che Claude vuole conservare in memoria o in una skill:
 * nessun segreto deve finirci. Riconosce solo le forme più evidenti; la regola vera
 * resta nelle istruzioni di Claude.
 */

const FORME: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  // Chiavi e gettoni dai prefissi noti.
  /\b(?:sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_\w{20,}|AKIA[0-9A-Z]{16}|xox[abprs]-[A-Za-z0-9-]{10,})/,
  // Un gettone firmato: tre parti separate da punti, la prima comincia sempre così.
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./,
  // "password: valore", "token = valore".
  /\b(?:password|passwd|pwd|passphrase|pin|token|api[ _-]?key|secret|segreto|chiave(?: api| segreta| privata)?)\s*[:=]\s*\S{4,}/i,
  // "la password è Valore123": dopo il verbo, una parola con cifre o simboli.
  /\b(?:password|passwd|passphrase|pin)\b[^.\n]{0,20}?\s(?:è|e'|sono)\s+["'«]?(?=\S*[\d!@#$%^&*])\S{4,}/i,
];

/** Vero se il testo ha l'aspetto di contenere una password, una chiave o un gettone. */
export function sembraUnSegreto(testo: string): boolean {
  return FORME.some((forma) => forma.test(testo));
}

export const RIFIUTO_SEGRETO =
  "Sembra contenere una password, una chiave o un altro segreto: non può essere conservato. " +
  "Riscrivilo senza il valore, oppure lascia perdere.";
