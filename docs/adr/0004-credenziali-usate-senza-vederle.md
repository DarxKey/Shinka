---
status: accepted
---

# Claude usa le credenziali senza vederle

Le credenziali del proprietario, per SSH e per i siti, stanno in un vault dentro il gateway. Claude ne chiede l'uso per nome, e il gateway la inserisce al suo posto: il valore non entra mai nella conversazione. Abbiamo scelto questo, l'11 novembre 2026, perché tutto ciò che entra in una conversazione resta nel suo archivio, può finire nella memoria, in una skill o in una risposta, e può essere chiesto da un testo ostile letto sul web. Una password che Claude non ha mai visto non può uscire da nessuna di queste strade.

## Considered Options

- **Claude legge le password quando gli servono.** La più semplice e la più flessibile: funziona con qualunque strumento. Scartata dal proprietario: una password letta resta nella conversazione e nel suo archivio.
- **Claude le legge solo con un'approvazione.** Copre i casi che il gateway non prevede. Scartata dal proprietario: dopo l'approvazione il valore è comunque nella conversazione.

## Consequences

- Ogni modo di usare una credenziale va costruito nel gateway: un comando su un host, l'accesso a un sito. Ciò che il gateway non sa fare, Claude non può farlo con quella credenziale.
- Per il browser il gateway deve inserire la password in una pagina senza che il modello la riveda: è la parte più delicata, e ha un incremento a sé.
- Ogni credenziale è legata all'host o al sito per cui è stata inserita, e il gateway la rifiuta altrove.
- Il proprietario inserisce e vede le credenziali solo dall'interfaccia. Nemmeno una sua richiesta in chat le mostra, nemmeno in una conversazione che lavora senza permessi.
- Il gateway, che finora doveva nascere con gli stack di prova, va costruito prima.
