import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { collegamenti, disegnaMappa, etichettaSicura, inGiappone, MappaNonDisegnata, serviziVeri, type ServiziMappa } from "./mappa.ts";

const veri = serviziVeri();
const conImageMagick = (() => {
  try {
    execFileSync(veri.convert, ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();
const salta = conImageMagick ? false : "in questo ambiente ImageMagick non c'è";

/** Un riquadro grigio chiaro, come lo darebbe OpenStreetMap ma senza strade. */
const RIQUADRO = conImageMagick ? execFileSync(veri.convert, ["-size", "256x256", "xc:#dddddd", "png:-"]) : Buffer.alloc(0);

const PARTENZA = { lat: 35.6896, lon: 139.7006, etichetta: "Shinjuku Station" };
const ARRIVO = { lat: 35.6895, lon: 139.6917, etichetta: "South Observation Deck" };

function servizi(cambia: Partial<ServiziMappa> = {}): ServiziMappa & { chiesti: { z: number; giappone: boolean }[] } {
  const chiesti: { z: number; giappone: boolean }[] = [];
  return {
    convert: veri.convert,
    font: veri.font,
    chiesti,
    async riquadro(z, _x, _y, giappone) {
      chiesti.push({ z, giappone });
      return RIQUADRO;
    },
    async aPiedi(punti) {
      const [da, a] = [punti[0], punti.at(-1)];
      if (da === undefined || a === undefined) return undefined;
      // Un tragitto a gomito: prima verso sud, poi verso ovest.
      return { coordinate: [[da.lat, da.lon], [da.lat - 0.002, da.lon], [a.lat - 0.002, a.lon], [a.lat, a.lon]], metri: 1180, secondi: 850 };
    },
    ...cambia,
  };
}

async function cartella(t: TestContext): Promise<string> {
  const dove = await mkdtemp(join(tmpdir(), "shinka-mappa-prova-"));
  t.after(() => rm(dove, { recursive: true, force: true }));
  return dove;
}

function colore(file: string, x: number, y: number): [number, number, number] {
  const scritto = execFileSync(veri.convert, [file, "-format", `%[fx:int(255*p{${x},${y}}.r)],%[fx:int(255*p{${x},${y}}.g)],%[fx:int(255*p{${x},${y}}.b)]`, "info:"]).toString();
  const [r, g, b] = scritto.split(",").map(Number);
  return [r ?? -1, g ?? -1, b ?? -1];
}

function misure(file: string): string {
  return execFileSync(veri.convert, [file, "-format", "%wx%h", "info:"]).toString();
}

test("la mappa del tragitto ha i riquadri, la linea, la partenza verde e l'arrivo rosso", { skip: salta }, async (t) => {
  const file = join(await cartella(t), "tragitto.png");
  const finti = servizi();
  const mappa = await disegnaMappa({ punti: [PARTENZA, ARRIVO], tragitto: "piedi" }, file, finti);

  assert.equal(misure(file), "960x720");
  assert.deepEqual(mappa.percorso, { metri: 1180, secondi: 850 });
  assert.ok(finti.chiesti.every((chiesto) => chiesto.giappone && chiesto.z === mappa.zoom), "in Giappone le mappe con i nomi in inglese");
  assert.ok(mappa.zoom >= 15 && mappa.zoom <= 17, `zoom ${mappa.zoom}`);
  const [partenza, arrivo] = mappa.segni;
  assert.ok(partenza !== undefined && arrivo !== undefined);
  // Tutto dentro l'immagine, la partenza a est dell'arrivo.
  for (const segno of mappa.segni) assert.ok(segno.x > 40 && segno.x < 920 && segno.y > 40 && segno.y < 680, JSON.stringify(segno));
  assert.ok(partenza.x > arrivo.x);
  const [rp, gp, bp] = colore(file, partenza.x, partenza.y);
  assert.ok(gp > rp + 40 && gp > bp + 40, `la partenza è verde: ${rp},${gp},${bp}`);
  const [ra, ga, ba] = colore(file, arrivo.x, arrivo.y);
  assert.ok(ra > ga + 80 && ra > ba + 80, `l'arrivo è rosso: ${ra},${ga},${ba}`);
  // Il gomito del tragitto, a metà del tratto verso ovest, è blu.
  const meta = { x: Math.round((partenza.x + arrivo.x) / 2), y: Math.max(partenza.y, arrivo.y) };
  let blu = false;
  for (let y = meta.y; y < 700 && !blu; y += 1) {
    const [r, g, b] = colore(file, meta.x, y);
    blu = b > 180 && r < 80;
  }
  assert.ok(blu, "la linea del tragitto passa sotto i due punti");
  assert.equal(mappa.link.aPiedi, "https://www.google.com/maps/dir/?api=1&origin=35.689600,139.700600&destination=35.689500,139.691700&travelmode=walking");
  assert.match(mappa.link.conIMezzi ?? "", /travelmode=transit$/);
  if (veri.font !== undefined) assert.deepEqual(mappa.avvisi, []);
});

test("un punto solo si disegna da vicino, e fuori dal Giappone con le mappe di OpenStreetMap", { skip: salta }, async (t) => {
  const file = join(await cartella(t), "luogo.png");
  const finti = servizi();
  const mappa = await disegnaMappa({ punti: [{ lat: 45.4642, lon: 9.19, etichetta: "Duomo di Milano" }], larghezza: 640, altezza: 480 }, file, finti);
  assert.equal(misure(file), "640x480");
  assert.equal(mappa.zoom, 17);
  assert.deepEqual(mappa.segni, [{ x: 320, y: 240 }]);
  assert.ok(finti.chiesti.every((chiesto) => !chiesto.giappone));
  assert.equal(mappa.link.aPiedi, undefined);
  assert.equal(mappa.link.luogo, "https://www.google.com/maps/search/?api=1&query=45.464200,9.190000");
});

test("senza percorso o senza qualche pezzo di mappa la mappa c'è lo stesso, e lo dice; senza mappe no", { skip: salta }, async (t) => {
  const dove = await cartella(t);
  let volta = 0;
  const mappa = await disegnaMappa(
    { punti: [PARTENZA, ARRIVO], tragitto: "piedi" },
    join(dove, "senza.png"),
    servizi({
      aPiedi: async () => {
        throw new Error("rete");
      },
      riquadro: async () => (volta++ % 2 === 0 ? RIQUADRO : undefined),
    }),
  );
  assert.equal(mappa.percorso, undefined);
  assert.equal(mappa.avvisi.length, 2);
  assert.match(mappa.avvisi.join(" "), /senza il tragitto/);
  assert.match(mappa.avvisi.join(" "), /resta grigio/);

  await assert.rejects(
    disegnaMappa({ punti: [ARRIVO] }, join(dove, "vuota.png"), servizi({ riquadro: async () => undefined })),
    (errore) => errore instanceof MappaNonDisegnata && /non hanno risposto/.test(errore.message),
  );
  assert.equal(existsSync(join(dove, "vuota.png")), false);
  await assert.rejects(disegnaMappa({ punti: [] }, join(dove, "x.png"), servizi()), MappaNonDisegnata);
  await assert.rejects(disegnaMappa({ punti: [{ lat: 95, lon: 0 }] }, join(dove, "x.png"), servizi()), MappaNonDisegnata);

  // Senza font la mappa resta, senza etichette.
  const senzaFont = await disegnaMappa({ punti: [ARRIVO] }, join(dove, "muta.png"), servizi({ font: undefined }));
  assert.match(senzaFont.avvisi.join(" "), /senza etichette/);
});

test("un'etichetta non porta comandi a ImageMagick, e i caratteri giapponesi vengono segnalati", { skip: salta }, async (t) => {
  assert.equal(etichettaSicura("@/etc/passwd"), "/etc/passwd");
  assert.equal(etichettaSicura("100% Pokémon\\n"), "100%% Pokémon\\\\n");
  assert.equal(etichettaSicura("a\nb"), "a b");
  assert.equal(etichettaSicura("x".repeat(80)).length, 60);
  const dove = await cartella(t);
  const mappa = await disegnaMappa({ punti: [{ ...ARRIVO, etichetta: "東京都庁" }] }, join(dove, "kanji.png"), servizi());
  if (veri.font !== undefined) assert.match(mappa.avvisi.join(" "), /alfabeto latino/);
});

test("il Giappone si riconosce dalle coordinate, e i link di Google Maps passano per le tappe", () => {
  assert.equal(inGiappone([PARTENZA, ARRIVO]), true);
  assert.equal(inGiappone([PARTENZA, { lat: 45.46, lon: 9.19 }]), false);
  const link = collegamenti([PARTENZA, { lat: 35.69, lon: 139.695 }, ARRIVO]);
  assert.match(link.aPiedi ?? "", /&waypoints=35\.690000%2C139\.695000&travelmode=walking$/);
});
