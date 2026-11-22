---
status: accepted
---

# La pagina di un ambiente: risorse, processi e container

Il 21 novembre 2026 il proprietario ha chiesto una gestione degli ambienti più dettagliata: grafici delle risorse in tempo reale, processi attivi e, su Linux con Docker, i container con risorse e stato. Su Unraid, il suo ambiente principale, Shinka gira in un container senza accesso a Docker, per regola: da lì si vedono processore e memoria del server, ma solo i processi di Shinka e nessun container. Il 22 novembre ha scelto che i container di Unraid li legga il gateway, in sola lettura.

## Decisioni

- **Legge il nodo, quando qualcuno guarda.** La pagina chiede un campione ogni tre secondi finché è aperta e in primo piano; il nodo (o il centro, per il suo ambiente) misura tra una richiesta e l'altra. Nessun campionamento in sottofondo e nessuna storia sul disco: i grafici tengono in pagina gli ultimi cinque minuti.
- **Che cosa legge** (`src/nodo/risorse.ts`): processore dai tempi dei nuclei; memoria, su Linux, da quella disponibile; il disco della cartella dei progetti; il carico; se gira in un container, la memoria del container e i suoi tetti. I processi: su Linux da `/proc`, con il processore di ciascuno dalla differenza tra due letture; su Windows da PowerShell, ogni otto secondi, perché costa; altrove da `ps`. I venti che pesano di più.
- **Docker dal nodo, dove lo vede**: `docker ps` e `docker stats`, ogni otto secondi, senza far aspettare gli altri numeri. Se manca, o se l'utente del nodo non lo può usare, la pagina lo dice.
- **Docker dal gateway, dove il nodo non lo vede.** Il gateway ha già la credenziale degli host per gli stack: con quella esegue un comando fisso, di sola lettura (`docker ps -a` e `docker stats --no-stream`), su ognuno, e il centro mostra il risultato nella pagina del suo ambiente. Il centro non sceglie il comando e non riceve altro; a vault chiuso non si legge. Le letture non aspettano le operazioni sugli stack, e il centro tiene ogni lettura per dieci secondi.
- **Il registro non si riempie.** La regola è che ogni uso di una credenziale finisca nel registro. Una riga ogni tre secondi lo renderebbe illeggibile: per questa lettura, e solo per questa, il registro prende una riga per host ogni quarto d'ora in cui la pagina resta aperta, che dice che la lettura si ripete.
- **Solo per il proprietario.** È una pagina, non uno strumento: le conversazioni non ricevono processi né container. Le righe di comando dei processi possono contenere segreti, e restano tra il nodo e il browser del proprietario.
- **Si guarda soltanto.** Niente «termina processo» né «ferma container» dalla pagina: per quelli restano il terminale, le conversazioni e le approvazioni.

## Considered Options

- **Montare il socket di Docker nel container di Shinka.** Vedrebbe tutto, ma chi comanda quel socket comanda il server: è ciò che la specifica esclude.
- **Campionare sempre e tenere una storia.** Grafici lunghi, ma lavoro continuo su ogni macchina per una pagina che si apre ogni tanto.
- **Solo ciò che vede il nodo.** Su Unraid la pagina non mostrerebbe i container, che è ciò che il proprietario voleva vedere.

## Consequences

- La specifica passa alla versione 2.16: sezioni 4.3, 4.9 e 6, prove da A71 ad A73.
- Cambia il gateway: dopo l'installazione chiede il suo sì, e il vault va riaperto. Cambia ciò che usano i nodi: uno di una versione precedente non sa dire le sue risorse, e la pagina lo dice.
- Su Unraid i processi restano quelli del container di Shinka: quelli del server non si vedono, e la pagina lo spiega.
- I container dell'host per gli stack compaiono nella pagina dell'ambiente del centro, perché il gateway è del centro: se l'host è un'altra macchina, lo dice il suo nome.
