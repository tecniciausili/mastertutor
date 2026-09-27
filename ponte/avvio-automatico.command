#!/bin/bash
# Avvio automatico del ponte su Mac: doppio clic per ATTIVARLO, di nuovo per DISATTIVARLO.
# Con l'avvio automatico il ponte parte da solo a ogni accesso al Mac e riparte se si
# blocca. La sua pagina resta http://localhost:8124, il registro e' nel file ponte.log.

cd "$(dirname "$0")" || exit 1
ETICHETTA="it.tecniciausili.ponte-mastertutor"
PLIST="$HOME/Library/LaunchAgents/$ETICHETTA.plist"
DOMINIO="gui/$(id -u)"

if [ "$1" = "--solo-mostra" ]; then MOSTRA=1; fi

if [ -f "$PLIST" ] && [ -z "$MOSTRA" ]; then
  echo
  echo "  L'avvio automatico del ponte e' ATTIVO."
  read -r -p "  Disattivarlo (il ponte viene anche fermato)? [s/N] " risposta
  case "$risposta" in
    s|S)
      launchctl bootout "$DOMINIO/$ETICHETTA" 2>/dev/null
      rm -f "$PLIST"
      echo "  Avvio automatico disattivato."
      ;;
    *) echo "  Nessuna modifica." ;;
  esac
  echo
  read -r -p "Premi Invio per chiudere."
  exit 0
fi

NODE=$(command -v node)
if [ -z "$NODE" ] || [ "$("$NODE" -p "parseInt(process.versions.node)")" -lt 22 ]; then
  echo
  echo "  Serve Node.js 22 o successivo: https://nodejs.org (versione LTS)."
  echo
  read -r -p "Premi Invio per chiudere."
  exit 1
fi

CARTELLA=$(pwd)
case "$CARTELLA" in
  "$HOME/Desktop"*|"$HOME/Documents"*|"$HOME/Downloads"*)
    echo
    echo "  ATTENZIONE: la cartella del ponte e' in Scrivania, Documenti o Download."
    echo "  macOS non lascia leggere queste cartelle ai programmi avviati da soli:"
    echo "  sposta la cartella 'ponte' altrove (per esempio nella cartella Inizio) e riprova."
    echo
    read -r -p "Premi Invio per chiudere."
    exit 1
    ;;
esac

# Testo sicuro dentro l'XML del file di avvio
xml() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

CONTENUTO="<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">
<plist version=\"1.0\">
<dict>
  <key>Label</key><string>$ETICHETTA</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(xml "$NODE")</string>
    <string>$(xml "$CARTELLA/ponte.js")</string>
    <string>--senza-browser</string>
  </array>
  <key>WorkingDirectory</key><string>$(xml "$CARTELLA")</string>
  <key>RunAtLoad</key><true/>
  <!-- riparte solo se si blocca, non se viene chiuso normalmente -->
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key><string>$(xml "$CARTELLA/ponte.log")</string>
  <key>StandardErrorPath</key><string>$(xml "$CARTELLA/ponte.log")</string>
</dict>
</plist>"

if [ -n "$MOSTRA" ]; then
  printf '%s\n' "$CONTENUTO"
  exit 0
fi

mkdir -p "$HOME/Library/LaunchAgents"
printf '%s\n' "$CONTENUTO" > "$PLIST"
if launchctl bootstrap "$DOMINIO" "$PLIST"; then
  echo
  echo "  Fatto: il ponte e' acceso e ripartira' da solo a ogni accesso al Mac."
  echo "  Pagina del ponte: http://localhost:8124   ·   registro: $CARTELLA/ponte.log"
  echo "  Se macOS chiede di consentire a \"node\" l'accesso alla rete locale, rispondi Consenti."
  echo "  Per disattivarlo: di nuovo doppio clic su questo file."
else
  rm -f "$PLIST"
  echo
  echo "  Non sono riuscito ad attivare l'avvio automatico."
fi
echo
read -r -p "Premi Invio per chiudere."
