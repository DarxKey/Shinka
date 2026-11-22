---
status: accepted
---

# Le estensioni stanno in un elenco di Shinka, si installano con una scheda, e le loro chiavi escono dal vault

Un'estensione è codice di terzi che aggiunge strumenti alle conversazioni: un server MCP locale (un programma che parte nell'ambiente), un server MCP remoto (un indirizzo a cui la conversazione si collega) o un plugin di Claude Code (una cartella presa da un repository Git). Shinka tiene il suo elenco di estensioni al centro, e per ognuna dice in quali ambienti è accesa. La Home ne propone una con una scheda che mostra che cosa è, da dove viene, il comando o l'indirizzo esatto e l'ambiente; nulla viene installato finché il proprietario non conferma. Accesa in un ambiente, la usano i progetti di quell'ambiente; la Home, che gira nell'ambiente del centro, usa quelle accese lì. Nella configurazione personale di Claude Code di un ambiente Shinka non scrive nulla; ciò che il proprietario ha già installato lì continua a valere nei progetti, e Shinka lo mostra accanto alle sue, senza gestirlo. Se un'estensione vuole una chiave, il proprietario la scrive nel vault, e il gateway la consegna al programma dell'estensione quando parte. Le quattro scelte le ha fatte il proprietario il 12 novembre 2026. Costruito con l'incremento 12; in fondo c'è ciò che la verifica sull'harness ha cambiato rispetto al progetto.

## Considered Options

- **Installare nella configurazione di Claude Code dell'ambiente.** La Home eseguirebbe lì i comandi che il proprietario farebbe a mano. Scartata dal proprietario: Shinka non saprebbe che cosa c'è, non avrebbe una pagina per spegnere e togliere, e la Home non potrebbe usarle. Finora, inoltre, Shinka non ha mai scritto nella configurazione personale di un ambiente.
- **Estensioni solo per i progetti.** La Home resterebbe con i soli strumenti di Shinka. Scartata dal proprietario: vuole che anche la Home le usi.
- **Solo estensioni senza chiavi.** La regola del vault resterebbe intera, e quelle con una chiave le configurerebbe il proprietario a mano. Scartata dal proprietario: molte delle estensioni utili ne vogliono una.
- **Chiavi solo per i server remoti, aggiunte dal gateway a ogni chiamata.** La chiave non lascerebbe mai il gateway. Scartata dal proprietario: non vale per le estensioni che girano come programma, che sono le più comuni.
- **Copiare in Shinka ciò che è già installato in un ambiente.** Così la Home userebbe anche quelle. Scartata: le definizioni che stanno nella configurazione di Claude Code possono contenere chiavi in chiaro, e copiarle le porterebbe nei file di Shinka. Chi la vuole anche altrove la propone come estensione di Shinka.

## Consequences

- **Un'estensione è codice di terzi con gli accessi dell'ambiente.** Gira accanto ai progetti, con lo stesso utente, e non passa dal gateway: recinto, divieti fissi e registro non vedono ciò che fa. La scheda dice che cosa viene eseguito e da dove viene, non che cosa farà. Le sue azioni chiedono il consenso come le altre, secondo il modo dei permessi.
- **La chiave di un'estensione non è protetta come le altre credenziali.** Non compare nella chat, negli archivi, negli eventi né nei file di Shinka, ma una conversazione in quell'ambiente può leggerla con un comando, e il programma dell'estensione la riceve per intero. È un'eccezione alla regola "Claude usa le credenziali senza vederle", scelta dal proprietario sapendolo: va scritta nella sezione 4.8 della specifica quando il pezzo viene costruito.
- **L'eccezione ha un perimetro.** Vale solo per le voci del vault che il proprietario inserisce come "chiave di un'estensione", legate a un'estensione e a un ambiente. Le credenziali per SSH e per i siti restano dove sono: il gateway non le consegna a nessuno. Ogni consegna finisce nel registro, senza il valore, e a vault chiuso un'estensione che vuole una chiave non parte.
- **Il gateway cambia**, e si installa solo da fuori. Il resto (centro, interfaccia, strumenti della Home) passa dalla scheda "Installa" del progetto Shinka; il nodo degli altri ambienti va aggiornato lì.
- **La Home smette di essere isolata dagli strumenti di terzi.** Finora vedeva solo quelli di Shinka. Resta isolata dalla configurazione di Claude Code del suo ambiente: prende solo ciò che sta nell'elenco di Shinka.
- **Un'estensione locale gira dove gira la conversazione.** La Home lavora negli altri ambienti con tre strumenti suoi, non con una conversazione lì: un'estensione accesa solo sul PC la usano i progetti del PC, non la Home.
- **Ciò che è già nell'ambiente si vede e basta.** Shinka lo elenca come lo dichiara l'harness quando apre una conversazione lì, lo segna "dell'ambiente", e non lo spegne né lo toglie. La Home lo sa, e non propone un doppione.
- **Versioni ferme.** Un plugin resta al commit mostrato nella scheda, e un server locale alla versione scritta nel comando: aggiornarli è una proposta nuova.
- **Un'estensione si accende solo se parte.** Dopo la conferma il nodo la avvia una volta e dice quali strumenti offre, oppure perché non è partita.
- La scheda arriva anche su Telegram, con i pulsanti, come le altre.

