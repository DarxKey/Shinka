import assert from "node:assert/strict";
import { test } from "node:test";
import type { EventoConversazione, PortaConversazione, ScambioDellaStoria } from "../protocollo/eventi.ts";
import type { ImpostazioniConversazione, ModelloDisponibile, Motore } from "../protocollo/impostazioni.ts";
import { leggiSessioni } from "../protocollo/sessioni.ts";
import type { ConfigurazioneConversazione } from "./conversazione.ts";
import { apriConversazione, notaDelPassaggio } from "./motore.ts";
import { ModelliDeiMotori, type SondaDeiModelli } from "./sonde-motori.ts";

/** Una conversazione finta di un motore: ricorda ciò che riceve. */
class Finta implements PortaConversazione {
  readonly motore: Motore;
  readonly cfg: ConfigurazioneConversazione;
  readonly ricevuti: string[] = [];
  storiaFinta: ScambioDellaStoria[] = [];
  chiusa = false;
  constructor(motore: Motore, cfg: ConfigurazioneConversazione) {
    this.motore = motore;
    this.cfg = cfg;
  }
  preparata = 0;
  prepara(): void {
    this.preparata += 1;
  }
  invia(testo: string): void {
    this.ricevuti.push(`invia:${testo}`);
  }
  annota(testo: string): void {
    this.ricevuti.push(`annota:${testo.split("\n")[0]}`);
  }
  istruisci(testo: string): void {
    this.ricevuti.push(`istruisci:${testo}`);
  }
  imposta(impostazioni: ImpostazioniConversazione): void {
    this.ricevuti.push(`imposta:${impostazioni.modello ?? ""}`);
  }
  decidiPermesso(): boolean {
    return false;
  }
  async interrompi(): Promise<void> {}
  chiudi(): void {
    this.chiusa = true;
  }
  async storia(): Promise<ScambioDellaStoria[]> {
    // Come quella vera, la storia si legge dopo: chi prepara il test fa in tempo a riempirla.
    await null;
    return this.storiaFinta;
  }
}

function prepara(
  impostazioni: ImpostazioniConversazione,
  idSessione?: string,
  predefinito: Motore = "claude",
  altro: { sonda?: SondaDeiModelli; locali?: ModelloDisponibile[] } = {},
) {
  const aperte: Finta[] = [];
  const eventi: EventoConversazione[] = [];
  const sessioni: string[] = [];
  const sondati: Motore[] = [];
  const modelli = new ModelliDeiMotori(async (motore) => {
    sondati.push(motore);
    if (altro.sonda !== undefined) return altro.sonda(motore);
    return motore === "codex" ? [{ valore: "gpt-5.5", nome: "GPT-5.5", descrizione: "" }] : undefined;
  });
  const locali = altro.locali;
  const porta = apriConversazione(
    {
      cartella: "/tmp/x",
      istruzioni: "claude-code",
      strumenti: "claude-code",
      strumentiSenzaRichiesta: [],
      impostazioni,
      ...(idSessione === undefined ? {} : { idSessione }),
      alEvento: (evento) => eventi.push(evento),
      alIdSessione: (id) => sessioni.push(id),
      ...(locali === undefined ? {} : { modelliLocali: { modelli: () => locali } as unknown as NonNullable<ConfigurazioneConversazione["modelliLocali"]> }),
    },
    {
      predefinito,
      modelli,
      apri: (cfg, motore) => {
        const finta = new Finta(motore, cfg);
        aperte.push(finta);
        return finta;
      },
    },
  );
  return { porta, aperte, eventi, sessioni, sondati };
}

const attesa = () => new Promise((risolvi) => setImmediate(risolvi));

test("senza scelta lavora il motore predefinito, con la sua sessione", () => {
  const { porta, aperte, sessioni } = prepara({ permessi: "chiedi" }, "s-1", "claude");
  assert.equal(aperte[0]?.motore, "claude");
  assert.equal(aperte[0]?.cfg.idSessione, "s-1");
  porta.invia("ciao");
  assert.deepEqual(aperte[0]?.ricevuti, ["invia:ciao"]);
  // La sessione di Claude resta un identificativo semplice.
  aperte[0]?.cfg.alIdSessione("s-2");
  assert.deepEqual(sessioni, ["s-2"]);
});

