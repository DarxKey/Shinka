import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import { createServer, request } from "node:https";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { caCopre, GIORNI_DEL_SERVER, indirizzoPrivato, nuovaCa, nuovoServer, type Firmato } from "./certificato.ts";

/** Una richiesta HTTPS a un server con questo certificato, da un client che si fida solo della CA indicata. */
async function strettaDiMano(server: Firmato, ca: Firmato, nome: string): Promise<string> {
  const ascolta = createServer({ key: server.chiave, cert: server.certificato + ca.certificato }, (_q, r) => r.end("ok"));
  await new Promise<void>((fatto) => ascolta.listen(0, "127.0.0.1", fatto));
  try {
    return await new Promise<string>((fatto) => {
      const q = request(
        { host: "127.0.0.1", port: (ascolta.address() as AddressInfo).port, ca: ca.certificato, ...(/^[\d.]+$/.test(nome) ? {} : { servername: nome, checkServerIdentity: (_h, cert) => (cert.subjectaltname?.includes(`DNS:${nome}`) ? undefined : new Error("nome")) }) },
        (r) => {
          r.resume();
          fatto(String(r.statusCode));
        },
      );
      q.on("error", (errore) => fatto(errore.message));
      q.end();
    });
  } finally {
    ascolta.close();
  }
}

test("il certificato del server è firmato dalla CA, vale per i suoi nomi e rispetta i limiti di Apple", async () => {
  const ca = nuovaCa(["unraid"]);
  const server = nuovoServer(ca, ["192.168.1.20", "localhost", "127.0.0.1", "unraid", "::1"]);
  const x = new X509Certificate(server.certificato);
  const xCa = new X509Certificate(ca.certificato);
  assert.equal(x.verify(xCa.publicKey), true);
  assert.equal(xCa.ca, true);
  assert.equal(x.ca, false);
  assert.equal(x.checkIP("192.168.1.20"), "192.168.1.20");
  assert.equal(x.checkHost("unraid"), "unraid");
  assert.equal(x.checkIP("10.0.0.1"), undefined);
  // Solo per un server web, e per meno di 825 giorni.
  assert.deepEqual(x.keyUsage, ["1.3.6.1.5.5.7.3.1"]);
  const giorni = (Date.parse(x.validTo) - Date.parse(x.validFrom)) / 86_400_000;
  assert.ok(giorni <= 825 && giorni >= GIORNI_DEL_SERVER - 1, `${giorni} giorni`);
  // Un client che si fida solo della CA di Shinka si collega, per indirizzo e per nome.
  assert.equal(await strettaDiMano(server, ca, "127.0.0.1"), "200");
  assert.equal(await strettaDiMano(server, ca, "localhost"), "200");
});

test("la CA di Shinka non può firmare un sito di Internet, né un indirizzo pubblico", async () => {
  const ca = nuovaCa([]);
  for (const nomi of [["127.0.0.1", "example.com"], ["127.0.0.1", "8.8.8.8"]]) {
    const falso = nuovoServer(ca, nomi);
    // Il certificato si firma, ma chi verifica lo rifiuta: i vincoli della CA lo vietano.
    assert.match(await strettaDiMano(falso, ca, "127.0.0.1"), /subtree|constraint/i, nomi.join(", "));
  }
  // Un altro client, che si fida di un'altra CA, rifiuta il certificato di Shinka.
  const altra = nuovaCa([]);
  assert.match(await strettaDiMano(nuovoServer(ca, ["127.0.0.1"]), altra, "127.0.0.1"), /certificate|signature|self/i);
});

test("si sa quali nomi la CA può firmare", () => {
  for (const privato of ["10.1.2.3", "172.20.0.1", "192.168.1.20", "127.0.0.1", "100.64.1.1", "fd00::1", "::1"]) {
    assert.equal(indirizzoPrivato(privato), true, privato);
  }
  for (const pubblico of ["8.8.8.8", "172.32.0.1", "2001:db8::1", "unraid"]) assert.equal(indirizzoPrivato(pubblico), false, pubblico);
  assert.equal(caCopre(["unraid"], ["192.168.1.20", "Unraid", "localhost"]), true);
  assert.equal(caCopre(["unraid"], ["shinka.casa"]), false);
  assert.equal(caCopre([], ["8.8.8.8"]), false);
});
