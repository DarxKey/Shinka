// La pagina del vault. Parla solo con il gateway che l'ha servita: la frase di sblocco e i
// valori delle credenziali non passano dal centro di Shinka, e nessun valore torna mai indietro.

"use strict";

const radice = document.getElementById("radice");
const FRASE_MINIMA = 12;
const MESI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];

/** Crea un elemento. Il testo entra sempre come testo, mai come HTML. */
function el(nome, attributi, ...figli) {
  const elemento = document.createElement(nome);
  for (const [chiave, valore] of Object.entries(attributi ?? {})) {
    if (valore === undefined || valore === false) continue;
    if (chiave === "classe") elemento.className = valore;
    else if (valore === true) elemento.setAttribute(chiave, "");
    else elemento.setAttribute(chiave, valore);
  }
  for (const figlio of figli.flat()) {
    if (figlio === undefined || figlio === null || figlio === false) continue;
    elemento.append(figlio);
  }
  return elemento;
}

async function chiama(metodo, percorso, corpo) {
  const risposta = await fetch(percorso, {
    method: metodo,
    credentials: "same-origin",
    ...(corpo === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) }),
  });
  const dati = await risposta.json().catch(() => ({}));
  if (!risposta.ok) {
    const errore = new Error(typeof dati.errore === "string" ? dati.errore : `Il gateway ha risposto ${risposta.status}.`);
    errore.stato = risposta.status;
    throw errore;
  }
  return dati;
}

function momento(quando) {
  const data = new Date(quando);
  if (Number.isNaN(data.getTime())) return "";
  const minuti = String(data.getMinutes()).padStart(2, "0");
  const anno = data.getFullYear() === new Date().getFullYear() ? "" : ` ${data.getFullYear()}`;
  return `${data.getDate()} ${MESI[data.getMonth()]}${anno}, ${data.getHours()}:${minuti}`;
}

/** Il controllo che aspetta l'abbinamento del bot: uno solo, e si ferma quando la pagina cambia. */
let attesaTelegram;

function mostra(...contenuto) {
  clearInterval(attesaTelegram);
  radice.replaceChildren(...contenuto.flat().filter((parte) => parte !== undefined && parte !== false));
}

function testata(condizione, pulsanti) {
  return el(
    "header",
    { classe: "testata" },
    el(
      "div",
      { classe: "titoli" },
      el("h1", {}, "Vault di Shinka"),
      condizione !== undefined &&
        el("span", { classe: `stato ${condizione === "aperto" ? "aperto" : "chiuso"}` }, condizione === "aperto" ? "aperto" : "chiuso"),
    ),
    pulsanti,
  );
}

/** Un modulo con un solo invio alla volta e l'errore mostrato sotto. */
function modulo(campi, etichettaInvio, allInvio) {
  const errore = el("p", { classe: "errore", role: "alert", hidden: true });
  const invio = el("button", { type: "submit", classe: "primario" }, etichettaInvio);
  const forma = el("form", { autocomplete: "off" }, campi, el("div", { classe: "pulsanti" }, invio), errore);
  forma.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    invio.disabled = true;
    errore.hidden = true;
    try {
      await allInvio(forma);
    } catch (causa) {
      errore.textContent = causa instanceof Error ? causa.message : "Non è riuscito.";
      errore.hidden = false;
    } finally {
      invio.disabled = false;
    }
  });
  return forma;
}

function vistaDaImpostare() {
  const frase = el("input", { type: "password", id: "frase", autocomplete: "new-password", required: true, minlength: FRASE_MINIMA });
  const ripetuta = el("input", { type: "password", id: "ripetuta", autocomplete: "new-password", required: true });
  mostra(
    testata(undefined),
    el(
      "p",
      {},
      "Il vault custodisce le credenziali che Claude usa sui tuoi host e nei siti senza mai vederle. Prima di tutto scegli la frase di sblocco.",
    ),
    el(
      "div",
      { classe: "scheda" },
      modulo(
        [
          el("label", { for: "frase" }, "Frase di sblocco ", el("span", { classe: "tenue" }, `(almeno ${FRASE_MINIMA} caratteri)`)),
          frase,
          el("label", { for: "ripetuta" }, "Ripetila"),
          ripetuta,
          el(
            "p",
            { classe: "tenue" },
            "La scriverai qui dopo ogni riavvio del gateway. Non è conservata da nessuna parte: se la dimentichi, le credenziali del vault non si recuperano e vanno inserite di nuovo.",
          ),
        ],
        "Imposta il vault",
        async () => {
          if (frase.value !== ripetuta.value) throw new Error("Le due frasi non coincidono.");
          await chiama("POST", "/vault/frase", { frase: frase.value });
          await disegna();
        },
      ),
    ),
    el("h2", {}, "Oppure: hai una copia del vault"),
    el(
      "div",
      { classe: "scheda" },
      moduloDellaCopia("Carica la copia", "Il vault nasce con le credenziali della copia, e la sua frase di sblocco è quella della copia."),
    ),
  );
  frase.focus();
}

