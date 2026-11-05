@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24 is required to run the offline chart lab.
  pause
  exit /b 1
)
echo Synthetic chart lab: localhost only. No production database connections.
start "" "http://127.0.0.1:4174/chart-lab.html"
node chart-lab-preview-server.mjs
if errorlevel 1 pause
