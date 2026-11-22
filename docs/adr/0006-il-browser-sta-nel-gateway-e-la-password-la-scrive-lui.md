---
status: accepted
---

# Il browser sta nel gateway, e nei siti la password la scrive lui

Per entrare in un sito Claude usa un browser che gira dentro il gateway, accanto al vault. Claude indica una credenziale per nome; nome utente e password li scrive il gateway nei campi della pagina, e solo se la pagina è di un sito per cui il proprietario ha inserito quella credenziale. A Claude la pagina arriva in testo, e su richiesta in immagine, senza i valori dei campi password e senza alcun valore custodito nel vault. Il browser tiene il suo profilo tra un uso e l'altro e può aprire qualunque sito. Lo ha deciso il proprietario il 12 novembre 2026: vale la regola di [ADR 0004](0004-credenziali-usate-senza-vederle.md), e l'unico processo che può scrivere una password senza che passi da una conversazione è quello che la custodisce.

Per i progetti su Windows il proprietario vorrebbe invece il browser del PC, attraverso l'estensione di Claude che ha già installato. È un'opzione del nodo, che ha acceso lui sul suo PC lo stesso giorno, dopo aver letto che cosa comporta.

## Considered Options

- **Browser in un terzo container, comandato dal gateway.** Una falla di Chromium non porterebbe nel container dove il vault è aperto. Non scelta dal proprietario: un container e una rete in più da gestire. Resta la strada per stringere, se servirà.
- **Browser nel container del centro o sul nodo, con la password mandata dal gateway.** Scartata: la password attraverserebbe il processo in cui girano le conversazioni, che possono leggere tutto ciò che quel processo legge.
- **Solo testo, senza immagini.** Più semplice da ripulire. Scartata dal proprietario: certe pagine si capiscono solo guardandole. L'immagine copre i campi password e viene rifiutata se nella pagina si legge un valore del vault.
- **Profilo nuovo a ogni uso.** Nessuna sessione che resta aperta. Scartata dal proprietario: bisognerebbe rientrare ogni volta, e molti siti chiedono una verifica a ogni accesso da un browser sconosciuto.
- **Browser limitato ai siti per cui c'è una credenziale.** Scartata dal proprietario: dopo l'accesso un sito porta spesso altrove, e il browser serve anche per siti senza accesso.
- **Browser del PC per tutto, attraverso l'estensione.** È il browser vero del proprietario, già dentro i suoi siti. Scartata come strada principale: sul server non c'è, e lì Shinka non può far valere né la regola del vault né i divieti fissi, perché gli strumenti sono dell'estensione.

## Consequences

- Il browser vive nello stesso container del vault. Il recinto di Chromium è acceso, e per questo il container del gateway ha una regola seccomp e una capacità in più rispetto a prima.
- Il browser lavora solo a vault aperto, anche per i siti senza credenziale: dopo un riavvio del gateway resta fermo finché il proprietario non scrive la frase.
- I divieti fissi nei siti (pagare, cambiare una password, cancellare un account) sono regole sulle parole della pagina: fermano il sito che chiama le cose con il loro nome, non ogni sito.
- Davanti a un codice di verifica, a una conferma dal telefono o a una prova contro i robot Claude si ferma: il browser del gateway non ha una finestra in cui il proprietario possa intervenire.
- Una sessione aperta in un sito resta nel profilo del gateway: chi arrivasse a quel profilo sarebbe dentro quei siti senza conoscere la password. Il profilo sta nella cartella dei dati del gateway, che il container del centro non monta.
- Nel browser del PC Shinka non controlla che cosa viene cliccato: lì ogni azione, anche leggere, passa dal consenso del proprietario, e nei modi dei permessi che non lo chiedono il browser del PC resta spento (dal 15 novembre 2026 non più: c'è in ogni modo, e il consenso lo chiede Shinka; vedi l'ADR 0018). Accenderlo fa riscrivere a Claude Code il collegamento con l'estensione nella configurazione personale del proprietario.
