#!/bin/bash
# Prova di Mastertutor sul Mac, presa compresa, senza Azure (al posto di "npx serve").
# Doppio clic su questo file; per fermare: CTRL + C.
cd "$(dirname "$0")/.." || exit 1
exec node strumenti/server-locale.mjs "$@"
