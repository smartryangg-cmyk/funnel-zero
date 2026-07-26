@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

title KRANO - Instalador 1-Clique

:: 1. Verificar se o projeto esta presente ou se precisa baixar do GitHub
if not exist "%~dp0install.mjs" (
  echo ========================================================
  echo   KRANO: Baixando o projeto oficial do GitHub...
  echo ========================================================
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference = 'SilentlyContinue'; $zip = '%TEMP%\krano-repo.zip'; Invoke-WebRequest -Uri 'https://github.com/smartryangg-cmyk/funnel-zero/archive/refs/heads/main.zip' -OutFile $zip; Expand-Archive -Path $zip -DestinationPath '%~dp0.' -Force; Copy-Item -Path '%~dp0funnel-zero-main\*' -Destination '%~dp0' -Recurse -Force; Remove-Item -Recurse -Force '%~dp0funnel-zero-main', $zip" >nul 2>nul
  if not exist "%~dp0install.mjs" (
    echo Erro: Nao foi possivel baixar os arquivos da KRANO do GitHub.
    pause
    exit /b 1
  )
)

:: 2. Verificar se Node.js esta instalado no sistema
set "NODE_EXE=node"
where node >nul 2>nul
if errorlevel 1 (
  if exist "%~dp0.funnel-zero\node\node.exe" (
    set "NODE_EXE=%~dp0.funnel-zero\node\node.exe"
  ) else (
    echo ========================================================
    echo   KRANO: Preparando ambiente Node.js automatizado...
    echo ========================================================
    if not exist "%~dp0.funnel-zero\node" mkdir "%~dp0.funnel-zero\node"
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference = 'SilentlyContinue'; $url = 'https://nodejs.org/dist/v22.14.0/node-v22.14.0-win-x64.zip'; $zip = '%TEMP%\node.zip'; Invoke-WebRequest -Uri $url -OutFile $zip; Expand-Archive -Path $zip -DestinationPath '%TEMP%\node_tmp' -Force; Move-Item -Path '%TEMP%\node_tmp\node-v22.14.0-win-x64\node.exe' -Destination '%~dp0.funnel-zero\node\node.exe' -Force; Remove-Item -Recurse -Force '%TEMP%\node_tmp', $zip" >nul 2>nul
    if exist "%~dp0.funnel-zero\node\node.exe" (
      set "NODE_EXE=%~dp0.funnel-zero\node\node.exe"
    ) else (
      echo Erro: Nao foi possivel baixar o Node.js automaticamente.
      pause
      exit /b 1
    )
  )
)

:: 3. Executar a instalacao
"%NODE_EXE%" install.mjs %*
if errorlevel 1 (
  echo.
  echo A instalacao nao foi concluida. Revise a mensagem acima.
  pause
  exit /b 1
)

:: 4. Abertura automatica infalivel do navegador
if exist "%~dp0.funnel-zero\setup-url.txt" (
  for /f "usebackq tokens=*" %%U in ("%~dp0.funnel-zero\setup-url.txt") do (
    set "SETUP_URL=%%U"
    if not "!SETUP_URL!"=="" (
      rundll32 url.dll,FileProtocolHandler !SETUP_URL!
    )
  )
)

echo.
echo ========================================================
echo   KRANO instalada com sucesso.
echo   O seu navegador foi aberto com a pagina do painel.
echo ========================================================
pause
