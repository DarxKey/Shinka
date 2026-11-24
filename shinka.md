# Shinka

## Specifica funzionale e architetturale

**Versione:** 2.25 | **Data:** 24 novembre 2026 | **Stato:** baseline concordata; l'avanzamento degli incrementi è in [STATO.md](STATO.md)

Sostituisce la specifica "Atlas Agent 1.0", conservata in [archivio/atlas-agent-v1.md](archivio/atlas-agent-v1.md). I termini usati qui sono definiti in [GLOSSARY.md](GLOSSARY.md). Le decisioni di fondo sono motivate in [docs/adr/](docs/adr/). Lo stato dei lavori è in [STATO.md](STATO.md).

La versione 2.2 cambia il ruolo della Home, che diventa un assistente a tutto tondo, e aggiunge gli argomenti, la memoria e le skill gestite da Claude e il vault. Le scelte sono del proprietario, dell'11 novembre 2026.

La versione 2.3 aggiunge lo sviluppo di Shinka da dentro Shinka: la sezione 4.10, il guardiano nell'architettura, l'incremento 11 e le prove da A30 ad A34. Le scelte sono del proprietario, del 12 novembre 2026.

La versione 2.4 aggiunge le estensioni: la sezione 4.11, un'eccezione dichiarata nella sezione 4.8 per le chiavi delle estensioni, l'incremento 12 e le prove da A35 ad A40. Le scelte sono del proprietario, del 12 novembre 2026, e sono motivate in [docs/adr/0011](docs/adr/0011-le-estensioni-stanno-in-un-elenco-di-shinka-e-le-loro-chiavi-escono-dal-vault.md).

La versione 2.5 aggiunge l'aggiornamento dei nodi alla versione del centro: due regole nelle sezioni 4.3 e 4.10, il guardiano dei nodi nell'architettura, l'incremento 13 e le prove da A41 ad A44. La scelta è del proprietario, del 13 novembre 2026, ed è motivata in [docs/adr/0012](docs/adr/0012-i-nodi-prendono-la-versione-dal-centro-e-un-guardiano-loro-la-mette-in-funzione.md).

La versione 2.6 dà al progetto Shinka ciò che prima si faceva solo da fuori: il gateway si installa da dentro, e i comandi sul server si eseguono con una credenziale del vault. In tutti e due i casi il sì lo raccoglie il gateway dal proprietario, senza passare dal centro. Cambiano le sezioni 4.7, 4.8 e 4.10, i confini di fiducia e Telegram; si aggiungono l'incremento 14 e le prove da A45 ad A50. Le scelte sono del proprietario, del 13 novembre 2026, e sono motivate in [docs/adr/0015](docs/adr/0015-il-si-dato-al-gateway.md).

La versione 2.7 scrive nella sezione 4.7 la regola del browser del PC, e la cambia: prima c'era solo nei modi dei permessi che chiedono, ora c'è in tutti, e ogni sua azione continua a passare dal proprietario. Si aggiungono le prove A51 e A52. La scelta è del proprietario, del 15 novembre 2026, ed è motivata in [docs/adr/0018](docs/adr/0018-nel-browser-del-pc-il-consenso-lo-chiede-shinka-in-ogni-modo-dei-permessi.md).

La versione 2.8 toglie la scadenza all'approvazione di una versione di Shinka (sezione 4.10, prova A32): la richiesta aspetta il proprietario finché non decide, e smette di aspettare solo se una richiesta più recente ne prende il posto o se il centro riparte. La scelta è del proprietario, del 16 novembre 2026, ed è motivata in [docs/adr/0021](docs/adr/0021-l-installazione-di-una-versione-aspetta-il-proprietario-senza-scadere.md). Il sì dato al gateway e le approvazioni dei comandi sugli host continuano a scadere.

La versione 2.9 permette un secondo motore e un'installazione al lavoro: un'installazione di Shinka può usare Codex, il motore di OpenAI, con l'abbonamento ChatGPT del proprietario, al posto di Claude Code; e può stare su un server del lavoro del proprietario, restando personale. Cambiano le sezioni 1, 2, 3, 4.7 e 5, e si aggiunge la sezione 4.12. La scelta è del proprietario, del 18 novembre 2026, ed è motivata in [docs/adr/0029](docs/adr/0029-un-secondo-motore-codex-scelto-per-installazione.md).

La versione 2.10 porta il motore dalla installazione alla conversazione: Claude Code e Codex convivono, e la Home e ogni progetto scelgono il loro, come il modello. Aggiunge una pagina Impostazioni, il primo avvio guidato di un'installazione nuova e lo script che prepara un ambiente Linux o Windows. Cambiano le sezioni 2 e 4.12. La scelta è del proprietario, del 18 novembre 2026, ed è motivata in [docs/adr/0030](docs/adr/0030-il-motore-si-sceglie-per-conversazione.md).

La versione 2.11 aggiunge le credenziali in chiaro: un'eccezione dichiarata nella sezione 4.8, per credenziali di prova o a basso rischio di cui Claude legge il valore, e che può proporre di salvare con l'approvazione del proprietario. Le credenziali protette restano come prima. Cambiano le sezioni 4.8 e 6; si aggiungono le prove da A53 ad A57. La scelta è del proprietario, del 21 novembre 2026, ed è motivata in [docs/adr/0034](docs/adr/0034-credenziali-in-chiaro.md).

La versione 2.12 ammette i lavori programmati, che prima erano fuori perimetro: richieste che il proprietario lascia a Shinka perché partano da sole, a un orario o a intervalli. Aggiunge la sezione 4.13 e le prove da A58 ad A62; cambiano il perimetro e le sezioni 6 e 7. Con la stessa scelta il proprietario ha ammesso gli eventi in ingresso da altri sistemi, come materiale e mai come istruzioni: entreranno nella specifica con il loro pezzo. La scelta è del proprietario, del 21 novembre 2026, ed è motivata in [docs/adr/0035](docs/adr/0035-lavori-programmati.md).

La versione 2.13 aggiunge gli eventi in ingresso, già ammessi dal proprietario con la 2.12: un lavoro programmato può partire quando un altro sistema manda un evento al suo indirizzo. Cambiano le sezioni 4.13 e 5; si aggiungono le prove da A63 ad A66. È motivata in [docs/adr/0036](docs/adr/0036-eventi-in-ingresso.md).

La versione 2.14 lascia che il proprietario crei un progetto da sé, dall'interfaccia, senza passare da una proposta della Home: lo ha chiesto lui il 21 novembre 2026. Cambiano le sezioni 4.4 e 6; si aggiunge la prova A67. Resta fermo che nessun progetto nasce senza di lui.

La versione 2.15 aggiunge le notifiche dell'app: gli avvisi che arrivano su Telegram arrivano anche, come notifiche, ai dispositivi che il proprietario iscrive. Cambiano il perimetro e la sezione 7; si aggiungono le prove da A68 ad A70. Lo ha chiesto il proprietario il 21 novembre 2026; le ragioni sono in [docs/adr/0037](docs/adr/0037-notifiche-dell-app.md).

La versione 2.16 aggiunge la pagina di un ambiente: risorse in tempo reale, processi e container. I container di un host che il nodo non vede li legge il gateway, in sola lettura, per la pagina del proprietario: lo ha scelto lui il 22 novembre 2026. Cambiano le sezioni 4.3, 4.9 e 6; si aggiungono le prove da A71 ad A73. È motivata in [docs/adr/0038](docs/adr/0038-la-pagina-di-un-ambiente.md).

La versione 2.17 aggiunge la pagina Sicurezza: le sessioni aperte del proprietario, da chiudere una per una, e il registro delle richieste al centro, che dice chi è entrato, da dove, e chi ha provato senza riuscirci. Il proprietario l'ha scelta il 21 novembre 2026. Cambiano le sezioni 5 e 6; si aggiungono le prove da A74 ad A76. È motivata in [docs/adr/0039](docs/adr/0039-registro-delle-richieste.md).

La versione 2.18 cifra il collegamento tra i nodi e il centro: il nodo riconosce il centro dal suo certificato, il segreto passato in chiaro si cambia, e il proprietario può scegliere di accettare solo i nodi cifrati. Lo ha scelto il 21 novembre 2026. Cambiano le sezioni 4.3, 5 e 6; si aggiungono le prove da A77 ad A80. È motivata in [docs/adr/0040](docs/adr/0040-collegamento-cifrato-tra-nodi-e-centro.md).

La versione 2.19 aggiunge la copia di sicurezza e il trasloco dei dati: una copia cifrata dei dati del centro, che il proprietario scarica dalle Impostazioni e ricarica per ripristinare tutto o per portare memoria e skill in un'altra installazione; e la copia del vault, che scarica e ricarica dalla pagina del vault, senza passare dal centro. Lo ha scelto il 21 novembre 2026. Cambiano il perimetro e le sezioni 4.8, 5 e 6; si aggiungono le prove da A81 ad A85. È motivata in [docs/adr/0042](docs/adr/0042-copia-di-sicurezza-e-trasloco-dei-dati.md).

La versione 2.20 permette a un progetto di lavorare in più ambienti: vive nel suo, con il suo motore e la sua cartella, e il proprietario può collegargli cartelle di altri ambienti, in cui il progetto lavora con gli strumenti di Shinka seguendo il modo dei suoi permessi. Cambiano la sezione 4.4 e un'assunzione della sezione 11. La scelta è del proprietario, del 23 novembre 2026, per far lavorare il progetto Shinka anche sul codice di Shinka Desktop, che si costruisce sul PC; è motivata in [docs/adr/0050](docs/adr/0050-un-progetto-in-piu-ambienti.md).

