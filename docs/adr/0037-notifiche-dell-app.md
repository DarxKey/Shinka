---
status: accepted
---

# Notifiche dell'app, con il push del web e senza dipendenze

Il proprietario usa Shinka dall'iPhone come app aggiunta alla schermata Home, e riceve gli avvisi su Telegram. Il 21 novembre 2026 ha chiesto che arrivino anche come notifiche dell'app: senza passare da un'altra applicazione, e con un tocco che porta alla conversazione.

## Decisioni

- **Il push del web, quello standard.** Un service worker (`/sw.js`) mostra la notifica; il browser si iscrive al suo servizio di notifiche con la chiave pubblica del centro (VAPID, RFC 8292); il centro manda ogni avviso cifrato per quel dispositivo (RFC 8291). Su iPhone funziona dall'app aggiunta alla schermata Home, da iOS 16.4; su computer, nei browser.
- **Scritto con ciò che Node ha già** (`src/centro/web-push.ts`): niente libreria in più, e quindi niente dipendenze nuove da far approvare al gateway. La cifratura è verificata contro l'esempio della RFC 8291, byte per byte; la firma e il protocollo contro un servizio vero, quello di Mozilla (`src/prove/push-vero.ts`).
- **Gli avvisi sono quelli di Telegram, decisi nello stesso punto.** Il ponte di Telegram sa già quando avvisare e quando tacere (chi sta guardando la conversazione, i lavori brevi, i lavori programmati): passa lo stesso avviso, in testo semplice, a chi manda le notifiche. Partono anche se Telegram non è abbinato. Le risposte a ciò che il proprietario scrive da Telegram restano lì.
- **Dalla notifica non si decide.** Un tocco apre la conversazione; il consenso si dà dalla scheda, come sempre. Su iOS i pulsanti nelle notifiche del web non ci sono, e così non c'è un secondo posto in cui un sì può nascere.
- **Il numero sull'icona** dice quante conversazioni aspettano il proprietario; si toglie aprendo l'app.
- **Solo servizi conosciuti.** Un'iscrizione si accetta se il suo indirizzo è, in HTTPS, di Apple, Google, Mozilla o Microsoft: il centro non deve poter essere usato per scrivere a un indirizzo qualunque, nemmeno dal proprietario per sbaglio.
- **Al servizio non si dice chi è il proprietario.** Il gettone VAPID vuole un contatto: Shinka ne dichiara uno generico (`mailto:notifiche@shinka.invalid`). Se un servizio lo rifiutasse, il proprietario ne scrive uno suo dalla pagina, sapendo a chi lo dà.
- **Chiavi e iscrizioni tra i dati del centro** (`notifiche.json`, leggibile solo da chi fa girare Shinka). Un'iscrizione che il servizio dice scaduta si toglie da sola; un rifiuto resta scritto accanto al dispositivo.

## Dopo la prima prova (22 novembre 2026)

- **Apple non accetta il contatto generico.** Il proprietario ha provato sull'iPhone: le notifiche sono partite solo dopo aver scritto un indirizzo email vero. La pagina ora lo dice prima, chiede un indirizzo email (lo accetta anche senza `mailto:`) e tiene aperta quella parte finché il contatto è quello generico. Il contatto generico resta il valore di partenza: chi usa solo browser di altri non deve dare nulla.
- **Che cosa arriva dove.** Con le notifiche accese ogni avviso arrivava due volte. Il proprietario sceglie, per genere di avviso (richieste, lavori finiti, lavori programmati), se lo vuole come notifica dell'app, su Telegram, o in tutti e due i posti (`src/protocollo/avvisi.ts`, `NotificheApp.vuole`). Tre regole che la scelta non tocca: ciò che nasce da un messaggio scritto su Telegram ha lì risposta e richieste; i messaggi del gateway arrivano sempre; se nessun dispositivo è iscritto, su Telegram arriva tutto, perché il proprietario non resti senza avvisi.

## Considered Options

- **La libreria `web-push`.** Fa le stesse cose, ma cambia le dipendenze: il gateway chiederebbe il suo sì e il vault andrebbe riaperto, per un pezzo che il gateway non usa.
- **Un ascoltatore a parte per decidere gli avvisi.** Due posti con le stesse regole, che prima o poi divergono.
- **Le notifiche al posto di Telegram.** Telegram serve anche a scrivere alla Home e ad approvare con un pulsante: restano tutti e due.

## Consequences

- La specifica passa alla versione 2.15: perimetro, sezione 7, prove da A68 ad A70.
- Le notifiche passano da un servizio di terzi, come già i messaggi di Telegram; a differenza di quelli, il servizio non può leggerle. Vede quando arrivano e a quale dispositivo.
- Servono HTTPS e, per ora, un gateway configurato: è il ponte di Telegram a decidere gli avvisi, e senza gateway il ponte non c'è.
- Su iPhone lo ha provato il proprietario: funziona, con un indirizzo email vero come contatto.
