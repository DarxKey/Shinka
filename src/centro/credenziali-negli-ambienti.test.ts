/**
 * Le credenziali per SSH date a un ambiente (ADR 0062), da capo a fondo: un gateway vero con il suo
 * vault, il centro del banco e il nodo del banco sul collegamento, e un host SSH di prova. Il gateway
 * non raggiunge l'host; il proprietario dà la credenziale all'ambiente dalla pagina del vault; il nodo
 * la riceve sigillata, la tiene in memoria ed esegue il comando; il registro lo dice; a vault chiuso
 * il nodo la dimentica. Il valore non compare mai tra i dati del centro.
 */

import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { Registro } from "../gateway/registro.ts";
import { COOKIE_VAULT, creaGateway } from "../gateway/servizio.ts";
import { ErroreSsh } from "../gateway/ssh.ts";
import { Operazioni } from "../gateway/uso.ts";
import { Vault } from "../gateway/vault.ts";
import { allestisci, avviaNodoAccettato, finche, ID_NODO } from "../prove/banco.ts";
import { avviaHostDiProva } from "../prove/host-di-prova.ts";
import { ClienteGateway } from "./gateway.ts";

const FRASE = "una frase di sblocco di prova";
const PASSWORD = "P4ssword-che-solo-il-nodo-usa";
const GETTONE = "gettone-di-prova-del-centro-lungo-quanto-serve";

/** Tutto ciò che c'è scritto nei file di una cartella. */
async function tuttoIlTesto(cartella: string): Promise<string> {
  const voci = await readdir(cartella, { recursive: true, withFileTypes: true });
  const testi = await Promise.all(voci.filter((voce) => voce.isFile()).map((voce) => readFile(join(voce.parentPath, voce.name), "utf8").catch(() => "")));
  return testi.join("\n");
}

async function avviaGateway(t: TestContext) {
  const cartella = await mkdtemp(join(tmpdir(), "shinka-gateway-"));
  const vault = await Vault.apri(join(cartella, "vault.json"), 2 ** 10);
  await vault.imposta(FRASE);
  const registro = await Registro.apri(join(cartella, "registro.jsonl"));
  // Il gateway non raggiunge l'host: ogni suo collegamento diretto non riesce.
  const nonRaggiunge = async (): Promise<never> => {
    throw new ErroreSsh("collegamento", "L'host non risponde: connect ETIMEDOUT.");
  };
  const app = await creaGateway({ vault, registro, operazioni: new Operazioni(vault, registro, undefined, undefined, nonRaggiunge), gettone: GETTONE });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const indirizzo = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const cliente = new ClienteGateway({ indirizzo, gettone: GETTONE });
  t.after(async () => {
    cliente.chiudi();
    await app.close();
    await rm(cartella, { recursive: true, force: true });
  });
  const entra = await app.inject({ method: "POST", url: "/vault/sblocco", payload: { frase: FRASE } });
  const cookie = entra.cookies.find((c) => c.name === COOKIE_VAULT);
  assert.ok(cookie);
  return { app, vault, registro, cliente, pagina: { [COOKIE_VAULT]: cookie.value } };
}