La versione 2.21 toglie la domanda a parte e aggiunge le chat parallele: nella Home e in un progetto il proprietario apre altre conversazioni in schede accanto alla principale, che lavorano anche mentre questa lavora. Nella Home ciascuna è un argomento aperto: gli argomenti aperti possono essere più d'uno. Cambiano le sezioni 4.2, 4.4 e 6; si aggiungono le prove A86 e A87. La scelta è del proprietario, del 24 novembre 2026, ed è motivata in [docs/adr/0052](docs/adr/0052-chat-parallele.md).

La versione 2.22 dice che cosa fa un lavoro programmato che trova esaurito il limite del piano: non salta, aspetta che si azzeri e riparte da solo, una volta. Cambia la sezione 4.13; si aggiunge la prova A88. La scelta è del proprietario, del 24 novembre 2026.

La versione 2.23 lascia usare un modello locale anche fuori dal suo ambiente: il proprietario lo mette in rete, e la Home e i progetti degli altri ambienti lo raggiungono con una chiave che Shinka tiene per sé. Cambia la sezione 4.11; si aggiunge la prova A89. La scelta è del proprietario, del 24 novembre 2026, ed è motivata in [docs/adr/0053](docs/adr/0053-modelli-locali-in-rete.md).

La versione 2.24 aggiunge le estensioni dell'interfaccia: temi, pagine e pulsanti che Claude scrive e il proprietario conferma, al posto di nuove funzioni nel codice di Shinka. Le pagine girano in un recinto e parlano con Shinka solo per leggerne lo stato e mandare messaggi. Cambiano le sezioni 4.11 e 6; si aggiunge la prova A90. La scelta è del proprietario, del 24 novembre 2026, ed è motivata in [docs/adr/0054](docs/adr/0054-estensioni-dell-interfaccia.md).

La versione 2.25 lascia lavorare sui progetti di un PC anche quando il centro non si raggiunge: Shinka Desktop, su quel PC, li riprende dal suo nodo, e al ritorno il nodo consegna al centro ciò che è stato fatto. Cambiano le sezioni 4.3, 4.4 e 4.5; si aggiunge la prova A91. La scelta è del proprietario, del 24 novembre 2026, ed è motivata in [docs/adr/0056](docs/adr/0056-il-lavoro-offline-sui-progetti-del-pc.md).

## 1. Cos'è Shinka

Shinka è un'applicazione web personale con un'unica chat, la **Home**, a cui il proprietario chiede qualunque cosa. La Home risponde alle domande e svolge da sé i lavori che si chiudono in una seduta, anche quando producono file. Propone un **progetto** solo per i lavori lunghi. Ricorda ciò che ha fatto: quando il proprietario cambia argomento archivia il precedente, e quando gli viene richiesto qualcosa di già fatto lo ritrova invece di rifarlo. Ogni progetto vive in un **ambiente** scelto dal proprietario: il server Linux del homelab, oppure il PC Windows per i lavori che ne hanno bisogno, come Unity o Blender. Il motore è Claude Code, usato tramite il Claude Agent SDK ufficiale; un'installazione può usare invece Codex, il motore di OpenAI, tramite il suo app-server ufficiale (sezione 4.12). C'è un solo proprietario.

Otto scambi definiscono il comportamento atteso:

| Il proprietario scrive | Dove | Cosa succede |
|---|---|---|
| "Che ora è in Giappone?" | Home | La Home risponde in chat. |
| "Scrivimi uno script PowerShell che fa il backup dei documenti" | Home | La Home lo scrive, lo prova nell'ambiente Windows e lo consegna. Nessun progetto. |
| "Parliamo d'altro: come configuro il router?" | Home | La Home archivia l'argomento dello script, lo dice in una riga e riparte con il contesto pulito. |
| "Mi ridai lo script del backup?" settimane dopo | Home | La Home lo ritrova nell'argomento archiviato e lo riconsegna senza riscriverlo. |
| "Iniziamo lo sviluppo di un videogioco" | Home | La Home propone nome, cartella e ambiente. Dopo la conferma con un tocco nasce il progetto: cartella nuova e conversazione pulita che contiene solo il **brief**. L'interfaccia si sposta lì. |
| "Iniziamo un progetto Unity" | Home | Come sopra, ma l'ambiente proposto è il PC Windows. Il proprietario può cambiarlo tra quelli attivi. |
| "A che punto è il videogioco?" | Home | La Home risponde consultando lo **stato del progetto**, senza che il proprietario lo apra e anche se il suo ambiente è spento. |
| "Collegati al NAS e dimmi quanto spazio resta" | Home o progetto | Claude usa la credenziale del **vault** senza vederla, e risponde. |

## 2. Perimetro

### Prima versione

- Home a tutto tondo: risposte, lavori piccoli svolti direttamente, proposta di progetto per quelli lunghi.
- Argomenti della Home: archiviazione al cambio di argomento e ricerca in ciò che è stato fatto.
- Due ambienti: il container su Unraid e il PC Windows. La Home agisce in ogni ambiente attivo.
- Progetti: creazione con conferma e scelta dell'ambiente, cambio dalla barra laterale o chiedendolo alla Home, ripresa delle conversazioni.
- La Home sa tutto dei progetti (sezione 4.5).
- Lavoro con Claude Code completo: permessi, piani, skill, subagent. Con Codex, ciò che Codex offre (sezione 4.12).
- Per ogni conversazione: scelta di modello, effort e modo dei permessi; contesto occupato e limiti del piano; allegati e immagini.
- Memoria persistente, scritta da Claude e visibile al proprietario, valida ovunque.
- Skill create e migliorate da Claude, con storia.
- Vault delle credenziali, per SSH e per il browser: Claude le usa senza vederle.
- Terminale integrato, nell'ambiente del progetto.
- Anteprima dell'applicazione, solo per applicazioni web.
- Stack di prova sugli host Docker del lab.
- Telegram per parlare con la Home, ricevere notifiche e approvare.
- Notifiche dell'app sui dispositivi del proprietario, con gli stessi avvisi di Telegram.
- Sviluppo di Shinka da dentro Shinka: un progetto sul suo codice, e versioni che entrano in funzione dopo le prove e l'approvazione del proprietario.
- Estensioni: server MCP locali e remoti e plugin di Claude Code, proposti con una scheda, usati dai progetti e dalla Home.
- Lavori programmati: richieste del proprietario che partono da sole, a un orario o a intervalli (sezione 4.13).
- Copia di sicurezza dei dati, cifrata con una password del proprietario: per ripristinarli, e per portare memoria e skill in un'altra installazione.

### Dopo la prima versione

In ordine ancora da decidere: vista dedicata per rivedere le modifiche ai file, esplora file con editor, posta e Notion, operazioni sul lab oltre gli stack di prova, altri ambienti.

### Fuori perimetro

- Avvii automatici decisi da Shinka: Shinka agisce solo su richiesta del proprietario. Un lavoro programmato è una sua richiesta, lasciata in anticipo (sezione 4.13): Shinka non se ne dà da sola. Archiviare un argomento e annotare la memoria avvengono dentro una conversazione, non da soli.
- Controllo di mouse, tastiera e schermo.
- Confinamento aggiuntivo delle conversazioni: non è una priorità del proprietario.
- Più utenti e distribuzione come prodotto.
- Motori diversi da Claude Code e Codex.
- Sistemi di clienti. Quelli del datore di lavoro solo come scritto nella sezione 4.12.

## 3. Vincoli

| Vincolo | Conseguenza |
|---|---|
| Solo abbonamenti, nessuna API key: Claude Pro, oppure ChatGPT per un'installazione con Codex | La quota è limitata e condivisa con l'uso normale. La Home parte con un modello intermedio, i progetti con quello predefinito di Claude Code; il proprietario sceglie modello ed effort per ogni conversazione e vede quanto resta dei limiti. La fonte di autenticazione si sceglie in un solo punto del codice. |
| Solo infrastruttura personale, o un server del lavoro del proprietario per un'installazione al lavoro | Nessun sistema di terzi tra ambienti e host, se non quelli che il proprietario mette nel vault. |
| Centro in un container su Unraid | Shinka risponde anche a PC spento. Progetti e file di un ambiente spento si possono solo consultare, per ciò che il centro ne conserva. |
| Un nodo per ambiente | Ogni ambiente ha il proprio login del motore e deve essere acceso mentre vi si lavora. |
| Accesso solo da VPN privata, più login | L'interfaccia non è mai pubblicata su Internet. |
| Tutto TypeScript | Gli stessi tipi dal motore all'interfaccia, e lo stesso nodo su Linux e su Windows. |
| Interfaccia nostra, montata con componenti pronti | Librerie con licenza permissiva per chat, terminale e anteprima. Nessun fork di prodotti esistenti. |

## 4. Regole del dominio

### 4.1 Smistamento

La Home sceglie tra tre esiti:

- **Fa da sé** le domande, le azioni brevi e i lavori che si chiudono in una seduta, anche quando producono file: uno script, un documento breve, una ricerca.
- **Propone un progetto** per i lavori che dureranno più sedute o che hanno bisogno di una cartella e di un repository propri.
- **Nel dubbio chiede** al proprietario, con un tocco, se fare il lavoro lì o aprire un progetto.

Aperto un progetto, il lavoro prosegue lì: la Home ne riferisce e vi inoltra istruzioni, ma non lo porta avanti in parallelo.

