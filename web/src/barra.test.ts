import assert from "node:assert/strict";
import { test } from "node:test";
import type { VoceProgetto } from "../../src/protocollo/progetti.ts";
import { raggruppaProgetti } from "./barra.ts";

function progetto(nome: string, nomeAmbiente: string, condizione: VoceProgetto["condizione"], fissato = false): VoceProgetto {
  return { id: nome, nome, cartella: `/p/${nome}`, idAmbiente: nomeAmbiente, creatoIl: "2026-11-18", brief: "", nomeAmbiente, condizione, ...(fissato ? { fissato: true as const } : {}) };
}

const PROGETTI = [
  progetto("Gioco", "PC Windows", "fermo"),
  progetto("Shinka", "Unraid", "al-lavoro", true),
  progetto("Ricette", "Unraid", "aspetta-te"),
  progetto("Foto", "PC Windows", "ambiente-spento"),
];

const nomi = (gruppi: ReturnType<typeof raggruppaProgetti>) => gruppi.map((gruppo) => [gruppo.titolo, gruppo.progetti.map((voce) => voce.nome)]);

test("i fissati stanno in cima; gli altri si raggruppano per ambiente o per stato, prima chi aspetta te", () => {
  assert.deepEqual(nomi(raggruppaProgetti(PROGETTI, "nessuno")), [
    ["Fissati", ["Shinka"]],
    ["Gli altri", ["Gioco", "Ricette", "Foto"]],
  ]);
  assert.deepEqual(nomi(raggruppaProgetti(PROGETTI, "ambiente")), [
    ["Fissati", ["Shinka"]],
    ["PC Windows", ["Gioco", "Foto"]],
    ["Unraid", ["Ricette"]],
  ]);
  assert.deepEqual(nomi(raggruppaProgetti(PROGETTI, "stato")), [
    ["Fissati", ["Shinka"]],
    ["Aspetta te", ["Ricette"]],
    ["Fermo", ["Gioco"]],
    ["Ambiente spento", ["Foto"]],
  ]);
  // Senza fissati e senza gruppi c'è un elenco solo, senza titolo.
  assert.deepEqual(nomi(raggruppaProgetti([PROGETTI[0]!], "nessuno")), [[undefined, ["Gioco"]]]);
});
