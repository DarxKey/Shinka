---
status: accepted
---

# I modelli ambiente per ambiente

Il 24 novembre 2026 il proprietario ha chiesto due cose sui modelli:
- dopo un riavvio di Shinka i modelli di Claude non comparivano nel selettore fino al primo messaggio, o finché non si passava da Codex a Claude;
- nella scheda di un progetto nuovo voleva scegliere subito il sottomodello, compresi i modelli locali in rete degli altri nodi.

## Le cause

- **Un progetto di un altro ambiente non si preparava mai.** Aprendo la pagina, il centro mandava al nodo solo `apri-conversazione`, che crea la conversazione senza avviare il motore. Così il motore diceva modelli, comandi e contesto solo con il primo messaggio. Dopo un riavvio, poi, la pagina si ricollega prima del nodo: nel momento in cui la conversazione andava preparata, l'ambiente risultava spento, e nessuno la preparava più.
- **Un elenco parziale toglieva Claude dal menu.** Ogni pezzo di stato porta con sé l'elenco dei modelli noti. Se di Claude non si sapeva ancora nulla, ma c'erano modelli locali o in rete, l'elenco era fatto solo di quelli. L'interfaccia lo prendeva per buono e non mostrava più i modelli di Claude.
- **La scheda del progetto nuovo prendeva i modelli dalla Home.** Erano quindi quelli dell'ambiente del centro, qualunque ambiente si scegliesse, e mancavano del tutto se dopo il riavvio la Home non era stata aperta.

## Decisioni

- **`apri-conversazione` porta `prepara`.** Il centro lo manda quando il proprietario apre la conversazione, anche se il nodo la sa già aperta, e il nodo avvia il motore. Quando un nodo si collega, il centro prepara le sue conversazioni che una pagina sta guardando, tranne quelle con lavoro offline da consegnare (ADR 0056). Un nodo di prima ignora il campo.
- **Niente elenco senza il motore in uso.** Finché del motore della conversazione non si sa nulla, lo stato non porta elenco. Alla preparazione i modelli già noti nel processo si dicono subito; altrimenti il motore si sonda, una volta per processo (`ModelliDeiMotori`). Il motore che parte poi conferma l'elenco.
- **Il catalogo dei modelli** (`src/centro/catalogo-modelli.ts`, rotta `GET /api/nuovo-progetto/modelli?ambiente=`) dice i modelli di un ambiente:
  - nell'ambiente del centro: i motori di quel processo, i suoi modelli locali e quelli in rete degli altri ambienti, con il nome di chi li fornisce (ADR 0053);
  - in un altro ambiente: li chiede al suo nodo con `modelli`, e il nodo risponde con `modelli-esito`, cioè i suoi motori con un accesso e i suoi modelli locali.

  Se il nodo non risponde vale l'ultimo elenco che aveva detto. I modelli in rete restano solo per l'ambiente del centro, come vuole l'ADR 0053.
- **La scheda chiede il catalogo** quando si apre e a ogni cambio d'ambiente, per una proposta della Home come per un progetto creato a mano. Arrivato l'elenco, la scelta si riallinea (`sceltaRiallineata`): un modello che lì non c'è torna al predefinito del suo motore, e un motore che lì non ha accesso torna al predefinito. Finché l'elenco non arriva valgono i modelli della Home. Il modello scelto si salva con le impostazioni del progetto e vale dal primo messaggio; senza una scelta resta il predefinito.

## Conseguenze

- Aprire un progetto di un altro ambiente avvia il suo motore, come già succedeva nell'ambiente del centro.
- Un nodo di una versione precedente non sa dire i suoi modelli: la scheda mostra quelli della Home, finché il nodo non si aggiorna.
