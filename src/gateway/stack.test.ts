import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { DockerDiProva } from "../prove/docker-di-prova.ts";
import { avviaHostDiProva } from "../prove/host-di-prova.ts";
import type { EsitoStack, RecintoStack } from "../protocollo/stack.ts";
import { Registro } from "./registro.ts";
import { componi, leggiDescrizione, preparazione, StackDiProva } from "./stack.ts";
import { Vault } from "./vault.ts";

const FRASE = "una frase di sblocco di prova";
const PASSWORD = "P4ssword-di-prova-da-non-vedere";
const RECINTO: RecintoStack = { porte: { da: 7900, a: 7999 }, radice: "/mnt/user/appdata/shinka-stack" };

const BLOG = {
  nome: "prova-blog",
  servizi: [
    {
      nome: "web",
      immagine: "nginx:alpine",
      porte: [{ host: 7900, container: 80 }],
      volumi: [
        { nome: "pagine", percorso: "/usr/share/nginx/html" },
        { nome: "dati", percorso: "/dati" },
      ],
      ambiente: { SALUTO: "ciao $HOME e 'apici'", NUMERO: 3 },
      memoria_mb: 128,
    },
  ],
  file: [{ volume: "pagine", percorso: "sotto/index.html", contenuto: "<h1>Costa 5$ — «àèìòù» 'apici'</h1>\n" }],
};

function rifiuto(scritta: unknown): string {
  try {
    leggiDescrizione(scritta, RECINTO);
  } catch (errore) {
    return errore instanceof Error ? errore.message : String(errore);
  }
  return "";
}

