@echo off
setlocal

set "APP_DIR=%~dp0"
set "APP_DIR=%APP_DIR:~0,-1%"
set "ELECTRON_EXE=%APP_DIR%\node_modules\electron\dist\electron.exe"
set "RENDERER_INDEX=%APP_DIR%\dist\index.html"
set "MAIN_ENTRY=%APP_DIR%\dist-electron\main.js"

if not exist "%ELECTRON_EXE%" (
  echo Electron runtime was not found.
  echo.
  echo Run this first:
  echo   cd /d "%APP_DIR%"
  echo   npm install
  pause
  exit /b 1
)

if not exist "%RENDERER_INDEX%" (
  echo Renderer build was not found.
  echo.
  echo Run this first:
  echo   cd /d "%APP_DIR%"
  echo   npm run build
  pause
  exit /b 1
)

if not exist "%MAIN_ENTRY%" (
  echo Electron main build was not found.
  echo.
  echo Run this first:
  echo   cd /d "%APP_DIR%"
  echo   npm run build
  pause
  exit /b 1
)

start "Octopus" /D "%APP_DIR%" "%ELECTRON_EXE%" "%APP_DIR%"
exit /b 0
