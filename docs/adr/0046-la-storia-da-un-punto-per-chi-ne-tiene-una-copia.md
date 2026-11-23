---
status: accepted
---

# La storia da un punto, per chi ne tiene una copia

Il 23 novembre 2026 il proprietario ha confermato una proposta nata dal progetto Shinka Desktop, un client per Windows che tiene in una cache locale tutte le conversazioni per aprirle subito e leggerle senza connessione. Per tenerla aggiornata deve chiedere al centro che cosa c'è di nuovo dopo ciò che ha già. Fino a qui l'unico modo di avere una storia era il flusso degli eventi, che la manda tutta dal primo evento, prepara il motore e conta come pagina che segue la conversazione; e nulla diceva se una copia presa prima valeva ancora, perché `taglia` riscrive l'archivio e all'apertura i numeri degli eventi possono essere riassegnati.

## Decisioni

- **La versione dell'archivio.** Ogni archivio ha una versione: una stringa casuale che resta la stessa finché all'archivio si aggiungono eventi in fondo, e cambia quando eventi già dati potrebbero non valere più:
  - con un taglio (`Canale.taglia`);
  - all'apertura, se l'ultima riga era spezzata o una riga era persa: l'archivio si riscrive con i numeri giusti, una volta sola, e la versione cambia;
  - per un archivio nuovo, o senza il suo file della versione;
  - se l'archivio ha meno eventi di quanti ne diceva il file della versione.
- **Il file della versione** sta accanto all'archivio, `<archivio>.versione`, con la versione, il numero dell'ultimo evento e la lunghezza dell'archivio in byte. Il canale lo riscrive a ogni evento archiviato. Così si sa fin dove arriva un archivio senza leggerlo, e la lunghezza dice se nel frattempo è cambiato: se non coincide l'archivio si rilegge.
- **La versione non entra nelle copie di sicurezza.** Un archivio ripristinato, o portato su un altro server, ne prende una nuova: chi ne ha una copia può avere eventi che quello ripristinato non ha, e con la stessa versione non lo saprebbe.
- **Le rotte della storia**, di sola lettura: `GET /api/progetti/:id/storia` e `GET /api/argomenti/:id/storia` (anche per l'argomento aperto della Home), con `dopo`, `limite` e `versione`. Rispondono con `PezzoDiStoria`: `versione`, `ultimo`, gli `eventi` archiviati dopo `dopo` in ordine (al massimo `limite`, e non più di 1000), `altri` se ce ne sono ancora. Gli eventi sono quelli della storia leggera, calcolata sull'archivio intero: il dettaglio di un'azione si chiede con la rotta delle azioni. Niente frammenti di testo né eventi ricordati.
- **Nessun effetto.** Le rotte della storia non preparano il motore e non contano come pagina che segue la conversazione. Un argomento archiviato viene caricato in memoria, come quando lo si cerca.
- **`daCapo`.** Se la `versione` chiesta non è quella dell'archivio, o `dopo` è oltre la fine, il pezzo comincia dall'inizio e lo dice: la copia che si aveva va buttata.
- **Il flusso che riprende.** I flussi di un progetto, di un argomento e della Home accettano `dopo` e `versione`. Se la copia vale mandano solo gli eventi archiviati dopo `dopo`, poi i testi in corso e gli eventi ricordati, poi la fine della storia e i nuovi; altrimenti prima `azzera` e poi tutta la storia, come la Home al cambio di argomento. Un testo in corso arriva intero, in un frammento solo: chi riprende butta ciò che ne aveva. Senza `versione` il flusso è quello di sempre. La fine della storia (`storia`) porta ora l'indice dell'archivio, `{ ultimo, versione }`, anche per il sito, che non lo legge.
- **Gli indici nel quadro.** Ogni progetto dell'elenco ha `ultimo` e `versione`; ogni argomento archiviato pure, e lo stato degli argomenti ha `aperto` per quello aperto; il messaggio `home` ha `argomento: { id, ultimo, versione }`. Sono giusti ogni volta che l'elenco viene mandato, cioè almeno quando una conversazione comincia o smette di lavorare o di aspettare il proprietario. Dopo un passaggio di argomento, che taglia e chiude l'archivio di quello di prima dopo che l'elenco è già partito, elenco e Home vengono rimandati.
- **Gli elenchi sono completi.** Gli elenchi di progetti e di argomenti del quadro contengono sempre tutti i progetti e tutti gli argomenti: uno che non c'è è stato eliminato, o dimenticato perché vuoto, e chi ne ha una copia la toglie.

## Conseguenze

- A ogni evento archiviato il centro scrive un file piccolo in più.
- La prima volta che il quadro elenca un argomento archiviato senza file della versione, il centro ne legge l'archivio per contarne gli eventi: succede una volta per argomento, dopo l'installazione.
- Dopo un ripristino o un trasloco ogni conversazione ha una versione nuova, e chi ne ha una copia la riscarica tutta.
- Un archivio cambiato a mano tenendo la stessa lunghezza non viene riconosciuto come cambiato.
- La specifica non cambia: le rotte sono per un client del proprietario, che entra con la sua password come il sito.
