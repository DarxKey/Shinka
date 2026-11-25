# Shinka

Agente personale self-hosted che esegue operazioni autorizzate sull'infrastruttura del proprietario e sui suoi servizi personali, con regole applicate fuori dal modello.

## Language

### Esecuzione

**Gateway**:
Il punto unico che autorizza ed esegue le operazioni, applicando policy, approvazioni e audit, e che custodisce il vault.
_Avoid_: API Gateway, MCP Gateway, Execution Gateway

**Operazione**:
Un'azione tipizzata esposta dal gateway, con argomenti validati.
_Avoid_: tool, comando, azione

**Permesso**:
Ciò che un principal può fare su una risorsa.
_Avoid_: capability

**Centro**:
La parte di Shinka sempre accesa che ospita l'interfaccia, la Home e l'elenco dei progetti.
_Avoid_: server, control plane

**Ambiente**:
Una macchina o un container in cui possono vivere progetti, disponibile quando il suo nodo è attivo.
_Avoid_: macchina, PC, host

**Nodo**:
Il servizio di Shinka attivo in un ambiente, che vi fa girare le conversazioni dei progetti e lo collega al centro.
_Avoid_: agent, Windows Agent, Docker Agent, device

**Credenziale data a un ambiente**:
Una credenziale per SSH che il proprietario, dalla pagina del vault, dà a un ambiente: il nodo di quell'ambiente la riceve dal gateway sigillata per la sua chiave, la tiene solo in memoria finché il vault è aperto, e la usa per gli host che il gateway non raggiunge (ADR 0062).
_Avoid_: vault del nodo, credenziale copiata, sub-vault

**Credenziale in chiaro**:
Una credenziale del vault, di prova o a basso rischio, che il proprietario ha segnato così: Claude ne legge il valore per gli host o i siti in cui vale, e ne può proporre di nuove, che entrano nel vault solo con l'approvazione del proprietario. Le altre sono protette: si usano per nome e il loro valore non esce dal gateway.
_Avoid_: credenziale insicura, password visibile, secret in plaintext

**Host**:
Una macchina su cui le operazioni producono effetti.
_Avoid_: target, endpoint

**Stack di prova**:
Un insieme di container avviato da Shinka su un host per provare qualcosa, riconoscibile da nome ed etichetta e distinto dai servizi del proprietario.
_Avoid_: deploy, container di test

**Host per gli stack**:
Un host che il proprietario ha dichiarato nel vault per gli stack di prova, con le porte e la cartella dedicate che ne fanno il recinto.
_Avoid_: server Docker, lab

**Recinto**:
I limiti entro cui l'harness gestisce uno stack di prova senza approvazione, fatti rispettare dal gateway: nome ed etichetta di Shinka, porte e cartella dedicate, nessun privilegio.
_Avoid_: sandbox, policy

**Vault**:
La custodia delle credenziali del proprietario dentro il gateway, da cui l'harness le usa senza mai vederle.
_Avoid_: password manager, portachiavi

**Credenziale**:
Una chiave o una password custodita nel vault, usabile solo sull'host o sul sito per cui è stata inserita.
_Avoid_: segreto, token, login

**Server di Shinka**:
L'host su cui girano il centro e il gateway. Una credenziale del vault può essere dichiarata come la sua: su quell'host ogni comando aspetta il sì dato al gateway.
_Avoid_: host principale, macchina madre, root

**Browser del gateway**:
Il browser senza finestra che gira dentro il gateway, con cui l'harness entra nei siti: nome utente e password li scrive il gateway dal vault.
_Avoid_: browser di Claude, browser headless, Playwright

**Bot Telegram**:
Il bot attraverso cui il proprietario scrive alla Home dal telefono e riceve notifiche e richieste di approvazione; lo tiene il gateway, e ascolta solo il proprietario.
_Avoid_: canale, chat Telegram, integrazione

**Abbinamento**:
Il passo con cui il bot Telegram impara chi è il proprietario: lui gli manda un codice letto nella pagina del vault, e da allora il bot ascolta solo quell'account.
_Avoid_: pairing, registrazione, login

**Browser del PC**:
Il browser del proprietario in un ambiente, usato da un progetto attraverso l'estensione di Claude; lì il vault non entra, e ogni azione aspetta il consenso del proprietario in qualunque modo dei permessi.
_Avoid_: Chrome, estensione

### Ragionamento ed evoluzione