function vistaSblocco(condizione, domande) {
  const frase = el("input", { type: "password", id: "frase", autocomplete: "current-password", required: true });
  mostra(
    testata(condizione),
    domande > 0 &&
      el(
        "p",
        { classe: "richiamo" },
        domande === 1
          ? "Il gateway aspetta una tua risposta: la vedi dopo aver scritto la frase."
          : `Il gateway aspetta ${domande} tue risposte: le vedi dopo aver scritto la frase.`,
      ),
    el(
      "p",
      {},
      condizione === "aperto"
        ? "Il vault è aperto e Claude può usare le credenziali. Per vederle o cambiarle scrivi la frase di sblocco."
        : "Il vault è chiuso: finché non lo sblocchi, Claude non può usare nessuna credenziale né il browser del gateway.",
    ),
    el(
      "div",
      { classe: "scheda" },
      modulo([el("label", { for: "frase" }, "Frase di sblocco"), frase], condizione === "aperto" ? "Entra" : "Sblocca", async () => {
        await chiama("POST", "/vault/sblocco", { frase: frase.value });
        await disegna();
      }),
    ),
  );
  frase.focus();
}

/** Il modulo per inserire una credenziale nuova, oppure per sostituirne una che c'è già. */
function moduloCredenziale(daSostituire, allaFine) {
  const nome = el("input", {
    type: "text",
    id: "nome",
    required: true,
    maxlength: 48,
    placeholder: "nas-root",
    autocapitalize: "none",
    spellcheck: "false",
  });
  const utente = el("input", { type: "text", id: "utente", required: true, maxlength: 254, placeholder: "root", autocapitalize: "none", spellcheck: "false" });
  const host = el("textarea", { id: "host", required: true, placeholder: "192.168.1.10\nnas.lan:2222", autocapitalize: "none", spellcheck: "false" });
  const password = el("input", { type: "password", id: "password", autocomplete: "off" });
  const chiave = el("textarea", { id: "chiave", classe: "chiave", autocomplete: "off", spellcheck: "false", placeholder: "-----BEGIN OPENSSH PRIVATE KEY-----" });
  const fraseChiave = el("input", { type: "password", id: "frase-chiave", autocomplete: "off" });
  const conPassword = el("input", { type: "radio", name: "tipo", value: "password", id: "tipo-password", checked: true });
  const conChiave = el("input", { type: "radio", name: "tipo", value: "chiave", id: "tipo-chiave" });
  const perSito = el("input", { type: "radio", name: "tipo", value: "sito", id: "tipo-sito" });
  // La chiave di un'estensione: l'unica voce il cui valore esce dal gateway, verso il programma dell'estensione.
  const perEstensione = el("input", { type: "radio", name: "tipo", value: "estensione", id: "tipo-estensione" });
  const estensione = el("input", { type: "text", id: "estensione", maxlength: 40, placeholder: "github", autocapitalize: "none", spellcheck: "false" });
  const campiEstensione = el(
    "div",
    { hidden: true },
    el("label", { for: "estensione" }, "Estensione ", el("span", { classe: "tenue" }, "(il suo nome, com'è nella pagina Estensioni di Shinka)")),
    estensione,
  );
  const avvisoEstensione = el(
    "p",
    { classe: "tenue", hidden: true },
    "Questa è l'unica voce del vault il cui valore esce dal gateway: viene consegnato al programma dell'estensione ogni volta che parte, negli ambienti scritti qui, e una conversazione di quell'ambiente potrebbe leggerlo. Usa una chiave fatta apposta, con i soli permessi che servono. Ogni consegna compare nel registro, senza il valore.",
  );
  // Un host su cui Claude avvia gli stack di prova: lo dichiara solo il proprietario, da qui.
  const perStack = el("input", { type: "checkbox", id: "per-stack" });
  const portaDa = el("input", { type: "number", id: "porta-da", min: 1024, max: 65535, placeholder: "7900", inputmode: "numeric" });
  const portaA = el("input", { type: "number", id: "porta-a", min: 1024, max: 65535, placeholder: "7999", inputmode: "numeric" });
  const cartellaStack = el("input", {
    type: "text",
    id: "cartella-stack",
    maxlength: 200,
    placeholder: "/mnt/user/appdata/shinka-stack",
    autocapitalize: "none",
    spellcheck: "false",
  });
  const dettagliStack = el(
    "div",
    { hidden: true },
    el(
      "div",
      { classe: "coppia" },
      el("div", {}, el("label", { for: "porta-da" }, "Porte dedicate, dalla"), portaDa),
      el("div", {}, el("label", { for: "porta-a" }, "alla"), portaA),
    ),
    el("label", { for: "cartella-stack" }, "Cartella dei volumi ", el("span", { classe: "tenue" }, "(sull'host, usata solo per gli stack di Shinka)")),
    cartellaStack,
    el(
      "p",
      { classe: "tenue" },
      "Su questo host Claude avvia, ferma e rimuove da sé soltanto gli stack creati da Shinka: container con il nome e l'etichetta di Shinka, porte in questo intervallo, volumi in questa cartella. Per ogni altro comando sullo stesso host ti chiede l'approvazione. Serve Docker con Compose, e un utente che possa usarlo.",
    ),
  );
  // Il server su cui gira Shinka: lì ogni comando aspetta un sì dato al gateway, non al centro.
  const perServer = el("input", { type: "checkbox", id: "per-server" });
  const dettagliServer = el(
    "p",
    { classe: "tenue", hidden: true },
    "Chi comanda su questo host può tutto, anche sul gateway e su questo vault. Per questo ogni comando aspetta il tuo sì, e quel sì lo chiede il gateway stesso: con un pulsante su Telegram che solo lui può mandare, oppure in questa pagina. Il centro di Shinka non lo può dare al tuo posto.",
  );
  const campiStack = el(
    "div",
    { classe: "stack-host" },
    el("label", { for: "per-stack", classe: "spunta" }, perStack, "Host per gli stack di prova"),
    dettagliStack,
    el("div", {}, el("label", { for: "per-server", classe: "spunta" }, perServer, "È il server su cui gira Shinka")),
    dettagliServer,
  );
  // Una credenziale in chiaro: di prova o a basso rischio, Claude ne può leggere il valore.
  const inChiaro = el("input", { type: "checkbox", id: "in-chiaro" });
  const avvisoInChiaro = el(
    "p",
    { classe: "avviso-in-chiaro", hidden: true },
    "Claude potrà leggere il valore di questa credenziale, per gli host o i siti scritti qui: finirà nella conversazione e nel suo archivio, come una password scritta in un file. Scegli «in chiaro» solo per credenziali di prova o a basso rischio. Potrai renderla protetta in seguito; una protetta, invece, non diventa mai in chiaro.",
  );
  const campiInChiaro = el(
    "div",
    {},
    el("label", { for: "in-chiaro", classe: "spunta" }, inChiaro, "In chiaro: Claude ne può leggere il valore"),
    avvisoInChiaro,
  );
  const etichettaUtente = el("label", { for: "utente" }, "Utente");
  const etichettaHost = el("label", { for: "host" });
  const etichettaPassword = el("label", { for: "password" }, "Password");
  const campiPassword = el("div", {}, etichettaPassword, password);
  const campiChiave = el(
    "div",
    { hidden: true },
    el("label", { for: "chiave" }, "Chiave privata ", el("span", { classe: "tenue" }, "(tutta, dalla riga BEGIN alla riga END)")),
    chiave,
    el("label", { for: "frase-chiave" }, "Frase della chiave ", el("span", { classe: "tenue" }, "(se ne ha una)")),
    fraseChiave,
  );
  const scegli = () => {
    campiPassword.hidden = conChiave.checked;
    campiChiave.hidden = !conChiave.checked;
    campiStack.hidden = perSito.checked || perEstensione.checked;
    dettagliStack.hidden = !perStack.checked;
    dettagliServer.hidden = !perServer.checked;
    campiEstensione.hidden = !perEstensione.checked;
    campiInChiaro.hidden = perEstensione.checked;
    avvisoInChiaro.hidden = !inChiaro.checked || perEstensione.checked;
    avvisoEstensione.hidden = !perEstensione.checked;
    etichettaPassword.textContent = perEstensione.checked ? "Valore della chiave" : "Password";
    etichettaUtente.textContent = perEstensione.checked
      ? "Nome della chiave: la variabile d'ambiente o l'intestazione che l'estensione dichiara"
      : perSito.checked
        ? "Nome utente o email con cui entri nel sito"
        : "Utente";
    utente.placeholder = perEstensione.checked ? "GITHUB_TOKEN" : perSito.checked ? "nome@esempio.it" : "root";
    host.placeholder = perEstensione.checked ? "Unraid" : perSito.checked ? "https://www.esempio.it" : "192.168.1.10\nnas.lan:2222";
    etichettaHost.replaceChildren(
      perEstensione.checked ? "Ambienti in cui viene consegnata " : perSito.checked ? "Siti in cui vale " : "Host su cui vale ",
      el(
        "span",
        { classe: "tenue" },
        perEstensione.checked
          ? "(uno per riga, con il nome che hanno in Shinka)"
          : perSito.checked
            ? "(uno per riga, come compare nella barra degli indirizzi alla pagina di accesso: conta il nome esatto)"
            : "(uno per riga; la porta dopo i due punti se non è la 22)",
      ),
    );
  };
  for (const scelta of [conPassword, conChiave, perSito, perEstensione, perStack, perServer, inChiaro]) scelta.addEventListener("change", scegli);
  scegli();

  if (daSostituire !== undefined) {
    nome.value = daSostituire.nome;
    nome.readOnly = true;
    utente.value = daSostituire.utente;
    host.value = daSostituire.host.join("\n");
    conChiave.checked = daSostituire.tipo === "chiave";
    perSito.checked = daSostituire.tipo === "sito";
    perEstensione.checked = daSostituire.tipo === "estensione";
    estensione.value = daSostituire.estensione ?? "";
    conPassword.checked = !conChiave.checked && !perSito.checked && !perEstensione.checked;
    if (daSostituire.stack !== undefined) {
      perStack.checked = true;
      portaDa.value = String(daSostituire.stack.porte.da);
      portaA.value = String(daSostituire.stack.porte.a);
      cartellaStack.value = daSostituire.stack.radice;
    }
    perServer.checked = daSostituire.server === true;
    inChiaro.checked = daSostituire.inChiaro === true;
    // Una credenziale protetta non diventa in chiaro, nemmeno sostituendola.
    inChiaro.disabled = daSostituire.inChiaro !== true;
    scegli();
  }

  return modulo(
    [
      el("label", { for: "nome" }, "Nome ", el("span", { classe: "tenue" }, "(Claude la chiede con questo nome: minuscole, cifre e trattini)")),
      nome,
      el(
        "div",
        { classe: "scelta", role: "radiogroup", "aria-label": "A che cosa serve" },
        el("label", { for: "tipo-password" }, conPassword, "Host, con password"),
        el("label", { for: "tipo-chiave" }, conChiave, "Host, con chiave SSH"),
        el("label", { for: "tipo-sito" }, perSito, "Sito"),
        el("label", { for: "tipo-estensione" }, perEstensione, "Chiave di un'estensione"),
      ),
      campiEstensione,
      etichettaUtente,
      utente,
      etichettaHost,
      host,
      campiPassword,
      campiChiave,
      campiStack,
      campiInChiaro,
      avvisoEstensione,
      daSostituire !== undefined &&
        el("p", { classe: "tenue" }, "Il valore va riscritto: quello custodito non si rilegge. Dopo la sostituzione di una credenziale per un host, l'host viene riconosciuto di nuovo al primo collegamento."),
    ],
    daSostituire === undefined ? "Inserisci nel vault" : "Sostituisci",
    async () => {
      const corpo = {
        nome: nome.value,
        tipo: conChiave.checked ? "chiave" : perSito.checked ? "sito" : perEstensione.checked ? "estensione" : "password",
        ...(perEstensione.checked ? { estensione: estensione.value.trim() } : {}),
        utente: utente.value,
        host: host.value.split(/[\n,]/).map((riga) => riga.trim()).filter((riga) => riga !== ""),
        segreto: conChiave.checked ? chiave.value : password.value,
        ...(conChiave.checked && fraseChiave.value !== "" ? { fraseDellaChiave: fraseChiave.value } : {}),
      };
      if (corpo.segreto === "") {
        throw new Error(conChiave.checked ? "Manca la chiave privata." : perEstensione.checked ? "Manca il valore della chiave." : "Manca la password.");
      }
      if (!perSito.checked && !perEstensione.checked && perStack.checked) {
        const da = Number(portaDa.value);
        const a = Number(portaA.value);
        if (portaDa.value === "" || portaA.value === "" || !Number.isInteger(da) || !Number.isInteger(a)) {
          throw new Error("Per gli stack di prova servono le due porte dell'intervallo dedicato.");
        }
        if (cartellaStack.value.trim() === "") throw new Error("Per gli stack di prova serve la cartella dei volumi.");
        corpo.stack = { porte: { da, a }, radice: cartellaStack.value.trim() };
      }
      if (!perSito.checked && !perEstensione.checked && perServer.checked) corpo.server = true;
      if (!perEstensione.checked && inChiaro.checked) corpo.inChiaro = true;
      await chiama(
        "POST",
        daSostituire === undefined ? "/vault/credenziali" : `/vault/credenziali/${encodeURIComponent(daSostituire.nome)}`,
        corpo,
      );
      // I valori non restano nella pagina un momento più del necessario.
      password.value = "";
      chiave.value = "";
      fraseChiave.value = "";
      await allaFine();
    },
  );
}

