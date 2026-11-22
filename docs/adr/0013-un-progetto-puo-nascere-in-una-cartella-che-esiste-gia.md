---
status: accepted
---

# Un progetto può nascere in una cartella che esiste già, e Shinka non la tocca

Il proprietario ha lavori cominciati per conto suo, come il gioco "Rougue AFK" in una cartella del PC Windows, e vuole farne progetti di Shinka senza copiarli né spostarli. Lo ha chiesto il 12 novembre 2026: "Voglio usare la cartella originale e magari nella proposta lasciarmi la scelta di cambiare il path a mano". Finora un progetto nasceva sempre in una cartella nuova, con `BRIEF.md` e un repository Git.

La proposta di progetto può ora indicare una cartella che esiste già nell'ambiente. La Home la indica con `cartella_esistente`, e la scheda la mostra in un campo che il proprietario può cambiare o svuotare; svuotato, il progetto nasce in una cartella nuova come prima. Alla conferma il nodo dell'ambiente controlla che il percorso sia completo, che esista e che sia una cartella, e dice se è un repository Git; il centro rifiuta una cartella che è già di un altro progetto dello stesso ambiente, oppure che ne contiene una o sta dentro una. Poi il progetto nasce lì.

## Considered Options

- **Un'opzione in più sul comando che crea la cartella.** Più breve, ma un nodo di prima ignorerebbe l'opzione e creerebbe comunque una cartella nuova accanto all'originale: proprio ciò che il proprietario non vuole. Il comando nuovo, `adotta-cartella`, un nodo di prima non lo conosce e non fa nulla; la conferma scade dicendo che va aggiornato.
- **Copiare la cartella in quella dei progetti.** Scartata dal proprietario.
- **Inizializzare Git se manca, come per le cartelle nuove.** Scartata dal proprietario: non va fatto di nascosto. La scheda lo dice, e il progetto lo propone se serve.

## Consequences

- **In una cartella adottata Shinka non scrive nulla**: niente `BRIEF.md`, niente `git init`, nessuna copia dei file dell'argomento. Il brief arriva al progetto come primo messaggio, come sempre, con una nota: la cartella esisteva già, non va riorganizzata senza chiedere, e se non è un repository Git lo si propone al proprietario.
- **Un progetto adottato può non avere un repository Git**, finché il proprietario non lo vuole. La sezione 4.4 della specifica dice che un progetto ha un repository: questa è un'eccezione chiesta dal proprietario, da scrivere lì se lo chiede.
- **Lo stato del progetto resta `STATO.md`**: in una cartella che ne ha già uno con un altro senso, il progetto lo userebbe. Non succede con la cartella di "Rougue AFK".
- Il percorso si confronta come lo scrive l'ambiente, senza badare alle maiuscole su Windows, e anche nella forma che ha sul disco.
- Il comando nuovo lo devono conoscere i nodi: quello del PC Windows va aggiornato prima di adottare una cartella lì.
