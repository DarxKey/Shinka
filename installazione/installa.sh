#!/usr/bin/env bash
# Installa o aggiorna Shinka su questo server, con Docker: prepara il file .env la prima volta,
# costruisce le immagini e avvia centro e gateway. I dati restano nei volumi tra un
# aggiornamento e l'altro. Si lancia dalla cartella del pacchetto: ./installa.sh
set -euo pipefail
cd "$(dirname "$0")"

fallisci() {
  echo "Shinka non si installa: $1" >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || fallisci "manca Docker. Installalo, poi rilancia."
docker compose version >/dev/null 2>&1 || fallisci "manca Docker Compose (il comando 'docker compose')."

if [ ! -f .env ]; then
  proposto="$(hostname -I 2>/dev/null | awk '{print $1}')"
  proposto="${proposto:-$(hostname)}"
  server="${SHINKA_SERVER:-}"
  if [ -z "$server" ] && [ -t 0 ]; then
    read -r -p "Indirizzo da cui aprirai Shinka nel browser [$proposto]: " server || true
  fi
  server="${server:-$proposto}"
  nome="${SHINKA_AMBIENTE_NOME:-$(hostname)}"
  # Il gettone tra centro e gateway: casuale, solo in questo file.
  gettone="$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 48)"
  umask 077
  cat > .env <<FINE
SHINKA_SERVER=$server
SHINKA_AMBIENTE_NOME=$nome
SHINKA_MOTORE=${SHINKA_MOTORE:-claude}
SHINKA_GATEWAY_GETTONE=$gettone
FINE
  echo "Preparato .env per $server."
fi
# shellcheck disable=SC1091
. ./.env

docker compose up -d --build

echo "Aspetto che il centro risponda…"
pronto=""
for _ in $(seq 1 90); do
  if docker compose exec -T centro node -e "fetch('http://127.0.0.1:7850/api/stato').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" >/dev/null 2>&1; then
    pronto="sì"
    break
  fi
  sleep 2
done
[ -n "$pronto" ] || fallisci "il centro non risponde. Guarda che cosa dice: docker compose logs centro"

echo
echo "Shinka è accesa: apri http://$SHINKA_SERVER:7850"
codice="$(docker compose exec -T centro cat /home/node/dati/primo-avvio.txt 2>/dev/null || true)"
if [ -n "$codice" ]; then
  echo "Codice di primo avvio: $codice"
  echo "La pagina te lo chiede per scegliere la password; poi ti guida per motore, accessi e ambiente."
fi
echo "La pagina del vault è su http://$SHINKA_SERVER:7851"