function vistaCredenziale(credenziale, ridisegna) {
  const corpo = el("div", {});
  const lettura = () => {
    const rimuovi = el("button", { type: "button", classe: "discreto piccolo" }, "Rimuovi");
    rimuovi.addEventListener("click", () => {
      const conferma = el("button", { type: "button", classe: "piccolo" }, "Conferma la rimozione");
      const annulla = el("button", { type: "button", classe: "discreto piccolo" }, "Annulla");
      const errore = el("span", { classe: "errore", role: "alert" });
      conferma.addEventListener("click", async () => {
        conferma.disabled = true;
        try {
          await chiama("POST", `/vault/credenziali/${encodeURIComponent(credenziale.nome)}/rimozione`);
          await ridisegna();
        } catch (causa) {
          errore.textContent = causa instanceof Error ? causa.message : "Non rimossa.";
          conferma.disabled = false;
        }
      });
      annulla.addEventListener("click", lettura);
      azioni.replaceChildren(conferma, annulla, errore);
    });
    const sostituisci = el("button", { type: "button", classe: "discreto piccolo" }, "Sostituisci");
    sostituisci.addEventListener("click", () => {
      const annulla = el("button", { type: "button", classe: "discreto piccolo" }, "Annulla");
      annulla.addEventListener("click", lettura);
      corpo.replaceChildren(moduloCredenziale(credenziale, ridisegna), el("div", { classe: "pulsanti" }, annulla));
    });
    const pulsanti = [sostituisci, rimuovi];
    if (credenziale.inChiaro === true) {
      const proteggi = el("button", { type: "button", classe: "discreto piccolo" }, "Rendi protetta");
      proteggi.addEventListener("click", () => {
        const conferma = el("button", { type: "button", classe: "piccolo" }, "Conferma: Claude non la leggerà più");
        const annulla = el("button", { type: "button", classe: "discreto piccolo" }, "Annulla");
        const errore = el("span", { classe: "errore", role: "alert" });
        conferma.addEventListener("click", async () => {
          conferma.disabled = true;
          try {
            await chiama("POST", `/vault/credenziali/${encodeURIComponent(credenziale.nome)}/protezione`);
            await ridisegna();
          } catch (causa) {
            errore.textContent = causa instanceof Error ? causa.message : "Non cambiata.";
            conferma.disabled = false;
          }
        });
        annulla.addEventListener("click", lettura);
        azioni.replaceChildren(conferma, annulla, errore);
      });
      pulsanti.unshift(proteggi);
    }
    const azioni = el("div", { classe: "pulsanti" }, ...pulsanti);
    corpo.replaceChildren(
      el(
        "div",
        { classe: "riga" },
        el("span", { classe: "nome" }, credenziale.nome),
        el(
          "span",
          { classe: "tenue" },
          credenziale.tipo === "estensione"
            ? `chiave ${credenziale.utente} dell'estensione ${credenziale.estensione ?? ""}`
            : `${credenziale.tipo === "chiave" ? "chiave SSH" : credenziale.tipo === "sito" ? "accesso a un sito" : "password"} · utente ${credenziale.utente}`,
        ),
      ),
      el("p", { classe: "host" }, credenziale.host.join(", ")),
      // `replaceChildren` scriverebbe "false" come testo: ciò che non c'è non va passato affatto.
      ...(credenziale.stack === undefined
        ? []
        : [
            el(
              "p",
              { classe: "segno-stack" },
              `Host per gli stack di prova · porte ${credenziale.stack.porte.da}–${credenziale.stack.porte.a} · volumi in ${credenziale.stack.radice}`,
            ),
          ]),
      ...(credenziale.server === true
        ? [el("p", { classe: "segno-stack" }, "Server di Shinka · ogni comando aspetta il tuo sì, dato al gateway")]
        : []),
      ...(credenziale.inChiaro === true
        ? [el("p", { classe: "segno-in-chiaro" }, "In chiaro · Claude ne può leggere il valore")]
        : []),
      el(
        "p",
        { classe: "tenue" },
        `Inserita il ${momento(credenziale.inseritaIl)}` +
          (credenziale.usataIl === undefined ? " · mai usata" : ` · usata l'ultima volta il ${momento(credenziale.usataIl)}`),
      ),
      azioni,
    );
  };
  lettura();
  return el("li", { classe: "scheda credenziale" }, corpo);
}

