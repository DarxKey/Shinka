import assert from "node:assert/strict";
import { test } from "node:test";
import {
  pesoInBreve,
  cartellaPrevista,
  comandoSuHost,
  dettaglioDi,
  etichettaDi,
  filtraArgomenti,
  giornoInBreve,
  momentoInBreve,
  oraInBreve,
  skillNonViste,
  sottotitoloAmbiente,
  vaultInBreve,
  versioneAmbiente,
  collegamentoAmbiente,
} from "./descrivi.ts";

test("la cartella prevista è scritta come la scrive il suo ambiente", () => {
  assert.equal(cartellaPrevista("/home/node/progetti", "videogioco"), "/home/node/progetti/videogioco");
  assert.equal(
    cartellaPrevista("C:\\Users\\mario\\Progetti", "gioco-unity"),
    "C:\\Users\\mario\\Progetti\\gioco-unity",
  );
});

test("una barra in fondo alla cartella dei progetti non si raddoppia", () => {
  assert.equal(cartellaPrevista("/home/node/progetti/", "sito"), "/home/node/progetti/sito");
  assert.equal(cartellaPrevista("D:\\Lavori\\", "sito"), "D:\\Lavori\\sito");
  assert.equal(cartellaPrevista("D:/Lavori", "sito"), "D:/Lavori\\sito");
});

test("gli strumenti della Home hanno un nome leggibile e il loro dettaglio", () => {
  assert.equal(etichettaDi("mcp__shinka__proponi_progetto"), "Proposta di progetto");
  assert.equal(dettaglioDi("mcp__shinka__proponi_progetto", { nome: "Videogioco", brief: "…" }), "Videogioco");
  assert.equal(dettaglioDi("mcp__shinka__elenca_ambienti", {}), "");
  // Su Windows i comandi arrivano da uno strumento con un altro nome: per il proprietario è lo stesso.
  assert.equal(etichettaDi("PowerShell"), "Comando");
  assert.equal(dettaglioDi("PowerShell", { command: "python primi.py" }), "python primi.py");
  assert.equal(etichettaDi("StrumentoMaiVisto"), "StrumentoMaiVisto");
  assert.equal(dettaglioDi("Bash", { command: 7 }), "");
});

test("il sottotitolo di un ambiente non lascia separatori a vuoto", () => {
  assert.equal(sottotitoloAmbiente("Windows 11", "Unity, Blender"), "Windows 11 · Unity, Blender");
  assert.equal(sottotitoloAmbiente("Linux", ""), "Linux");
});

test("un'azione in un altro ambiente si chiama come quelle fatte qui, e dice dove avviene", () => {
  assert.equal(etichettaDi("mcp__shinka__esegui_in_ambiente"), etichettaDi("Bash"));
  assert.equal(
    dettaglioDi("mcp__shinka__esegui_in_ambiente", { ambiente: "PC Windows", comando: ".\\prova.ps1" }),
    "PC Windows › .\\prova.ps1",
  );
  assert.equal(dettaglioDi("mcp__shinka__scrivi_file", { ambiente: "PC Windows", percorso: "prova.ps1", contenuto: "x" }), "PC Windows › prova.ps1");
  assert.equal(dettaglioDi("mcp__shinka__leggi_file", { percorso: "prova.ps1" }), "prova.ps1");
  assert.equal(dettaglioDi("mcp__shinka__cambia_argomento", { titolo: "Rinominare le foto", riassunto: "…" }), "Rinominare le foto");
  assert.equal(dettaglioDi("Bash", { command: "ls", ambiente: "PC Windows" }), "ls");
});

test("un comando su un host dice con quale credenziale e dove", () => {
  assert.equal(etichettaDi("mcp__shinka__esegui_su_host"), "Comando su un host");
  assert.equal(
    dettaglioDi("mcp__shinka__esegui_su_host", { credenziale: "nas", host: "192.168.1.20:22", comando: "df -h" }),
    "nas su 192.168.1.20:22 › df -h",
  );
  assert.equal(dettaglioDi("mcp__shinka__esegui_su_host", { comando: "df -h" }), "df -h");
  assert.equal(dettaglioDi("mcp__shinka__elenca_credenziali", {}), "");
});

test("il vault nella barra laterale: quante credenziali, oppure perché non si possono usare", () => {
  assert.equal(vaultInBreve(undefined), undefined);
  assert.equal(vaultInBreve({ gateway: "non-configurato", quante: 0 }), undefined);
  assert.equal(vaultInBreve({ gateway: "irraggiungibile", quante: 0 }), "non risponde");
  assert.equal(vaultInBreve({ gateway: "attivo", condizione: "da-impostare", quante: 0 }), "da impostare");
  assert.equal(vaultInBreve({ gateway: "attivo", condizione: "chiuso", quante: 0 }), "chiuso");
  assert.equal(vaultInBreve({ gateway: "attivo", condizione: "aperto", quante: 3 }), "3");
});

