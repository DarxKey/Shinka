# Scrivere un'estensione dell'interfaccia

Il riferimento per chi scrive un'estensione dell'interfaccia di Shinka: la Home, quando il proprietario ne chiede una, e chiunque voglia capire che cosa può fare. Le decisioni sono nell'[ADR 0054](adr/0054-estensioni-dell-interfaccia.md) e nell'[ADR 0057](adr/0057-interfaccia-riscrivibile-dalle-estensioni.md).

Un'estensione si propone con `proponi_estensione_interfaccia`, scritta per intero. Entra solo se il proprietario conferma la scheda, che mostra ciò che aggiunge, dove, e quali API userà. Una proposta con lo stesso nome di un'estensione che c'è già la sostituisce: va riscritta intera.

## Che cosa può avere

- **`tema`**: CSS che si aggiunge a quello di Shinka. Usa le variabili (`--sfondo`, `--superficie`, `--testo`, `--tenue`, `--bordo`, `--accento`, `--bene`, `--male`, `--attesa`, `--codice`, `--fumetto`) dentro `:root`, e per il tema scuro `:root[data-tema="scuro"]` e `@media (prefers-color-scheme: dark) { :root:not([data-tema="chiaro"]) { … } }`. Le parti principali hanno l'attributo `data-parte` (sotto). Niente `@import` né `url()` verso altri siti.
- **`pagine`** (fino a 12): ciascuna con `id` (minuscole, cifre e trattini), `titolo`, `html` (il documento intero, con CSS e JavaScript dentro) e `posti`.
- **`api`**: le API di Shinka che le pagine chiamano. Voci come `"GET /api/ambienti/*/risorse"`: un metodo (`GET`, `POST`, `PUT`, `PATCH`, `DELETE` o `*`) e un percorso, dove `*` vale un pezzo e `**` il resto. Oppure `"tutte"`, solo se il proprietario lo chiede. Le API non dichiarate non rispondono.
- **`comandi`** (fino a 12): `{ etichetta, tasti?, azione }`. Compaiono nella palette (Ctrl+K); con `tasti`, come `"Ctrl+Shift+R"`, anche da tastiera. L'azione è `{ tipo: "pagina", pagina: <id> }` (apre la pagina a schermo intero), `{ tipo: "messaggio", testo }` (lo manda alla conversazione aperta) o `{ tipo: "segnale", nome }` (lo passa alle pagine accese dell'estensione).
- **`parti`**: parti dell'interfaccia da nascondere (`{ parte }`) o da sostituire con una pagina (`{ parte, pagina: <id> }`).
- **`pulsanti`** (fino a 8): sopra il campo di scrittura, `{ etichetta, testo, dove: "home" | "progetti" | "ovunque" }`; un tocco manda il testo.

## I posti

Ogni pagina ha un elenco di posti: `{ posto, ambito?, client? }`.

| Posto | Dove |
|---|---|
| `menu` | una pagina a schermo intero, nel menu delle pagine |
| `pannello` | una scheda nel pannello di un progetto |
| `barra-destra` | la barra a destra, che il proprietario apre e richiude (la scelta resta); sul telefono si apre sopra |
| `barra-sinistra` | in fondo alla barra laterale, in una sezione richiudibile |
| `testata` | una striscia sotto la testata della chat (alta 36 px, poi come chiede la pagina) |
| `barra-di-stato` | una striscia in fondo alla finestra (28 px) |
| `sopra-scrittura`, `sotto-scrittura` | sopra o sotto il campo di scrittura |
| `flottante` | un pannello che si apre da un pulsante in basso a destra |
| `ambiente` | una sezione nella pagina di ogni ambiente |
| `sicurezza` | una sezione nella pagina Sicurezza |

- `ambito`: `"home"`, `"progetti"` o `"ovunque"` (il predefinito). Conta nei posti che stanno intorno a una conversazione.
- `client`: `"web"` (il sito), `"desktop"` (Shinka Desktop) o `"tutti"` (il predefinito).
- Nei posti stretti la pagina chiede la sua altezza con `shinka.altezza(px)`, tra 20 e 600.
- Una pagina con `posti: []` si apre solo da un comando o al posto di una parte.
- Una pagina in un posto chiuso (barra richiusa, pannello flottante chiuso) non è caricata: chi aggiorna dei dati lo fa solo mentre la pagina c'è, e salta i giri con `document.hidden`.

## Le parti

| Parte | Che cos'è |
|---|---|
| `home-vuota` | il benvenuto della Home quando la conversazione è vuota |
| `stato-progetto` | il riquadro «Stato del progetto» in cima alla chat di un progetto |
| `pannello-modifiche`, `pannello-file`, `pannello-terminale`, `pannello-anteprima`, `pannello-processi` | le schede del pannello di un progetto |
| `ambiente-risorse` | processore, memoria, disco, GPU e grafici nella pagina di un ambiente |
| `pulsanti-estensioni` | la riga dei pulsanti delle estensioni sopra il campo di scrittura |

