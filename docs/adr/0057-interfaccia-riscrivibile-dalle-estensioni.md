---
status: accepted
---

# L'interfaccia riscrivibile dalle estensioni

Il 24 novembre 2026 il proprietario ha deciso, con una proposta di sviluppo della Home, che il più possibile dell'interfaccia di Shinka (il sito e Shinka Desktop, che la riusa) si cambi e si arricchisca con estensioni dell'interfaccia, senza passare ogni volta dal progetto Shinka. Il primo esempio è una barra a destra con le risorse dell'ambiente del progetto aperto, in tempo reale.

Ha scelto in modo esplicito l'accesso libero alle API di Shinka per le estensioni. Questo supera la parte dell'[ADR 0054](0054-estensioni-dell-interfaccia.md) per cui una pagina non raggiunge le API: il resto dell'ADR 0054 vale ancora.

## Decisioni

- **Il ponte, non la stessa origine.** C'erano due strade: (a) la pagina resta nel suo riquadro, con un'origine sua e senza rete, e chiede le API all'interfaccia con `postMessage`; (b) la pagina gira nella stessa origine dell'interfaccia. È stata scelta la (a). Con la (b) una pagina avrebbe tutto ciò che ha l'interfaccia, senza che nulla lo dica o lo limiti: il cookie, le rotte chiuse, il DOM di Shinka, le altre estensioni. Con la (a) l'interfaccia vede ogni richiesta, la confronta con ciò che l'estensione ha dichiarato e la annota.
- **La libreria del ponte.** Il centro mette in cima a ogni pagina (`src/protocollo/ponte-delle-pagine.ts`) `window.shinka`, con:
  - `alloStato`: dove è aperta, progetti, ambienti, Home, client, tema;
  - `api`, `get`, `post`, `put`, `del`;
  - `segui`: i flussi di eventi, letti dall'interfaccia con `fetch`;
  - `manda`: come prima;
  - `altezza`, `etichette`, `alSegnale`.

  I messaggi di prima valgono ancora. La pagina resta con la politica dell'ADR 0054: `sandbox allow-scripts`, `connect-src 'none'`, solo in un riquadro di Shinka.
