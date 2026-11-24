import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Registro } from "../gateway/registro.ts";
import { creaGateway } from "../gateway/servizio.ts";
import { LEGGI_I_CONTAINER, StackDiProva } from "../gateway/stack.ts";
import { Operazioni } from "../gateway/uso.ts";
import { Vault } from "../gateway/vault.ts";
import { allestisci, avviaNodoAccettato, ID_NODO, RISORSE_DI_PROVA } from "../prove/banco.ts";
import { DockerDiProva } from "../prove/docker-di-prova.ts";
import { avviaHostDiProva } from "../prove/host-di-prova.ts";
import type { DettaglioDellAmbiente } from "../protocollo/risorse.ts";
import { COOKIE_SESSIONE } from "./centro.ts";
import { ClienteGateway } from "./gateway.ts";

const GETTONE = "gettone-di-prova-del-centro-lungo-quanto-serve";
const PASSWORD = "P4ssword-di-prova-da-non-vedere";

test("la pagina di un ambiente: quello del centro risponde da sé, senza sessione nulla, uno sconosciuto non c'è", async (t) => {
  const banco = await allestisci(t);
  assert.equal((await banco.centro.inject({ method: "GET", url: "/api/ambienti/centro/risorse" })).statusCode, 401);
  const cookies = { [COOKIE_SESSIONE]: await banco.entra() };
  const letto = await banco.centro.inject({ method: "GET", url: "/api/ambienti/centro/risorse", cookies });
  assert.equal(letto.statusCode, 200);
  // Senza gateway non si parla di host Docker.
  // Senza progetti, dei processi di Shinka c'è solo la shell del banco.
  const { processiDiShinka, ...resto } = letto.json() as typeof RISORSE_DI_PROVA;
  assert.deepEqual(resto, RISORSE_DI_PROVA);
  assert.deepEqual(processiDiShinka?.map((uno) => uno.pid), [4200]);
  assert.equal((await banco.centro.inject({ method: "GET", url: "/api/ambienti/inventato/risorse", cookies })).statusCode, 404);
});

test("un altro ambiente risponde attraverso il suo nodo; spento, lo dice", async (t) => {
  const banco = await allestisci(t);
  const cookies = { [COOKIE_SESSIONE]: await banco.entra() };
  const nodo = await avviaNodoAccettato(t, banco);
  const letto = (await banco.centro.inject({ method: "GET", url: `/api/ambienti/${ID_NODO}/risorse`, cookies })).json<DettaglioDellAmbiente>();
  assert.ok(!("motivo" in letto), JSON.stringify(letto));
  // Le legge il nodo vero, su questa macchina.
  assert.ok(letto.sistema.nuclei >= 1);
  assert.ok(letto.campione.memoria.totale > 0);
  assert.ok(letto.campione.cpu >= 0 && letto.campione.cpu <= 100);
  assert.equal(letto.hostDocker, undefined);

  nodo.collegamento.ferma();
  await new Promise((fatto) => setTimeout(fatto, 200));
  const spento = (await banco.centro.inject({ method: "GET", url: `/api/ambienti/${ID_NODO}/risorse`, cookies })).json<DettaglioDellAmbiente>();
  assert.deepEqual(spento, { motivo: "L'ambiente è spento." });
});

