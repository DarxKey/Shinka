---
status: accepted
---

# Un progetto nuovo sceglie le sue estensioni, e comincia con una skill

Fino al 15 novembre 2026 ogni progetto aveva tutte le estensioni accese nel suo ambiente, e il primo messaggio era il brief. Il proprietario ha chiesto che un progetto nuovo cominci con un'intervista sul piano (le skill grill-me o grill-with-docs del plugin mattpocock-skills) e con CodeGraph acceso e già indicizzato, e che prima di confermare possa scegliere quali estensioni il progetto avrà.

## Decisioni

- **Le estensioni si scelgono per progetto, nella scheda della proposta.** Per l'ambiente scelto la scheda elenca le estensioni di Shinka, accese lì o no, e ciò che il proprietario vi ha installato per conto suo. Sono spuntate le consigliate (mattpocock-skills e codegraph) che lì sono accese; le altre si spuntano a mano; una spenta non si sceglie, e lo dice. Le scelte restano scritte nel progetto, e ogni volta che il suo processo parte riceve solo quelle. I progetti nati prima, senza una scelta, continuano ad averle tutte.
- **Ciò che il proprietario ha installato per conto suo c'è sempre.** Shinka non lo spegne: nella scheda si vede, spuntato e fermo. Se Shinka non ha mai guardato l'ambiente, la scheda lo dice invece di darlo per assente.
- **La skill di partenza è un comando nel primo messaggio.** grill-me e grill-with-docs si possono avviare solo dal proprietario (`disable-model-invocation`), quindi il primo messaggio è `/mattpocock-skills:<skill> <brief>`: l'harness avvia la skill e le passa il brief per intero. La consigliata è grill-with-docs con una cartella che esiste già, grill-me altrimenti; si può cambiare o togliere, e senza il plugin il progetto comincia dal solo brief.
- **L'indice di CodeGraph lo costruisce Shinka.** Se CodeGraph è tra le estensioni del progetto, prima del primo messaggio l'ambiente lancia `npx -y <pacchetto> init -y .` nella cartella. Il pacchetto viene dalla definizione dell'estensione ed è controllato: l'unico che una preparazione può lanciare è `@colbymchenry/codegraph`. Il progetto nasce subito; la chat dice che l'indice si sta costruendo e quando è pronto, e il primo messaggio parte dopo. Se non riesce, il primo messaggio parte lo stesso e dice a Claude che l'indice manca.
- **Un nodo di prima non blocca nulla.** Il nodo dice subito che ha cominciato a preparare; se non lo dice entro pochi secondi, il centro non lo aspetta oltre.

Verificato sull'harness vero il 15 novembre 2026, con l'SDK 0.3.322: il comando avvia grill-me e grill-with-docs, la skill riceve il brief di più righe con le note di Shinka, e in "Modifiche libere" non viene chiesto nessun consenso. `codegraph init -y` è stato lanciato davvero e ha costruito l'indice.

## Considered Options

- **Chiedere a Claude, nel brief, di usare la skill.** Scartata: le due skill non si lasciano chiamare da Claude.
- **Far lanciare `codegraph init` a Claude nel primo turno.** Scartata: nei modi che chiedono, un comando da approvare prima ancora di cominciare; e l'indice non ci sarebbe dal primo messaggio.
- **Un comando di preparazione libero, scritto nella definizione dell'estensione.** Scartata per ora: farebbe eseguire a un nodo un comando qualunque arrivato dal centro. Una preparazione è di un tipo conosciuto, con argomenti controllati.

## Consequences

- Un progetto nuovo non ha più tutte le estensioni accese: ha quelle spuntate. Un'estensione accesa dopo nell'ambiente non arriva da sola ai progetti che non l'hanno scelta.
- Cambiare le estensioni di un progetto già nato non si può ancora dall'interfaccia.
- I nodi devono essere aggiornati per rispettare le scelte e preparare la cartella: uno di prima dà al progetto tutte le estensioni dell'ambiente.
