#!/bin/bash
# Avvia il ponte Mastertutor (macOS e Linux).
# macOS: doppio clic su questo file.  Terminale: ./avvia.command
# Il ponte richiede Node.js 22 o successivo: nessun "npm install", nessuna dipendenza.

cd "$(dirname "$0")" || exit 1

SCARICA_PAGINA="https://nodejs.org/en/download"
SCARICA_MAC="https://nodejs.org/dist/v22.20.0/node-v22.20.0.pkg"

if command -v node >/dev/null 2>&1; then
  VERSIONE=$(node -p "parseInt(process.versions.node)")
  if [ "$VERSIONE" -ge 22 ]; then
    exec node ponte.js "$@"
  fi
  echo
  echo "  Node.js è installato ma è troppo vecchio (versione $VERSIONE): serve la 22 o successiva."
else
  echo
  echo "  Node.js non risulta installato su questo computer."
fi

echo
echo "  Per usare il ponte installa Node.js (versione LTS):"
echo "    $SCARICA_MAC"
echo "    (pagina ufficiale: $SCARICA_PAGINA)"
echo
echo "  Terminata l'installazione, fai di nuovo doppio clic su avvia.command."
echo
open "$SCARICA_PAGINA" 2>/dev/null || xdg-open "$SCARICA_PAGINA" 2>/dev/null
read -r -p "Premi Invio per chiudere."
