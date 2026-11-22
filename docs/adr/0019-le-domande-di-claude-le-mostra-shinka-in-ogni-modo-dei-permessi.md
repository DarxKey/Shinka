---
status: accepted
---

# Le domande di Claude le mostra Shinka, in ogni modo dei permessi

Claude Code ha uno strumento per porre domande prima di procedere (AskUserQuestion): fino a quattro, ciascuna con due-quattro risposte proposte e la possibilità di scriverne una propria. In Shinka non c'era una scheda per mostrarle: i progetti avevano lo strumento tolto, la Home non lo aveva. Il 15 novembre 2026 il proprietario ha chiesto di averle "come in Claude": quando servono più risposte prima di procedere, una scheda con le opzioni e "Altro".

## Decisioni

- **Le domande le raccoglie un controllo di Shinka.** Prima dello strumento gira un controllo nostro (un hook `PreToolUse`), come per il browser del PC ([ADR 0018](0018-nel-browser-del-pc-il-consenso-lo-chiede-shinka-in-ogni-modo-dei-permessi.md)). Mostra la scheda, aspetta il proprietario, e consente lo strumento con le risposte scritte nel suo ingresso (`answers`): l'harness le dà a Claude come risposte del proprietario. Vale in tutti e quattro i modi dei permessi: rispondere è sempre del proprietario, e nei modi in cui l'harness non chiede nulla la richiesta del permesso non arriverebbe.
- **Un messaggio in chat è una risposta.** Mentre le domande aspettano, un messaggio del proprietario non apre un turno nuovo: diventa la risposta a tutte, e Claude va avanti nello stesso turno. È così che si risponde da Telegram, dove le domande arrivano come messaggio con le risposte numerate.
- **Saltare si può.** Il controllo nega lo strumento con un motivo che dice a Claude di andare avanti con scelte ragionevoli. Se il turno viene interrotto o la conversazione si chiude, le domande si annullano.
- **Nessun permesso da chiedere.** Le domande non fanno nulla fuori dalla conversazione: non passano dalla scheda del consenso, e lo strumento non è tra quelli che il modo dei permessi governa.

Verificato sull'harness vero il 15 novembre 2026, con l'SDK 0.3.322 (`src/prove/domande-e-harness.ts`): nei quattro modi il controllo gira, l'harness non chiede il permesso, e Claude riceve le risposte. Il campo `response` dell'ingresso, che l'SDK descrive per una risposta data in chat, l'harness lo ignora se lo dà un controllo: per questo il messaggio in chat diventa la risposta a ogni domanda.

## Considered Options

- **Rispondere da `canUseTool`, come suggerisce la documentazione dell'SDK.** Scartata: in "Senza permessi" l'SDK non lo chiama, e le domande passerebbero senza risposte.
- **Lasciare lo strumento tolto e far chiedere a Claude nel testo.** Era la scelta di prima; il proprietario vuole la scheda.
- **Una risposta in chat come rifiuto motivato.** Claude la riceve come errore di un controllo; funziona, ma la risposta nell'ingresso è più naturale e Claude la tratta come una risposta.

## Consequences

- Le domande hanno una strada loro, accanto a quella dei permessi: un evento per porle e uno per chiuderle, una rotta per rispondere nella Home e nei progetti, un comando per i nodi. Un nodo non aggiornato ha ancora lo strumento tolto nei progetti, e lì non cambia nulla.
- Le domande di un progetto arrivano su Telegram come avviso, ma si rispondono dall'interfaccia: da Telegram i messaggi vanno alla Home.
- La prova sull'harness va rifatta a ogni cambio di SDK.
