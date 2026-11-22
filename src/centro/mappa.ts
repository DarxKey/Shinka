/**
 * Le mappe come immagine, per la Home: i riquadri di OpenStreetMap messi insieme, i punti con le
 * loro etichette e, se serve, il tragitto a piedi tra il primo e l'ultimo, calcolato da un servizio
 * di percorsi aperto. Il disegno lo fa ImageMagick, con un font indicato per nome di file: senza,
 * ImageMagick cerca un font che sul server non c'è, e le etichette non si scrivono.
 *
 * Su Telegram una pagina HTML con una mappa si apre vuota: lì le mappe vanno come immagine.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface PuntoMappa {
  lat: number;
  lon: number;
  /** Il nome da scrivere accanto al punto, in alfabeto latino. */
  etichetta?: string;
  ruolo?: "partenza" | "arrivo" | "tappa";
}

export interface RichiestaMappa {
  punti: PuntoMappa[];
  /** Il tragitto a piedi dal primo all'ultimo punto, passando per quelli in mezzo. */
  tragitto?: "piedi";
  larghezza?: number;
  altezza?: number;
}

export interface PercorsoTrovato {
  /** I punti del tragitto, come [lat, lon]. */
  coordinate: [number, number][];
  metri: number;
  secondi: number;
}

/** Ciò che la mappa usa dal mondo: si cambia nelle prove. */
export interface ServiziMappa {
  /** Un riquadro della mappa, oppure nulla se non arriva. `giappone` sceglie le mappe con i nomi in alfabeto latino. */
  riquadro(z: number, x: number, y: number, giappone: boolean): Promise<Buffer | undefined>;
  /** Il tragitto a piedi che passa per questi punti, oppure nulla se non si trova. */
  aPiedi(punti: { lat: number; lon: number }[]): Promise<PercorsoTrovato | undefined>;
  /** Il programma di ImageMagick. */
  convert: string;
  /** Il file del font per le etichette; nulla se non ce n'è uno. */
  font: string | undefined;
}

export interface MappaDisegnata {
  larghezza: number;
  altezza: number;
  zoom: number;
  /** Dove sono finiti i punti nell'immagine, nell'ordine in cui sono stati dati. */
  segni: { x: number; y: number }[];
  percorso?: { metri: number; secondi: number };
  link: { luogo: string; aPiedi?: string; conIMezzi?: string };
  /** Ciò che non è andato come doveva, in parole per la Home. */
  avvisi: string[];
}

/** Il problema che impedisce di disegnare la mappa, in parole per la Home. */
export class MappaNonDisegnata extends Error {}

const LATO = 256;
const MARGINE = 70;
const PUNTI_MASSIMI = 20;
const RIQUADRI_MASSIMI = 48;
const COLORI = { partenza: "#2e7d32", arrivo: "#c62828", tappa: "#1a73e8" } as const;

/** Dove sta un punto nel mondo, in pixel, a un certo zoom. */
function inPixel(lat: number, lon: number, z: number): { x: number; y: number } {
  const mondo = LATO * 2 ** z;
  const seno = Math.sin((Math.max(Math.min(lat, 85.0511), -85.0511) * Math.PI) / 180);
  return {
    x: ((lon + 180) / 360) * mondo,
    y: (0.5 - Math.log((1 + seno) / (1 - seno)) / (4 * Math.PI)) * mondo,
  };
}

/** Vero se i punti stanno in Giappone, dove le mappe giapponesi hanno anche i nomi in inglese. */
export function inGiappone(punti: { lat: number; lon: number }[]): boolean {
  return punti.every((punto) => punto.lat >= 24 && punto.lat <= 46 && punto.lon >= 122 && punto.lon <= 154);
}

/** Un'etichetta come ImageMagick la scrive tale e quale: senza segni che interpreterebbe. */
export function etichettaSicura(testo: string): string {
  return testo
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "%%")
    .replace(/^@+/, "")
    .trim()
    .slice(0, 60);
}

/** I collegamenti a Google Maps: il luogo, e il tragitto a piedi e con i mezzi se i punti sono più d'uno. */
export function collegamenti(punti: { lat: number; lon: number }[]): MappaDisegnata["link"] {
  const scritto = (punto: { lat: number; lon: number }): string => `${punto.lat.toFixed(6)},${punto.lon.toFixed(6)}`;
  const ultimo = punti.at(-1);
  if (ultimo === undefined) return { luogo: "https://www.google.com/maps" };
  const luogo = `https://www.google.com/maps/search/?api=1&query=${scritto(ultimo)}`;
  const primo = punti[0];
  if (punti.length < 2 || primo === undefined) return { luogo };
  const tappe = punti.slice(1, -1).map(scritto).join("|");
  const base = `https://www.google.com/maps/dir/?api=1&origin=${scritto(primo)}&destination=${scritto(ultimo)}${tappe === "" ? "" : `&waypoints=${encodeURIComponent(tappe)}`}`;
  return { luogo, aPiedi: `${base}&travelmode=walking`, conIMezzi: `${base}&travelmode=transit` };
}

