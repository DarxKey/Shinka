/**
 * Una conversazione di prova per guardare l'interfaccia: messaggi del proprietario, risposte con
 * codice, elenchi, tabelle, formule e un diagramma, azioni, una lista di cose da fare, un piano,
 * un ragionamento e un permesso che aspetta. Serve alle prove a vista.
 */

import type { Banco } from "./banco.ts";

export const RISPOSTA_CON_CODICE = `Ecco come leggere il file e contare le righe:

\`\`\`ts
import { readFile } from "node:fs/promises";

export async function contaRighe(percorso: string): Promise<number> {
  const testo = await readFile(percorso, "utf8");
  return testo.split("\\n").length; // anche l'ultima
}
\`\`\`

E da terminale:

\`\`\`bash
wc -l src/**/*.ts | sort -n | tail -5
\`\`\`

| Comando | Che cosa fa |
|---|---|
| \`wc -l\` | conta le righe |
| \`sort -n\` | ordina per numero |

La crescita è $O(n \\log n)$, e in generale:

$$\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}$$

\`\`\`mermaid
flowchart LR
  A[Proprietario] --> B(Home)
  B --> C{Progetto?}
  C -->|sì| D[Progetto]
  C -->|no| E[Risposta]
\`\`\`

Fonti: [Node.js: fs/promises](https://nodejs.org/api/fs.html), [GNU coreutils: wc](https://www.gnu.org/software/coreutils/wc)
`;

export function chatDiProva(banco: Pick<Banco, "home">): void {
  const home = banco.home;
  home.emetti({ tipo: "messaggio-proprietario", id: "m1", testo: "Come conto le righe dei file TypeScript?\n\n- in Node\n- da terminale" });
  home.emetti({ tipo: "turno-iniziato" });
  home.emetti({ tipo: "ragionamento", idRagionamento: "r1", testo: "Il proprietario vuole due modi: uno in codice, uno dal terminale. Mostro entrambi, con una tabella." });
  home.emetti({ tipo: "azione-iniziata", idAzione: "a1", strumento: "Glob", ingresso: { pattern: "src/**/*.ts" } });
  home.emetti({ tipo: "azione-conclusa", idAzione: "a1", esito: "src/a.ts\nsrc/b.ts", errore: false });
  home.emetti({ tipo: "azione-iniziata", idAzione: "a2", strumento: "Bash", ingresso: { command: "wc -l src/**/*.ts" } });
  home.emetti({ tipo: "azione-conclusa", idAzione: "a2", esito: "  12 src/a.ts\n  30 src/b.ts\n  42 total", errore: false });
  home.emetti({ tipo: "testo-iniziato", idTesto: "t1" });
  home.emetti({ tipo: "testo-concluso", idTesto: "t1", testo: RISPOSTA_CON_CODICE });
  home.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 8000 });
  home.emetti({ tipo: "messaggio-proprietario", id: "m2", testo: "Perfetto. Ora sistema il progetto del blog." });
  home.emetti({ tipo: "turno-iniziato" });
  home.emetti({
    tipo: "azione-iniziata",
    idAzione: "p1",
    strumento: "TodoWrite",
    ingresso: {
      todos: [
        { content: "Leggere il codice del blog", status: "completed", activeForm: "Leggo il codice del blog" },
        { content: "Correggere le date", status: "in_progress", activeForm: "Correggo le date" },
        { content: "Aggiungere le prove", status: "pending", activeForm: "Aggiungo le prove" },
      ],
    },
  });
  home.emetti({ tipo: "azione-conclusa", idAzione: "p1", esito: "Todos have been modified successfully.", errore: false });
  home.emetti({ tipo: "azione-iniziata", idAzione: "a3", strumento: "Edit", ingresso: { file_path: "/progetti/blog/src/date.ts", old_string: "a", new_string: "b" } });
  home.emetti({ tipo: "permesso-richiesto", idPermesso: "a3", idAzione: "a3", strumento: "Edit", ingresso: { file_path: "/progetti/blog/src/date.ts", old_string: "a", new_string: "b" } });
}
