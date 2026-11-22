---
status: accepted
---

# Scheda della sessione, attività e vista affiancata

Il 18 novembre 2026, con la seconda parte del gruppo C, la chat ha una scheda della sessione, le attività visibili, l'avviso al 75% del contesto e la vista affiancata.

## Decisioni

- **Le attività vengono dai messaggi dell'harness sui compiti** (`task_started`, `task_progress`, `task_updated`, `task_notification`): comandi in background e agenti, in primo piano o in background. Quelli che l'harness segna come non lavoro (`ambient`, `skip_transcript`) non compaiono. Si tengono quelle in corso e le ultime 20 finite; l'elenco viaggia come un evento di cui conta l'ultimo, e i progressi si riferiscono al più una volta al secondo.
- **L'uscita si legge a richiesta**, dalla fine del file in cui l'harness la scrive (al più 64 KB), e solo per le attività che l'harness ha detto: nessun altro file passa da qui.
- **Il contesto si racconta con le parti dell'harness** (`getContextUsage`), con i nomi di Shinka; gli strumenti rimandati non contano.
- **"Compatta adesso" manda `/compact` come un messaggio**: l'harness lo riconosce come comando e compatta, senza risposta di Claude. Provato sull'harness vero.
- **La vista affiancata è solo per gli schermi larghi** (da 1100 px), con la Home o un progetto accanto, e non mentre il pannello del progetto è aperto: lo spazio è uno. La scelta resta nel browser. Il terminale e l'anteprima in una finestra propria restano come sono: l'anteprima si apre già in un'altra scheda.
- **Sul telefono la testata del progetto tiene solo Modifiche e File**: terminale e anteprima si raggiungono dalle schede del pannello.

## Consequences

- Un nodo di prima di questa versione non riferisce le attività e non sa leggerne l'uscita: va aggiornato.
- La miniatura viva di terminale e anteprima non c'è.
