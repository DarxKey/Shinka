---
status: accepted
---

# Il gateway si installa da dentro e il server si comanda dal vault, con un sì dato al gateway

Fino all'incremento 13 il progetto Shinka poteva cambiare il codice del gateway ma non metterlo in funzione, e non poteva toccare nulla del server: per tutte e due le cose serviva qualcuno che lavorasse da fuori. Il 13 novembre 2026 il proprietario ha chiesto una modifica che voleva il riavvio del gateway, e Shinka gli ha risposto di farlo lui. Ha chiesto allora che il progetto Shinka abbia la stessa autonomia di chi lavora da fuori, e ha scelto: il gateway si installa da dentro, ma con un sì raccolto dal gateway stesso; i guardiani restano fuori, per ora; le cose del server passano al progetto Shinka attraverso una credenziale SSH che lui inserisce nel vault, con il suo sì su ogni comando.

Il gateway è il confine che protegge da un centro che sbaglia, o da una conversazione ingannata da ciò che legge. Se bastasse un'approvazione riferita dal centro per sostituirlo, o per comandare sul server su cui gira, il confine varrebbe quanto il centro. Per questo quel sì non passa dal centro: lo chiede il gateway al proprietario, per due vie che il centro non può usare al suo posto.

- **Su Telegram**, con un messaggio del gateway. I suoi pulsanti portano un dato con un prefisso riservato: il gateway rifiuta ogni messaggio del centro che lo contenga, non lascia modificare al centro i messaggi che ha mandato lui, e quando il proprietario preme non mette nulla nella coda che il centro legge. Il pulsante vale solo sotto il messaggio con cui la domanda è stata fatta. Se il testo non sta per intero in un messaggio, su Telegram il sì non c'è.
- **Nella pagina del vault**, dove il proprietario entra con la sua frase: la pagina è servita dal gateway, e il gettone del centro non apre le sue porte.

Il centro vede che una domanda è aperta, mostra una scheda che dice dove rispondere, e può ritirarla: un no in più non fa danni.

**Una versione nuova del gateway.** Dopo un'installazione approvata il centro propone al gateway la versione: gli passa i file che il gateway carica, trovati seguendo ciò che importa a partire dal suo avvio, più la sua pagina e l'elenco delle dipendenze. Il gateway accetta solo percorsi della sua parte, confronta da sé con ciò che ha in funzione e decide: se è tutto uguale aggiorna il nome della versione e non disturba nessuno; se cambia qualcosa chiede il sì, elencando i file che cambiano e riportando il riassunto come parole del centro. Con il sì prepara la versione accanto a quella in funzione, lo annota nel registro e si spegne; il suo guardiano scambia le cartelle, lo riavvia e, se non risponde, rimette quella di prima. Al riavvio il vault è chiuso, e il gateway dice su Telegram com'è finita.

**Il server di Shinka.** Una credenziale SSH può essere dichiarata, all'inserimento, come quella del server su cui gira Shinka. Su quegli host ogni comando, con qualunque credenziale, viene tenuto da parte dal gateway finché il proprietario non dà il sì al gateway; poi parte com'era scritto. Così il progetto Shinka può ricreare un container o cambiarne le porte senza che nessuno lavori da fuori, un comando alla volta.

## Considered Options

- **Lasciare tutto com'era.** Scartata dal proprietario: ogni modifica al gateway fatta dal telefono restava ferma finché qualcuno non si sedeva al PC.
- **Installare il gateway con la stessa scheda "Installa" del centro.** Scartata: quell'approvazione la raccoglie il centro, cioè la parte da cui il gateway deve proteggere. Un centro difettoso, o una versione del centro scritta da una conversazione ingannata, potrebbe riferire un sì mai dato e mettersi un gateway di comodo.
- **Un solo sì, dato al gateway, per centro e gateway insieme.** Scartata per ora: il centro si installa prima, e solo la versione in funzione al centro viene proposta al gateway. Due sì quando cambia il gateway, uno quando non cambia, che è il caso più comune.
- **Un codice da digitare al posto del pulsante.** Scartata: più scomodo dal telefono, e non più sicuro, visto che il bot ascolta solo il proprietario e il pulsante riservato il centro non lo può creare.
- **Dare al gateway il socket Docker per ricrearsi il container.** Scartata: la specifica non lo dà nemmeno al gateway, e non serve. Il codice cambia con lo scambio delle cartelle; per il resto c'è la credenziale del server.
- **Aggiornare da dentro anche i guardiani.** Rimandata dal proprietario: sono la parte che deve restare ferma, cambiano di rado, e con la credenziale del server lo si potrà fare con un comando approvato quando servirà.
- **Passare al gateway tutto il codice, come ai nodi.** Scartata: ogni modifica al protocollo, anche a una parte che il gateway non usa, avrebbe fatto chiedere un sì e chiuso il vault. Passando solo ciò che il gateway carica, chiede quando serve.

## Consequences

- **Il confine regge quanto il canale.** Il sì dato al gateway protegge da un centro che sbaglia e da una conversazione ingannata. Non protegge da chi ha già il comando sul server, né da chi ha il telefono sbloccato del proprietario con Telegram aperto.
- **Ciò che il centro dice della versione è solo detto.** Il gateway mostra i file che cambiano, non che cosa fanno. Il proprietario che vuole sapere di più legge le modifiche nella scheda "Installa" del centro, che ha approvato poco prima.
- **Sa cambiare versione solo un gateway tenuto acceso dal suo guardiano**, da una cartella che può scrivere e che contiene esattamente la sua parte. Metterlo così è una cosa che si fa una volta, da fuori: finché non è fatta, il gateway rifiuta le versioni nuove e dice che vanno messe da fuori.
- **Ogni versione nuova del gateway chiude il vault.** Credenziali, browser del gateway e stack non si usano finché il proprietario non lo riapre con la sua frase. Telegram continua a funzionare.
- **Le dipendenze si scaricano senza eseguire ciò che i pacchetti vorrebbero eseguire all'installazione.** Se l'elenco non cambia si riusano quelle che ci sono.
- **Il ritorno indietro copre una versione che non parte**, non una che parte e poi si comporta male. I dati del gateway non tornano indietro con il codice.
- **Un comando sul server chiede due volte** in una conversazione che chiede i permessi: prima il consenso all'azione, come per ogni strumento, poi il sì dato al gateway. Il primo non vale mai al posto del secondo.
- **Un comando che ferma o ricrea il container del gateway** deve staccarsi dalla sessione, che è il gateway a tenere: l'esito si legge dopo, con un altro comando.
- **La credenziale del server vale quanto il server.** È una scelta del proprietario inserirla: senza, queste cose restano da fare da fuori.
- **I guardiani si aggiornano ancora solo da fuori.**
