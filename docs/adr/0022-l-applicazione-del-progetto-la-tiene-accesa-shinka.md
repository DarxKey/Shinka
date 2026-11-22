---
status: accepted
---

# L'applicazione del progetto la tiene accesa Shinka

Dal 12 novembre 2026 ([ADR 0007](0007-terminale-che-resta-acceso-e-anteprima-attraverso-il-centro.md)) l'anteprima mostra l'applicazione web di un progetto che gira su `localhost` nel suo ambiente. Ad avviarla però era Claude, con un comando suo, in background: quando Shinka si riavviava l'applicazione non c'era più, e nemmeno l'anteprima aperta, e il proprietario doveva chiedere in chat di riattivarla. Il 16 novembre 2026 ha chiesto un pulsante per avviarla e fermarla, il ripristino dopo un riavvio, e lo stesso meccanismo per gli agenti.

## Decisioni

- **Il progetto dice come si avvia, Shinka la avvia.** Il comando, che resta in primo piano, e la porta stanno nel registro dei progetti. Li imposta il progetto con `imposta_anteprima`, che segue il modo dei permessi perché è un comando che Shinka eseguirà poi da sola, oppure il proprietario dal pannello dell'anteprima. L'ambiente avvia il comando nella cartella del progetto, ne tiene le ultime righe e lo ferma con tutto ciò che ha avviato.
- **Avviare, fermare, sapere com'è: idempotenti.** Avviare un'applicazione accesa non ne avvia un'altra; fermarne una ferma non è un errore. Se sulla porta risponde già qualcosa che Shinka non ha avviato, Shinka non ne avvia una seconda, e lo dice.
- **Voluta accesa.** Avviata, l'applicazione resta voluta finché qualcuno non la ferma. Spegnendosi, il centro o il nodo fermano le loro applicazioni; ripartendo, il centro rilancia quelle volute del suo ambiente, e quelle di un altro ambiente quando il suo nodo si ricollega.
- **L'anteprima resta del proprietario.** Avviata dal suo pulsante, l'anteprima si apre insieme. Gli agenti avviano e fermano l'applicazione, ma non aprono l'anteprima: la propongono, come prima. L'anteprima aperta si ricorda, e dopo un riavvio è aperta com'era, perché era una scelta del proprietario.
- **Un meccanismo solo.** Pulsante, ripristino e strumenti degli agenti (`avvia_anteprima`, `ferma_anteprima`, `stato_anteprima`, anche dalla Home indicando il progetto) passano tutti dalla stessa strada.

## Considered Options

- **Uno script nel repository del progetto** (per esempio `.shinka/anteprima.sh start|stop|status`). Il proprietario ne parlava così. Scartata come forma, non come idea: ogni progetto dovrebbe scrivere da sé l'avvio, l'arresto e il controllo, anche su Windows, e Shinka non saprebbe se l'applicazione gira davvero. Con un comando solo, tenuto da Shinka, start, stop e stato sono uguali per tutti.
- **Rilanciare il comando di Claude dopo un riavvio.** Scartata: un comando in background non si sa fermare né controllare.

## Consequences

- Il comando deve restare in primo piano: uno che si stacca e finisce subito risulta "fallito", con la spiegazione.
- Un'applicazione avviata fuori da Shinka, per esempio dal terminale, si vede come tale e non si ferma dal pulsante.
- I nodi vanno aggiornati: uno di prima non sa avviare un'applicazione, e il pulsante lo dice.
