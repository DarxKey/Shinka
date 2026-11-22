---
status: accepted
---

# Lavori programmati: richieste del proprietario che partono da sole

Fino alla versione 2.11 la specifica metteva fuori perimetro «avvii automatici e lavori a orario: Shinka agisce solo su richiesta». Il 21 novembre 2026 il proprietario, scegliendo da un elenco di funzioni proposte, ha chiesto i lavori programmati (e gli eventi in ingresso, che avranno un pezzo loro), e ha detto di cambiare la specifica, con regole: un lavoro esiste solo se lo crea lui o se conferma una scheda; nella Home lavora in un argomento suo; i permessi sono quelli della conversazione in cui gira.

## Decisioni

- **Resta una richiesta del proprietario.** Un lavoro programmato è una sua richiesta lasciata in anticipo. Lo crea dalla pagina Programmati, oppure conferma la scheda con cui una conversazione glielo propone (`programma_lavoro`): la scheda è quella delle approvazioni, con un genere suo, e si decide anche da Telegram. Una conversazione non ne crea né ne cambia da sola: una pagina letta dal modello non può lasciargli istruzioni che ripartono ogni giorno. Toglierne uno (`togli_programmato`) segue il modo dei permessi.
- **Quando tocca, è un messaggio.** La richiesta arriva alla conversazione come un messaggio, con in testa «Lavoro programmato: «titolo»» e in coda una nota che dice che è partita da sola e dove arriva la risposta. Non comincia con «[Shinka]», che per le conversazioni vuol dire «non è una richiesta». Nella chat della Home il messaggio porta scritto che è un lavoro programmato.
- **Nella Home, un argomento per lavoro.** L'argomento aperto viene archiviato con il titolo che gli dà il motore, come quando il proprietario preme «Nuovo argomento», e la richiesta parte appena quello del lavoro è aperto: lo stesso della volta prima, riaperto se nel frattempo era stato archiviato, così il lavoro ricorda le volte precedenti e gli archiviati non si riempiono. Se nella Home è successo qualcosa negli ultimi cinque minuti il lavoro aspetta: non si cambia argomento a chi sta scrivendo.
- **In un progetto, la sua conversazione.** Arriva lì, quando il progetto non ha turni aperti.
- **I permessi sono quelli della conversazione, in quel momento.** Nessun modo dei permessi a parte per i lavori: ciò che chiede il consenso arriva al proprietario su Telegram e aspetta. È la scelta del proprietario; un modo per lavoro si può aggiungere dopo.
- **Gli orari sono del proprietario.** Tre forme: a un'ora in certi giorni della settimana, a intervalli (da un quarto d'ora a una settimana), una volta sola. Valgono nel fuso del suo browser, che la pagina dice al centro a ogni apertura: il server può stare in un altro fuso, e l'ora legale non sposta le 07:30.
- **Occupata, spenta, in ritardo.** Il centro guarda ogni trenta secondi. Con la conversazione occupata il lavoro riprova, e dopo un'ora per quella volta rinuncia. Ciò che toccava mentre Shinka era spenta parte al ritorno se il ritardo è sotto l'ora (un giorno per i lavori da una volta sola), altrimenti è saltato. Un lavoro che non finisce in sei ore non si aspetta più.
- **La risposta su Telegram.** La fine la annuncia il lavoro stesso, con il suo titolo e la risposta per intero; l'avviso solito («ha finito») per quel turno tace. Con «solo se serve» il motore risponde con la riga «NULLA DA SEGNALARE» e il proprietario non riceve nulla. Un errore arriva sempre.

## Considered Options

- **La richiesta nell'argomento aperto della Home, come un messaggio qualunque.** Più semplice, ma si mescola a ciò di cui il proprietario stava parlando, e sarebbe il motore a decidere se cambiare argomento.
- **Solo nei progetti.** Niente da cambiare nella Home, ma «controlla i backup del NAS» è proprio un lavoro da Home, che agisce in ogni ambiente e usa il vault.
- **Creazione da parte del modello senza conferma.** Esclusa: darebbe a ciò che il modello legge un modo per restare.
- **Espressioni cron.** Più potenti, ma illeggibili per il proprietario nella pagina e facili da sbagliare per il modello.

## Consequences

- La specifica passa alla versione 2.12: sezione 4.13, perimetro, sezioni 6 e 7, prove da A58 ad A62.
- Nella Home, con più lavori programmati, a ogni passaggio dall'uno all'altro il motore scrive titolo e riassunto dell'argomento che si chiude: un turno breve in più.
- Con la conversazione in «chiedi sempre» un lavoro che tocca un host aspetta ogni volta il consenso su Telegram.
- I nodi ricevono tre strumenti nuovi: uno di una versione precedente non li ha finché non si aggiorna.