**Harness**:
Il motore agentico LLM che ragiona e chiede operazioni al gateway, per esempio Claude Code.
_Avoid_: agent

**Skill**:
Una procedura riutilizzabile e versionata che guida l'harness usando permessi già esistenti, e che l'harness stesso crea e migliora.
_Avoid_: procedure, workflow

**Memoria**:
Le preferenze e i fatti sul proprietario che valgono in ogni conversazione, annotati dall'harness e correggibili dal proprietario.
_Avoid_: profilo, note, contesto

**Estensione**:
Codice di terzi che aggiunge strumenti alle conversazioni (un server MCP o un plugin di Claude Code), tenuto in un elenco di Shinka e acceso in un ambiente solo dopo la conferma del proprietario.
_Avoid_: integrazione, connettore, add-on

**Chiave di un'estensione**:
Un segreto del vault che il gateway consegna al programma di un'estensione quando parte; a differenza di una credenziale, una conversazione di quell'ambiente potrebbe leggerlo.
_Avoid_: credenziale, token, API key

**Progetto Shinka**:
Il progetto, sempre presente, la cui cartella è il codice di Shinka stessa: lì l'harness scrive e prova un pezzo nuovo di Shinka.
_Avoid_: auto-sviluppo, self-update, progetto di sistema

**Proposta di sviluppo**:
La scheda con cui la Home propone un pezzo nuovo di Shinka, chiesto dal proprietario o notato da lei; nulla parte finché il proprietario non la conferma.
_Avoid_: richiesta di funzionalità, feature request

**Versione**:
Il codice di Shinka com'è registrato in un punto preciso del suo repository; quella in funzione è scritta accanto al codice.
_Avoid_: release, build, aggiornamento

**Installazione**:
La messa in funzione di una versione del centro, dopo che le prove sono passate e il proprietario l'ha approvata dalla scheda; se la versione non parte, torna quella di prima. Del gateway, la messa in funzione della versione che il centro gli ha proposto, con il sì dato al gateway.
_Avoid_: deploy, aggiornamento, rilascio

**Guardiano**:
Il programma, fuori dal codice che cambia, che tiene acceso il centro, mette in funzione una versione approvata e rimette quella di prima se la nuova non parte. Un nodo può avere il suo, che fa lo stesso con la versione che il centro gli passa; il gateway ha il suo, per la versione che il proprietario gli ha approvato.
_Avoid_: supervisor, watchdog, launcher

**Icona del nodo**:
Su Windows, l'icona di un nodo nell'area di notifica: avvia il nodo a ogni accesso, ne mostra lo stato del collegamento con un pallino colorato e dal suo menu lo ferma, lo avvia e lo riavvia. Sta accanto al guardiano, fuori dalla versione in funzione.
_Avoid_: tray, systray, icona di sistema

**Nodo indietro**:
Un nodo collegato che esegue una versione diversa da quella in funzione al centro, o che non dice quale.
_Avoid_: nodo vecchio, nodo obsoleto, outdated

**Invito di un ambiente**:
Il gettone, valido un'ora, che il comando di una riga della pagina Ambienti porta con sé: con quello una macchina scarica dal centro lo script di preparazione e il nodo. Non vale come consenso: il nodo arriva sconosciuto e il proprietario lo approva con il codice di verifica.
_Avoid_: token di registrazione, enrollment

**Aggiornamento di un nodo**:
Il passaggio di un nodo alla versione del centro: il centro gli passa i file, il suo guardiano li mette in funzione. Parte dopo un'installazione approvata, oppure quando il proprietario lo chiede dalla pagina degli ambienti.
_Avoid_: deploy, sincronizzazione, propagazione

### Conversazione

**Home**:
L'unica chat in cui il proprietario chiede qualunque cosa a Shinka, che svolge da sé i lavori di una seduta e conosce stato e storia di tutti i progetti.
_Avoid_: chatbot, bot, chat principale

**Smistamento**:
La decisione della Home tra fare da sé, proporre un progetto e, nel dubbio, chiederlo al proprietario.
_Avoid_: routing, triage

**Argomento**:
Un tratto della conversazione della Home su una sola questione, che la Home archivia con titolo e riassunto quando il proprietario passa ad altro, e in cui poi ricerca. Di solito uno solo è aperto; ogni chat parallela della Home ne tiene aperto un altro.
_Avoid_: sessione, thread, chat

