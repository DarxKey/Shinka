---
status: accepted
---

# Un progetto in più ambienti

Il 23 novembre 2026 il proprietario ha chiesto di far lavorare insieme il progetto Shinka, su Unraid, e il progetto Shinka Desktop, sul PC, senza fare da tramite tra le due conversazioni. Tra due progetti che si scrivono e un progetto in più ambienti ha scelto il secondo, sapendo che cambia una regola della specifica: «un progetto vive in un solo ambiente» (sezione 4.4, versione 2.20).

## Decisioni

- **Il progetto ha ancora un ambiente suo.** Lì gira il suo motore, lì sono la sua cartella, il suo repository, il terminale, l'anteprima e il pannello File. Il progetto Shinka resta su Unraid, con il suo modo di installarsi.
- **Cartelle collegate.** Il proprietario gli collega cartelle di altri ambienti, una per ambiente e al massimo quattro, con il percorso completo, dalla scheda della sessione del progetto. Il centro controlla che l'ambiente sia acceso e che la cartella ci sia, e la ricorda con il suo percorso vero. Le collega e le scollega solo il proprietario; la conversazione del progetto lo viene a sapere con una nota.
- **Gli strumenti.** Nelle cartelle collegate il progetto lavora con cinque strumenti di Shinka: `cartelle_collegate`, `esegui_nella_collegata` (fino a 600 secondi, per una build), `leggi_nella_collegata`, `scrivi_nella_collegata` e `modifica_nella_collegata`, che cambia un pezzo di un file come Edit e va a capo come il file, anche con `\r\n`. Passano dal centro all'ambiente con il comando `azione-in-cartella`, come le azioni della Home.
- **I permessi come nel progetto**, per scelta del proprietario: comandi, file scritti e file modificati seguono il modo dei permessi del progetto; elencare le cartelle e leggere un file no, come Read.
- **Solo i progetti.** La Home ha già i suoi strumenti per agire negli ambienti, nella cartella di ogni argomento.
- **Il progetto Shinka Desktop sul PC** lo elimina il proprietario quando il collegamento funziona: la cartella resta, e due Claude sulla stessa cartella si pesterebbero i piedi.
- **Si pubblica anche da una cartella collegata.** La pubblicazione di Shinka Desktop ([ADR 0049](0049-shinka-desktop-si-aggiorna-dal-centro.md)) sceglie tra le cartelle dei progetti e le loro cartelle collegate, che il centro elenca; con una collegata, solo se è davvero del progetto indicato.

## Conseguenze

- Il repository di una cartella collegata è suo: i commit lì si fanno con un comando nella collegata, e non entrano nel repository del progetto.
- Un nodo di una versione precedente non conosce `azione-in-cartella`: il centro aspetta e dice di aggiornarlo.
- Con l'ambiente della cartella spento gli strumenti lo dicono, e il progetto continua nel suo ambiente.
- Le cartelle collegate non entrano nel pannello File, nel terminale né nell'anteprima: si potranno aggiungere se servono.
