import assert from "node:assert/strict";
import { test } from "node:test";
import {
  comandoDellaPreparazione,
  consigliateMancanti,
  haLeSkillDiPartenza,
  leggiEstensioniScelte,
  leggiPreparazione,
  preparazioneDa,
  preparazioneDelNome,
  primoMessaggio,
  sceltePredefinite,
  skillPredefinita,
  type EstensionePerProgetto,
} from "./avvio-progetto.ts";

const MATT: EstensionePerProgetto = { nome: "mattpocock-skills", genere: "plugin", provenienza: "shinka", accesa: true };
const CODEGRAPH: EstensionePerProgetto = {
  nome: "codegraph",
  genere: "server",
  provenienza: "shinka",
  accesa: true,
  preparazione: { tipo: "indice-codegraph", pacchetto: "@colbymchenry/codegraph@1.6.2" },
};
const IMMAGINI: EstensionePerProgetto = { nome: "codex-imagegen", genere: "server", provenienza: "shinka", accesa: true };

test("spuntate all'inizio sono le consigliate accese; le altre restano da scegliere", () => {
  assert.deepEqual(sceltePredefinite([IMMAGINI, CODEGRAPH, MATT]), ["codegraph", "mattpocock-skills"]);
  // Spenta nell'ambiente non si sceglie; installata per conto suo c'è sempre, e non serve spuntarla.
  assert.deepEqual(sceltePredefinite([{ ...CODEGRAPH, accesa: false }, { ...MATT, provenienza: "ambiente" }]), []);
});

test("la scheda sa quali consigliate mancano nell'ambiente", () => {
  assert.deepEqual(consigliateMancanti([MATT, CODEGRAPH]), []);
  assert.deepEqual(consigliateMancanti([MATT, { ...CODEGRAPH, accesa: false }]), ["codegraph"]);
  assert.deepEqual(consigliateMancanti([{ ...CODEGRAPH, provenienza: "ambiente", accesa: true }]), ["mattpocock-skills"]);
});

test("le skill di partenza ci sono solo con il loro plugin, scelto o installato nell'ambiente", () => {
  assert.equal(haLeSkillDiPartenza([MATT], ["mattpocock-skills"]), true);
  assert.equal(haLeSkillDiPartenza([MATT], []), false);
  assert.equal(haLeSkillDiPartenza([{ ...MATT, provenienza: "ambiente" }], []), true);
  assert.equal(haLeSkillDiPartenza([{ ...MATT, accesa: false }], ["mattpocock-skills"]), false);
});

test("la skill consigliata dipende dalla cartella, e il primo messaggio comincia con il suo comando", () => {
  assert.equal(skillPredefinita(""), "grill-me");
  assert.equal(skillPredefinita("  "), "grill-me");
  assert.equal(skillPredefinita("/mnt/user/lavori/blog"), "grill-with-docs");
  assert.equal(primoMessaggio("Un blog.\n\nCon i commenti.", "grill-me"), "/mattpocock-skills:grill-me Un blog.\n\nCon i commenti.");
  assert.equal(primoMessaggio("Un blog.", "grill-with-docs"), "/mattpocock-skills:grill-with-docs Un blog.");
  assert.equal(primoMessaggio("Un blog."), "Un blog.");
});

test("CodeGraph chiede il suo indice: il pacchetto viene dalla definizione, ed è l'unico che si può lanciare", () => {
  assert.deepEqual(
    preparazioneDa({ tipo: "mcp-locale", comando: "npx", argomenti: ["-y", "@colbymchenry/codegraph@1.6.2", "serve", "--mcp"], variabili: {} }),
    { tipo: "indice-codegraph", pacchetto: "@colbymchenry/codegraph@1.6.2" },
  );
  assert.equal(preparazioneDa({ tipo: "mcp-locale", comando: "uv", argomenti: ["run", "altro"], variabili: {} }), undefined);
  assert.equal(preparazioneDa({ tipo: "mcp-remoto", indirizzo: "https://esempio.it/mcp", trasporto: "http" }), undefined);
  assert.deepEqual(preparazioneDelNome("CodeGraph"), { tipo: "indice-codegraph", pacchetto: "@colbymchenry/codegraph" });
  assert.equal(preparazioneDelNome("altro"), undefined);
  assert.equal(comandoDellaPreparazione({ tipo: "indice-codegraph", pacchetto: "@colbymchenry/codegraph@1.6.2" }), "npx -y @colbymchenry/codegraph@1.6.2 init -y .");
  assert.deepEqual(leggiPreparazione({ tipo: "indice-codegraph", pacchetto: "@colbymchenry/codegraph" }), {
    tipo: "indice-codegraph",
    pacchetto: "@colbymchenry/codegraph",
  });
  for (const pacchetto of ["@colbymchenry/codegraph; rm -rf /", "altro-pacchetto", "@colbymchenry/codegraph@$(id)", 3]) {
    assert.equal(leggiPreparazione({ tipo: "indice-codegraph", pacchetto }), undefined, String(pacchetto));
  }
});

test("le estensioni scelte arrivate da fuori passano solo se sono un elenco di nomi", () => {
  assert.deepEqual(leggiEstensioniScelte(["codegraph", "codegraph", "mattpocock-skills"]), ["codegraph", "mattpocock-skills"]);
  assert.deepEqual(leggiEstensioniScelte([]), []);
  assert.equal(leggiEstensioniScelte(undefined), undefined);
  assert.equal(leggiEstensioniScelte(["", "x"]), undefined);
  assert.equal(leggiEstensioniScelte([3]), undefined);
});
