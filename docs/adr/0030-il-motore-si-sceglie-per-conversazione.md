---
status: accepted
---

# Il motore si sceglie per conversazione

Il 18 novembre 2026, subito dopo il primo pezzo del motore Codex, il proprietario ha chiesto che Claude e Codex convivano nella stessa Shinka, scegliendo il motore per ogni conversazione; una pagina Impostazioni con motori e accessi, ambiente del centro, password, indirizzi e HTTPS; e, per installare da zero, un file Compose con un primo avvio guidato, più uno script per preparare gli ambienti Linux e Windows. Sostituisce, per la scelta del motore, l'ADR 0029.

## Decisioni

- **Il motore sta nelle impostazioni della conversazione**, accanto al modello: la scelta del modello mostra i modelli di tutti e due i motori collegati. L'installazione ha un motore predefinito per le conversazioni nuove.
- **Cambiare motore a metà riparte con un riassunto.** Le sessioni di Claude Code e i thread di Codex non si passano il contesto: la conversazione ne apre uno nuovo con il motore scelto e gli consegna un riassunto di ciò che c'era, mentre la storia resta visibile nella chat. Ogni conversazione ricorda il suo identificativo per motore, così tornando al motore di prima riprende da lì.
- **Gli accessi si fanno dal browser**, con i flussi a codice dei due motori: Shinka mostra il codice e l'indirizzo, il proprietario conferma sul sito; nessuna password passa da Shinka.
- **Le impostazioni dell'installazione passano da variabili d'ambiente a un file tra i dati**, che la pagina Impostazioni scrive; le variabili restano come valori di partenza. Ciò che vuole un riavvio (porte, HTTPS) lo dice la pagina.
- **Un'installazione nuova**: un file Compose con centro e gateway; al primo avvio, senza password impostata, il browser mostra una procedura guidata. Gli ambienti si preparano con uno script per Linux (bash) e uno per Windows (PowerShell), che installano il nodo con il suo guardiano e lo collegano al centro.

## Consequences

- La specifica passa alla versione 2.10.
- Il piano in [docs/motore-codex.md](../motore-codex.md) si allunga: la Home con Codex resta il passo successivo, poi la scelta per conversazione, la pagina Impostazioni, il primo avvio guidato e gli script.
