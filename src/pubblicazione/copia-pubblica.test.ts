import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";
import { leggiVietati, preparaCopiaPubblica, PubblicazioneRifiutata, RAMO_PUBBLICO } from "./copia-pubblica.ts";

const VIETATI = leggiVietati("# ciò che non deve uscire\ncasa-mia\\.example\n\nvera@esempio\\.it\n");
const ADESSO = () => new Date("2026-11-22T10:00:00.000Z");

/** Un repository di lavoro provvisorio, con un commit per ogni chiamata a `registra`. */
function repository(t: TestContext) {
  const cartella = mkdtempSync(join(tmpdir(), "shinka-prova-pubblica-"));
  t.after(() => rmSync(cartella, { recursive: true, force: true }));
  const git = (...argomenti: string[]) =>
    execFileSync("git", argomenti, {
      cwd: cartella,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Persona Vera",
        GIT_AUTHOR_EMAIL: "vera@esempio.it",
        GIT_COMMITTER_NAME: "Persona Vera",
        GIT_COMMITTER_EMAIL: "vera@esempio.it",
        GIT_CONFIG_GLOBAL: join(cartella, "nessuna-configurazione"),
        GIT_CONFIG_NOSYSTEM: "1",
      },
    }).trim();
  git("init", "--quiet", "--initial-branch=main");
  const registra = (messaggio: string, file: Record<string, string | Buffer>) => {
    for (const [percorso, contenuto] of Object.entries(file)) {
      mkdirSync(dirname(join(cartella, percorso)), { recursive: true });
      writeFileSync(join(cartella, percorso), contenuto);
    }
    git("add", "--all");
    git("commit", "--quiet", "-m", messaggio);
    return git("rev-parse", "HEAD");
  };
  const prepara = () => preparaCopiaPubblica({ cartella, vietati: VIETATI, adesso: ADESSO });
  return { cartella, git, registra, prepara };
}

test("la prima pubblicazione è un commit solo, di Shinka, senza la storia e senza i file esclusi", (t) => {
  const r = repository(t);
  r.registra("Primo pezzo", { "src/a.ts": "uno\n", "STATO.md": "la rete di casa\n" });
  r.registra("Secondo pezzo", { "src/b.ts": "due\n" });

  const esito = r.prepara();

  assert.equal(esito.nuovi, 1);
  assert.equal(r.git("rev-parse", RAMO_PUBBLICO), esito.punta);
  assert.equal(r.git("rev-list", "--count", RAMO_PUBBLICO), "1");
  assert.equal(r.git("log", "-1", "--format=%an <%ae> %cn <%ce> | %s | %aI", RAMO_PUBBLICO), "Shinka <shinka@localhost> Shinka <shinka@localhost> | Prima pubblicazione di Shinka | 2026-11-22T10:00:00+00:00");
  assert.deepEqual(r.git("ls-tree", "-r", "--name-only", RAMO_PUBBLICO).split("\n"), ["src/a.ts", "src/b.ts"]);
  // Il ramo di lavoro non è stato toccato.
  assert.equal(r.git("log", "-1", "--format=%s", "main"), "Secondo pezzo");
  assert.equal(r.git("show", "main:STATO.md"), "la rete di casa");
});

test("dopo la prima, ogni commit del ramo di lavoro diventa un commit pubblico con lo stesso messaggio", (t) => {
  const r = repository(t);
  r.registra("Primo pezzo", { "src/a.ts": "uno\n", "STATO.md": "stato\n" });
  const prima = r.prepara();

  r.registra("Secondo pezzo\n\nCon una spiegazione.", { "src/b.ts": "due\n", "STATO.md": "stato nuovo\n" });
  r.registra("Solo lo stato", { "STATO.md": "stato più nuovo\n" });
  const terzo = r.registra("Terzo pezzo", { "src/a.ts": "uno, cambiato\n" });
  const esito = r.prepara();

  // Il commit che tocca solo un file escluso non compare.
  assert.equal(esito.nuovi, 2);
  assert.deepEqual(r.git("log", "--format=%s", RAMO_PUBBLICO).split("\n"), ["Terzo pezzo", "Secondo pezzo", "Prima pubblicazione di Shinka"]);
  assert.equal(r.git("log", "-1", "--format=%b", `${RAMO_PUBBLICO}~1`), "Con una spiegazione.");
  assert.equal(r.git("rev-parse", `${RAMO_PUBBLICO}~2`), prima.punta);
  assert.equal(r.git("log", "-1", "--format=%an %aI", RAMO_PUBBLICO), `Shinka ${r.git("log", "-1", "--format=%aI", terzo)}`);
  assert.equal(r.git("show", `${RAMO_PUBBLICO}:src/a.ts`), "uno, cambiato");
  assert.deepEqual(r.git("ls-tree", "-r", "--name-only", RAMO_PUBBLICO).split("\n"), ["src/a.ts", "src/b.ts"]);

  // Rifatta senza novità, non aggiunge nulla.
  assert.deepEqual(r.prepara(), { nuovi: 0, punta: esito.punta });
});