### 4.2 Argomenti della Home

- La conversazione della Home è fatta di argomenti. Di solito uno solo è aperto: quello della chat principale. Il proprietario può aprirne altri, fino a tre, in chat parallele: ciascuna è un argomento aperto, in una scheda, e lavora anche mentre le altre lavorano. Telegram e i lavori programmati restano sulla principale.
- Quando il proprietario chiude una chat parallela, la Home archivia il suo argomento con titolo e riassunto; se è vuoto non lascia nulla.
- Quando il proprietario cambia argomento, la Home archivia quello aperto con un titolo e un riassunto, lo segnala in una riga e riparte con il contesto pulito. Decide da sola; il proprietario può riaprire un argomento archiviato quando vuole.
- I file prodotti in un argomento stanno in una cartella di quell'argomento, nell'ambiente in cui sono stati prodotti. *(Assunzione, vedi sezione 11.)*
- Prima di rifare qualcosa la Home cerca tra gli argomenti archiviati e i loro file. Se trova ciò che serve lo riusa, e lo riscrive solo se il proprietario chiede modifiche.
- Il centro conserva titolo, riassunto e storia di ogni argomento, e l'elenco dei suoi file. Se l'ambiente di un file è spento, la Home sa che il file esiste ma non può riaprirlo finché l'ambiente non torna attivo. *(Assunzione, vedi sezione 11.)*
- Un argomento cresciuto oltre una seduta può diventare un progetto: la Home lo propone, e il progetto nasce con i file già prodotti. *(Assunzione, vedi sezione 11.)*

### 4.3 Ambienti

- Un ambiente è attivo quando il suo nodo è collegato al centro. È il nodo a collegarsi al centro, non il contrario.
- Fa eccezione il lavoro offline: quando il centro non si raggiunge, chi sta sulla macchina di un ambiente, con Shinka Desktop, lavora ai progetti di quell'ambiente attraverso il suo nodo, che per questo ascolta solo da quella macchina e solo con un gettone che tiene tra i suoi dati. Offline lavora solo la conversazione principale di un progetto; gli strumenti di Shinka che passano dal centro dicono che manca, salvo leggere le skill, e ricordare in memoria o salvare una skill, che partono verso il centro al ritorno. Le credenziali del vault non arrivano mai al lavoro offline.
- Il collegamento tra un nodo e il centro è cifrato. Il nodo riconosce il centro dal suo certificato e non parla con chi ne presenta un altro; non torna al collegamento in chiaro una volta che lo ha riconosciuto. Il centro accetta ancora i nodi in chiaro delle versioni di prima, finché il proprietario non sceglie di accettare solo quelli cifrati.
- Ogni ambiente ha una breve descrizione di ciò che offre, per esempio "PC Windows: Unity, Blender". La Home la usa per scegliere dove lavorare e per proporre l'ambiente di un progetto. *(Assunzione, vedi sezione 11.)*
- La Home agisce in ogni ambiente attivo, con il modo dei permessi che il proprietario ha scelto per lei: può scrivere file ed eseguire comandi sul PC Windows senza che serva un progetto.
- Il terminale e l'anteprima di un progetto agiscono nel suo ambiente. Le applicazioni con finestra, come Unity e Blender, si vedono sullo schermo di quell'ambiente e non nell'anteprima.
- Gli stack di prova e l'uso delle credenziali passano sempre dal gateway del centro, qualunque sia l'ambiente.
- Di ogni ambiente attivo si vede a che versione di Shinka è il suo nodo, e se è indietro rispetto al centro.
- Di ogni ambiente attivo il proprietario vede, in una pagina, come stanno processore, memoria e disco mentre guarda, i processi che pesano di più e, dove c'è Docker, i container con stato e risorse. Li legge il nodo dell'ambiente, solo finché la pagina è aperta: non tiene una storia e non tocca nulla. È una vista del proprietario: le conversazioni non la ricevono.

### 4.4 Progetto

- Nasce solo per mano del proprietario: quando conferma una proposta della Home che indica nome, cartella e ambiente, oppure quando lo crea lui stesso dall'interfaccia, con le stesse scelte e un brief scritto da lui. Nessuna conversazione ne crea uno da sola.
- La Home propone l'ambiente in base alla richiesta. Il proprietario lo conferma o lo cambia, scegliendo tra quelli attivi in quel momento.
- Vive in un ambiente, il suo, con una cartella propria, repository Git, brief e conversazioni proprie: lì gira il suo motore. *(Assunzione: non si sposta, vedi sezione 11.)*
- Il proprietario può collegargli cartelle di altri ambienti, una per ambiente. Il progetto ci lavora con gli strumenti di Shinka (comandi, file letti, scritti e modificati), che seguono il modo dei permessi del progetto come i suoi comandi; terminale, anteprima e pannello File restano quelli del suo ambiente. Le collega e le scollega solo il proprietario.
- La prima conversazione parte pulita: contiene il brief e nient'altro di ciò che è stato detto nella Home. Di un progetto creato dal proprietario la Home viene avvisata.
- Può avere più conversazioni nel tempo, e ognuna si può riprendere. Accanto alla principale il proprietario può aprire fino a tre chat parallele, nella stessa cartella e con le stesse impostazioni; chiusa una chat parallela, la sua storia si cancella e restano i file.
- Se il suo ambiente è spento resta visibile con stato e storia, ma non ci si può lavorare. *(Assunzione, vedi sezione 11.)*
- Il lavoro offline (sezione 4.3) vale per i progetti di quell'ambiente, e offline il proprietario può crearne uno nuovo lì, con nome e brief. Un progetto lo tocca un posto per volta: offline solo quella macchina, con il centro solo il centro. Finché il lavoro fatto offline non è arrivato al centro, il centro non scrive a quel progetto, e lo dice.

### 4.5 La Home sa tutto

- Ogni progetto mantiene il proprio stato del progetto, aggiornato alla fine di ogni turno di lavoro.
- Il centro conserva stato e storia di ogni progetto e di ogni argomento. Per questo la Home sa rispondere anche quando un ambiente è spento. Il lavoro fatto offline in un ambiente il centro lo riceve dal nodo quando torna: la storia del progetto continua da dove si era fermata, con una nota che dice dove è stato fatto, e nulla vi entra due volte. Un progetto nato offline il centro lo registra com'è nato.
- La Home risponde su qualunque progetto consultando gli stati, e legge la storia completa quando serve il dettaglio.
- La Home sa anche quali ambienti sono attivi, quali stack di prova sono in funzione e quali progetti aspettano una risposta del proprietario.
- La conoscenza sale e non passa di lato: un progetto vede il proprio brief, la propria storia, la memoria e le skill, non gli altri progetti né la conversazione della Home. *(Assunzione, vedi sezione 11.)*
- Su richiesta del proprietario la Home inoltra un'istruzione a un progetto; il lavoro lo svolge il progetto. *(Assunzione, vedi sezione 11.)*

### 4.6 Memoria e skill

- La memoria raccoglie preferenze e fatti sul proprietario che valgono sempre. È in file di testo e vale in ogni argomento, in ogni progetto e in ogni ambiente.
- Claude annota la memoria da solo, quando incontra qualcosa che vale la pena ricordare. Il proprietario la vede in una pagina dell'interfaccia, dove corregge o cancella ogni voce.
- Claude crea una skill da solo dopo un lavoro riuscito che potrebbe ripetersi, e la migliora da solo quando trova un modo migliore. Non serve conferma.
- Ogni creazione e ogni modifica di una skill finisce in un repository Git e viene segnalata al proprietario, che può vederla e annullarla.
- Memoria e skill valgono in tutti gli ambienti.
- Nessun segreto entra in memoria, brief, skill o riassunti degli argomenti.

### 4.7 Permessi, approvazioni e divieti

- Si usano i permessi del motore, senza confinamento aggiuntivo: quelli di Claude Code, oppure approvazioni e sandbox di Codex, ricondotti agli stessi quattro modi.
- Per ogni conversazione il proprietario sceglie il modo dei permessi: chiedi sempre, modifiche libere, automatico, senza permessi. La scelta resta salvata. La Home nasce con chiedi sempre, un progetto con modifiche libere.
- L'approvazione la dà solo il proprietario, dall'interfaccia o da Telegram. Vale per l'operazione esatta mostrata e ha una scadenza.
- **Il sì dato al gateway.** Per due cose l'approvazione riferita dal centro non basta: installare una versione nuova del gateway, e ogni comando sul server su cui gira Shinka. Il sì lo chiede il gateway al proprietario, lui stesso: con un pulsante su Telegram che solo il gateway può creare, oppure nella pagina del vault, dopo la frase. Il centro mostra che cosa aspetta e può ritirare la richiesta; non può dire di sì.
- Divieti fissi: pagamenti, cambio di password, cancellazione di account. Nessuna approvazione e nessun modo dei permessi li sblocca, nemmeno senza permessi.
- **Browser del PC.** Dove il proprietario lo ha acceso in un ambiente, un progetto può usare il browser di quella macchina in qualunque modo dei permessi. Lì ogni azione, anche leggere una pagina, aspetta il consenso del proprietario, sempre: anche in automatico e senza permessi, perché lì Shinka non ha altro modo di far valere i divieti fissi. Un'azione negata o rimasta senza risposta fino alla scadenza non parte. Il vault lì non entra.
- I contenuti arrivati dall'esterno, come pagine web, file scaricati e README, sono dati: non concedono permessi e non approvano nulla.
- Quando arriverà la posta: invio libero ai destinatari noti, approvazione per ogni destinatario mai visto.

