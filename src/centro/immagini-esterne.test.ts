import assert from "node:assert/strict";
import { test } from "node:test";
import { ImmaginiEsterne, DIMENSIONE_MASSIMA, immaginiDelTesto, indirizzoAmmesso, indirizzoPubblico, risolviSoloPubblici, tipoDaiByte } from "./immagini-esterne.ts";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

test("solo indirizzi di internet: la rete di casa, il server e gli indirizzi riservati no", () => {
  for (const ip of ["185.15.58.240", "8.8.8.8", "2a02:ec80:600:ed1a::2:b", "::ffff:8.8.8.8"]) assert.equal(indirizzoPubblico(ip), true, ip);
  for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.1.20", "172.20.0.1", "169.254.169.254", "100.64.1.1", "0.0.0.0", "::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "224.0.0.1"]) {
    assert.equal(indirizzoPubblico(ip), false, ip);
  }
});

test("un indirizzo si chiede solo se è https, sulla 443, senza credenziali e fuori dalla rete di casa", () => {
  assert.ok(indirizzoAmmesso("https://upload.wikimedia.org/a.jpg") instanceof URL);
  assert.ok(indirizzoAmmesso("https://upload.wikimedia.org:443/a.jpg") instanceof URL);
  for (const scritto of [
    "http://esempio.it/a.jpg",
    "https://utente:segreto@esempio.it/a.jpg",
    "https://esempio.it:8443/a.jpg",
    "https://192.168.1.20/a.jpg",
    "https://[::1]/a.jpg",
    "https://0x7f.1/a.jpg",
    "https://localhost/a.jpg",
    "https://nas/a.jpg",
    "https://nas.lan/a.jpg",
    "data:image/png;base64,AAAA",
    "non è un indirizzo",
  ]) {
    assert.ok(!(indirizzoAmmesso(scritto) instanceof URL), scritto);
  }
});

test("un nome che porta alla rete di casa viene rifiutato quando si risolve", async () => {
  const errore = await new Promise<NodeJS.ErrnoException | null>((fatto) => risolviSoloPubblici("localhost", {}, (e) => fatto(e)));
  assert.equal(errore?.code, "ENOTPUBLIC");
});

test("un'immagine si riconosce dai primi byte: niente SVG, niente pagine", () => {
  assert.equal(tipoDaiByte(JPEG), "image/jpeg");
  assert.equal(tipoDaiByte(PNG), "image/png");
  assert.equal(tipoDaiByte(Buffer.from("GIF89a....")), "image/gif");
  assert.equal(tipoDaiByte(Buffer.from("RIFF\0\0\0\0WEBPVP8 ")), "image/webp");
  assert.equal(tipoDaiByte(Buffer.from("\0\0\0\x1cftypavif")), "image/avif");
  assert.equal(tipoDaiByte(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')), undefined);
  assert.equal(tipoDaiByte(Buffer.from("<!doctype html><html>")), undefined);
});

test("i reindirizzamenti si seguono solo verso indirizzi ammessi, e non all'infinito", async () => {
  const chiesti: string[] = [];
  const esterne = new ImmaginiEsterne({
    scarica: async (indirizzo) => {
      chiesti.push(indirizzo.href);
      if (indirizzo.pathname === "/buono") return { stato: 302, dove: "https://upload.esempio.org/foto.jpg" };
      if (indirizzo.pathname === "/cattivo") return { stato: 302, dove: "https://192.168.1.20/segreto" };
      if (indirizzo.pathname === "/in-chiaro") return { stato: 301, dove: "http://esempio.org/foto.jpg" };
      if (indirizzo.pathname.startsWith("/giro")) return { stato: 302, dove: `/giro${chiesti.length}` };
      return { stato: 200, dati: JPEG };
    },
  });
  assert.deepEqual(await esterne.leggi("https://esempio.org/buono"), { tipo: "image/jpeg", dati: JPEG });
  assert.deepEqual(await esterne.leggi("https://esempio.org/cattivo"), { motivo: "Un indirizzo della rete di casa o del server non si chiede." });
  assert.deepEqual(await esterne.leggi("https://esempio.org/in-chiaro"), { motivo: "Solo immagini da indirizzi https." });
  assert.deepEqual(await esterne.leggi("https://esempio.org/giro"), { motivo: "Troppi reindirizzamenti." });
  assert.ok(!chiesti.some((indirizzo) => indirizzo.includes("192.168")), "il centro non chiede mai la rete di casa");
});

test("ciò che non è un'immagine, è troppo grande o non risponde non passa, e il motivo si dice", async () => {
  const esterne = new ImmaginiEsterne({
    scarica: async (indirizzo) => {
      if (indirizzo.pathname === "/svg") return { stato: 200, dati: Buffer.from("<svg></svg>") };
      if (indirizzo.pathname === "/grande") return { stato: 200, troppo: true };
      if (indirizzo.pathname === "/manca") return { stato: 404 };
      throw new Error("Il sito non ha risposto in tempo.");
    },
  });
  assert.match((await esterne.leggi("https://esempio.org/svg") as { motivo: string }).motivo, /Non è un'immagine/);
  assert.deepEqual(await esterne.leggi("https://esempio.org/grande"), { motivo: "L'immagine è troppo grande." });
  assert.deepEqual(await esterne.leggi("https://esempio.org/manca"), { motivo: "Il sito ha risposto 404." });
  assert.deepEqual(await esterne.leggi("https://esempio.org/lento"), { motivo: "Il sito non ha risposto in tempo." });
  assert.ok(DIMENSIONE_MASSIMA >= 4 * 1024 * 1024);
});

test("un'immagine già scaricata si ricorda per un giorno, e due richieste insieme ne fanno una", async () => {
  let adesso = 0;
  let volte = 0;
  const esterne = new ImmaginiEsterne({
    adesso: () => adesso,
    scarica: async () => {
      volte += 1;
      await new Promise((fatto) => setTimeout(fatto, 10));
      return { stato: 200, dati: PNG };
    },
  });
  const [prima, seconda] = await Promise.all([esterne.leggi("https://esempio.org/a.png"), esterne.leggi("https://esempio.org/a.png")]);
  assert.deepEqual(prima, seconda);
  assert.equal(volte, 1);
  adesso += 60 * 60 * 1000;
  await esterne.leggi("https://esempio.org/a.png");
  assert.equal(volte, 1);
  adesso += 24 * 60 * 60 * 1000;
  await esterne.leggi("https://esempio.org/a.png");
  assert.equal(volte, 2);
});

test("le immagini di un testo Markdown, nell'ordine, una volta sola, anche con le parentesi nell'indirizzo", () => {
  const testo = [
    "1. ![Tempio del Buddha di Giada](https://commons.wikimedia.org/wiki/Special:FilePath/Jade_Buddha_Temple.jpg?width=640) **Tempio**",
    "2. ![M50](https://upload.wikimedia.org/x/M50_(Shanghai).jpg \"M50\") **M50**",
    "![di nuovo](https://commons.wikimedia.org/wiki/Special:FilePath/Jade_Buddha_Temple.jpg?width=640)",
    "![in chiaro](http://esempio.org/a.jpg) e un [collegamento](https://esempio.org)",
  ].join("\n");
  assert.deepEqual(immaginiDelTesto(testo), [
    { testo: "Tempio del Buddha di Giada", indirizzo: "https://commons.wikimedia.org/wiki/Special:FilePath/Jade_Buddha_Temple.jpg?width=640" },
    { testo: "M50", indirizzo: "https://upload.wikimedia.org/x/M50_(Shanghai).jpg" },
  ]);
});
