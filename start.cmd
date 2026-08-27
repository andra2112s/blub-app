@echo off
title Blub/Dodol - Server Preview
cd /d "%~dp0"
echo ============================================
echo   Server preview jalan di:
echo   http://localhost:5252
echo   (biarkan jendela ini terbuka)
echo ============================================
node server.js
pause
