import assert from "node:assert/strict";
import { test } from "node:test";
import { allestisci } from "../prove/banco.ts";
import { COOKIE_SESSIONE } from "./centro.ts";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

test("un'immagine scritta nel testo la passa il centro, solo al proprietario e in un recinto", async (t) => {
  const chieste: string[] = [];
  const banco = await allestisci(t, {
    immaginiEsterne: {
      leggi: async (indirizzo) => {
        chieste.push(indirizzo);
        return indirizzo.endsWith(".jpg") ? { tipo: "image/jpeg", dati: JPEG } : { motivo: "Non è un'immagine che Shinka mostra (JPEG, PNG, GIF, WebP o AVIF)." };
      },
    },
  });
  const indirizzo = "https://commons.wikimedia.org/wiki/Special:FilePath/Jade.jpg";
  const url = `/api/immagine-esterna?indirizzo=${encodeURIComponent(indirizzo)}`;

  const senzaSessione = await banco.centro.inject({ method: "GET", url });
  assert.equal(senzaSessione.statusCode, 401);
  assert.deepEqual(chieste, [], "senza sessione il centro non chiede nulla al sito");

  const cookies = { [COOKIE_SESSIONE]: await banco.entra() };
  const letta = await banco.centro.inject({ method: "GET", url, cookies });
  assert.equal(letta.statusCode, 200);
  assert.equal(letta.headers["content-type"], "image/jpeg");
  assert.equal(letta.headers["content-security-policy"], "sandbox; default-src 'none'");
  assert.equal(letta.headers["x-content-type-options"], "nosniff");
  assert.equal(letta.headers["referrer-policy"], "no-referrer");
  assert.match(String(letta.headers["cache-control"]), /^private/);
  assert.deepEqual(letta.rawPayload, JPEG);
  assert.deepEqual(chieste, [indirizzo]);

  const pagina = await banco.centro.inject({ method: "GET", url: `/api/immagine-esterna?indirizzo=${encodeURIComponent("https://esempio.org/")}`, cookies });
  assert.equal(pagina.statusCode, 404);
  assert.match(pagina.json().errore, /Non è un'immagine/);
  assert.equal((await banco.centro.inject({ method: "GET", url: "/api/immagine-esterna", cookies })).statusCode, 400);
});

test("la politica dei contenuti dell'interfaccia resta stretta: le immagini vengono solo dal centro", async (t) => {
  const banco = await allestisci(t);
  const pagina = await banco.centro.inject({ method: "GET", url: "/api/stato", cookies: { [COOKIE_SESSIONE]: await banco.entra() } });
  assert.match(String(pagina.headers["content-security-policy"]), /img-src 'self' data:;/);
});
