---
status: accepted
---

# Gli elaborati restano dove la Home li ha scritti, e si mostrano in un recinto

Il proprietario vuole rivedere ciò che la Home produce in una conversazione (liste, itinerari, documenti brevi, script, immagini, mappe) senza cercarlo nelle cartelle, e vedere una mappa direttamente nella chat. Lo ha chiesto il 12 novembre 2026, dopo che la Home gli aveva preparato un itinerario per i negozi di carte a Tokyo con una mappa che non poteva mostrare. Questi file li chiamiamo elaborati.

Un elaborato resta dove la Home lo ha scritto: nella cartella dell'argomento, nell'ambiente in cui è stato prodotto, come dice già la sezione 4.2 della specifica. Il centro non ne fa copie. Il pannello degli elaborati, accanto alla chat della Home e degli argomenti archiviati, li elenca ambiente per ambiente: quelli dell'ambiente del centro li legge da sé, quelli degli altri ambienti li chiede al nodo. La Home ne mostra uno nella chat con uno strumento suo, `mostra_elaborato`, che non chiede consenso perché mostra e basta: nella conversazione resta un evento con l'argomento, l'ambiente e il percorso, non il contenuto.

## Considered Options

- **Copiare ogni elaborato al centro quando la Home lo scrive.** Si vedrebbe anche con l'ambiente spento. Scartata per ora: i file si moltiplicherebbero, la copia invecchierebbe appena la Home lo ritocca con un comando, e le scritture fatte con un comando non passano da nessuno strumento da intercettare. Con l'ambiente spento il pannello dice che il file c'è, se la storia lo ricorda, e che si vedrà quando l'ambiente tornerà attivo.
- **Mostrare le pagine HTML dentro l'interfaccia, in un riquadro senza indirizzo.** Un riquadro scritto dentro la pagina eredita la sua politica dei contenuti, che vieta script e risorse da altri siti: una mappa fatta con una libreria e con le mappe di OpenStreetMap non funzionerebbe.
- **Mostrare le pagine dalla porta dell'anteprima.** Sarebbero su un'altra origine, ma l'anteprima è dei progetti e passa da un nodo per le applicazioni in ascolto: non è fatta per un file.
- **Solo immagini e testi, niente pagine.** Più semplice, ma la mappa interattiva è proprio ciò che il proprietario ha chiesto.

## Decisione sulle pagine

Il centro serve ogni elaborato da un indirizzo suo, con una politica dei contenuti che contiene `sandbox`. Il browser gli dà un'origine opaca: la pagina può eseguire script e caricare ciò che vuole da internet, ma non legge il cookie del proprietario, non tocca la pagina di Shinka che la contiene, e le sue richieste alle API di Shinka partono senza sessione e senza poterne leggere la risposta. Può stare solo in un riquadro della nostra interfaccia, che a sua volta ha l'attributo `sandbox` con gli stessi permessi. La politica dell'interfaccia ammette ora i riquadri del centro stesso (`frame-src 'self'`). La prova a vista lo controlla in un browser vero: lo script gira, cookie e pagina di Shinka sono negati, le API restano bloccate.

## Consequences

- **Il nodo impara una lettura nuova**, `leggi-elaborato`, che restituisce il file così com'è, anche un'immagine, fino a 10 MB, solo dentro la cartella dell'argomento e senza seguire collegamenti che ne escono. L'elenco dei file porta anche dimensione e data. Un nodo di prima non conosce la lettura nuova e non risponde: il pannello, allo scadere, dice che quel nodo va aggiornato. Gli elenchi di un nodo di prima arrivano senza dimensione e data, e restano in ordine alfabetico.
- **Una pagina scritta da Claude gira nel browser del proprietario.** Il recinto la tiene lontana da Shinka, non dal resto della rete: può caricare risorse da internet, come fa qualunque pagina aperta da un collegamento. Il contenuto lo ha scritto la Home, che ha già accesso agli ambienti; il recinto serve perché una pagina presa dal web o scritta male non diventi un modo per agire come il proprietario.
- **I file nascosti non sono elaborati**: quelli il cui percorso ha una parte che comincia con il punto, come le impostazioni degli strumenti, non compaiono nel pannello.
- Gli elaborati sono della Home. I progetti hanno già il loro terminale e la loro anteprima, e per ora non hanno un pannello degli elaborati.
- La specifica, sezione 6, non elenca il pannello: va aggiunto quando il proprietario lo chiede.

## Aggiornamento del 14 novembre 2026

Il proprietario ha chiesto gli elaborati nella barra laterale, per data e non per argomento, e solo quelli definitivi, come gli artifacts di Claude. Il pannello accanto alla chat, che elencava ogni file delle cartelle degli argomenti, è stato tolto. Al suo posto c'è la pagina Elaborati: raccoglie i file che la Home ha mostrato con `mostra_elaborato` in qualunque argomento, una volta sola ciascuno con la data dell'ultima consegna, divisi per giorno. Mostrare è il gesto con cui la Home consegna: le istruzioni le chiedono di farlo solo con la versione definitiva. I file restano dove stanno, e si servono nel recinto di prima.
