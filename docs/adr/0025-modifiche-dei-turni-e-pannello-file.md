---
status: accepted
---

# Le modifiche dei turni e il pannello File

Il 18 novembre 2026, con la prima parte del gruppo C, i progetti hanno due schede nuove accanto alla chat: Modifiche e File. Le scelte del proprietario: annullare per file e per turno; il pannello File in sola lettura, con i commenti sulle righe; anteprime di testo, Markdown, immagini, PDF, video e audio.

## Decisioni

- **Le versioni di prima le tiene Shinka, non l'harness.** I punti di controllo dell'harness riportano indietro tutti i file insieme, a un messaggio, e non dicono che cosa c'era prima. Un controllo prima di Edit, MultiEdit, Write e NotebookEdit legge il file e ne tiene la versione, la prima volta che il turno lo tocca; a fine turno si guarda com'è, e restano solo i file cambiati davvero. Non decide nulla: l'azione va avanti come avrebbe fatto.
- **Ciò che cambia un comando non c'è.** Come nei punti di controllo dell'harness, Bash e il terminale restano fuori; il pannello lo dice. _Dal 22 novembre 2026 non vale più: i file cambiati dai comandi entrano con le fotografie dei file, [ADR 0041](0041-le-modifiche-dei-comandi-con-le-fotografie-dei-file.md)._
- **Le versioni stanno dove gira la conversazione**, nei dati del nodo o del centro, una cartella per progetto, con i soli ultimi 40 turni; un file oltre 1 MB, o che non è testo, non si tiene. Nella storia della conversazione resta solo il riassunto (file, righe aggiunte e tolte): le versioni si chiedono quando il proprietario apre un file.
- **Riportare com'era non tocca un file cambiato ancora dopo il turno**: si perderebbe ciò che è venuto dopo. Claude ne viene avvisato con una nota, perché non continui sui file che aveva lasciato. Mentre Claude lavora non si riporta nulla. "Accetta" non tocca i file: segna che il proprietario li ha visti.
- **Il confronto riga per riga è nostro** (Myers, con un tetto oltre il quale il testo vale come sostituito), lo stesso al nodo per contare e nell'interfaccia per mostrare: niente librerie in più.
- **Un file del progetto non agisce mai come una pagina di Shinka.** Il centro serve il testo, anche HTML e SVG, sempre come testo, e il resto con un recinto senza script (`Content-Security-Policy: sandbox`), tranne il PDF, che il browser in un recinto non mostrerebbe. Il percorso non esce dalla cartella del progetto, nemmeno seguendo un collegamento simbolico. L'anteprima mostra file fino a 10 MB.
- **I commenti sulle righe stanno nel browser** finché non partono: entrano in testa al messaggio, con il file, la riga e il suo testo.

## Consequences

- Un nodo di prima di questa versione non tiene le modifiche e non mostra i file: va aggiornato.
- Le modifiche dei turni fatti prima di questa versione non ci sono.
