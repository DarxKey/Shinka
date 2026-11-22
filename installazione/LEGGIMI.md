# Shinka: un'installazione nuova

Questo pacchetto contiene una versione di Shinka, presa da un'altra installazione: solo il codice.
Memoria, skill, argomenti, progetti e vault non ci sono: la nuova installazione comincia da zero.

## Che cosa serve

Un server Linux con Docker e Docker Compose, e le porte 7850, 7851 e 7852 libere.

## Installare

```bash
tar -xzf shinka-*.tar.gz
cd shinka-*
./installa.sh
```

`installa.sh` chiede da quale indirizzo aprirai Shinka nel browser, prepara il file `.env` con un
gettone casuale tra il centro e il gateway, costruisce le due immagini e le avvia. Alla fine dice
l'indirizzo da aprire e il **codice di primo avvio**.

Nel browser la pagina chiede il codice e una password; poi ti guida nella pagina Impostazioni:
il motore delle conversazioni nuove (Claude o Codex), l'accesso con il tuo abbonamento, il nome
dell'ambiente. La pagina del vault è sulla porta 7851, dove scegli la frase del vault.

## Aggiornare

Scarica un pacchetto nuovo dalla pagina Impostazioni dell'installazione da cui viene questo,
estrailo, copia accanto ai file nuovi il file `.env` di quella vecchia e rilancia `./installa.sh`.
I dati restano nei volumi Docker `shinka_centro` e `shinka_gateway`.

## Che cosa c'è

- `compose.yaml`: il centro e il gateway, ciascuno con il suo volume. Il centro non vede i dati del gateway.
- `Dockerfile.centro`: Node 24, il codice in `/opt/shinka`, i dati nella cartella di casa dell'utente `node`.
- `Dockerfile.gateway`: l'immagine di Playwright con Chromium, il recinto di Chromium acceso con
  `seccomp-chromium.json` (le regole di Playwright) e la sola capacità `SYS_CHROOT`.
- `.env`: lo scrive `installa.sh`. Contiene il gettone: non va condiviso.
