# Progetto: più utenti in una Shinka

Un documento per lo sviluppo futuro, chiesto dal proprietario il 24 novembre 2026 nel decimo gruppo del suo elenco. Non è ancora deciso quando farlo, e non c'è codice. Oggi la specifica tiene «più utenti» fuori perimetro (`shinka.md`, sezione 2): farlo vuol dire cambiare la specifica, con un ADR, su richiesta esplicita del proprietario.

## Le scelte del proprietario

- **Utenti con permessi granulari.** Un amministratore globale (il proprietario di oggi) e altri utenti, ciascuno con ciò che l'amministratore gli concede: per esempio solo alcuni progetti, solo la sua Home, niente impostazioni.
- **Home e memoria per utente.** Ogni utente ha la sua Home, i suoi argomenti e la sua memoria; vede solo i progetti a cui ha accesso.
- **Un abbonamento per utente.** Le conversazioni di un utente lavorano con il suo accesso a Claude o a ChatGPT, non con quello del proprietario.
- **Un vault per utente.** Ognuno ha il suo vault, con la sua frase.

## Che cosa cambia, pezzo per pezzo

### Accesso e utenti

- `Accesso` oggi ha una password e delle sessioni senza nome. Diventa un elenco di utenti, ciascuno con nome, password (o passkey), sessioni e dispositivi suoi. Il primo utente è l'amministratore: è il proprietario di oggi, con i dati di oggi, senza migrazioni a mano.
- Ogni richiesta porta l'utente: il centro lo ricava dalla sessione o dal gettone del dispositivo, e ogni rotta controlla i permessi. È il cambio più largo: tocca quasi tutte le rotte di `centro.ts`.
- La pagina Sicurezza mostra a ciascuno le sue sessioni; all'amministratore anche quelle degli altri, e il registro intero.
- Gli inviti per un utente nuovo come quelli degli ambienti: un gettone che vale un'ora, e la password la sceglie lui.

### Permessi

Un modello piccolo, da allargare solo se serve:

| Permesso | Che cosa apre |
|---|---|
| `home` | una Home sua, con argomenti e memoria suoi |
| `progetto:<id>:leggi` / `progetto:<id>:lavora` | vedere un progetto, o anche scrivergli, decidere i permessi, aprire terminale e anteprima |
| `progetti:crea` | creare progetti (in quali ambienti, a parte) |
| `ambiente:<id>` | usare quell'ambiente: nella Home, nei progetti nuovi, nel terminale |
| `estensioni` | proporre e accendere estensioni, anche dell'interfaccia |
| `programmati` | lavori programmati suoi |
| `amministrazione` | impostazioni, utenti, sviluppo di Shinka, copie, Shinka Desktop, ambienti nuovi |

L'amministratore ha tutto. Un progetto ha un utente che lo possiede, chi lo crea; l'amministratore lo può condividere.

### Home, argomenti e memoria

- La Home oggi è una (con le sue chat parallele, ADR 0052): diventa una per utente, ciascuna con il suo stato (`home.json`), i suoi argomenti (`argomenti.json` e gli archivi) e la sua memoria (`memoria.md`), in una cartella per utente tra i dati.
- Le skill restano di Shinka, in comune: sono procedure, non dati personali. Da decidere se un utente ne vede la storia.
- Telegram: un bot solo, con l'abbinamento per utente; i messaggi di un utente vanno alla sua Home.

### Motori e abbonamenti

- Oggi l'accesso del motore è uno per ambiente, nella casa dell'utente del sistema che fa girare il nodo (ADR 0031). Per un abbonamento per utente serve, in ogni ambiente, una configurazione del motore per utente: per Claude Code `CLAUDE_CONFIG_DIR` diversa per utente, per Codex `CODEX_HOME`. Il nodo apre le conversazioni di un utente con la sua.
- La pagina Impostazioni → accessi diventa per utente: ognuno fa il suo accesso, con il codice da inserire sul sito.
- I limiti del piano e l'uso (pagina Uso) si contano per utente.
- Rischio: se l'utente non ha fatto l'accesso in un ambiente, le sue conversazioni lì non partono. La pagina lo deve dire prima.

### Vault per utente

- Il gateway oggi custodisce un vault, aperto con una frase. Con un vault per utente:
  - il gateway tiene un vault cifrato per utente, ciascuno con la sua frase;
  - li apre e li chiude uno per uno;
  - il registro dell'uso delle credenziali è per utente.
- Il centro dice al gateway per quale utente chiede: il gettone tra centro e gateway non basta più a dire chi. Una credenziale si usa solo per l'utente a cui appartiene; host per gli stack e browser del gateway uguale.
- Il «sì dato al gateway» (installazioni del gateway, comandi sul server) resta dell'amministratore.
- È la parte più delicata: va con il suo ADR, e il gateway va aggiornato con il sì del proprietario come sempre.

### Interfaccia

- L'accesso chiede l'utente oltre alla password.
- Il quadro manda a ciascuno solo ciò che può vedere: i suoi progetti, la sua Home, i suoi argomenti, gli ambienti concessi.
- Le pagine di amministrazione (Impostazioni, Utenti, Sviluppo, Copie) compaiono solo all'amministratore.
- Le estensioni dell'interfaccia (ADR 0057): da decidere se sono di tutti o per utente; le loro API seguono comunque i permessi di chi guarda.

### Shinka Desktop

- Un dispositivo appartiene a un utente: il gettone porta l'utente, e la copia locale contiene solo ciò che lui vede.

## Ordine proposto

1. Utenti, accesso e permessi, con l'amministratore uguale a oggi e nessun altro utente: niente cambia per chi c'è.
2. Progetti condivisi in lettura e in lavoro.
3. Home, argomenti e memoria per utente.
4. Motori per utente negli ambienti.
5. Vault per utente nel gateway.
6. Telegram, Desktop, estensioni.

Ogni passo si installa da solo, con le prove intere: il primo deve lasciare l'installazione del proprietario esattamente com'è.

## Domande aperte

- Un utente vede i nodi e le risorse degli ambienti, o solo il loro nome?
- Le estensioni dell'interfaccia sono di Shinka o di ciascun utente?
- Un utente non amministratore può proporre uno sviluppo di Shinka, che l'amministratore approva?
- Che cosa succede ai progetti di un utente che si toglie: passano all'amministratore o si archiviano?
