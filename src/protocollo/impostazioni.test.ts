import assert from "node:assert/strict";
import { test } from "node:test";
import { leggiAllegati, nomeSicuro, PESO_MASSIMO_ALLEGATI } from "./allegati.ts";
import { applicaModifica, leggiImpostazioni } from "./impostazioni.ts";

test("una modifica cambia solo ciò che nomina", () => {
  const attuali = { modello: "opus", impegno: "high", permessi: "modifiche-libere" } as const;
  assert.deepEqual(applicaModifica(attuali, { impegno: "max" }), {
    modello: "opus",
    impegno: "max",
    permessi: "modifiche-libere",
  });
  assert.deepEqual(applicaModifica(attuali, { permessi: "automatico" }), {
    modello: "opus",
    impegno: "high",
    permessi: "automatico",
  });
  assert.deepEqual(applicaModifica(attuali, {}), attuali);
});

test("una voce riportata al valore predefinito sparisce dalle impostazioni", () => {
  const attuali = { modello: "opus", impegno: "high", permessi: "chiedi" } as const;
  assert.deepEqual(applicaModifica(attuali, { modello: null, impegno: null }), { permessi: "chiedi" });
  assert.deepEqual(applicaModifica(attuali, { modello: "   " }), { impegno: "high", permessi: "chiedi" });
});

test("impostazioni arrivate da fuori valgono solo se ben formate", () => {
  assert.deepEqual(leggiImpostazioni({ modello: " sonnet ", impegno: "xhigh", permessi: "senza-permessi" }), {
    modello: "sonnet",
    impegno: "xhigh",
    permessi: "senza-permessi",
  });
  // Un impegno o un modello che non si capiscono tornano al predefinito; un modo sconosciuto invalida tutto.
  assert.deepEqual(leggiImpostazioni({ impegno: "enorme", modello: 7, permessi: "chiedi" }), { permessi: "chiedi" });
  assert.equal(leggiImpostazioni({ modello: "opus", permessi: "tutto-libero" }), undefined);
  assert.equal(leggiImpostazioni({ modello: "opus" }), undefined);
  assert.equal(leggiImpostazioni(undefined), undefined);
  assert.equal(leggiImpostazioni("chiedi"), undefined);
});

test("gli allegati ben formati vengono accettati, e nessun allegato è un caso valido", () => {
  assert.deepEqual(leggiAllegati(undefined), []);
  assert.deepEqual(leggiAllegati([]), []);
  const foto = { nome: "foto.png", tipo: "image/png", dati: "aGVsbG8=" };
  assert.deepEqual(leggiAllegati([foto, { ...foto, extra: 1 }]), [foto, foto]);
});

test("allegati malformati, troppi o troppo pesanti vengono rifiutati in blocco", () => {
  const foto = { nome: "foto.png", tipo: "image/png", dati: "aGVsbG8=" };
  assert.equal(leggiAllegati("foto.png"), undefined);
  assert.equal(leggiAllegati([{ ...foto, nome: "  " }]), undefined);
  assert.equal(leggiAllegati([{ ...foto, dati: "non è base64!" }]), undefined);
  assert.equal(leggiAllegati([{ nome: "foto.png", tipo: "image/png" }]), undefined);
  assert.equal(leggiAllegati(Array.from({ length: 9 }, () => foto)), undefined);
  const pesante = { ...foto, dati: "A".repeat(PESO_MASSIMO_ALLEGATI / 2 + 4) };
  assert.equal(leggiAllegati([pesante, pesante]), undefined);
});

test("il nome con cui si salva un allegato non porta mai fuori dalla sua cartella", () => {
  assert.equal(nomeSicuro("relazione finale.pdf"), "relazione finale.pdf");
  assert.equal(nomeSicuro("../../etc/passwd"), "passwd");
  assert.equal(nomeSicuro("C:\\Users\\io\\segreti.txt"), "segreti.txt");
  assert.equal(nomeSicuro(".env"), "env");
  assert.equal(nomeSicuro("a<b>c:d|e?f*g.txt"), "a_b_c_d_e_f_g.txt");
  assert.equal(nomeSicuro("riga\nnuova.txt"), "riga_nuova.txt");
  assert.equal(nomeSicuro("..."), "allegato");
  assert.equal(nomeSicuro(""), "allegato");
  assert.equal(nomeSicuro("cartella/"), "allegato");
});

test("lo stile scelto entra e esce dalle impostazioni, e da fuori vale solo se ben formato", () => {
  const stile = { id: "conciso", nome: "Conciso", istruzioni: "Rispondi breve." };
  const conStile = applicaModifica({ permessi: "chiedi" }, { stile });
  assert.deepEqual(conStile, { permessi: "chiedi", stile });
  // Cambiare altro non tocca lo stile; null lo toglie.
  assert.deepEqual(applicaModifica(conStile, { impegno: "low" }), { impegno: "low", permessi: "chiedi", stile });
  assert.deepEqual(applicaModifica(conStile, { stile: null }), { permessi: "chiedi" });
  assert.deepEqual(leggiImpostazioni({ permessi: "chiedi", stile }), { permessi: "chiedi", stile });
  assert.deepEqual(leggiImpostazioni({ permessi: "chiedi", stile: { id: "x", nome: "", istruzioni: "y" } }), { permessi: "chiedi" });
  assert.deepEqual(leggiImpostazioni({ permessi: "chiedi", stile: { id: "x", nome: "X", istruzioni: "y".repeat(5000) } }), { permessi: "chiedi" });
});

test("il motore si sceglie e torna al predefinito come il modello", () => {
  const attuali = { modello: "opus", permessi: "chiedi" } as const;
  assert.deepEqual(applicaModifica(attuali, { motore: "codex", modello: null }), { motore: "codex", permessi: "chiedi" });
  assert.deepEqual(applicaModifica({ motore: "codex", permessi: "chiedi" }, { motore: null }), { permessi: "chiedi" });
  assert.deepEqual(leggiImpostazioni({ motore: "codex", permessi: "chiedi" }), { motore: "codex", permessi: "chiedi" });
  assert.deepEqual(leggiImpostazioni({ motore: "gemini", permessi: "chiedi" }), { permessi: "chiedi" });
});

test("le cartelle in più: si scrivono per intero, valgono solo i percorsi completi, null le toglie, e si rileggono", () => {
  const con = applicaModifica({ permessi: "chiedi" }, { cartelleInPiu: ["C:\\Users\\mario\\AppData", "/srv/dati", "relativa", "/srv/dati", ""] });
  assert.deepEqual(con.cartelleInPiu, ["C:\\Users\\mario\\AppData", "/srv/dati"]);
  assert.deepEqual(applicaModifica(con, { impegno: "high" }).cartelleInPiu, ["C:\\Users\\mario\\AppData", "/srv/dati"]);
  assert.equal(applicaModifica(con, { cartelleInPiu: null }).cartelleInPiu, undefined);
  assert.deepEqual(leggiImpostazioni(JSON.parse(JSON.stringify(con)))?.cartelleInPiu, ["C:\\Users\\mario\\AppData", "/srv/dati"]);
});