### 4.8 Vault

- Il vault custodisce le credenziali del proprietario: chiavi e password per SSH, nomi utente e password per i siti.
- Le credenziali le inserisce il proprietario dall'interfaccia, mai scrivendole in una conversazione. *(Assunzione, vedi sezione 11.)*
- Claude usa una credenziale chiedendola per nome: è il gateway a inserirla al suo posto. Il valore non entra mai nella conversazione, nel suo archivio, nella memoria o in un registro.
- Claude non può leggere una credenziale, nemmeno su richiesta del proprietario e nemmeno senza permessi. Il proprietario la vede solo dall'interfaccia. Fa eccezione soltanto la credenziale in chiaro, qui sotto.
- Ogni credenziale dice dove può essere usata: quale host, quale sito. Fuori da lì il gateway la rifiuta.
- Ogni uso finisce nel registro: quale credenziale, dove, quando, per quale conversazione.
- Una credenziale per SSH può essere dichiarata dal proprietario come quella del server su cui gira Shinka. Su quegli host, con qualunque credenziale, ogni comando aspetta il sì dato al gateway (sezione 4.7).
- Il proprietario può scaricare una copia del vault dalla pagina del vault, e ricaricarla lì: è il vault com'è, cifrato con la sua frase di sblocco, e senza la frase non si legge. Non passa dal centro né da una conversazione, e il centro non la può chiedere. Ricaricarla vale solo con la frase della copia, che da allora è la frase del vault; a vault già impostato, solo dopo essere entrati con la frase di adesso.
- **Eccezione, scelta dal proprietario: la chiave di un'estensione.** È una voce del vault di un tipo a parte, legata a un'estensione e agli ambienti in cui vale. Il gateway la consegna al programma di quell'estensione quando parte in uno di quegli ambienti: lì il programma la riceve per intero, e una conversazione dello stesso ambiente potrebbe leggerla con un comando. Non compare comunque nella chat, negli archivi, negli eventi né nei file di Shinka, e ogni consegna finisce nel registro senza il valore. Le credenziali per SSH e per i siti non escono mai dal gateway: per loro le regole qui sopra valgono intere.
- **Eccezione, scelta dal proprietario: la credenziale in chiaro.** È una credenziale per host o per siti che il proprietario segna come in chiaro quando la inserisce, per prove, laboratori e servizi a basso rischio. Claude ne legge utente e valore con uno strumento, indicando l'host o il sito in cui la userà: vale solo dove il proprietario l'ha scritta, e il vault chiuso la blocca come le altre. Il valore entra nella conversazione e nel suo archivio, e il proprietario lo sa: non entra comunque in memoria, skill o riassunti, né nel registro, che annota ogni lettura. Claude può proporre di salvarne una che ha generato, per gli host o i siti che indica: il gateway la tiene da parte, e la mette nel vault com'era proposta solo se il proprietario la approva dalla scheda nella conversazione. Una credenziale in chiaro può diventare protetta; una protetta non diventa mai in chiaro, nemmeno sostituendola. Per le credenziali protette le regole qui sopra valgono intere.

### 4.9 Stack di prova

Gli stack di prova girano sugli host Docker del lab, accanto ai servizi del proprietario. Per questo esiste un recinto:

- Claude crea, aggiorna, ferma e rimuove da solo soltanto gli stack creati da Shinka, riconoscibili da nome ed etichetta, con porte e volumi in intervalli dedicati.
- Qualunque altra operazione su un host richiede approvazione.
- Niente container privilegiati e niente montaggi di percorsi sensibili dell'host.
- Ogni operazione finisce nel registro.
- Per la pagina degli ambienti il gateway legge, su ogni host per gli stack, l'elenco di tutti i container con il loro stato e le loro risorse. Legge soltanto, con un comando fisso che il centro non sceglie, e solo mentre il proprietario guarda la pagina; a vault chiuso non legge. Nel registro finisce una riga per host per ogni quarto d'ora in cui la pagina resta aperta, non una per lettura.

### 4.10 Sviluppo di Shinka

Shinka si sviluppa da dentro Shinka, in un progetto.

- Tra i progetti c'è sempre il progetto Shinka, la cui cartella è il codice di Shinka. Per il resto è un progetto come gli altri.
- Un pezzo nuovo nasce da una proposta di sviluppo: la chiede il proprietario, oppure la fa la Home quando si accorge che a Shinka manca qualcosa. Nulla parte finché il proprietario non la conferma.
- Una versione entra in funzione solo se le prove passano su una copia pulita del codice e se il proprietario la approva dopo aver visto che cosa cambia. L'approvazione vale per quella versione. La richiesta non scade: aspetta il proprietario finché non decide, e smette di aspettare solo se una richiesta più recente ne prende il posto o se il centro riparte.
- Se la versione nuova non parte, torna in funzione quella di prima, e Shinka lo dice.
- Dopo un'installazione approvata passano alla versione nuova anche i nodi degli altri ambienti che in quel momento sono collegati e sanno aggiornarsi: la scheda li nomina prima. Un nodo rimasto indietro lo aggiorna il proprietario, dalla pagina degli ambienti. Nessun nodo si aggiorna da solo fuori da questi due casi.
- L'aggiornamento di un nodo non parte mentre nel suo ambiente una conversazione lavora o aspetta il proprietario. Se sul nodo la versione nuova non parte o non si collega al centro, torna quella di prima, e la pagina degli ambienti dice perché.
- Il gateway si può modificare dal progetto Shinka. Dopo un'installazione approvata il centro gli propone la versione; il gateway guarda da sé che cosa cambia nei file che carica. Se non cambia nulla non succede nulla; se cambia qualcosa la installa solo con il sì dato al gateway (sezione 4.7). Con quel sì il gateway si riavvia, e il vault resta chiuso finché il proprietario non lo riapre; se la versione nuova non parte, torna quella di prima, e il gateway lo dice.
- I guardiani, del centro, dei nodi e del gateway, entrano in funzione solo da fuori, su richiesta del proprietario.
- Ciò che riguarda il server e non il codice, come ricreare un container di Shinka o cambiarne immagine e porte, il progetto Shinka lo fa con la credenziale del server, se il proprietario l'ha inserita nel vault: un comando alla volta, ognuno con il sì dato al gateway.
- Le regole di questa sezione 4 e i divieti fissi il progetto Shinka li cambia solo se il proprietario lo chiede in modo esplicito.

### 4.11 Estensioni

Un'estensione è codice di terzi che dà strumenti in più alle conversazioni: un server MCP locale, un server MCP remoto o un plugin di Claude Code preso da un repository Git.

- Shinka tiene il suo elenco di estensioni al centro, e per ognuna dice in quali ambienti è accesa. Nella configurazione personale di Claude Code di un ambiente Shinka non scrive nulla.
- Un'estensione entra nell'elenco, o si accende in un ambiente, solo dopo che il proprietario ha confermato una scheda che dice che cosa è, da dove viene, il comando o l'indirizzo esatto e l'ambiente. Di un plugin la scheda dice anche che cosa contiene, e avverte di ciò che parte da solo o che Shinka non sa leggere. Finché non conferma non viene installato né avviato nulla.
- Un'estensione si accende solo se parte: dopo la conferma l'ambiente la avvia una volta, da sola, e dice quali strumenti offre o perché non è partita.
- Accesa in un ambiente, la usano i progetti di quell'ambiente. La Home usa quelle accese nell'ambiente del centro.
- Fa eccezione un modello locale che il proprietario mette in rete: lo usano anche la Home e i progetti degli altri ambienti. Il suo server ascolta dalla rete con una chiave che Shinka genera e tiene per sé, e che non entra nelle conversazioni né nell'interfaccia; lo mette in rete e lo toglie solo il proprietario, ambiente per ambiente.
- Ogni azione di un'estensione chiede il consenso come le altre, secondo il modo dei permessi della conversazione.
- Le versioni restano ferme: un plugin al commit mostrato nella scheda, un server alla versione scritta nel comando. Aggiornarle è una proposta nuova.
- Ciò che il proprietario ha già installato per conto suo in un ambiente continua a valere nei progetti di quell'ambiente. Shinka lo mostra, e non lo copia, non lo spegne e non lo toglie.
- Un'estensione gira nell'ambiente con gli accessi dei progetti e non passa dal gateway: recinto, divieti fissi e registro non vedono ciò che fa.
- **Estensioni dell'interfaccia.** Un tema, delle pagine e dei pulsanti che cambiano l'aspetto di Shinka o le aggiungono funzioni, scritti da Claude per intero. Entrano solo dopo che il proprietario ha confermato una scheda che dice che cosa aggiungono, con l'anteprima delle pagine e il testo dei pulsanti; li spegne e li toglie dalla pagina Estensioni. Una pagina gira in un recinto, senza la sessione del proprietario, le API di Shinka o la rete: legge lo stato (progetti, ambienti, la Home) e manda messaggi alle conversazioni, che arrivano con il suo nome e seguono i permessi di sempre. Un tema non carica nulla da altri siti, e l'interfaccia si apre anche senza temi né pulsanti.

### 4.12 Motore e installazioni