test("gli argomenti archiviati si filtrano per titolo e riassunto, senza badare ad accenti e maiuscole", () => {
  const voce = (id: string, titolo: string, riassunto: string) => ({
    id,
    titolo,
    riassunto,
    apertoIl: "2026-11-10T08:00:00.000Z",
    archiviatoIl: "2026-11-11T08:00:00.000Z",
  });
  const argomenti = [
    voce("a", "Rinominare le foto", "Script PowerShell sul PC."),
    voce("b", "Meteo", "Perché piove a Udine."),
    voce("c", "Ragù", ""),
  ];
  assert.deepEqual(filtraArgomenti(argomenti, "  "), argomenti);
  assert.deepEqual(filtraArgomenti(argomenti, "FOTO script").map((a) => a.id), ["a"]);
  assert.deepEqual(filtraArgomenti(argomenti, "perche").map((a) => a.id), ["b"]);
  assert.deepEqual(filtraArgomenti(argomenti, "ragu").map((a) => a.id), ["c"]);
  assert.deepEqual(filtraArgomenti(argomenti, "foto meteo"), []);
});

test("un giorno si scrive in breve, con l'anno solo se non è quello in corso", () => {
  const oggi = new Date(2026, 10, 11, 12);
  assert.equal(giornoInBreve(new Date(2026, 10, 3, 9).toISOString(), oggi), "3 nov");
  assert.equal(giornoInBreve(new Date(2025, 0, 31, 9).toISOString(), oggi), "31 gen 2025");
  assert.equal(giornoInBreve("non una data", oggi), "");
});

test("una skill è una novità se è cambiata dopo l'ultima volta che il proprietario ha guardato", () => {
  const skill = [
    { nome: "vecchia", modificataIl: "2026-11-10T09:00:00+01:00" },
    { nome: "nuova", modificataIl: "2026-11-11T18:05:00+01:00" },
    { nome: "strana", modificataIl: "non una data" },
  ];
  const visteFinoA = Date.parse("2026-11-11T08:00:00Z");
  assert.deepEqual(skillNonViste(skill, visteFinoA).map((voce) => voce.nome), ["nuova"]);
  // Chi non ha mai guardato la pagina le trova tutte da vedere.
  assert.equal(skillNonViste(skill, 0).length, 2);
  assert.match(momentoInBreve(new Date(2026, 10, 11, 18, 5).toISOString(), new Date(2026, 10, 12)), /^11 nov, 18:05$/);
  assert.equal(momentoInBreve("non una data"), "");
});

test("le azioni nei siti dicono che cosa si fa e dove", () => {
  assert.equal(etichettaDi("mcp__shinka__apri_sito"), "Apertura di un sito");
  assert.equal(dettaglioDi("mcp__shinka__apri_sito", { indirizzo: "https://www.esempio.it/accesso" }), "https://www.esempio.it/accesso");
  assert.equal(etichettaDi("mcp__shinka__inserisci_credenziale"), "Accesso con una credenziale");
  assert.equal(dettaglioDi("mcp__shinka__inserisci_credenziale", { credenziale: "banca" }), "banca");
  assert.equal(
    dettaglioDi("mcp__shinka__agisci_nel_sito", { azione: "clicca", elemento: "e12", descrizione: "bottone Entra" }),
    "clicca › bottone Entra",
  );
  assert.equal(dettaglioDi("mcp__shinka__agisci_nel_sito", { azione: "clicca", elemento: "e12" }), "clicca › e12");
  assert.equal(
    dettaglioDi("mcp__shinka__agisci_nel_sito", { azione: "scrivi", elemento: "e4", descrizione: "campo Cerca", testo: "orari", invio: true }),
    'scrivi › campo Cerca › "orari" e Invio',
  );
  assert.equal(dettaglioDi("mcp__shinka__agisci_nel_sito", { azione: "indietro" }), "indietro");
  assert.equal(dettaglioDi("mcp__shinka__leggi_sito", { immagine: true }), "con l'immagine");
  assert.equal(dettaglioDi("mcp__shinka__leggi_sito", {}), "");
  assert.equal(dettaglioDi("mcp__shinka__chiudi_sito", {}), "");
});

