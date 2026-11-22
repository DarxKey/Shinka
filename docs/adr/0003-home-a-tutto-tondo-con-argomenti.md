---
status: accepted
---

# La Home lavora da sé e archivia per argomenti

La Home svolge direttamente i lavori che si chiudono in una seduta, anche quando producono file, e in ogni ambiente attivo; propone un progetto solo per i lavori lunghi e nel dubbio chiede. La sua conversazione è divisa in argomenti: al cambio di argomento archivia il precedente con titolo e riassunto e riparte con il contesto pulito, e prima di rifare qualcosa cerca in ciò che ha archiviato. Abbiamo scelto questo, l'11 novembre 2026, perché il proprietario, dopo aver provato la Home che smistava soltanto, l'ha trovata un chatbot che apre progetti: vuole un assistente a cui chiedere anche uno script, e che lo ritrovi settimane dopo senza riscriverlo.

## Considered Options

- **Home che smista soltanto.** Era la regola della versione 2.1: la Home risponde solo a ciò che non produce file e propone un progetto per tutto il resto. Scartata: ogni lavoro piccolo diventava un progetto con cartella e repository, oppure restava a metà.
- **Un'unica conversazione senza fine.** Più semplice: nessun archivio, si lascia che l'harness riassuma quando il contesto si riempie. Scartata: il riassunto perde proprio i dettagli, come il testo di uno script, che il proprietario vuole ritrovare.
- **Argomenti aperti e chiusi a mano dal proprietario.** Scartata dal proprietario: vuole che la Home se ne accorga da sola e lo dica in una riga.

## Consequences

- La Home ha molto più raggio d'azione: scrive file ed esegue comandi in ogni ambiente acceso. Che cosa può fare senza chiedere dipende dal modo dei permessi scelto per lei.
- La Home parte con un modello intermedio invece del più piccolo, e consuma più quota del piano a ogni messaggio.
- Il centro deve conservare argomenti, riassunti ed elenco dei file, e offrire una ricerca: se l'ambiente di un file è spento, la Home sa che esiste ma non può riaprirlo.
- La Home può sbagliare a riconoscere un cambio di argomento. Per questo ogni archiviazione viene segnalata e un argomento si può riaprire.
- Un argomento che cresce può diventare un progetto, portando con sé i suoi file.