function vistaRegistro(voci) {
  if (voci.length === 0) return el("p", { classe: "tenue" }, "Ancora nessun uso.");
  return el(
    "ul",
    { classe: "registro" },
    voci.map((voce) =>
      el(
        "li",
        {},
        el(
          "div",
          {},
          el("span", { classe: `esito ${voce.esito}` }, voce.esito),
          ` · ${momento(voce.quando)} · ${voce.conversazione} · ${voce.credenziale === "" ? "senza credenziale" : voce.credenziale} → ${voce.host}`,
          voce.esito === "eseguito" && voce.codice !== undefined && voce.codice !== null ? ` · codice ${voce.codice}` : "",
        ),
        el("code", {}, voce.comando),
        voce.motivo !== undefined && el("div", { classe: "tenue" }, voce.motivo),
      ),
    ),
  );
}

/** Un pulsante che fa una cosa sola alla volta e scrive l'errore accanto. */
/**
 * Il modulo con cui si carica una copia del vault: il file e la frase con cui era cifrato. La
 * copia si legge qui e va al gateway, che la accetta solo se la frase la apre.
 */
function moduloDellaCopia(etichettaInvio, avviso) {
  const file = el("input", { type: "file", id: "file-copia", accept: ".json,application/json", required: true });
  const frase = el("input", { type: "password", id: "frase-copia", autocomplete: "off", required: true });
  return modulo(
    [
      el("label", { for: "file-copia" }, "Il file della copia"),
      file,
      el("label", { for: "frase-copia" }, "La frase di sblocco che il vault aveva quando è stata fatta"),
      frase,
      el("p", { classe: "tenue" }, avviso),
    ],
    etichettaInvio,
    async () => {
      const scelto = file.files?.[0];
      if (scelto === undefined) throw new Error("Scegli il file della copia.");
      if (scelto.size > 7 * 1024 * 1024) throw new Error("Questo file è troppo grande per essere una copia del vault.");
      let copia;
      try {
        copia = JSON.parse(await scelto.text());
      } catch {
        throw new Error("Questo file non è una copia del vault di Shinka.");
      }
      if (typeof copia !== "object" || copia === null) throw new Error("Questo file non è una copia del vault di Shinka.");
      await chiama("POST", "/vault/ripristino", { copia, frase: frase.value });
      await disegna();
    },
  );
}

