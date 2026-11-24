# Il motore Codex: piano di lavoro

Deciso il 18 novembre 2026 ([ADR 0029](adr/0029-un-secondo-motore-codex-scelto-per-installazione.md)). Riferimento: l'app-server di Codex 0.170.0, protocollo v2, i cui tipi si generano con `codex app-server generate-ts --experimental`.

## Come si collega

- Il nodo (e il centro, per l'ambiente del centro) avvia `codex app-server`, che parla JSON a righe su stdin e stdout: richieste con `id`, risposte, notifiche e richieste del server. All'avvio `initialize` con `experimentalApi`.
- Una conversazione di Shinka è un *thread* di Codex: `thread/start` la prima volta, `thread/resume` dopo, con l'identificativo che oggi è quello della sessione dell'harness.
- Un messaggio è un *turno*: `turn/start` con il testo e le immagini; `turn/steer` per un messaggio a turno in corso; `turn/interrupt` per fermarlo.

## Che cosa corrisponde a che cosa

| Shinka | Codex app-server |
|---|---|
| testo della risposta | `item/agentMessage/delta`, `item/completed` di tipo `agentMessage` |
| ragionamento riassunto | `item/reasoning/summaryTextDelta` |
| azioni (comandi, file, ricerche, strumenti) | voci `commandExecution`, `fileChange`, `webSearch`, `mcpToolCall`, `dynamicToolCall` |
| richiesta di permesso | `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/permissions/requestApproval` |
| domande al proprietario | `item/tool/requestUserInput` |
| strumenti di Shinka | `dynamicTools` in `thread/start` e richiesta `item/tool/call` (sperimentale) |
| estensioni MCP | `mcp_servers` nella configurazione del thread |
| fine del turno, token | `turn/completed`, `thread/tokenUsage/updated` |
| limiti del piano | `account/rateLimits/read` e `account/rateLimits/updated` |
| modelli ed effort | `model/list`, `model` ed `effort` di `turn/start` |
| cose da fare | `turn/plan/updated` |
| pannello Modifiche | `turn/diff/updated` e le voci `fileChange` |
| modifica e rigenera | `thread/revert` |
| ramo nella Home | `thread/fork` |
| compattare | `thread/compact/start` |
| attività, agenti | voci `collabAgentToolCall`, `subAgentActivity` |
| stile delle risposte | `developerInstructions` |
| skill di Shinka | `skills/extraRoots/set` (le skill di Codex hanno lo stesso formato `SKILL.md`) |

Restano senza corrispondenza, all'inizio: la domanda a parte (si può fare con un thread `ephemeral` biforcato), il browser del PC (è un'estensione di Claude), i plugin di Claude Code.

## Incrementi

1. **Fatto il 18 novembre 2026.** **Un progetto lavora con Codex.** Scelta del motore per installazione; client dell'app-server; la porta della conversazione Codex con testo, ragionamento, azioni, permessi nei quattro modi, interruzione, ripresa, token, limiti, modelli ed effort. Le prove con un app-server finto e con quello vero.
2. **Fatto il 18 novembre 2026.** **La Home lavora con Codex.** Gli strumenti di Shinka come strumenti dinamici, memoria e skill, estensioni MCP, domande al proprietario. Il deploy di prova su un server Linux con Docker, con `codex login` nell'ambiente del centro.
3. **Fatto il 21 novembre 2026.** **La chat completa.** Modifica e rigenera, ramo, compattazione, cose da fare, pannello Modifiche, attività, stile, domanda a parte; ciò che manca si vede come non disponibile.

Dopo l'[ADR 0030](adr/0030-il-motore-si-sceglie-per-conversazione.md) (motore per conversazione):

