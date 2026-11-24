/**
 * Gli incarichi (ADR 0051): chi guida un progetto affida un pezzo di lavoro a chi implementa, che lo
 * svolge in una conversazione a parte; permessi e domande arrivano nella conversazione del progetto,
 * e alla fine torna il resoconto con le misure.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import type { EventoConversazione, PortaConversazione } from "../protocollo/eventi.ts";
import {
  conversazioneDellIncarico,
  eIncarico,
  leggiChiImplementa,
  progettoDellaConversazione,
  type StatoChiImplementa,
} from "../protocollo/incarichi.ts";
import { STRUMENTI_COMUNI_SENZA_RICHIESTA, STRUMENTI_SOLO_DEI_PROGETTI, attesaDelloStrumento } from "../protocollo/strumenti.ts";
import type { Progetto } from "../protocollo/progetti.ts";
import { allestisci, ConversazioneFinta, finche, type Banco } from "../prove/banco.ts";
import { COOKIE_SESSIONE } from "./centro.ts";
import type { Esecutore } from "./esecutori.ts";
import { chiSvolge, durataInParole, Incarichi, leggiRichiestaIncarico, testoDellIncarico } from "./incarichi.ts";

async function chiImplementa(banco: Banco, idProgetto: string, scelta: Record<string, unknown> | null) {
  return banco.centro.inject({
    method: "PUT",
    url: `/api/progetti/${idProgetto}/chi-implementa`,
    cookies: { [COOKIE_SESSIONE]: await banco.entra() },
    payload: { chiImplementa: scelta },
  });
}

function eventi(banco: Banco, idProgetto: string): EventoConversazione[] {
  return (banco.lavori.canale(idProgetto)?.archiviati ?? []).map((archiviato) => archiviato.evento);
}

test("l'identificativo della conversazione di un incarico dice di quale progetto è", () => {
  const id = conversazioneDellIncarico("p-123", "ab12");
  assert.equal(eIncarico(id), true);
  assert.equal(eIncarico("p-123"), false);
  assert.equal(progettoDellaConversazione(id), "p-123");
  assert.equal(progettoDellaConversazione("p-123"), "p-123");
  assert.deepEqual(leggiChiImplementa({ motore: "codex", modello: " gpt-5.5 ", impegno: "medium", altro: 1 }), { motore: "codex", modello: "gpt-5.5", impegno: "medium" });
  assert.deepEqual(leggiChiImplementa({ motore: "marte", impegno: "tanto" }), {});
  assert.equal(leggiChiImplementa(null), undefined);
});

test("un incarico va scritto con che cosa fare e i criteri; un altro modello solo se chiesto", () => {
  assert.match((leggiRichiestaIncarico({ criteri: "passa" }) as { motivo: string }).motivo, /Manca l'incarico/);
  assert.match((leggiRichiestaIncarico({ incarico: "fai" }) as { motivo: string }).motivo, /criteri/);
  assert.match((leggiRichiestaIncarico({ incarico: "x".repeat(20_001), criteri: "c" }) as { motivo: string }).motivo, /troppo lungo/);
  const richiesta = leggiRichiestaIncarico({ incarico: " Scrivi somma ", criteri: "npm test passa", file: ["a.ts", 3, " "], impegno: "low", modello: "codex:gpt-5.5" });
  assert.ok(!("motivo" in richiesta));
  assert.deepEqual(richiesta.file, ["a.ts"]);
  const testo = testoDellIncarico(richiesta);
  assert.match(testo, /^# Incarico\n\nScrivi somma/);
  assert.match(testo, /# File pertinenti\n\n- a\.ts/);
  assert.match(testo, /# Criteri di accettazione\n\nnpm test passa/);

  // Senza una scelta del proprietario e senza un modello chiesto, nessuno svolge l'incarico.
  assert.equal(chiSvolge(undefined, { incarico: "a", criteri: "b" }), undefined);
  assert.deepEqual(chiSvolge({ modello: "sonnet", impegno: "high" }, { incarico: "a", criteri: "b", impegno: "low" }), { modello: "sonnet", impegno: "low" });
  // Un modello chiesto per un incarico solo: con il motore davanti cambia anche il motore.
  assert.deepEqual(chiSvolge({ motore: "claude", modello: "sonnet" }, { incarico: "a", criteri: "b", modello: "codex:gpt-5.5" }), { motore: "codex", modello: "gpt-5.5" });
  assert.deepEqual(chiSvolge({ motore: "claude", modello: "sonnet" }, { incarico: "a", criteri: "b", modello: "opus" }), { motore: "claude", modello: "opus" });
  assert.deepEqual(chiSvolge(undefined, { incarico: "a", criteri: "b", modello: "haiku" }), { modello: "haiku" });

  assert.equal(durataInParole(45_400), "45 s");
  assert.equal(durataInParole(192_000), "3 min 12 s");
  assert.equal(durataInParole(3 * 3600_000 + 60_000), "3 h 1 min");
});

test("affidare un incarico non chiede il permesso, è solo dei progetti, e il nodo ne aspetta la fine", () => {
  assert.ok(STRUMENTI_COMUNI_SENZA_RICHIESTA.includes("affida_incarico"));
  assert.ok(STRUMENTI_SOLO_DEI_PROGETTI.includes("affida_incarico"));
  assert.ok(attesaDelloStrumento("affida_incarico", {}) >= 3 * 60 * 60 * 1000);
});

test("senza chi implementa il lavoro resta a chi guida; scelto, l'incarico gira a parte e riporta", async (t) => {
  const banco = await allestisci(t);
  const progetto = await banco.lavori.crea("Calcoli", "centro", "Una libreria di calcoli.");
  await finche(() => banco.conversazioniLocali.length === 1, "il progetto apre la sua conversazione");
  const guida = banco.conversazioniLocali[0];
  assert.ok(guida !== undefined);
  // Chi guida sa degli incarichi e ha lo strumento.
  assert.match(guida.configurazione?.istruzioniAggiunte ?? "", /affida_incarico/);

  const senza = await banco.comuniDelProgetto(progetto.id, "affida_incarico", { incarico: "Scrivi somma", criteri: "npm test passa" });
  assert.equal(senza.errore, true);
  assert.match(senza.testo, /non ha scelto chi implementa/);
  assert.equal(banco.conversazioniLocali.length, 1);

  const scelta = await chiImplementa(banco, progetto.id, { modello: "sonnet", impegno: "medium" });
  assert.equal(scelta.statusCode, 200, scelta.body);
  assert.deepEqual(scelta.json() as StatoChiImplementa, { chiImplementa: { modello: "sonnet", impegno: "medium" } });
  const letta = await banco.centro.inject({ method: "GET", url: `/api/progetti/${progetto.id}/chi-implementa`, cookies: { [COOKIE_SESSIONE]: await banco.entra() } });
  assert.deepEqual(letta.json(), { chiImplementa: { modello: "sonnet", impegno: "medium" } });
  assert.ok(guida.annotazioni.some((nota) => nota.includes("ha scelto chi implementa: sonnet, impegno medium")));
  assert.equal((await chiImplementa(banco, "non-c-e", null)).statusCode, 404);

  const risposta = banco.comuniDelProgetto(progetto.id, "affida_incarico", {
    incarico: "Scrivi la funzione somma in src/somma.ts.",
    criteri: "npm test passa.",
    file: ["src/somma.ts"],
  });
  await finche(() => banco.conversazioniLocali.length === 2, "l'incarico apre la sua conversazione");
  const incarico = banco.conversazioniLocali[1];
  assert.ok(incarico !== undefined);
  const cfg = incarico.configurazione;
  assert.ok(cfg !== undefined);
  // Con il modello di chi implementa e i permessi del progetto, da capo, nella stessa cartella.
  assert.deepEqual(cfg.impostazioni, { modello: "sonnet", impegno: "medium", permessi: "modifiche-libere" });
  assert.equal(cfg.cartella, progetto.cartella);
  assert.equal(cfg.idSessione, undefined);
  assert.match(cfg.istruzioniAggiunte ?? "", /# Un incarico/);
  assert.doesNotMatch(cfg.istruzioniAggiunte ?? "", /# Stato del progetto/);
  assert.match(incarico.inviati[0] ?? "", /# Criteri di accettazione\n\nnpm test passa\./);

  // Un secondo incarico, mentre il primo lavora, non parte.
  const doppio = await banco.comuniDelProgetto(progetto.id, "affida_incarico", { incarico: "Altro", criteri: "c" });
  assert.match(doppio.testo, /già un incarico in corso/);
  // Chi svolge l'incarico non ne affida altri.
  const daDentro = await banco.comuniDelProgetto(conversazioneDellIncarico(progetto.id, "x"), "affida_incarico", { incarico: "Altro", criteri: "c" });
  assert.match(daDentro.testo, /Chi svolge un incarico non lo può fare/);

  // L'incarico si vede tra le attività del progetto, con il modello e l'ultimo strumento.
  incarico.emetti({ tipo: "azione-iniziata", idAzione: "a1", strumento: "Write", ingresso: { file_path: "src/somma.ts" } });
  const attivita = () => {
    const ricordato = banco.lavori.canale(progetto.id)?.ricordato("attivita");
    return ricordato?.tipo === "attivita" ? ricordato.attivita : [];
  };
  const inCorso = attivita().find((voce) => voce.id.startsWith("incarico-"));
  assert.equal(inCorso?.stato, "in-corso");
  assert.equal(inCorso?.ultimoStrumento, "Write");
  assert.match(inCorso?.tipoAgente ?? "", /sonnet/);
  // Le attività della conversazione di chi guida restano accanto a quella dell'incarico.
  guida.emetti({ tipo: "attivita", attivita: [{ id: "b1", genere: "comando", descrizione: "npm run dev", stato: "in-corso", inSfondo: true }] });
  assert.deepEqual(attivita().map((voce) => voce.id), ["b1", inCorso?.id]);

  // Un permesso di chi implementa arriva al proprietario nella conversazione del progetto, e si decide da lì.
  incarico.emetti({ tipo: "permesso-richiesto", idPermesso: "p1", idAzione: "a2", strumento: "Bash", ingresso: { command: "npm test" } });
  const chiesto = eventi(banco, progetto.id).find((evento) => evento.tipo === "permesso-richiesto");
  assert.ok(chiesto?.tipo === "permesso-richiesto");
  assert.match(chiesto.motivo ?? "", /Lo chiede sonnet, impegno medium, che svolge un incarico/);
  assert.equal(banco.lavori.stato().progetti[0]?.condizione, "aspetta-te");
  assert.equal(banco.lavori.decidiPermesso(progetto.id, "p1", "approvato"), true);
  assert.deepEqual(incarico.decisioni, [["p1", "approvato"]]);
  assert.ok(eventi(banco, progetto.id).some((evento) => evento.tipo === "permesso-deciso" && evento.idPermesso === "p1"));
  // Lì se ne vede anche la fine; delle altre azioni dell'incarico no.
  incarico.emetti({ tipo: "azione-conclusa", idAzione: "a2", esito: "3 test superati", errore: false });
  incarico.emetti({ tipo: "azione-conclusa", idAzione: "a1", esito: "scritto", errore: false });
  assert.deepEqual(
    eventi(banco, progetto.id).filter((evento) => evento.tipo === "azione-conclusa").map((evento) => evento.tipo === "azione-conclusa" && evento.idAzione),
    ["a2"],
  );

  incarico.emetti({ tipo: "stato", stato: { modello: "claude-sonnet-5-5" } });
  incarico.emetti({ tipo: "stato", stato: { modelloLocale: { modello: "qwen", vramPiccoMb: 23_700 } } });
  incarico.emetti({ tipo: "modifiche", idTurno: "t1", file: [{ percorso: "src/somma.ts", aggiunte: 5, tolte: 0, stato: "nuovo" }, { percorso: "package.json", aggiunte: 1, tolte: 1, stato: "cambiato" }] });
  incarico.emetti({ tipo: "testo-concluso", idTesto: "x1", testo: "Ho scritto somma in src/somma.ts; npm test: 3 su 3." });
  incarico.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 70_000, token: { ingresso: 12_000, uscita: 900 } });

  const esito = await risposta;
  assert.equal(esito.errore, undefined, esito.testo);
  assert.match(esito.testo, /^Incarico concluso da sonnet, impegno medium, cioè claude-sonnet-5-5 in \d+ s, con un'azione\./);
  assert.match(esito.testo, /Token: 12\.000 in ingresso, 900 in uscita\./);
  assert.match(esito.testo, /Scheda video: picco di 23\.700 MB occupati\./);
  assert.match(esito.testo, /File cambiati: src\/somma\.ts \(nuovo\), package\.json\./);
  assert.match(esito.testo, /Resoconto di chi implementa:\nHo scritto somma/);
  assert.equal(incarico.chiusa, true);

  const finito = attivita().find((voce) => voce.id === inCorso?.id);
  assert.equal(finito?.stato, "finita");
  assert.match(finito?.riassunto ?? "", /^Concluso da sonnet/);
  const uscita = await banco.lavori.uscitaAttivita(progetto.id, inCorso?.id ?? "");
  assert.ok("testo" in uscita);
  assert.match(uscita.testo, /→ Write\n\nHo scritto somma/);

  // Le misure restano nel registro degli incarichi.
  const registro = join(banco.cartella, "incarichi.jsonl");
  await finche(() => existsSync(registro) && readFileSync(registro, "utf8").endsWith("\n"), "l'incarico lascia le sue misure");
  const righe = (await readFile(registro, "utf8")).trim().split("\n");
  const misura = JSON.parse(righe.at(-1) ?? "{}") as Record<string, unknown>;
  assert.equal(misura.idProgetto, progetto.id);
  assert.equal(misura.esito, "riuscito");
  assert.equal(misura.modello, "sonnet");
  assert.equal(misura.modelloVero, "claude-sonnet-5-5");
  assert.deepEqual(misura.token, { ingresso: 12_000, uscita: 900 });
  assert.equal(misura.file, 2);
  assert.equal(misura.vramPiccoMb, 23_700);

  // Tornato a un modello solo, la conversazione lo sa.
  assert.equal((await chiImplementa(banco, progetto.id, null)).statusCode, 200);
  assert.ok(guida.annotazioni.some((nota) => nota.includes("non vuole più un modello che implementa")));
  assert.equal(banco.progetti.chiImplementa(progetto.id), undefined);
});

test("fermato il progetto si ferma anche l'incarico, e ciò che aspettava il proprietario si chiude", async (t) => {
  const banco = await allestisci(t);
  const progetto = await banco.lavori.crea("Calcoli", "centro", "Una libreria di calcoli.");
  await finche(() => banco.conversazioniLocali.length === 1, "il progetto apre la sua conversazione");
  await chiImplementa(banco, progetto.id, { motore: "claude", modello: "haiku" });

  // Il proprietario ha chiesto un altro modello per questo incarico.
  const risposta = banco.comuniDelProgetto(progetto.id, "affida_incarico", { incarico: "Rinomina", criteri: "compila", modello: "opus" });
  await finche(() => banco.conversazioniLocali.length === 2, "l'incarico apre la sua conversazione");
  const incarico = banco.conversazioniLocali[1];
  assert.ok(incarico !== undefined);
  assert.deepEqual(incarico.configurazione?.impostazioni, { motore: "claude", modello: "opus", permessi: "modifiche-libere" });

  incarico.emetti({ tipo: "domande-poste", idDomande: "d1", domande: [{ domanda: "Quale nome?", intestazione: "Nome", opzioni: [{ etichetta: "a" }, { etichetta: "b" }], piuScelte: false }] });
  incarico.emetti({ tipo: "permesso-richiesto", idPermesso: "p9", idAzione: "a9", strumento: "Bash", ingresso: { command: "rm -rf dist" } });
  assert.equal(banco.lavori.rispondiDomande(progetto.id, "d1", { tipo: "risposte", risposte: ["a"] }), true);
  assert.deepEqual(incarico.risposteAlleDomande, [["d1", { tipo: "risposte", risposte: ["a"] }]]);

  await banco.lavori.interrompi(progetto.id);
  assert.equal(incarico.interruzioni, 1);
  incarico.emetti({ tipo: "turno-concluso", riuscito: false, durataMs: 5000, interrotto: true });
  const esito = await risposta;
  assert.equal(esito.errore, true);
  assert.match(esito.testo, /^Incarico fermato dal proprietario da opus di Claude/);
  assert.match(esito.testo, /Chi implementa non ha scritto un resoconto\./);
  // Il permesso rimasto in attesa non aspetta più.
  assert.ok(eventi(banco, progetto.id).some((evento) => evento.tipo === "permesso-deciso" && evento.idPermesso === "p9" && evento.decisione === "negato"));
  assert.equal(banco.lavori.canale(progetto.id)?.sospesi.permessi, 0);
  assert.ok(eventi(banco, progetto.id).some((evento) => evento.tipo === "azione-conclusa" && evento.idAzione === "a9" && evento.errore));
});

test("un incarico che supera il tempo massimo si ferma, e uno che non parte lo dice", async () => {
  const conversazioni: { porta: ConversazioneFinta; alEvento: (evento: EventoConversazione) => void }[] = [];
  let rifiuta = false;
  const esecutore = {
    apriConversazione: (_id: string, _cartella: string, _sessione: unknown, _imp: unknown, alEvento: (evento: EventoConversazione) => void): PortaConversazione => {
      if (rifiuta) throw new Error("L'ambiente è spento.");
      const porta = new ConversazioneFinta();
      conversazioni.push({ porta, alEvento });
      return porta;
    },
  } as unknown as Esecutore;
  const pubblicati: EventoConversazione[] = [];
  const incarichi = new Incarichi({
    esecutore: () => esecutore,
    pubblica: (_id, evento) => pubblicati.push(evento),
    attivitaCambiate: () => {},
    estensioni: () => undefined,
    durataMassimaMs: 50,
  });
  const progetto: Progetto = { id: "p1", nome: "P", cartella: "/tmp/p", idAmbiente: "centro", creatoIl: "", brief: "" };

  const lento = incarichi.affida(progetto, { modello: "sonnet" }, "chiedi", { incarico: "Lento", criteri: "c" });
  await finche(() => conversazioni[0]?.porta.interruzioni === 1, "il tempo massimo ferma l'incarico");
  conversazioni[0]?.alEvento({ tipo: "turno-concluso", riuscito: false, durataMs: 50, interrotto: true });
  const esito = await lento;
  assert.equal(esito.errore, true);
  assert.match(esito.testo, /fermato dopo 0 s, il tempo massimo/);
  assert.equal(incarichi.inCorso("p1"), false);

  rifiuta = true;
  const fallito = await incarichi.affida(progetto, { modello: "sonnet" }, "chiedi", { incarico: "Altro", criteri: "c" });
  assert.match(fallito.testo, /L'incarico non è partito: L'ambiente è spento\./);
  assert.equal(incarichi.inCorso("p1"), false);
});
