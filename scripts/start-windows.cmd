@echo off
setlocal
cd /d "%~dp0.."

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 18+ is required. Download: https://nodejs.org/
  pause
  exit /b 1
)

echo Starting Weight Butler on http://127.0.0.1:8787 ...
start "Weight Butler" cmd /k "node app\server.js"
timeout /t 1 /nobreak >nul
start "" "http://127.0.0.1:8787"
endlocal