## Verificato sull'harness prima di scrivere

Sulla versione 0.3.322 dell'Agent SDK, con due prove tenute in `src/prove/` (`estensioni-e-harness.ts`, `estensioni-senza-turni.ts`):

- I server passati dalla conversazione convivono con quelli della configurazione dell'ambiente, e a parità di nome vincono.
- All'avvio l'harness dichiara server, plugin, skill e comandi; la provenienza dei server la dice lo stato dei server, e basta a distinguere ciò che è dell'ambiente da ciò che porta l'harness.
- I server si possono cambiare in una conversazione aperta, ma l'insieme va ridato per intero: chi non nomina i server di Shinka li spegne.
- Le variabili di un server locale date all'avvio finiscono tra gli argomenti del processo dell'harness, dove le legge chiunque elenchi i processi. Date dopo l'avvio, con la richiesta che cambia i server, non compaiono negli argomenti di nessun processo.
- Un harness a cui non si scrive nulla risponde lo stesso alle richieste di controllo: dice lo stato dei server e ricarica i plugin senza consumare un turno.
- Un plugin caricato da una cartella porta skill, comandi e agenti, ma i server MCP che dichiara non vengono avviati.

## Che cosa ne è seguito

- **I server delle estensioni si danno alla conversazione dopo l'avvio**, prima del primo messaggio, insieme a quelli di Shinka: così una chiave non passa dagli argomenti di un processo. I plugin si danno all'avvio, perché non portano chiavi.
- **Quando l'insieme delle estensioni accese cambia, le conversazioni aperte in quell'ambiente ripartono** al messaggio successivo, riprendendo da dove erano.
- **La prova e lo sguardo non consumano turni.** Dopo la conferma il nodo avvia l'estensione in un harness a parte, che non vede altro e a cui non scrive nulla, e ne legge lo stato. Allo stesso modo guarda ciò che l'ambiente ha già, quando il proprietario lo chiede dalla pagina.
- **Un server che chiede un accesso con il browser viene rifiutato**, con il motivo: Shinka non ha un posto dove farlo.
- **I server dichiarati da un plugin non partono.** La scheda li nomina e dice che vanno proposti a parte.
- **La scheda di un plugin nomina anche ciò che non sa leggere.** Agganci scritti come moduli di codice, voci del manifesto sconosciute, cartelle scelte dal plugin e altri file compaiono tra gli avvisi: il formato dei plugin cambia, e una scheda che tace passerebbe per "non contiene altro". Lo ha mostrato la prova con un plugin vero.
- **Le chiavi si chiedono per nome a ogni avvio.** L'ambiente chiede al centro le chiavi di un'estensione; il centro chiede al gateway solo quelle che l'elenco dichiara per un'estensione accesa in quell'ambiente; il gateway le consegna tutte o nessuna. Nessuno le tiene: né il centro né il nodo le scrivono.
- **La voce del vault è legata al nome dell'estensione, al nome della chiave e ai nomi degli ambienti.** Ce n'è una sola per ogni terna. Il gateway non consegna in questo modo nessun'altra voce, e una chiave di estensione non si può usare come credenziale per un host o per un sito.
- **Chiave mancante o vault chiuso non chiudono la scheda**: resta in attesa, dice che cosa manca, e si conferma di nuovo.
- **Nella Home il consenso vale anche per le skill dei plugin.** Le skill di Shinka restano libere; quelle arrivate con un'estensione lo chiedono.
- **Centro, nodo e gateway vanno aggiornati tutti e tre.** Un nodo di prima ignora i comandi nuovi, e la prova scade dicendo che va aggiornato; un gateway di prima non consegna chiavi, e il centro lo dice. Ogni messaggio nuovo tra centro e nodo viene letto solo se ha la forma giusta, come gli altri.

I due pezzi previsti (prima le estensioni senza chiavi, poi le chiavi) sono stati costruiti insieme.
