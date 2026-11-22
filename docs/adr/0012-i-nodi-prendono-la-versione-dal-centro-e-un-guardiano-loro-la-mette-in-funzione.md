---
status: accepted
---

# I nodi prendono la versione dal centro, e un guardiano loro la mette in funzione

Fino all'incremento 12 una versione installata da dentro Shinka cambiava il centro e basta: il nodo di un altro ambiente restava a quella di prima finché qualcuno non andava su quella macchina. Il 13 novembre 2026 il proprietario ha chiesto due cose: che un'installazione approvata dal progetto Shinka arrivi anche ai nodi attivi, e che nella pagina degli ambienti ci sia un pulsante per aggiornare un nodo rimasto indietro.

Ogni nodo dice al centro, quando si presenta, a che versione è e se sa cambiarla da solo. Il centro confronta con la sua, e nella pagina degli ambienti si vede chi è indietro. Per aggiornare un nodo il centro gli passa, sul collegamento che c'è già, i file della versione che ha in funzione: il codice senza i test e l'elenco delle dipendenze. Il nodo li prepara in una cartella accanto alla sua, si spegne, e un guardiano suo — lo stesso programma che tiene acceso il centro, in una copia che sta fuori dalla cartella della versione — scambia le cartelle e lo riaccende. La versione nuova vale come partita quando con quella il nodo si è collegato al centro ed è stato accolto; se non succede in tempo, il guardiano rimette quella di prima, e il nodo dice al centro perché.

Succede in due casi. Dopo un'installazione approvata, per i nodi che al momento dell'approvazione erano collegati e sapevano aggiornarsi: la scheda "Installa" li nomina prima, e il centro, ripartito con la versione nuova, li aggiorna appena li ritrova. E quando il proprietario preme "Aggiorna" nella pagina degli ambienti, per un nodo che è indietro.

## Considered Options

- **Lasciare i nodi a chi ha accesso alla macchina.** Era così. Scartata dal proprietario: ogni installazione fatta dal telefono lasciava il PC indietro, e una modifica che tocca ciò che usano i nodi non era davvero in funzione finché qualcuno non si sedeva al PC.
- **Ogni nodo prende il codice dal repository.** Scartata: il repository sta sul server, e ogni ambiente dovrebbe avere Git, un modo di raggiungerlo e una credenziale per farlo. Il centro ha già i file esatti della versione in funzione, e un collegamento con ogni nodo su cui entrambi si riconoscono.
- **Il nodo si riscrive sul posto e riparte da solo.** Scartata per le stesse ragioni dell'ADR 0010: un aggiornamento interrotto lascia una versione a metà, e una versione che non parte non può accorgersi di non essere partita. Serve qualcosa che resti fermo mentre il nodo cambia.
- **Aggiornare ogni nodo appena si collega indietro.** Scartata: un aggiornamento chiude le conversazioni e i terminali aperti in quell'ambiente, e il proprietario ha chiesto che nulla parta da solo. Dopo un'installazione vale la sua approvazione, che nomina i nodi; per tutti gli altri casi c'è il pulsante.
- **Aggiornare da dentro anche il guardiano del nodo.** Scartata: come quello del centro, è la parte che deve restare ferma. Cambia di rado, e si aggiorna da fuori.

## Consequences

- **Passare il codice a un nodo non sposta il confine.** Il centro può già eseguire qualunque comando nell'ambiente di un nodo, attraverso le conversazioni e il terminale. Un nodo prende la versione solo dal centro a cui il proprietario lo ha registrato, e controlla che i file stiano dentro la cartella della versione e siano quelli della versione chiesta. Ciò che protegge da un centro che sbaglia resta il gateway.
- **Sa aggiornarsi solo un nodo tenuto acceso dal suo guardiano.** Un nodo avviato a mano dalla cartella del codice resta com'è: la pagina dice che va aggiornato su quella macchina, e il pulsante non c'è. Mettere un nodo sotto il suo guardiano è una cosa che si fa una volta, da fuori: una cartella con dentro la copia del guardiano, la versione in funzione con le sue dipendenze e i dati del nodo.
- **Il gateway e i guardiani, del centro e dei nodi, si aggiornano ancora solo da fuori.**
- **Passano il codice e l'elenco delle dipendenze, non le dipendenze.** Se l'elenco non è cambiato il nodo riusa quelle che ha; se è cambiato le scarica per il suo sistema, e gli serve la rete. Se non ci riesce resta com'è e dice perché. L'interfaccia non passa: ai nodi non serve.
- **Un aggiornamento chiude ciò che è aperto in quell'ambiente.** Il centro non lo fa partire mentre lì una conversazione lavora o aspetta il proprietario, e prima di partire dal pulsante chiede conferma.
- **Dopo un'installazione si aggiornano i nodi che erano collegati all'approvazione**, se tornano entro dieci minuti dal riavvio del centro. Uno che era spento, uno che torna più tardi, e tutti quando il centro è stato cambiato da fuori, restano indietro: lo si vede, e c'è il pulsante.
- **Il ritorno indietro copre una versione che non parte o non si collega**, non una che si collega e poi si comporta male. I dati del nodo non tornano indietro con il codice.
- **Un nodo che non dice a che versione è risulta indietro.** Succede con un nodo di una versione precedente a questa, e con uno avviato dalla cartella di lavoro, dove la versione non è scritta. Se è il centro a non sapere a che versione è, nessun nodo risulta indietro e non c'è nulla da passare.
- I file passano in un solo messaggio: la versione deve stare in 12 MB e 2000 file. Oggi ne occupa una piccola parte.
- Il centro aspetta un nodo per 25 minuti, il tempo di scaricare le dipendenze su una macchina lenta; poi lo dà per non aggiornato. Il guardiano del nodo aspetta tre minuti che la versione nuova si colleghi.
