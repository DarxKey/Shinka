---
status: accepted
---

# Un secondo motore, Codex, scelto per installazione

Il 18 novembre 2026 il proprietario ha chiesto un motore Codex completo, che sostituisca Claude in una nuova installazione di Shinka da tenere al lavoro, con il suo abbonamento ChatGPT personale (Plus o Pro), su un server Linux con Docker. Ha chiesto di cambiare la specifica, che escludeva harness diversi da Claude Code e i sistemi del datore di lavoro.

## Decisioni

- **Un motore per installazione, non per conversazione.** Una variabile d'ambiente sceglie Claude Code o Codex; tutte le conversazioni dell'installazione lo usano. Il codice resta uno: la stessa versione va in tutte e due le installazioni. Mescolare i motori nella stessa installazione resta fuori perimetro.
- **Codex attraverso il suo app-server ufficiale**, con l'accesso "Sign in with ChatGPT" fatto in ogni ambiente con `codex login`. È l'interfaccia che OpenAI usa per le sue estensioni degli editor: conversazioni che si riprendono, turni con le loro voci in tempo reale, richieste di approvazione, domande al proprietario, ramo e riavvolgimento, limiti del piano. Niente API key, niente indirizzi non ufficiali.
- **Il motore Codex è un'altra implementazione della porta della conversazione.** Centro, interfaccia, Home, argomenti, memoria, skill, vault e gateway non cambiano: cambia ciò che sta dietro la porta, nel nodo. Gli eventi di Codex si traducono negli stessi eventi di Shinka.
- **Gli strumenti di Shinka arrivano a Codex come strumenti dinamici** dell'app-server, eseguiti da Shinka nello stesso processo, come oggi con il server MCP interno del Claude Agent SDK. Sono una funzione sperimentale: la versione di Codex è fissata nelle dipendenze, e una prova sull'app-server vero va rifatta a ogni cambio.
- **I quattro modi dei permessi restano**, ricondotti a politica di approvazione e sandbox di Codex: chiedi sempre (ogni comando e ogni modifica chiedono), modifiche libere (le modifiche nella cartella no, i comandi sì), automatico (chiede solo ciò che esce dal sandbox), senza permessi (nessuna richiesta, nessun sandbox). I divieti fissi e il gateway valgono come prima.
- **Ciò che Codex non offre si vede come non disponibile.** Non si finge una funzione con un'altra.
- **L'installazione al lavoro è personale.** Un solo proprietario, il suo vault, le sue approvazioni. I sistemi dell'azienda si toccano solo con le credenziali che lui mette nel vault; le regole dell'azienda le verifica lui.

## Consequences

- Il piano di lavoro è in [docs/motore-codex.md](../motore-codex.md): tre incrementi, dal progetto al lavoro alla Home, poi alle funzioni della chat.
- Le funzioni costruite sul Claude Agent SDK vanno rifatte una per una con l'app-server; finché non lo sono, nell'installazione con Codex mancano.
- Due motori vanno tenuti allineati: ogni pezzo nuovo dice che cosa vale con l'uno e con l'altro.
