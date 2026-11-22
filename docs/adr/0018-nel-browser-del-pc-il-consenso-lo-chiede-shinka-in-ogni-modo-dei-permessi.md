---
status: accepted
---

# Nel browser del PC il consenso lo chiede Shinka, in ogni modo dei permessi

Dal 12 novembre 2026 un progetto su Windows può usare il browser del PC attraverso l'estensione di Claude ([ADR 0006](0006-il-browser-sta-nel-gateway-e-la-password-la-scrive-lui.md)). Lì gli strumenti sono dell'estensione: Shinka non vede che cosa viene cliccato e non può far valere i divieti fissi come nel browser del gateway. L'unico controllo è che ogni azione passi dal proprietario. Per questo il browser del PC c'era solo nei modi "Chiedi sempre" e "Modifiche libere": in "Automatico" e "Senza permessi" l'harness non chiede nulla, e il browser restava spento.

Il 15 novembre 2026 il proprietario ha chiesto che tutto funzioni anche senza permessi, browser del PC compreso, e ha scelto: acceso in tutti i modi, con il consenso sempre e solo per lui. La regola "ogni azione passa dal proprietario" resta com'era; cambia chi la fa valere.

## Decisioni

- **Il consenso lo chiede un controllo di Shinka, non l'harness.** Prima di ogni strumento dell'estensione (`mcp__claude-in-chrome__*`) gira un controllo nostro (un hook `PreToolUse`). È lui a mostrare al proprietario la scheda di consenso, la stessa di sempre, e ad aspettare; poi risponde all'harness "consenti" o "nega". Non risponde mai "chiedi": non lascia la decisione all'harness, in nessun modo dei permessi.
- **Una strada sola per i quattro modi.** Anche in "Chiedi sempre" e "Modifiche libere" la scheda nasce dal controllo. Così ciò che si prova in un modo vale negli altri, e non c'è un ramo che esiste solo dove è più pericoloso.
- **Chiuso per difetto.** Se il controllo non ha modo di chiedere, nega. Se si rompe, l'harness blocca lo strumento (`onFailure: "block"`). Se il proprietario non risponde entro dodici ore l'harness annulla il controllo, la scheda si chiude e l'azione non parte.
- **Il cambio di modo non aspetta più.** Prima un passaggio a "Automatico" a metà turno aspettava la fine del turno, per non lasciare acceso un browser senza consenso. Ora il consenso non dipende dal modo, e il cambio vale subito.

Verificato sull'harness vero il 15 novembre 2026, con l'SDK 0.3.322: in `bypassPermissions` e in `auto` un controllo `PreToolUse` gira, lo strumento aspetta la sua risposta, non parte se nega e parte se consente; un'attesa oltre il tempo concesso blocca lo strumento; un'attesa di 75 secondi sotto un tempo di dodici ore viene rispettata.

## Considered Options

- **Lasciare il browser del PC spento nei due modi.** Era la scelta di prima; scartata dal proprietario, che vuole poter lavorare senza permessi anche nei progetti che usano il browser.
- **Un controllo che risponde "chiedi" e lascia la domanda all'harness.** Era il meccanismo di prima. Nella prova la domanda arriva al proprietario anche in "Senza permessi" e in "Automatico", ma l'SDK avverte che in quei modi non è garantito. Scartata: la regola non può poggiare su un comportamento che la documentazione dà per non garantito.
- **"Senza permessi" fatto da Shinka.** L'harness resterebbe sempre in un modo che chiede, e Shinka approverebbe da sé tutto tranne il browser. Scartata: cambia ogni conversazione per servire un caso solo, e "Automatico" non si può rifare da fuori.
- **Nessun consenso in "Senza permessi", come per il resto.** Scartata: lì i divieti fissi poggerebbero solo sulle istruzioni, nel browser vero del proprietario, già dentro i suoi siti.

## Consequences

- In "Senza permessi" un lavoro nel browser del PC si ferma comunque a ogni azione, anche a leggere una pagina. È voluto; le istruzioni lo dicono a Claude, e gli chiedono di non cercare un'altra strada quando un'azione viene negata.
- La regola poggia sul fatto che l'harness rispetti i controlli in ogni modo dei permessi. Le prove `src/prove/consenso-negli-altri-modi.ts` e `src/prove/consenso-del-browser.ts` lo verificano sull'harness vero, e vanno rifatte a ogni cambio di SDK.
- I divieti fissi nel browser del PC restano affidati alle istruzioni e all'occhio del proprietario su ogni scheda: Shinka non riconosce da sé un pagamento dentro una pagina.
- Una scheda rimasta senza risposta si chiude dopo dodici ore. Fino ad allora la conversazione resta ferma su quell'azione.
- Le prove dal vivo usano un campanello al posto degli strumenti dell'estensione. Con l'estensione vera, in "Automatico" e "Senza permessi", la prova è del proprietario.
