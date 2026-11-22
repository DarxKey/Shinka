---
status: accepted
---

# I file della Home arrivano su Telegram dal gateway, letti dalla cartella dell'argomento

Il proprietario usa la Home da Telegram, sull'iPhone, e ha bisogno di ricevere lì i file che la Home produce: lo ha chiesto il 13 novembre 2026, dopo non aver potuto ricevere in PDF un itinerario per Tokyo. Finora su Telegram arrivava solo il testo con cui la Home chiude il turno.

Il bot sta nel gateway (ADR 0009), quindi è il gateway a mandare i file, con `sendDocument` e, per le immagini, con `sendPhoto`. Il centro legge il file dalla cartella dell'argomento, come per il pannello degli elaborati (ADR 0012), e lo passa al gateway così com'è, su una via nuova che accetta un corpo fino a 50 MB, il limite dei bot. I file partono in due casi:

- in un turno cominciato da un messaggio arrivato da Telegram, ogni file che la Home mostra con `mostra_elaborato` arriva lì dopo il testo della risposta, una volta sola e nell'ordine in cui è stato mostrato;
- con lo strumento nuovo `invia_file_telegram`, che la Home usa quando il proprietario chiede un file su Telegram scrivendo dall'interfaccia.

## Considered Options

- **Solo lo strumento dedicato.** Più semplice, ma la Home dovrebbe ricordarsi di usarlo a ogni risposta data a Telegram. Mostrare un file è già il gesto con cui la Home consegna: da Telegram vale come consegna anche lì.
- **Solo i file mostrati, senza strumento.** Non coprirebbe "mandamelo su Telegram" detto dall'interfaccia.
- **Un indirizzo da cui il telefono scarica il file.** Shinka non è raggiungibile da Internet, e non deve esserlo.
- **Le immagini due volte, come foto e come documento.** Raddoppia i messaggi. Un'immagine arriva come foto, che si vede subito nella chat; se Telegram non la accetta come foto (formato, misure, più di 10 MB) arriva come documento.

## Consequences

- **Il gateway cambia**, e da dentro Shinka non si installa: finché non viene aggiornato da fuori, il centro riceve 404 e dice al proprietario, su Telegram, che il gateway va aggiornato. La risposta scritta arriva comunque.
- **Il destinatario lo mette il gateway**, come per i messaggi: è sempre e solo il proprietario abbinato. Il centro manda nome, tipo, una riga di didascalia e il contenuto; il gateway pulisce il nome e rifiuta un file vuoto o oltre i 50 MB senza chiamare Telegram.
- **Dalla cartella dell'argomento non si esce**: il percorso passa dagli stessi controlli degli elaborati, e un file dell'ambiente del centro si legge fino a 50 MB. Da un altro ambiente il limite resta quello del nodo, 10 MB.
- Lo strumento non chiede consenso: il file va solo al proprietario, e solo da quella cartella.
- Una pagina HTML arriva come file. Sul telefono si apre, ma una mappa che carica script da internet può non funzionare dentro Telegram: le istruzioni della Home lo dicono, e le chiedono di accompagnarla con un link o con un'immagine.
- La sezione 7 della specifica dice che su Telegram arriva la risposta finale: i file sono un'aggiunta chiesta dal proprietario, da scrivere lì se lo chiede.
