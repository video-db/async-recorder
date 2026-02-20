@echo off
REM setup.bat - One-time setup for Async Recorder (Windows)
REM Usage: scripts\setup.bat

setlocal enabledelayedexpansion

REM Get script directory and project root
set "SCRIPT_DIR=%~dp0"
set "PROJECT_ROOT=%SCRIPT_DIR%.."

cd /d "%PROJECT_ROOT%"

echo.
echo ============================================
echo   Async Recorder - Setup (Windows)
echo ============================================
echo.

REM Prompt for API Key
set "API_KEY="
set /p API_KEY="Enter your VideoDB API Key: "

if "%API_KEY%"=="" (
    echo Error: API Key is required.
    exit /b 1
)

REM Prompt for Name
set "NAME="
set /p NAME="Enter your Name (Default: Guest): "

if "%NAME%"=="" (
    set "NAME=Guest"
)

echo.
echo Installing dependencies...
call npm install

echo.
echo Saving credentials...
(
echo {
echo     "apiKey": "%API_KEY%",
echo     "name": "%NAME%"
echo }
) > auth_config.json

echo.
echo ============================================
echo   Setup complete!
echo   Name: %NAME%
echo ============================================
echo.
echo Run 'npm start' to launch the app.
echo.

endlocal
