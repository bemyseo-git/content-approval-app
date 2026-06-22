@echo off
REM ============================================================
REM  BeMySEO Review - local launcher
REM  Double-click this file to start the app on your machine.
REM  It installs dependencies the first time, starts the dev
REM  server (reachable from your phone on the same Wi-Fi), and
REM  opens it in your browser.
REM ============================================================

cd /d "%~dp0"

if not exist "node_modules" (
  echo Installing dependencies, this only happens once...
  call npm install
)

echo.
echo Starting BeMySEO Review...
echo   This PC:  http://localhost:5173/
echo   Phone:    use the "Network" URL printed below (same Wi-Fi)
echo.

REM open the browser shortly after the server boots
start "" cmd /c "timeout /t 3 >nul & start http://localhost:5173/"

call npm run dev -- --host
