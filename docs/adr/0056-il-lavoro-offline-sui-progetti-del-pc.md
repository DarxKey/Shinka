---
status: accepted
---

# Il lavoro offline sui progetti del PC

Il 24 novembre 2026 il proprietario ha chiesto di poter lavorare da Shinka Desktop sui progetti del PC su cui gira l'app anche quando il centro non si raggiunge: un nodo su un portatile non è sempre collegato. Fino a qui un ambiente era attivo solo con il suo nodo collegato al centro, il nodo chiudeva le conversazioni appena il collegamento cadeva, e il centro conservava la storia di ogni progetto. Il proprietario ha scelto:
- il lavoro offline vale per i progetti che ci sono e anche per crearne di nuovi;
- l'app passa dal nodo solo quando il centro non c'è;
- offline gli strumenti di Shinka che passano dal centro dicono che manca, salvo memoria e skill, che restano;
- la regola della specifica si cambia con un'eccezione (sezione 4.3, 4.4 e 4.6).

## Decisioni

- **Un progetto offline lo tocca un posto solo.** Un progetto vive in un ambiente; senza centro lo raggiunge solo chi sta su quella macchina, e con il centro lo raggiunge solo il centro. Per questo non ci sono due storie da fondere: offline la storia continua sul nodo, e al ritorno passa al centro, che resta a conservarla. Nello stesso momento le due strade non valgono mai insieme: lo sportello accetta lavoro solo mentre il nodo non è collegato.
- **Il centro dice al nodo i suoi progetti.** A ogni collegamento, e quando cambiano, il centro manda al nodo i progetti del suo ambiente con `progetti`: identificativo, nome, cartella, impostazioni, estensioni scelte, sessione da cui riprendere. Con `memoria` gli manda il testo della memoria del proprietario, come lo riceve una conversazione. Il nodo li tiene nei suoi dati, in `progetti.json` e `memoria.json`: senza centro sa quali progetti ha e come riprenderli.
- **Lo sportello del nodo.** Il nodo ascolta su `127.0.0.1`, mai dalla rete, su una porta scelta all'avvio, e scrive porta e gettone in `sportello.json` tra i suoi dati: lo legge solo chi è quell'utente su quella macchina, cioè l'app. Ogni richiesta porta il gettone, e senza risponde 401. Le rotte sono quelle del centro per i progetti (`/api/progetti/:id/eventi`, `messaggi`, `interrompi`, `permessi`, `domande`, `impostazioni`, `azioni`, `storia`), con le stesse forme, più `/api/sportello` con lo stato e l'elenco dei progetti, e `POST /api/progetti` per un progetto nuovo. Con il nodo collegato al centro lo sportello risponde solo a `/api/sportello` e dice di passare dal centro.
- **L'archivio offline.** Offline il nodo apre da sé la conversazione di un progetto, con la sessione e le impostazioni che conosce. I suoi eventi vanno in un archivio come quelli del centro (`offline/<progetto>.jsonl`, lo stesso `Canale`), che lo sportello manda all'app. Con gli eventi ci sono i messaggi del proprietario, i permessi e le domande con le loro risposte: è la storia intera di ciò che è successo offline. Offline lavora solo la conversazione principale di un progetto: le chat parallele aspettano il centro.
- **I progetti nuovi offline.** Lo sportello crea la cartella nella radice dei progetti come fa il centro, con un identificativo nuovo, e il progetto parte con il suo brief. Al ritorno il centro lo registra con lo stesso identificativo, la stessa cartella e la data in cui è nato.
- **Gli strumenti offline.** Leggere una skill risponde dalla copia del nodo. Ricordare, correggere o dimenticare una voce, e salvare una skill, si annotano e partono verso il centro al ritorno: lo strumento risponde che il cambiamento è annotato e arriverà. Gli altri, che chiedono vault, gateway, Home, stack, installazione o incarichi, rispondono che il centro non si raggiunge e di riprovare quando torna. Le estensioni con una chiave del vault offline non partono.
- **Il ritorno.** Quando il centro lo accoglie di nuovo, il nodo dice nella presentazione quali progetti hanno lavoro offline da consegnare. Per ciascuno, quando la sua conversazione offline non lavora e non aspetta il proprietario, il nodo la chiude e consegna: il progetto se è nato offline, gli eventi in pezzi numerati, la sessione da cui riprendere, gli strumenti annotati. Il centro aggiunge gli eventi in fondo all'archivio del progetto, preceduti da una nota con l'ambiente, e conferma ogni pezzo; il nodo toglie ciò che è confermato. Un pezzo che arriva due volte non entra due volte: il centro ricorda fin dove ha preso l'archivio offline, per versione. Finché un progetto ha lavoro offline da consegnare il centro non vi manda messaggi, e lo dice.
- **Le chiavi offline.** Nessuna credenziale del vault passa dallo sportello o resta sul nodo per il lavoro offline: il vault resta al gateway.

## Conseguenze

- Il nodo non chiude più le conversazioni perché il collegamento cade: chiude quelle aperte dal centro, come prima, e da quel momento i progetti si possono riprendere dallo sportello.
- Sul disco del nodo restano, per il lavoro offline, i nomi e le impostazioni dei progetti e il testo della memoria: chi legge i dati del nodo li legge. Le chiavi no.
- Chi ha il gettone dello sportello, cioè chi può leggere i file dell'utente su quel PC, offline può mandare messaggi ai progetti di quell'ambiente: ha già in mano le loro cartelle.
- Una versione dell'app che non conosce lo sportello resta in sola lettura offline, come prima; un nodo di una versione precedente non ha lo sportello, e l'app lo dice.
- La Home, i progetti degli altri ambienti, le chat parallele, il vault, gli stack e i lavori programmati offline non ci sono.
