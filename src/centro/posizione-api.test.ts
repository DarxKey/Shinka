import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { allestisci } from "../prove/banco.ts";
import { COOKIE_SESSIONE } from "./centro.ts";
import { serviziVeri, type ServiziMappa } from "./mappa.ts";
import { azioniDellaHome } from "./strumenti-home.ts";

test("la posizione mandata dal browser arriva alla Home come messaggio del proprietario", async (t) => {
  const banco = await allestisci(t);
  const cookies = { [COOKIE_SESSIONE]: await banco.entra() };
  const manda = (payload: unknown) => banco.centro.inject({ method: "POST", url: "/api/home/posizione", cookies, payload: payload as object });

  // Una posizione presa adesso: una di ore fa sarebbe già scaduta.
  const adesso = new Date();
  adesso.setUTCSeconds(0, 0);
  const ora = adesso.toISOString().slice(11, 16);
  const mandata = await manda({ lat: 45.4642, lon: 9.19, precisioneM: 30, quando: adesso.toISOString() });
  assert.equal(mandata.statusCode, 202);
  assert.deepEqual(banco.home.inviati, [`📍 La mia posizione: 45.46420, 9.19000, precisione ±30 m (presa alle ${ora} UTC).`]);
  assert.equal(banco.posizione.ultima()?.fonte, "browser");

  // Una posizione storta non passa; senza sessione nemmeno.
  assert.equal((await manda({ lat: 95, lon: 9, quando: "2026-11-13T09:00:00Z" })).statusCode, 400);
  assert.equal((await manda({ lat: 45, lon: 9, quando: "ieri" })).statusCode, 400);
  const senza = await banco.centro.inject({ method: "POST", url: "/api/home/posizione", payload: { lat: 1, lon: 1, quando: "2026-11-13T09:00:00Z" } });
  assert.equal(senza.statusCode, 401);
  assert.equal(banco.home.inviati.length, 1);
});

const veri = serviziVeri();
const conImageMagick = (() => {
  try {
    execFileSync(veri.convert, ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

test(
  "la Home disegna una mappa nella cartella dell'argomento, e riceve tragitto e link",
  { skip: conImageMagick ? false : "in questo ambiente ImageMagick non c'è" },
  async (t) => {
    const banco = await allestisci(t);
    const riquadro = execFileSync(veri.convert, ["-size", "256x256", "xc:#dddddd", "png:-"]);
    const mappe: ServiziMappa = {
      convert: veri.convert,
      font: veri.font,
      riquadro: async () => riquadro,
      aPiedi: async () => ({ coordinate: [[35.6905, 139.7003], [35.6896, 139.6917]], metri: 978, secondi: 782 }),
    };
    const azioni = azioniDellaHome({
      ambienti: banco.ambienti,
      lavori: banco.lavori,
      proposte: banco.proposte,
      home: () => banco.casa,
      agisci: banco.agisci,
      mappe,
      cartellaDellArgomento: (id) => banco.casa.cartellaDellArgomento(id),
    });
    const punti = [
      { lat: 35.6905, lon: 139.7003, etichetta: "Shinjuku Station" },
      { lat: 35.68963, lon: 139.6917, etichetta: "South Observation Deck" },
    ];
    const esito = await azioni.disegnaMappa({ punti, tragitto: "piedi", file: "tokyo/tragitto.png" });
    assert.equal(esito.isError, undefined, esito.content[0].text);
    assert.ok(existsSync(join(banco.casa.cartellaAperta, "tokyo", "tragitto.png")));
    const testo = esito.content[0].text;
    assert.match(testo, /Mappa disegnata: "tokyo\/tragitto\.png" nell'ambiente "Unraid"\. Mostrala con mostra_elaborato\./);
    assert.match(testo, /Tragitto a piedi: 1,0 km, circa 13 minuti/);
    assert.match(testo, /travelmode=transit/);

    // Il file resta nella cartella dell'argomento, ed è un PNG.
    for (const file of ["../fuori.png", "/tmp/fuori.png", "mappa.html"]) {
      const rifiuto = await azioni.disegnaMappa({ punti, file });
      assert.equal(rifiuto.isError, true, file);
    }
  },
);
