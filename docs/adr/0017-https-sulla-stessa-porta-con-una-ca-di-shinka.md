---
status: accepted
---

# HTTPS nel centro, sulla stessa porta dell'HTTP, con una piccola CA di Shinka

Il proprietario usa Shinka dal browser del PC, dall'iPhone e da Telegram. In HTTP il browser non dà la posizione e Safari tratta male l'app aggiunta alla schermata Home. Per provarlo la Home aveva messo un nginx in uno stack di prova, sulla porta 7900, davanti al centro: l'interfaccia funzionava, ma l'anteprima dei progetti, su un'altra porta in HTTP, dentro una pagina HTTPS veniva bloccata, e nginx andava tenuto a mano. Il 13 novembre 2026 il proprietario ha chiesto che l'HTTPS sia parte di Shinka, lasciando al progetto la scelta tra nginx incluso e Node.

## Decisioni

- **L'HTTPS lo serve il centro stesso, con Node.** Nessun programma in più da avviare, configurare e aggiornare nel container: il centro e l'anteprima usano gli stessi certificati, e le intestazioni di host e origine restano quelle che il browser manda, senza un proxy in mezzo da istruire.
- **HTTP e HTTPS sulla stessa porta.** Il centro guarda il primo byte di ogni connessione: se apre una stretta di mano TLS la passa alla parte cifrata, altrimenti all'HTTP. Così il proprietario apre `https://192.168.1.20:7850`, e nodi, gateway e guardiano continuano a collegarsi a `http://192.168.1.20:7850` come prima. Vale anche per l'anteprima, sulla 7852.
- **I collegamenti interni restano in HTTP.** (Per i nodi non vale più: dal 22 novembre 2026 il loro collegamento è cifrato, con un certificato a parte. Vedi l'[ADR 0040](0040-collegamento-cifrato-tra-nodi-e-centro.md).) Si poteva far parlare TLS anche a nodi e gateway, fidandosi del solo certificato di Shinka per impronta: ma ogni nodo e il guardiano andrebbero cambiati e aggiornati insieme, e un errore lì lascerebbe il centro senza nodi o senza ritorno indietro. Sulla rete di casa questi collegamenti erano e restano in chiaro; ciò che cambia è il browser del proprietario.
- **Una CA di Shinka e un certificato del server firmato da lei.** Il proprietario installa la CA una volta su iPhone e PC, da una pagina che si apre prima dell'accesso (`/certificato`, con il profilo per iOS e il file per Windows). Se cambiano gli indirizzi si rifà solo il certificato del server, e sui dispositivi non c'è nulla da reinstallare. Il certificato del server vale 800 giorni, sotto il limite di 825 di Apple, ha i nomi tra i nomi alternativi e l'uso "server web"; si rifà da solo un mese prima della scadenza.
- **La CA può firmare solo la rete di casa.** Ha vincoli di nome: indirizzi privati, la macchina stessa e i nomi che le sono stati dati. Se la sua chiave, che sta tra i dati del centro, finisse in mani altrui, non servirebbe a fingersi un sito di Internet davanti ai dispositivi che si fidano di lei. Un nome di macchina nuovo, che la CA non conosce, la fa rifare: allora va reinstallata, e Shinka lo dice.
- **Si accende con una scelta esplicita**: dalla pagina Vault, che la scrive in `https.json` tra i dati e fa ripartire Shinka attraverso il guardiano, oppure con `SHINKA_HTTPS=1`. Gli indirizzi si danno lì o con `SHINKA_HTTPS_NOMI`; un certificato proprio con `SHINKA_HTTPS_CERTIFICATO` e `SHINKA_HTTPS_CHIAVE`. Se i certificati non si preparano, Shinka parte lo stesso in HTTP e lo dice.

## Considered Options

- **nginx dentro il container di Shinka.** Un secondo processo da tenere acceso dal guardiano, una configurazione da generare e un programma da aggiornare; il problema dell'intestazione Host, già incontrato, resterebbe da gestire. Non darebbe nulla che Node non faccia.
- **HTTPS su una porta nuova, HTTP sulla vecchia.** Più semplice, ma il proprietario dovrebbe imparare un indirizzo nuovo, il container pubblicare porte nuove, e l'anteprima ne vorrebbe un'altra ancora.
- **Un solo certificato autofirmato, senza CA.** Andrebbe reinstallato su ogni dispositivo a ogni cambio di indirizzo e a ogni rinnovo, e iOS lo mostra in "Attendibilità certificati" solo se è una CA.

## Consequences

- Il cookie di sessione è sicuro per chi entra in HTTPS; chi entra in HTTP ha il cookie di prima. Con "Chi apre l'interfaccia in HTTP va all'HTTPS" la pagina in HTTP rimanda all'HTTPS, mentre le API, il collegamento dei nodi e la pagina del certificato restano raggiungibili in HTTP.
- La pagina del vault del gateway resta in HTTP sulla sua porta: si apre in una scheda nuova, non in un riquadro, e il browser non la blocca.
- Allo spegnimento si chiudono anche le connessioni cifrate: un flusso di eventi aperto in HTTPS non tiene acceso il centro.
- Dentro un container il centro non conosce l'indirizzo del server: va dato, come `192.168.1.20`.
- Il nginx di prova sulla 7900 non serve più, quando il proprietario ha visto funzionare questo: lo stack si toglie dalla Home.
