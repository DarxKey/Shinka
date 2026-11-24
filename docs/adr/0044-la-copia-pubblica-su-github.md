---
status: accepted
---

# La copia pubblica su GitHub

Il 22 novembre 2026 il proprietario ha chiesto di mettere Shinka su GitHub, in un repository pubblico, con la licenza MIT. Fino a qui il codice stava solo sul server: il repository di lavoro, da cui Shinka si installa, e la sua storia. Quella storia racconta anche l'installazione del proprietario: gli indirizzi della sua rete, il nome con cui raggiunge Shinka da fuori, la sua email come autore dei primi commit. Ciò che diventa pubblico non si ritira.

## Decisioni

- **Il repository di lavoro non cambia.** Resta sul server con tutta la storia, e resta quello da cui Shinka si installa. Riscriverne la storia cambierebbe i commit a cui le versioni installate e il ritorno indietro si riferiscono.
- **La copia pubblica ha una storia sua, che comincia dalla prima pubblicazione.** Il primo commit pubblico contiene i file di quel giorno, senza ciò che è venuto prima. Da lì in poi ogni commit del ramo di lavoro diventa un commit pubblico con lo stesso messaggio, la stessa data e gli stessi file. Il proprietario l'ha preferita alla storia intera ripulita in automatico: è pubblico solo ciò che è stato controllato, e una sostituzione automatica su 124 commit può lasciarsi sfuggire qualcosa.
- **`STATO.md` resta fuori.** Dice che cosa è reale e che cosa manca, ma racconta anche il server del proprietario e ciò che sul sistema vero non è ancora stato provato. Un commit che tocca solo file esclusi non compare nella copia pubblica.
- **L'autore pubblico è sempre Shinka.** Nome ed email di chi ha scritto il commit di lavoro non passano.
- **Un elenco di espressioni vietate ferma la pubblicazione.** Prima di preparare un commit pubblico si guardano il messaggio, i nomi dei file e le righe dei file aggiunti o cambiati; alla prima pubblicazione, tutti i file. Se compare un'espressione dell'elenco non viene preparato nulla, nemmeno i commit puliti che venivano prima, e il rifiuto dice dove senza ripetere che cosa. Un commit con un'espressione vietata si pubblica però unito a quello che lo segue, con i due messaggi: se il successivo la toglie, l'unione è pulita e la copia pubblica non la vede mai, nemmeno nella storia (24 novembre 2026: senza, un'espressione entrata per sbaglio in un commit già registrato fermava la pubblicazione per sempre). L'elenco sta fuori dal repository (`~/.config/shinka/pubblicazione-vietati.txt`), perché contiene proprio ciò che non deve uscire. Senza elenco non si pubblica.
- **Nel codice gli esempi sono inventati.** Indirizzi, nomi di persona e nomi di host che comparivano nei test e nei testi di aiuto sono stati sostituiti con valori di esempio.
- **La manda il progetto Shinka, dopo ogni versione installata.** Con `npm run pubblica -- --invia`, dalla cartella del progetto. Il proprietario l'ha preferito a un invio fatto dal centro: nessun codice nuovo in funzione, e nessuna chiave di GitHub tra i dati di Shinka.
- **A GitHub si scrive con una chiave del solo repository.** Una chiave SSH generata nell'ambiente del progetto, la cui parte pubblica il proprietario aggiunge alle deploy key del repository, con il permesso di scrittura. Vale solo lì, e la toglie lui quando vuole. Non passa dal vault: il vault serve al gateway, e qui a collegarsi è Git.

## Conseguenze

- Chi trova un'installazione di Shinka raggiungibile da fuori può leggere com'è fatta. La protezione non deve dipendere dal codice nascosto: password, vault e divieti fissi valgono lo stesso.
- I commit pubblici hanno identificativi diversi da quelli di lavoro. Fin dove il ramo di lavoro è stato pubblicato lo ricorda un riferimento locale (`refs/pubblicazione/origine`); il ramo locale `pubblico` è ciò che su GitHub diventa `main`.
- Se il progetto Shinka non lavora, la copia pubblica resta indietro finché non riprende.
- Un file nuovo che racconta l'installazione del proprietario va aggiunto agli esclusi, o non va scritto nel repository. Un dato nuovo che non deve uscire va aggiunto all'elenco dei vietati.
- La specifica rimanda a `STATO.md`, che nella copia pubblica non c'è: lo dice il `README.md`.
