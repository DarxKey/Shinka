/**
 * Prova a vista degli elaborati: l'interfaccia costruita, in un browser vero, davanti a un centro
 * con conversazioni finte. La Home ha scritto un itinerario, una mappa come immagine e una come
 * pagina; il proprietario li vede nella chat e nella pagina degli elaborati, dove stanno solo quelli consegnati. La pagina gira nel suo recinto e non
 * raggiunge le API di Shinka. Si salta dove manca il browser o l'interfaccia costruita. Con
 * SHINKA_PROVA_IMMAGINI, in quella cartella restano le immagini.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { test } from "node:test";
import { chromium } from "playwright-core";
import { allestisci, PASSWORD } from "./banco.ts";
import { browserDiProva } from "./browser-di-prova.ts";

const cartellaWeb = join(import.meta.dirname, "..", "..", "web", "dist");
const disponibile = browserDiProva();
const salta =
  disponibile === undefined
    ? "su questa macchina non c'è un browser per la prova"
    : !existsSync(join(cartellaWeb, "index.html"))
      ? "l'interfaccia non è costruita"
      : false;

const ITINERARIO = `# Giro dei negozi di carte a Tokyo

| Ora | Dove | Note |
|---|---|---|
| 10:00 | Akihabara, Card Labo | Buste giapponesi |
| 12:30 | Nakano Broadway | Carte vintage |
| 16:00 | Ikebukuro, Pokémon Center Mega Tokyo | Esclusive |

- Portare contanti: molti negozi non accettano carte.
`;

/** Una pagina che prova a uscire dal suo recinto e scrive com'è andata. */
const MAPPA_HTML = `<!doctype html>
<html><body style="margin:0;font-family:sans-serif">
<div id="mappa" style="height:300px;background:linear-gradient(135deg,#cfe8d5,#a9cfe8);position:relative">
  <span style="position:absolute;left:30%;top:40%">● Akihabara</span>
  <span style="position:absolute;left:55%;top:60%">● Nakano</span>
</div>
<p id="esito">in corso</p>
<script>
  const esito = [];
  esito.push("script: sì");
  try { esito.push("cookie: " + (document.cookie === "" ? "vuoto" : "visto")); } catch { esito.push("cookie: negato"); }
  try { void window.parent.document.title; esito.push("genitore: visto"); } catch { esito.push("genitore: negato"); }
  fetch("/api/quadro/eventi", { credentials: "include" })
    .then((r) => esito.push("api: " + r.status))
    .catch(() => esito.push("api: bloccata"))
    .finally(() => { document.getElementById("esito").textContent = esito.join("; "); });
</script>
</body></html>`;

