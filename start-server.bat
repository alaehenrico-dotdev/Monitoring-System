@echo off
setlocal
cd /d "%~dp0"

echo Starting the Monitoring System API and web client...
echo Keep this window open while the desktop or web app is using the server.
echo Starting ngrok tunnel for the web client on port 5173...
start "Monitoring System ngrok" cmd /k ngrok http 5173
call npm run dev

if errorlevel 1 (
  echo.
  echo The server stopped with an error. Check server\.env and the messages above.
  pause
)
