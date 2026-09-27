@echo off
rem Prova di Mastertutor in locale, presa compresa, senza Azure.
cd /d "%~dp0.."
node strumenti\server-locale.mjs %*
pause
