---
status: accepted
---

# Credenziali in chiaro, di prova o a basso rischio

Il 21 novembre 2026 il proprietario ha confermato una proposta della Home: un secondo tipo di credenziale, meno sicuro, che Claude possa leggere. Servono password generate per laboratori e prove (l'amministratore di un domain controller di prova, l'utente root di una VM di test), accessi a servizi a basso rischio, e password da passare a script che girano sulla macchina di destinazione: con il vault di prima Claude non poteva fornirle, perché non ne vedeva il valore. Il proprietario sa che il valore finisce nell'archivio delle conversazioni, e lo vuole così. Ha chiesto di cambiare la regola 4.8 con un'eccezione dichiarata, come quella delle chiavi delle estensioni.

## Decisioni

- **Un segno sulla credenziale, non un vault a parte.** Una credenziale per host (password o chiave SSH) o per un sito può essere `inChiaro`: sta nello stesso file cifrato, si apre con la stessa frase, e a vault chiuso non si legge. Le chiavi delle estensioni non possono esserlo: le riceve solo il loro programma.
- **Si legge per un host o un sito in cui vale.** Lo strumento `leggi_credenziale` vuole il nome e il posto in cui Claude la userà; il gateway la dà solo se è in chiaro e vale lì, con le stesse regole di scrittura dell'uso (host e porta, origine esatta del sito). Nessuna approvazione a ogni lettura e nessuna scadenza: lo ha escluso il proprietario. Ogni lettura va nel registro, senza il valore.
- **Claude ne propone, il proprietario approva dalla chat.** `salva_credenziale_in_chiaro` manda la credenziale al gateway, che la controlla e la tiene da parte; nella conversazione compare una scheda con nome, utente e dove vale, senza il valore; il centro riferisce soltanto il sì o il no, come per i comandi sugli host degli stack (ADR 0008), e il gateway salva ciò che aveva tenuto. Il gateway non può sapere da sé quali host il proprietario abbia indicato: la scheda è il modo in cui lui li conferma. Una proposta non può dichiarare un host per gli stack né il server.
- **Da in chiaro a protetta, mai il contrario.** Dalla pagina del vault una credenziale in chiaro si rende protetta. Una protetta non diventa in chiaro nemmeno sostituendola: se serve, se ne inserisce un'altra con un altro nome.
- **Si riconosce dappertutto.** La pagina del vault, la pagina Vault di Shinka ed `elenca_credenziali` segnano le credenziali in chiaro; segnandola, la pagina del vault avvisa che il valore finirà nelle conversazioni.
- **Il suo valore non si nasconde.** Il gateway toglie i valori delle credenziali dalle uscite dei comandi e dalle pagine del browser; quelli delle credenziali in chiaro no, perché Claude li conosce già e nasconderli confonderebbe soltanto.
- **Il server di Shinka non è escluso.** Il proprietario non ha voluto questo limite: una credenziale del server può essere in chiaro, e i comandi lì continuano ad aspettare il sì dato al gateway.

## Considered Options

- **Un vault separato per le credenziali in chiaro.** Due frasi o due file da tenere, e nessun guadagno: il valore esce comunque verso le conversazioni.
- **Salvataggio da parte di Claude senza conferma.** Più comodo, ma l'ambito lo sceglierebbe Claude, e il gateway inoltrerebbe comandi SSH verso host che il proprietario non ha mai nominato.
- **Solo il proprietario le inserisce.** Semplice, ma Claude, generata una password di laboratorio, dovrebbe chiedergli di ricopiarla a mano.

## Consequences

- La specifica passa alla versione 2.11: un'eccezione nella sezione 4.8, una riga nella sezione 6, le prove da A53 ad A57.
- Il gateway cambia: con l'installazione chiede il suo sì, e dopo il vault va riaperto con la frase.
- Le istruzioni della Home e dei progetti dicono che il valore delle credenziali protette non si legge mai, e quello delle credenziali in chiaro si legge quando serve, senza scriverlo in memoria, nelle skill o in file che non servono al lavoro.