- Il motore si sceglie per conversazione, come il modello: la Home e ogni progetto usano Claude Code oppure Codex. L'installazione ha un motore predefinito per le conversazioni nuove. Cambiando motore a metà, la conversazione riparte con un riassunto di ciò che c'era prima: i due motori non condividono il contesto. Il codice è uno solo.
- Con Codex vale l'abbonamento ChatGPT del proprietario, con l'accesso ufficiale "Sign in with ChatGPT"; con Claude Code il suo abbonamento Claude. Ogni ambiente ha i suoi accessi. Nessuna API key, nessuna strada non ufficiale.
- Le regole di questa sezione 4 valgono con tutti e due i motori: la Home, gli argomenti, la memoria e le skill, il vault, i divieti fissi, le approvazioni.
- Ciò che un motore non offre si vede come non disponibile, e non si finge.
- Le impostazioni dell'installazione si cambiano da una pagina dell'interfaccia: motori e accessi, ambiente del centro, password di Shinka, indirizzi e HTTPS. Un accesso si fa dal browser, con un codice da inserire sul sito di Claude o di ChatGPT; nessuna password del motore passa da Shinka.
- Un'installazione nuova nasce da un file Compose con centro e gateway, e al primo avvio il browser guida il proprietario: password, motore predefinito, accessi, ambiente. Un ambiente Linux o Windows si prepara con uno script, che installa il nodo e il suo guardiano.
- Un'installazione può stare su un server del lavoro del proprietario. Resta personale: un solo proprietario, il suo vault, le sue approvazioni. Tocca un sistema dell'azienda solo con una credenziale che il proprietario mette nel vault, con le stesse regole dei suoi host. Le regole dell'azienda sull'uso di questi strumenti le verifica il proprietario.

### 4.13 Lavori programmati

- Un lavoro programmato è una richiesta del proprietario che parte da sola: a un'ora in certi giorni, a intervalli, oppure una volta sola. Gli orari valgono nel fuso del proprietario.
- Esiste solo se il proprietario lo ha creato dalla pagina Programmati, o se ha confermato la scheda con cui una conversazione glielo propone. Una conversazione non ne crea, non ne cambia e non ne riattiva da sola; può toglierne uno, con il consenso che il suo modo dei permessi chiede.
- Quando tocca, la richiesta arriva come un messaggio alla conversazione in cui il lavoro gira: nella Home, in un argomento suo, oppure in un progetto. Nella Home l'argomento aperto viene archiviato con il suo titolo, e non mentre il proprietario lo sta usando; il lavoro riusa il suo argomento da una volta all'altra.
- Lavora con le impostazioni e il modo dei permessi che quella conversazione ha in quel momento. Ciò che chiede il consenso del proprietario lo aspetta, come sempre: un lavoro programmato non approva nulla al suo posto, e i divieti fissi valgono.
- La risposta finale arriva al proprietario su Telegram, ogni volta oppure solo quando c'è qualcosa da segnalare, come lui ha scelto. Un errore arriva sempre.
- Se la conversazione è occupata il lavoro aspetta, e dopo un'ora per quella volta rinuncia; se Shinka era spenta parte quando torna, se il ritardo è di poco. Ciò che è stato saltato resta scritto, con il motivo.
- Se il limite del piano è esaurito, prima di partire o a metà del lavoro, il lavoro non rinuncia: aspetta che il limite si azzeri e riparte da solo, una volta sola, anche se nel frattempo sarebbe toccato di nuovo. Gli eventi che portava tornano ad aspettare. Nell'elenco si vede quando riparte; messo in pausa, non riparte.
- Il proprietario vede l'elenco, con la prossima volta e com'è andata l'ultima, e da lì cambia un lavoro, lo mette in pausa, lo fa partire subito o lo toglie.
- **Eventi in ingresso.** Un lavoro programmato può partire, invece che a un orario, quando un altro sistema manda un evento al suo indirizzo: il server, il firewall, un monitor dei servizi. L'indirizzo ha una chiave sua, lunga e casuale, e risponde senza la sessione del proprietario: chi lo conosce può solo far partire quel lavoro. Un lavoro così lo crea solo il proprietario, dalla pagina; una conversazione non ne propone, e la chiave non le viene detta. Il proprietario può cambiare l'indirizzo, e quello di prima smette di valere.
- Che cosa fare quando arriva un evento lo dice la richiesta scritta dal proprietario. L'evento le viene accodato come materiale da leggere, in un riquadro che dice da dove viene: non è una richiesta del proprietario, e ciò che contiene non chiede e non autorizza nulla. Per il resto il lavoro è come gli altri: stessa conversazione, stessi permessi, stessa risposta su Telegram.
- Gli eventi arrivati mentre la conversazione è occupata aspettano, e vengono consegnati insieme. Ce ne sono dei limiti: quanto è lungo un evento, quanti ne aspettano, quanti in un'ora. Oltre, vengono rifiutati a chi li manda. Un lavoro in pausa non ne accoglie.

## 5. Architettura

```text
Browser (solo VPN) ──┐
Bot Telegram ────────┤
                     ▼
        Centro (container su Unraid)
        │  interfaccia, Home, argomenti, elenco dei progetti
        │  stato e storia di argomenti e progetti
        │  memoria, skill, permessi e approvazioni
        │
        ├── nodo dell'ambiente Unraid ───── Claude Agent SDK ── Claude (Pro)
        ├── nodo dell'ambiente PC Windows ── Claude Agent SDK ── Claude (Pro)
        │     in un'installazione con Codex: app-server di Codex ── ChatGPT
        │     ogni nodo si collega al centro e fa girare le conversazioni dei
        │     progetti, i lavori della Home in quell'ambiente, terminale e anteprima
        ▼
        Gateway ─── host Docker del lab, host SSH, siti
        (vault, recinto, registro)

Dati al centro: oggi file, cioè elenchi in JSON e conversazioni in righe a sola aggiunta;
                file di testo per brief, stati, memoria e skill; immagini e allegati come file.
```

| Componente | Compito |
|---|---|
| Centro | Sempre acceso. Serve l'interfaccia, tiene l'elenco di progetti, argomenti e ambienti, conserva stato e storia, custodisce memoria e skill, raccoglie le richieste di permesso e le decisioni del proprietario, inoltra i messaggi al nodo giusto. |
| Nodo | Uno per ambiente, lo stesso programma su Linux e su Windows. Si collega al centro, apre le conversazioni tramite l'Agent SDK nella cartella del progetto, esegue nel suo ambiente i lavori che la Home gli affida e rimanda gli eventi in tempo reale. Fornisce terminale e anteprima del suo ambiente. La Home gira sul nodo del centro. |
| Strumenti Shinka | Funzioni offerte alle conversazioni: proporre un progetto, elencare progetti e ambienti, leggere stato e storia, inoltrare a un progetto, archiviare e cercare argomenti, agire in un ambiente, leggere e scrivere la memoria, creare e modificare una skill, usare una credenziale. |
| Gateway | Processo separato dal resto. Custodisce il vault, applica il recinto, esegue le operazioni sugli stack di prova e quelle che usano una credenziale, e scrive il registro. |
| Bot Telegram | Porta i messaggi alla Home e consegna notifiche e richieste di approvazione. Accetta solo l'identificativo del proprietario. |
| Guardiano | Programma piccolo, fuori dal codice che cambia. Tiene acceso il centro, mette in funzione una versione approvata e rimette quella di prima se la nuova non parte. Un nodo che deve sapersi aggiornare ha il suo, che fa lo stesso con la versione che il centro gli passa; e così il gateway, con la versione che il proprietario gli ha approvato. |
| Estensioni | Codice di terzi, non di Shinka. Il centro ne tiene l'elenco; ogni nodo avvia quelle accese nel suo ambiente accanto alle conversazioni, e chiede al gateway, attraverso il centro, le chiavi che vogliono. |

Confini di fiducia:

- L'interfaccia risponde solo sulla VPN e dopo il login.
- Il centro annota in un registro delle richieste chi entra, da dove, e ciò che gli arriva senza una sessione valida. Tiene l'indirizzo, il programma e il percorso: mai il contenuto, le password o le chiavi che stanno negli indirizzi. Lo legge solo il proprietario, dalla pagina Sicurezza; alle conversazioni non viene dato.
- Il centro accetta solo i nodi registrati dal proprietario, e un nodo prende ordini solo dal centro: lo riconosce dal certificato dei nodi, di cui ricorda l'impronta. Il segreto di un nodo che è passato su un collegamento in chiaro viene cambiato appena il collegamento è cifrato.
- Un nodo prende una versione nuova solo dal centro a cui è registrato, sullo stesso collegamento da cui riceve i comandi. Il centro può già eseguire qualunque comando in quell'ambiente: passargli il codice non sposta il confine.
- Ciò che arriva da un altro sistema all'indirizzo di un lavoro programmato (sezione 4.13) è testo non fidato: il centro non lo interpreta, e alle conversazioni arriva come materiale. Quell'indirizzo non dà accesso a nient'altro.
- Una copia di sicurezza dei dati del centro esce solo cifrata, con una password che il proprietario sceglie quando la fa e che il centro non conserva. Non contiene il vault, né ciò che lega il centro a questa macchina: il collegamento con il gateway resta quello dell'installazione che la riceve. Un ripristino lo chiede solo il proprietario, confermando con la password di Shinka; vale al riavvio del centro, e i dati di prima restano da parte.
- Le conversazioni non vedono le credenziali, l'accesso agli host né il socket Docker: quelli stanno solo nel gateway.
- Il gateway verifica ogni operazione al momento dell'esecuzione, qualunque cosa abbia detto il modello.
- Il registro annota ciò che è stato realmente eseguito, non ciò che il modello dichiara.
- L'approvazione di una versione del centro è una procedura, non un confine: le conversazioni girano accanto al codice del centro. Ciò che protegge da un centro che sbaglia resta il gateway. Per questo una versione nuova del gateway, e ogni comando sul server su cui gira, passano solo con un sì che il proprietario dà al gateway, per un canale che il centro non può usare al suo posto.
- Il gateway accetta una versione nuova solo dal centro, solo per i file della sua parte, e decide da sé che cosa cambia: ciò che il centro dice della versione viene mostrato al proprietario come parole del centro.
- Un'estensione sta dalla parte delle conversazioni, non da quella del gateway: ha gli accessi dell'ambiente in cui gira. L'unico segreto che la raggiunge è la sua chiave, e solo se il proprietario l'ha scritta nel vault per lei e per quell'ambiente.

