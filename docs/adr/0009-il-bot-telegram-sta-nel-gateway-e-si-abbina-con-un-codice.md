---
status: accepted
---

# Il bot Telegram sta nel gateway, con il token fuori dal vault, e si abbina al proprietario con un codice

Il bot Telegram lo tiene il gateway: è lui a parlare con Telegram, a chiedergli i messaggi nuovi e a mandare le risposte. Il token del bot lo scrive il proprietario nella pagina del vault, dopo la frase, e resta in un file che legge solo il gateway, fuori dal vault cifrato: così il bot funziona anche a vault chiuso, e le conversazioni di Claude non possono leggerlo. Per sapere chi è il proprietario, la pagina mostra un codice che vale pochi minuti: chi lo manda al bot diventa l'unico account che il bot ascolta, in chat privata. Il centro riceve dal gateway soltanto ciò che il proprietario ha scritto e i pulsanti che ha premuto, e gli chiede di mandare messaggi: la chat di destinazione la decide sempre il gateway. Le tre scelte le ha fatte il proprietario il 12 novembre 2026.

## Considered Options

- **Token in una variabile d'ambiente del centro.** Il modo più semplice. Scartata: la regola 5 della specifica vieta segreti in file che le conversazioni possono leggere, e le conversazioni girano nel container del centro. Chi ha il token può leggere i messaggi del proprietario e scrivergli fingendosi Shinka.
- **Token dentro il vault cifrato.** Protetto dalla frase. Scartata dal proprietario: a ogni riavvio del gateway il vault è chiuso, e Telegram tacerebbe finché lui non scrive la frase, proprio quando serve per accorgersi che qualcosa aspetta.
- **Identificativo del proprietario scritto a mano.** Il proprietario cerca il proprio numero su Telegram e lo scrive nella pagina. Scartata dal proprietario: va cercato con un altro bot, e un numero sbagliato consegna Shinka a qualcun altro. Con il codice l'identificativo lo legge il gateway dal messaggio.
- **Il primo che scrive al bot diventa il proprietario.** Nessun passaggio in più. Scartata: il nome di un bot si può trovare, e chi arriva prima prenderebbe la Home.
- **Indirizzo a cui Telegram consegna i messaggi (webhook).** Scartata: Shinka non è raggiungibile da Internet, e non deve esserlo. Il gateway chiede lui i messaggi nuovi e resta in attesa della risposta.
- **Approvazioni solo dall'interfaccia.** Da Telegram arriverebbe l'avviso, e la decisione si prenderebbe aprendo Shinka. Scartata dal proprietario: vuole approvare con un pulsante sia i comandi sugli host sia i permessi che Claude chiede nella Home e nei progetti.

## Consequences

- Un mittente diverso dal proprietario non riceve risposta e non arriva al centro: messaggi, pulsanti, gruppi e canali vengono scartati dal gateway, che ne tiene solo il conto. Finché il bot non è abbinato non ascolta nessuno.
- Il codice di abbinamento ha sei cifre, vale dieci minuti e sopporta cinque tentativi sbagliati. Sostituire il token con quello di un altro bot scioglie l'abbinamento.
- Il centro non può scegliere a chi scrivere, né leggere o cambiare token e proprietario: le sue richieste al gateway non portano una chat, e quelle sulla configurazione vogliono la frase del vault.
- I messaggi del proprietario passano dai server di Telegram, e così le risposte della Home, le notifiche con il resoconto dei progetti e i comandi da approvare. Il valore di una credenziale non ci passa, perché non entra mai in una conversazione.
- La decisione presa con un pulsante arriva al centro, che la applica come quella presa dall'interfaccia: il limite già scritto nell'ADR 0008 resta, perché a dire al gateway che il proprietario ha approvato un comando è sempre il centro. Chi prendesse il controllo del centro potrebbe anche scrivere al proprietario fingendo una richiesta.
- Su Telegram arriva solo ciò che sta per intero in un messaggio: un comando o un'azione più lunghi arrivano senza pulsanti, e si decidono dall'interfaccia, dove si leggono per intero.
- Se il centro non chiede messaggi al gateway da più di un minuto e mezzo, il bot risponde al proprietario che Shinka non risponde e non tiene il messaggio. Ciò che il proprietario ha scritto e il centro non ha ancora letto si perde se il gateway si riavvia.
- Il token sta in chiaro nel file `telegram.json` tra i dati del gateway, con i permessi del solo utente del gateway: chi è amministratore del server lo può leggere, come può leggere tutto il resto.