**Elaborato**:
Un file che la Home consegna al proprietario mostrandoglielo: sta nella cartella di un argomento, in un ambiente; il proprietario lo vede nella chat e lo ritrova nella pagina Elaborati, per data. I file di lavoro che la Home non mostra non sono elaborati.
_Avoid_: artifact, allegato, output

**Immagine esterna**:
Un'immagine che una risposta scrive nel testo con l'indirizzo https di un altro sito: la scarica il centro, che la passa al browser e a Telegram. Non è un elaborato: non sta in nessuna cartella.
_Avoid_: immagine remota, embed

**Scheda con immagine**:
Un paragrafo o una voce di elenco che comincia con un'immagine esterna: la foto a sinistra, il testo accanto.
_Avoid_: card

**Progetto**:
Un lavoro che dura più sedute, con una cartella propria in un ambiente e conversazioni proprie separate dalla Home.
_Avoid_: task, subagent

**Proposta di progetto**:
La scheda con cui la Home propone nome, cartella e ambiente di un progetto; nulla nasce finché il proprietario non la conferma.
_Avoid_: richiesta, bozza

**Brief**:
La richiesta che la Home passa a un progetto nuovo come suo unico contesto iniziale.
_Avoid_: prompt, contesto

**Condizione del progetto**:
Come sta un progetto in questo momento, in una parola: al lavoro, aspetta te, fermo, ambiente spento.
_Avoid_: stato, status

**Stato del progetto**:
Il riepilogo sempre aggiornato di un progetto: a che punto è, cosa è stato deciso, cosa aspetta dal proprietario.
_Avoid_: status, riassunto

**Domande di Claude**:
Le domande, fino a quattro, che Claude pone al proprietario prima di procedere, ciascuna con le risposte che propone e "Altro" per una sua; compaiono in una scheda e si rispondono da lì, con un messaggio, oppure si saltano.
_Avoid_: sondaggio, questionario, AskUserQuestion

**Skill di partenza**:
La skill con cui comincia il primo messaggio di un progetto nuovo, scelta nella scheda della proposta: grill-me o grill-with-docs, oppure nessuna.
_Avoid_: prompt iniziale, grilling

**Preparazione del progetto**:
Ciò che Shinka fa nella cartella di un progetto nuovo, prima del primo messaggio, perché un'estensione scelta funzioni da subito, come l'indice di CodeGraph.
_Avoid_: setup, bootstrap

**Terminale**:
La shell del proprietario nella cartella di un progetto, nel suo ambiente, che resta accesa finché lui non la spegne; l'harness non la vede.
_Avoid_: console, shell di Claude, prompt

**Anteprima**:
L'applicazione web di un progetto vista dal proprietario accanto alla chat, attraverso il centro, mentre gira nell'ambiente del progetto.
_Avoid_: preview, browser, demo

**Applicazione del progetto**:
Il programma che serve l'anteprima di un progetto, avviato e fermato da Shinka nel suo ambiente con il comando che il progetto ha dato; se il proprietario la vuole accesa, riparte dopo un riavvio.
_Avoid_: server di sviluppo, dev server, processo

**Vista della trascrizione**:
Quanto della conversazione si vede: normale, con il ragionamento di Claude ripiegato, oppure dettagliata, con tutte le azioni aperte. La sceglie il proprietario, insieme al tema, dal menu Aspetto.
_Avoid_: modalità, verbosità

**Cose da fare**:
La lista che Claude tiene mentre lavora (TodoWrite), mostrata in una scheda che si aggiorna sul posto e a fine turno dice quante voci sono fatte.
_Avoid_: todo, task list

**Ramo**:
Un argomento nuovo della Home che nasce da un messaggio modificato di quello aperto: ne ha la storia fino a lì, nella stessa cartella, e da lì prende un'altra strada; quello di prima resta com'è, archiviato.
_Avoid_: fork, biforcazione, branch

**Chat parallela**:
Un'altra conversazione aperta in una scheda accanto alla principale, nella Home o in un progetto, che lavora anche mentre la principale lavora. Nella Home è un argomento aperto, archiviato quando la scheda si chiude; in un progetto lavora nella sua cartella, e chiusa si cancella.
_Avoid_: side chat, btw, domanda a parte, thread

**Posto di un'estensione**:
Un punto dell'interfaccia in cui una pagina di un'estensione dell'interfaccia può stare: il menu delle pagine, il pannello dei progetti, la barra destra o sinistra, la testata, la barra di stato, sopra o sotto il campo di scrittura, il pannello flottante, le pagine Ambiente e Sicurezza.
_Avoid_: slot, widget, zona

