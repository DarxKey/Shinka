---
status: accepted
---

# Le estensioni dell'interfaccia

> La parte sul recinto delle pagine (niente API di Shinka) è superata dall'[ADR 0057](0057-interfaccia-riscrivibile-dalle-estensioni.md): ora le pagine chiamano le API che l'estensione dichiara, attraverso il ponte. Il resto vale ancora.

Il 24 novembre 2026 il proprietario ha chiesto un tipo nuovo di estensione, che cambia l'aspetto dell'interfaccia o le aggiunge funzioni, invece di metterle nel codice di Shinka. Ha scelto che cosa può fare (pagine e pannelli, temi, pulsanti nella chat), da dove viene (la scrive Claude e lui la conferma) e che cosa vede di Shinka (legge lo stato e manda messaggi alle conversazioni).

## Decisioni

- **Un'estensione dell'interfaccia** ha un nome, una descrizione e uno o più di questi pezzi:
  - un **tema**: un foglio di stile che si aggiunge a quello di Shinka;
  - delle **pagine**: documenti HTML, ciascuno con il suo JavaScript, che compaiono nel menu delle pagine oppure come schede del pannello dei progetti;
  - dei **pulsanti**: sopra il campo di scrittura, nella Home, nei progetti o in tutte e due; un tocco manda alla conversazione il testo del pulsante.
- **La scrive Claude.** La Home la propone con `proponi_estensione_interfaccia`, scrivendo il tema, le pagine e i pulsanti per intero. Compare una scheda con ciò che aggiunge, l'anteprima di ogni pagina e il testo di ogni pulsante; entra solo se il proprietario conferma. Una proposta con il nome di una che c'è già la sostituisce, e la scheda lo dice. Le estensioni dell'interfaccia stanno tra i dati del centro, non nel codice di Shinka, e non passano dai nodi.
- **Il recinto delle pagine.** Il centro serve ogni pagina con una politica che la chiude in un'origine sua, opaca, anche se la si apre da sola: niente cookie del proprietario, niente API di Shinka, niente risorse da altri siti, niente richieste in rete. Può stare solo in un riquadro della nostra interfaccia.
- **Che cosa vede una pagina.** Parla con l'interfaccia solo con `postMessage`: chiede lo stato (progetti con la loro condizione, ambienti, la Home, dove si trova) e lo riceve di nuovo a ogni cambiamento; manda un messaggio alla Home o a un progetto, che arriva come un messaggio del proprietario, preceduto dal nome della pagina, e da lì segue i permessi di sempre. Non vede credenziali, chiavi, memoria, né il testo delle conversazioni.
- **Il tema** si aggiunge alla pagina così com'è. La politica dei contenuti dell'interfaccia non gli lascia caricare nulla da altri siti. Se un tema rende l'interfaccia inservibile, l'indirizzo con `?senza-estensioni` la apre senza temi né pulsanti, e dalla pagina Estensioni lo si spegne.
- **Gestione.** Nella pagina Estensioni le estensioni dell'interfaccia hanno una sezione loro: si spengono, si riaccendono e si tolgono.

## Conseguenze

- Una pagina che vuole dati da fuori, come lo stato del NAS, non li prende da sé: li chiede alla conversazione con un messaggio, o li riceve dentro di sé quando Claude la riscrive. Aprirle la rete sarebbe una decisione nuova.
- Un tema può nascondere o spostare parti dell'interfaccia, anche le schede dei permessi: è codice scritto da Claude e confermato dal proprietario, come il resto, e si spegne da qui.
- Un messaggio mandato da una pagina è un messaggio del proprietario: la pagina lo può mandare solo mentre è aperta davanti a lui.