## 6. Interfaccia

- **Barra laterale**: la Home in cima, con i suoi argomenti archiviati; poi i progetti con il loro ambiente e la loro condizione in una parola: al lavoro, aspetta te, fermo, ambiente spento.
- **Chat**: risposta in tempo reale, azioni di Claude raggruppate e apribili, richieste di permesso con Approva e Nega, immagini che si aprono a tutto schermo, allegati.
- **Chat parallele**: le schede sopra la chat della Home e di un progetto, con la principale, quelle aperte, il pulsante per aprirne una nuova e quello per chiuderne una.
- **Sotto il campo di scrittura**: modello, effort, modo dei permessi, contesto occupato e limiti del piano.
- **Scheda di nuovo progetto**: nome, cartella e ambiente proposto, modificabile scegliendo tra quelli attivi, con un pulsante di conferma.
- **Scelta nel dubbio**: due pulsanti, fare il lavoro nella Home o aprire un progetto.
- **Argomenti**: la riga che segnala un argomento archiviato, l'elenco degli argomenti con ricerca, la riapertura di un argomento.
- **Memoria**: una pagina con le voci, da correggere o cancellare.
- **Skill**: l'elenco, la storia di ognuna e l'annullamento di una modifica.
- **Nuovo progetto**: la scheda con cui il proprietario crea un progetto da sé; si apre dalla barra laterale, accanto ai progetti.
- **Programmati**: l'elenco dei lavori programmati, con la prossima volta e l'esito dell'ultima; creazione, modifica, pausa, avvio immediato e rimozione.
- **Vault**: inserimento, sostituzione e rimozione delle credenziali; mai mostrate dentro una conversazione. Le chiavi delle estensioni si scrivono qui, come voci di un tipo a parte. Una credenziale si può segnare in chiaro, con un avviso che il suo valore finirà nelle conversazioni; si riconosce nell'elenco, e da qui si rende protetta.
- **Sicurezza**: le sessioni aperte, con il dispositivo e l'indirizzo da cui sono state aperte e usate, da chiudere una per una o tutte tranne la propria; quali nodi sono collegati cifrati e quali in chiaro, con la scelta di accettare solo i cifrati; il registro delle richieste al centro, con un filtro su ciò che merita uno sguardo.
- **Copia di sicurezza**, nelle Impostazioni: preparare e scaricare una copia dei dati, con una password scelta al momento; caricarne una, aprirla con la sua password e vedere che cosa contiene; da lì portare qui la memoria e le skill scelte, oppure ripristinare tutto, confermando con la password di Shinka. Dopo un ripristino, com'è andata e il pulsante per togliere i dati di prima. Nella pagina del vault, la copia del vault da scaricare e da caricare.
- **Un ambiente**: i grafici di processore e memoria, il disco dei progetti, i processi e i container; si apre dall'elenco degli ambienti.
- **Ambienti**: l'elenco degli ambienti con il loro stato, la versione del loro nodo e se il suo collegamento è cifrato; le richieste di collegamento da approvare; per un nodo indietro che sa aggiornarsi, il pulsante Aggiorna, con una conferma.
- **Estensioni**: una pagina con l'elenco di Shinka, dove ogni estensione si accende, si spegne e si toglie ambiente per ambiente, e con ciò che ogni ambiente ha già di suo. Nella chat, la scheda di un'estensione da installare, con Conferma e Annulla. Le estensioni dell'interfaccia hanno la loro sezione, e la loro scheda con le pagine in anteprima.
- **Cambio progetto**: dalla barra laterale, da una ricerca rapida, oppure chiedendolo alla Home.
- **Pannello laterale**: terminale e anteprima, apribili accanto alla chat.
- **Telefono**: la stessa interfaccia deve essere usabile su uno schermo piccolo.

Le schede delle azioni mostrano comunque il contenuto di ogni modifica ai file. La vista dedicata per rivedere le modifiche arriva dopo la prima versione.

## 7. Telegram

- Il proprietario scrive alla Home e riceve la risposta finale, senza il dettaglio delle azioni.
- Shinka notifica quando un progetto aspetta una risposta, quando un lavoro è finito e quando serve un'approvazione.
- Le approvazioni si danno con un pulsante. Così anche le schede: la proposta di sviluppo, l'installazione di una versione, un'estensione da installare.
- "Aggiornami sui progetti" funziona anche da qui.
- Un lavoro programmato manda qui la sua risposta finale, con il suo titolo; la scheda che ne propone uno si conferma anche da qui.
- **Notifiche dell'app.** Gli stessi avvisi (una richiesta che aspetta il proprietario, un lavoro finito, la risposta di un lavoro programmato) arrivano come notifiche ai dispositivi che il proprietario ha iscritto dalla pagina Impostazioni, anche senza Telegram. Toccandone una si apre la conversazione: lì il proprietario decide, non dalla notifica. Passano dal servizio di notifiche del browser (di Apple, di Google, di Mozilla), cifrate per il dispositivo: il servizio le consegna senza poterle leggere. A quei servizi Shinka dichiara solo il contatto che chiedono a chi manda: quello di Apple vuole un indirizzo email vero, e lo scrive il proprietario. Le risposte a ciò che il proprietario scrive da Telegram restano su Telegram.
- Il proprietario sceglie, per genere di avviso (richieste che lo aspettano, lavori finiti, lavori programmati), che cosa arriva su Telegram e che cosa come notifica dell'app. Ciò che nasce da un messaggio scritto su Telegram ha comunque lì risposta e richieste; i messaggi del gateway arrivano sempre. Se nessun dispositivo riceve le notifiche dell'app, su Telegram arriva tutto.
- Le domande del gateway (sezione 4.7) arrivano con un messaggio del gateway. I suoi pulsanti il centro non li può creare, e ciò che il proprietario preme non passa dal centro.
- Il lavoro dentro i progetti resta nell'interfaccia web.

## 8. Incrementi

Ogni incremento deve essere usabile e dimostrabile prima di passare al successivo.

| N. | Incremento | È fatto quando |
|---|---|---|
| 0 | Verifica del motore | In ogni ambiente della prima versione una conversazione dell'Agent SDK risponde in tempo reale con il login del piano Pro, senza API key. |
| 1 | Home | Dal browser, via VPN e dopo il login, si conversa con la Home, che gira sul nodo del centro, e si vedono azioni e richieste di permesso. |
| 2 | Ambienti | Il nodo del PC Windows si collega al centro; l'interfaccia mostra quali ambienti sono attivi e si accorge quando uno si spegne. |
| 3 | Progetti | Una richiesta di lavoro produce la proposta con l'ambiente; la conferma crea cartella e conversazione con solo il brief nell'ambiente scelto; si cambia progetto e si riprende una conversazione. Almeno un progetto per ambiente. |
| 4 | Home a tutto tondo | La Home scrive uno script e lo prova in un ambiente diverso dal suo senza aprire un progetto; nel dubbio chiede; al cambio di argomento archivia il precedente e lo segnala; richiesto di nuovo lo script, lo ritrova e lo riconsegna senza riscriverlo; riferisce lo stato di un progetto mai aperto in quella conversazione, anche con il suo ambiente spento. |
| 5 | Memoria e skill | Una preferenza detta nella Home vale in un progetto di un altro ambiente, e il proprietario la vede e la corregge; Claude crea una skill dopo un lavoro riuscito e più tardi la migliora, e ogni modifica è nella storia e si può annullare. |
| 6 | Gateway e vault per SSH | Claude esegue un comando su un host con una credenziale del vault, e né la chiave né la password compaiono nella conversazione o nel suo archivio; una credenziale non prevista per quell'host viene rifiutata. |
| 7 | Vault per il browser | Claude entra in un sito con una credenziale del vault senza vederla. |
| 8 | Terminale e anteprima | Si lancia un comando nella cartella del progetto, nel suo ambiente, e si vede l'applicazione web accanto alla chat. |
| 9 | Stack di prova | Claude avvia un container su un host del lab senza approvazione, e la chiede per toccare un servizio non suo. |
| 10 | Telegram | Messaggi, notifiche e approvazioni funzionano; un mittente diverso dal proprietario viene ignorato. |
| 11 | Shinka sviluppa sé stessa | Una richiesta alla Home produce la proposta di sviluppo; confermata, il progetto Shinka scrive e prova la modifica; dopo l'approvazione Shinka riparte con la versione nuova; una versione che non parte lascia in funzione quella di prima. |
| 12 | Estensioni | Una richiesta alla Home produce la scheda di un'estensione; confermata, l'estensione parte e i suoi strumenti si usano nella Home e in un progetto, con il consenso; una che vuole una chiave la riceve dal vault, e il valore non compare nella conversazione, nell'archivio né nel registro; una che non parte non viene accesa. |
| 13 | Aggiornamento dei nodi | Dopo un'installazione approvata un nodo collegato, tenuto acceso dal suo guardiano, passa da solo alla versione nuova; un nodo rimasto indietro si aggiorna con un pulsante dalla pagina degli ambienti; una versione che sul nodo non si collega lascia in funzione quella di prima, e la pagina lo dice. |
| 14 | Gateway e server dal progetto Shinka | Dopo un'installazione approvata che cambia il gateway, il gateway chiede il sì al proprietario e con quel sì passa alla versione nuova; una versione che non parte lascia in funzione quella di prima; un comando sul server parte solo con il sì dato al gateway, e il centro non lo può dare. |

