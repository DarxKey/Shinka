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

test("l'ordine: per ultimo messaggio (chi non ha messaggi conta dalla nascita), per creazione o per nome; vale anche dentro i gruppi", () => {
  const con = (nome: string, creatoIl: string, ultimoMessaggioIl?: string, fissato = false): VoceProgetto => ({
    ...progetto(nome, "Unraid", "fermo", fissato),
    creatoIl,
    ...(ultimoMessaggioIl === undefined ? {} : { ultimoMessaggioIl }),
  });
  const elenco = [
    con("Vecchio", "2026-10-01T10:00:00Z", "2026-11-26T09:00:00Z"),
    con("Nuovo", "2026-11-20T10:00:00Z"),
    con("Medio", "2026-11-01T10:00:00Z", "2026-11-25T09:00:00Z"),
    con("Alfa", "2026-09-01T10:00:00Z", "2026-11-24T09:00:00Z", true),
    con("Beta", "2026-09-02T10:00:00Z", "2026-11-26T08:00:00Z", true),
  ];
  assert.deepEqual(nomi(raggruppaProgetti(elenco, "nessuno", "ultimo-messaggio")), [
    ["Fissati", ["Beta", "Alfa"]],
    ["Gli altri", ["Vecchio", "Medio", "Nuovo"]],
  ]);
  assert.deepEqual(nomi(raggruppaProgetti(elenco, "nessuno", "creazione")), [
    ["Fissati", ["Beta", "Alfa"]],
    ["Gli altri", ["Nuovo", "Medio", "Vecchio"]],
  ]);
  assert.deepEqual(nomi(raggruppaProgetti(elenco, "ambiente", "nome")), [
    ["Fissati", ["Alfa", "Beta"]],
    ["Unraid", ["Medio", "Nuovo", "Vecchio"]],
  ]);
});