/** Disegna la mappa nel file indicato, che dev'essere un PNG. */
export async function disegnaMappa(richiesta: RichiestaMappa, file: string, servizi: ServiziMappa): Promise<MappaDisegnata> {
  const punti = richiesta.punti;
  if (punti.length === 0 || punti.length > PUNTI_MASSIMI) {
    throw new MappaNonDisegnata(`Servono da 1 a ${PUNTI_MASSIMI} punti.`);
  }
  for (const punto of punti) {
    if (!Number.isFinite(punto.lat) || !Number.isFinite(punto.lon) || Math.abs(punto.lat) > 85 || Math.abs(punto.lon) > 180) {
      throw new MappaNonDisegnata(`Il punto ${punto.lat}, ${punto.lon} non è sulla mappa.`);
    }
  }
  const larghezza = Math.round(Math.min(Math.max(richiesta.larghezza ?? 960, 320), 1600));
  const altezza = Math.round(Math.min(Math.max(richiesta.altezza ?? 720, 240), 1600));
  const avvisi: string[] = [];

  let percorso: PercorsoTrovato | undefined;
  if (richiesta.tragitto === "piedi") {
    if (punti.length < 2) {
      avvisi.push("Per un tragitto servono almeno due punti: la partenza e l'arrivo.");
    } else {
      percorso = await servizi.aPiedi(punti).catch(() => undefined);
      if (percorso === undefined || percorso.coordinate.length < 2) {
        percorso = undefined;
        avvisi.push("Il servizio dei percorsi non ha risposto: sulla mappa ci sono i punti, senza il tragitto. Il link di Google Maps lo calcola.");
      }
    }
  }

  // Lo zoom più alto a cui tutto sta nell'immagine, con un margine attorno.
  const tutti: [number, number][] = [...punti.map((punto): [number, number] => [punto.lat, punto.lon]), ...(percorso?.coordinate ?? [])];
  let zoom = 2;
  for (let z = 18; z >= 2; z -= 1) {
    const pixel = tutti.map(([lat, lon]) => inPixel(lat, lon, z));
    const largo = Math.max(...pixel.map((p) => p.x)) - Math.min(...pixel.map((p) => p.x));
    const alto = Math.max(...pixel.map((p) => p.y)) - Math.min(...pixel.map((p) => p.y));
    if (largo <= larghezza - 2 * MARGINE && alto <= altezza - 2 * MARGINE) {
      zoom = z;
      break;
    }
  }
  // Un punto solo, o punti vicinissimi: abbastanza da vedere le strade attorno.
  if (tutti.length === 1 || zoom > 17) zoom = Math.min(zoom, 17);
  const pixel = tutti.map(([lat, lon]) => inPixel(lat, lon, zoom));
  const centroX = (Math.max(...pixel.map((p) => p.x)) + Math.min(...pixel.map((p) => p.x))) / 2;
  const centroY = (Math.max(...pixel.map((p) => p.y)) + Math.min(...pixel.map((p) => p.y))) / 2;
  const origineX = Math.round(centroX - larghezza / 2);
  const origineY = Math.round(centroY - altezza / 2);
  const qui = (lat: number, lon: number): { x: number; y: number } => {
    const p = inPixel(lat, lon, zoom);
    return { x: Math.round(p.x - origineX), y: Math.round(p.y - origineY) };
  };

  // I riquadri che coprono l'immagine.
  const quanti = 2 ** zoom;
  const riquadri: { x: number; y: number; dx: number; dy: number }[] = [];
  for (let ty = Math.floor(origineY / LATO); ty <= Math.floor((origineY + altezza - 1) / LATO); ty += 1) {
    if (ty < 0 || ty >= quanti) continue;
    for (let tx = Math.floor(origineX / LATO); tx <= Math.floor((origineX + larghezza - 1) / LATO); tx += 1) {
      riquadri.push({ x: ((tx % quanti) + quanti) % quanti, y: ty, dx: tx * LATO - origineX, dy: ty * LATO - origineY });
    }
  }
  if (riquadri.length > RIQUADRI_MASSIMI) throw new MappaNonDisegnata("La mappa chiesta è troppo grande.");

  const giappone = inGiappone(punti);
  const cartella = await mkdtemp(join(tmpdir(), "shinka-mappa-"));
  try {
    const scaricati = await conPochiAllaVolta(riquadri, 6, async (riquadro, posizione) => {
      const dati = await servizi.riquadro(zoom, riquadro.x, riquadro.y, giappone).catch(() => undefined);
      if (dati === undefined) return undefined;
      const percorsoFile = join(cartella, `r${posizione}.png`);
      await writeFile(percorsoFile, dati);
      return { file: percorsoFile, dx: riquadro.dx, dy: riquadro.dy };
    });
    const arrivati = scaricati.filter((voce) => voce !== undefined);
    if (arrivati.length === 0) throw new MappaNonDisegnata("Le mappe di OpenStreetMap non hanno risposto: riprova tra poco.");
    if (arrivati.length < riquadri.length) avvisi.push("Qualche pezzo della mappa non è arrivato: resta grigio.");

    const spostamento = (n: number): string => (n >= 0 ? `+${n}` : `${n}`);
    const argomenti: string[] = ["-size", `${larghezza}x${altezza}`, "xc:#e5e3df"];
    for (const riquadro of arrivati) {
      argomenti.push(riquadro.file, "-geometry", `${spostamento(riquadro.dx)}${spostamento(riquadro.dy)}`, "-composite");
    }

    if (percorso !== undefined) {
      // Il percorso parte e arriva sulla strada più vicina: la linea va fino ai punti veri.
      const primo = punti[0];
      const ultimo = punti.at(-1);
      const tratti: [number, number][] = [
        ...(primo === undefined ? [] : [[primo.lat, primo.lon] as [number, number]]),
        ...percorso.coordinate,
        ...(ultimo === undefined ? [] : [[ultimo.lat, ultimo.lon] as [number, number]]),
      ];
      const linea = sfoltisci(tratti.map(([lat, lon]) => qui(lat, lon)), 1500)
        .map((p) => `${p.x},${p.y}`)
        .join(" ");
      argomenti.push(
        "-fill", "none",
        "-stroke", "white", "-strokewidth", "10", "-draw", `stroke-linejoin round stroke-linecap round polyline ${linea}`,
        "-stroke", "#1a73e8", "-strokewidth", "6", "-draw", `stroke-linejoin round stroke-linecap round polyline ${linea}`,
      );
    }

    const segni = punti.map((punto) => qui(punto.lat, punto.lon));
    punti.forEach((punto, posizione) => {
      const ruolo =
        punto.ruolo ?? (punti.length === 1 ? "arrivo" : posizione === 0 ? "partenza" : posizione === punti.length - 1 ? "arrivo" : "tappa");
      const { x, y } = segni[posizione] ?? { x: 0, y: 0 };
      argomenti.push("-fill", COLORI[ruolo], "-stroke", "white", "-strokewidth", "3", "-draw", `circle ${x},${y} ${x + 11},${y}`);
    });

    if (servizi.font === undefined) {
      avvisi.push("In questo ambiente non c'è un font: la mappa è senza etichette e senza la scritta di OpenStreetMap.");
    } else {
      const scritti = punti.map((punto) => etichettaSicura(punto.etichetta ?? ""));
      if (scritti.some((testo) => /[\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/.test(testo))) {
        avvisi.push("Il font di questo ambiente non ha i caratteri giapponesi, cinesi o coreani: scrivi le etichette in alfabeto latino.");
      }
      argomenti.push("-font", servizi.font, "-pointsize", "17");
      punti.forEach((_punto, posizione) => {
        const testo = scritti[posizione] ?? "";
        if (testo === "") return;
        const { x, y } = segni[posizione] ?? { x: 0, y: 0 };
        const largo = Math.ceil(testo.length * 17 * 0.62);
        const a = x + 16 + largo > larghezza - 4 ? x - 16 - largo : x + 16;
        const dove = `${spostamento(Math.max(a, 4))}${spostamento(y + 6)}`;
        argomenti.push(
          "-fill", "#202124", "-stroke", "white", "-strokewidth", "5", "-annotate", dove, testo,
          "-stroke", "none", "-annotate", dove, testo,
        );
      });
      // Le mappe di OpenStreetMap chiedono che si dica da dove vengono.
      const firma = "© OpenStreetMap";
      const dove = `+${larghezza - 128}+${altezza - 8}`;
      argomenti.push(
        "-pointsize", "12",
        "-fill", "#3c4043", "-stroke", "white", "-strokewidth", "3", "-annotate", dove, firma,
        "-stroke", "none", "-annotate", dove, firma,
      );
    }
    argomenti.push(`png:${file}`);
    await eseguiConvert(servizi.convert, argomenti);
    const tappe = punti.map((punto) => ({ lat: punto.lat, lon: punto.lon }));
    return {
      larghezza,
      altezza,
      zoom,
      segni,
      ...(percorso === undefined ? {} : { percorso: { metri: percorso.metri, secondi: percorso.secondi } }),
      link: collegamenti(tappe),
      avvisi,
    };
  } finally {
    await rm(cartella, { recursive: true, force: true });
  }
}

function eseguiConvert(programma: string, argomenti: string[]): Promise<void> {
  return new Promise((fatto, fallito) => {
    // Gli argomenti passano uno per uno, senza shell: un'etichetta non diventa mai un comando.
    execFile(programma, argomenti, { timeout: 60_000, maxBuffer: 1024 * 1024 }, (errore, _uscita, errori) => {
      if (errore === null) return fatto();
      const assente = "code" in errore && errore.code === "ENOENT";
      fallito(
        new MappaNonDisegnata(
          assente ? "In questo ambiente ImageMagick non c'è: la mappa non si può disegnare." : `ImageMagick non ce l'ha fatta: ${String(errori).trim().slice(0, 300)}`,
        ),
      );
    });
  });
}

/** Al massimo `quanti` punti, tenendo il primo e l'ultimo: una linea lunghissima non serve a vederla. */
function sfoltisci<T>(punti: T[], quanti: number): T[] {
  if (punti.length <= quanti) return punti;
  const passo = (punti.length - 1) / (quanti - 1);
  return Array.from({ length: quanti }, (_, i) => punti[Math.round(i * passo)] as T);
}

async function conPochiAllaVolta<T, R>(voci: T[], quanti: number, lavoro: (voce: T, posizione: number) => Promise<R>): Promise<R[]> {
  const risultati: R[] = new Array(voci.length);
  let prossima = 0;
  const operaio = async (): Promise<void> => {
    while (prossima < voci.length) {
      const posizione = prossima;
      prossima += 1;
      risultati[posizione] = await lavoro(voci[posizione] as T, posizione);
    }
  };
  await Promise.all(Array.from({ length: Math.min(quanti, voci.length) }, operaio));
  return risultati;
}

/** Chi chiede le mappe e i percorsi si presenta come Shinka, senza dire di chi è. */
const CHI_CHIEDE = "Shinka/1.0 (assistente personale; uso occasionale)";

/** I servizi veri: OpenStreetMap per le mappe, i server di FOSSGIS per i percorsi a piedi. */
export function serviziVeri(ambiente: NodeJS.ProcessEnv = process.env): ServiziMappa {
  const font = [
    ambiente.SHINKA_FONT_MAPPE,
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans.ttf",
    "C:\\Windows\\Fonts\\arialbd.ttf",
    "C:\\Windows\\Fonts\\arial.ttf",
  ].find((candidato) => candidato !== undefined && candidato !== "" && existsSync(candidato));
  return {
    convert: ambiente.SHINKA_CONVERT ?? (process.platform === "win32" ? "magick" : "convert"),
    font,
    async riquadro(z, x, y, giappone) {
      const indirizzo = giappone
        ? `https://tile.openstreetmap.jp/styles/osm-bright-en/${z}/${x}/${y}.png`
        : `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
      const risposta = await fetch(indirizzo, { headers: { "user-agent": CHI_CHIEDE }, signal: AbortSignal.timeout(15_000) });
      if (!risposta.ok) return undefined;
      return Buffer.from(await risposta.arrayBuffer());
    },
    async aPiedi(punti) {
      const tappe = punti.map((punto) => `${punto.lon},${punto.lat}`).join(";");
      const risposta = await fetch(
        `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${tappe}?overview=full&geometries=geojson`,
        { headers: { "user-agent": CHI_CHIEDE }, signal: AbortSignal.timeout(20_000) },
      );
      if (!risposta.ok) return undefined;
      const letto = (await risposta.json()) as { routes?: { distance?: number; duration?: number; geometry?: { coordinates?: [number, number][] } }[] };
      const strada = letto.routes?.[0];
      const coordinate = strada?.geometry?.coordinates;
      if (strada === undefined || !Array.isArray(coordinate) || typeof strada.distance !== "number" || typeof strada.duration !== "number") return undefined;
      return { coordinate: coordinate.map(([lon, lat]) => [lat, lon]), metri: strada.distance, secondi: strada.duration };
    },
  };
}