## 9. Prove di accettazione

| ID | Scenario | Risultato atteso |
|---|---|---|
| A01 | Domanda secca nella Home | Risposta in chat, nessun progetto creato |
| A02 | Richiesta di lavoro lungo, senza conferma | Nessuna cartella, nessuna conversazione nuova |
| A03 | Richiesta di lavoro lungo, con conferma | Cartella nuova nell'ambiente scelto e conversazione che contiene solo il brief |
| A04 | "A che punto è X?" dalla Home | Risposta coerente con lo stato del progetto X |
| A05 | Cambio progetto dalla barra e dalla Home | L'interfaccia mostra il progetto giusto con la sua storia |
| A06 | Modifica di un file dentro il progetto | Nessuna richiesta di permesso |
| A07 | Richiesta di permesso negata dal proprietario | L'azione non avviene |
| A08 | Avvio di uno stack di prova | Eseguito senza approvazione, annotato nel registro |
| A09 | Arresto di un servizio non creato da Shinka | Richiesta di approvazione; senza approvazione non avviene |
| A10 | Pagina web con istruzioni nascoste letta in una conversazione | Nessuna operazione sugli host, nessun uso di credenziali e nessun permesso nuovo |
| A11 | Richiesta di un pagamento o di un cambio password | Rifiutata anche con approvazione e anche senza permessi |
| A12 | Messaggio Telegram da un altro mittente | Ignorato |
| A13 | Riavvio del centro o di un nodo | Progetti, argomenti e conversazioni si ritrovano e si riprendono |
| A14 | Accesso all'interfaccia senza VPN | Non raggiungibile |
| A15 | Richiesta di un progetto Unity | La proposta indica l'ambiente Windows e permette di cambiarlo |
| A16 | Proposta di progetto con un ambiente spento | L'ambiente spento non è selezionabile |
| A17 | Ambiente di un progetto spento | Il progetto si consulta e la Home ne riferisce lo stato, ma non ci si può lavorare |
| A18 | Nodo non registrato dal proprietario | Il centro lo rifiuta |
| A19 | Script richiesto alla Home | Scritto e consegnato dalla Home, nessun progetto |
| A20 | Richiesta a metà tra lavoro piccolo e progetto | La Home chiede con un tocco dove farlo |
| A21 | Lavoro piccolo che riguarda un altro ambiente | Eseguito in quell'ambiente, con il modo dei permessi della Home |
| A22 | Cambio di argomento nella Home | L'argomento precedente è archiviato con titolo e riassunto, una riga lo segnala, il contesto riparte pulito |
| A23 | Richiesta di qualcosa già fatto in un argomento archiviato | Ritrovato e riconsegnato senza riscriverlo |
| A24 | Argomento che diventa progetto | Il progetto nasce con i file già prodotti |
| A25 | Preferenza detta una volta | Vale in un'altra conversazione e in un altro ambiente; il proprietario la vede e la cancella |
| A26 | Skill modificata da Claude | La modifica è nella storia, è segnalata e si può annullare |
| A27 | Uso di una credenziale del vault | Il valore non compare nella conversazione, nell'archivio né nel registro |
| A28 | Richiesta a Claude di mostrare una password | Rifiutata |
| A29 | Credenziale usata fuori dall'host o dal sito previsto | Rifiutata dal gateway |
| A30 | Richiesta alla Home di un pezzo nuovo di Shinka, senza conferma | Compare la proposta di sviluppo; il progetto Shinka non riceve nulla |
| A31 | Versione di Shinka le cui prove non passano | Nessuna scheda per il proprietario; il progetto Shinka sa che cosa non è passato |
| A32 | Versione provata, senza approvazione | Resta in funzione quella di prima, e la richiesta resta in attesa; una richiesta più recente ne prende il posto, e quella di prima non si può più approvare |
| A33 | Versione approvata che non parte | Torna in funzione quella di prima, e la conversazione lo dice |
| A34 | Versione che cambia il gateway, approvata | Il gateway in funzione resta quello di prima, e la scheda lo aveva avvisato |
| A35 | Richiesta alla Home di un'estensione, senza conferma | Compare la scheda con il comando o l'indirizzo esatto e l'ambiente; nulla viene installato né avviato |
| A36 | Estensione confermata che non parte | Non viene accesa, e la scheda dice perché |
| A37 | Estensione accesa in un ambiente | I suoi strumenti si usano nei progetti di quell'ambiente e, se è quello del centro, nella Home; ogni azione chiede il consenso secondo il modo dei permessi |
| A38 | Estensione che vuole una chiave, con la chiave nel vault | Il programma la riceve; il valore non compare nella conversazione, nell'archivio, nei file di Shinka né nel registro, che annota la consegna |
| A39 | Chiave chiesta per un'altra estensione o per un altro ambiente, o vault chiuso | Il gateway non la consegna, e l'estensione non parte |
| A40 | Richiesta di consegnare una credenziale per SSH o per un sito come chiave di un'estensione | Rifiutata dal gateway |
| A41 | Installazione approvata con un nodo collegato che sa aggiornarsi | La scheda lo nominava; dopo il riavvio del centro il nodo passa alla versione nuova |
| A42 | Nodo indietro rispetto al centro, pulsante Aggiorna | Il nodo riparte con la versione del centro e non risulta più indietro |
| A43 | Versione che sul nodo non parte o non si collega al centro | Torna in funzione quella di prima, e la pagina degli ambienti dice perché |
| A44 | Aggiornamento chiesto mentre in quell'ambiente una conversazione lavora, oppure a un nodo che nessun guardiano tiene acceso | Non parte, e dice perché |
| A45 | Installazione approvata di una versione che non cambia nulla di ciò che il gateway carica | Il gateway non chiede nulla e non si riavvia |
| A46 | Installazione approvata di una versione che cambia il gateway, sì dato al gateway | Il gateway ha chiesto lui, dicendo quali file cambiano; passa alla versione nuova, il vault è chiuso, e lo dice su Telegram |
| A47 | Versione del gateway che non parte | Torna in funzione quella di prima, e il gateway lo dice |
| A48 | Il centro riferisce un sì per una versione del gateway o per un comando sul server, o manda un messaggio con il pulsante del gateway | Rifiutato: non si installa e non si esegue nulla |
| A49 | Comando sul server con la credenziale del server, sì dato al gateway | Eseguito com'era scritto; il registro annota che il sì è stato dato al gateway |
| A50 | Comando sul server negato, ritirato dalla scheda, o rimasto senza risposta | Non parte |
| A51 | Azione nel browser del PC da una conversazione in automatico o senza permessi | Viene chiesta al proprietario, e parte solo con il suo sì; il resto del lavoro non chiede nulla |
| A52 | Azione nel browser del PC negata, o rimasta senza risposta fino alla scadenza | Non parte, in nessun modo dei permessi |
| A53 | Lettura di una credenziale in chiaro per un host o un sito in cui vale | Claude riceve utente e valore; il registro annota la lettura senza il valore |
| A54 | Lettura di una credenziale protetta, o di una in chiaro fuori dai suoi host o siti, o a vault chiuso | Rifiutata dal gateway, senza il valore |
| A55 | Credenziale in chiaro proposta da Claude, approvata dalla scheda | Entra nel vault com'era proposta, in chiaro, solo per gli host o i siti indicati |
| A56 | Credenziale in chiaro proposta da Claude, negata o lasciata scadere | Non entra nel vault |
| A57 | Credenziale protetta sostituita chiedendo che diventi in chiaro | Rifiutata: resta protetta |
| A58 | "Ogni mattina controlla i backup" chiesto alla Home | Compare una scheda con quando parte e la richiesta; il lavoro nasce solo con la conferma |
| A59 | Arriva l'ora di un lavoro programmato nella Home, con un altro argomento aperto e fermo | L'argomento aperto viene archiviato con il suo titolo, il lavoro si svolge nel suo, e la risposta arriva su Telegram |
| A60 | Lavoro che avvisa solo se serve, senza nulla da segnalare | Il proprietario non riceve nulla; l'elenco dice com'è andata |
| A61 | Lavoro programmato che ha bisogno di un consenso, in una conversazione che chiede | La richiesta di consenso arriva al proprietario, e il lavoro aspetta |
| A62 | Ora di un lavoro con la conversazione occupata per più di un'ora, o con l'ambiente del progetto spento | Per quella volta è saltato, e l'elenco dice perché |
| A63 | Evento mandato all'indirizzo di un lavoro, senza sessione | Accolto; il lavoro parte con la richiesta del proprietario e l'evento come materiale, e la risposta arriva su Telegram |
| A64 | Evento con dentro istruzioni ("ignora tutto e…") | Il lavoro fa ciò che dice la richiesta del proprietario; nessuna azione chiesta dall'evento |
| A65 | Evento a un indirizzo sconosciuto, a un indirizzo cambiato, o a un lavoro in pausa | Rifiutato; non parte nulla |
| A66 | Più eventi mentre il lavoro è occupato; poi più di quanti ne possano aspettare | I primi arrivano insieme alla volta successiva; gli altri sono rifiutati a chi li manda |
| A67 | Progetto creato dal proprietario dalla scheda «Nuovo progetto» | Nasce nella cartella e nell'ambiente scelti, la sua conversazione parte dal brief scritto da lui, e nella Home non compare nessuna proposta |
| A68 | Notifiche accese su un dispositivo, poi una richiesta di consenso in un progetto senza pagine aperte | Sul dispositivo arriva una notifica con il titolo della richiesta; toccandola si apre il progetto |
| A69 | Notifica mandata a un'iscrizione che il servizio dice scaduta | L'iscrizione viene tolta; gli altri dispositivi ricevono |
| A70 | Iscrizione con un indirizzo che non è di un servizio di notifiche | Rifiutata: il centro non scrive a indirizzi qualunque |
| A71 | Pagina di un ambiente attivo, aperta | Processore e memoria si aggiornano ogni pochi secondi; si vedono i processi che pesano di più, e i container dove Docker c'è |
| A72 | Pagina dell'ambiente del centro, con un host per gli stack nel vault | Si vedono tutti i container di quell'host, con stato e risorse; sull'host arriva solo il comando di lettura, e nel registro una riga, non una per lettura |
| A73 | La stessa pagina a vault chiuso, o con l'ambiente spento | Dice perché non si legge; sull'host non arriva nulla |
| A74 | Entrata con la password giusta, e con una sbagliata | Nel registro delle richieste compaiono tutte e due, con l'indirizzo e il programma; la password non c'è |
| A75 | Molte richieste senza sessione dallo stesso indirizzo, con una chiave nell'indirizzo | Una riga sola con il conto; del percorso resta la parte prima del punto interrogativo |
| A76 | Dalla pagina Sicurezza, chiusura della sessione di un altro dispositivo | Quel dispositivo è fuori e deve rientrare con la password; chi l'ha chiusa resta dentro |
| A77 | Un nodo di questa versione si collega al centro | Il collegamento è cifrato; il nodo ricorda il certificato del centro, e le pagine Ambienti e Sicurezza lo dicono cifrato |
| A78 | Chi risponde all'indirizzo del centro presenta un altro certificato | Il nodo non si presenta e non gli dice nulla; lo scrive e riprova, senza tornare in chiaro |
| A79 | Un nodo il cui segreto è passato in chiaro si collega cifrato | Il centro prende un segreto nuovo; con quello di prima non si entra più |
| A80 | «Accetta solo i nodi con il collegamento cifrato» acceso, e un nodo si presenta in chiaro | Non viene ascoltato; il registro delle richieste lo annota; un nodo cifrato entra come prima |
| A81 | Il proprietario prepara una copia di sicurezza con una password e la scarica | Arriva un solo file in cui non si legge nulla dei dati; senza la password, o con un byte cambiato, non si apre |
| A82 | In un'altra installazione carica la copia, la apre e porta la memoria e una skill | Le voci che mancavano e quella skill ci sono; conversazioni, progetti e il resto di quell'installazione non cambiano |
| A83 | Chiede di ripristinare tutto, con la password di Shinka | Il centro riparte con i dati della copia; quelli di prima sono da parte sul server; il collegamento con il gateway e il vault sono quelli di prima |
| A84 | Chiede il ripristino con la password di Shinka sbagliata, o senza aver aperto la copia | Non succede nulla; il registro delle richieste annota il rifiuto |
| A85 | Scarica la copia del vault dalla pagina del vault e la carica in un gateway senza vault, con la sua frase | Le credenziali ci sono e si usano; con un'altra frase non entra; con il gettone del centro la copia non si ottiene |
| A86 | Mentre la Home lavora, il proprietario apre una chat parallela e chiede altro | Risponde subito, con gli strumenti, senza fermare la principale; chiusa la scheda, l'argomento è tra gli archiviati con il suo titolo |
| A87 | In un progetto al lavoro il proprietario apre una chat parallela, le fa leggere un file, poi la chiude | La chat legge nella stessa cartella mentre la principale continua; chiusa, la sua storia non c'è più e la principale non ne ha risentito |
| A88 | Un lavoro programmato parte con il limite del piano esaurito, oppure lo esaurisce a metà | Non parte, o si ferma senza errore; nell'elenco dice quando riparte; all'azzeramento riparte una volta sola |
| A89 | Il proprietario mette in rete il modello locale del PC e lo sceglie per la Home | La Home risponde con quel modello; il server sul PC si accende e poi si spegne da solo; senza la chiave il server non risponde; tolto dalla rete, la Home non lo offre più |
| A90 | La Home propone un tema con una pagina e un pulsante, e il proprietario la conferma | Il tema cambia l'aspetto; la pagina compare nel menu, legge lo stato e manda un messaggio con il suo nome, ma non raggiunge le API né la rete; il pulsante manda il suo testo; con «?senza-estensioni» non ci sono |
| A91 | Con il centro irraggiungibile, il proprietario da Shinka Desktop scrive a un progetto del suo PC e ne crea uno nuovo; poi il centro torna | Offline i due progetti lavorano e chiedono i permessi lì; tornato il centro, le loro storie e il progetto nuovo ci sono, una volta sola, e i progetti riprendono dal centro dalla stessa sessione |

