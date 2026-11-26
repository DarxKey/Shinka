---
status: accepted
---

# La lista delle cose da fare e i disegni nelle risposte

Il 26 novembre 2026 il proprietario ha notato che due cose dell'interfaccia non comparivano mai: la lista da spuntare delle cose che Claude sta facendo e i grafici. Ha portato come riferimento una risposta di ChatGPT che spiega un bilancio con un riquadro di cifre e un disegno di chi dà soldi a chi. Ha scelto:
- i diagrammi Mermaid curati, insieme a un blocco nostro per i riquadri di cifre;
- su Telegram, i disegni come immagini.

## Che cosa succedeva

- **La lista.** L'interfaccia disegnava la scheda delle cose da fare dallo strumento TodoWrite. Claude Code 2.1 lo ha sostituito con quattro strumenti, TaskCreate, TaskUpdate, TaskList e TaskGet, che dà solo con la variabile `CLAUDE_CODE_ENABLE_TODO_TOOLS`. Senza, Claude non aveva nessuno strumento per la lista: nei registri delle conversazioni non ce n'è traccia.
- **I grafici.** L'interfaccia disegnava già i blocchi `mermaid`, ma nessuna istruzione diceva alla Home o ai progetti di usarli. Il disegno aveva l'aspetto di un blocco di codice, e con Mermaid 12 le frecce andavano a gomito.

## Decisioni

- **La lista torna.** Le conversazioni di Claude partono con `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, e i quattro strumenti non chiedono il consenso: toccano solo la lista.
  - L'interfaccia li mostra nella stessa scheda di TodoWrite, un compito per volta: TaskCreate aggiunge il compito, che prende il suo numero dal risultato («Task #n created successfully»); TaskUpdate ne cambia lo stato o lo toglie.
  - TaskList e TaskGet non si mostrano.
  - I compiti valgono per tutta la conversazione. Una lista finita del tutto non si porta nel turno dopo.
  - TodoWrite resta riconosciuto: lo usa la traduzione del piano di Codex.
- **I disegni nelle risposte** (`src/protocollo/disegni.ts`). La Home e i progetti hanno una sezione di istruzioni: quando un concetto si capisce meglio visto, lo mostrano con un disegno, non in ogni risposta.
  - Il **riquadro di cifre** è un blocco di codice `riquadro`, nostro: «# titolo», righe «voce | valore | nota», e «>» per una spiegazione sotto. Un valore con «+» è verde, con «−» rosso. È pensato per bilanci, totali e conti.
  - Per flussi, sequenze, date, torte e barre si usa **Mermaid**.
  - Chi svolge un incarico non ha queste istruzioni: riporta a chi guida, non al proprietario.
- **L'aspetto.**
  - I diagrammi sono riquadri arrotondati senza testata, con i colori di Shinka letti dalle sue variabili. Usano l'aspetto classico di Mermaid e la disposizione dagre, con frecce curve: quella predefinita di Mermaid 12, ELK, le fa a gomito e ignora la curva.
  - Con il tema automatico un diagramma si ridisegna quando il sistema passa dal chiaro allo scuro.
  - Le tabelle diventano riquadri arrotondati.
- **Telegram, per ora.** Lì i disegni non si vedono: la Home, rispondendo da Telegram, non li usa. Le immagini per Telegram vengono con un pezzo a sé, perché il centro oggi non ha un modo di disegnare un diagramma Mermaid in un'immagine.

## Considered Options

- **Solo istruzioni e Mermaid.** Mermaid non ha un riquadro di cifre con i colori del segno: il bilancio dell'esempio sarebbe stato una tabella.
- **Solo blocchi nostri.** Avremmo rifatto ciò che Mermaid sa già fare: flussi, sequenze, grafici.
- **Ricostruire la lista dalla lettura di TaskList.** Claude la chiama di rado; il risultato di TaskCreate e gli aggiornamenti bastano.

## Consequences

- La scheda delle cose da fare compare di nuovo nei turni in cui Claude si fa una lista, e resta in vista sopra il campo di scrittura mentre lavora.
- Un diagramma scritto da Claude con stili suoi resta com'è: le istruzioni chiedono di non metterne.
- Mermaid 12 con dagre al posto di ELK disegna flussi un po' diversi da prima: più vicini a quelli di Mermaid 11.
