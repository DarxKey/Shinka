import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { allestisci } from "../prove/banco.ts";
import { politicaContenuti } from "./centro.ts";

const web = join(import.meta.dirname, "..", "..", "web");
const pubblica = join(web, "public");

/** I file che `index.html` chiede con i suoi collegamenti e meta. */
function collegamentiDi(html: string): Map<string, string> {
  const trovati = new Map<string, string>();
  for (const [, rel, href] of html.matchAll(/<link rel="([^"]+)"(?: [a-z]+="[^"]*")* href="([^"]+)"/g)) {
    if (rel !== undefined && href !== undefined) trovati.set(href, rel);
  }
  return trovati;
}

test("index.html dà all'iPhone nome, icona e manifest, e i file ci sono", () => {
  const html = readFileSync(join(web, "index.html"), "utf8");
  assert.match(html, /<meta name="apple-mobile-web-app-title" content="Shinka" \/>/);
  assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes" \/>/);
  assert.match(html, /<meta name="mobile-web-app-capable" content="yes" \/>/);
  assert.match(html, /<meta name="theme-color" content="#ffffff" media="\(prefers-color-scheme: light\)" \/>/);
  assert.match(html, /<meta name="theme-color" content="#1f1f22" media="\(prefers-color-scheme: dark\)" \/>/);
  assert.match(html, /viewport-fit=cover/);
  const collegamenti = collegamentiDi(html);
  assert.equal(collegamenti.get("/apple-touch-icon.png"), "apple-touch-icon");
  assert.match(html, /<link rel="apple-touch-icon" sizes="180x180" href="\/apple-touch-icon\.png" \/>/);
  assert.equal(collegamenti.get("/manifest.webmanifest"), "manifest");
  // Il favicon disegnato per le misure piccole; il logo intero resta per chi lo vuole grande.
  assert.equal(collegamenti.get("/icona-piccola.svg"), "icon");
  readFileSync(join(pubblica, "icona.svg"));
  for (const percorso of collegamenti.keys()) readFileSync(join(pubblica, percorso.slice(1)));

  const manifest = JSON.parse(readFileSync(join(pubblica, "manifest.webmanifest"), "utf8")) as {
    name: string;
    short_name: string;
    display: string;
    start_url: string;
    icons: { src: string; sizes: string; type: string }[];
  };
  assert.equal(manifest.name, "Shinka");
  assert.equal(manifest.short_name, "Shinka");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "/");
  for (const icona of manifest.icons) readFileSync(join(pubblica, icona.src.slice(1)));
  assert.ok(manifest.icons.some((icona) => icona.sizes === "192x192"));
  assert.ok(manifest.icons.some((icona) => icona.sizes === "512x512"));
  // iOS sceglie tra le icone del manifest, e un SVG per la schermata Home non lo sa usare.
  assert.ok(manifest.icons.every((icona) => icona.type === "image/png"), "nel manifest solo PNG");
});

test("le icone hanno la misura giusta, e quella dell'iPhone è piena, senza trasparenza", { skip: (() => {
  try {
    execFileSync("identify", ["-version"], { stdio: "ignore" });
    return false;
  } catch {
    return "in questo ambiente ImageMagick non c'è";
  }
})() }, () => {
  for (const [file, misura] of [["apple-touch-icon.png", "180x180"], ["apple-touch-icon-precomposed.png", "180x180"], ["icona-192.png", "192x192"], ["icona-512.png", "512x512"], ["favicon-32.png", "32x32"]]) {
    const letto = execFileSync("identify", ["-format", "%wx%h %[opaque]", join(pubblica, file ?? "")]).toString();
    assert.equal(letto, `${misura} true`, file);
  }
});

test("il centro serve icone e manifest a chi non è ancora entrato, e la sua politica li ammette", async (t) => {
  // Il browser li chiede prima dell'accesso: se rispondessero 401, sull'iPhone l'icona non comparirebbe.
  const banco = await allestisci(t, { cartellaWeb: pubblica });
  const tipi: Record<string, RegExp> = {
    "/apple-touch-icon.png": /^image\/png/,
    "/apple-touch-icon-precomposed.png": /^image\/png/,
    "/icona-192.png": /^image\/png/,
    "/icona-512.png": /^image\/png/,
    "/favicon-32.png": /^image\/png/,
    "/favicon.ico": /^image\/(x-icon|vnd\.microsoft\.icon)/,
    "/icona.svg": /^image\/svg\+xml/,
    "/icona-piccola.svg": /^image\/svg\+xml/,
    "/manifest.webmanifest": /^application\/manifest\+json/,
  };
  for (const [percorso, tipo] of Object.entries(tipi)) {
    const risposta = await banco.centro.inject({ method: "GET", url: percorso });
    assert.equal(risposta.statusCode, 200, percorso);
    assert.match(String(risposta.headers["content-type"]), tipo, percorso);
    assert.ok(risposta.rawPayload.length > 0, percorso);
  }
  // Un file che non c'è risponde "non trovato", non con la pagina al posto dell'immagine.
  const assente = await banco.centro.inject({ method: "GET", url: "/apple-touch-icon-120x120.png" });
  assert.equal(assente.statusCode, 404);
  // La politica della pagina: icone e manifest sono risorse sue.
  const politica = politicaContenuti("192.168.1.20:7850", 7852);
  assert.match(politica, /default-src 'self'/);
  assert.match(politica, /img-src 'self' data:/);
  assert.doesNotMatch(politica, /manifest-src/);
});
