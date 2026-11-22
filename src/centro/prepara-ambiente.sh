#!/usr/bin/env bash
# Prepara un ambiente Linux per Shinka: scarica dal centro il nodo e il suo guardiano, installa le
# dipendenze, fa partire il nodo e lo fa ripartire all'accensione. Il centro mette in cima a questo
# file le scelte fatte nella pagina Ambienti (SHINKA_CENTRO, SHINKA_PACCHETTO, SHINKA_NOME,
# SHINKA_DESCRIZIONE). Si può rilanciare: l'identità del nodo e i suoi dati restano.
#
# Variabili che si possono dare prima del comando:
#   SHINKA_CARTELLA  dove sta il nodo (predefinita: ~/Shinka/nodo)
set -euo pipefail

fallisci() {
  echo >&2
  echo "Shinka non ha preparato questo ambiente: $1" >&2
  exit 1
}
passo() {
  echo "· $1"
}

cartella="${SHINKA_CARTELLA:-$HOME/Shinka/nodo}"
# Il guardiano e il nodo leggono le loro cartelle anche dall'ambiente: qui le si dà sempre, perché
# quelle di un'altra Shinka sulla stessa macchina non valgano per questo nodo.
unset SHINKA_INSTALLATA SHINKA_DATI_NODO
servizio="shinka-nodo"
registro="$cartella/nodo.log"

echo "Shinka prepara questo ambiente: «$SHINKA_NOME», collegato a $SHINKA_CENTRO."

# Ciò che serve prima di cominciare.
command -v curl >/dev/null 2>&1 || fallisci "manca curl."
command -v tar >/dev/null 2>&1 || fallisci "manca tar."
command -v node >/dev/null 2>&1 || fallisci "manca Node.js. Serve la versione 22.18 o più recente: https://nodejs.org (oppure il gestore di pacchetti del sistema)."
command -v npm >/dev/null 2>&1 || fallisci "manca npm, che arriva con Node.js."
node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)' ||
  fallisci "Node.js è alla versione $(node --version): serve la 22.18 o più recente."
mancano=""
for programma in make g++ python3; do command -v "$programma" >/dev/null 2>&1 || mancano="$mancano $programma"; done
[ -z "$mancano" ] || fallisci "mancano gli strumenti per compilare il terminale dei progetti:$mancano. Su Debian e Ubuntu: sudo apt install -y build-essential python3"

provvisoria="$(mktemp -d)"
trap 'rm -rf "$provvisoria"' EXIT

passo "Scarico il nodo dal centro"
# Con il certificato dei nodi il pacchetto arriva cifrato, e solo da chi presenta quella chiave.
cifrato=()
[ -z "${SHINKA_CHIAVE_DEL_CENTRO:-}" ] || cifrato=(-k --pinnedpubkey "$SHINKA_CHIAVE_DEL_CENTRO" --connect-to "$SHINKA_COLLEGA")
curl -fsSL ${cifrato[@]+"${cifrato[@]}"} "$SHINKA_PACCHETTO" -o "$provvisoria/nodo.tar.gz" ||
  fallisci "il centro non ha dato il pacchetto. L'invito vale un'ora: se è scaduto, prepara un comando nuovo dalla pagina Ambienti."
mkdir -p "$provvisoria/estratto"
tar -xzf "$provvisoria/nodo.tar.gz" -C "$provvisoria/estratto"
[ -f "$provvisoria/estratto/shinka/src/nodo/avvio.ts" ] || fallisci "il pacchetto scaricato non contiene il nodo."

mkdir -p "$cartella"

# Un nodo già acceso qui si ferma, per sostituirne il codice. I suoi dati restano.
con_systemd=""
if systemctl --user show-environment >/dev/null 2>&1; then con_systemd="sì"; fi
if [ -n "$con_systemd" ] && systemctl --user is-active --quiet "$servizio" 2>/dev/null; then
  passo "Fermo il nodo che c'era"
  systemctl --user stop "$servizio"
fi
if [ -f "$cartella/guardiano.pid" ]; then
  pid="$(cat "$cartella/guardiano.pid")"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    passo "Fermo il nodo che c'era"
    kill "$pid" 2>/dev/null || true
    for _ in $(seq 1 30); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
  fi
  rm -f "$cartella/guardiano.pid"
fi

passo "Metto a posto il codice in $cartella"
rm -rf "$cartella/guardiano"
mv "$provvisoria/estratto/guardiano" "$cartella/guardiano"
nuova="$provvisoria/estratto/shinka"
if [ -d "$cartella/shinka" ]; then
  # Se le dipendenze sono le stesse, si tengono quelle che ci sono: niente da scaricare né da compilare.
  if [ -d "$cartella/shinka/node_modules" ] && cmp -s "$cartella/shinka/package-lock.json" "$nuova/package-lock.json"; then
    mv "$cartella/shinka/node_modules" "$nuova/node_modules"
  fi
  rm -rf "$cartella/shinka-sostituita"
  mv "$cartella/shinka" "$cartella/shinka-sostituita"
fi
mv "$nuova" "$cartella/shinka"

if [ ! -d "$cartella/shinka/node_modules" ]; then
  passo "Installo le dipendenze (qualche minuto)"
  if ! (cd "$cartella/shinka" && npm ci --omit=dev --no-audit --no-fund --loglevel=error); then
    fallisci "npm non ha installato le dipendenze: guarda l'errore qui sopra."
  fi
fi

