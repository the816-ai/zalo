@echo off
title Zalo Bulk Tool Pro
chcp 65001 > nul
echo  Dang khoi dong Zalo Bulk Tool Pro...

:: Try common Node.js paths
set NODE_PATHS=C:\Program Files\nodejs;C:\Program Files (x86)\nodejs;%APPDATA%\nvm\current;%LOCALAPPDATA%\Programs\nodejs
set PATH=%NODE_PATHS%;%PATH%

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo  [!] Khong tim thay Node.js!
    echo      Vui long chay setup.bat truoc.
    echo.
    pause
    exit /b
)

if not exist node_modules (
    echo  Cai dat dependencies lan dau...
    npm install
)

npm start
