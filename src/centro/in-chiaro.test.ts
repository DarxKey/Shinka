import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { Registro } from "../gateway/registro.ts";
import { creaGateway } from "../gateway/servizio.ts";
import { Operazioni } from "../gateway/uso.ts";
import { Vault } from "../gateway/vault.ts";
import { allestisci, finche, type Banco } from "../prove/banco.ts";
import type { EventoConversazione } from "../protocollo/eventi.ts";
import { STRUMENTI_COMUNI_SENZA_RICHIESTA } from "../protocollo/strumenti.ts";
import { COOKIE_SESSIONE } from "./centro.ts";
import { ClienteGateway } from "./gateway.ts";

const FRASE = "una frase di sblocco di prova";
const GETTONE = "gettone-di-prova-del-centro-lungo-quanto-serve";
const PROTETTO = "Valore-PROTETTO-che-non-esce-mai";
const IN_CHIARO = "Lab-Passw0rd-in-chiaro";

/** Un gateway vero, con una credenziale protetta e una in chiaro, e il centro che gli parla. */
async function allestisciVault(t: TestContext): Promise<{ banco: Banco; vault: Vault }> {
  const cartella = await mkdtemp(join(tmpdir(), "shinka-gateway-"));
  const vault = await Vault.apri(join(cartella, "vault.json"), 2 ** 10);
  await vault.imposta(FRASE);
  const registro = await Registro.apri(join(cartella, "registro.jsonl"));
  const app = await creaGateway({ vault, registro, operazioni: new Operazioni(vault, registro), gettone: GETTONE });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const cliente = new ClienteGateway({ indirizzo: `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`, gettone: GETTONE });
  t.after(async () => {
    cliente.chiudi();
    await app.close();
    await rm(cartella, { recursive: true, force: true });
  });
  await vault.inserisci({ nome: "nas-root", tipo: "password", utente: "root", host: ["nas.lan"], segreto: PROTETTO });
  await vault.inserisci({ nome: "lab-dc", tipo: "password", utente: "Administrator", host: ["10.0.0.5"], segreto: IN_CHIARO, inChiaro: true });
  const banco = await allestisci(t, { gateway: cliente });
  return { banco, vault };
}

type Richiesta = Extract<EventoConversazione, { tipo: "approvazione-richiesta" }>;

test("leggere e proporre una credenziale in chiaro non chiede il permesso: la proposta ha la sua scheda", () => {
  assert.ok(STRUMENTI_COMUNI_SENZA_RICHIESTA.includes("leggi_credenziale"));
  assert.ok(STRUMENTI_COMUNI_SENZA_RICHIESTA.includes("salva_credenziale_in_chiaro"));
});

test("la Home vede quali credenziali sono in chiaro, ne legge il valore, e quello delle protette mai", async (t) => {
  const { banco } = await allestisciVault(t);
  const elenco = await banco.comuniDellaHome("elenca_credenziali", {});
  assert.match(elenco.testo, /\[protetta\] - nome: "nas-root"/);
  assert.match(elenco.testo, /\[IN CHIARO: il valore si legge con leggi_credenziale\] - nome: "lab-dc"/);
  assert.ok(!elenco.testo.includes(IN_CHIARO) && !elenco.testo.includes(PROTETTO));

  const letta = await banco.comuniDellaHome("leggi_credenziale", { credenziale: "lab-dc", dove: "10.0.0.5" });
  assert.equal(letta.errore, undefined, letta.testo);
  assert.match(letta.testo, /Utente: Administrator\nPassword: Lab-Passw0rd-in-chiaro/);

  const altrove = await banco.comuniDellaHome("leggi_credenziale", { credenziale: "lab-dc", dove: "nas.lan" });
  assert.equal(altrove.errore, true);
  const protetta = await banco.comuniDellaHome("leggi_credenziale", { credenziale: "nas-root", dove: "nas.lan" });
  assert.equal(protetta.errore, true);
  assert.match(protetta.testo, /protetta/);
  assert.ok(!protetta.testo.includes(PROTETTO));
});

test("una credenziale proposta dalla Home compare in una scheda, ed entra nel vault solo con il sì", async (t) => {
  const { banco, vault } = await allestisciVault(t);
  const richiesteNelCanale = (): Richiesta[] =>
    banco.canale.archiviati.map((voce) => voce.evento).filter((evento): evento is Richiesta => evento.tipo === "approvazione-richiesta");

  const inCorso = banco.comuniDellaHome("salva_credenziale_in_chiaro", { nome: "vm-root", tipo: "password", utente: "root", host: ["vm1.lab"], segreto: "Vm-passw0rd" });
  await finche(() => richiesteNelCanale().length === 1, "compare la scheda");
  const scheda = richiesteNelCanale()[0];
  assert.ok(scheda !== undefined);
  assert.equal(scheda.genere, "credenziale");
  assert.equal(scheda.credenziale, "vm-root");
  assert.equal(scheda.host, "vm1.lab:22");
  assert.equal(scheda.comando, "Password, utente root.");
  assert.ok(!JSON.stringify(scheda).includes("Vm-passw0rd"));
  assert.equal(vault.elenco().some((c) => c.nome === "vm-root"), false);

  const risposta = await banco.centro.inject({
    method: "POST",
    url: `/api/approvazioni/${scheda.idApprovazione}`,
    payload: { decisione: "approvata" },
    cookies: { [COOKIE_SESSIONE]: await banco.entra() },
  });
  assert.equal(risposta.statusCode, 200, risposta.body);
  const esito = await inCorso;
  assert.equal(esito.errore, undefined, esito.testo);
  assert.match(esito.testo, /salvata nel vault, con il sì del proprietario/);
  assert.equal(vault.perLettura("vm-root", "vm1.lab").segreto, "Vm-passw0rd");

  // Negata, non entra.
  const negata = banco.comuniDellaHome("salva_credenziale_in_chiaro", { nome: "vm-altra", tipo: "password", utente: "root", host: ["vm2.lab"], segreto: "Altra-passw0rd" });
  await finche(() => richiesteNelCanale().length === 2, "compare la seconda scheda");
  const seconda = richiesteNelCanale()[1];
  assert.ok(seconda !== undefined);
  await banco.centro.inject({
    method: "POST",
    url: `/api/approvazioni/${seconda.idApprovazione}`,
    payload: { decisione: "negata" },
    cookies: { [COOKIE_SESSIONE]: await banco.entra() },
  });
  assert.equal((await negata).errore, true);
  assert.equal(vault.elenco().some((c) => c.nome === "vm-altra"), false);
});
