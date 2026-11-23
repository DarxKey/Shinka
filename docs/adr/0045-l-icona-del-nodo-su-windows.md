---
status: accepted
---

# L'icona del nodo su Windows

Il 23 novembre 2026 il proprietario ha chiesto che i nodi Windows abbiano un'icona nell'area di notifica: che mostri che il nodo è in esecuzione e permetta di fermarlo o riavviarlo. Fino a qui il nodo partiva nascosto a ogni accesso a Windows ([ADR 0033](0033-un-ambiente-nuovo-con-un-comando-di-una-riga.md)) e non si vedeva: per sapere com'era si apriva la pagina Ambienti o `nodo.log`, e per fermarlo serviva il Gestione attività.

## Decisioni

- **Uno script di Windows PowerShell 5.1, con Windows Forms** (`src/guardiano/icona-windows.ps1`). Ci sono su ogni Windows 10 e 11: niente programmi da installare, niente moduli nativi da compilare, niente eseguibili da firmare. Un'applicazione scritta in Node avrebbe avuto bisogno di un modulo nativo per l'area di notifica.
- **Sta accanto al guardiano**, in `guardiano\` del pacchetto del nodo, fuori dalla versione in funzione: un aggiornamento del nodo non la tocca, e lei non va fermata per scambiare le cartelle. Si aggiorna come il guardiano, rilanciando il comando della pagina Ambienti.
- **A ogni accesso a Windows parte l'icona, e l'icona avvia il nodo** se non è già acceso: il collegamento nella cartella Esecuzione automatica punta a lei. Avvia il nodo prima di caricare la grafica, così il nodo parte anche dove l'icona non si può mostrare. Lo script di preparazione avvia comunque il nodo da sé, poi l'icona.
- **Lo stato lo scrive il nodo** in `dati-nodo\stato-del-collegamento.json`, a ogni cambio, con il numero del suo processo. L'icona non parla con il nodo né con il centro: legge il file, e guarda se il guardiano e il nodo sono accesi. Un file scritto da un nodo che non c'è più non vale.
- **Il pallino**: verde collegato, giallo si avvia, si collega o aspetta il consenso, rosso un problema (centro non raggiungibile, certificato diverso, rifiutato), grigio fermo. Un avviso di Windows solo per ciò che chiede di fare qualcosa (approvare il nodo, con il codice) o che non ci si aspetta (rifiutato, fermato senza che lo si chiedesse dall'icona).
- **Il menu**: lo stato in parole, Apri Shinka (anche con il doppio clic), Riavvia il nodo, Ferma o Avvia il nodo, Apri il registro, Apri la cartella del nodo. Non c'è «Esci»: l'icona c'è finché c'è la sessione di Windows, e dice anche quando il nodo è fermo.
- **Fermare ferma tutto ciò che il nodo ha avviato** (`taskkill /T /F` sul guardiano), come già fa lo script di preparazione: terminali, anteprime, conversazioni aperte. Su Windows un processo nascosto non riceve una richiesta di chiudersi.
- **Il guardiano si riconosce dal percorso intero** di `avvio-nodo.ts`, che `avvia-nodo.ps1` ora passa a Node; quelli avviati prima, con il percorso relativo, valgono lo stesso.
- **Una sola icona per cartella del nodo**, con un mutex che ha nel nome l'impronta della cartella.
- **Il file è in UTF-8 con il BOM**: senza, Windows PowerShell 5.1 legge male le lettere accentate. Lo controlla una prova.

## Conseguenze

- I nodi Windows già preparati hanno l'icona solo dopo aver rilanciato il comando della pagina Ambienti: identità e dati restano, e il nodo rientra senza una nuova approvazione.
- I nodi Linux non cambiano, se non per il file di stato che il nodo scrive tra i suoi dati.
- L'icona vera non è provata in questo ambiente, che non ha Windows: lo sono la sintassi dei due script e le funzioni che leggono lo stato e decidono che cosa mostrare, con PowerShell per Linux quando c'è (`SHINKA_PWSH`).
