#!/usr/bin/env bash
# Il gateway di un fork, a ogni avvio del container (ADR 0059). La prima volta prende la sua parte
# dalla copia pubblica e mette il guardiano fuori di lei; poi avvia il guardiano, che tiene acceso
# il gateway e mette in funzione le versioni che il proprietario approva con il sì dato al gateway.
set -euo pipefail
# Nelle prove le cartelle sono altre, le dipendenze si saltano e ci si ferma prima di avviare.
CODICE="${SHINKA_GATEWAY_CODICE:-/gateway}"
cd "$CODICE"
umask 077
[ -s "$SHINKA_GATEWAY_DATI/gettone.txt" ] || printf '%s\n' "$SHINKA_GATEWAY_GETTONE" > "$SHINKA_GATEWAY_DATI/gettone.txt"
umask 022

if [ ! -f shinka/versione.json ]; then
  echo "[fork] Preparo il gateway dalla copia originale $SHINKA_ORIGINALE…"
  provvisoria="$(mktemp -d)"
  git clone --quiet --depth 1 "$SHINKA_ORIGINALE" "$provvisoria/copia"
  versione="$(git -C "$provvisoria/copia" rev-parse HEAD)"
  printf '{\n  "versione": "%s",\n  "preparataIl": "%s"\n}\n' "$versione" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$provvisoria/copia/versione.json"
  rm -rf shinka.prima
  (cd "$provvisoria/copia" && node src/centro/disponi-gateway.ts "$CODICE/shinka.prima")
  [ -n "${SHINKA_FORK_SENZA_DIPENDENZE:-}" ] || (cd shinka.prima && npm ci --omit=dev --ignore-scripts --no-audit --no-fund)
  rm -rf guardiano
  cp -r "$provvisoria/copia/src/guardiano" guardiano
  rm -rf "$provvisoria" shinka
  mv shinka.prima shinka
fi

[ -z "${SHINKA_FORK_SOLO_PREPARA:-}" ] || exit 0
exec node guardiano/avvio-gateway.ts