test("cambiare motore passa al nuovo gli ultimi scambi, e ognuno tiene la sua sessione", async () => {
  const { porta, aperte, eventi, sessioni } = prepara({ permessi: "chiedi" }, "s-1");
  const claude = aperte[0]!;
  claude.storiaFinta = [
    { chi: "proprietario", testo: "Ricordati la parola mela." },
    { chi: "motore", testo: "Ricordata." },
  ];
  porta.imposta({ motore: "codex", permessi: "chiedi" });
  const codex = aperte[1]!;
  assert.equal(codex.motore, "codex");
  assert.equal(codex.cfg.idSessione, undefined);
  assert.ok(eventi.some((evento) => evento.tipo === "nota" && evento.testo.includes("Codex")));
  // I comandi e i limiti di Claude non valgono più: si tolgono, e Codex si prepara per dire i suoi senza aspettare un messaggio.
  const cambiato = eventi.findLast((evento) => evento.tipo === "stato");
  assert.ok(cambiato?.tipo === "stato" && cambiato.stato.motore === "codex");
  assert.deepEqual([cambiato.stato.comandi, cambiato.stato.limiti], [[], {}]);
  await attesa();
  await attesa();
  assert.equal(codex.preparata, 1);
  assert.deepEqual(codex.ricevuti.map((riga) => riga.split(":")[0]), ["annota"]);
  porta.invia("Quale parola?");
  await attesa();
  await attesa();
  assert.equal(claude.chiusa, true);
  assert.deepEqual(codex.ricevuti, [
    "annota:[Shinka] Il proprietario ha passato questa conversazione da Claude a Codex: fin qui ha risposto Claude, in una sessione che tu non vedi. Questi sono i suoi scambi con il proprietario, perché tu possa continuare da dove sono arrivati. Le azioni fatte allora non sono ripetute qui: i file sono come li hanno lasciati.",
    "invia:Quale parola?",
  ]);
  codex.cfg.alIdSessione("t-1");
  assert.deepEqual(leggiSessioni(sessioni.at(-1)), { ultimo: "codex", sessioni: { claude: "s-1", codex: "t-1" } });

  // Tornando a Claude si riprende la sua sessione.
  codex.storiaFinta = [{ chi: "motore", testo: "Mela." }];
  porta.imposta({ motore: "claude", permessi: "chiedi" });
  assert.equal(aperte[2]?.motore, "claude");
  assert.equal(aperte[2]?.cfg.idSessione, "s-1");
  porta.invia("E adesso?");
  await attesa();
  await attesa();
  assert.deepEqual(leggiSessioni(sessioni.at(-1)), { ultimo: "claude", sessioni: { claude: "s-1", codex: "t-1" } });
});

test("un cambio di motore durante un turno aspetta che il turno finisca", () => {
  const { porta, aperte } = prepara({ permessi: "chiedi" });
  aperte[0]?.cfg.alEvento({ tipo: "turno-iniziato" });
  porta.imposta({ motore: "codex", permessi: "chiedi" });
  assert.equal(aperte.length, 1);
  aperte[0]?.cfg.alEvento({ tipo: "turno-concluso", riuscito: true, durataMs: 1 });
  assert.equal(aperte[1]?.motore, "codex");
});

test("le altre impostazioni passano al motore in uso", () => {
  const { porta, aperte } = prepara({ permessi: "chiedi" });
  porta.imposta({ modello: "opus", permessi: "chiedi" });
  assert.deepEqual(aperte[0]?.ricevuti, ["imposta:opus"]);
  assert.equal(aperte.length, 1);
});

test("se il motore è cambiato a conversazione chiusa, il passaggio si fa alla riapertura", async () => {
  const { porta, aperte } = prepara({ motore: "codex", permessi: "chiedi" }, "s-1");
  // La conversazione di Claude si apre solo per leggere la sua storia.
  const codex = aperte.find((finta) => finta.motore === "codex")!;
  const claude = aperte.find((finta) => finta.motore === "claude")!;
  claude.storiaFinta = [{ chi: "proprietario", testo: "Ciao." }];
  porta.invia("Eccomi");
  await attesa();
  await attesa();
  assert.equal(claude.chiusa, true);
  assert.equal(codex.ricevuti.length, 2);
  assert.ok(codex.ricevuti[0]?.startsWith("annota:"));
});

test("il menu ha i modelli di tutti e due i motori, ciascuno con il suo", async () => {
  const { aperte, eventi, sondati } = prepara({ permessi: "chiedi" });
  aperte[0]?.cfg.alEvento({ tipo: "stato", stato: { modelli: [{ valore: "opus", nome: "Opus", descrizione: "" }] } });
  await attesa();
  await attesa();
  assert.deepEqual(sondati, ["codex"]);
  const ultimo = eventi.filter((evento) => evento.tipo === "stato").at(-1);
  assert.ok(ultimo?.tipo === "stato");
  assert.equal(ultimo.stato.motore, "claude");
  assert.deepEqual(
    ultimo.stato.modelli?.map((modello) => `${modello.motore}:${modello.valore}`),
    ["claude:opus", "codex:gpt-5.5"],
  );
});

