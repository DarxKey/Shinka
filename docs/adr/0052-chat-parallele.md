---
status: accepted
---

# Le chat parallele

Il 24 novembre 2026 il proprietario ha chiesto di togliere la domanda a parte ("/btw") e di aprire al suo posto una nuova chat in una scheda, nei progetti e nella Home. Tra «solo nei progetti» e «progetti e Home» ha scelto il secondo, sapendo che cambia una regola della specifica: «la conversazione della Home è fatta di argomenti. Uno solo è aperto» (sezione 4.2, versione 2.20).

La domanda a parte rispondeva senza strumenti, con ciò che la conversazione sapeva già, e non lasciava traccia. Serviva a chiedere qualcosa mentre Claude lavorava. Una chat parallela fa la stessa cosa e di più: lavora davvero, con gli strumenti, mentre l'altra continua.

## Decisioni

- **Una chat parallela** è un'altra conversazione aperta accanto a quella principale, in una scheda sopra la chat. Lavora per conto suo, anche mentre la principale lavora. Se ne aprono fino a tre, oltre alla principale.
- **Nella Home una chat parallela è un argomento aperto**, con la sua cartella e la sua conversazione, a contesto pulito, come ogni argomento nuovo. Vale tutto ciò che vale per un argomento: Claude può cambiarlo, con titolo e riassunto, e la scheda passa all'argomento nuovo. Quando il proprietario chiude la scheda, Claude scrive titolo e riassunto e l'argomento va tra gli archiviati, dove si cerca e si riapre come gli altri. Una scheda vuota si chiude senza lasciare nulla. Un argomento aperto in una scheda non si riapre in un'altra.
- **Nella principale della Home restano Telegram e i lavori programmati**: i messaggi da Telegram, le risposte e i lavori programmati della Home vanno lì, come prima. Le schede che Claude propone da una chat parallela (un progetto, un pezzo di Shinka, un'estensione) compaiono in quella chat.
- **In un progetto una chat parallela è una conversazione del progetto**, nella stessa cartella e nello stesso ambiente, con le impostazioni, le estensioni e le istruzioni del progetto: aggiorna lo stato del progetto come la principale. Quando il proprietario chiude la scheda la conversazione si chiude e la sua storia si cancella: ciò che ha fatto resta nei file e nel repository.
- **La condizione** di un progetto, e quella della Home nella barra laterale, tengono conto delle chat parallele: se una aspetta il proprietario, il progetto aspetta te.
- **Gli indirizzi.** Una chat parallela di un progetto ha come identificativo quello del progetto seguito da `~chat-N`, con N da 2 a 4, e usa le stesse rotte della conversazione del progetto. Una della Home sta sotto `/api/home/chat/N`, che il centro riporta alle rotte della Home con la scheda indicata: così la scheda resta la stessa anche quando l'argomento cambia.
- **La domanda a parte se ne va** dall'interfaccia e dal centro: il comando "/btw", il riquadro sopra il campo e le rotte `…/a-parte`. I motori sanno ancora rispondere a una domanda a parte, ma nessuno glielo chiede: si toglierà quando servirà toccarli.

## Conseguenze

- La specifica passa alla versione 2.21: cambiano le sezioni 4.2, 4.4 e 6, e la voce «Domanda a parte» del glossario lascia il posto a «Chat parallela».
- Due conversazioni dello stesso progetto lavorano nella stessa cartella: possono pestarsi i piedi, come due persone sullo stesso repository. Spetta al proprietario dar loro lavori separati.
- Ogni chat parallela è un processo dell'harness in più nel suo ambiente, con il suo uso del piano.
- Le notifiche e Telegram restano sulla principale; una richiesta di permesso in una chat parallela si vede nella barra laterale.
