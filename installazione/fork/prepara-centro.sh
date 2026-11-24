#!/usr/bin/env bash
# Il centro di un fork, a ogni avvio del container (ADR 0059). La prima volta prende la copia
# pubblica con la sua storia (il repository del progetto Shinka), ne prepara la versione in
# funzione e mette il guardiano fuori di lei. Poi avvia il guardiano, che tiene acceso il centro e
# mette in funzione le versioni che il proprietario approva.
set -euo pipefail
# Nelle prove le cartelle sono altre, le dipendenze si saltano e ci si ferma prima di avviare.
cd "${SHINKA_CASA:-/home/node}"
mkdir -p dati progetti

if [ ! -d repository.git ]; then
  echo "[fork] Prendo la copia originale da $SHINKA_ORIGINALE…"
  rm -rf repository.git.nuovo
  git clone --quiet --bare "$SHINKA_ORIGINALE" repository.git.nuovo
  mv repository.git.nuovo repository.git
fi

if [ ! -f shinka/versione.json ]; then
  echo "[fork] Preparo la prima versione: dipendenze e interfaccia, qualche minuto…"
  rm -rf shinka.prima
  mkdir shinka.prima
  git --git-dir=repository.git archive main | tar -x -C shinka.prima
  versione="$(git --git-dir=repository.git rev-parse main)"
  printf '{\n  "versione": "%s",\n  "preparataIl": "%s"\n}\n' "$versione" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > shinka.prima/versione.json
  [ -n "${SHINKA_FORK_SENZA_DIPENDENZE:-}" ] || (cd shinka.prima && npm ci --no-audit --no-fund && npm run costruisci)
  rm -rf shinka
  mv shinka.prima shinka
fi

# Il guardiano sta fuori dalla versione in funzione: un'installazione non lo tocca. Si mette una
# volta; per cambiarlo, da fuori, si toglie la cartella e si riavvia il container.
if [ ! -f guardiano/avvio.ts ]; then
  rm -rf guardiano
  cp -r shinka/src/guardiano guardiano
fi

[ -z "${SHINKA_FORK_SOLO_PREPARA:-}" ] || exit 0
exec node guardiano/avvio.ts