/** La copia del vault, a vault aperto: scaricarla, o metterne una al posto di ciò che c'è. */
function sezioneCopia() {
  const carica = el(
    "details",
    {},
    el("summary", {}, "Carica una copia al posto di questo vault"),
    moduloDellaCopia(
      "Sostituisci il vault con la copia",
      "Le credenziali di adesso lasciano il posto a quelle della copia, e la frase di sblocco diventa quella della copia. Il vault di adesso resta sul server, cifrato, accanto a quello nuovo.",
    ),
  );
  return el(
    "div",
    { classe: "scheda" },
    el(
      "p",
      { classe: "tenue" },
      "La copia è il vault com'è, cifrato con la tua frase di sblocco: senza la frase non si legge. La scarichi da qui e non passa da Shinka né da una conversazione. Non contiene il bot di Telegram né il registro.",
    ),
    el("div", { classe: "pulsanti" }, el("a", { classe: "bottone", href: "/vault/copia", download: "" }, "Scarica la copia del vault")),
    carica,
  );
}

function pulsanteCheChiama(etichetta, classe, lavoro) {
  const pulsante = el("button", { type: "button", classe }, etichetta);
  const errore = el("span", { classe: "errore", role: "alert" });
  pulsante.addEventListener("click", async () => {
    pulsante.disabled = true;
    errore.textContent = "";
    try {
      await lavoro();
    } catch (causa) {
      errore.textContent = causa instanceof Error ? causa.message : "Non è riuscito.";
    } finally {
      pulsante.disabled = false;
    }
  });
  return [pulsante, errore];
}