**Ponte delle pagine**:
Ciò con cui una pagina di un'estensione dell'interfaccia parla con Shinka dal suo riquadro: lo stato, i messaggi alle conversazioni, e le API di Shinka che l'interfaccia chiama per lei, solo quelle dichiarate.
_Avoid_: SDK, bridge, proxy

**Ponte di un nodo**:
Un nodo che lascia collegare al centro, attraverso di sé, una macchina che il centro non raggiunge: fa passare solo il collegamento cifrato dei nodi e lo scaricamento dell'installazione.
_Avoid_: relay, proxy, gateway

**Lavoro offline**:
Il lavoro su un progetto di un ambiente fatto da quella macchina, con Shinka Desktop, mentre il centro non si raggiunge: lo porta avanti il nodo dell'ambiente, che ne tiene la storia e la consegna al centro quando torna.
_Avoid_: modalità aereo, sincronizzazione, fork

**Sportello del nodo**:
Il punto da cui Shinka Desktop, sulla stessa macchina, parla con il nodo per il lavoro offline: ascolta solo da quella macchina e risponde solo con il gettone scritto tra i dati del nodo.
_Avoid_: API locale, server locale, proxy

**Stile delle risposte**:
Come Claude scrive in una conversazione, scelto dal proprietario accanto a modello ed effort: uno di quelli di Shinka, oppure uno suo, le cui istruzioni Claude scrive a partire da una descrizione.
_Avoid_: output style, tono, personalità

**Modifiche di un turno**:
I file cambiati mentre Claude lavorava in un turno, con com'erano prima e come sono alla fine: quelli che ha cambiato con i suoi strumenti di modifica e, dove si fanno le fotografie dei file, quelli cambiati dai comandi che ha eseguito. Il proprietario le guarda nel pannello Modifiche e, se vuole, riporta i file com'erano, uno alla volta o tutto il turno: non c'è nulla da accettare.
_Avoid_: diff, changeset, checkpoint

**Fotografia dei file**:
Com'erano i file di un progetto in un certo momento: Shinka ne scatta una prima che un turno possa cambiare qualcosa e una quando finisce, e dal confronto sa che cosa è cambiato, chiunque l'abbia fatto. Le tiene in un deposito suo, tra i suoi dati, senza toccare il repository del progetto. Non guarda ciò che il progetto fa ignorare a Git, i file oltre 1 MB e quelli che non sono testo.
_Avoid_: snapshot, checkpoint, commit ombra

**Pannello File**:
La scheda accanto alla chat di un progetto in cui il proprietario sfoglia, cerca e guarda in anteprima i file del progetto, in sola lettura, e commenta le righe.
_Avoid_: explorer, file browser

**Commento su una riga**:
Una nota del proprietario su una riga di un file, scritta nel pannello File: aspetta sopra il campo di scrittura e parte, in testa, con il messaggio successivo.
_Avoid_: annotazione, review comment

**Scheda della sessione**:
Il riquadro che si apre dalla testata della chat: dove lavora la conversazione e con quali scelte, di che cosa è fatto il contesto, i limiti del piano, quanti file sono stati cambiati e le attività.
_Avoid_: session bar, info

**Attività**:
Un comando che Claude lascia lavorare in background, o un agente (subagent) a cui affida un pezzo di lavoro: compare nella scheda della sessione con il suo stato, un riassunto e la sua uscita.
_Avoid_: task, job, background task

**Vista affiancata**:
Sugli schermi larghi, una seconda conversazione, la Home o un progetto, accanto a quella che si guarda.
_Avoid_: split view

**Elaborato vivo**:
Un elaborato con dati che cambiano: una pagina che li legge da sola quando si apre, oppure un file che un comando dato dalla Home rifà quando il proprietario preme «Aggiorna».
_Avoid_: live artifact, dashboard

**Palette**:
Il riquadro che si apre con Ctrl+K (⌘K) o con «Vai a…» nella barra laterale: qualche lettera, e si salta a un progetto, a un argomento archiviato o a una pagina.
_Avoid_: command palette, launcher

**Motore**:
Ciò che fa lavorare una conversazione: Claude Code, attraverso il Claude Agent SDK, oppure Codex, attraverso il suo app-server, con l'abbonamento ChatGPT. Si sceglie per conversazione, nel menu del modello; l'installazione ha un motore predefinito. Cambiandolo, il motore nuovo riceve gli ultimi scambi (il **passaggio**), e ogni motore tiene la sua sessione.
_Avoid_: harness (nei testi per il proprietario), backend, provider

