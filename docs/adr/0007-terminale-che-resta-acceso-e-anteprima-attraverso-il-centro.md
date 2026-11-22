---
status: accepted
---

# Il terminale resta acceso nel suo ambiente, e l'anteprima passa dal centro su una porta a parte

Il terminale di un progetto è una shell vera nella sua cartella, nel processo del suo ambiente: il nodo, o il centro per l'ambiente del centro. Resta accesa quando la pagina si chiude, e riaprendola si ritrova ciò che è uscito nel frattempo. L'anteprima dell'applicazione web non apre porte negli ambienti: il browser del proprietario parla con una seconda porta del centro, e il centro gira ogni richiesta al nodo, che la fa all'applicazione su `localhost`. L'anteprima la apre il proprietario scrivendo la porta, oppure premendo il pulsante di una proposta di Claude. Lo ha deciso il proprietario il 12 novembre 2026.

## Considered Options

- **Solo comandi, senza una shell.** Un campo in cui scrivere un comando e leggerne l'uscita. Scartata dal proprietario: niente programmi interattivi, niente server che restano accesi.
- **Terminale che si spegne con la pagina.** Più semplice, e nulla resta in giro. Scartata dal proprietario: dal telefono la pagina si chiude a ogni blocco dello schermo, e un server di sviluppo morirebbe con lei.
- **Anteprima diretta, dal browser all'ambiente.** Nessun passaggio in mezzo. Scartata: dal telefono in VPN il PC non si raggiunge, bisognerebbe aprire porte sul PC, e l'applicazione sarebbe visibile a chiunque sulla rete senza la password del proprietario.
- **Anteprima sotto un percorso della stessa porta di Shinka** (`/anteprima/…`). Nessuna porta in più da pubblicare. Scartata: l'applicazione avrebbe la stessa origine dell'interfaccia, e i suoi script potrebbero usare le API di Shinka con la sessione del proprietario. Inoltre le applicazioni che chiedono le loro risorse da `/` non funzionerebbero.
- **Una porta per ogni anteprima aperta.** Più anteprime insieme, ognuna con la sua origine. Scartata per ora: ogni porta va pubblicata sul container di Unraid. Con una porta sola c'è un'anteprima alla volta in tutto Shinka.
- **Anteprima aperta da Claude da solo.** Scartata dal proprietario: Claude la propone, ad aprirla è lui.

## Consequences

- Il terminale è del proprietario, non di Claude: Claude non lo vede e non ci scrive. Ciò che il proprietario vi scrive non passa dai permessi né dai divieti fissi. Chi ha la sessione del proprietario ha una shell in ogni ambiente attivo, con i diritti dell'utente con cui gira il nodo.
- Un terminale vive nel processo del suo ambiente: sopravvive alla pagina chiusa e al collegamento caduto, non al riavvio del nodo o del centro. Si spegne quando lo spegne il proprietario o dopo dodici ore senza che nessuno scriva e senza uscita.
- Il container del centro pubblica una porta in più, la 7852. Sta sullo stesso host dell'interfaccia: il browser manda i cookie di Shinka anche lì. Il server dell'anteprima chiede la sessione del proprietario, e toglie i cookie di Shinka (sessione e pagina del vault) prima di girare la richiesta all'applicazione.
- Per lo stesso motivo un WebSocket verso le API del proprietario si accetta solo se arriva dall'interfaccia di Shinka, e una richiesta che cambia qualcosa viene rifiutata se arriva da un'altra origine: l'applicazione in anteprima sta a una porta di distanza.
- Su quella porta passano applicazioni diverse, una dopo l'altra: il browser non ne conserva le pagine. Cookie e dati che un'applicazione salva nel browser restano però gli stessi per tutte.
- L'anteprima raggiunge qualunque porta di `localhost` nell'ambiente del progetto, non solo quella dell'applicazione: nell'ambiente del centro sono escluse le porte di Shinka.
- Una porta sola: un'applicazione che ne usa due, una per le pagine e una per i dati, si vede solo se la prima gira le richieste alla seconda.
