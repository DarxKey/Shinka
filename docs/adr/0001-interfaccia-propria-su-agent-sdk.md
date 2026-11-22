---
status: accepted
---

# Interfaccia propria sull'Agent SDK di Claude

Shinka è un'applicazione web scritta da noi in TypeScript che usa Claude Code come motore tramite il Claude Agent SDK ufficiale, invece di adottare l'interfaccia di Claude o una base open source. Il proprietario vuole una Home unica che smista verso progetti a contesto pulito e che sa tutto dei progetti, dentro un'interfaccia sua: nessuna alternativa offriva quella Home come concetto di prima classe, e l'Agent SDK è l'unico modo di avere Claude Code completo con il solo abbonamento Pro.

## Considered Options

- **Interfaccia di Claude (app desktop, claude.ai/code, Remote Control) con Shinka come plugin.** Molto meno lavoro e sempre aggiornata. Era la raccomandazione; scartata perché l'interfaccia non sarebbe stata nostra e la funzione Projects, la più vicina all'idea, non era disponibile sull'account del proprietario.
- **UI web open source ospitata in proprio (CloudCLI).** Licenza AGPL e smistamento comunque da costruire.
- **Piattaforme multi-agente pronte (Orca, AionUi, Paperclip).** Delega tra agenti già fatta, ma con un modello loro a cui adattarsi.
- **NanoClaw.** Scelto in un primo momento, poi abbandonato: nasce per le app di messaggistica e non ha un'interfaccia di lavoro sul codice.
- **Hermes Agent.** Non utilizzabile con il solo abbonamento Claude Pro.

## Consequences

- L'interfaccia va mantenuta da noi e rincorre le novità di Claude Code.
- Shinka dipende dalle condizioni d'uso dell'Agent SDK con l'abbonamento: la fonte di autenticazione va scelta in un solo punto del codice, così da poterla cambiare.
