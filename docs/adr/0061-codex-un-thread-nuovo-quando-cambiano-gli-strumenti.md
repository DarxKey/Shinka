---
status: accepted
---

# Codex: un thread nuovo quando cambiano gli strumenti di Shinka

Il 24 novembre 2026 il proprietario ha segnalato che in un argomento della Home passato a Codex, Codex diceva di non avere lo strumento per proporre un'estensione dell'interfaccia (`proponi_estensione_interfaccia`, ADR 0054 e 0057), che Claude nello stesso argomento aveva e usava.

## La causa

Shinka dà i suoi strumenti a Codex come strumenti dinamici, e l'app-server li accetta solo in `thread/start`. Nella versione 0.170, anche nello schema sperimentale, non li accettano:
- `thread/resume`;
- `thread/fork`;
- `thread/settings/update`.

Codex li scrive nella prima riga del file della sessione e li tiene per tutta la vita del thread: un thread nato prima di uno strumento non lo vede mai. Sui thread veri della Home si vede proprio questo:
- quelli nati prima dell'ADR 0057 hanno 45 strumenti, senza quelli dell'interfaccia;
- uno nato dopo ha `proponi_estensione_interfaccia` ma non `riferimento_estensioni_interfaccia`, aggiunto più tardi.

Lo schema dello strumento invece Codex lo accetta: con un thread nuovo la proposta mostra la scheda come con Claude.

## Decisioni

- **L'impronta degli strumenti.** Prima di riprendere un thread, Shinka chiede a Codex il percorso del file della sessione (`thread/read`). Ne legge la prima riga e confronta gli strumenti di allora con quelli di adesso: spazi, nomi e schemi, in ordine (`improntaDegliStrumenti`). Le descrizioni non contano, perché cambiarle non vale un thread nuovo. Se non si riesce a leggere, si riprende come prima.
- **Un thread nuovo con gli ultimi scambi.** Se gli strumenti sono cambiati, la conversazione continua in un thread nuovo, nato con gli strumenti di oggi.
  - Riceve gli ultimi scambi del thread di prima, come al cambio di motore (`ultimiScambi`, in comune con `notaDelPassaggio`).
  - Gli scambi entrano subito nella storia del thread nuovo con `thread/inject_items`, così non si perdono se la conversazione si chiude prima di un messaggio. Se l'app-server non lo sa fare, vanno con il primo messaggio.
  - Il proprietario lo vede da una nota in chat.
- **Vale ovunque si apra un thread.** Per la Home, le chat parallele e i progetti, in ogni ambiente. Un ramo nato da un thread vecchio eredita i suoi strumenti, ma alla prima ripresa passa anche lui da qui.

## Conseguenze

- Dopo un'installazione che aggiunge o cambia uno strumento di Shinka, le conversazioni con Codex ricominciano in un thread nuovo alla prima apertura. Non hanno più la storia intera del thread di prima, ma solo gli ultimi scambi, fino a circa 24.000 caratteri.
- Gli strumenti che Codex vede sono sempre quelli che vede Claude nello stesso momento.