- **Le API le dichiara l'estensione, anche "tutte".** L'estensione dichiara le rotte che le sue pagine usano, come `GET /api/ambienti/*/risorse`, oppure `"tutte"`; la scheda di conferma le mostra in chiaro. Non c'è un elenco chiuso di API ammesse. L'interfaccia rifiuta ciò che non è dichiarato. Ogni richiesta porta `X-Shinka-Estensione` con il nome dell'estensione: il centro la annota nel registro della pagina Sicurezza, raccolta per estensione e rotta, come le altre richieste che si ripetono.
- **Che cosa resta chiuso, anche con "tutte"** (`rottaEsclusa`, controllata dall'interfaccia e di nuovo dal centro):
  - le rotte dell'accesso a Shinka: entrare, uscire, password, dispositivi, sessioni, copie dei dati, pubblicazione di Shinka Desktop;
  - le decisioni che la specifica riserva al proprietario: i permessi delle conversazioni, le approvazioni dei comandi sugli host, le proposte di progetto, di sviluppo e di estensione (anche dell'interfaccia), l'installazione di una versione.

  Queste rotte il proprietario non le ha chieste in modo esplicito, e aprirle cambierebbe le regole della sezione 4: una pagina potrebbe approvare da sola i permessi, confermare un'altra estensione o installare una versione. Le credenziali del vault restano dove sono: un'estensione vede ciò che le API già danno, cioè nomi e host, mai i valori.
- **I posti.** Una pagina dichiara i suoi posti:
  - `menu` e `pannello`, quelli di prima;
  - `barra-destra`, richiudibile, con la scelta ricordata nel browser;
  - `barra-sinistra`, in fondo alla barra laterale;
  - `testata`, `barra-di-stato`, `sopra-scrittura`, `sotto-scrittura`;
  - `flottante`, un pannello che si apre da un pulsante;
  - `ambiente` e `sicurezza`, sezioni di quelle pagine.

  Per ogni posto dice l'ambito (Home, progetti, ovunque) e il client (sito, Desktop, tutti). I posti della chat stanno solo nella chat principale, non in quella affiancata. Un posto chiuso non carica la pagina: chi la scrive aggiorna solo mentre c'è.
- **Le parti.** Un elenco ragionato di parti che un'estensione nasconde o sostituisce con una sua pagina:
  - il benvenuto della Home vuota;
  - il riquadro dello stato del progetto;
  - le quattro schede del pannello;
  - le risorse della pagina di un ambiente;
  - la riga dei pulsanti delle estensioni.

  Sono quelle che si possono togliere senza che Shinka smetta di funzionare: la chat, il campo di scrittura, le schede dei permessi e la barra laterale non ci sono. Le parti principali hanno `data-parte`, perché un tema le trovi senza inseguire le classi.
- **I comandi** stanno nella palette (Ctrl+K) e, con `tasti` come `Ctrl+Shift+R`, rispondono alla tastiera. Aprono una pagina, mandano un testo alla conversazione aperta, o danno un segnale alle pagine accese dell'estensione. **Le etichette** sono piccole scritte che una pagina mette accanto a progetti e argomenti nella barra laterale.
- **La GPU.** Per il primo esempio il nodo legge le schede video NVIDIA con `nvidia-smi`, dove c'è, e le aggiunge al campione delle risorse: nome, uso, memoria, temperatura. La pagina dell'ambiente le mostra. Dove `nvidia-smi` non c'è non si riprova.
- **Il riferimento** per chi scrive un'estensione è `docs/estensioni-interfaccia.md`, con un esempio completo (la barra delle risorse) che le prove usano così com'è. La Home lo legge con `riferimento_estensioni_interfaccia` prima di scriverne una.

## Conseguenze

Che cosa può fare adesso un'estensione confermata dal proprietario:
- cambiare l'aspetto di tutto con un tema;
- mettere pagine in tutti i posti elencati;
- nascondere o sostituire le parti elencate;
- aggiungere comandi e scorciatoie;
- leggere lo stato;
- mandare messaggi alle conversazioni;
- chiamare con la sessione del proprietario le API che ha dichiarato. Con "tutte", qualunque API tranne quelle chiuse: per esempio leggere storie, file e memoria, mandare messaggi a progetti e Home, accendere e spegnere applicazioni ed estensioni, cambiare impostazioni.

Che cosa non può fare:
- uscire dal suo riquadro o raggiungere la rete da sé;
- leggere i cookie;
- toccare l'accesso a Shinka;
- prendere le decisioni che spettano al proprietario;
- vedere il valore di una credenziale.

Altre conseguenze:
- Un'estensione con "tutte" le API ha nelle mani quasi quanto il proprietario dall'interfaccia. La salvaguardia è la scheda, che lo dice in chiaro, il registro, e il fatto che la scrive Claude e la conferma lui. Una pagina che legge dati e poi manda un messaggio a una conversazione che ha accesso alla rete può far uscire quei dati: per questo il registro annota ogni richiesta, e la scheda chiede di dichiarare solo ciò che serve.
- L'anteprima di un progetto sta a un'altra porta (ADR 0007): non è un riquadro di un'estensione, e l'interfaccia risponde solo ai riquadri delle sue pagine. Il WebSocket del terminale non passa dal ponte.
- Shinka Desktop riusa l'interfaccia: le pagine, i posti e il ponte funzionano uguale. Le richieste del ponte passano dall'app come le altre. Perché arrivino al registro con il nome dell'estensione l'app deve lasciar passare l'intestazione `X-Shinka-Estensione`: serve una versione nuova dell'app.
- Con `?senza-estensioni` l'interfaccia si apre senza nessuna estensione: niente temi, pagine, posti, comandi, etichette, parti cambiate.
