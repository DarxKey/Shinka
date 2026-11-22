/**
 * Prova a vista dell'applicazione di un progetto: l'interfaccia costruita, in un browser vero,
 * davanti a un centro con un'applicazione vera nell'ambiente del centro. Il proprietario dice come
 * si avvia, la avvia con il pulsante e la vede nell'anteprima, la ferma; un comando sbagliato
 * mostra l'errore con le ultime righe. Si salta dove manca il browser o l'interfaccia costruita, e
 * su Windows. Con SHINKA_PROVA_IMMAGINI, in quella cartella restano le immagini.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer, type AddressInfo } from "node:net";
import { join } from "node:path";
import { test } from "node:test";
import { chromium } from "playwright-core";
import { sondaVera } from "../nodo/applicazioni.ts";
import { allestisci, PASSWORD } from "./banco.ts";
import { browserDiProva } from "./browser-di-prova.ts";

const cartellaWeb = join(import.meta.dirname, "..", "..", "web", "dist");
const disponibile = browserDiProva();
const salta =
  process.platform === "win32"
    ? "su Windows il comando passa da PowerShell"
    : disponibile === undefined
      ? "su questa macchina non c'è un browser per la prova"
      : !existsSync(join(cartellaWeb, "index.html"))
        ? "l'interfaccia non è costruita"
        : false;

async function portaLibera(): Promise<number> {
  const server = createServer();
  await new Promise<void>((fatto) => server.listen(0, "127.0.0.1", fatto));
  const { port } = server.address() as AddressInfo;
  await new Promise((fatto) => server.close(fatto));
  return port;
}

test("il proprietario avvia e ferma l'applicazione del progetto dal pulsante, e la vede nell'anteprima", { skip: salta, timeout: 90_000 }, async (t) => {
  const portaAnteprima = await portaLibera();
  const banco = await allestisci(t, { cartellaWeb, portaAnteprima });
  const progetto = await banco.lavori.crea("Ricettario", "centro", "Un'app per le ricette.");
  await writeFile(
    join(progetto.cartella, "server.js"),
    "require('node:http').createServer((q,r)=>{r.setHeader('content-type','text/html');r.end('<h1>Le ricette di casa</h1>')}).listen(Number(process.env.PORT),'127.0.0.1',()=>console.log('pronto'));",
  );
  const porta = await portaLibera();
  await banco.centro.listen({ host: "127.0.0.1", port: 0 });
  const indirizzo = `http://127.0.0.1:${(banco.centro.server.address() as AddressInfo).port}`;
  // Il server dell'anteprima, sulla sua porta, come nel centro vero.
  const { creaServerAnteprima } = await import("../centro/server-anteprima.ts");
  const serverAnteprima = await creaServerAnteprima({ accesso: banco.accesso, anteprime: banco.anteprime });
  await serverAnteprima.listen({ host: "127.0.0.1", port: portaAnteprima });
  t.after(() => serverAnteprima.close());

  const browser = await chromium.launch({
    chromiumSandbox: disponibile?.recinto !== false,
    ...(disponibile?.canale === undefined ? {} : { channel: disponibile.canale }),
    ...(disponibile?.eseguibile === undefined ? {} : { executablePath: disponibile.eseguibile }),
  });
  t.after(() => browser.close());
  const pagina = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const cartellaImmagini = process.env.SHINKA_PROVA_IMMAGINI;
  if (cartellaImmagini !== undefined) await mkdir(cartellaImmagini, { recursive: true });
  const fotografa = async (nome: string) => {
    if (cartellaImmagini === undefined) return;
    await pagina.waitForTimeout(400);
    await pagina.screenshot({ path: join(cartellaImmagini, `applicazione-${nome}.png`) });
  };

  await pagina.goto(`${indirizzo}/`);
  await pagina.fill("#password", PASSWORD);
  await pagina.click('button[type="submit"]');
  await pagina.locator("form.scrittura textarea").waitFor();
  await pagina.goto(`${indirizzo}/#/progetti/${progetto.id}`);
  await pagina.getByRole("button", { name: "Anteprima dell'applicazione" }).click();

  // Prima volta: si dice come si avvia. Un comando sbagliato mostra l'errore e le ultime righe.
  const pannello = pagina.locator(".applicazione");
  await pagina.getByLabel("Comando", { exact: true }).fill("node non-esiste.js");
  await pagina.getByLabel("Porta", { exact: true }).fill(String(porta));
  await pagina.getByRole("button", { name: "Salva" }).click();
  await pannello.getByRole("button", { name: "Avvia" }).click();
  await pannello.locator(".spia-applicazione.fallita").waitFor();
  await pannello.getByText(/Cannot find module/).first().waitFor();
  await fotografa("fallita");

  // Corretto il comando, si avvia e l'anteprima si apre da sola.
  await pannello.getByRole("button", { name: "Modifica" }).click();
  await pagina.getByLabel("Comando", { exact: true }).fill("node server.js");
  await pagina.getByRole("button", { name: "Salva" }).click();
  await pannello.getByRole("button", { name: "Riprova" }).click();
  await pannello.locator(".spia-applicazione.attiva").waitFor();
  const riquadro = pagina.frameLocator(".anteprima-riquadro");
  await riquadro.getByText("Le ricette di casa").waitFor();
  assert.equal(banco.progetti.applicazione(progetto.id).voluta, true);
  await fotografa("attiva");

  // Ferma: l'applicazione si spegne e l'anteprima si chiude.
  await pannello.getByRole("button", { name: "Ferma" }).click();
  await pannello.locator(".spia-applicazione.ferma").waitFor();
  assert.equal(await sondaVera(porta), false);
  assert.equal(await pagina.locator(".anteprima-riquadro").count(), 0);
  assert.equal(banco.progetti.applicazione(progetto.id).voluta, false);
  await fotografa("ferma");

  // Sul telefono.
  await pagina.setViewportSize({ width: 390, height: 844 });
  await pannello.getByRole("button", { name: "Avvia" }).click();
  await pannello.locator(".spia-applicazione.attiva").waitFor();
  await fotografa("telefono");
});
