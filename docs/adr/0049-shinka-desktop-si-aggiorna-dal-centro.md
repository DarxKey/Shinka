---
status: accepted
---

# Shinka Desktop si aggiorna dal centro

Il 23 novembre 2026 il proprietario ha confermato la terza richiesta del progetto Shinka Desktop (nel progetto, ADR 0006 «L'app si aggiorna dal centro»): l'app prende gli aggiornamenti dal centro del proprietario, e si accorge quando il centro parla un protocollo che lei non conosce. Fino a qui l'installer si applicava a mano su ogni PC.

## Decisioni

- **Il centro serve, non costruisce.** `GET /api/desktop/aggiornamenti/latest.yml` dà il manifesto così come lo scrive electron-builder per il provider generico di electron-updater; `GET /api/desktop/aggiornamenti/<nome>` dà l'installer `Shinka-Desktop-<versione>-installa.exe` e il suo `.blockmap`. Servono una sessione o un gettone di dispositivo ([ADR 0047](0047-il-gettone-di-un-dispositivo.md)). Senza una versione pubblicata latest.yml risponde 404; senza accesso 401.
- **A parti.** I file accettano `Range`: una parte (206 con `Content-Range`), più parti (206 `multipart/byteranges`, come le chiede electron-updater per scaricare solo i blocchi cambiati), o nessuna che stia nel file (416).
- **Il .blockmap della versione di prima resta.** Per lo scaricamento a differenze electron-updater chiede anche il .blockmap della versione installata, con il nome della versione di prima; senza, scarica l'installer intero. Della versione di prima il centro tiene solo quello, che pesa poco; il resto lo toglie.
- **Si pubblica dalla cartella del progetto**, per scelta del proprietario: nelle Impostazioni, sezione Shinka Desktop, si scelgono il progetto e la cartella in cui electron-builder ha messo i tre file (di solito `dist`), e si conferma con la password di Shinka. Il centro li prende attraverso il pannello File del progetto ([ADR 0048](0048-scaricare-file-e-cartelle-dal-pannello-file.md)), anche da un nodo, anche dal telefono, senza caricare nulla dal browser.
- **Solo il proprietario pubblica.** Con un gettone di dispositivo la pubblicazione è rifiutata; con la sessione serve anche la password, con il limite ai tentativi dell'entrata. Ogni pubblicazione, riuscita o no, va nel registro delle richieste.
- **Si controlla prima di mostrare.** latest.yml deve avere una versione semantica, l'installer con il nome giusto, la sua SHA-512 e la sua dimensione; la versione deve venire dopo quella servita; l'installer arrivato deve avere quella SHA-512 e quella dimensione; il .blockmap deve esserci, compresso come lo fa electron-builder. I file arrivano in una cartella provvisoria e diventano visibili solo dopo, con uno scambio di cartelle.
- **Solo l'ultima versione**, in `<dati>/desktop`, fuori dalle copie di sicurezza: si ripubblica dal progetto.
- **Il protocollo dei clienti.** `GET /api/stato`, che resta libero, dice anche `protocollo` (`PROTOCOLLO_DEI_CLIENTI` in `src/protocollo/desktop.ts`, oggi 1) e `versione` (quella del centro, in breve). Il protocollo cresce di uno solo quando un cambio a rotte o eventi rompe un cliente fatto per quello di prima; le aggiunte che un cliente vecchio può ignorare non lo cambiano. Un cliente che vede un protocollo più alto del suo smette di scrivere, avvisa e cerca subito un aggiornamento: un cambio di protocollo si rilascia **pubblicando prima Shinka Desktop nuovo, e solo dopo installando il centro nuovo**.
- **Un canale solo**, Windows, senza rilasci a scaglioni, senza notifiche dal centro e senza firma dell'installer: la verifica è la SHA-512 del manifesto servito dal centro, a chi è entrato.

## Conseguenze

- `/api/stato` dice a chiunque la versione del centro: il codice è pubblico, e la versione aiuta un cliente a capire con chi parla.
- Il contratto va tenuto allineato con `docs/dipendenze-dal-server.md` del progetto Shinka Desktop.
- Un centro che cambia protocollo senza che sia stato pubblicato il cliente nuovo lascia le app in sola lettura finché non lo si pubblica.
