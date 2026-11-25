---
status: accepted
---

# Credenziali date a un ambiente

Il 25 novembre 2026 il proprietario ha chiesto di usare le credenziali del vault su un IP che solo «PC ATES» raggiunge: il gateway, a casa, non ci arriva.

## Le scelte del proprietario

Tra le strade proposte:
- il nodo come tramite: il collegamento SSH, cifrato da capo a capo, passa dal nodo e le credenziali restano nel gateway;
- il vault anche sul nodo;
- lasciare com'è.

Il proprietario ha scelto **il vault anche sul nodo**, con queste regole:
- **solo le credenziali che segna lui**, ambiente per ambiente, dalla pagina del vault;
- **solo in memoria** sul nodo, finché il vault è aperto;
- **quale strada prendere la decide Shinka da sola**: prima il gateway, e se l'host non risponde il nodo di un ambiente che ha la credenziale.

È un'eccezione alle regole 4.3 («l'uso delle credenziali passa sempre dal gateway del centro») e 4.8 («le credenziali per SSH non escono mai dal gateway»). Il proprietario l'ha confermata in modo esplicito, sapendo che le conversazioni di quell'ambiente, sulla stessa macchina, la potrebbero leggere con un comando.

## Decisioni

- **La chiave del nodo.** Ogni nodo crea al primo avvio una coppia X25519 (`dati-nodo/chiave-vault.json`, leggibile solo dal suo utente) e dice la pubblica al centro quando si presenta (`chiaveVault`). Il centro passa al gateway l'elenco degli ambienti collegati che ne hanno una.
- **La scelta del proprietario, nella pagina del vault.**
  - Sotto ogni credenziale che si può dare, gli ambienti collegati con l'impronta della chiave del loro nodo.
  - Spuntandone uno, il gateway fissa nella credenziale la chiave di quel momento.
  - Non si danno la credenziale del server di Shinka, quella di un host per gli stack di prova, quelle dei siti e le chiavi delle estensioni.
  - Sostituita, la credenziale resta data agli stessi ambienti.
- **Il sigillo.** Le credenziali di un ambiente il gateway le dà solo a vault aperto, e solo se la chiave con cui il nodo si presenta è quella fissata. Viaggiano in un sigillo per quella chiave: X25519 con una chiave effimera, HKDF-SHA256, AES-256-GCM (`src/protocollo/sigillo.ts`). Il centro le passa al nodo senza poterle leggere, e ogni consegna finisce nel registro del gateway.
- **Solo in memoria.** Il nodo le tiene in memoria (`src/nodo/credenziali-delegate.ts`) e le dimentica:
  - quando il centro gli dice che il vault si è chiuso;
  - quando all'ambiente non è data più nessuna credenziale;
  - quando il centro si scollega;
  - quando il nodo si spegne.

  Il centro le riconsegna quando il nodo si collega e a ogni giro di due minuti (`src/centro/credenziali-negli-ambienti.ts`).
- **La strada.** Il gateway prova a collegarsi lui. Se l'host non risponde e la credenziale è data a un ambiente:
  1. il gateway risponde `da-delegare`, dopo aver già controllato il divieto fisso e gli host della credenziale, e per mezz'ora manda subito dal nodo i comandi su quell'host;
  2. il centro manda il comando al nodo del primo di quegli ambienti che è collegato (`esegui-su-host`);
  3. il nodo ricontrolla divieto fisso, host e impronta dell'host, lo esegue e nasconde il valore nell'uscita;
  4. l'esito torna al gateway per il registro, e l'impronta di un host nuovo si ricorda nel vault.
- **Un nodo di prima** non dice la sua chiave: non compare tra gli ambienti a cui dare una credenziale.

## Conseguenze

- Su quella macchina la credenziale si può leggere, finché il vault è aperto: dalla memoria del nodo, e con un comando dalle conversazioni dei progetti di lì.
- Se il centro fosse compromesso nel momento in cui il proprietario sceglie l'ambiente, potrebbe presentare una sua chiave al posto di quella del nodo. L'impronta mostrata nella pagina del vault serve a confrontarla.
- Il primo collegamento a un host nuovo passando dal nodo fissa l'impronta di quell'host per tutti, anche per il gateway.
