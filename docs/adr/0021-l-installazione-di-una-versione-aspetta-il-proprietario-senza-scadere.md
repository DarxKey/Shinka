---
status: accepted
---

# L'installazione di una versione aspetta il proprietario senza scadere

Dal 12 novembre 2026 ([ADR 0010](0010-shinka-si-sviluppa-da-un-progetto-suo-e-si-installa-dopo-le-prove-e-il-si-del-proprietario.md)) una versione di Shinka che ha passato le prove entra in funzione solo con l'approvazione del proprietario, e la richiesta scadeva dopo un'ora. Il 16 novembre 2026 una richiesta è scaduta mentre il proprietario non era davanti alla scheda, e ha dovuto chiederne un'altra. Ha chiesto di togliere la scadenza. È una regola della sezione 4.10 della specifica: cambia su sua richiesta esplicita (versione 2.8).

## Decisioni

- **La richiesta di installare una versione non scade.** Aspetta il proprietario finché non approva o nega, dall'interfaccia o da Telegram.
- **Una richiesta sola alla volta.** Una richiesta più recente prende il posto di quella che aspettava, che non si può più approvare: così non si può mettere in funzione, per sbaglio, una versione superata da una più nuova. Se il centro riparte la richiesta smette di aspettare, perché la versione preparata era quella del centro di prima.
- **Le altre attese restano com'erano.** Il sì dato al gateway e l'approvazione di un comando su un host scadono ancora: lì il tempo fa parte della garanzia, perché si tratta di eseguire qualcosa adesso, su una macchina del proprietario.

## Considered Options

- **Una scadenza più lunga** (un giorno, una settimana). Scartata: il proprietario ha chiesto di toglierla, e la garanzia che conta, cioè non installare una versione superata, la dà già il fatto che la richiesta nuova sostituisce la vecchia.

## Consequences

- Una scheda di installazione può restare aperta a lungo. Il progetto Shinka lo sa: la risposta a `chiedi_installazione` dice che la richiesta aspetta finché il proprietario non decide.
- Le richieste di prima, nell'archivio, hanno ancora la loro scadenza scritta: l'interfaccia non la guarda più.
