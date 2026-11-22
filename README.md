# Shinka

*Multi node agent harness.*

Shinka è un'applicazione web personale con un'unica chat, la **Home**, a cui il proprietario chiede
qualunque cosa. La Home risponde, svolge da sé i lavori che si chiudono in una seduta e propone un
**progetto** per quelli lunghi. Ogni progetto vive in un **ambiente** (il server, un PC, un altro
computer) e ha la sua conversazione, il suo terminale e l'anteprima della sua applicazione. Il motore
delle conversazioni è Claude Code oppure Codex, con l'abbonamento del proprietario.

È un progetto personale, pensato per un solo proprietario su un server di casa, e si sviluppa da dentro
sé stesso: i pezzi nuovi li scrive un progetto di Shinka, e entrano in funzione solo con il sì del
proprietario.

## Dove leggere

- [shinka.md](shinka.md): la specifica. Che cos'è, le regole del dominio, l'architettura, le prove di accettazione.
- [GLOSSARY.md](GLOSSARY.md): le parole del progetto. Il codice e i documenti usano quelle.
- [docs/adr/](docs/adr/): le decisioni che pesano, una per file, con il motivo.
- [installazione/LEGGIMI.md](installazione/LEGGIMI.md): come si installa il pacchetto che un'installazione di Shinka prepara per un'altra.

Lo stato dello sviluppo (`STATO.md`, a cui la specifica rimanda) resta fuori da questa copia: racconta
anche l'installazione del proprietario.

## Com'è fatto

| Parte | Cartella | Che cosa fa |
|---|---|---|
| Centro | `src/centro` | Il server: l'interfaccia, la Home, i progetti, gli argomenti, la memoria, le skill. |
| Nodo | `src/nodo` | Gira in ogni ambiente e ci fa lavorare il motore: conversazioni, terminale, anteprima. |
| Gateway | `src/gateway` | In un container suo: custodisce il vault delle credenziali, fa rispettare i divieti fissi, tiene il bot di Telegram. |
| Guardiano | `src/guardiano` | Tiene accesi centro, nodi e gateway, e torna alla versione di prima se una nuova non parte. |
| Interfaccia | `web/src` | React, costruita con Vite. |
| Protocollo | `src/protocollo` | I messaggi tra centro, nodi e interfaccia. |

Il codice è TypeScript che Node esegue senza compilarlo. Nomi e commenti sono in italiano, con le
parole del glossario, e ogni pezzo ha il suo test accanto.

## Lavorarci

Serve Node 22.18 o più recente.

```bash
npm ci
npm run typecheck
npm test
npm run costruisci   # l'interfaccia
npm run avvia        # il centro, sulla porta 7850
```

## Questa copia

Questo repository è la copia pubblica di Shinka: la tiene aggiornata il progetto stesso, un commit per
ogni pezzo. La storia comincia dalla prima pubblicazione; quella di prima resta sul server da cui Shinka
si installa ([ADR 0044](docs/adr/0044-la-copia-pubblica-su-github.md)).

## Licenza

[MIT](LICENSE).
