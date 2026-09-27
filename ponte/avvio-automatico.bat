@echo off
chcp 65001 >nul
rem Avvio automatico del ponte su Windows: doppio clic per ATTIVARLO, di nuovo per DISATTIVARLO.
rem Crea (o toglie) un collegamento nella cartella Esecuzione automatica: il ponte parte
rem a ogni accesso a Windows, con la finestra ridotta a icona.
cd /d "%~dp0"
set "COLLEGAMENTO=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Ponte Mastertutor.lnk"
set "CARTELLA=%~dp0"

if exist "%COLLEGAMENTO%" goto togli

powershell -NoProfile -ExecutionPolicy Bypass -Command "$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:COLLEGAMENTO); $s.TargetPath = $env:CARTELLA + 'avvia.bat'; $s.Arguments = '--senza-browser'; $s.WorkingDirectory = $env:CARTELLA; $s.WindowStyle = 7; $s.Save()"
if not exist "%COLLEGAMENTO%" (
    echo.
    echo  Non sono riuscito ad attivare l'avvio automatico.
    goto fine
)
echo.
echo  Fatto: il ponte partira' da solo a ogni accesso a Windows (finestra ridotta a icona).
echo  Pagina del ponte: http://localhost:8124
echo  Per disattivarlo: di nuovo doppio clic su questo file.
echo.
choice /c SN /n /m "  Avviarlo anche adesso? [S/N] "
if %errorlevel%==1 start "Ponte Mastertutor" /min "%CARTELLA%avvia.bat" --senza-browser
goto fine

:togli
echo.
echo  L'avvio automatico del ponte e' ATTIVO.
choice /c SN /n /m "  Disattivarlo? [S/N] "
if %errorlevel%==1 (
    del "%COLLEGAMENTO%"
    echo  Avvio automatico disattivato. Il ponte gia' acceso si chiude dalla sua finestra con CTRL + C.
) else (
    echo  Nessuna modifica.
)

:fine
echo.
pause
