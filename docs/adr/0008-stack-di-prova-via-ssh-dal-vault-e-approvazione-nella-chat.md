---
status: accepted
---

# Gli stack di prova passano da SSH con una credenziale del vault, e l'approvazione si dà nella chat

Per avviare container su un host del proprietario il gateway non riceve il socket di Docker: usa SSH, con una credenziale del vault che il proprietario dichiara "host per gli stack di prova", insieme a un intervallo di porte e a una cartella per i volumi. Su quell'host Claude gestisce da solo soltanto gli stack creati da Shinka, che descrive con campi tipizzati: il file per Docker Compose lo scrive il gateway. Ogni altro comando sullo stesso host resta fermo nel gateway finché il proprietario non lo approva da una scheda nella chat, che mostra il comando com'è scritto e scade dopo cinque minuti. Lo ha deciso il proprietario il 12 novembre 2026.

## Considered Options

- **Socket di Docker montato nel gateway.** Nessuna credenziale da inserire, e solo per l'host su cui gira il gateway. Scartata dal proprietario: chi ha il socket è amministratore dell'host, e il gateway diventerebbe il container da cui si prende tutto il server. Con SSH vale anche per gli altri host del lab, e la credenziale la può togliere lui.
- **Un file Compose scritto da Claude e controllato dal gateway.** Più libertà: reti, build, ogni opzione di Compose. Scartata: controllare un formato così largo vuol dire dimenticare qualcosa. Con una descrizione a campi chiusi ciò che non è previsto non si può chiedere, e un campo in più viene rifiutato dicendolo.
- **Approvazione nella pagina del gateway.** Era l'opzione consigliata: la decisione passerebbe solo tra il proprietario e il gateway, con la frase del vault. Scartata dal proprietario: vuole approvare dove sta parlando con Claude, e più avanti da Telegram. Il prezzo è nelle conseguenze.
- **Solo il permesso dell'harness, senza un'approvazione del gateway.** Scartata: in modalità "Automatico" e "Senza permessi" quel consenso non viene chiesto, e la regola deve valere qualunque cosa abbia scelto il modello.

## Consequences

- Il recinto lo fa rispettare il gateway nel momento in cui esegue: container con il nome `shinka-<nome>` e l'etichetta `shinka.stack`, porte solo nell'intervallo dedicato, volumi solo sotto `<cartella>/<nome>`, niente privilegi, niente rete dell'host, memoria e processi limitati, nessun riavvio automatico. Uno stack che porta il nome di Shinka ma non l'etichetta, o una cartella senza il segno `.shinka-stack`, non vengono toccati.
- Le immagini vengono da un registro. Costruire un'immagine dal codice di un progetto non è previsto: per provare codice proprio si monta in un volume, come file di testo.
- L'approvazione vale per il comando esatto che la scheda mostra, una volta sola, per cinque minuti. Il gateway tiene la richiesta e, all'approvazione, esegue quella: il centro non gli rimanda il comando.
- A dire al gateway che il proprietario ha approvato è il centro, con il suo gettone. Una conversazione che girasse nel container del centro e riuscisse a leggere quel gettone potrebbe approvarsi da sola un comando: è il prezzo dell'approvazione nella chat, e il motivo per cui l'altra opzione era quella consigliata. Le conversazioni non hanno uno strumento per farlo e il gettone non è tra i file dei progetti, ma stanno nello stesso container.
- Il consenso che il proprietario dà dalla scheda dei permessi a un `esegui_su_host` vale come approvazione per quello stesso comando, una volta, entro due minuti: così in modalità "Chiedi sempre" non gli viene chiesto due volte.
- Su un host per gli stack la credenziale del recinto è una sola. Un'altra credenziale inserita per lo stesso host, scritto in un altro modo (nome invece di indirizzo), non passa dal recinto: il gateway confronta gli host come sono scritti.
- Sull'host servono Docker con Compose v2 e un utente che possa usarli. Chi può usare Docker su un host ne è di fatto amministratore: il recinto protegge da ciò che Claude chiede, non sostituisce la fiducia nella credenziale.