/**
 * La sezione di Telegram: il token del bot e l'abbinamento con il proprietario. Il token si
 * scrive qui e non si rilegge; resta nel gateway, fuori dal vault, così il bot funziona anche
 * a vault chiuso.
 */
function sezioneTelegram(iniziale) {
  const sezione = el("section", { classe: "telegram" });

  const moduloToken = (etichetta, allaFine) => {
    const token = el("input", { type: "password", id: "token-telegram", autocomplete: "off", required: true, placeholder: "123456789:AA…" });
    return modulo([el("label", { for: "token-telegram" }, "Token del bot"), token], etichetta, async () => {
      const dati = await chiama("POST", "/vault/telegram/gettone", { gettone: token.value });
      token.value = "";
      allaFine(dati);
    });
  };

  const disegnaSezione = (dati, nota) => {
    clearInterval(attesaTelegram);
    const nomeBot = dati.bot === undefined ? "" : `@${dati.bot}`;
    const parti = [];

    if (dati.condizione === "da-configurare") {
      parti.push(
        el(
          "p",
          {},
          "Con un bot Telegram scrivi alla Home dal telefono, e ricevi lì gli avvisi dei progetti e le richieste di approvazione, con un pulsante per rispondere.",
        ),
        el(
          "p",
          { classe: "tenue" },
          "Crea il bot su Telegram scrivendo a @BotFather il comando /newbot, poi copia qui il token che ti dà. Il token resta nel gateway, in un file che legge solo lui: Claude non lo vede, e da questa pagina non si rilegge.",
        ),
        moduloToken("Salva il token", disegnaSezione),
      );
    } else {
      const problema = dati.condizione === "errore" && el("p", { classe: "errore", role: "alert" }, dati.problema ?? "Telegram non risponde come dovrebbe.");
      if (dati.proprietario === undefined) {
        parti.push(el("p", {}, `Il bot ${nomeBot} c'è, ma non sa ancora chi sei: finché non lo abbini a te non ascolta nessuno.`), problema);
        if (dati.codice === undefined) {
          parti.push(
            el(
              "div",
              { classe: "pulsanti" },
              pulsanteCheChiama("Abbina il bot a me", "primario", async () => disegnaSezione(await chiama("POST", "/vault/telegram/codice"))),
            ),
            el("p", { classe: "tenue" }, "Ti do un codice da mandare al bot dal tuo Telegram: chi lo manda diventa l'unico account che il bot ascolta."),
          );
        } else {
          parti.push(
            el("p", {}, "Manda questo codice al bot dal tuo Telegram:"),
            el("p", { classe: "codice-telegram", "aria-label": "Codice di abbinamento" }, dati.codice.valore),
            el(
              "p",
              {},
              el("a", { href: `https://t.me/${dati.bot}?start=${dati.codice.valore}`, target: "_blank", rel: "noreferrer" }, `Apri ${nomeBot} su Telegram`),
              " e premi «Avvia»: il codice parte da solo. Oppure apri il bot e scrivigli il codice.",
            ),
            el(
              "p",
              { classe: "tenue" },
              `Vale fino alle ${momento(dati.codice.scadeIl).split(", ")[1] ?? ""} e sopporta pochi tentativi sbagliati. Questa pagina si aggiorna da sola quando l'abbinamento riesce.`,
            ),
          );
          // Finché il codice vale, la pagina guarda se il bot è stato abbinato.
          attesaTelegram = setInterval(async () => {
            const adesso = await chiama("GET", "/vault/telegram").catch(() => undefined);
            if (adesso !== undefined && (adesso.proprietario !== undefined || adesso.codice === undefined)) disegnaSezione(adesso);
          }, 3000);
        }
      } else {
        const chi = dati.proprietario.nome + (dati.proprietario.utente === undefined ? "" : ` (@${dati.proprietario.utente})`);
        parti.push(
          el(
            "p",
            {},
            `Il bot ${nomeBot} è abbinato a ${chi}, dal ${momento(dati.proprietario.abbinatoIl)}. Ascolta solo questo account, in chat privata: chiunque altro viene ignorato, senza risposta.`,
          ),
          problema,
          el(
            "div",
            { classe: "pulsanti" },
            pulsanteCheChiama("Manda un messaggio di prova", "piccolo", async () =>
              disegnaSezione(await chiama("POST", "/vault/telegram/prova"), "Mandato: guarda su Telegram."),
            ),
            pulsanteCheChiama("Scollega", "discreto piccolo", async () => disegnaSezione(await chiama("POST", "/vault/telegram/scollegamento"))),
            nota !== undefined && el("span", { classe: "fatto", role: "status" }, nota),
          ),
        );
      }
      // Sostituire il token o togliere il bot: in fondo, dietro una conferma.
      const altro = el("div", { classe: "pulsanti" });
      const riposo = () => {
        const sostituisci = el("button", { type: "button", classe: "discreto piccolo" }, "Sostituisci il token");
        const rimuovi = el("button", { type: "button", classe: "discreto piccolo" }, "Togli il bot");
        const annulla = el("button", { type: "button", classe: "discreto piccolo" }, "Annulla");
        annulla.addEventListener("click", riposo);
        sostituisci.addEventListener("click", () => altro.replaceChildren(moduloToken("Sostituisci", disegnaSezione), annulla));
        rimuovi.addEventListener("click", () =>
          altro.replaceChildren(
            ...pulsanteCheChiama("Conferma: togli il bot", "piccolo", async () => disegnaSezione(await chiama("POST", "/vault/telegram/rimozione"))),
            annulla,
          ),
        );
        altro.replaceChildren(sostituisci, rimuovi);
      };
      riposo();
      parti.push(altro);
    }
    if (dati.ignorati > 0) {
      parti.push(
        el(
          "p",
          { classe: "tenue" },
          `Messaggi di altri mittenti ignorati da quando il gateway è acceso: ${dati.ignorati}` +
            (dati.ultimoIgnorato === undefined ? "." : `, l'ultimo il ${momento(dati.ultimoIgnorato)}.`),
        ),
      );
    }
    sezione.replaceChildren(el("div", { classe: "scheda" }, parti));
  };

  disegnaSezione(iniziale);
  return sezione;
}

