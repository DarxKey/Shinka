import assert from "node:assert/strict";
import { test } from "node:test";
import { contenitoriDa, inByte, leggiDocker, leggiRisorse } from "./risorse.ts";

test("le grandezze di Docker diventano byte", () => {
  assert.equal(inByte("12.5MiB"), 13_107_200);
  assert.equal(inByte(" 1.2GB "), 1_200_000_000);
  assert.equal(inByte("3.906GiB"), 4_194_035_565);
  assert.equal(inByte("512kB"), 512_000);
  assert.equal(inByte("0B"), 0);
  assert.equal(inByte("--"), 0);
});

test("i container si leggono da ciò che scrive Docker, con le risorse di quelli accesi", () => {
  const ps = [
    JSON.stringify({ Names: "plex", Image: "plexinc/pms-docker", State: "running", Status: "Up 3 days", Ports: "0.0.0.0:32400->32400/tcp", Labels: "maintainer=x" }),
    JSON.stringify({ Names: "vecchio", Image: "nginx:alpine", State: "exited", Status: "Exited (0) 2 hours ago", Ports: "", Labels: "" }),
    JSON.stringify({ Names: "shinka-prova-web-1", Image: "nginx:alpine", State: "running", Status: "Up 2 minutes", Ports: "0.0.0.0:7900->80/tcp", Labels: "com.docker.compose.project=shinka-prova,shinka.stack=prova" }),
    "riga rovinata",
  ].join("\n");
  const stats = [
    JSON.stringify({ Name: "plex", CPUPerc: "12.34%", MemUsage: "1.5GiB / 31.2GiB" }),
    JSON.stringify({ Name: "shinka-prova-web-1", CPUPerc: "0.00%", MemUsage: "8MiB / 1GiB" }),
  ].join("\n");
  assert.deepEqual(contenitoriDa(ps, stats, "shinka.stack"), [
    { nome: "plex", immagine: "plexinc/pms-docker", stato: "running", dettaglio: "Up 3 days", porte: "0.0.0.0:32400->32400/tcp", cpu: 12.34, memoria: { usata: 1_610_612_736, limite: 33_500_744_909 } },
    { nome: "shinka-prova-web-1", immagine: "nginx:alpine", stato: "running", dettaglio: "Up 2 minutes", porte: "0.0.0.0:7900->80/tcp", cpu: 0, memoria: { usata: 8_388_608, limite: 1_073_741_824 }, diShinka: true },
    { nome: "vecchio", immagine: "nginx:alpine", stato: "exited", dettaglio: "Exited (0) 2 hours ago", porte: "" },
  ]);
  assert.deepEqual(contenitoriDa("", ""), []);
});

test("ciò che arriva da un nodo si rilegge: i numeri restano numeri, il resto si scarta", () => {
  const buone = {
    sistema: { nome: "Windows 11", macchina: "PC", nuclei: 8, accesoDa: 100 },
    campione: { quando: "2026-11-22T10:00:00.000Z", cpu: 250, memoria: { usata: 1, totale: 2 }, disco: { usato: 3, totale: 4 } },
    processi: [{ pid: 4, nome: "System", cpu: 1, memoria: 5 }, { nome: "senza pid" }, "non un processo"],
    quantiProcessi: 200,
    docker: { stato: "attivo", contenitori: [{ nome: "a", immagine: "b", stato: "running", dettaglio: "Up", porte: "", cpu: "tanto", inventato: true }, { immagine: "senza nome" }] },
    inventato: "non passa",
  };
  const lette = leggiRisorse(buone);
  assert.ok(lette !== undefined);
  assert.equal(lette.campione.cpu, 100);
  assert.equal(lette.campione.carico, undefined);
  assert.deepEqual(lette.processi, [{ pid: 4, nome: "System", cpu: 1, memoria: 5 }]);
  assert.deepEqual(lette.docker, { stato: "attivo", contenitori: [{ nome: "a", immagine: "b", stato: "running", dettaglio: "Up", porte: "" }] });
  assert.equal("inventato" in lette, false);
  assert.equal(leggiRisorse({ ...buone, campione: { quando: "x", cpu: "molto", memoria: { usata: 1, totale: 2 } } }), undefined);
  assert.equal(leggiRisorse("ciao"), undefined);
  assert.deepEqual(leggiDocker(undefined), { stato: "assente", contenitori: [] });
});