test("i container dell'host per gli stack li legge il gateway, con un comando fisso; nel registro una riga, non una a lettura", async (t) => {
  const cartella = await mkdtemp(join(tmpdir(), "shinka-gateway-"));
  const vault = await Vault.apri(join(cartella, "vault.json"), 2 ** 10);
  await vault.imposta("una frase di sblocco di prova");
  const fileRegistro = join(cartella, "registro.jsonl");
  const registro = await Registro.apri(fileRegistro);
  const app = await creaGateway({ vault, registro, operazioni: new Operazioni(vault, registro), stack: new StackDiProva(vault, registro), gettone: GETTONE });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const cliente = new ClienteGateway({ indirizzo: `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`, gettone: GETTONE });
  const docker = new DockerDiProva();
  docker.container.push({ nome: "shinka-prova-web-1", progetto: "shinka-prova", etichetta: "prova", immagine: "nginx:alpine", stato: "running", porte: "0.0.0.0:7900->80/tcp" });
  docker.container.push({ nome: "vecchio", progetto: "", etichetta: "", immagine: "busybox", stato: "exited", porte: "" });
  const avviato = await avviaHostDiProva({ utente: "root", password: PASSWORD, esegui: (comando, ingresso) => docker.esegui(comando, ingresso) });
  t.after(async () => {
    cliente.chiudi();
    await avviato.chiudi();
    await app.close();
    await rm(cartella, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  const host = `127.0.0.1:${avviato.porta}`;
  const banco = await allestisci(t, { gateway: cliente });
  const cookies = { [COOKIE_SESSIONE]: await banco.entra() };
  const leggi = async (): Promise<Exclude<DettaglioDellAmbiente, { motivo: string }>> => {
    const letto = (await banco.centro.inject({ method: "GET", url: "/api/ambienti/centro/risorse", cookies })).json<DettaglioDellAmbiente>();
    assert.ok(!("motivo" in letto), JSON.stringify(letto));
    return letto;
  };

  // Senza un host dichiarato per gli stack non c'è nulla da leggere.
  assert.deepEqual((await leggi()).hostDocker, []);

  await vault.inserisci({ nome: "lab", tipo: "password", utente: "root", host: [host], segreto: PASSWORD, stack: { porte: { da: 7900, a: 7999 }, radice: "/mnt/user/appdata/shinka-stack" } });
  // Chi guarda non aspetta il gateway: la lettura nuova arriva con uno dei campioni successivi.
  let letto = await leggi();
  for (let giro = 0; giro < 50 && (letto.hostDocker?.length ?? 0) === 0; giro += 1) {
    await new Promise((fatto) => setTimeout(fatto, 40));
    letto = await leggi();
  }
  assert.deepEqual(letto.hostDocker, [
    {
      host,
      stato: "attivo",
      contenitori: [
        { nome: "plex", immagine: "plexinc/pms-docker", stato: "running", dettaglio: "Up 2 hours", porte: "0.0.0.0:32400->32400/tcp", cpu: 1.5, memoria: { usata: 134_217_728, limite: 2_147_483_648 } },
        { nome: "shinka-prova-web-1", immagine: "nginx:alpine", stato: "running", dettaglio: "Up 2 hours", porte: "0.0.0.0:7900->80/tcp", cpu: 1.5, memoria: { usata: 134_217_728, limite: 2_147_483_648 }, diShinka: true },
        { nome: "vecchio", immagine: "busybox", stato: "exited", dettaglio: "Exited (0) 1 hour ago", porte: "" },
      ],
    },
  ]);
  // Sull'host è arrivato solo il comando di lettura, e nessun container è stato toccato.
  assert.deepEqual([...new Set(avviato.comandi)], [LEGGI_I_CONTAINER]);
  assert.ok(!JSON.stringify(letto).includes(PASSWORD));

  // Guardando ancora, l'host viene riletto ma il registro non si riempie.
  const lettureFinora = avviato.comandi.length;
  for (let giro = 0; giro < 4; giro += 1) {
    await leggi();
    await new Promise((fatto) => setTimeout(fatto, 60));
  }
  assert.ok(avviato.comandi.length > lettureFinora, "l'host viene riletto");
  const righe = (await readFile(fileRegistro, "utf8")).trim().split("\n").map((riga) => JSON.parse(riga) as { comando: string; conversazione: string; esito: string });
  assert.equal(righe.length, 1);
  assert.match(righe[0]?.comando ?? "", /^Lettura dei container/);
  assert.equal(righe[0]?.conversazione, "Pagina Ambienti");

  // A vault chiuso il gateway non legge nulla, e la pagina dice perché.
  vault.chiudi();
  const allaChiusura = avviato.comandi.length;
  let chiuso = await leggi();
  for (let giro = 0; giro < 50 && chiuso.motivoHostDocker === undefined; giro += 1) {
    await new Promise((fatto) => setTimeout(fatto, 40));
    chiuso = await leggi();
  }
  assert.equal(chiuso.hostDocker, undefined);
  assert.match(chiuso.motivoHostDocker ?? "", /vault è chiuso/);
  assert.equal(avviato.comandi.length, allaChiusura);
});
