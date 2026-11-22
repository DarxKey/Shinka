import assert from "node:assert/strict";
import { test } from "node:test";
import { erroreNelFormato } from "../prove/telegram-di-prova.ts";
import { senzaFormato } from "../protocollo/telegram.ts";
import { accorcia, aPezzi, inFormatoTelegram, PEZZO_MASSIMO, senzaImmagini } from "./telegram-testo.ts";

test("il Markdown di Claude diventa i pochi segni che Telegram conosce", () => {
  const uscita = inFormatoTelegram(
    [
      "## Stato dei progetti",
      "",
      "- **Videogioco**: fermo, _aspetta te_",
      "- `npm test` passa; vedi [il registro](https://esempio.it/a_b?x=1&y=2)",
      "",
      "Prezzo: 3 * 4 = 12, e 5 < 6 & 7 > 2. Il file si chiama mio_file_nuovo.txt.",
      "---",
      "~~vecchio~~ *nuovo*",
    ].join("\n"),
  );
  assert.equal(
    uscita,
    [
      "<b>Stato dei progetti</b>",
      "",
      "• <b>Videogioco</b>: fermo, <i>aspetta te</i>",
      '• <code>npm test</code> passa; vedi <a href="https://esempio.it/a_b?x=1&amp;y=2">il registro</a>',
      "",
      "Prezzo: 3 * 4 = 12, e 5 &lt; 6 &amp; 7 &gt; 2. Il file si chiama mio_file_nuovo.txt.",
      "———",
      "<s>vecchio</s> <i>nuovo</i>",
    ].join("\n"),
  );
  assert.equal(erroreNelFormato(uscita), undefined);
});

test("il codice e le tabelle restano come sono, a larghezza fissa", () => {
  const uscita = inFormatoTelegram(
    ["Ecco:", "```ts", "const a = b < c && **d**;", "```", "", "| Nome | Stato |", "|---|---|", "| Blog | _fermo_ |", "", "Un indirizzo: https://esempio.it/un_file_lungo.txt"].join(
      "\n",
    ),
  );
  assert.equal(
    uscita,
    [
      "Ecco:",
      "<pre>const a = b &lt; c &amp;&amp; **d**;</pre>",
      "",
      "<pre>| Nome | Stato |\n|---|---|\n| Blog | _fermo_ |</pre>",
      "",
      "Un indirizzo: https://esempio.it/un_file_lungo.txt",
    ].join("\n"),
  );
  assert.equal(erroreNelFormato(uscita), undefined);
  // Un blocco di codice rimasto aperto non rompe il messaggio.
  assert.equal(erroreNelFormato(inFormatoTelegram("```\nsenza fine <b>")), undefined);
});

test("i segni messi a caso non producono un formato che Telegram rifiuterebbe", () => {
  for (const testo of [
    "**grassetto con _corsivo dentro_ e fine**",
    "un *asterisco solo e un _trattino solo",
    "__init__.py e **kwargs e *args",
    "a < b > c & d <script>alert(1)</script>",
    "# Titolo con `codice` e **grassetto**",
    "[collegamento rotto](non-un-indirizzo) e [altro](https://x.y/z)",
    "* voce con *corsivo* e fine",
    "2 * 3 * 4",
  ]) {
    const uscita = inFormatoTelegram(testo);
    assert.equal(erroreNelFormato(uscita), undefined, `${testo} → ${uscita}`);
  }
  assert.equal(inFormatoTelegram("2 * 3 * 4"), "2 * 3 * 4");
  assert.equal(senzaFormato(inFormatoTelegram("a < b & c")), "a < b & c");
});

test("un testo lungo viene diviso in pezzi che stanno in un messaggio, senza perdere nulla", () => {
  const righe = Array.from({ length: 400 }, (_, i) => `Riga numero ${i} di un resoconto piuttosto lungo.`);
  const pezzi = aPezzi(righe.join("\n"));
  assert.ok(pezzi.length > 1);
  for (const pezzo of pezzi) assert.ok(pezzo.length <= PEZZO_MASSIMO, `${pezzo.length}`);
  assert.equal(pezzi.join("\n"), righe.join("\n"));
  assert.deepEqual(aPezzi("breve"), ["breve"]);
  assert.deepEqual(aPezzi("   \n"), []);

  // Una riga sola più lunga di un messaggio viene spezzata.
  const lunga = aPezzi("x".repeat(9000), 1000);
  assert.ok(lunga.every((pezzo) => pezzo.length <= 1000));
  assert.equal(lunga.join(""), "x".repeat(9000));
});

test("un blocco di codice a cavallo di due pezzi viene chiuso e riaperto", () => {
  const codice = Array.from({ length: 60 }, (_, i) => `riga ${i} del codice`);
  const pezzi = aPezzi(["Prima.", "```", ...codice, "```", "Dopo."].join("\n"), 400);
  assert.ok(pezzi.length > 2);
  for (const pezzo of pezzi) {
    assert.ok(pezzo.length <= 400, `${pezzo.length}`);
    // In ogni pezzo i recinti sono pari: il codice resta codice, il resto resta testo.
    assert.equal((pezzo.match(/```/g) ?? []).length % 2, 0, pezzo);
    assert.equal(erroreNelFormato(inFormatoTelegram(pezzo)), undefined);
  }
  const tutto = pezzi.map((pezzo) => inFormatoTelegram(pezzo)).join("\n");
  for (const riga of codice) assert.ok(tutto.includes(riga), riga);
  assert.match(inFormatoTelegram(pezzi.at(-1) ?? ""), /<\/pre>\nDopo\.$/);
});

test("accorcia dice che il testo continua", () => {
  assert.equal(accorcia("  breve  ", 10), "breve");
  assert.equal(accorcia("un testo più lungo del consentito", 12), "un testo pi…");
  assert.ok(accorcia("x".repeat(100), 20).length <= 20);
});

test("su Telegram le immagini escono dal testo: arrivano a parte, come foto", () => {
  const testo = [
    "Tre tappe:",
    "",
    "1. ![Tempio](https://esempio.org/Tempio_(Shanghai).jpg) **Tempio** · 1 ora",
    "   Un tempio buddista.",
    "2. ![M50](https://esempio.org/m50.jpg)",
    "",
    "![Alberi](https://esempio.org/alberi.jpg)",
    "",
    "",
    "Buon viaggio.",
  ].join("\n");
  assert.equal(senzaImmagini(testo), "Tre tappe:\n\n1. **Tempio** · 1 ora\n   Un tempio buddista.\n\nBuon viaggio.");
  assert.equal(inFormatoTelegram("Ecco ![foto](https://esempio.org/a.jpg) e [mappa](https://maps.google.com)"), 'Ecco  e <a href="https://maps.google.com">mappa</a>');
});
