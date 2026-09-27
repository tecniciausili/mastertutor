@echo off
chcp 65001 >nul
title Ponte Mastertutor
cd /d "%~dp0"

rem Il ponte richiede Node.js 22 o successivo: nessun "npm install", nessuna dipendenza.

where node >nul 2>nul
if not %errorlevel%==0 goto senzaNode

for /f %%v in ('node -p "parseInt(process.versions.node)"') do set VERSIONE=%%v
if %VERSIONE% LSS 22 goto vecchio

node ponte.js %*
goto fine

:vecchio
echo.
echo  Node.js e' installato ma e' troppo vecchio (versione %VERSIONE%): serve la 22 o successiva.
goto scarica

:senzaNode
echo.
echo  Node.js non risulta installato su questo computer.

:scarica
echo.
echo  Per usare il ponte installa Node.js (versione LTS, lasciando le opzioni predefinite):
echo    https://nodejs.org/dist/v22.20.0/node-v22.20.0-x64.msi
echo  Pagina ufficiale: https://nodejs.org/en/download
echo.
echo  Poi chiudi questa finestra e fai di nuovo doppio clic su avvia.bat.
start "" "https://nodejs.org/en/download"

:fine
echo.
echo Ponte terminato.
pause
