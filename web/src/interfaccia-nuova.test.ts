import assert from "node:assert/strict";
import { test } from "node:test";
import { interfacciaCambiata, risorseDi } from "./interfaccia-nuova.ts";

const pagina = (script: string, stile: string): string =>
  `<!doctype html><html><head><script type="module" crossorigin src="/assets/${script}"></script>` +
  `<link rel="stylesheet" crossorigin href="/assets/${stile}"></head><body><div id="radice"></div></body></html>`;

test("la pagina servita dice quali file dell'interfaccia chiede", () => {
  assert.deepEqual(risorseDi(pagina("index-AAA.js", "index-BBB.css")), ["/assets/index-AAA.js", "/assets/index-BBB.css"]);
  assert.deepEqual(risorseDi("<html><script src=\"/src/main.tsx\"></script></html>"), []);
});

test("dopo un'installazione che cambia l'interfaccia la pagina aperta è da ricaricare", () => {
  const inUso = ["/assets/index-AAA.js", "/assets/index-BBB.css"];
  assert.equal(interfacciaCambiata(pagina("index-AAA.js", "index-BBB.css"), inUso), false);
  assert.equal(interfacciaCambiata(pagina("index-CCC.js", "index-BBB.css"), inUso), true);
  assert.equal(interfacciaCambiata(pagina("index-AAA.js", "index-DDD.css"), inUso), true);
  // L'ordine in cui la pagina li elenca non conta.
  assert.equal(interfacciaCambiata(pagina("index-AAA.js", "index-BBB.css"), [...inUso].reverse()), false);
});

test("se non si riesce a dirlo, non si invita a ricaricare", () => {
  // La pagina dello sviluppo non ha file con il nome che cambia.
  assert.equal(interfacciaCambiata("<html><script src=\"/src/main.tsx\"></script></html>", ["/src/main.tsx"]), false);
  assert.equal(interfacciaCambiata(pagina("index-AAA.js", "index-BBB.css"), []), false);
  assert.equal(interfacciaCambiata("", ["/assets/index-AAA.js"]), false);
});
