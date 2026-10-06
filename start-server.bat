@echo off
setlocal
cd /d "%~dp0"

echo Starting the Monitoring System API...
echo Keep this window open while the desktop or web app is using the server.
call npm run dev:server

if errorlevel 1 (
  echo.
  echo The API stopped with an error. Check server\.env and the messages above.
  pause
)
