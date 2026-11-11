@echo off
title Gift Hype setup
cd /d "%~dp0"
echo.
echo  ===== Gift Hype setup =====
echo.

rem Opened from inside a zip? Windows runs it from a temp folder and nothing would be saved.
echo %~dp0 | findstr /i "\\AppData\\Local\\Temp\\" >nul && (
    echo  Unzip the Gift Hype folder first (right-click the zip, Extract All^), then run Setup.bat from there.
    pause
    exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
    echo  Installing Node.js, which runs Gift Hype. If Windows asks to allow changes, click Yes.
    winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
    set "PATH=%PATH%;%ProgramFiles%\nodejs"
)
where node >nul 2>nul
if errorlevel 1 (
    echo.
    echo  Node.js couldn't be installed by itself. Get it from https://nodejs.org ^(LTS^), then run Setup.bat again.
    pause
    exit /b 1
)

if not exist node_modules (
    echo  Downloading the parts Gift Hype needs...
    call npm install --no-audit --no-fund
)

echo  Adding Gift Hype to your desktop...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0make-shortcut.ps1"

echo.
echo  Done! Open Gift Hype from the icon on your desktop.
echo.
if /i not "%~1"=="nopause" pause
