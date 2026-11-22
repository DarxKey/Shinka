---
status: accepted
---

# Le modifiche fatte dai comandi, con le fotografie dei file

Il pannello Modifiche mostrava solo i file che Claude cambia con i suoi strumenti di modifica ([ADR 0025](0025-modifiche-dei-turni-e-pannello-file.md)). Ma Claude e Codex cambiano i file anche con i comandi: `sed`, un formattatore, uno script, `git checkout`, `rm`. Quelle modifiche non si vedevano e non si potevano riportare. Il 21 novembre 2026 il proprietario ha scelto di farle entrare nel pannello.

## Decisioni

- **Due fotografie dei file per turno.** Un comando non dice quali file tocca, e non si può sapere leggendolo. Shinka fotografa i file del progetto prima che il turno possa cambiare qualcosa, e di nuovo quando finisce: ciò che è diverso è cambiato nel turno, chiunque l'abbia cambiato. Con Claude la prima fotografia si scatta davanti al primo strumento che non sia di sola lettura, e lo strumento aspetta che ci sia; un turno di sole parole non ne scatta. Con Codex, che non aspetta Shinka, si scatta prima di aprirgli il turno.
- **Le fotografie le tiene Git, in un deposito di Shinka.** Un deposito nudo tra i dati della conversazione (`modifiche/<progetto>/fotografie`), con la cartella del progetto come cartella di lavoro. È Git a sapere quali file sono cambiati senza rileggerli tutti, a leggere i `.gitignore` del progetto e a tenere una copia sola di ciò che non cambia. Il repository del progetto, se c'è, non viene toccato: né il suo indice né i suoi oggetti. Un progetto senza Git funziona lo stesso. Si è scartato un confronto scritto da noi: avrebbe voluto dire rifare l'indice di Git e le sue regole per ignorare.
- **Il testo com'è.** Nel deposito non valgono i fine riga, i filtri e le conversioni che il progetto o la macchina chiedono a Git: un file riportato com'era torna identico, byte per byte.
- **Che cosa resta fuori.** Ciò che il progetto fa ignorare a Git, comprese le regole che tiene nel suo repository senza registrarle; i file oltre 1 MB e quelli che non sono testo, come già per gli strumenti; i collegamenti simbolici e le cartelle con un repository loro. Un progetto che a Git non dice nulla, senza `.git` e senza `.gitignore`, lascia fuori le cartelle delle dipendenze e di ciò che si costruisce, le stesse che salta la ricerca dei file.
- **Mai un file dato per nuovo se c'era già.** Riportare com'era un file «nuovo» lo cancella: per questo un file che la prima fotografia aveva lasciato fuori non è mai nuovo, nemmeno se sta in una cartella lasciata fuori; e se nel turno sono cambiate le regole per ignorare, è nuovo solo ciò che è nato, o è arrivato lì, dopo la prima fotografia.
- **La versione di prima è quella della fotografia.** Per un file toccato sia da uno strumento sia da un comando vale com'era all'inizio del turno, non com'era davanti allo strumento. I file fuori dal progetto, e quelli che la fotografia non guarda, restano agli strumenti come prima.
- **Detto nel pannello.** Un file che nessuno strumento di modifica ha toccato porta l'etichetta «da un comando». È ciò che è cambiato mentre il turno era in corso: di solito un comando, ma anche il proprietario dal suo terminale o un'applicazione accesa. Non si prova a distinguere.
- **Con dei limiti, e dicendolo.** Di un turno si tengono le versioni di al più 300 file cambiati dai comandi e 32 MB: degli altri resta il conto. Oltre 60.000 file da guardare o 300 MB da copiare in una volta le fotografie non si fanno; lo stesso se nell'ambiente manca Git. In quei casi restano le modifiche degli strumenti, e il pannello dice perché.
- **Il deposito non cresce senza fine.** A turno chiuso, quando gli oggetti sparsi sono molti, Git li raccoglie e toglie ciò che non serve: resta la fotografia più recente. Eliminando un progetto dell'ambiente del centro se ne vanno anche le sue modifiche e le sue fotografie.

## Consequences

- Git diventa utile in ogni ambiente: dove manca, il pannello resta com'era e lo dice. L'immagine di Shinka lo ha già; sul PC va controllato che il nodo lo trovi.
- La prima fotografia di un progetto copia tutti i suoi file di testo non ignorati tra i dati di Shinka: qualche secondo e dello spazio, una volta. Le successive costano decine di millisecondi.
- Ciò che cambia tra un turno e l'altro non è di nessun turno: nemmeno ciò che un comando lasciato in background scrive dopo la fine del suo.
- Con Codex, ripartire da un messaggio riporta anche i file cambiati dai comandi. Con Claude no: lì i file li riporta l'harness, con i suoi punti di controllo, che i comandi non li vedono; si riportano dal pannello.
- Un nodo di prima di questa versione continua a mostrare solo le modifiche degli strumenti.
- La copia di sicurezza dei dati, quando ci sarà, può lasciare fuori le fotografie: si rifanno da sole.
