@echo off
setlocal
cd /d "%~dp0.."
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-uqp-923.ps1" -Mode Install
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
  echo UQP 923 INSTALL NOT VERIFIED. Do not proceed to application update.
  echo Review preflight or installation result; never run generic db:migrate as a workaround.
)
pause
exit /b %EXIT_CODE%
