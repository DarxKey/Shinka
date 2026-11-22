import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { ClienteGateway } from "./gateway.ts";

test("un gateway di prima, che non sa mandare file, viene riconosciuto e detto in parole", async (t) => {
  const ricevuti: { url: string; tipo: string | undefined; byte: number; autorizzazione: string | undefined }[] = [];
  const server = createServer((richiesta, risposta) => {
    const pezzi: Buffer[] = [];
    richiesta.on("data", (pezzo: Buffer) => pezzi.push(pezzo));
    richiesta.on("end", () => {
      ricevuti.push({
        url: richiesta.url ?? "",
        tipo: richiesta.headers["content-type"],
        byte: Buffer.concat(pezzi).length,
        autorizzazione: richiesta.headers.authorization,
      });
      risposta.writeHead(404, { "content-type": "application/json" });
      risposta.end(JSON.stringify({ message: "Route POST:/api/telegram/file not found", statusCode: 404 }));
    });
  });
  await new Promise<void>((pronto) => server.listen(0, "127.0.0.1", pronto));
  t.after(() => new Promise<void>((chiuso) => server.close(() => chiuso())));
  const cliente = new ClienteGateway({ indirizzo: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, gettone: "gettone-di-prova" });
  t.after(() => cliente.chiudi());

  const esito = await cliente.telegramInviaFile(
    { nome: "Itinerario Tokyo.pdf", tipo: "application/pdf", didascalia: "Il giro", comeFoto: false },
    Buffer.from("%PDF-1.7\n"),
  );
  assert.deepEqual(esito, { esito: "fallito", motivo: "Il gateway installato non sa ancora mandare file su Telegram: va aggiornato." });
  // Il file viaggia così com'è, con il gettone del centro e il resto nell'indirizzo.
  const [arrivato] = ricevuti.filter((voce) => voce.url.startsWith("/api/telegram/file"));
  assert.equal(arrivato?.tipo, "application/octet-stream");
  assert.equal(arrivato?.byte, 9);
  assert.equal(arrivato?.autorizzazione, "Bearer gettone-di-prova");
  assert.equal(arrivato?.url, "/api/telegram/file?nome=Itinerario+Tokyo.pdf&tipo=application%2Fpdf&didascalia=Il+giro");
});
