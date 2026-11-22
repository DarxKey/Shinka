---
status: accepted
---

# Il registro delle richieste al centro e le sessioni aperte

Shinka si raggiunge anche da fuori casa, attraverso il firewall. Fino a qui il centro non ricordava nulla di chi bussava: un'entrata riuscita, una password sbagliata e una scansione lasciavano la stessa traccia, cioè nessuna, e delle sessioni aperte si sapeva solo quando scadevano. Il 21 novembre 2026 il proprietario ha scelto, tra i pezzi proposti, un registro delle richieste al centro.

## Decisioni

- **Che cosa si annota** (`src/centro/registro-accessi.ts`): le entrate riuscite, fallite e frenate; le uscite; il cambio della password, riuscito o no; il primo avvio; le sessioni chiuse dalla pagina; le richieste all'API senza una sessione valida; quelle rifiutate perché arrivano da un'altra pagina; i file che non ci sono, che è ciò che chiede chi fa una scansione; gli eventi in ingresso accolti e rifiutati; gli inviti usati e rifiutati; i nodi che si presentano. Non si annotano le richieste riuscite di chi è dentro: il registro dice chi è entrato, non che cosa ha fatto.
- **Che cosa si tiene di ogni riga**: quando, che cosa, l'indirizzo, il programma in breve («iPhone · Safari») e il percorso. Mai il corpo, mai la password provata, e del percorso solo la parte prima del punto interrogativo: negli indirizzi stanno le chiavi dei lavori che partono con un evento e i codici degli inviti.
- **Da dove arriva.** L'indirizzo è quello che si è collegato al centro. Se la richiesta porta `X-Forwarded-For`, il primo indirizzo è scritto accanto come «per conto di»: è una dichiarazione del proxy, e chi si collega direttamente può scriverci ciò che vuole. Per questo non sostituisce mai l'indirizzo vero, e nulla si decide su quello: il freno ai tentativi resta com'era. Ciò che non ha la forma di un indirizzo non entra nel registro com'è scritto.
- **Le ripetizioni stanno in una riga.** Una scansione fa centinaia di richieste: la stessa cosa dallo stesso indirizzo, entro dieci minuti, è una riga con il suo conto e l'ora dell'ultima. Vale anche per gli eventi in ingresso accolti, che un altro sistema può mandare a decine. Le entrate, riuscite o fallite, restano una riga a volta: sono poche, perché le frena il limite dei tentativi.
- **Dove sta**: `accessi.jsonl` tra i dati del centro, a righe, leggibile solo dall'utente di Shinka. Oltre un megabyte il file diventa `.1` e ne comincia uno nuovo: restano al più due megabyte. In memoria le ultime duemila righe. Una riga che non si scrive non ferma il centro.
- **Le sessioni dicono chi sono.** Di ogni sessione si tiene quando è stata aperta, da dove e con che programma, e quando e da dove è stata usata l'ultima volta; l'ultimo uso finisce sul disco al più ogni dieci minuti. Le sessioni aperte prima di questa versione restano valide, e di loro si sa solo la scadenza.
- **Si chiudono dalla pagina.** Una per una, o tutte tranne la propria. Alla pagina una sessione arriva con un identificativo, i primi sedici caratteri dell'impronta del suo gettone: basta a indicarla, non serve a entrare.
- **La pagina si chiama Sicurezza**, non «Accessi»: in Shinka l'accesso è già quello di un motore al suo abbonamento. Ha un filtro su ciò che merita uno sguardo, cioè ciò che qualcuno ha provato senza riuscirci.
- **Solo per il proprietario.** Nessuno strumento lo dà alle conversazioni, e non parte nessun avviso: è un registro da leggere dopo.

## Considered Options

- **Annotare ogni richiesta.** Un registro completo, ma quasi tutto sarebbe l'interfaccia del proprietario che lavora, e ciò che conta si perderebbe.
- **Fidarsi di `X-Forwarded-For` come indirizzo.** Più comodo dietro il firewall, ma falsificabile da chi arriva direttamente dalla rete di casa.
- **Avvisare su Telegram a ogni tentativo fallito.** Da fuori le scansioni sono continue: diventerebbe rumore. Un avviso solo per le entrate riuscite da un indirizzo nuovo si può aggiungere dopo.
- **Bloccare gli indirizzi che insistono.** È il mestiere del firewall; qui un errore chiuderebbe fuori il proprietario.

## Consequences

- La specifica passa alla versione 2.17: sezioni 5 e 6, prove da A74 ad A76.
- Il gateway e i nodi non cambiano.
- Dietro un proxy che non passa `X-Forwarded-For`, tutte le richieste da fuori mostrano l'indirizzo del proxy: per vedere quello vero va acceso sul proxy.
- Una pagina di Shinka rimasta aperta dopo la scadenza della sessione continua a chiedere, e compare nel registro come richieste senza essere entrati dal dispositivo del proprietario: sono in una riga sola.