/** Ciò che il gateway dice della propria versione, in una riga. */
function rigaVersione(diSe) {
  const versione = typeof diSe.versione === "string" ? `Gateway alla versione ${diSe.versione.slice(0, 8)}` : "Gateway";
  const come =
    diSe.siAggiorna === true
      ? "sa cambiare versione da solo, ma solo con il tuo sì dato qui o su Telegram"
      : "una versione nuova la può mettere solo chi lavora da fuori";
  const ultima = diSe.aggiornamento;
  const nota =
    ultima === undefined
      ? ""
      : ultima.stato === "in-corso"
        ? ` Sta installando la ${ultima.versione.slice(0, 8)}.`
        : ultima.stato === "non-riuscito"
          ? ` L'ultima versione proposta, la ${ultima.versione.slice(0, 8)}, non è entrata in funzione: ${ultima.motivo}`
          : "";
  return el("p", { classe: "tenue" }, `${versione}: ${come}.${nota}`);
}

/**
 * Le domande che il gateway fa al proprietario da sé: una versione nuova del gateway, un comando
 * sul server. La risposta data qui non passa dal centro di Shinka.
 */
function sezioneDomande(iniziali) {
  const sezione = el("section", { classe: "domande" });
  const disegnaSezione = (domande, nota) => {
    const aggiorna = pulsanteCheChiama("Aggiorna", "discreto piccolo", async () => disegnaSezione((await chiama("GET", "/vault/domande")).domande));
    if (domande.length === 0) {
      sezione.replaceChildren(
        el("h2", {}, "Richieste per te"),
        el("p", { classe: "tenue" }, nota ?? "Nessuna richiesta in attesa. ", ...aggiorna),
      );
      return;
    }
    sezione.replaceChildren(
      el("h2", {}, `Richieste per te (${domande.length})`),
      ...domande.map((domanda) => {
        const rispondi = (decisione, fatto) => async () => {
          const dati = await chiama("POST", `/vault/domande/${encodeURIComponent(domanda.id)}`, { decisione }).catch(async (causa) => {
            // La domanda può essere scaduta, o avere già avuto risposta su Telegram.
            if (causa instanceof Error && causa.stato === 404) return { ...(await chiama("GET", "/vault/domande")), sparita: true };
            throw causa;
          });
          disegnaSezione(dati.domande, dati.sparita === true ? "Quella richiesta non c'era più: era scaduta, o avevi già risposto. " : fatto);
        };
        return el(
          "div",
          { classe: "scheda domanda" },
          el("strong", {}, domanda.titolo),
          el("pre", { classe: "testo-domanda" }, domanda.testo),
          el("p", { classe: "tenue" }, `Scade il ${momento(domanda.scadeIl)}. Lo chiede il gateway: la risposta non passa dal centro di Shinka.`),
          el(
            "div",
            { classe: "pulsanti" },
            ...pulsanteCheChiama(domanda.si, "primario", rispondi("approvata", "Hai detto di sì. ")),
            ...pulsanteCheChiama("No", "", rispondi("negata", "Hai detto di no: non è stato fatto nulla. ")),
          ),
        );
      }),
      el("p", { classe: "tenue" }, ...aggiorna),
    );
  };
  disegnaSezione(iniziali);
  return sezione;
}