4. **Fatto il 20 novembre 2026.** **Il motore per conversazione.** Nella scelta del modello i modelli di Claude e di Codex; il cambio di motore con il riassunto; un identificativo per motore in ogni conversazione.
5. **Fatto il 20 novembre 2026, in due parti ([ADR 0031](adr/0031-pagina-impostazioni-motori-e-accessi.md)).** **La pagina Impostazioni.** Motori e accessi (con l'accesso a codice dal browser), ambiente del centro, password di Shinka, indirizzi e HTTPS, in un file tra i dati.
6. **Fatto il 20 e il 21 novembre 2026 ([ADR 0032](adr/0032-installazione-da-zero-con-un-pacchetto.md), [ADR 0033](adr/0033-un-ambiente-nuovo-con-un-comando-di-una-riga.md)): pacchetto, Compose, primo avvio guidato e il comando di una riga per gli ambienti.** **Installare da zero.** Il file Compose con centro e gateway, il primo avvio guidato nel browser, gli script per preparare un ambiente Linux e uno Windows.

## Che cosa si è imparato

- Il sandbox di Codex in un container senza namespace utente non parte (`bwrap: No permissions to create a new namespace`): ogni comando fallisce e poi chiede di uscire dal sandbox. Shinka non lo usa (`danger-full-access`), come non aggiunge confinamento a Claude Code, e fa chiedere con la politica di approvazione: `untrusted` per chiedi sempre e modifiche libere (dove le modifiche dentro la cartella le approva Shinka), `on-request` per automatico, `never` per senza permessi.
- I comandi arrivano avvolti nella shell (`/bin/bash -lc '…'`): Shinka li mostra senza.
- I limiti del piano arrivano in due finestre, una di cinque ore e una settimanale, come quelle di Claude.
- Gli strumenti dinamici si danno solo a `thread/start`, e Codex li tiene con il thread: dopo una ripresa ci sono ancora (provato), ma sono quelli con cui è nato. `thread/resume`, `thread/fork` e `thread/settings/update` non li accettano (schema dell'app-server 0.170, anche sperimentale). Codex li scrive nella prima riga del file della sessione (`session_meta`, `dynamic_tools`), il cui percorso dice `thread/read`. Se alla ripresa nomi o schemi non sono più quelli di Shinka, la conversazione continua in un thread nuovo, con gli ultimi scambi messi nella sua storia con `thread/inject_items` (ADR 0061).
- Un thread nato con un nome di modello di Claude lo tiene anche dopo: con Codex Shinka chiede sempre un modello di Codex, il predefinito se quello scelto è di Claude.
- Le sessioni dei due motori non si passano nulla: al cambio Shinka legge la storia del motore di prima (i file della sessione di Claude Code, `thread/read` di Codex) e la consegna al nuovo come nota prima del messaggio, solo il testo scritto e solo gli ultimi scambi. Provato con i motori veri (`node src/prove/cambio-di-motore.ts`): una parola detta a Claude, Codex la sa.
- I modelli dell'altro motore si leggono senza aprire una conversazione: una sessione dell'SDK senza messaggi (`accountInfo`, `supportedModels`) e un app-server con `account/read` e `model/list`. Un motore senza accesso non compare nel menu.
- Il sandbox spento ha un prezzo: con `untrusted` Codex chiede anche i comandi di sola lettura che non riconosce come sicuri (un `rg` composto con `ls`).
- L'app-server cambia i file senza aspettare il client: la notifica di una modifica arriva quando il file può già essere cambiato. La versione di prima Shinka la ricostruisce a fine turno dal diff del turno (`turn/diff/updated`, formato git, dalla prima volta che il turno ha toccato il file), togliendolo al contrario dal file com'è; se non torna, quel file non si tiene. I percorsi del diff sono relativi: si abbinano ai percorsi assoluti delle voci `fileChange`.
- `thread/revert` toglie dalla storia un turno e quelli dopo, ma non tocca i file: con «riporta anche i file» li riporta Shinka, con le versioni del pannello Modifiche, dal turno più recente. Ciò che ha cambiato un comando resta com'è.
- Ogni messaggio del proprietario porta il suo identificativo (`clientUserMessageId`), che Codex conserva nella voce `userMessage` come `clientId`: così Shinka trova il turno da cui ripartire. Un messaggio arrivato a turno in corso non apre un turno, e da lì non si riparte.
- Un ramo (`thread/fork` con `beforeTurnId`) tiene gli strumenti dinamici del thread di partenza (provato). La domanda a parte è un `thread/fork` effimero in un app-server apposta, con i comandi in sola lettura e le richieste negate.
- Lo stesso app-server manda le notifiche di tutti i thread che ha caricati: la conversazione guarda solo quelle del suo.
- Le attività in sfondo di Claude (comandi e agenti che continuano dopo il turno) non hanno un corrispettivo: con Codex la pagina lo dice.