# Le scelte del nodo: indirizzo del centro, nome e descrizione, e l'impronta del certificato con
# cui riconoscere il centro. Quelle che il nodo aveva già (cartella dei progetti, browser del PC) restano.
passo "Salvo le scelte del nodo"
mkdir -p "$cartella/dati-nodo"
SHINKA_FILE="$cartella/dati-nodo/nodo.json" SHINKA_CENTRO="$SHINKA_CENTRO" SHINKA_NOME="$SHINKA_NOME" SHINKA_DESCRIZIONE="$SHINKA_DESCRIZIONE" SHINKA_IMPRONTA="${SHINKA_IMPRONTA:-}" node -e '
  const fs = require("node:fs");
  const file = process.env.SHINKA_FILE;
  let prima = {};
  try { prima = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
  const scelte = { ...prima, centro: process.env.SHINKA_CENTRO, nome: process.env.SHINKA_NOME, descrizione: process.env.SHINKA_DESCRIZIONE };
  // Il certificato da riconoscere è quello del centro che ha dato questo comando; senza, il nodo ricorderà quello che vede.
  delete scelte.improntaDelCentro;
  if (process.env.SHINKA_IMPRONTA) scelte.improntaDelCentro = process.env.SHINKA_IMPRONTA;
  fs.writeFileSync(file, JSON.stringify(scelte, null, 2));
'

programma_node="$(command -v node)"
: >>"$registro"
inizio_registro="$(wc -l <"$registro")"

if [ -n "$con_systemd" ]; then
  passo "Faccio partire il nodo con il sistema (servizio $servizio)"
  mkdir -p "$HOME/.config/systemd/user"
  cat >"$HOME/.config/systemd/user/$servizio.service" <<FINE
[Unit]
Description=Nodo di Shinka, tenuto acceso dal suo guardiano
After=network-online.target

[Service]
WorkingDirectory=$cartella
ExecStart=$programma_node guardiano/avvio-nodo.ts
Environment=PATH=$(dirname "$programma_node"):/usr/local/bin:/usr/bin:/bin
Environment=SHINKA_INSTALLATA=$cartella/shinka
Environment=SHINKA_DATI_NODO=$cartella/dati-nodo
StandardOutput=append:$registro
StandardError=append:$registro
Restart=on-failure
RestartSec=30
# 78: il centro ha rifiutato o rimosso il nodo, e ripartire non serve.
RestartPreventExitStatus=78

[Install]
WantedBy=default.target
FINE
  systemctl --user daemon-reload
  systemctl --user enable --now "$servizio" >/dev/null
  # Senza "linger" il servizio vive solo finché l'utente è collegato alla macchina.
  if [ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null || echo no)" != "yes" ]; then
    loginctl enable-linger "$USER" 2>/dev/null ||
      echo "  Attenzione: il nodo resta acceso solo finché sei collegato a questa macchina. Perché parta da solo all'accensione: sudo loginctl enable-linger $USER"
  fi
else
  passo "Faccio partire il nodo (senza systemd: con nohup)"
  (
    cd "$cartella"
    SHINKA_INSTALLATA="$cartella/shinka" SHINKA_DATI_NODO="$cartella/dati-nodo" nohup "$programma_node" guardiano/avvio-nodo.ts >>"$registro" 2>&1 </dev/null &
    echo $! >"$cartella/guardiano.pid"
  )
  if command -v crontab >/dev/null 2>&1; then
    riga="@reboot cd '$cartella' && SHINKA_INSTALLATA='$cartella/shinka' SHINKA_DATI_NODO='$cartella/dati-nodo' '$programma_node' guardiano/avvio-nodo.ts >> '$registro' 2>&1"
    { crontab -l 2>/dev/null | grep -v 'guardiano/avvio-nodo.ts' || true; echo "$riga"; } | crontab - &&
      echo "  All'accensione lo fa ripartire cron."
  else
    echo "  Attenzione: qui non c'è né systemd né cron, e all'accensione il nodo non riparte da solo."
  fi
fi

passo "Aspetto che il nodo si presenti al centro"
esito=""
for _ in $(seq 1 90); do
  nuove="$(tail -n +"$((inizio_registro + 1))" "$registro" 2>/dev/null || true)"
  if grep -q "Codice di verifica:" <<<"$nuove"; then
    esito="attesa"
    codice="$(grep "Codice di verifica:" <<<"$nuove" | tail -n 1 | sed -E 's/.*Codice di verifica: *([0-9 ]*[0-9]).*/\1/')"
    break
  fi
  if grep -q "Collegato:" <<<"$nuove"; then esito="collegato"; break; fi
  if grep -q "rifiutato" <<<"$nuove"; then esito="rifiutato"; break; fi
  sleep 1
done

echo
case "$esito" in
  attesa)
    echo "Il nodo aspetta il tuo consenso. Apri Shinka, pagina Ambienti, e approva la richiesta di «$SHINKA_NOME»"
    echo "solo se il codice è questo: $codice"
    ;;
  collegato)
    echo "Il nodo è collegato: l'ambiente «$SHINKA_NOME» è attivo."
    ;;
  rifiutato)
    echo "Il centro ha rifiutato il nodo. Guarda che cosa dice: tail -n 20 '$registro'"
    ;;
  *)
    echo "Il nodo è partito, ma non si è ancora presentato al centro. Guarda che cosa dice: tail -n 20 '$registro'"
    ;;
esac
echo "Poi, nella pagina Impostazioni, fai gli accessi di Claude o Codex per questo ambiente."
echo "Il nodo sta in $cartella; il suo registro è $registro."