test("le azioni nel browser del PC dicono pagina, gesto e testo, anche dentro un gruppo", () => {
  const nel = (nome: string): string => "mcp__claude-in-chrome__" + nome;
  assert.equal(etichettaDi(nel("navigate")), "Browser del PC: apertura di una pagina");
  assert.equal(dettaglioDi(nel("navigate"), { url: "https://example.com", tabId: 7 }), "https://example.com");
  assert.equal(etichettaDi(nel("tabs_close_mcp")), "Browser del PC: chiusura di una scheda");
  assert.equal(dettaglioDi(nel("tabs_close_mcp"), { tabId: 7 }), "");
  assert.equal(dettaglioDi(nel("computer"), { action: "left_click", coordinate: [120, 340] }), "clic › nel punto 120, 340");
  assert.equal(dettaglioDi(nel("computer"), { action: "type", text: "orari" }), 'scrive › "orari"');
  assert.equal(dettaglioDi(nel("computer"), { action: "key", text: "Enter" }), 'tasto › "Enter"');
  assert.equal(dettaglioDi(nel("form_input"), { ref: "ref_3", value: "Trieste" }), '"Trieste"');
  assert.equal(dettaglioDi(nel("javascript_tool"), { action: "javascript_exec", text: "document.title" }), "document.title");
  // Uno strumento che l'interfaccia non conosce resta riconoscibile.
  assert.equal(etichettaDi(nel("nuovo_strumento")), "Browser del PC: nuovo_strumento");
  assert.equal(
    dettaglioDi(nel("browser_batch"), {
      actions: [
        { name: "navigate", input: { url: "https://example.com/cassa" } },
        { name: "computer", input: { action: "left_click", ref: "ref_9" } },
        { name: "computer", input: { action: "type", text: "ciao" } },
        { name: "read_page", input: {} },
      ],
    }),
    'apertura di una pagina: https://example.com/cassa; azione nella pagina: clic › ref_9; azione nella pagina: scrive › "ciao"; lettura della pagina',
  );
});

test("la proposta di un'anteprima dice la porta, e si può aprire solo se è riuscita", async () => {
  const { anteprimaProposta, conCtrl, indirizzoAnteprima } = await import("./descrivi.ts");
  const strumento = "mcp__shinka__proponi_anteprima";
  assert.equal(etichettaDi(strumento), "Anteprima proposta");
  assert.equal(dettaglioDi(strumento, { porta: 5173 }), "localhost:5173");
  assert.equal(dettaglioDi(strumento, { porta: 5173, percorso: "/impostazioni" }), "localhost:5173/impostazioni");

  assert.deepEqual(anteprimaProposta({ strumento, ingresso: { porta: 5173 }, conclusa: true }), { porta: 5173, percorso: "/" });
  assert.deepEqual(anteprimaProposta({ strumento, ingresso: { porta: 5173, percorso: "/a?b=1" }, conclusa: true, errore: false }), {
    porta: 5173,
    percorso: "/a?b=1",
  });
  // Un percorso che porterebbe altrove non si segue: si apre la pagina iniziale.
  assert.deepEqual(anteprimaProposta({ strumento, ingresso: { porta: 5173, percorso: "//altrove.example" }, conclusa: true }), {
    porta: 5173,
    percorso: "/",
  });
  assert.equal(anteprimaProposta({ strumento, ingresso: { porta: 5173 }, conclusa: false }), undefined);
  assert.equal(anteprimaProposta({ strumento, ingresso: { porta: 5173 }, conclusa: true, errore: true }), undefined);
  assert.equal(anteprimaProposta({ strumento, ingresso: { porta: "5173" }, conclusa: true }), undefined);
  assert.equal(anteprimaProposta({ strumento: "Bash", ingresso: { porta: 5173 }, conclusa: true }), undefined);

  // L'anteprima si guarda dallo stesso host di Shinka, sulla porta dell'anteprima.
  assert.equal(indirizzoAnteprima({ protocol: "http:", hostname: "192.168.1.20" }, 7852, "/"), "http://192.168.1.20:7852/");
  assert.equal(indirizzoAnteprima({ protocol: "http:", hostname: "[fd00::1]" }, 7852, "/a"), "http://[fd00::1]:7852/a");

  // Ctrl sul telefono: vale per il tasto battuto subito dopo.
  assert.equal(conCtrl("c"), "\x03");
  assert.equal(conCtrl("D"), "\x04");
  assert.equal(conCtrl("["), "\x1b");
  assert.equal(conCtrl("1"), "1");
  assert.equal(conCtrl("\x1b[A"), "\x1b[A");
});

