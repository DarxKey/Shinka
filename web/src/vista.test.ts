import assert from "node:assert/strict";
import { test } from "node:test";
import { frammentoDi, vistaDa } from "./vista.ts";

test("senza indicazioni si è nella Home", () => {
  assert.deepEqual(vistaDa(""), { tipo: "home" });
  assert.deepEqual(vistaDa("#/"), { tipo: "home" });
  assert.deepEqual(vistaDa("#qualcosa-di-strano"), { tipo: "home" });
  assert.deepEqual(vistaDa("#/progetti/"), { tipo: "home" });
});

test("l'indirizzo di un progetto porta al progetto, e viceversa", () => {
  const vista = { tipo: "progetto", id: "3f2c9a1e-0b7d-4c55-9e21-6a0f4d2b8c10" } as const;
  assert.equal(frammentoDi(vista), "#/progetti/3f2c9a1e-0b7d-4c55-9e21-6a0f4d2b8c10");
  assert.deepEqual(vistaDa(frammentoDi(vista)), vista);
  assert.equal(frammentoDi({ tipo: "home" }), "#/");
});

test("un identificativo con caratteri speciali fa il giro senza rovinarsi", () => {
  const vista = { tipo: "progetto", id: "a b/c?d#e" } as const;
  assert.deepEqual(vistaDa(frammentoDi(vista)), vista);
});

test("un indirizzo scritto male non rompe l'interfaccia", () => {
  assert.deepEqual(vistaDa("#/progetti/%E0%A4%A"), { tipo: "home" });
  assert.deepEqual(vistaDa("#/progetti/uno/due"), { tipo: "home" });
});

test("memoria e skill hanno la loro pagina, e ogni skill la sua", () => {
  assert.deepEqual(vistaDa("#/memoria"), { tipo: "memoria" });
  assert.deepEqual(vistaDa("#/skill"), { tipo: "skill" });
  assert.deepEqual(vistaDa("#/skill/backup-foto"), { tipo: "skill", nome: "backup-foto" });
  assert.equal(frammentoDi({ tipo: "memoria" }), "#/memoria");
  assert.equal(frammentoDi({ tipo: "skill" }), "#/skill");
  assert.deepEqual(vistaDa("#/vault"), { tipo: "vault" });
  assert.equal(frammentoDi({ tipo: "vault" }), "#/vault");
  assert.deepEqual(vistaDa("#/impostazioni"), { tipo: "impostazioni" });
  assert.equal(frammentoDi({ tipo: "impostazioni" }), "#/impostazioni");
  assert.deepEqual(vistaDa("#/estensioni"), { tipo: "estensioni" });
  assert.equal(frammentoDi({ tipo: "estensioni" }), "#/estensioni");
  assert.equal(frammentoDi({ tipo: "skill", nome: "backup-foto" }), "#/skill/backup-foto");
  // Un nome che non ha la forma di quello di una skill non porta da nessuna parte.
  assert.deepEqual(vistaDa("#/skill/Non%20Valido"), { tipo: "home" });
  assert.deepEqual(vistaDa("#/skill/uno/due"), { tipo: "home" });
});

test("l'indirizzo di un argomento archiviato porta all'argomento, e viceversa", () => {
  const vista = { tipo: "argomento", id: "2026-11-11-3fa9c1" } as const;
  assert.equal(frammentoDi(vista), "#/argomenti/2026-11-11-3fa9c1");
  assert.deepEqual(vistaDa(frammentoDi(vista)), vista);
  assert.deepEqual(vistaDa("#/argomenti/"), { tipo: "home" });
  assert.deepEqual(vistaDa("#/altro/2026-11-11-3fa9c1"), { tipo: "home" });
});

test("gli elaborati hanno la loro pagina, e ognuno il suo indirizzo", () => {
  assert.deepEqual(vistaDa("#/elaborati"), { tipo: "elaborati" });
  const scelto = "2026-11-13-abc~centro~tokyo/mappa di prova.png";
  const vista = { tipo: "elaborati", scelto } as const;
  assert.deepEqual(vistaDa(frammentoDi(vista)), vista);
  assert.equal(frammentoDi({ tipo: "elaborati" }), "#/elaborati");
});

test("la pagina Sicurezza ha il suo indirizzo", () => {
  assert.equal(frammentoDi({ tipo: "sicurezza" }), "#/sicurezza");
  assert.deepEqual(vistaDa("#/sicurezza"), { tipo: "sicurezza" });
});
