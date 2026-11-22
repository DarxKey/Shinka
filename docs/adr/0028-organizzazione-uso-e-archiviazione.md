---
status: accepted
---

# Organizzazione, uso e archiviazione

Il 18 novembre 2026, con il gruppo F, Shinka ha la palette dei comandi, una barra laterale da ordinare, l'eliminazione di progetti e argomenti, e le pagine Uso e Archiviazione. Le scelte del proprietario: tutte le parti; eliminando un progetto la cartella resta; i gruppi della barra si scelgono dalla barra.

## Decisioni

- **Fissare e rinominare stanno al centro**, nel registro dei progetti: valgono su ogni dispositivo. **Il modo dei gruppi sta nel browser**, come tema e vista.
- **Eliminare un progetto lo toglie da Shinka**: si chiudono conversazione, terminale, applicazione e anteprima, si cancellano la storia e le immagini; la cartella con i file resta nel suo ambiente. Il progetto Shinka non si elimina, e nemmeno un progetto che sta lavorando.
- **Eliminare un argomento archiviato** ne cancella la storia e la cartella nell'ambiente del centro; le cartelle negli altri ambienti restano. L'argomento aperto non si elimina.
- **I token si contano dalla storia**: a fine turno l'evento `turno-concluso` porta i token letti (anche dalla cache) e scritti, come li dice l'harness. La pagina Uso somma gli ultimi 14 giorni, per giorno e per conversazione; i turni di prima di questa versione non hanno i token.
- **L'archiviazione conta solo i dati di Shinka**: storie, cartelle degli argomenti nell'ambiente del centro, immagini dei progetti. Le cartelle dei progetti non si contano: possono essere grandi e stare su un'altra macchina. Il conto si ferma dopo 20.000 voci per cartella.
- **Le scorciatoie sono poche**: Ctrl+K (⌘K) per la palette, Esc per chiudere menu, pannello e barra. Niente che si scontri con quelle del browser.

## Consequences

- Le scorciatoie per un'azione precisa (nuovo argomento, cerca) passano dalla palette.
