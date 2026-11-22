---
status: accepted
---

# Un nodo per ambiente, che si collega al centro

I progetti vivono in ambienti diversi (il container su Unraid, il PC Windows per Unity e Blender), e in ognuno gira un nodo: un nostro servizio che apre lì le conversazioni di Claude Code e si collega al centro. Abbiamo scelto questo invece di far lanciare al centro le conversazioni sulle altre macchine via SSH, perché su Windows solo un servizio avviato nella sessione del proprietario può aprire finestre sul suo schermo, e perché i nodi che si collegano da soli dicono al centro quali ambienti sono attivi.

## Considered Options

- **Conversazioni lanciate dal centro via SSH.** Nessun servizio nostro sulle macchine, solo Claude Code e un server SSH. Scartata: un comando arrivato via SSH su Windows non può aprire finestre, ogni macchina dovrebbe accettare connessioni in ingresso, e il centro dovrebbe custodire un accesso a ciascuna.
- **Un solo ambiente Linux, con Windows comandato a distanza.** Era l'idea iniziale. Scartata quando il proprietario ha chiarito che vuole scegliere dove vive ogni progetto.

## Consequences

- Ogni ambiente ha il proprio login di Claude e deve essere acceso mentre si lavora ai suoi progetti.
- Il centro deve conservare stato e storia dei progetti, perché la Home sappia rispondere anche quando un ambiente è spento.
- Lo stesso programma deve girare su Linux e su Windows.
