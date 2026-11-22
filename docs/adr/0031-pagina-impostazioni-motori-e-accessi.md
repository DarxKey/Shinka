---
status: accepted
---

# La pagina Impostazioni, prima parte: motori e accessi

Il 20 novembre 2026 il proprietario ha scelto come fare la pagina Impostazioni dell'[ADR 0030](0030-il-motore-si-sceglie-per-conversazione.md): in due parti, prima i motori e gli accessi, poi l'ambiente del centro, la password, gli indirizzi e l'HTTPS. Gli accessi si fanno dalla pagina per tutti gli ambienti, non solo per quello del centro. Per Claude va bene incollare in Shinka il codice che il sito dà dopo l'accesso.

## Decisioni

- **Il motore predefinito si sceglie nella pagina** e sta in `impostazioni.json` tra i dati del centro. La variabile `SHINKA_MOTORE` resta il valore di partenza. Il predefinito è del centro, e il centro lo manda al nodo quando apre una conversazione (`motorePredefinito` in `apri-conversazione`).
- **Il predefinito vale per le conversazioni che non hanno ancora lavorato.** Una conversazione già cominciata, senza un motore scelto, resta con quello che ha lavorato per ultimo. Cambiare il predefinito non fa passare a un altro motore gli argomenti e i progetti in corso.
- **Ogni ambiente ha i suoi accessi.** Il centro chiede al nodo (`accessi` e `accessi-esito`) lo stato, l'inizio di un accesso, il codice, l'annullamento o l'uscita; l'ambiente del centro risponde da sé. Le credenziali restano dove le tiene ciascun programma, e Shinka non le legge.
- **Codex**: l'accesso a codice dell'app-server (`account/login/start` con `chatgptDeviceCode`). Shinka mostra l'indirizzo e il codice da scrivere sul sito di OpenAI, e l'app-server si accorge da sé che l'accesso è fatto.
- **Claude**: `claude auth login` del programma che usa il Claude Agent SDK. Shinka mostra l'indirizzo; il proprietario incolla il codice che il sito gli dà dopo l'accesso, e Shinka lo scrive al programma senza conservarlo né scriverlo nei log.
- Dopo un accesso o un'uscita, l'ambiente rilegge i modelli dei motori, e il menu del modello si aggiorna.

## Seconda parte (20 novembre 2026)

- **L'ambiente del centro**: nome e descrizione si cambiano dalla pagina e valgono subito; stanno in `impostazioni.json`, sopra `SHINKA_AMBIENTE_NOME` e `SHINKA_AMBIENTE_DESCRIZIONE`. Sistema e cartella dei progetti si vedono e non si cambiano: la cartella si sceglie all'installazione.
- **La password di Shinka** si cambia con quella attuale, con lo stesso limite ai tentativi dell'entrata. Tutte le sessioni si chiudono; il browser che l'ha cambiata ne riceve subito una nuova. Il comando `npm run imposta:password` resta, per chi l'ha dimenticata.
- **Il collegamento sicuro (HTTPS)** passa dalla pagina Vault alla pagina Impostazioni, così com'era: indirizzi del certificato, reindirizzamento, ripartenza.
- Restano variabili, da cambiare nel file Compose: porte, indirizzo di ascolto, cartelle dei dati e dei progetti, il gateway.

## Consequences

- Un nodo di una versione precedente non conosce gli accessi: la pagina lo dice, e il nodo si aggiorna come sempre.
- L'accesso a Claude con un codice dipende dal formato dei messaggi di `claude auth login`: Shinka cerca nell'uscita l'indirizzo `…/oauth/authorize…`. Se cambia, l'accesso dalla pagina smette di funzionare e lo dice.
