---
status: accepted
---

# Il ponte di un nodo

Il 24 novembre 2026 il proprietario ha chiesto, nel decimo gruppo del suo elenco, un nodo che faccia da ponte per un altro: una macchina che non raggiunge il centro (una VM, un PC in un'altra rete) ma raggiunge un suo nodo deve poter diventare un ambiente come gli altri. Tra le possibilità (macchine che non vedono il centro, comandi su macchine vicine senza nodo, un nodo che ne raccoglie molti) ha scelto la prima.

## Decisioni

- **Il ponte lo accende il proprietario**, dalla pagina Ambienti, per un ambiente che non è quello del centro, con una porta (di solito 7851). Il centro lo ricorda e lo dice al nodo con `ponte`, anche a ogni collegamento; il nodo risponde con `ponte-esito`, e la pagina dice se è aperto e, se non lo è, perché (porta occupata, ambiente spento, nodo di una versione che non lo sa fare).
- **Il ponte fa passare solo i nodi** (`src/nodo/ponte.ts`). Sulla sua porta accetta due cose:
  - il collegamento cifrato dei nodi, riconosciuto dal nome che chiede nel saluto TLS (`nodi.shinka.invalid`): passa così com'è, cifrato da capo a capo, e il nodo continua a riconoscere il centro dalla sua chiave (ADR 0040). Il ponte non vede che cosa si dicono;
  - in chiaro, solo lo script e il pacchetto per preparare un ambiente nuovo (`/api/ambienti/preparazione`): una richiesta sola, che il ponte rifà verso il centro.

  Il resto si rifiuta: altri nomi TLS si chiudono, le altre richieste in chiaro ricevono un 403. Le pagine e le API dell'interfaccia non passano: il ponte non apre il centro alla rete da cui arriva la macchina.
- **La macchina nuova si prepara come le altre**, con il comando di una riga (ADR 0033): come indirizzo di Shinka si scrive quello del ponte, che la pagina mostra. Il nodo arriva sconosciuto e il proprietario lo approva, come sempre.
- **Su Windows** il ponte non si raggiunge finché il firewall non lo lascia passare: la pagina mostra la regola da creare una volta, come per i modelli locali in rete (ADR 0053). Shinka non apre il firewall.

## Conseguenze

- Se il nodo che fa da ponte è spento, le macchine dietro di lui risultano spente: il loro collegamento passa da lui.
- Il centro vede le macchine dietro il ponte con l'indirizzo del ponte: un modello locale in rete su una di loro (ADR 0053) non si raggiunge da lì.
- Un nodo di una versione precedente non conosce `ponte`, e la pagina lo dice.
- Ponti in fila (un ponte dietro un ponte) funzionano allo stesso modo, perché passa solo il collegamento cifrato; non sono provati.
