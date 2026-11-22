---
status: accepted
---

# Il gateway sta in un container suo, e il vault lo sblocca il proprietario

Il gateway gira in un container separato da quello del centro, con una cartella che il centro non monta. Il vault è cifrato con una chiave derivata da una frase che il proprietario scrive dopo ogni riavvio del gateway: la frase resta solo in memoria, e finché non la scrive Claude non può usare alcuna credenziale. Frase e valori delle credenziali il proprietario li scrive in una pagina servita dal gateway stesso, non dal centro. Lo ha deciso il proprietario il 12 novembre 2026, perché le conversazioni di Claude girano nel container del centro con i suoi stessi permessi: tutto ciò che il centro può leggere, una conversazione può leggerlo con un comando.

## Considered Options

- **Gateway nello stesso container del centro, con un altro utente.** Un solo container da gestire. Scartata: la separazione dipenderebbe dai permessi sui file dentro un container in cui Claude esegue comandi.
- **Chiave del vault in un file accanto al vault.** Il vault si riaprirebbe da solo dopo un riavvio. Scartata: chi legge la cartella del gateway avrebbe vault e chiave insieme, e una copia di sicurezza li porterebbe via entrambi.
- **Pagina del vault dentro l'interfaccia di Shinka.** Un solo indirizzo e una sola password. Scartata: frase e valori passerebbero dal processo del centro.

## Consequences

- Dopo ogni riavvio del gateway o del server il vault resta chiuso finché il proprietario non scrive la frase: fino ad allora i lavori che usano una credenziale si fermano con un rifiuto.
- Se il proprietario dimentica la frase, le credenziali non si recuperano: il vault va cancellato e rifatto.
- Il proprietario ha due indirizzi: Shinka e, per frase e credenziali, la pagina del gateway. Shinka mostra stato, nomi e registro, e porta a quella pagina.
- Il centro si presenta al gateway con un gettone che le conversazioni possono leggere. Per questo il gateway non offre al centro alcuna richiesta che restituisca un valore o che inserisca, sostituisca, rimuova o sposti una credenziale: con il gettone si può solo chiedere l'uso di una credenziale sugli host previsti, e ogni uso resta nel registro.
- Su una macchina dove centro e gateway girano con lo stesso utente, come il PC di sviluppo, questa separazione non c'è.