test(
  "il proprietario vede nella chat e nella pagina degli elaborati ciò che la Home consegna, e una pagina non esce dal recinto",
  { skip: salta, timeout: 90_000 },
  async (t) => {
    const banco = await allestisci(t, { cartellaWeb });
    await banco.centro.listen({ host: "127.0.0.1", port: 0 });
    const porta = (banco.centro.server.address() as AddressInfo).port;

    const browser = await chromium.launch({
      chromiumSandbox: disponibile?.recinto !== false,
      ...(disponibile?.canale === undefined ? {} : { channel: disponibile.canale }),
      ...(disponibile?.eseguibile === undefined ? {} : { executablePath: disponibile.eseguibile }),
    });
    t.after(() => browser.close());

    // La mappa come immagine: la disegna il browser stesso.
    const disegno = await browser.newPage({ viewport: { width: 640, height: 400 } });
    await disegno.setContent(
      `<body style="margin:0"><div style="width:640px;height:400px;background:linear-gradient(135deg,#d8ecd0,#b5d4ea);font:16px sans-serif;position:relative">
        <span style="position:absolute;left:180px;top:150px">● Akihabara</span>
        <span style="position:absolute;left:380px;top:250px">● Nakano Broadway</span>
        <span style="position:absolute;left:260px;top:60px">● Ikebukuro</span></div></body>`,
    );
    const png = await disegno.screenshot();
    await disegno.close();

    const cartella = banco.casa.cartellaAperta;
    await mkdir(join(cartella, "tokyo"), { recursive: true });
    await writeFile(join(cartella, "tokyo", "itinerario.md"), ITINERARIO);
    await writeFile(join(cartella, "tokyo", "mappa.png"), png);
    await writeFile(join(cartella, "tokyo", "mappa.html"), MAPPA_HTML);

    const pagina = await browser.newPage({ viewport: { width: 1280, height: 800 }, colorScheme: "light" });
    const cartellaImmagini = process.env.SHINKA_PROVA_IMMAGINI;
    if (cartellaImmagini !== undefined) await mkdir(cartellaImmagini, { recursive: true });
    const fotografa = async (nome: string) => {
      if (cartellaImmagini === undefined) return;
      await pagina.waitForTimeout(600);
      await pagina.screenshot({ path: join(cartellaImmagini, `elaborati-${nome}.png`) });
    };

    await pagina.goto(`http://127.0.0.1:${porta}/`);
    await pagina.fill("#password", PASSWORD);
    await pagina.click('button[type="submit"]');
    await pagina.locator("form.scrittura textarea").waitFor();

    // La Home consegna l'itinerario e la mappa, e li mostra nella chat.
    const id = banco.casa.idArgomentoAperto;
    banco.home.invia("Fammi un itinerario per i negozi di carte Pokémon a Tokyo, con una mappa.");
    banco.home.emetti({ tipo: "testo-iniziato", idTesto: "t1" });
    banco.home.emetti({ tipo: "testo-concluso", idTesto: "t1", testo: "Ecco l'itinerario e la mappa, in `tokyo/`." });
    const mostra = (percorso: string, titolo?: string) =>
      banco.home.emetti({
        tipo: "elaborato-mostrato",
        idArgomento: id,
        idAmbiente: "centro",
        nomeAmbiente: "Unraid",
        percorso,
        ...(titolo === undefined ? {} : { titolo }),
      });
    mostra("tokyo/itinerario.md", "Itinerario dei negozi");
    mostra("tokyo/mappa.png", "Mappa dei negozi");
    banco.home.emetti({ tipo: "turno-concluso", riuscito: true, durataMs: 10 });

    const schede = pagina.locator(".scheda-elaborato");
    await schede.nth(1).locator("img").waitFor();
    assert.equal(await schede.count(), 2);
    await pagina.getByText("Nakano Broadway").first().waitFor();
    const immagine = schede.nth(1).locator("img");
    await pagina.waitForFunction(() => {
      const img = document.querySelectorAll(".scheda-elaborato img")[0] as HTMLImageElement | undefined;
      return img !== undefined && img.complete && img.naturalWidth > 0;
    });
    assert.ok((await immagine.evaluate((img: HTMLImageElement) => img.naturalWidth)) > 100, "la mappa si vede nella chat");
    await fotografa("chat");

    // Dalla scheda il proprietario apre la mappa nella pagina degli elaborati.
    await schede.nth(1).getByRole("button", { name: "Apri" }).click();
    await pagina.waitForURL(/#\/elaborati\//);
    await pagina.locator(".elaborato-in-pagina img").waitFor();
    assert.equal(await pagina.locator(".testata h1").textContent(), "Mappa dei negozi");
    await fotografa("pagina-immagine");

    // La pagina dalla barra laterale: solo ciò che la Home ha consegnato, per giorno. La mappa HTML
    // è nella cartella, ma la Home non l'ha mostrata: non è un elaborato consegnato.
    await pagina.goto(`http://127.0.0.1:${porta}/#/elaborati`);
    const voci = pagina.locator(".elenco-consegnati .voce-elaborato .nome");
    await voci.first().waitFor();
    assert.deepEqual(await voci.allTextContents(), ["Mappa dei negozi", "Itinerario dei negozi"]);
    assert.deepEqual(await pagina.locator(".giorno-elaborati h2").allTextContents(), ["Oggi"]);
    await fotografa("pagina-elenco");

    // La Home consegna anche la mappa HTML: arriva in cima. Gira, ma nel suo recinto.
    mostra("tokyo/mappa.html", "Mappa interattiva");
    await pagina.reload();
    await voci.first().waitFor();
    assert.equal(await voci.first().textContent(), "Mappa interattiva");
    await pagina.locator(".voce-elaborato", { hasText: "Mappa interattiva" }).click();
    const riquadro = pagina.locator(".elaborato-in-pagina iframe");
    await riquadro.waitFor();
    assert.equal(await riquadro.getAttribute("sandbox"), "allow-scripts allow-popups allow-popups-to-escape-sandbox");
    const dentro = pagina.frameLocator(".elaborato-in-pagina iframe");
    await dentro.locator("#esito").filter({ hasNotText: "in corso" }).waitFor();
    const esito = (await dentro.locator("#esito").textContent()) ?? "";
    assert.match(esito, /script: sì/);
    assert.match(esito, /cookie: (negato|vuoto)/);
    assert.match(esito, /genitore: negato/);
    assert.doesNotMatch(esito, /api: 200/);
    await fotografa("pagina-html");

    // L'itinerario in Markdown, in tema scuro e su un telefono; si torna all'elenco.
    await pagina.getByRole("link", { name: "‹ Tutti gli elaborati" }).click();
    await pagina.locator(".voce-elaborato", { hasText: "Itinerario dei negozi" }).click();
    await pagina.locator(".elaborato-in-pagina table").waitFor();
    await pagina.emulateMedia({ colorScheme: "dark" });
    await pagina.setViewportSize({ width: 390, height: 780 });
    await fotografa("telefono-markdown-scuro");
    await pagina.getByRole("link", { name: "‹ Tutti gli elaborati" }).click();
    await voci.first().waitFor();
    await fotografa("telefono-elenco");
  },
);
