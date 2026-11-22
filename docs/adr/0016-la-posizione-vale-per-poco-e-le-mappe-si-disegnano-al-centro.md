---
status: accepted
---

# La posizione del proprietario vale per poco, e le mappe per Telegram le disegna il centro

Il proprietario, a Tokyo, ha chiesto alla Home da Telegram come arrivare al South Observation Deck di Shinjuku "da qui", e la Home non sapeva dove fosse. Il 13 novembre 2026 ha chiesto: la posizione da Telegram, anche dal vivo, e dal browser; che valga per la conversazione in corso, con la sua ora, e non finisca in memoria; il tragitto a piedi disegnato su un'immagine, perché su Telegram una mappa HTML si apre vuota, e il link a Google Maps per i mezzi.

## Decisioni

- **Una posizione condivisa è un messaggio del proprietario.** Da Telegram (messaggio Posizione, o il tasto che il bot mostra con /posizione) e dal pulsante della Home nel browser arriva alla Home come un suo messaggio, con coordinate, precisione e ora: la Home risponde, e se aspettava la posizione per un tragitto lo continua. I punti successivi di una posizione dal vivo, che Telegram manda come modifiche dello stesso messaggio, aggiornano il dato in silenzio, senza un turno a ogni passo.
- **Il dato sta solo nel centro, e scade.** La Home lo legge con `posizione_del_proprietario`, che dice anche da dove viene e quanto è vecchio. Non è legato all'argomento, perché il messaggio con la posizione spesso apre un argomento nuovo: lo lega il tempo. Una posizione mandata una volta vale due ore; una dal vivo finché dura la condivisione e dieci minuti dopo. Non va su disco né in memoria; resta, come ogni messaggio, nella storia dell'argomento.
- **Le mappe come immagine le disegna il centro**, con lo strumento `disegna_mappa`: riquadri di OpenStreetMap (in Giappone quelli di openstreetmap.jp con i nomi in alfabeto latino), il tragitto a piedi dai server di percorsi di FOSSGIS, punti ed etichette disegnati con ImageMagick indicando il font per file. La Home aveva concluso che sul server mancasse un font: i font DejaVu ci sono, ma ImageMagick senza un font indicato ne cerca uno che non c'è. Per i mezzi pubblici il percorso lo calcola Google Maps, con il link.

## Considered Options

- **La posizione come nota di Shinka, senza turno.** Se la Home l'aveva chiesta per un tragitto, il proprietario avrebbe dovuto scrivere di nuovo. Come messaggio, la Home la vede e continua.
- **Un turno della Home a ogni punto dal vivo.** Sarebbe un tracciamento rumoroso: i punti aggiornano il dato e basta.
- **La posizione legata all'argomento.** Andava persa proprio quando il messaggio con la posizione apre un argomento nuovo.
- **Lasciare alla Home il disegno con i suoi comandi.** Ci ha provato, e senza Pillow e con ImageMagick usato senza font ha consegnato una mappa senza nomi. Uno strumento fa ogni volta la stessa cosa giusta.
- **Disegnare la mappa con un browser senza finestra.** Il centro non ne ha uno; il browser del gateway serve ai siti, con il vault.

## Consequences

- **Coordinate verso servizi esterni.** Per disegnare il tragitto il centro manda le coordinate di partenza e di arrivo ai server di percorsi di FOSSGIS, e chiede i riquadri della zona a OpenStreetMap. Si presenta come Shinka, senza dire di chi è. Il proprietario lo ha chiesto, nominando un servizio aperto.
- **Il browser dà la posizione solo a una pagina sicura.** Se l'interfaccia è servita in HTTP su un indirizzo che non è la macchina stessa, il pulsante dice di mandarla da Telegram.
- **Il gateway cambia** (posizioni e messaggi modificati da Telegram, il comando /posizione, il menu del bot): dopo l'installazione chiede il suo sì.
- **Le etichette giapponesi non si scrivono**: il font non le ha. Le istruzioni chiedono l'alfabeto latino, e lo strumento lo segnala.
- Disegnare una mappa e leggere la posizione non chiedono consenso: lo strumento scrive solo un PNG nella cartella dell'argomento.