test("aperta dopo un riavvio, la conversazione dice i modelli senza aspettare un messaggio né un cambio di motore", async () => {
  const opus = { valore: "opus", nome: "Opus", descrizione: "" };
  const qwen = { valore: "locale:qwen", nome: "Qwen (in rete, PC)", descrizione: "", motore: "claude" as const };
  const { porta, aperte, eventi, sondati } = prepara({ motore: "claude", permessi: "chiedi" }, "s-1", "claude", {
    sonda: async (motore) => (motore === "claude" ? [opus] : undefined),
    locali: [qwen],
  });
  // Prima di sapere i modelli di Claude, uno stato non porta un elenco con i soli modelli locali:
  // toglierebbe dal menu quelli di Claude.
  aperte[0]?.cfg.alEvento({ tipo: "stato", stato: { inSfondo: 0 } });
  const primo = eventi.find((evento) => evento.tipo === "stato");
  assert.ok(primo?.tipo === "stato" && primo.stato.modelli === undefined);

  // Il proprietario apre la conversazione: il motore si sonda e l'elenco arriva, prima di ogni messaggio.
  porta.prepara();
  await attesa();
  await attesa();
  assert.equal(aperte[0]?.preparata, 1);
  assert.deepEqual(sondati.slice(0, 1), ["claude"]);
  const conModelli = eventi.filter((evento) => evento.tipo === "stato" && evento.stato.modelli !== undefined).at(-1);
  assert.ok(conModelli?.tipo === "stato");
  assert.deepEqual(conModelli.stato.modelli?.map((modello) => modello.valore), ["opus", "locale:qwen"]);
  assert.equal(conModelli.stato.motore, "claude");

  // Riaperta, i modelli già noti si dicono subito, senza sondare di nuovo.
  const quanti = eventi.length;
  porta.prepara();
  assert.ok(eventi.slice(quanti).some((evento) => evento.tipo === "stato" && evento.stato.modelli?.[0]?.valore === "opus"));
  await attesa();
  assert.equal(sondati.filter((motore) => motore === "claude").length, 1);
});

test("un ramo nato con Codex si riprende con Codex", async () => {
  const { porta, aperte } = prepara({ motore: "codex", permessi: "chiedi" });
  const codex = aperte[0]!;
  // Codex non sa ancora far nascere un ramo: lo dice.
  const esito = await porta.biforca!("m-1");
  assert.equal(esito.riuscita, false);
  Object.assign(codex, { biforca: async () => ({ riuscita: true, idSessione: "t-9" }) });
  const ramo = await porta.biforca!("m-1");
  assert.ok(ramo.riuscita);
  assert.deepEqual(leggiSessioni(ramo.idSessione), { ultimo: "codex", sessioni: { codex: "t-9" } });
});

test("la nota del passaggio tiene gli ultimi scambi finché ci stanno", () => {
  const lungo = "x".repeat(2_900);
  const storia: ScambioDellaStoria[] = Array.from({ length: 20 }, (_, i) => ({ chi: i % 2 === 0 ? "proprietario" : "motore", testo: `${i} ${lungo}` }));
  const nota = notaDelPassaggio("claude", "codex", storia)!;
  assert.ok(nota.includes("gli ultimi"));
  assert.ok(nota.includes("19 x"));
  assert.ok(!nota.includes("\n0 x"));
  assert.equal(notaDelPassaggio("claude", "codex", []), undefined);
  // La nota di un passaggio di prima non si ricopia.
  const prima = notaDelPassaggio("claude", "codex", [{ chi: "proprietario", testo: "Ciao." }])!;
  const dopo = notaDelPassaggio("codex", "claude", [{ chi: "proprietario", testo: prima }, { chi: "motore", testo: "Mela." }])!;
  assert.ok(!dopo.includes("Ciao."));
  assert.ok(dopo.includes("Codex: Mela."));
});

test("il predefinito vale per le conversazioni nuove: quelle già cominciate restano con il loro motore", () => {
  const cominciata = prepara({ permessi: "chiedi" }, "s-1", "codex");
  assert.equal(cominciata.aperte[0]?.motore, "claude");
  const nuova = prepara({ permessi: "chiedi" }, undefined, "codex");
  assert.equal(nuova.aperte[0]?.motore, "codex");
});
