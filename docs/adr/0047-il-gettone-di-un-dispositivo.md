---
status: accepted
---

# Il gettone di un dispositivo

Il 23 novembre 2026 il proprietario ha confermato la seconda proposta nata dal progetto Shinka Desktop: l'app resta accesa nell'area di notifica e deve aprirsi già collegata. Con la sessione del browser ([ADR 0039](0039-registro-delle-richieste.md)) non andava: dura trenta giorni fissi, nella pagina Sicurezza comparirebbe come «node», e il cookie è fatto per una pagina, non per il processo di un'app.

## Decisioni

- **Un gettone per dispositivo, dato con la password.** `POST /api/dispositivi` con `password`, `nome` (fino a 60 caratteri) e `genere` (per ora solo `desktop`) risponde `201 { id, token }`. È una rotta libera come l'entrata, con lo stesso limite ai tentativi. Il gettone è casuale, 32 byte; si vede solo in questa risposta; sul disco, in `dispositivi.json`, resta la sua impronta, come per le sessioni.
- **Al posto del cookie.** Ogni rotta del proprietario accetta `Authorization: Bearer <gettone>`: richieste, flussi di eventi, WebSocket. Il gettone vale quanto una sessione: può tutto ciò che può il sito. Se la richiesta porta un gettone vale solo quello, anche se porta anche un cookie.
- **Vale finché viene usato.** Decade dopo novanta giorni senza uso; a ogni uso il centro annota quando, da dove e con quale versione dell'app, e lo scrive sul disco al più ogni dieci minuti, come per le sessioni.
- **Un gettone sbagliato non frena la password.** Risponde 401 e finisce nel registro come «gettone che non vale», ma non conta tra i tentativi falliti dell'entrata: un'app tolta che riprova non deve chiudere fuori il browser.
- **WebSocket senza origine, solo con il gettone.** Il centro rifiuta un WebSocket che non dice l'origine o ne dice un'altra, perché il cookie viaggia da solo anche da altre pagine. Il gettone no, e un browser non lo può aggiungere a un WebSocket: con un gettone che vale l'origine assente è ammessa; un'origine di un altro sito resta rifiutata.
- **Cambiare la password toglie tutti i dispositivi**, come chiude tutte le sessioni: chi la cambia può temere che qualcuno la conosca. «Chiudi tutte le altre» chiude invece solo le sessioni dei browser: i dispositivi si tolgono uno per uno.
- **Nella pagina Sicurezza**, una sezione Dispositivi accanto alle sessioni: nome, genere, app con la versione, quando è stato aggiunto e da dove, ultimo uso, e «Togli» con una conferma (`POST /api/sicurezza/dispositivi/:id/chiusura`). L'app esce da sé con `POST /api/dispositivi/chiusura` e il suo gettone.
- **Il nome dell'app.** Chi si presenta con `User-Agent: ShinkaDesktop/<versione>` compare nel registro e tra i dispositivi come «Shinka Desktop <versione>».

## Conseguenze

- Chi legge il disco del centro non trova gettoni da usare; chi ha in mano il gettone di un'app è dentro Shinka finché il proprietario non toglie quel dispositivo o cambia la password.
- L'anteprima delle applicazioni, sulla sua porta, continua ad accettare solo il cookie del browser.
- Niente secondo fattore, permessi ridotti o più utenti: non sono stati chiesti.
