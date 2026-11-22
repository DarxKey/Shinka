---
status: accepted
---

# La cura di Claude, con l'identità di Shinka

Il 17 novembre 2026 il proprietario ha chiesto di portare la chat di Shinka al livello di Claude Desktop, cominciando dall'estetica e dalla lettura (gruppo A del confronto della Home). La sua scelta di stile: Shinka resta Shinka, con la cura di Claude.

## Decisioni

- **Restano il blu e il germoglio.** Dallo stile di Claude si prendono la tipografia, il ritmo, i fumetti e le animazioni misurate, non la palette crema e terracotta.
- **Le risposte di Claude in serif, a tutta larghezza.** L'interfaccia resta in sans; le risposte usano i serif del sistema (Iowan Old Style sull'iPhone, Charter o Georgia altrove), senza caratteri scaricati. Il proprietario ha un fumetto sobrio. La colonna di lettura è larga 760 px.
- **Le librerie pesanti si caricano solo quando servono.** Il colore della sintassi (highlight.js, con i soli linguaggi utili), le formule (KaTeX) e i diagrammi (Mermaid, in modo "strict") stanno in pezzi a parte: aprire una chat senza codice, formule o diagrammi non li scarica. Il caricamento iniziale cresce di circa 10 KB. Una formula con `$...$` si riconosce solo se ha qualcosa da formula, così "costa $5" resta testo.
- **Tema e vista sono del browser.** Le scelte di aspetto restano nel browser in cui sono fatte, non al centro: sul telefono e sul PC il proprietario può volerle diverse.
- **Il ragionamento arriva riassunto.** Le conversazioni chiedono all'harness il ragionamento riassunto (`thinking: { type: "adaptive", display: "summarized" }`): senza, arriva vuoto. Si vede solo nelle viste che lo mostrano.

## Consequences

- Il pacchetto dell'interfaccia ha quattro dipendenze in più (highlight.js, katex, remark-math, rehype-katex, mermaid), tutte caricate a richiesta.
- I serif cambiano da sistema a sistema: la resa esatta dipende dal telefono o dal PC.
