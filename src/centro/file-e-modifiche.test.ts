import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { allestisci, avviaNodoAccettato, finche, ID_NODO, type Banco } from "../prove/banco.ts";
import { COOKIE_SESSIONE } from "./centro.ts";

async function chiedi(banco: Banco, method: "GET" | "POST", url: string, payload?: Record<string, unknown>) {
  const risposta = await banco.centro.inject({ method, url, cookies: { [COOKIE_SESSIONE]: await banco.entra() }, ...(payload === undefined ? {} : { payload }) });
  return risposta;
}

async function progettoConFile(banco: Banco, idAmbiente = "centro"): Promise<{ id: string; cartella: string }> {
  const progetto = await banco.lavori.crea("Videogioco", idAmbiente, "Un gioco di piattaforme.");
  const cartella = banco.progetti.trova(progetto.id)?.cartella ?? "";
  mkdirSync(join(cartella, "src"), { recursive: true });
  writeFileSync(join(cartella, "src", "gioco.ts"), "const vite = 3;\n");
  writeFileSync(join(cartella, "pagina.html"), "<script>alert(1)</script>");
  writeFileSync(join(cartella, "foto.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  return { id: progetto.id, cartella };
}

test("il pannello File sfoglia, cerca e legge i file di un progetto, e un file non agisce mai come una pagina di Shinka", async (t) => {
  const banco = await allestisci(t);
  const { id } = await progettoConFile(banco);
  const elenco = await chiedi(banco, "GET", `/api/progetti/${id}/file`);
  assert.equal(elenco.statusCode, 200);
  assert.ok((elenco.json() as { voci: { nome: string }[] }).voci.some((voce) => voce.nome === "src"));
  assert.deepEqual((await chiedi(banco, "GET", `/api/progetti/${id}/file/cerca?q=gioco`)).json(), { percorsi: ["src/gioco.ts"], incompleta: false });

  const codice = await chiedi(banco, "GET", `/api/progetti/${id}/file/contenuto?percorso=src/gioco.ts`);
  assert.equal(codice.body, "const vite = 3;\n");
  assert.equal(codice.headers["content-type"], "text/plain; charset=utf-8");
  const pagina = await chiedi(banco, "GET", `/api/progetti/${id}/file/contenuto?percorso=pagina.html`);
  assert.equal(pagina.headers["content-type"], "text/plain; charset=utf-8");
  assert.match(String(pagina.headers["content-security-policy"]), /sandbox/);
  assert.equal(pagina.headers["x-content-type-options"], "nosniff");
  const foto = await chiedi(banco, "GET", `/api/progetti/${id}/file/contenuto?percorso=foto.png`);
  assert.equal(foto.headers["content-type"], "image/png");
  assert.equal(foto.rawPayload.length, 4);

  assert.equal((await chiedi(banco, "GET", `/api/progetti/${id}/file/contenuto?percorso=../progetti.json`)).statusCode, 409);
  assert.equal((await chiedi(banco, "GET", `/api/progetti/${id}/file?percorso=/etc`)).statusCode, 409);
  assert.equal((await chiedi(banco, "GET", `/api/progetti/inesistente/file`)).statusCode, 409);
  // Senza sessione non si legge nulla.
  assert.equal((await banco.centro.inject({ method: "GET", url: `/api/progetti/${id}/file/contenuto?percorso=src/gioco.ts` })).statusCode, 401);
});

test("i file di un progetto su un nodo passano dal suo collegamento", async (t) => {
  const banco = await allestisci(t);
  const nodo = await avviaNodoAccettato(t, banco);
  const { id } = await progettoConFile(banco, ID_NODO);
  await finche(() => nodo.conversazioni.length === 1, "il progetto nasce sul nodo");
  assert.deepEqual((await chiedi(banco, "GET", `/api/progetti/${id}/file/cerca?q=gioco`)).json(), { percorsi: ["src/gioco.ts"], incompleta: false });
  assert.equal((await chiedi(banco, "GET", `/api/progetti/${id}/file/contenuto?percorso=src/gioco.ts`)).body, "const vite = 3;\n");
});

test("le modifiche di un turno si leggono, si accettano e si annullano dal pannello", async (t) => {
  const banco = await allestisci(t);
  const { id } = await progettoConFile(banco);
  await finche(() => banco.conversazioniLocali.length === 1, "il progetto apre la sua conversazione");
  const conversazione = banco.conversazioniLocali[0];
  assert.ok(conversazione !== undefined);
  conversazione.emetti({
    tipo: "modifiche",
    idTurno: "t1",
    file: [
      { percorso: "src/gioco.ts", aggiunte: 1, tolte: 1, stato: "cambiato" },
      { percorso: "src/nuovo.ts", aggiunte: 2, tolte: 0, stato: "nuovo" },
    ],
  });
  conversazione.versioni.set("t1:src/gioco.ts", { prima: "const vite = 3;\n", dopo: "const vite = 5;\n" });

  assert.deepEqual((await chiedi(banco, "GET", `/api/progetti/${id}/modifiche/t1/versioni?percorso=src/gioco.ts`)).json(), { prima: "const vite = 3;\n", dopo: "const vite = 5;\n" });
  assert.equal((await chiedi(banco, "GET", `/api/progetti/${id}/modifiche/t1/versioni?percorso=altro.ts`)).statusCode, 409);

  // Non c'è nulla da accettare: ciò che non si riporta resta com'è.
  assert.equal((await chiedi(banco, "POST", `/api/progetti/${id}/modifiche/t1/accetta`, { percorsi: ["src/nuovo.ts"] })).statusCode, 404);

  const annullate = await chiedi(banco, "POST", `/api/progetti/${id}/modifiche/t1/annulla`, { percorsi: ["src/gioco.ts"] });
  assert.deepEqual(annullate.json(), { annullati: ["src/gioco.ts"], nonAnnullati: [] });
  assert.deepEqual(conversazione.annullamenti, [["t1", ["src/gioco.ts"]]]);

  // Nella storia del progetto restano il turno e le decisioni, per il pannello e per la chat.
  const decisi = banco.lavori.canale(id)?.archiviati.flatMap(({ evento }) => (evento.tipo === "modifiche-decise" ? [[evento.esito, evento.percorsi]] : []));
  assert.deepEqual(decisi, [["annullate", ["src/gioco.ts"]]]);
});
