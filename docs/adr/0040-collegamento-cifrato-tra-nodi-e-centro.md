---
status: accepted
---

# Il collegamento tra i nodi e il centro è cifrato, e il nodo riconosce il centro dal suo certificato

Con l'ADR 0017 l'HTTPS era arrivato solo fino al browser del proprietario: nodi, gateway e guardiano restavano in HTTP, perché cambiarli tutti insieme metteva a rischio il ritorno indietro. Sul collegamento di un nodo però passa tutto: il suo segreto, i comandi del centro, il testo delle conversazioni, le chiavi delle estensioni, le versioni nuove del codice. Sulla rete di casa chiunque lo legge, e con un po' di più si mette in mezzo. Il 21 novembre 2026 il proprietario ha scelto, tra i pezzi proposti, di cifrarlo. Questa decisione sostituisce, per i nodi, «i collegamenti interni restano in HTTP» dell'ADR 0017.

## Decisioni

- **TLS sulla stessa porta, con un certificato solo per i nodi.** Il centro crea una volta una chiave e un certificato firmato da sé (`src/centro/identita-per-i-nodi.ts`, tra i dati in `collegamento-nodi/`), con un solo nome, `nodi.shinka.invalid`, che non è un nome della rete. La porta resta quella: il centro guardava già il primo byte per distinguere TLS da HTTP. Chi apre TLS chiedendo quel nome riceve il certificato dei nodi; gli altri quello dell'HTTPS, se è acceso. Senza HTTPS la parte cifrata c'è lo stesso, con il solo certificato dei nodi.
- **Non dipende dall'HTTPS dei browser.** Il certificato dell'HTTPS si rifà quando cambiano gli indirizzi o scade, e la sua CA quando cambiano i nomi: un nodo che lo ricordasse resterebbe fuori. Quello dei nodi vale trent'anni e non si rifà.
- **Il nodo riconosce il centro dall'impronta, non da una CA.** Apre TLS senza verificare la catena, e prima di dire qualunque cosa confronta l'impronta SHA-256 del certificato con quella che ricorda (`improntaDelCentro` in `nodo.json`). Se non coincide chiude, non si presenta, lo dice e riprova: non torna mai al collegamento in chiaro.
- **Come un nodo impara l'impronta.** Un nodo preparato con il comando di una riga la riceve dallo script, che la porta dal centro: il proprietario ha copiato il comando dalla pagina di Shinka, e quindi è quella giusta. Un nodo che c'era già, e che arriva a questa versione aggiornandosi, la impara al primo incontro: ricorda il certificato che vede da quando il centro lo ha ascoltato. In quel momento, e solo in quello, chi fosse in mezzo potrebbe farsi ricordare al posto del centro; chi ascolta soltanto non vede più nulla, nemmeno il segreto.
- **In chiaro solo dove non c'è altro.** Un nodo che non ricorda ancora nessun centro, se chi risponde non parla TLS (un centro di prima), dopo due prove si collega in chiaro come prima, e lo dice. Un centro spento non conta come prova fallita: altrimenti a ogni riavvio del centro il nodo tornerebbe in chiaro. Il centro accetta ancora i nodi in chiaro delle versioni di prima: senza, un nodo che torna indietro dopo un aggiornamento non riuscito resterebbe fuori.
- **«Accetta solo i nodi con il collegamento cifrato».** Una scelta del proprietario, nella pagina Sicurezza, spenta all'inizio. Accesa, un collegamento in chiaro non viene ascoltato: il centro non guarda nemmeno il segreto, risponde `solo-cifrato` e chiude, e lo annota nel registro delle richieste. Non è un rifiuto del nodo, che continua a riprovare. I nodi collegati in chiaro in quel momento vengono staccati, e la pagina lo dice prima.
- **Il segreto passato in chiaro si cambia.** Chi avesse letto la rete prima di oggi avrebbe il segreto di un nodo, e potrebbe presentarsi al suo posto anche su un collegamento cifrato. Per questo un nodo il cui segreto è passato in chiaro ne propone uno nuovo alla prima presentazione cifrata, insieme a quello di prima; il centro lo prende solo da un collegamento cifrato e lo conferma. Il nodo tiene tutti e due finché non ha la conferma, e se la conferma si perde ripropone: il centro, che ha già quello nuovo, lo riconferma. Un'identità nata con questa versione, mai passata in chiaro, non cambia nulla.
- **Su Linux anche la preparazione è cifrata.** Il comando di una riga usa `curl` con la chiave del centro pretesa (`--pinnedpubkey`) e l'indirizzo vero dato a parte (`--connect-to`): lo script e il pacchetto arrivano solo da chi presenta quel certificato.
- **Con un indirizzo `https://`** il nodo usa il certificato del sito e la verifica di sempre, senza impronta: è il caso di un nodo fuori casa che passa da un proxy con un certificato vero.
- **Il proprietario lo vede.** La pagina Ambienti dice per ogni nodo se il collegamento è cifrato o in chiaro; la pagina Sicurezza li elenca, con l'impronta del certificato dei nodi e la scelta.

## Considered Options

- **Usare il certificato dell'HTTPS e la CA di Shinka.** Un solo certificato, ma l'HTTPS può essere spento, e CA e certificato si rifanno: ogni volta i nodi resterebbero fuori.
- **Cifrare i messaggi dentro il WebSocket, con una chiave derivata dal segreto.** Nessun certificato, ma crittografia scritta da noi, e un segreto già passato in chiaro come radice.
- **Rifiutare subito i nodi in chiaro.** Più netto, ma un nodo tornato alla versione di prima non rientrerebbe più, e il centro non potrebbe aggiornarlo: è il rischio che l'ADR 0017 aveva evitato.
- **Fidarsi sempre del primo certificato visto, anche per i nodi nuovi.** Più semplice, ma per un nodo nuovo l'impronta giusta si può avere dal comando che il proprietario copia.

## Consequences

- La specifica passa alla versione 2.18: sezioni 4.3, 5 e 6, prove da A77 ad A80.
- I nodi usano la libreria `ws` al posto del WebSocket di Node, che non lascia scegliere il nome chiesto né guardare il certificato.
- Se i dati del centro vanno persi e il certificato dei nodi rinasce, i nodi che ricordano quello di prima non si collegano più: vanno preparati di nuovo, oppure riavviati una volta con `--dimentica-centro`. Chi fa una copia di sicurezza dei dati deve tenerci dentro `collegamento-nodi/`.
- Un nodo tornato a una versione di prima riscrive `nodo.json` senza l'impronta: quando torna a questa versione la impara di nuovo al primo incontro.
- Ciò che è passato in chiaro prima di oggi resta passato: le chiavi delle estensioni consegnate ai nodi si possono cambiare dal vault, se la rete di casa non è fidata.
- Su Windows lo script di preparazione e il pacchetto si scaricano ancora in chiaro: il nodo riceve l'impronta dallo script, ma chi potesse cambiare lo script cambierebbe anche quella.
- Restano in HTTP il collegamento tra centro e gateway, che stanno sulla stessa macchina, e le prove del guardiano su `127.0.0.1`.
- Un nodo che arriva attraverso un proxy che parla in chiaro con il centro risulta in chiaro, anche se fino al proxy è cifrato.
