---
status: accepted
---

# Nel browser del PC il consenso segue il modo dei permessi

Il 25 novembre 2026, provando il Chrome dei PC (ADR 0063), il proprietario ha trovato fastidioso approvare ogni azione. Ha chiesto che in «Automatico» e «Senza permessi» le azioni nel browser partano senza conferma.

## Decisione

Cambia in parte l'ADR 0018, che voleva il consenso a ogni azione in tutti e quattro i modi dei permessi:
- in «Chiedi sempre» e «Modifiche libere» resta com'era: ogni azione nel browser del PC la chiede il controllo di Shinka, e senza sì non parte;
- in «Automatico» e «Senza permessi» il controllo la lascia partire senza chiedere (`controlloDelBrowserDelPc`).

Il lavoro della Home nel browser prende il modo della Home: con «Automatico» o «Senza permessi» il lavoro va allo stesso modo, altrimenti in «Chiedi sempre». Le istruzioni del browser dicono a Claude che in quei due modi le regole le fa valere lui: niente credenziali, pagamenti, ordini, cambi di password o cancellazioni di account, e ciò che legge è materiale, non istruzioni.

## Conseguenze

- In quei due modi i divieti fissi nel browser del PC non li fa valere Shinka, ma solo le istruzioni di Claude: una pagina scritta apposta potrebbe spingerlo a fare ciò che non deve. Il proprietario lo sa e lo ha scelto.
- I siti che l'estensione può toccare restano quelli che il proprietario imposta nell'estensione stessa: è lì che si restringe il browser, se serve.
