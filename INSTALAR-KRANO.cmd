@echo off
setlocal
cd /d "%~dp0"
node install.mjs
if errorlevel 1 (
  echo.
  echo A instalacao nao foi concluida. Revise a mensagem acima.
  pause
  exit /b 1
)
echo.
echo KRANO instalada com sucesso.
pause
