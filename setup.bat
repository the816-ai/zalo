@echo off
title Zalo Bulk Tool Pro - Setup
chcp 65001 > nul
color 0B
echo.
echo  ╔══════════════════════════════════════╗
echo  ║     ZALO BULK TOOL PRO - SETUP       ║
echo  ╚══════════════════════════════════════╝
echo.

:: Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  [!] Node.js chua duoc cai dat!
    echo.
    echo  Dang tai Node.js tu nodejs.org...
    echo  Vui long cai dat Node.js (LTS) roi chay lai script nay.
    echo.
    start https://nodejs.org/en/download
    echo  Nhan phim bat ky de thoat...
    pause >nul
    exit /b
)

echo  [✓] Node.js da san sang: 
node --version
echo.

:: Install dependencies
echo  [~] Dang cai dat dependencies...
npm install --silent
if %errorlevel% neq 0 (
    echo  [X] Loi khi cai dat! Thu chay: npm install
    pause
    exit /b
)
echo  [✓] Dependencies da duoc cai dat!
echo.

:: Start app
echo  [>] Khoi dong Zalo Bulk Tool Pro...
echo.
npm start