async function vistaAperta() {
  const dati = await chiama("GET", "/vault/credenziali");
  // Un gateway di prima non ha domande da fare: la sezione resta vuota.
  const diSe = await chiama("GET", "/vault/domande").catch((causa) => {
    if (causa instanceof Error && causa.stato === 404) return { domande: [] };
    throw causa;
  });
  // Un gateway senza bot non ha la sezione di Telegram.
  const telegram = await chiama("GET", "/vault/telegram").catch((causa) => {
    if (causa instanceof Error && causa.stato === 404) return undefined;
    throw causa;
  });
  const esci = el("button", { type: "button", classe: "discreto" }, "Esci");
  esci.addEventListener("click", async () => {
    await chiama("POST", "/vault/uscita").catch(() => {});
    await disegna();
  });
  const chiudi = el("button", { type: "button" }, "Chiudi il vault");
  chiudi.addEventListener("click", async () => {
    await chiama("POST", "/vault/chiusura").catch(() => {});
    await disegna();
  });
  mostra(
    testata("aperto", el("div", { classe: "pulsanti" }, esci, chiudi)),
    sezioneDomande(diSe.domande),
    el(
      "p",
      { classe: "tenue" },
      "Claude usa una credenziale chiedendola per nome, e solo sugli host e nei siti scritti qui: il valore non entra in una conversazione e da questa pagina non si rilegge. Su un host per gli stack di prova gestisce da sé soltanto gli stack creati da Shinka, e per ogni altro comando chiede la tua approvazione. Sul server su cui gira Shinka ogni comando aspetta un sì che dai al gateway, qui o su Telegram. Le eccezioni sono due: la chiave di un'estensione, che viene consegnata al programma di quell'estensione quando parte, negli ambienti scritti accanto; e le credenziali che segni «in chiaro», di prova o a basso rischio, di cui Claude legge il valore. «Esci» lascia il vault aperto per Claude; «Chiudi il vault» lo richiude finché non riscrivi la frase.",
    ),
    el("h2", {}, dati.credenziali.length === 0 ? "Credenziali" : `Credenziali (${dati.credenziali.length})`),
    dati.credenziali.length === 0
      ? el("p", { classe: "tenue" }, "Ancora nessuna.")
      : el("ul", { classe: "credenziali" }, dati.credenziali.map((credenziale) => vistaCredenziale(credenziale, disegna))),
    el("h2", {}, "Nuova credenziale"),
    el("div", { classe: "scheda" }, moduloCredenziale(undefined, disegna)),
    el("h2", {}, "Copia del vault"),
    sezioneCopia(),
    telegram !== undefined && el("h2", {}, "Telegram"),
    telegram !== undefined && sezioneTelegram(telegram),
    el("h2", {}, "Registro degli usi"),
    vistaRegistro(dati.registro),
    rigaVersione(diSe),
  );
}

async function disegna() {
  try {
    const stato = await chiama("GET", "/vault/stato");
    if (stato.condizione === "da-impostare") vistaDaImpostare();
    else if (!stato.dentro) vistaSblocco(stato.condizione, stato.domande ?? 0);
    else await vistaAperta();
  } catch (causa) {
    if (causa instanceof Error && causa.stato === 401) {
      // La sessione è scaduta mentre la pagina era aperta: si torna alla frase.
      const stato = await chiama("GET", "/vault/stato").catch(() => ({ condizione: "chiuso" }));
      vistaSblocco(stato.condizione === "aperto" ? "aperto" : "chiuso");
      return;
    }
    const riprova = el("button", { type: "button" }, "Riprova");
    riprova.addEventListener("click", () => void disegna());
    mostra(
      testata(undefined),
      el("p", { classe: "errore", role: "alert" }, causa instanceof Error ? causa.message : "Il gateway non risponde."),
      riprova,
    );
  }
}

void disegna();
