---
status: accepted
---

# Incarichi affidati a un altro modello, anche locale

Il 23 novembre 2026 il proprietario ha confermato una proposta della Home: in un progetto, scegliere separatamente chi pianifica o revisiona e chi implementa ed esegue i test, anche con un modello locale (Qwen 3.8 27B sulla RTX 4090 del PC), e misurare se la delega riduce il consumo di token a parità di risultato. Il riferimento è la delega per ruoli di Atomic Agent.

## Prova fatta prima di decidere

Sul PC c'è già un profilo del proprietario per Qwen con Claude Code: llama.cpp b10472 con CUDA, `start-qwen-claude.bat` (Qwen3.8-27B UD-Q4_K_XL, 96K di contesto, KV q8_0, MTP con 2 token, template corretto per i messaggi di sistema di Claude Code, ragionamento xhigh) e `claude-qwen.cmd`, che fa parlare Claude Code con `127.0.0.1:8080`. Misurato il 23 novembre 2026:

- caricamento in 29 s; VRAM 23,6 GB su 24,5 a riposo, 23,7 al lavoro: giusto, senza margine;
- scrittura circa 77 token/s (l'MTP accetta l'88% delle bozze), 56 token/s dopo aver letto 21K token; lettura circa 2.100 token/s;
- un compito vero con Claude Code (una funzione, sei casi chiesti, test con `node:test`, comandi): 136 s, 8 turni, 9 test su 9 passati, 36K token in ingresso, 229K letti dalla cache, 3,9K in uscita.

Il profilo è già quello giusto per la scheda: non serve cambiarlo per cominciare.

## Decisioni

- **Guida chi pianifica.** La conversazione del progetto è il modello che pianifica e decide, come oggi, con il motore e il modello scelti dal proprietario. Affida l'implementazione con uno strumento, `affida_incarico`: incarico, vincoli, file pertinenti e criteri di accettazione, niente storia della conversazione. Chi implementa lavora e riporta: che cosa ha fatto, i file cambiati, l'esito dei test, i dubbi. Le correzioni le decide chi pianifica, e le affida con un altro incarico. Si può sempre lavorare con un modello solo: se il proprietario non ha scelto chi implementa, lo strumento lo dice e il lavoro resta a chi guida. Lo strumento c'è comunque, perché gli strumenti si fissano quando la conversazione parte, e la scelta può cambiare dopo: chi guida la viene a sapere da una nota.
- **L'incarico è una conversazione a parte del progetto**, nello stesso ambiente e nella stessa cartella, con il motore e il modello dell'esecutore e con il modo dei permessi del progetto. Le sue richieste di permesso e le sue domande compaiono nella conversazione del progetto, e il proprietario decide da lì. Nella chat l'incarico si vede come un'azione, con il modello che lo svolge e a che punto è.
- **Il selettore per ruolo.** Nelle impostazioni del progetto: chi implementa, predefinito per il progetto, tra i modelli davvero disponibili negli accessi di Claude Code e di Codex di quell'ambiente e i modelli locali accesi lì; per ognuno ciò che sa fare e, se non è disponibile, perché. Per un singolo incarico il proprietario può chiederne un altro, e chi pianifica lo passa allo strumento: mai un cambio di modello deciso da solo, mai una chiave API nuova per un motore che ha già il suo accesso.
- **I modelli locali sono un'estensione.** L'estensione «Modello locale», accesa in un ambiente dall'elenco delle estensioni, dice come si accende il server (il profilo del proprietario), su quale porta risponde, il nome del modello e il contesto. Il nodo lo accende quando un incarico lo chiede, aspetta che risponda, e lo spegne dopo 10 minuti senza richieste per liberare la scheda. L'esecutore è Claude Code che parla con quel server, come fa `claude-qwen`. Per ora vale solo per i progetti che vivono nello stesso ambiente del server: niente porte aperte sulla rete.
- **Ciò che si misura**, per ogni incarico: durata, esito dei test riportato, token in ingresso, in uscita e dalla cache per ciascun modello, e per un modello locale il picco di VRAM. Le quote dei piani restano per piano, come nella pagina Uso.
- **Le prove a confronto**, in un checkout di prova e con gli stessi compiti e test: un modello solo; chi pianifica con Qwen che implementa, con il ragionamento xhigh e medium; chi pianifica con un altro modello cloud che implementa (Opus o Sol).

