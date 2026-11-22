---
status: accepted
---

# Ramo, domanda a parte e stile delle risposte

Il 18 novembre 2026, con la seconda parte del gruppo B, Shinka ha preso da Claude Desktop tre modi di usare una conversazione. Il proprietario ha scelto che il ramo ci sia solo nella Home.

## Decisioni

- **Un ramo è un argomento nuovo, e quello di prima si archivia.** Nella Home un solo argomento è aperto: il ramo non può stare accanto all'originale. Dal messaggio modificato l'harness copia la sua conversazione fino a prima di quello (`forkSession` con `upToMessageId`) e l'argomento nuovo riprende dalla copia. Quello aperto si archivia come in ogni passaggio, con titolo e riassunto scritti da Claude.
- **Il ramo lavora nella cartella di quello da cui nasce.** L'harness tiene le conversazioni per cartella di lavoro: la copia si riprende solo da lì. I file non tornano indietro; la nota al ramo lo dice a Claude. Nella storia del ramo i messaggi copiati non si modificano più, perché nella copia hanno altri identificativi, e la copia non porta con sé i punti di controllo dei file.
- **La domanda a parte è un processo a sé.** Riprende una copia non salvata della conversazione (`forkSession: true`, `persistSession: false`), senza strumenti e per una risposta sola: la conversazione vera non cambia e può intanto lavorare. La risposta torna a chi l'ha chiesta e non entra nell'archivio. Costa l'avvio di un processo, circa due secondi.
- **Lo stile è un'istruzione aggiunta, e viaggia con le impostazioni.** Non si usano gli stili di Claude Code, che la Home, con istruzioni sue, non avrebbe. L'interfaccia sceglie lo stile per identificativo; il centro mette nelle impostazioni lo stile intero, con le sue istruzioni, così vale anche negli altri ambienti. Gli stili del proprietario stanno al centro (`stili.json`); le loro istruzioni le scrive Claude una volta, con Sonnet, quando lo stile nasce.
- **Le istruzioni dei progetti non si fissano più alla conversazione** (`snapshot: false` anche con le istruzioni di Claude Code): altrimenti uno stile cambiato varrebbe solo dopo la prossima compattazione.

## Consequences

- Un ramo dal primo messaggio riparte da capo: non c'è nulla da copiare.
- Togliere uno stile dall'elenco non lo toglie alle conversazioni che lo usano: lo tengono finché il proprietario non ne sceglie un altro.
- Un nodo di prima di questa versione non sa rispondere alle domande a parte e ignora lo stile: va aggiornato.