test("una credenziale data a un ambiente la usa il suo nodo dove il gateway non arriva, e si dimentica a vault chiuso", { timeout: 60_000 }, async (t) => {
  const gateway = await avviaGateway(t);
  const host = await avviaHostDiProva({ utente: "mario", password: PASSWORD, esegui: (comando) => ({ uscita: `eseguito: ${comando}\n` }) });
  t.after(() => host.chiudi());
  await gateway.vault.inserisci({ nome: "lab", tipo: "password", utente: "mario", host: [`127.0.0.1:${host.porta}`], segreto: PASSWORD });
  await gateway.vault.inserisci({ nome: "server", tipo: "password", utente: "root", host: ["192.168.1.20:22"], segreto: "un-altro-segreto", server: true });

  const banco = await allestisci(t, { gateway: gateway.cliente });
  const nodo = await avviaNodoAccettato(t, banco);
  const negliAmbienti = banco.credenzialiNegliAmbienti;
  assert.ok(negliAmbienti);
  await negliAmbienti.giro();

  // Il proprietario vede l'ambiente nella pagina del vault, con l'impronta della chiave del suo nodo.
  const ambienti = (await gateway.app.inject({ method: "GET", url: "/vault/ambienti", cookies: gateway.pagina })).json() as { ambienti: { id: string; nome: string; impronta: string }[] };
  assert.deepEqual(ambienti.ambienti.map(({ id, nome }) => [id, nome]), [[ID_NODO, "PC Windows"]]);
  assert.match(ambienti.ambienti[0]?.impronta ?? "", /^SHA256:/);
  // La credenziale del server resta solo nel gateway.
  const rifiutata = await gateway.app.inject({ method: "POST", url: "/vault/credenziali/server/ambienti", cookies: gateway.pagina, payload: { ambienti: [ID_NODO] } });
  assert.equal(rifiutata.statusCode, 400);
  // Un ambiente che non c'è non si sceglie.
  assert.equal((await gateway.app.inject({ method: "POST", url: "/vault/credenziali/lab/ambienti", cookies: gateway.pagina, payload: { ambienti: ["inventato"] } })).statusCode, 400);

  // Prima di darla, l'ambiente non l'ha, e il comando non passa da lui.
  assert.deepEqual(nodo.credenziali.nomi(), []);
  const prima = await banco.comuniDellaHome("esegui_su_host", { credenziale: "lab", host: `127.0.0.1:${host.porta}`, comando: "uname" });
  assert.equal(prima.errore, true);
  assert.match(prima.testo, /non risponde/);

  // Il proprietario la dà all'ambiente: il nodo la riceve, sigillata, e la tiene in memoria.
  const data = await gateway.app.inject({ method: "POST", url: "/vault/credenziali/lab/ambienti", cookies: gateway.pagina, payload: { ambienti: [ID_NODO] } });
  assert.equal(data.statusCode, 200, data.body);
  assert.deepEqual((data.json() as { credenziale: { ambienti: unknown } }).credenziale.ambienti, [{ id: ID_NODO, nome: "PC Windows" }]);
  await negliAmbienti.giro();
  await finche(() => nodo.credenziali.nomi().includes("lab"), "il nodo riceve la credenziale");

  // Il comando: il gateway non raggiunge l'host, lo esegue il nodo.
  const eseguito = await banco.comuniDellaHome("esegui_su_host", { credenziale: "lab", host: `127.0.0.1:${host.porta}`, comando: "uname -a" });
  assert.notEqual(eseguito.errore, true, eseguito.testo);
  assert.match(eseguito.testo, /Eseguito dal nodo di «PC Windows»/);
  assert.match(eseguito.testo, /eseguito: uname -a/);
  // Il registro del gateway lo dice, e l'impronta dell'host si ricorda.
  const voci = gateway.registro.ultime(10);
  assert.ok(voci.some((voce) => voce.esito === "eseguito" && voce.comando === "uname -a" && /Passato dal nodo di «PC Windows»/.test(voce.motivo ?? "")));
  assert.ok(voci.some((voce) => voce.host.includes("PC Windows") && /consegna/.test(voce.comando)));
  await finche(() => gateway.vault.elenco().find((una) => una.nome === "lab")?.usataIl !== undefined, "la credenziale risulta usata");

  // Le regole valgono anche sul nodo: il divieto fisso e gli host della credenziale.
  const vietato = await nodo.credenziali.esegui("lab", `127.0.0.1:${host.porta}`, "passwd mario", 10);
  assert.equal(vietato.esito, "rifiutato");
  const altrove = await nodo.credenziali.esegui("lab", "10.0.0.9:22", "uname", 10);
  assert.ok(altrove.esito === "rifiutato" && /non è prevista/.test(altrove.motivo));

  // Il valore non è mai passato in chiaro dal centro: tra i suoi dati non c'è.
  assert.ok(!(await tuttoIlTesto(banco.cartella)).includes(PASSWORD));

  // Il vault si chiude: al giro successivo il nodo la dimentica.
  gateway.vault.chiudi();
  await negliAmbienti.giro();
  await finche(() => nodo.credenziali.nomi().length === 0, "il nodo dimentica la credenziale");

  // Riaperto, la riceve di nuovo; tolta all'ambiente, la dimentica.
  await gateway.vault.sblocca(FRASE);
  await negliAmbienti.giro();
  await finche(() => nodo.credenziali.nomi().includes("lab"), "il nodo la riceve di nuovo");
  await gateway.app.inject({ method: "POST", url: "/vault/credenziali/lab/ambienti", cookies: gateway.pagina, payload: { ambienti: [] } });
  await negliAmbienti.giro();
  await finche(() => nodo.credenziali.nomi().length === 0, "tolta all'ambiente, il nodo la dimentica");
});