**Accesso** (di un motore):
L'abbonamento con cui un motore lavora in un ambiente: Claude Code con un account Claude, Codex con un account ChatGPT. Si fa dalla pagina Impostazioni, sul sito di Anthropic o di OpenAI; ogni ambiente ha il suo.
_Avoid_: login (nei testi per il proprietario), credenziale (che è del vault)

**Pacchetto** (d'installazione):
Il file `.tar.gz` che una Shinka dà per installarne un'altra: il codice della versione in funzione e i file per Docker, senza dati. Si scarica dalla pagina Impostazioni.
_Avoid_: release, bundle

**Lavoro programmato**:
Una richiesta che il proprietario lascia a Shinka perché parta da sola, a un orario o a intervalli, nella Home o in un progetto: esiste solo se l'ha creata lui o se ha confermato la scheda che la propone, e quando tocca arriva alla conversazione come un suo messaggio.
_Avoid_: cron, job, task schedulato, routine, promemoria

**Evento in ingresso**:
Un avviso che un altro sistema manda all'indirizzo di un lavoro programmato, con la sua chiave: fa partire quel lavoro, e arriva alla conversazione come materiale da leggere accanto alla richiesta scritta dal proprietario, mai come istruzioni.
_Avoid_: webhook, trigger, notifica in entrata

**Primo avvio**:
Il momento in cui un'installazione nuova non ha ancora la password: la pagina chiede il codice di primo avvio, che il centro scrive tra i dati e nel registro, e la password nuova; poi guida nella pagina Impostazioni.
_Avoid_: setup, onboarding

**Notifica**:
Il messaggio con cui Shinka dice al proprietario, su Telegram e sui dispositivi che ha iscritto alle notifiche dell'app, che un progetto ha finito un lavoro, che aspetta una sua risposta o che serve un'approvazione.
_Avoid_: alert

**Dispositivo iscritto**:
Un telefono o un browser su cui il proprietario ha acceso le notifiche dell'app dalla pagina Impostazioni: riceve gli avvisi cifrati, attraverso il servizio di notifiche del suo browser.
_Avoid_: subscription, client push

### Regole

**Proprietario**:
L'unica persona che dà richieste a Shinka e ne approva le operazioni.
_Avoid_: utente, admin

**Approvazione**:
Il consenso esplicito del proprietario a un'operazione, che l'harness non può dare al suo posto; vale per l'operazione che gli è stata mostrata, una volta, e scade.
_Avoid_: conferma

**Sì dato al gateway**:
L'approvazione che il gateway chiede al proprietario lui stesso, su Telegram con un pulsante che solo il gateway può creare o nella pagina del vault, e che il centro non può dare né riferire. Serve per una versione nuova del gateway e per ogni comando sul server di Shinka.
_Avoid_: doppia approvazione, conferma forte, 2FA

**Certificato dei nodi**:
Il certificato con cui il centro si fa riconoscere dai nodi sul collegamento cifrato: firmato da sé, creato una volta, diverso da quello dell'HTTPS. Un nodo ne ricorda l'impronta e parla solo con chi lo presenta.
_Avoid_: certificato del server (che è quello dell'HTTPS), pin, chiave del centro

**Collegamento cifrato** (di un nodo):
Il collegamento tra un nodo e il centro quando passa in TLS, con il certificato dei nodi o con quello di un sito. Il contrario è «in chiaro», come nelle versioni di prima.
_Avoid_: canale sicuro, tunnel, HTTPS dei nodi

**Registro delle richieste** (al centro):
Ciò che il centro annota di chi bussa: le entrate riuscite e fallite, le richieste senza una sessione, le pagine che non ci sono, con l'indirizzo, il programma e il percorso, mai il contenuto. Si legge nella pagina Sicurezza. Non è il registro del gateway, che annota l'uso delle credenziali.
_Avoid_: log di accesso, audit log, registro degli accessi (l'accesso è quello di un motore)

**Gettone di dispositivo**:
Ciò con cui un'app del proprietario, come Shinka Desktop, entra nel centro senza il cookie del browser: lo riceve una volta con la password, vale quanto una sessione finché viene usato e decade dopo novanta giorni fermo. Si toglie dalla pagina Sicurezza; cambiare la password li toglie tutti.
_Avoid_: token API, chiave, API key

**Protocollo dei clienti**:
Il numero, in `/api/stato`, che dice quale versione delle rotte e degli eventi del centro parla un cliente come Shinka Desktop. Cresce solo quando un cambio rompe i clienti di prima; un cliente che ne vede uno più alto si aggiorna. Si rilascia prima il cliente, poi il centro.
_Avoid_: API version, versione dell'API

**Versione dell'archivio**:
Un identificativo dell'archivio di una conversazione che resta lo stesso finché si aggiungono eventi in fondo, e cambia quando eventi già dati potrebbero non valere più (un taglio, numeri riassegnati, un ripristino). Con l'ultimo numero forma l'indice dell'archivio: chi tiene una copia della storia lo confronta con il suo, e chiede solo ciò che manca.
_Avoid_: revisione, etag, epoca

**Incarico**:
Un pezzo di lavoro di un progetto, di solito l'implementazione con i suoi test, che chi guida affida a chi implementa: lo svolge in una conversazione a parte del progetto, e riporta un resoconto.
_Avoid_: task, subagent, delega

**Chi guida** (un progetto):
Il modello della conversazione del progetto: pianifica, decide, affida gli incarichi e ne controlla il risultato.
_Avoid_: planner, orchestratore

**Chi implementa** (in un progetto):
Il modello che il proprietario sceglie per svolgere gli incarichi di un progetto; senza, il progetto lavora con un modello solo.
_Avoid_: executor, esecutore, worker

**Estensione dell'interfaccia**:
Un tema, delle pagine e dei pulsanti che cambiano l'aspetto di Shinka o le aggiungono funzioni: li scrive Claude, li conferma il proprietario, e stanno tra i dati del centro, non nel codice. Le pagine girano in un recinto e parlano con Shinka solo per leggerne lo stato e mandare messaggi.
_Avoid_: plugin dell'interfaccia, widget, skin

**Modello locale**:
Un modello che gira su una macchina del proprietario, con un server che parla come l'API di Anthropic (per esempio Qwen con llama-server): è un'estensione di Shinka, il nodo lo accende quando una conversazione lo sceglie e lo spegne dopo dieci minuti fermo. Messo in rete dal proprietario, lo usano anche la Home e i progetti degli altri ambienti, con una chiave che Shinka tiene per sé.
_Avoid_: LLM locale, modello offline

**Cartella collegata** (di un progetto):
Una cartella di un altro ambiente che il proprietario collega a un progetto: il progetto ci lavora con gli strumenti di Shinka, seguendo il modo dei suoi permessi, mentre il suo motore resta nel suo ambiente. Una per ambiente.
_Avoid_: cartella remota, mount, progetto multi-ambiente

**Copia pubblica** (di Shinka):
Il codice di Shinka su GitHub, con una storia sua che comincia dalla prima pubblicazione: un commit per ogni commit del repository di lavoro, senza i file esclusi e solo se non contiene espressioni vietate. Il repository di lavoro resta sul server.
_Avoid_: mirror, repo pubblico, fork

**Copia di sicurezza** (dei dati):
Un solo file con i dati del centro, cifrato con una password che il proprietario sceglie quando la fa: memoria, skill, conversazioni, progetti, ambienti, impostazioni. Non ha i file dei progetti, né ciò che è della macchina. La copia del vault è un'altra cosa: si fa dalla pagina del vault, ed è cifrata con la frase di sblocco.
_Avoid_: backup, dump, esportazione (che è di una conversazione)

**Ripristino**:
Mettere i dati di una copia di sicurezza al posto di quelli del centro: lo chiede il proprietario, vale al riavvio, e i dati di prima restano da parte.
_Avoid_: restore, rollback (che è di una versione)

**Trasloco**:
Portare in un'installazione la memoria e le skill di un'altra, prese da una sua copia di sicurezza, senza toccare il resto.
_Avoid_: migrazione, importazione, sincronizzazione

**Sessione aperta**:
Un browser o un telefono che è dentro Shinka con la password del proprietario, finché non esce, scade, o viene chiuso dalla pagina Sicurezza. Non è la sessione di un motore.
_Avoid_: login attivo, dispositivo collegato

**Divieto fisso**:
Un'operazione che nessuna approvazione può sbloccare.
_Avoid_: blocco

**Destinatario noto**:
Un indirizzo con cui il proprietario ha già scambiato posta.
_Avoid_: contatto fidato