test("le azioni sugli stack di prova dicono quale stack e su quale host", () => {
  assert.equal(etichettaDi("mcp__shinka__avvia_stack"), "Avvio di uno stack");
  assert.equal(etichettaDi("mcp__shinka__rimuovi_stack"), "Rimozione di uno stack");
  assert.equal(
    dettaglioDi("mcp__shinka__avvia_stack", { host: "192.168.1.20:22", nome: "prova-blog", servizi: [] }),
    "prova-blog su 192.168.1.20:22",
  );
  assert.equal(dettaglioDi("mcp__shinka__elenca_stack", {}), "");
  assert.equal(dettaglioDi("mcp__shinka__elenca_stack", { host: "nas.lan:22" }), "nas.lan:22");
  assert.equal(dettaglioDi("mcp__shinka__leggi_stack", undefined), "");
});

test("il comando per un host si mostra per intero solo quando l'azione è quella", () => {
  assert.equal(comandoSuHost("mcp__shinka__esegui_su_host", { credenziale: "nas", host: "nas.lan", comando: "docker stop plex" }), "docker stop plex");
  assert.equal(comandoSuHost("mcp__shinka__esegui_su_host", {}), undefined);
  assert.equal(comandoSuHost("Bash", { comando: "ls" }), undefined);
});

test("l'ora in breve ha sempre due cifre per i minuti", () => {
  assert.equal(oraInBreve(new Date(2026, 10, 12, 9, 5).toISOString()), "9:05");
  assert.equal(oraInBreve("non una data"), "");
});

test("lo strumento di un'estensione si riconosce dal nome dell'estensione, e mostra ciò che gli viene mandato", () => {
  assert.equal(etichettaDi("mcp__meteo__previsioni_di_oggi"), "meteo: previsioni_di_oggi");
  assert.equal(etichettaDi("mcp__shinka__proponi_estensione"), "Proposta di un'estensione");
  assert.equal(dettaglioDi("mcp__shinka__proponi_estensione", { nome: "meteo", ambiente: "Unraid" }), "meteo");
  assert.equal(etichettaDi("mcp__shinka__elenca_estensioni"), "Estensioni");
  // Di uno strumento di terzi Shinka non sa quale campo conta: il proprietario vede tutto ciò che parte.
  assert.equal(dettaglioDi("mcp__meteo__previsioni", { luogo: "Padova", giorni: 3 }), '{"luogo":"Padova","giorni":3}');
  assert.equal(dettaglioDi("mcp__meteo__previsioni", {}), "");
  const lungo = dettaglioDi("mcp__meteo__previsioni", { testo: "x".repeat(900) });
  assert.equal(lungo.length, 401);
  assert.ok(lungo.endsWith("…"));
});

test("la dimensione di un file si legge in breve", () => {
  assert.equal(pesoInBreve(0), "0 byte");
  assert.equal(pesoInBreve(820), "820 byte");
  assert.equal(pesoInBreve(12_345), "12 kB");
  assert.equal(pesoInBreve(3_400_000), "3,4 MB");
  assert.equal(pesoInBreve(12_600_000), "13 MB");
});

test("di un ambiente si dice a che versione è, e se è indietro rispetto al centro", () => {
  const nodo = { attivo: true, delCentro: false };
  assert.equal(versioneAmbiente({ attivo: true, delCentro: true, versione: "d8462b37" }), "Versione d8462b37");
  assert.equal(versioneAmbiente({ ...nodo, versione: "d8462b37" }), "Versione d8462b37");
  assert.equal(versioneAmbiente({ ...nodo, versione: "2b171f4a", indietro: true }), "Versione 2b171f4a · indietro rispetto al centro");
  // Un nodo che non dice la versione: di prima che la dicessero, o avviato da una cartella qualunque.
  assert.equal(versioneAmbiente({ ...nodo, indietro: true }), "Non dice a che versione è: può essere indietro rispetto al centro");
  // Dove non c'è nulla da dire non si scrive nulla: un centro senza versione scritta, un ambiente spento.
  assert.equal(versioneAmbiente({ attivo: true, delCentro: true }), undefined);
  assert.equal(versioneAmbiente(nodo), undefined);
  assert.equal(versioneAmbiente({ attivo: false, delCentro: false, versione: "2b171f4a", indietro: true }), undefined);
});

test("del collegamento di un nodo si dice se è cifrato o in chiaro; del centro e di un nodo spento nulla", () => {
  assert.deepEqual(collegamentoAmbiente({ attivo: true, delCentro: false, cifrato: true }), { testo: "Collegamento cifrato", inChiaro: false });
  assert.equal(collegamentoAmbiente({ attivo: true, delCentro: false, cifrato: false })?.inChiaro, true);
  assert.equal(collegamentoAmbiente({ attivo: true, delCentro: true }), undefined);
  assert.equal(collegamentoAmbiente({ attivo: false, delCentro: false }), undefined);
  // Un centro di prima non lo dice: non si inventa.
  assert.equal(collegamentoAmbiente({ attivo: true, delCentro: false }), undefined);
});
