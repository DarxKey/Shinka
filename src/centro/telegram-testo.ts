/**
 * Il testo di Claude, scritto in Markdown, come Telegram lo sa mostrare: pochi segni di formato
 * (grassetto, corsivo, codice, collegamenti) e messaggi che non superano la sua lunghezza massima.
 *
 * Se un testo esce con i segni messi male, Telegram lo rifiuta e il gateway lo rimanda nudo:
 * qui si cerca il buon risultato nei casi comuni, non la perfezione.
 */

import { testoPerTelegram } from "../protocollo/telegram.ts";

/** Quanto può essere lungo un pezzo: sotto il limite di Telegram, con un po' di margine. */
export const PEZZO_MASSIMO = 3900;

const RECINTO = /^\s*```/;

/**
 * Divide un testo Markdown in pezzi che stanno ciascuno in un messaggio. Taglia a fine riga, e
 * un blocco di codice spezzato viene chiuso in un pezzo e riaperto nel successivo.
 */
export function aPezzi(markdown: string, massimo: number = PEZZO_MASSIMO): string[] {
  const pezzi: string[] = [];
  let righe: string[] = [];
  let lunghezza = 0;
  let nelCodice = false;
  const chiudi = (): void => {
    const testo = (nelCodice ? [...righe, "```"] : righe).join("\n").trim();
    if (testo !== "") pezzi.push(testo);
    righe = nelCodice ? ["```"] : [];
    lunghezza = nelCodice ? 4 : 0;
  };
  for (const intera of markdown.replace(/\r\n/g, "\n").split("\n")) {
    // Una riga più lunga di un messaggio viene spezzata dove capita.
    const parti = intera.length <= massimo - 10 ? [intera] : (intera.match(new RegExp(`[\\s\\S]{1,${massimo - 10}}`, "g")) ?? [intera]);
    for (const riga of parti) {
      // Resta lo spazio per chiudere un blocco di codice aperto.
      if (lunghezza + riga.length + 1 > massimo - 4 && righe.length > 0) chiudi();
      righe.push(riga);
      lunghezza += riga.length + 1;
      if (RECINTO.test(riga)) nelCodice = !nelCodice;
    }
  }
  nelCodice = false;
  chiudi();
  return pezzi;
}

/** Un'immagine in Markdown; l'indirizzo può avere parentesi, come quelli di Wikipedia. */
const IMMAGINE = /!\[[^\]\n]*\]\((?:[^()\n]|\([^()\n]*\))*\)/g;

/**
 * Il testo senza le immagini scritte in Markdown: su Telegram arrivano a parte, come foto. Una riga
 * che aveva solo un'immagine sparisce, e non restano righe vuote in fila.
 */
export function senzaImmagini(markdown: string): string {
  return markdown
    .replace(/\r\n/g, "\n")
    .split("\n")
    .flatMap((riga) => {
      const senza = riga.replace(IMMAGINE, "").replace(/[ \t]+$/, "");
      if (senza === riga) return [riga];
      // Una voce di elenco che cominciava con l'immagine resta voce: tolto lo spazio in più.
      const pulita = senza.replace(/^(\s*(?:[-*+]|\d+[.)])\s)\s+/, "$1");
      return /^\s*(?:[-*+]|\d+[.)])?\s*$/.test(pulita) ? [] : [pulita];
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** I segni dentro una riga: codice, collegamenti, grassetto, corsivo, barrato. */
function nellaRiga(riga: string): string {
  const protetti: string[] = [];
  const proteggi = (html: string): string => `\u0000${protetti.push(html) - 1}\u0000`;
  let testo = riga
    // Le immagini arrivano a parte, come foto.
    .replace(IMMAGINE, "")
    // Il codice tra apici rovesciati resta com'è.
    .replace(/`([^`\n]+)`/g, (_tutto, codice: string) => proteggi(`<code>${testoPerTelegram(codice)}</code>`))
    // I collegamenti, e gli indirizzi scritti per esteso: i loro trattini bassi non sono corsivi.
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_tutto, scritto: string, indirizzo: string) =>
      proteggi(`<a href="${testoPerTelegram(indirizzo).replace(/"/g, "&quot;")}">${testoPerTelegram(scritto)}</a>`),
    )
    .replace(/https?:\/\/[^\s<>]+/g, (indirizzo) => proteggi(testoPerTelegram(indirizzo)));
  testo = testoPerTelegram(testo)
    .replace(/\*\*(?!\s)([^\n]+?)(?<!\s)\*\*/g, "<b>$1</b>")
    .replace(/(?<![\w_])__(?!\s)([^\n]+?)(?<!\s)__(?![\w_])/g, "<b>$1</b>")
    .replace(/~~(?!\s)([^\n]+?)(?<!\s)~~/g, "<s>$1</s>")
    .replace(/(?<![\w*])\*(?![\s*])([^*\n]+?)(?<![\s*])\*(?![\w*])/g, "<i>$1</i>")
    .replace(/(?<![\w_])_(?![\s_])([^_\n]+?)(?<![\s_])_(?![\w_])/g, "<i>$1</i>");
  // eslint-disable-next-line no-control-regex
  return testo.replace(/\u0000(\d+)\u0000/g, (_tutto, posto: string) => protetti[Number(posto)] ?? "");
}

/** Un testo Markdown nei segni di formato di Telegram. */
export function inFormatoTelegram(markdown: string): string {
  const uscita: string[] = [];
  const righe = markdown.replace(/\r\n/g, "\n").split("\n");
  for (let posto = 0; posto < righe.length; posto += 1) {
    const riga = righe[posto] ?? "";
    if (RECINTO.test(riga)) {
      // Un blocco di codice: tutto fino alla chiusura, o alla fine del testo, resta com'è.
      const codice: string[] = [];
      posto += 1;
      while (posto < righe.length && !RECINTO.test(righe[posto] ?? "")) {
        codice.push(righe[posto] ?? "");
        posto += 1;
      }
      uscita.push(`<pre>${testoPerTelegram(codice.join("\n"))}</pre>`);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(riga)) {
      // Una tabella: Telegram non le conosce. A larghezza fissa le colonne restano almeno allineate.
      const tabella = [riga];
      while (/^\s*\|.*\|\s*$/.test(righe[posto + 1] ?? "")) {
        posto += 1;
        tabella.push(righe[posto] ?? "");
      }
      uscita.push(`<pre>${testoPerTelegram(tabella.join("\n"))}</pre>`);
      continue;
    }
    const titolo = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(riga);
    if (titolo !== null) {
      uscita.push(`<b>${nellaRiga((titolo[1] ?? "").replace(/\*\*/g, ""))}</b>`);
      continue;
    }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(riga)) {
      uscita.push("———");
      continue;
    }
    const voce = /^(\s*)[-*+]\s+(.*)$/.exec(riga);
    if (voce !== null) {
      uscita.push(`${voce[1] ?? ""}• ${nellaRiga(voce[2] ?? "")}`);
      continue;
    }
    uscita.push(nellaRiga(riga));
  }
  return uscita.join("\n");
}

/** Accorcia un testo lungo, dicendo che continua. */
export function accorcia(testo: string, massimo: number): string {
  const pulito = testo.trim();
  return pulito.length <= massimo ? pulito : `${pulito.slice(0, massimo - 1).trimEnd()}…`;
}
