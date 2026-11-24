---
status: accepted
---

# Un fork che si aggiorna dall'originale

Il 24 novembre 2026, nel decimo gruppo del suo elenco, il proprietario ha chiesto che un'altra installazione di Shinka (al lavoro, o di un amico) riceva le versioni nuove da questa. Le modifiche devono viaggiare solo dall'originale verso l'altra: ciò che l'altra sviluppa resta lì, e gli aggiornamenti si fondono con le sue modifiche.

Ha scelto:
- le versioni vengono dalla copia pubblica su GitHub;
- le porta il progetto Shinka dell'altra installazione;
- l'altra si installa con uno script che parte da GitHub.

Fino a qui un'installazione nuova nasceva da un pacchetto (ADR 0032): senza storia Git, senza guardiano e senza sviluppo, e si aggiornava solo con un pacchetto nuovo.

## Decisioni

- **Un fork è un clone della copia pubblica** (ADR 0044), con la sua storia. Per questo le versioni dell'originale vi si fondono con Git come quelle di qualunque ramo: la copia pubblica ha un commit per ogni versione installata qui, e non contiene i dati del proprietario.
- **L'installazione**, con una riga sul server nuovo: `curl -fsSL https://raw.githubusercontent.com/DarxKey/Shinka/main/installazione/fork/installa.sh | bash`. Lo script scarica i file di `installazione/fork`, prepara `.env` (indirizzo, gettone tra centro e gateway, `SHINKA_ORIGINALE`), costruisce due immagini e le avvia.
  - Le immagini hanno solo Node, Git e ciò che serve a Chromium: il codice sta nei volumi, perché cambia.
  - Al primo avvio `prepara-centro.sh` prende il repository con la storia (`git clone --bare`), ne prepara la versione in funzione (dipendenze, interfaccia, `versione.json`) e mette il guardiano fuori di lei. Da lì il centro gira sotto il suo guardiano, con il progetto Shinka, e installa le versioni come qui.
  - `prepara-gateway.sh` fa lo stesso per la parte del gateway (`disponi:gateway`), sotto il guardiano del gateway: anche il gateway del fork si aggiorna con il sì dato al gateway.
  - Rilanciato, lo script ricostruisce le immagini e lascia stare volumi e versione in funzione.
- **Le versioni nuove** (`src/centro/originale.ts`): con `SHINKA_ORIGINALE` il centro guarda l'originale poco dopo l'avvio e poi ogni sei ore. Prende la sua cima in `refs/originale/main` del repository e conta i commit che il ramo `main` non ha. Se ce ne sono di nuovi, la Home lo propone con la scheda di uno sviluppo di Shinka, una volta per cima. Con il sì del proprietario il progetto Shinka segue le istruzioni della richiesta:
  1. `git fetch` dall'originale e `git merge`;
  2. i conflitti, risolti tenendo le modifiche locali;
  3. la suite intera;
  4. l'installazione, con la scheda di sempre.

  Nulla entra da solo, e nulla torna verso l'originale.
- **Nelle Impostazioni:**
  - nell'originale, il comando per installare un fork, accanto al pacchetto di prima;
  - in un fork, la sezione «Aggiornamenti dall'originale», con quante versioni mancano, i loro titoli, l'ultimo controllo e «Controlla adesso».

## Conseguenze

- Il fork ha la sua storia, e il suo `main` si allontana da quello dell'originale con le sue modifiche: la fusione la fa Claude nel progetto Shinka, con le prove di sempre. Un conflitto che non sa risolvere lo chiede al proprietario del fork.
- La copia pubblica non ha `STATO.md`: il progetto Shinka di un fork lo scrive da sé.
- Le versioni arrivano solo quando l'originale le pubblica, cioè dopo ogni installazione qui, se la pubblicazione è riuscita (ADR 0044).
- Il pacchetto di prima resta, per un'installazione che non si sviluppa.
- Lo script e le immagini non sono provati qui con Docker: lo sono gli script di preparazione, su un originale locale, e il controllo delle versioni nuove, con repository veri.
