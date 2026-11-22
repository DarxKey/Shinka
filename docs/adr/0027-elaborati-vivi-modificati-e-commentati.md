---
status: accepted
---

# Elaborati vivi, modificati a mano e commentati

Il 18 novembre 2026, con il gruppo G, gli elaborati della Home si possono aggiornare, modificare a mano e commentare. Le scelte del proprietario: l'aggiornamento parte con un pulsante; a mano si modificano Markdown e testo; i commenti partono con il prossimo messaggio.

## Decisioni

- **Un elaborato vivo ha il suo comando nella storia.** `mostra_elaborato` accetta `aggiorna`, il comando che rifà il file nella cartella dell'argomento; resta nell'evento `elaborato-mostrato`. «Aggiorna» lo esegue nel suo ambiente, al più tre minuti. Il comando viene sempre dalla storia dell'argomento, mai da chi chiede: dal browser si indicano solo argomento, ambiente e file. Il proprietario lo legge accanto al pulsante prima di premerlo: niente parte da sé all'apertura.
- **Le pagine HTML possono già essere vive da sé**: nel loro recinto possono leggere dati da qualunque indirizzo. Le istruzioni della Home lo dicono.
- **A mano si riscrivono solo gli elaborati consegnati di testo e Markdown**, cioè quelli che la Home ha mostrato; il file torna dov'era, nell'ambiente dell'argomento.
- **Modifiche e commenti arrivano alla Home come i commenti sulle righe**: aspettano sopra il campo della Home e partono in testa al prossimo messaggio, con il file, l'ambiente, l'argomento e il pezzo citato. Una modifica a mano vi aggiunge da sola un avviso, perché Claude rilegga il file prima di cambiarlo.

## Consequences

- Un argomento archiviato non riceve i commenti: arrivano alla Home aperta, con l'identificativo dell'argomento, e Claude può riprenderlo.
- I commenti stanno nel browser in cui sono scritti, finché non partono.
