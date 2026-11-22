import assert from "node:assert/strict";
import { test } from "node:test";
import { altraParola, CAMBIO_PAROLA_MS, PAROLE_BUFFE, silenzioInParole } from "./parole-buffe.ts";

test("l'elenco è ampio, senza doppioni, e ogni voce comincia con un gerundio, è breve e non ha puntini", () => {
  assert.ok(PAROLE_BUFFE.length >= 50, `solo ${PAROLE_BUFFE.length} voci`);
  assert.equal(new Set(PAROLE_BUFFE).size, PAROLE_BUFFE.length);
  for (const voce of PAROLE_BUFFE) {
    // Il gerundio può portarsi dietro un pronome, "Sbattendomi", e qualche parola, "Grattandomi le palle".
    assert.match(voce, /^[A-ZÀ-Ý][a-zà-ÿ]+(ando|endo)(mi|ci|si|ti|la|lo|le|ne|mene|mela|sela|cela)?( [A-Za-zà-ÿ']+)*$/, voce);
    assert.ok(voce.length <= 34, `troppo lunga: ${voce}`);
  }
});

test("la parola cambia ogni pochi secondi", () => {
  assert.ok(CAMBIO_PAROLA_MS >= 2000 && CAMBIO_PAROLA_MS <= 6000);
});

test("la parola scelta viene dall'elenco e segue il caso, dal primo all'ultimo posto", () => {
  assert.equal(altraParola(undefined, () => 0), PAROLE_BUFFE[0]);
  assert.equal(altraParola(undefined, () => 0.999999), PAROLE_BUFFE.at(-1));
  for (let giro = 0; giro < 200; giro += 1) {
    assert.ok(PAROLE_BUFFE.includes(altraParola()));
  }
});

test("la stessa parola non esce due volte di fila", () => {
  const parole = ["Uno", "Due", "Tre"];
  for (const precedente of parole) {
    for (const caso of [0, 0.3, 0.5, 0.99]) {
      assert.notEqual(altraParola(precedente, () => caso, parole), precedente);
    }
  }
  let mostrata = altraParola();
  for (let giro = 0; giro < 500; giro += 1) {
    const nuova = altraParola(mostrata);
    assert.notEqual(nuova, mostrata);
    mostrata = nuova;
  }
});

test("un elenco di una parola sola, o un caso fuori misura, non lasciano l'indicatore vuoto", () => {
  assert.equal(altraParola("Sola", () => 0.5, ["Sola"]), "Sola");
  assert.equal(altraParola(undefined, () => 1, ["Uno", "Due"]), "Due");
  assert.equal(altraParola(undefined, () => -1, ["Uno", "Due"]), "Uno");
  assert.notEqual(altraParola(undefined, () => 0.5, []), "");
});

test("il silenzio di Claude si dice da due minuti in su", () => {
  assert.equal(silenzioInParole(90_000), undefined);
  assert.equal(silenzioInParole(120_000), "nessuna novità da 2 minuti");
  assert.equal(silenzioInParole(61 * 60_000), "nessuna novità da 61 minuti");
});
