---
status: accepted
---

# Un'installazione nuova nasce da un pacchetto

Il 20 novembre 2026 il proprietario ha scelto come installare Shinka da zero, per esempio sul server del lavoro dell'[ADR 0030](0030-il-motore-si-sceglie-per-conversazione.md). Il codice arriva con un pacchetto scaricato dalla sua Shinka, non da un repository pubblicato né da un registro di immagini. L'installazione del lavoro si aggiorna con un pacchetto nuovo, e resta separata da quella di casa. Gli ambienti si preparano con un comando di una riga dalla pagina Ambienti, in un pezzo a sé.

## Decisioni

- **Il pacchetto** (`GET /api/installazione/pacchetto`, pulsante nella pagina Impostazioni) è un `.tar.gz` scritto da Shinka senza programmi esterni. Contiene:
  - il codice della versione in funzione, senza prove;
  - l'interfaccia già costruita;
  - i file della cartella `installazione` del repository, in cima.

  Non contiene dati, memoria, skill, conversazioni, vault né dipendenze. Un'installazione nata da un pacchetto sa rifarlo.
- **Docker Compose con due immagini costruite sul server**: il centro (`node:24-bookworm`) e il gateway (l'immagine di Playwright, con il recinto di Chromium acceso dalle regole seccomp di Playwright e dalla sola capacità `SYS_CHROOT`).
  - Il codice sta nell'immagine, in sola lettura.
  - I dati stanno in due volumi: quello del gateway il centro non lo vede.
  - Gli accessi di Claude e Codex stanno nella casa dell'utente del centro, nel suo volume.
  - Senza guardiano: un aggiornamento è un pacchetto nuovo, e a riaccendere il centro è Docker (`SHINKA_RIPARTE_DA_SOLO`).
- **`installa.sh`** prepara `.env` la prima volta: l'indirizzo del server, il nome dell'ambiente e un gettone casuale tra centro e gateway. Il gateway scrive il gettone tra i suoi dati al primo avvio. Poi lo script costruisce, avvia e aspetta che il centro risponda; alla fine stampa il codice di primo avvio.
- **Primo avvio guidato.** Finché la password manca, il centro tiene un codice di otto caratteri tra i dati e lo scrive nel registro. La pagina chiede il codice e la password nuova: la sceglie solo chi ha in mano il server, non il primo che apre l'indirizzo. Dopo cinque codici sbagliati si aspettano cinque minuti. Poi la pagina Impostazioni accoglie con i passi che restano: motore, accessi, nome dell'ambiente, vault.

## Consequences

- Le immagini si costruiscono sul server: serve la rete per scaricare l'immagine di base e le dipendenze npm. Nessun registro da gestire.
- Un'installazione così non sviluppa sé stessa e non installa versioni dalla scheda: si aggiorna solo con un pacchetto nuovo.
- Il pacchetto contiene il profilo seccomp di Playwright (licenza Apache 2.0), preso da `microsoft/playwright`, `utils/docker/seccomp_profile.json`.