Sono anche nell'HTML con `data-parte="…"`, insieme a `barra-destra`, `barra-sinistra` e `flottante`: un tema le trova con `[data-parte="stato-progetto"]`.

## Il ponte: `window.shinka`

Il centro mette in cima a ogni pagina una piccola libreria. La pagina sta in un riquadro con un'origine sua: niente rete, niente cookie, niente risorse da altri siti. Tutto ciò che sa di Shinka passa dal ponte.

- **`shinka.alloStato(fai)`**: chiama `fai(stato)` subito (o appena arriva) e a ogni cambiamento. Restituisce la funzione per smettere. `shinka.stato` è l'ultimo ricevuto. Lo stato ha:
  - `qui`: dove è aperta la pagina:
    - `{ tipo: "home", idArgomento }`;
    - `{ tipo: "progetto", id, nome, idAmbiente, ambiente, cartella, condizione }`;
    - `{ tipo: "ambiente", id, nome }`;
    - `{ tipo: "sicurezza" }`;
    - `{ tipo: "pagina" }`.
  - `posto`: il posto della pagina, o `"parte"`.
  - `client`: `"web"` o `"desktop"`; `tema`: `"chiaro"` o `"scuro"`.
  - `estensione`: `{ id, nome, api }`.
  - `home`: `{ condizione, idArgomento }`.
  - `progetti`: `[{ id, nome, ambiente, idAmbiente, condizione }]`.
  - `ambienti`: `[{ id, nome, attivo, sistema, delCentro }]`.

  La condizione è `al-lavoro`, `aspetta-te`, `fermo` o `ambiente-spento`.
- **`shinka.api(metodo, percorso, corpo?)`**, e le scorciatoie `shinka.get(percorso)`, `post`, `put`, `del`: una promessa con la risposta (il JSON già letto, o il testo). Se Shinka dice di no, la promessa si rifiuta con un errore che ha `stato` e `dati`. La chiamata la fa l'interfaccia con la sessione del proprietario. Ogni richiesta entra nel registro della pagina Sicurezza con il nome dell'estensione.
- **`shinka.segui(percorso, fai, nomi?)`**: segue un flusso di eventi delle API (`text/event-stream`). Chiama `fai(nome, dati)` per ogni evento dei `nomi` indicati (di suo `["message"]`), con i dati già letti dal JSON. Quando il flusso si chiude arriva l'evento `"chiuso"`, con `{ motivo }`. Restituisce la funzione per chiuderlo. Il percorso va dichiarato tra le API come `GET`. Al massimo 8 flussi per pagina.
- **`shinka.manda(testo, dove?)`**: manda un messaggio alla Home (`"home"`) o a un progetto (il suo id). Senza `dove`, va alla conversazione in cui la pagina è aperta. Arriva come un messaggio del proprietario, con il nome della pagina davanti, e segue i permessi di sempre. Uno ogni due secondi.
- **`shinka.altezza(px)`**: l'altezza che serve nei posti stretti.
- **`shinka.etichette({ <id>: testo })`**: piccole scritte, fino a 24 caratteri, accanto a progetti e argomenti nella barra laterale, per id. Valgono finché la pagina non ne manda altre o l'interfaccia non si ricarica.
- **`shinka.alSegnale(nome, fai)`**: riceve i segnali dei comandi dell'estensione.

I messaggi del ponte di prima (`parent.postMessage({ shinka: "stato" }, "*")` e `{ shinka: "manda", testo, dove }`) valgono ancora.

## Le API utili

Le pagine vedono le stesse API dell'interfaccia. Le più utili:

| Che cosa | API |
|---|---|
| Risorse di un ambiente: processore, memoria, disco, GPU (`campione.gpu`, dove il nodo ha `nvidia-smi`), processi, container | `GET /api/ambienti/:id/risorse` |
| Il quadro, in tempo reale: è da qui che vengono ambienti, progetti, argomenti, Home, memoria e skill | `GET /api/quadro/eventi`, con `shinka.segui` e i nomi degli eventi: `ambienti`, `progetti`, `argomenti`, `home`, `memoria`, `skill`… |
| La storia di un progetto | `GET /api/progetti/:id/storia` |
| Gli eventi di un progetto, in diretta | `GET /api/progetti/:id/eventi` |
| I file di un progetto | `GET /api/progetti/:id/file?percorso=…` e `GET /api/progetti/:id/file/contenuto?percorso=…` |
| L'uso: token e limiti del piano | `GET /api/uso` |
| Una skill per intero | `GET /api/skill/:nome` |
| I lavori programmati | `GET /api/programmati` |
| Un messaggio a un progetto (meglio `shinka.manda`) | `POST /api/progetti/:id/messaggi` |

Restano chiuse anche con `"tutte"`:
- le rotte dell'accesso a Shinka: entrare, uscire, password, dispositivi, sessioni, copie dei dati, pubblicazione di Shinka Desktop;
- le decisioni che spettano al proprietario: i permessi delle conversazioni, le approvazioni dei comandi sugli host, le proposte di progetto, di sviluppo e di estensione, e l'installazione di una versione.