test("la descrizione di uno stack non può uscire dal recinto", () => {
  const servizio = BLOG.servizi[0];
  assert.match(rifiuto({ ...BLOG, servizi: [{ ...servizio, porte: [{ host: 8080, container: 80 }] }] }), /solo le porte da 7900 a 7999/);
  assert.match(rifiuto({ ...BLOG, servizi: [{ ...servizio, privileged: true }] }), /non ha un campo "privileged"/);
  assert.match(rifiuto({ ...BLOG, servizi: [{ ...servizio, network_mode: "host" }] }), /non ha un campo "network_mode"/);
  assert.match(rifiuto({ ...BLOG, volumes: {} }), /non ha un campo "volumes"/);
  assert.match(rifiuto({ ...BLOG, file: [], servizi: [{ ...servizio, volumi: [{ nome: "/etc", percorso: "/etc" }] }] }), /non si indica un percorso dell'host/);
  assert.match(rifiuto({ ...BLOG, file: [], servizi: [{ ...servizio, volumi: [{ nome: "dati", percorso: "/dati/../etc" }] }] }), /percorso assoluto del container/);
  assert.match(rifiuto({ ...BLOG, file: [{ volume: "pagine", percorso: "../fuori", contenuto: "x" }] }), /relativo al suo volume/);
  assert.match(rifiuto({ ...BLOG, file: [{ volume: "altro", percorso: "a", contenuto: "x" }] }), /nessun servizio monta/);
  assert.match(rifiuto({ ...BLOG, servizi: [{ ...servizio, immagine: "nginx; rm -rf /" }] }), /immagine valida/);
  assert.match(rifiuto({ ...BLOG, nome: "Con Spazi" }), /nome dello stack/);
  assert.match(rifiuto({ ...BLOG, servizi: [] }), /almeno un servizio/);
  assert.match(rifiuto({ ...BLOG, servizi: [servizio, { ...servizio, nome: "altro", volumi: [] }] }), /chiesta due volte/);
  assert.match(rifiuto({ ...BLOG, file: [{ volume: "pagine", percorso: "grande", contenuto: "x".repeat(60_001) }] }), /troppo lunghi/);
  assert.match(rifiuto({ ...BLOG, servizi: [{ ...servizio, memoria_mb: 100_000 }] }), /memoria/);
});

test("ciò che Docker deve fare lo scrive il gateway: senza privilegi, con l'etichetta, dentro la cartella dello stack", () => {
  const letta = leggiDescrizione(BLOG, RECINTO);
  const composto = componi(letta, RECINTO) as { name: string; services: Record<string, Record<string, unknown>> };
  assert.equal(composto.name, "shinka-prova-blog");
  assert.deepEqual(composto.services.web, {
    image: "nginx:alpine",
    labels: { "shinka.stack": "prova-blog" },
    restart: "no",
    security_opt: ["no-new-privileges:true"],
    mem_limit: "128m",
    pids_limit: 1024,
    // Un `$` da solo chiederebbe a Compose una variabile dell'host.
    environment: { SALUTO: "ciao $$HOME e 'apici'", NUMERO: "3" },
    ports: [{ target: 80, published: "7900", protocol: "tcp" }],
    volumes: [
      // Il volume in cui Shinka scrive dei file è in sola lettura per il container.
      { type: "bind", source: "/mnt/user/appdata/shinka-stack/prova-blog/pagine", target: "/usr/share/nginx/html", read_only: true },
      { type: "bind", source: "/mnt/user/appdata/shinka-stack/prova-blog/dati", target: "/dati", read_only: false },
    ],
  });

  const script = preparazione(letta, RECINTO);
  assert.match(script, /^set -e\n/);
  assert.match(script, /: > '\/mnt\/user\/appdata\/shinka-stack\/prova-blog\/\.shinka-stack'/);
  assert.match(script, /rm -rf -- '\/mnt\/user\/appdata\/shinka-stack\/prova-blog\/pagine'/);
  // Il volume dei dati non si cancella mai da qui.
  assert.ok(!script.includes("rm -rf -- '/mnt/user/appdata/shinka-stack/prova-blog/dati'"));
  // Il contenuto dei file viaggia codificato: nessun carattere arriva alla shell.
  assert.ok(!script.includes("àèìòù") && !script.includes("5$"));
});

interface Banco {
  vault: Vault;
  registro: Registro;
  stack: StackDiProva;
  docker: DockerDiProva;
  host: string;
  comandi: string[];
  fileRegistro: string;
}

async function banco(t: TestContext): Promise<Banco> {
  const cartella = await mkdtemp(join(tmpdir(), "shinka-stack-"));
  t.after(() => rm(cartella, { recursive: true, force: true }));
  const vault = await Vault.apri(join(cartella, "vault.json"), 2 ** 10);
  await vault.imposta(FRASE);
  const fileRegistro = join(cartella, "registro.jsonl");
  const registro = await Registro.apri(fileRegistro);
  const docker = new DockerDiProva();
  const avviato = await avviaHostDiProva({ utente: "root", password: PASSWORD, esegui: (comando, ingresso) => docker.esegui(comando, ingresso) });
  t.after(() => avviato.chiudi());
  const host = `127.0.0.1:${avviato.porta}`;
  await vault.inserisci({ nome: "lab", tipo: "password", utente: "root", host: [host], segreto: PASSWORD, stack: RECINTO });
  return { vault, registro, stack: new StackDiProva(vault, registro), docker, host, comandi: avviato.comandi, fileRegistro };
}

function testo(esito: EsitoStack): string {
  return esito.esito === "fatto" ? esito.testo : `[${esito.esito}] ${esito.motivo}`;
}

test("uno stack si avvia, si legge, si ferma e si rimuove, e ogni operazione finisce nel registro", async (t) => {
  const b = await banco(t);
  const base = { conversazione: 'Progetto "Blog"', host: b.host };

  const avviato = await b.stack.esegui({ ...base, operazione: "avvia", stack: BLOG });
  assert.match(testo(avviato), /^Stack "prova-blog" avviato su 127\.0\.0\.1:\d+\./);
  assert.match(testo(avviato), /shinka-prova-blog-web-1: nginx:alpine, running/);
  assert.match(testo(avviato), /127\.0\.0\.1:7900 \(tcp\) → servizio "web", porta 80/);
  assert.deepEqual(
    b.docker.container.map((uno) => [uno.nome, uno.etichetta, uno.stato]),
    [
      ["plex", "", "running"],
      ["shinka-prova-blog-web-1", "prova-blog", "running"],
    ],
  );
  // Il file è arrivato com'era scritto, attraverso SSH e la shell dell'host.
  assert.equal(b.docker.file.get("/mnt/user/appdata/shinka-stack/prova-blog/pagine/sotto/index.html"), BLOG.file[0]?.contenuto);
  assert.equal(b.docker.cartelle.get("/mnt/user/appdata/shinka-stack/prova-blog"), true);
  assert.deepEqual(b.docker.composti.get("shinka-prova-blog"), componi(leggiDescrizione(BLOG, RECINTO), RECINTO));

  const elenco = await b.stack.esegui({ conversazione: "Home", operazione: "elenca" });
  assert.match(testo(elenco), /porte dedicate da 7900 a 7999/);
  assert.match(testo(elenco), /Stack "prova-blog":\n\s+- shinka-prova-blog-web-1/);
  // Ciò che non è di Shinka non compare nemmeno nell'elenco.
  assert.ok(!testo(elenco).includes("plex"));

  const letto = await b.stack.esegui({ ...base, operazione: "leggi", nome: "prova-blog", righe: 20 });
  assert.match(testo(letto), /shinka-prova-blog-web-1 {2}\| pronto/);
  assert.ok(b.comandi.some((comando) => comando.endsWith("logs --no-color --tail 20 2>&1")));

  const riavviato = await b.stack.esegui({ ...base, operazione: "avvia", stack: BLOG });
  assert.match(testo(riavviato), /riavviato con la descrizione di adesso/);

  b.docker.lentoAFermarsi = true;
  const fermato = await b.stack.esegui({ ...base, operazione: "ferma", nome: "prova-blog" });
  assert.match(testo(fermato), /fermato/);
  // Docker lo dava ancora acceso: il gateway ha aspettato e ha riletto.
  assert.match(testo(fermato), /shinka-prova-blog-web-1: nginx:alpine, exited/);
  assert.ok(b.comandi.includes("sleep 3"));

  const rimosso = await b.stack.esegui({ ...base, operazione: "rimuovi", nome: "prova-blog" });
  assert.match(testo(rimosso), /Cancellata anche la sua cartella/);
  assert.deepEqual(b.docker.container.map((uno) => uno.nome), ["plex"]);
  assert.equal(b.docker.cartelle.size, 0);
  assert.equal((await b.stack.esegui({ ...base, operazione: "rimuovi", nome: "prova-blog" })).esito, "rifiutato");

  const voci = b.registro.ultime(20).reverse();
  assert.deepEqual(
    voci.map((voce) => [voce.esito, voce.comando.split(".")[0]]),
    [
      ["eseguito", 'Stack "prova-blog": avvio'],
      ["eseguito", "Stack di prova: elenco"],
      ["eseguito", 'Stack "prova-blog": lettura dello stato e dell\'uscita'],
      ["eseguito", 'Stack "prova-blog": avvio'],
      ["eseguito", 'Stack "prova-blog": fermata'],
      ["eseguito", 'Stack "prova-blog": rimozione, con i suoi dati'],
      ["rifiutato", 'Stack "prova-blog": rimozione, con i suoi dati'],
    ],
  );
  assert.equal(voci[0]?.credenziale, "lab");
  assert.equal(voci[0]?.conversazione, 'Progetto "Blog"');
  assert.match(voci[0]?.comando ?? "", /Servizi: web \(nginx:alpine; porte 7900\)\. File scritti: 1/);
  // Nel registro non finiscono né i valori delle variabili né il contenuto dei file, e mai la password.
  const scritto = await readFile(b.fileRegistro, "utf8");
  assert.ok(!scritto.includes("ciao $HOME") && !scritto.includes("Costa 5") && !scritto.includes(PASSWORD));
  assert.notEqual(b.vault.elenco()[0]?.usataIl, undefined);
});

test("ciò che non è di Shinka non viene toccato, anche se ne porta il nome", async (t) => {
  const b = await banco(t);
  const base = { conversazione: "Home", host: b.host };
  // Un progetto con il nome di uno stack, ma senza l'etichetta: non l'ha creato Shinka.
  b.docker.container.push({ nome: "shinka-estraneo-db-1", progetto: "shinka-estraneo", etichetta: "", immagine: "postgres:16", stato: "running", porte: "" });
  // Una cartella sotto la radice, senza il segno di Shinka.
  b.docker.cartelle.set("/mnt/user/appdata/shinka-stack/cartella-altrui", false);
  const prima = b.comandi.length;

  const sopra = await b.stack.esegui({ ...base, operazione: "avvia", stack: { ...BLOG, nome: "estraneo" } });
  assert.match(testo(sopra), /^\[rifiutato\].*non è stato creato da Shinka \(shinka-estraneo-db-1\): non lo tocco\. Scegli un altro nome/);
  for (const operazione of ["ferma", "rimuovi", "leggi"] as const) {
    const esito = await b.stack.esegui({ ...base, operazione, nome: "estraneo" });
    assert.match(testo(esito), /^\[rifiutato\].*non lo tocco\. Per agire su un servizio che non è di Shinka serve l'approvazione/, operazione);
  }
  const nellaCartella = await b.stack.esegui({ ...base, operazione: "avvia", stack: { ...BLOG, nome: "cartella-altrui" } });
  assert.match(testo(nellaCartella), /^\[rifiutato\].*esiste già e non è di Shinka/);
  assert.equal((await b.stack.esegui({ ...base, operazione: "rimuovi", nome: "cartella-altrui" })).esito, "rifiutato");
  assert.equal((await b.stack.esegui({ ...base, operazione: "ferma", nome: "plex" })).esito, "rifiutato");

  // All'host sono arrivate soltanto letture: nessun avvio, nessuna fermata, nessuna cancellazione.
  for (const comando of b.comandi.slice(prima)) assert.match(comando, /^docker ps -a /, comando);
  assert.deepEqual(b.docker.container.map((uno) => uno.stato), ["running", "running"]);
  assert.equal(b.docker.cartelle.get("/mnt/user/appdata/shinka-stack/cartella-altrui"), false);

  // Una descrizione fuori dal recinto viene rifiutata prima ancora di collegarsi.
  const quanti = b.comandi.length;
  const fuori = await b.stack.esegui({ ...base, operazione: "avvia", stack: { ...BLOG, servizi: [{ ...BLOG.servizi[0], porte: [{ host: 80, container: 80 }] }] } });
  assert.match(testo(fuori), /^\[rifiutato\].*solo le porte da 7900 a 7999/);
  assert.equal(b.comandi.length, quanti);
  assert.equal(b.registro.ultime(1)[0]?.esito, "rifiutato");
});

test("gli stack si gestiscono solo sugli host dichiarati dal proprietario, e a vault aperto", async (t) => {
  const b = await banco(t);
  const altrove = await b.stack.esegui({ conversazione: "Home", operazione: "avvia", host: "192.168.1.50", stack: BLOG });
  assert.match(testo(altrove), /^\[rifiutato\] 192\.168\.1\.50:22 non è un host per gli stack di prova\. Gli host per gli stack sono: 127\.0\.0\.1:\d+\./);

  // Una credenziale senza recinto non fa del suo host un host per gli stack.
  await b.vault.inserisci({ nome: "nas", tipo: "password", utente: "root", host: ["nas.lan"], segreto: PASSWORD });
  assert.equal((await b.stack.esegui({ conversazione: "Home", operazione: "elenca", host: "nas.lan" })).esito, "rifiutato");

  b.vault.chiudi();
  for (const richiesta of [
    { conversazione: "Home", operazione: "elenca" as const },
    { conversazione: "Home", operazione: "avvia" as const, host: b.host, stack: BLOG },
  ]) {
    const chiuso = await b.stack.esegui(richiesta);
    assert.match(testo(chiuso), /^\[rifiutato\] Il vault è chiuso/);
  }
  assert.deepEqual(b.comandi, []);
});

test("un host senza Docker Compose, o che non risponde bene, viene detto com'è", async (t) => {
  const cartella = await mkdtemp(join(tmpdir(), "shinka-stack-"));
  t.after(() => rm(cartella, { recursive: true, force: true }));
  const vault = await Vault.apri(join(cartella, "vault.json"), 2 ** 10);
  await vault.imposta(FRASE);
  const registro = await Registro.apri(join(cartella, "registro.jsonl"));
  const avviato = await avviaHostDiProva({
    utente: "root",
    password: PASSWORD,
    esegui: async (comando, ingresso) => {
      if (comando.startsWith("docker ps")) return { uscita: "::cartella::\nassente\n" };
      if (comando === "sh -s") {
        await ingresso();
        return {};
      }
      await ingresso();
      return { errori: `unknown shorthand flag: 'p' in -p\nIl segreto è ${PASSWORD}\n`, codice: 125 };
    },
  });
  t.after(() => avviato.chiudi());
  const host = `127.0.0.1:${avviato.porta}`;
  await vault.inserisci({ nome: "lab", tipo: "password", utente: "root", host: [host], segreto: PASSWORD, stack: RECINTO });
  const stack = new StackDiProva(vault, registro);

  const esito = await stack.esegui({ conversazione: "Home", operazione: "avvia", host, stack: BLOG });
  assert.match(testo(esito), /^\[fallito\] Su questo host manca Docker Compose/);
  assert.equal(registro.ultime(1)[0]?.esito, "fallito");
  assert.ok(!JSON.stringify(registro.ultime(5)).includes(PASSWORD));
});
