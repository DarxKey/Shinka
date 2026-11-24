#!/usr/bin/env bash
# Installa Shinka su questo server come fork della copia pubblica (ADR 0059): un'installazione sua,
# con i suoi dati e i suoi accessi, che si sviluppa da sé e riceve le versioni nuove dall'originale.
# Si lancia con una riga:
#
#   curl -fsSL https://raw.githubusercontent.com/DarxKey/Shinka/main/installazione/fork/installa.sh | bash
#
# Rilanciato, ricostruisce le immagini e riaccende centro e gateway: i dati e la versione in funzione
# stanno nei volumi, e restano.
set -euo pipefail

ORIGINALE="${SHINKA_ORIGINALE:-https://github.com/DarxKey/Shinka.git}"
FILE="${SHINKA_FILE_FORK:-https://raw.githubusercontent.com/DarxKey/Shinka/main/installazione}"
CARTELLA="${SHINKA_CARTELLA:-$HOME/shinka}"

fallisci() {
  echo "Shinka non si installa: $1" >&2
  exit 1
}

command -v curl >/dev/null 2>&1 || fallisci "manca curl."
command -v docker >/dev/null 2>&1 || fallisci "manca Docker. Installalo, poi rilancia."
docker compose version >/dev/null 2>&1 || fallisci "manca Docker Compose (il comando 'docker compose')."

mkdir -p "$CARTELLA"
cd "$CARTELLA"
echo "Prendo i file dell'installazione da $FILE…"
for nome in compose.yaml Dockerfile.centro Dockerfile.gateway prepara-centro.sh prepara-gateway.sh installa.sh; do
  curl -fsSL "$FILE/fork/$nome" -o "$nome.nuovo" || fallisci "non riesco a scaricare $nome."
  mv "$nome.nuovo" "$nome"
done
curl -fsSL "$FILE/seccomp-chromium.json" -o seccomp-chromium.json || fallisci "non riesco a scaricare seccomp-chromium.json."
chmod +x installa.sh prepara-centro.sh prepara-gateway.sh

if [ ! -f .env ]; then
  proposto="$(hostname -I 2>/dev/null | awk '{print $1}')"
  proposto="${proposto:-$(hostname)}"
  server="${SHINKA_SERVER:-}"
  if [ -z "$server" ] && [ -r /dev/tty ]; then
    read -r -p "Indirizzo da cui aprirai Shinka nel browser [$proposto]: " server < /dev/tty || true
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
SHINKA_ORIGINALE=$ORIGINALE
FINE
  umask 022
  echo "Preparato .env per $server."
fi
# shellcheck disable=SC1091
. ./.env

docker compose up -d --build

echo "Aspetto che il centro risponda: la prima volta prepara la versione dalla copia originale, ci vogliono alcuni minuti…"
pronto=""
for _ in $(seq 1 450); do
  if docker compose exec -T centro node -e "fetch('http://127.0.0.1:7850/api/stato').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" >/dev/null 2>&1; then
    pronto="sì"
    break
  fi
  sleep 2
done
[ -n "$pronto" ] || fallisci "il centro non risponde ancora. Guarda che cosa dice: cd $CARTELLA && docker compose logs centro"

echo
echo "Shinka è accesa: apri http://$SHINKA_SERVER:7850"
codice="$(docker compose exec -T centro cat /home/node/dati/primo-avvio.txt 2>/dev/null || true)"
if [ -n "$codice" ]; then
  echo "Codice di primo avvio: $codice"
  echo "La pagina te lo chiede per scegliere la password; poi ti guida per motore, accessi e ambiente."
fi
echo "La pagina del vault è su http://$SHINKA_SERVER:7851"
echo "Le versioni nuove dell'originale arrivano come proposte di sviluppo nella Home."