test("un'espressione vietata in un file ferma tutto, e dice dove senza ripeterla", (t) => {
  const r = repository(t);
  r.registra("Primo pezzo", { "src/a.ts": "uno\n" });
  const prima = r.prepara();

  r.registra("Pezzo pulito", { "src/b.ts": "due\n" });
  r.registra("Pezzo con l'indirizzo", { "docs/guida.md": "riga uno\nApri https://Casa-Mia.example/shinka\n" });
  r.registra("Pezzo che lo toglie", { "docs/guida.md": "riga uno\n" });

  assert.throws(r.prepara, (errore: Error) => {
    assert.ok(errore instanceof PubblicazioneRifiutata);
    assert.match(errore.message, /docs\/guida\.md:2/);
    assert.doesNotMatch(errore.message, /casa-mia/i);
    return true;
  });
  // Nemmeno il commit pulito che veniva prima è stato pubblicato: o tutti o nessuno.
  assert.equal(r.git("rev-parse", RAMO_PUBBLICO), prima.punta);
});

test("un'espressione vietata nel messaggio o nel nome di un file ferma la pubblicazione", (t) => {
  const conMessaggio = repository(t);
  conMessaggio.registra("Primo pezzo", { "a.txt": "uno\n" });
  conMessaggio.prepara();
  conMessaggio.registra("Pezzo per casa-mia.example", { "b.txt": "due\n" });
  assert.throws(conMessaggio.prepara, /il messaggio del commit/);

  const conNome = repository(t);
  conNome.registra("Primo pezzo", { "note/casa-mia.example.txt": "niente\n" });
  assert.throws(conNome.prepara, /il nome del file note\/casa-mia\.example\.txt/);
  assert.throws(() => conNome.git("rev-parse", "--verify", "--quiet", RAMO_PUBBLICO));
});

test("la prima pubblicazione guarda tutti i file, non i binari, e non l'autore dei commit", (t) => {
  const r = repository(t);
  // L'autore dei commit di prova ha un'email vietata: nella copia pubblica non entra.
  r.registra("Primo pezzo", { "immagine.bin": Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from("casa-mia.example")]), "a.txt": "uno\n" });
  assert.equal(r.prepara().nuovi, 1);
  assert.doesNotMatch(r.git("log", "--format=%an %ae %cn %ce", RAMO_PUBBLICO), /vera/i);

  const sporco = repository(t);
  sporco.registra("Primo pezzo", { "a.txt": "uno\n", "b.txt": "scrivi a Vera@Esempio.it\n" });
  assert.throws(sporco.prepara, /b\.txt:1/);
});

test("se la storia del ramo di lavoro è stata riscritta, o manca l'elenco dei vietati, non pubblica", (t) => {
  const r = repository(t);
  r.registra("Primo pezzo", { "a.txt": "uno\n" });
  r.registra("Secondo pezzo", { "b.txt": "due\n" });
  const prima = r.prepara();

  assert.throws(() => preparaCopiaPubblica({ cartella: r.cartella, vietati: [] }), /vuoto/);

  r.git("reset", "--quiet", "--hard", "HEAD~1");
  r.registra("Un altro secondo pezzo", { "c.txt": "tre\n" });
  assert.throws(r.prepara, /riscritta/);
  assert.equal(r.git("rev-parse", RAMO_PUBBLICO), prima.punta);
});
