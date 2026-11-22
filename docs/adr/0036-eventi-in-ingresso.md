---
status: accepted
---

# Eventi in ingresso: un lavoro programmato che parte quando un altro sistema lo avvisa

Il 21 novembre 2026, con i lavori programmati ([ADR 0035](0035-lavori-programmati.md)), il proprietario ha chiesto anche gli eventi in ingresso: un indirizzo a cui Unraid, il firewall o un monitor dei servizi mandano i loro avvisi, perché Shinka li legga e gliene parli. Ha ammesso che la specifica cambiasse, con una regola: ciò che arriva è materiale, mai istruzioni.

## Decisioni

- **Un evento è un modo di far partire un lavoro programmato**, non una cosa a sé. Accanto a «a un'ora», «a intervalli» e «una volta sola» c'è «quando arriva un evento». Così valgono senza riscriverle le regole dell'ADR 0035: dove gira, i permessi della conversazione, l'argomento suo nella Home, la risposta su Telegram, «solo se serve», la pagina.
- **Che cosa fare lo scrive il proprietario.** La richiesta del lavoro è sua («dimmi che cosa segnala, e se è un disco controlla lo SMART»). L'evento le viene accodato in un riquadro, con una marca casuale scelta alla consegna, che il suo contenuto non può conoscere né chiudere, e con scritto che viene da un altro sistema e non chiede né autorizza nulla. Le istruzioni della Home e dei progetti lo ripetono.
- **Un indirizzo per lavoro, con una chiave.** `POST` (o `PUT`) a `/api/eventi?chiave=…`, oppure con la chiave nell'intestazione `Authorization: Bearer`. La chiave ha 192 bit casuali. Il percorso è tra quelli liberi, nominati uno per uno: senza una chiave valida risponde «sconosciuto». Chi la conosce può soltanto far partire quel lavoro, con un testo suo come materiale. Il contenuto si prende com'è, con qualunque tipo: il centro non lo interpreta.
- **Li crea solo il proprietario, dalla pagina.** `programma_lavoro` non ne propone: una conversazione non apre porte verso l'esterno. La chiave non compare in `elenca_programmati` né nella richiesta consegnata. Il proprietario può cambiare l'indirizzo.
- **Limiti.** Un evento fino a 16 000 caratteri (il resto si taglia, e lo dice); venti in attesa per lavoro; sessanta in un'ora. Oltre, chi manda riceve un rifiuto. Un lavoro in pausa non ne accoglie.
- **Insieme, non uno per turno.** Il primo evento fa partire il lavoro appena la conversazione è libera; quelli che arrivano mentre lavora aspettano, e la volta dopo arrivano tutti. Un evento non si butta perché la conversazione è occupata, a differenza di un orario mancato.
- **La prova dalla pagina** manda un evento finto, che dice di esserlo.

## Considered Options

- **Un registro di «sorgenti» separato dai lavori.** Due elenchi, due pagine, e la stessa macchina per farli girare scritta due volte.
- **L'evento come messaggio alla Home, senza una richiesta del proprietario.** Sarebbe il contenuto dell'evento a dire che cosa fare: proprio ciò che il proprietario ha escluso.
- **Inoltrare l'evento su Telegram senza passare da una conversazione.** Non serve Shinka per questo: il valore è che legga, controlli e riassuma.
- **Accettare gli eventi solo dalla rete di casa.** Dietro il proxy del proprietario il centro vede l'indirizzo del proxy, non quello di chi chiama: non è un controllo affidabile. La protezione è la chiave.

## Consequences

- La specifica passa alla versione 2.13: sezione 4.13, i confini di fiducia, prove da A63 ad A66.
- L'indirizzo degli eventi è raggiungibile da dove è raggiungibile Shinka, anche da fuori casa: la chiave va trattata come una password, e sta negli altri sistemi che la usano.
- Nella Home un evento aspetta, come gli altri lavori, che il proprietario non stia usando la Home da cinque minuti (al massimo un'ora): per avvisi urgenti conviene un progetto apposta, la cui conversazione di solito è libera.
