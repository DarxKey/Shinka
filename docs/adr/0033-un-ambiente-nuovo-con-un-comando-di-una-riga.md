---
status: accepted
---

# Un ambiente nuovo con un comando di una riga

L'[ADR 0032](0032-installazione-da-zero-con-un-pacchetto.md) ha lasciato a un pezzo a sé il modo di preparare un ambiente Linux o Windows: il comando di una riga dalla pagina Ambienti, scelto dal proprietario il 20 novembre 2026. Prima un nodo si metteva sotto il suo guardiano a mano, con i comandi in fondo a STATO.md.

## Decisioni

- **Dalla pagina Ambienti**, «Aggiungi un ambiente»: sistema (Linux o Windows), nome, che cosa offre, e l'indirizzo di Shinka visto da quella macchina, proposto da quello della pagina. Il centro risponde con il comando da incollare:
  - Linux: `curl -fsSL '<centro>/api/ambienti/preparazione?invito=…' | bash`
  - Windows: `irm '<centro>/api/ambienti/preparazione?invito=…' | iex`
- **Un invito, non la password.** Il comando porta un gettone casuale che vale un'ora, si può usare più volte (lo script si rilancia) e non sopravvive a un riavvio del centro; al massimo cinque insieme. Lo script e il pacchetto del nodo stanno su due percorsi liberi nominati in `PERCORSI_LIBERI`, e senza un invito valido non danno nulla. Il pacchetto contiene solo codice.
- **L'invito non vale come consenso.** Il nodo arriva sconosciuto, come sempre: lo script stampa il codice di verifica, e il proprietario approva dalla pagina se coincide.
- **L'indirizzo è in HTTP**, anche quando la pagina è in HTTPS: i nodi si collegano in HTTP sulla stessa porta (ADR 0017), e così curl e PowerShell non inciampano nella CA di Shinka.
- **Il pacchetto del nodo** (`/api/ambienti/preparazione/pacchetto`) è un `.tar.gz` con `guardiano/` e `shinka/`, la stessa versione che il centro passa a un nodo che si aggiorna. Lo script lo dispone come la cartella descritta per l'incremento 13, in `~/Shinka/nodo` (oppure `SHINKA_CARTELLA`), installa le dipendenze con `npm ci --omit=dev` e salva nome, descrizione e indirizzo tra le scelte del nodo, tenendo quelle che c'erano.
- **Partenza automatica senza diritti di amministratore.**
  - Linux: un servizio utente di systemd, con `loginctl enable-linger` se si può (altrimenti lo dice); senza systemd, `nohup` e una riga `@reboot` di cron. Il registro è `nodo.log` nella cartella del nodo.
  - Windows: un collegamento nella cartella Esecuzione automatica che avvia nascosto `avvia-nodo.ps1`; il nodo parte a ogni accesso a Windows, non all'accensione.
- **Le cartelle si danno sempre** (`SHINKA_INSTALLATA`, `SHINKA_DATI_NODO`): sulla stessa macchina può esserci un'altra Shinka con le sue variabili, e il guardiano del nodo non deve vederle.
- **Un nodo rifiutato o rimosso esce con il codice 78** (`CODICE_RIFIUTATO`), e il servizio di systemd non lo fa ripartire: ricomparirebbe ogni mezzo minuto tra le richieste in attesa.
- **Rilanciare lo script** ferma il nodo che c'è, sostituisce codice e guardiano (la versione di prima resta in `shinka-sostituita`), riusa le dipendenze se non sono cambiate e tiene identità e dati: il nodo rientra senza una nuova approvazione.
- **Node.js non lo installa lo script su Linux**, perché servirebbe root: se manca, o è più vecchio della 22.18, lo dice. Su Windows prova con winget. Su Linux servono anche gli strumenti per compilare il terminale (`build-essential`, `python3`), e lo script lo dice prima di cominciare.

## Consequences

- Il nodo del PC del proprietario, avviato oggi a mano dalla cartella `Shinka\nodo` del suo utente, con questo comando può passare alla partenza automatica tenendo identità e scelte: è la cartella predefinita dello script.
- Lo script PowerShell non è provato su Windows in questo ambiente: lo è la sua parte che conta per la sicurezza (le scelte tra apici), non l'esecuzione.
- Gli accessi di Claude e Codex del nuovo ambiente restano da fare dalla pagina Impostazioni (ADR 0031).
