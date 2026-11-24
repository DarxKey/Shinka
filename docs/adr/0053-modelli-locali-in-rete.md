---
status: accepted
---

# I modelli locali in rete

Il 24 novembre 2026 il proprietario ha chiesto di usare il modello locale (Qwen, sulla scheda video del PC) come modello principale anche della Home, che gira sul centro. Il modello dell'[ADR 0051](0051-incarichi-affidati-a-un-altro-modello.md) è un'estensione dell'ambiente in cui gira: il suo server ascolta solo su quella macchina, e lo usano solo i progetti di lì. Tra un tunnel nel collegamento del nodo, il server aperto in rete e lasciare le cose come stanno, il proprietario ha scelto il server aperto in rete.

## Decisioni

- **In rete per scelta del proprietario, ambiente per ambiente.** Nella pagina Estensioni, sotto un modello locale acceso in un ambiente che non è quello del centro, la casella «In rete» con l'indirizzo dell'ambiente visto dal centro. Il centro lo propone: è l'indirizzo da cui il nodo si è collegato. Lo mette e lo toglie solo il proprietario.
- **La chiave.** Messo in rete, il centro genera una chiave casuale per quel modello in quell'ambiente e la tiene nel suo elenco delle estensioni, fuori dallo stato che vedono la pagina e le conversazioni. Arriva al nodo con l'estensione, sul collegamento cifrato. Il nodo accende il server con `--host 0.0.0.0 --api-key <chiave>`, al posto dell'indirizzo e della chiave scritti nella definizione: anche le conversazioni del suo ambiente la usano. Rimesso in rete dopo esserne stato tolto, la chiave cambia.
- **Chi lo accende.** Una conversazione del centro che sceglie il modello lo chiede al nodo con `prendi-modello`. Il nodo accende il server, solo se quel modello lì è in rete, e risponde quando risponde; finita la conversazione il centro manda `lascia-modello`, e il server si spegne dopo i soliti dieci minuti. Se il collegamento cade, il nodo lascia ciò che il centro aveva preso.
- **Dove si sceglie.** La Home e i progetti dell'ambiente del centro vedono, accanto ai modelli locali di lì, quelli in rete degli ambienti accesi, come «modello (in rete, ambiente)». A parità di nome vale quello di lì.
- **Il firewall.** Su Windows il server non si raggiunge finché il firewall non lo lascia passare. Shinka non apre il firewall: la pagina mostra la regola da creare una volta, da un PowerShell da amministratore, limitata all'indirizzo del centro quando lo conosce.

## Conseguenze

- Il server del modello è raggiungibile dalla rete di casa: senza la chiave non risponde, ma la richiesta passa in chiaro, in HTTP, e chi sta sulla stessa rete potrebbe leggerla. È il prezzo della strada più breve, scelto dal proprietario; il tunnel nel collegamento del nodo resta possibile più avanti.
- Un nodo di una versione precedente non conosce `prendi-modello`: il centro aspetta, e la conversazione dice che il modello non è partito.
- Con il modello locale la Home non ha la ricerca sul web, come i progetti (ADR 0051).
