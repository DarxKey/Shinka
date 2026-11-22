---
status: accepted
---

# Shinka si sviluppa da un progetto suo, e una versione nuova entra in funzione solo dopo le prove e il sì del proprietario

Tra i progetti ce n'è uno che c'è sempre, il progetto Shinka: la sua cartella è una copia di lavoro del repository di Shinka stessa, che sta sul server. Un pezzo nuovo lo chiede il proprietario, o lo propone la Home quando si accorge che a Shinka manca qualcosa: in entrambi i casi compare una scheda, e solo se il proprietario la conferma la richiesta passa al progetto. Quando il lavoro è registrato nel repository, il progetto chiede di installarlo. Il centro estrae quella versione in una cartella pulita, ci esegue i controlli dei tipi, i test e la costruzione dell'interfaccia, e solo se passano mostra al proprietario la scheda "Installa", con ciò che cambia. Approvata, il centro si spegne e un programma piccolo che gli sta fuori, il guardiano, scambia la cartella della versione in funzione con quella nuova e lo riaccende; se la versione nuova non risponde in tempo, rimette quella di prima e Shinka lo dice. Il gateway si può modificare da lì, ma non installare: entra in funzione solo da fuori. Le quattro scelte le ha fatte il proprietario il 12 novembre 2026.

## Considered Options

- **Sviluppare dalla Home.** Nessun progetto in più: la Home lavorerebbe direttamente sul codice. Scartata dal proprietario: la Home è per ciò che si chiude in una seduta, parte con il modello piccolo e non ha uno stato da cui riprendere; il codice di Shinka è un lavoro lungo come quello di ogni altro progetto.
- **Un sistema di estensioni.** Pezzi nuovi caricati accanto a Shinka senza toccarne il codice. Scartata dal proprietario: va progettato e mantenuto un secondo modo di far crescere Shinka, e ciò che un'estensione può cambiare lo decide in anticipo chi disegna il sistema. Il progetto può cambiare qualunque parte.
- **Installare da sola, appena le prove passano.** Scartata dal proprietario: le prove dicono che il codice regge, non che il cambiamento è quello voluto. Decide lui, leggendo che cosa cambia.
- **Installare solo da fuori.** Il progetto scrive e prova, e la versione la installa chi ha accesso al server. Scartata dal proprietario: ogni pezzo nuovo aspetterebbe qualcuno al PC, e lo scopo è poterlo fare dal telefono.
- **Installare da dentro anche il gateway.** Scartata dal proprietario: il gateway custodisce il vault, il recinto, i divieti fissi e il bot. È il confine che protegge anche da una Shinka che sbaglia, e non deve poterlo spostare ciò che sta dall'altra parte.
- **Aggiornare la cartella in funzione, sul posto.** Più semplice di uno scambio. Scartata: un aggiornamento interrotto lascia una versione a metà, e non c'è una versione di prima intera a cui tornare.
- **Il centro si riavvia e si controlla da solo.** Scartata: una versione che non parte non può accorgersi di non essere partita. Serve qualcosa che resti fermo mentre il centro cambia, e che cambi il meno possibile.
- **Dare al centro il modo di ricreare il proprio container.** Scartata: vorrebbe il socket di Docker dentro il container, che la regola 5 della specifica vieta.

## Consequences

- **L'approvazione è una procedura, non un confine.** Le conversazioni girano nel container del centro, con lo stesso utente del centro: chi lavora lì può già scrivere nei file di Shinka, con o senza scheda. La scheda garantisce che ciò che entra in funzione per la strada prevista sia stato provato e visto dal proprietario; ciò che protegge da un centro compromesso resta il gateway, come prima.
- **Si installa ciò che è registrato nel repository**, non ciò che sta nella cartella del progetto: la versione ha il nome del suo commit, e quella in funzione è scritta in `versione.json`. Una versione che non contiene ciò che nel frattempo è arrivato nel repository da fuori non si installa.
- **Il ritorno indietro copre una versione che non parte**, non una che parte e si comporta male: per quella si chiede al progetto di correggere, oppure si rimette da fuori una delle cartelle che il guardiano conserva. I dati non tornano indietro con il codice.
- **Il guardiano e il gateway si aggiornano solo da fuori**, anche quando il progetto ne ha cambiato il codice: la scheda lo avvisa. Lo stesso valeva per il nodo degli altri ambienti, che restava alla versione di prima finché qualcuno non lo aggiornava: dal 13 novembre 2026 i nodi prendono la versione dal centro, come dice l'ADR 0012.
- **Un'installazione riavvia il centro**: ciò che Claude stava facendo in altre conversazioni si interrompe, e le richieste in attesa scadono.
- **Le prove girano nel container del centro**, accanto a Shinka che lavora: per qualche minuto usano la sua memoria e il suo processore.
- **Senza guardiano non si installa.** Un centro avviato a mano prepara e prova la versione, e dice che la deve installare chi ha accesso al server.
- La scheda dell'installazione vale un'ora, e una richiesta nuova prende il posto di quella in attesa. Arriva anche su Telegram, con i pulsanti.
- Il guardiano conserva le ultime tre versioni di prima e l'ultima scartata, e cancella solo le cartelle che ha creato lui.
- Le regole della sezione 4 della specifica e la specifica stessa il progetto le cambia solo se il proprietario lo chiede esplicitamente: è scritto nelle sue istruzioni, non impedito dal codice.