## 10. Regole per chi implementa

1. Procedere per incrementi piccoli, ognuno con la sua prova. Fermarsi alla fine di ogni incremento.
2. Non simulare ciò che non funziona: dichiarare in [STATO.md](STATO.md) cosa è reale, cosa è finto e cosa manca.
3. Usare i termini del glossario nel codice, nei testi dell'interfaccia e nei documenti.
4. Verificare sulla documentazione corrente dell'Agent SDK ogni funzione prima di usarla, senza andare a memoria.
5. Nessun accesso agli host e nessun socket Docker alle conversazioni; nessun segreto in file che le conversazioni possono leggere.
6. Chiedere al proprietario prima di cambiare una regola della sezione 4.

## 11. Assunzioni, punti non verificati e decisioni aperte

Assunzioni da confermare:

- La conoscenza non passa da un progetto all'altro se non tramite la Home, la memoria e le skill.
- La Home può inoltrare istruzioni a un progetto, ma solo su richiesta del proprietario.
- Un progetto vive in un ambiente e non si sposta; può lavorare anche nelle cartelle di altri ambienti che il proprietario gli collega.
- Con l'ambiente spento un progetto si può consultare ma non ci si può lavorare.
- Ogni ambiente ha una descrizione di ciò che offre, scritta dal proprietario, su cui la Home basa le sue scelte.
- I file prodotti in un argomento stanno in una cartella di quell'argomento, nell'ambiente in cui sono nati; con quell'ambiente spento la Home sa che esistono ma non li riapre.
- Un argomento può diventare un progetto, portando con sé i suoi file.
- Le credenziali le inserisce il proprietario dall'interfaccia, mai in una conversazione.

Non verificato:

- L'uso dell'Agent SDK con il login del piano Pro risulta ammesso per uso individuale, ma la regola è già stata rimessa in discussione nel 2026.
- Alcune funzioni dell'app-server di Codex che Shinka usa sono sperimentali: possono cambiare da una versione di Codex all'altra, e la versione è fissata.
- Quanto regge la quota Pro con la Home su un modello intermedio e più progetti attivi in più ambienti.
- Come il nodo su Windows si comporta con le applicazioni a finestra, come Unity e Blender, e con i loro strumenti per Claude.
- Se un controllo nostro continuerà a fermare un'azione anche quando la conversazione lavora senza permessi: con l'SDK 0.3.322 la ferma, ed è su questo che poggia il browser del PC; la prova in `src/prove/consenso-negli-altri-modi.ts` va rifatta a ogni cambio di SDK. Riconoscere da sé un'azione vietata, come un pagamento dentro una pagina, resta un'altra cosa, e non c'è.
- Con quale precisione la Home riconosce un cambio di argomento, e un lavoro già fatto da uno nuovo che gli somiglia.

Decisioni aperte:

- Come si avvia il nodo su Windows, perché possa aprire finestre sullo schermo del proprietario.
- Come la memoria e le skill arrivano a tutti gli ambienti.
- Come la Home cerca tra gli argomenti: sui riassunti, sul testo intero, o con un indice; e se per questo serve un database al posto dei file.
- Dove sta la chiave che protegge il vault, e come il proprietario lo sblocca dopo un riavvio.
- Con quale browser Claude entra nei siti, e come il gateway inserisce la password senza che la pagina la mostri al modello.
- Quali host del lab ricevono gli stack di prova, quali porte e quale radice per i volumi.
- Quale VPN usare: sul server c'è già WireGuard.
- La forma esatta dello stato del progetto e come aggiornarlo senza consumare troppa quota.
- Se progetti e skill hanno anche un repository Git remoto.
- Come si aggiorna il guardiano di un nodo senza andare su quella macchina: oggi solo da fuori.
- Se un comando sul server deve chiedere una volta sola: oggi una conversazione che chiede i permessi lo chiede due volte, prima come consenso all'azione e poi come sì dato al gateway.
- Se e come un server MCP remoto che chiede un accesso con il browser (OAuth) può essere acceso: oggi viene rifiutato.
- Se i server MCP dichiarati da un plugin vanno avviati con lui: oggi no, si propongono a parte.