Il WebSocket del terminale non passa dal ponte, e l'anteprima di un progetto non può usarlo.

## Esempio: la barra delle risorse

Una barra a destra con processore, memoria, disco e GPU dell'ambiente su cui si sta lavorando: quello del progetto aperto, altrimenti quello del centro. Si aggiorna ogni due secondi e mezzo, solo mentre la barra è aperta e la finestra si vede.

Proposta: `nome: "barra-risorse"`, una pagina `{ id: "risorse", titolo: "Risorse", posti: [{ posto: "barra-destra" }] }` con l'HTML qui sotto, e `api: ["GET /api/ambienti/*/risorse"]`.

```html
<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<style>
  body { margin: 0; padding: 8px 10px; font: 13px/1.4 system-ui, sans-serif; color: #2b2a28; background: transparent; }
  body.scuro { color: #e8e7e3; }
  .ambiente { font-weight: 600; margin-bottom: 8px; }
  .voce { margin-bottom: 10px; }
  .riga { display: flex; justify-content: space-between; gap: 8px; }
  .nota { opacity: 0.7; font-size: 12px; }
  .barra { height: 6px; border-radius: 3px; background: rgba(127, 127, 127, 0.25); overflow: hidden; margin-top: 3px; }
  .pieno { height: 100%; background: #4f7cff; }
  .alto .pieno { background: #d9534f; }
  .errore { color: #d9534f; }
</style>
</head>
<body>
<div class="ambiente" id="ambiente">…</div>
<div id="voci"></div>
<script>
  const GiB = 1024 * 1024 * 1024;
  let idAmbiente;
  let inCorso = false;

  function peso(byte) {
    return byte >= GiB ? (byte / GiB).toFixed(1) + " GB" : Math.round(byte / 1024 / 1024) + " MB";
  }

  function voce(nome, percento, nota) {
    const p = Math.max(0, Math.min(100, percento));
    return '<div class="voce' + (p >= 85 ? " alto" : "") + '"><div class="riga"><span>' + nome + "</span><span>" + Math.round(p) + '%</span></div>' +
      (nota ? '<div class="nota">' + nota + "</div>" : "") +
      '<div class="barra"><div class="pieno" style="width:' + p + '%"></div></div></div>';
  }

  async function aggiorna() {
    if (idAmbiente === undefined || inCorso || document.hidden) return;
    inCorso = true;
    try {
      const letto = await shinka.get("/api/ambienti/" + encodeURIComponent(idAmbiente) + "/risorse");
      if (letto.motivo !== undefined) {
        document.getElementById("voci").innerHTML = '<div class="nota">' + letto.motivo + "</div>";
        return;
      }
      const c = letto.campione;
      let html = voce("Processore", c.cpu, letto.sistema.nuclei + " nuclei");
      html += voce("Memoria", (c.memoria.usata / c.memoria.totale) * 100, peso(c.memoria.usata) + " di " + peso(c.memoria.totale));
      if (c.disco) html += voce("Disco", (c.disco.usato / c.disco.totale) * 100, peso(c.disco.usato) + " di " + peso(c.disco.totale));
      for (const gpu of c.gpu || []) {
        html += voce(gpu.nome, gpu.uso, peso(gpu.memoria.usata) + " di " + peso(gpu.memoria.totale) + (gpu.temperatura !== undefined ? " · " + gpu.temperatura + " °C" : ""));
      }
      if (!c.gpu) html += '<div class="nota">GPU: questo ambiente non la dice (serve nvidia-smi).</div>';
      document.getElementById("voci").innerHTML = html;
    } catch (errore) {
      document.getElementById("voci").innerHTML = '<div class="errore">' + errore.message + "</div>";
    } finally {
      inCorso = false;
    }
  }

  shinka.alloStato(function (stato) {
    document.body.className = stato.tema === "scuro" ? "scuro" : "";
    const delCentro = stato.ambienti.find(function (a) { return a.delCentro; });
    const scelto = stato.qui.tipo === "progetto" && stato.qui.idAmbiente ? stato.qui.idAmbiente : stato.qui.tipo === "ambiente" ? stato.qui.id : delCentro && delCentro.id;
    const ambiente = stato.ambienti.find(function (a) { return a.id === scelto; });
    document.getElementById("ambiente").textContent = ambiente ? ambiente.nome + (ambiente.attivo ? "" : " (spento)") : "Nessun ambiente";
    if (scelto !== idAmbiente) {
      idAmbiente = ambiente && ambiente.attivo ? scelto : undefined;
      document.getElementById("voci").innerHTML = idAmbiente ? '<div class="nota">Leggo…</div>' : "";
      aggiorna();
    }
  });
  setInterval(aggiorna, 2500);
  document.addEventListener("visibilitychange", aggiorna);
</script>
</body>
</html>
```