## Fasi

1. Gli incarichi con i modelli cloud e il selettore per ruolo nelle impostazioni del progetto.
2. L'estensione «Modello locale» sul nodo, con l'accensione e lo spegnimento del server.
3. Le prove a confronto, con un resoconto per il proprietario.

## Com'è fatta la fase 1

- La conversazione di un incarico ha per identificativo quello del progetto seguito da `~incarico-` e da un suo codice: così i suoi strumenti di Shinka valgono per il progetto, e l'ambiente la riconosce e le dà le istruzioni di chi implementa, senza lo stato del progetto e senza gli strumenti per affidare incarichi e installare.
- Le sue richieste di permesso, le sue domande e la fine di quelle azioni entrano nell'archivio del progetto; il resto della sua storia no: lo riassume il resoconto, e la sua uscita si legge dall'attività.
- Le misure di ogni incarico finiscono in `incarichi.jsonl` nei dati di Shinka.

## Com'è fatta la fase 2

- Un'estensione di un tipo nuovo, `modello-locale`: il programma del server avviato direttamente (non uno script, che il nodo non saprebbe spegnere con certezza e che su un errore aspetterebbe un tasto), i suoi argomenti, la porta su 127.0.0.1, il nome del modello, il contesto, la lunghezza massima delle risposte e gli impegni che accetta. Negli argomenti `{impegno}` diventa l'impegno con cui il server parte: con llama-server il ragionamento si fissa all'avvio, e un impegno diverso vuol dire riaccenderlo, cosa che si fa solo se nessun'altra conversazione lo sta usando.
- La propone la Home, come le altre, e la prova è accendere il server e aspettare che risponda su `/health`; poi si spegne.
- Accesa in un ambiente, i suoi modelli compaiono nella scelta del modello dei progetti di quell'ambiente, con il valore `locale:<nome>`: per chi implementa, ma anche per il modello del progetto. Un modello locale lavora sempre con Claude Code, qualunque sia il motore predefinito.
- La conversazione che lo sceglie prende il modello (`src/nodo/modelli-locali.ts`): il nodo accende il server se serve, e il primo messaggio aspetta che risponda. Claude Code parla con il server con le variabili del profilo del proprietario (indirizzo, un gettone che il server non controlla, il modello per ogni ruolo, contesto e uscita), senza la ricerca e la lettura del web (passano dai server di Anthropic) e senza i server MCP dell'ambiente, che possono pesare più del contesto. La scelta della fonte di autenticazione resta in un punto solo, `src/harness/autenticazione.ts`.
- Quando l'ultima conversazione che lo usa chiude il suo processo, dopo dieci minuti il server si spegne. Uno che risponde già sulla porta, acceso dal proprietario, lo si usa e non lo si spegne.
- Mentre è acceso si misura la memoria della scheda video con `nvidia-smi`; il picco arriva nel resoconto e nelle misure dell'incarico.
- Chi svolge un incarico ha solo gli strumenti di Shinka per le cartelle collegate: il resto lo fa chi guida, e un contesto più leggero conta per un modello locale.

## Conseguenze

- Un incarico costa una conversazione nuova: chi pianifica deve scriverlo perché si capisca da solo.
- Due modelli lavorano nella stessa cartella, uno per volta: mentre un incarico è in corso, la conversazione del progetto aspetta il suo esito.
- La specifica non cambia: un incarico è una delle conversazioni del progetto (sezione 4.4), con il motore e il modello scelti per lei (sezione 4.12), e le regole della sezione 4 valgono anche lì.
