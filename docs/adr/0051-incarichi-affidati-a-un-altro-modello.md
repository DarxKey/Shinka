---
status: proposed
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

- **Guida chi pianifica.** La conversazione del progetto è il modello che pianifica e decide, come oggi, con il motore e il modello scelti dal proprietario. Affida l'implementazione con uno strumento, `affida_incarico`: incarico, vincoli, file pertinenti e criteri di accettazione, niente storia della conversazione. Chi implementa lavora e riporta: che cosa ha fatto, i file cambiati, l'esito dei test, i dubbi. Le correzioni le decide chi pianifica, e le affida con un altro incarico. Si può sempre lavorare con un modello solo: se il progetto non ha un esecutore, lo strumento non c'è.
- **L'incarico è una conversazione a parte del progetto**, nello stesso ambiente e nella stessa cartella, con il motore e il modello dell'esecutore e con il modo dei permessi del progetto. Le sue richieste di permesso e le sue domande compaiono nella conversazione del progetto, e il proprietario decide da lì. Nella chat l'incarico si vede come un'azione, con il modello che lo svolge e a che punto è.
- **Il selettore per ruolo.** Nelle impostazioni del progetto: chi implementa, predefinito per il progetto, tra i modelli davvero disponibili negli accessi di Claude Code e di Codex di quell'ambiente e i modelli locali accesi lì; per ognuno ciò che sa fare e, se non è disponibile, perché. Per un singolo incarico il proprietario può chiederne un altro, e chi pianifica lo passa allo strumento: mai un cambio di modello deciso da solo, mai una chiave API nuova per un motore che ha già il suo accesso.
- **I modelli locali sono un'estensione.** L'estensione «Modello locale», accesa in un ambiente dall'elenco delle estensioni, dice come si accende il server (il profilo del proprietario), su quale porta risponde, il nome del modello e il contesto. Il nodo lo accende quando un incarico lo chiede, aspetta che risponda, e lo spegne dopo 10 minuti senza richieste per liberare la scheda. L'esecutore è Claude Code che parla con quel server, come fa `claude-qwen`. Per ora vale solo per i progetti che vivono nello stesso ambiente del server: niente porte aperte sulla rete.
- **Ciò che si misura**, per ogni incarico: durata, esito dei test riportato, token in ingresso, in uscita e dalla cache per ciascun modello, e per un modello locale il picco di VRAM. Le quote dei piani restano per piano, come nella pagina Uso.
- **Le prove a confronto**, in un checkout di prova e con gli stessi compiti e test: un modello solo; chi pianifica con Qwen che implementa, con il ragionamento xhigh e medium; chi pianifica con un altro modello cloud che implementa (Opus o Sol).

## Fasi

1. Gli incarichi con i modelli cloud e il selettore per ruolo nelle impostazioni del progetto.
2. L'estensione «Modello locale» sul nodo, con l'accensione e lo spegnimento del server.
3. Le prove a confronto, con un resoconto per il proprietario.

## Conseguenze

- Un incarico costa una conversazione nuova: chi pianifica deve scriverlo perché si capisca da solo.
- Due modelli lavorano nella stessa cartella, uno per volta: mentre un incarico è in corso, la conversazione del progetto aspetta il suo esito.
- La specifica cambia nella sezione dei progetti quando la fase 1 entra in funzione.
