---
status: accepted
---

# Copia di sicurezza e trasloco dei dati

Di Shinka non c'era una copia di sicurezza fatta da Shinka: chi perdeva la cartella dei dati perdeva memoria, skill, conversazioni e ambienti. E un'installazione nuova, come quella del lavoro, nasceva vuota, senza modo di portarvi la memoria e le skill dell'altra. Il 21 novembre 2026 il proprietario ha scelto di avere tutte e due le cose.

## Decisioni

- **Un solo file, sempre cifrato.** La copia contiene conversazioni, che possono avere dentro il valore di una credenziale in chiaro, l'impronta della password, le chiavi private dei certificati: non esiste senza cifratura. La password la sceglie il proprietario quando fa la copia, e il centro non la conserva: chi perde la password perde la copia. La chiave si ricava con scrypt, come per il vault; il contenuto è un archivio tar compresso, cifrato a pezzi con AES-256-GCM. Ogni pezzo porta nel sigillo la testata, la sua posizione e se è l'ultimo: una copia tagliata, rimescolata o ritoccata non si apre. Fuori dal cifrato si leggono solo quando è stata fatta e da quale versione.
- **Tutti i dati, meno ciò che è della macchina e ciò che si rifà.** Entra tutto ciò che sta nella cartella dei dati, anche ciò che nascerà domani: l'elenco è di ciò che resta fuori. Fuori: il collegamento con il gateway e ciò che centro e guardiano si dicono sulle versioni, che sono dell'installazione; le sessioni aperte; le fotografie dei file e le estensioni in esame, che si rifanno. I file dei progetti non sono dati di Shinka e non entrano: stanno nelle loro cartelle.
- **Si scarica in due passi.** Il centro prepara il file tra i suoi dati, poi il browser lo scarica come un file qualunque: così non passa dalla memoria del browser, e funziona dal telefono. La password non sta mai in un indirizzo. Il file preparato resta un'ora, cifrato, e uno nuovo prende il posto del vecchio.
- **Caricare non cambia nulla.** Una copia caricata viene solo messa da parte; con la sua password si apre in una cartella accanto, e la pagina dice che cosa contiene. Da lì il proprietario sceglie.
- **Il trasloco è un'aggiunta.** Portare memoria e skill passa dalle stesse porte da cui le scrive Claude: una voce che c'è già non si ripete, una skill con lo stesso nome viene sostituita e la sua storia lo ricorda, un segreto viene rifiutato. Il resto dell'installazione non si tocca, e non serve riavviare.
- **Il ripristino vale al riavvio.** Il centro tiene i dati aperti e in memoria: sostituirli mentre gira lascerebbe metà di prima e metà di dopo. Il proprietario lo chiede confermando con la password di Shinka, quella di adesso; il centro lo segna ed esce chiedendo di essere riacceso, come per una versione nuova. All'avvio, prima di aprire qualunque dato, mette da parte quelli di adesso e fa entrare quelli della copia: sono spostamenti sullo stesso disco, e se uno non riesce tutto torna com'era. Ciò che è della macchina non si tocca. Dei dati di prima si tiene l'ultima volta, finché il proprietario non li toglie.
- **Il vault si copia dal gateway, non dal centro.** Il centro non può leggere il vault, e una copia fatta dal centro glielo metterebbe in mano, anche se cifrato. La copia del vault si scarica dalla pagina del vault, dopo la frase: è il file com'è, cifrato con la frase. Si ricarica lì, con la frase della copia, che da allora è la frase del vault; a vault già impostato solo da dentro, e il vault di prima resta accanto, cifrato. Il gettone del centro non dà la copia.
- **Annotato.** Preparare una copia, caricarne una, un trasloco, un ripristino chiesto o rifiutato finiscono nel registro delle richieste; la copia del vault scaricata e il vault ripristinato, nel registro del gateway.

## Consequences

- Dopo un ripristino si entra con la password che Shinka aveva quando è stata fatta la copia, e tutte le sessioni di prima sono chiuse.
- Un ripristino riporta anche gli ambienti com'erano: un nodo registrato dopo la copia va preparato di nuovo, e così un nodo che dopo la copia ha cambiato il suo segreto.
- Su un'altra macchina le conversazioni si rileggono, ma i progetti dell'ambiente del centro hanno bisogno dei loro file, e i motori non ricordano le sessioni di prima: ripartono da capo. La pagina avvisa dei progetti la cui cartella manca.
- Una copia fatta mentre Shinka lavora prende ogni file com'è in quell'istante: l'ultimo scambio di una conversazione in corso può mancare.
- La copia del vault non contiene il bot di Telegram né il registro del gateway: dopo aver perso il gateway, Telegram va ricollegato.
- Non ci sono copie fatte da sole a un orario: servirebbe una password conservata sul server, che è ciò che si è voluto evitare.
