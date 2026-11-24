---
status: accepted
---

# Il contesto iniziale della Home

Il 24 novembre 2026 la Home ha misurato circa 42.000 token occupati già al primo messaggio, prima di qualunque lavoro, e ha proposto di caricare al bisogno gli strumenti delle estensioni: la parte più grossa veniva da Notion, che ripete in ognuno dei suoi 22 strumenti lo stesso schema. Con Qwen come modello della Home ([ADR 0053](0053-modelli-locali-in-rete.md)) quel contesto non ci stava, e il proprietario ha chiesto anche di poter scegliere quanto riservare alla compattazione.

## Che cosa abbiamo trovato

- Claude Code carica gli strumenti MCP al bisogno (ToolSearch) di suo. Nella Home non lo faceva perché la Home gli dà un elenco chiuso di strumenti, e ToolSearch non c'era: senza, Claude Code mette tutti gli schemi nel contesto. Nei progetti, che hanno gli strumenti di Claude Code al completo, gli strumenti delle estensioni erano già caricati al bisogno.
- Provato con l'harness vero, gli strumenti della Home come li crea Shinka e un server finto pesante come Notion: senza ToolSearch circa 112.000 token di strumenti MCP nel contesto; con ToolSearch circa 9.900, e gli altri 102.000 restano fuori finché non servono.
- La riserva per la compattazione, per Claude Code, è la risposta massima del modello più 13.000 token: con 16.000 di risposta massima sono 29.000. `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` non la cambia.

## Decisioni

- **ToolSearch nella Home**, senza consenso: cercare uno strumento non fa nulla.
- **Gli strumenti di Shinka di ogni giorno restano caricati** (ambienti e loro file, progetti, argomenti, memoria, elaborati, la scelta di dove lavorare), con `anthropic/alwaysLoad`; quelli usati di rado (stack, siti, credenziali, host, lavori programmati, mappe, estensioni, sviluppo, skill, Telegram) si cercano quando servono, come quelli delle estensioni. Le istruzioni della Home lo dicono.
- **Il peso di ogni estensione**: la prova la misura con l'harness (quanti token pesano i suoi strumenti se caricati tutti) e la pagina Estensioni lo mostra, ambiente per ambiente. Le estensioni provate prima lo mostrano dopo essere state riaccese.
- **La risposta massima di un modello locale** si sceglie nella pagina Estensioni, da 1024 token a metà del contesto: la pagina dice la riserva che ne viene. Vale dalle conversazioni che partono dopo.

## Conseguenze

- Il primo uso di uno strumento caricato al bisogno costa un passaggio in più: Claude lo cerca, poi lo usa.
- Con un modello locale Claude Code prova a caricare al bisogno anche lì; se il server del modello non lo regge, se ne vedrà l'errore e andrà deciso altro.
- L'errore di grammatica di llama-server con Qwen nella Home («failed to parse grammar») non è stato riprodotto qui: con gli strumenti delle estensioni fuori dal contesto iniziale i loro schemi non arrivano più al server finché non servono, ed è la causa più probabile.
