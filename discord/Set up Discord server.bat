@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Unbound - Discord server setup
where node >nul 2>nul || (echo Node.js isn't installed. Run Setup.bat in the Unbound folder first. & pause & exit /b 1)
node setup-server.mjs
echo.
pause
