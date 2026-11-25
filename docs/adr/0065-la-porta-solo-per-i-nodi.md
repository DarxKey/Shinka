---
status: accepted
---

# La porta solo per i nodi

Il 25 novembre 2026 il proprietario ha chiesto quanto sia sicuro rendere il centro raggiungibile da Internet, per collegare un nodo fuori casa, come PC ATES dall'ufficio. Sulla porta del centro c'è tutta Shinka: le pagine, le API e l'entrata con una sola password. Il limite ai tentativi vale per tutti insieme, e da Internet chiunque potrebbe tenere fuori il proprietario. Un difetto del centro, poi, diventerebbe raggiungibile da chiunque, e il centro comanda tutte le macchine. Tra tre strade proposte ha scelto questa:
- una porta solo per i nodi;
- aprire la porta di sempre al solo indirizzo dell'ufficio;
- una VPN sul PC.

## Decisioni

- **Una porta a parte, che fa passare solo il collegamento cifrato dei nodi** (`src/centro/porta-dei-nodi.ts`).
  - Si accende dove gira il centro, con `SHINKA_PORTA_NODI`. Il container deve pubblicarla, e il proprietario la apre sul suo firewall.
  - Accetta solo una stretta di mano TLS che chiede il nome dei nodi, `nodi.shinka.invalid`, e passa la connessione al server del centro così com'è, con il suo indirizzo. Il nodo riconosce il centro dall'impronta del certificato dei nodi, da capo a capo, come a casa (ADR 0040).
  - In chiaro non risponde nulla, nemmeno lo scaricamento dell'installazione. Lo stesso vale per una stretta di mano senza nome o con un altro nome.
- **Sul collegamento dei nodi passano solo le loro rotte.** Una richiesta arrivata in TLS con il nome dei nodi, da qualunque porta, raggiunge solo:
  - il collegamento (`/api/nodi/collegamento`);
  - lo script di preparazione;
  - il pacchetto di un ambiente nuovo.

  Il resto riceve 403 e finisce nel registro delle richieste come «fuori-dai-nodi», tra ciò che merita uno sguardo. Il controllo è il primo del centro, prima dei file dell'interfaccia. Vale anche per il ponte di un nodo (ADR 0058): il ponte fa passare il TLS dei nodi senza vederci dentro, e prima chi lo apriva a mano poteva chiedere ogni rotta del centro.
- **Da Internet, un nodo sconosciuto si presenta solo mentre c'è un invito aperto.** Senza un invito aperto, un nodo che il proprietario non ha accettato viene rifiutato prima di mettersi in attesa, e finisce nel registro come «nodo-da-fuori-rifiutato». Gli inviti sono quelli del comando di una riga: valgono un'ora. Così chi trova la porta non riempie la pagina Ambienti di richieste e non occupa i cinque posti in attesa. Un nodo già accettato entra sempre, con il suo segreto.
- **L'indirizzo da Internet lo dice il centro ai nodi.**
  - Il proprietario lo scrive nella pagina Sicurezza, e lo può cambiare quando vuole: vuoto per nessuno. `SHINKA_NODI_DA_FUORI` (per esempio `http://nodi.esempio.it:7853`) è solo il valore di partenza, a cui la pagina torna. La scelta sta in `impostazioni.json` (`nodiDaFuori`).
  - Il centro lo mette nel messaggio `accolto`. Quando cambia lo manda subito ai nodi collegati, con `da-fuori`.
  - Il nodo lo ricorda in `nodo.json` (`centroDaFuori`). Quando l'indirizzo di sempre non risponde, alterna i due tentativo dopo tentativo.
  - Lo usa solo se riconosce già il centro: dall'impronta, o dal certificato del sito se l'indirizzo è `https`. Mai al primo incontro, né in chiaro.
  - Nessuna impostazione nodo per nodo: un nodo che è passato una volta da casa sa già come rientrare da fuori.
  - Se il centro smette di dirlo, il nodo lo dimentica; `--dimentica-centro` lo toglie con l'impronta.
- **La pagina Sicurezza** dice se la porta è accesa e quale, e ha il campo dell'indirizzo da Internet.

## Considered Options

- **Aprire la porta di sempre al solo indirizzo dell'ufficio, dal firewall.** Non costa nulla, ma a quell'indirizzo resta visibile tutta Shinka, e serve un indirizzo fisso.
- **Una VPN sul PC del lavoro.** Nulla di Shinka su Internet, ma servono permessi sul PC e una rete che la lasci passare.
- **Il proxy HTTPS del firewall davanti al centro.** Il nodo si fiderebbe del certificato del sito e non più dell'impronta, e il proxy dovrebbe lasciar passare i WebSocket. Resta possibile con un indirizzo `https://`, ma la porta solo per i nodi tiene la verifica da capo a capo.
- **Distinguere i nodi dalla porta di sempre, guardando l'indirizzo di chi arriva.** Dentro un container il centro non vede sempre l'indirizzo vero.

## Consequences

- Su Internet c'è la stretta di mano TLS del centro e, dentro, il solo collegamento dei nodi. Chi trova la porta non arriva all'entrata con la password e non può bloccarla con tentativi sbagliati.
- Un nodo nuovo su Windows non si prepara da Internet: il comando di una riga scarica lo script in chiaro, e la porta non lo serve. Si prepara da casa, o attraverso un ponte; poi da fuori entra come gli altri. Su Linux il comando usa già la strada cifrata e funziona anche da qui.
- Un nodo di una versione precedente non conosce l'indirizzo da Internet: lo impara dopo l'aggiornamento, al primo collegamento da casa.
- Il centro vede l'indirizzo vero di chi arriva dalla porta, come dalla porta di sempre: nel registro le richieste da Internet hanno il loro indirizzo.
- La porta, il container e il firewall si preparano fuori dal codice: la porta pubblicata dal container con `SHINKA_PORTA_NODI`, e una regola del firewall verso quella porta, possibilmente solo dagli indirizzi da cui il proprietario lavora.
