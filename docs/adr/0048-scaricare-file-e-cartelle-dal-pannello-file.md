---
status: accepted
---

# Scaricare file e cartelle dal pannello File

Il 23 novembre 2026 il proprietario ha chiesto di poter scaricare file e cartelle dal pannello File di un progetto. Fino a qui il pannello mostrava un file in anteprima, fino a 10 MB, passandolo intero in un messaggio del nodo; per un file senza anteprima c'era un collegamento allo stesso indirizzo, con lo stesso limite.

## Decisioni

- **Un file così com'è, una cartella come ZIP.** Il proprietario ha scelto lo ZIP, che Windows, il Mac e il telefono aprono da soli. Con il percorso vuoto si scarica il progetto intero. Il nome è quello del file, o della cartella con `.zip`.
- **La cartella intera, com'è.** Per scelta del proprietario dentro lo ZIP va tutto: dipendenze, `.git`, ciò che si costruisce. Per questo lo ZIP è ZIP64 quando serve, oltre i 4 GB o i 65.535 file. Le cartelle vuote restano. I file già compressi (immagini, video, archivi, PDF) si mettono come sono, gli altri si comprimono.
- **Mai fuori dal progetto.** Un collegamento simbolico entra solo se porta a un file dentro il progetto; un collegamento a una cartella non si segue, per non girare in tondo.
- **A flusso, a pezzi, con una finestra.** Lo ZIP si scrive mentre i file si leggono (`src/nodo/zip.ts`), senza tenere l'archivio in memoria né su disco. L'ambiente lo manda a pezzi di 256 KB (`file-scarica-pezzo`) e non ne manda più di otto prima che il centro dica di andare avanti (`file-scarica-avanti`); il centro lo dice quando il browser ha preso i pezzi. Così un browser lento, o un telefono, non fa crescere la memoria del nodo né quella del centro.
- **Chi se ne va ferma tutto.** Se il browser chiude lo scaricamento a metà, il centro manda `file-scarica-annulla` e l'ambiente smette di leggere. Se il nodo si scollega, lo scaricamento si interrompe; se resta fermo due minuti, anche.
- **Nessun limite di dimensione**, oltre a quelli del formato ZIP64. L'anteprima resta fino a 10 MB; il collegamento «Scarica il file» dei file senza anteprima passa ora dallo scaricamento.
- **Nel pannello** un'icona per scaricare in fondo a ogni riga (compare passandoci sopra con il mouse, sul telefono c'è sempre), una accanto al percorso della cartella aperta, e una sul file in anteprima.

## Conseguenze

- Un nodo di una versione precedente non sa far scaricare: il centro aspetta un minuto e lo dice. I nodi tenuti dal loro guardiano si aggiornano da soli.
- Se un file si interrompe a metà lettura lo scaricamento si ferma, e il browser lo segna come non riuscito: il centro non può più cambiare la risposta.
- Lo ZIP non è cifrato: viaggia come il resto, in HTTPS se il proprietario lo usa.
