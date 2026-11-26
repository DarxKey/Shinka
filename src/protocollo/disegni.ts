/**
 * I disegni nel testo delle risposte (ADR 0066): i diagrammi Mermaid, che l'interfaccia disegna a
 * riquadro, e il riquadro di cifre, un blocco di Shinka per bilanci, totali e conti. Qui le
 * istruzioni che li insegnano alla Home e ai progetti, e la lettura del riquadro, la stessa per
 * l'interfaccia e per il centro.
 */

/** Il linguaggio del blocco di codice che diventa un riquadro di cifre. */
export const LINGUAGGIO_RIQUADRO = "riquadro";

export interface RigaDelRiquadro {
  voce: string;
  /** La cifra, o ciò che sta a destra. */
  valore?: string;
  /** Una nota breve, sotto la voce. */
  nota?: string;
  /** Il segno del valore: in verde ciò che entra, in rosso ciò che esce. */
  segno?: "piu" | "meno";
}

export interface Riquadro {
  titolo?: string;
  righe: RigaDelRiquadro[];
  /** Le righe che cominciano con «>»: una spiegazione sotto il riquadro. */
  note: string[];
}

/** Il segno di un valore: «+» per ciò che entra, «-», «−» o «–» per ciò che esce. */
function segnoDi(valore: string): RigaDelRiquadro["segno"] {
  if (/^\+/.test(valore)) return "piu";
  if (/^[-−–]\s*\d/.test(valore)) return "meno";
  return undefined;
}

/** Legge un riquadro: «# titolo», righe «voce | valore | nota», e «> nota» sotto. */
export function leggiRiquadro(testo: string): Riquadro {
  const riquadro: Riquadro = { righe: [], note: [] };
  for (const grezza of testo.split(/\r?\n/)) {
    const riga = grezza.trim();
    if (riga === "") continue;
    if (riga.startsWith("# ") && riquadro.titolo === undefined && riquadro.righe.length === 0) {
      riquadro.titolo = riga.slice(2).trim();
      continue;
    }
    if (riga.startsWith(">")) {
      riquadro.note.push(riga.replace(/^>\s?/, ""));
      continue;
    }
    const [voce = "", valore, nota] = riga.split("|").map((parte) => parte.trim());
    if (voce === "" && (valore === undefined || valore === "")) continue;
    const segno = valore === undefined ? undefined : segnoDi(valore);
    riquadro.righe.push({
      voce,
      ...(valore === undefined || valore === "" ? {} : { valore }),
      ...(nota === undefined || nota === "" ? {} : { nota }),
      ...(segno === undefined ? {} : { segno }),
    });
  }
  return riquadro;
}

/** Ciò che la Home e i progetti sanno dei disegni nelle risposte. */
export const ISTRUZIONI_DISEGNI = `# Disegni nelle risposte

Quando un concetto si capisce meglio visto che letto, mostralo con un disegno nel testo della risposta: un bilancio, chi deve dare che cosa a chi, i passaggi di un procedimento, come sono collegate le parti di un sistema, l'andamento di una cifra. Non in ogni risposta: solo quando il disegno dice qualcosa che il testo direbbe peggio. Prima o dopo, una frase che dice che cosa mostra.

- **Riquadro di cifre**, per bilanci, totali, conti e pochi valori da leggere a colpo d'occhio: un blocco di codice \`riquadro\`, con un titolo facoltativo in cima («# titolo»), una riga per voce «nome | valore», e se serve un terzo campo con una nota breve. Un valore che comincia con «+» si colora di verde, con «−» di rosso. Le righe che cominciano con «>» vanno sotto, come spiegazione.
- **Diagramma Mermaid** (blocco \`mermaid\`): \`flowchart LR\` per flussi e passaggi, anche con l'importo sulla freccia; \`sequenceDiagram\` per scambi tra parti; \`timeline\` per date; \`pie\` per parti di un tutto; \`xychart-beta\` per barre e linee. Pochi nodi, etichette brevi, niente stili o colori scritti a mano: l'aspetto lo dà Shinka.
- **Tabella Markdown** per confronti con più colonne.

Per esempio, per chiudere i conti di un viaggio:

\`\`\`riquadro
# Bilancio del viaggio
Tu | −35,17 €
Bruno | −681,73 €
Alice | +716,90 €
\`\`\`

\`\`\`mermaid
flowchart LR
  Tu -- "35,17 €" --> Alice
  Bruno -- "681,73 €" --> Alice
\`\`\``;
