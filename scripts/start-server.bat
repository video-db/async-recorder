@echo off
REM start-server.bat - Start Async Recorder (Windows)
REM Starts Python backend and Electron app

setlocal enabledelayedexpansion

REM Get script directory and project root
set "SCRIPT_DIR=%~dp0"
set "PROJECT_ROOT=%SCRIPT_DIR%.."
set "SERVER_DIR=%PROJECT_ROOT%\server"
set "VENV_DIR=%SERVER_DIR%\venv"

cd /d "%PROJECT_ROOT%"

echo.
echo Starting Async Recorder (Electron + Python)...
echo.

REM 1. Check if Python is installed (actually verify it works, not just the Windows stub)
python --version >nul 2>nul
if %errorlevel% neq 0 (
    echo.
    echo ============================================
    echo   ERROR: Python is not installed
    echo ============================================
    echo.
    echo Please install Python 3.10+ from:
    echo   https://python.org/downloads/
    echo.
    echo Make sure to check "Add Python to PATH" during installation.
    echo.
    pause
    exit /b 1
)

REM 2. Create virtual environment if it doesn't exist
if not exist "%VENV_DIR%" (
    echo Creating Python virtual environment...
    python -m venv "%VENV_DIR%"
)

REM 3. Activate venv and install dependencies
echo Installing Python dependencies...
call "%VENV_DIR%\Scripts\activate.bat"

pip install -r "%SERVER_DIR%\requirements.txt" --quiet

REM 4. Set default port
set "API_PORT=8000"

REM Check if port is in use and find available one
:check_port
netstat -an | findstr ":%API_PORT% " | findstr "LISTENING" >nul 2>nul
if %errorlevel% equ 0 (
    echo Port %API_PORT% is busy, trying next...
    set /a API_PORT+=1
    goto check_port
)
echo Using port: %API_PORT%

REM 5. Remove stale runtime config
set "RUNTIME_FILE=%PROJECT_ROOT%\runtime.json"
if exist "%RUNTIME_FILE%" del "%RUNTIME_FILE%"

REM 6. Start Python server in background
echo Starting Python Backend on port %API_PORT%...
start /b "" python "%SERVER_DIR%\run.py"

REM 7. Wait for server to be ready
echo Waiting for server to be ready...
set "WAITED=0"
set "MAX_WAIT=60"

:wait_loop
if exist "%RUNTIME_FILE%" (
    echo Server is ready!
    goto start_electron
)
if %WAITED% geq %MAX_WAIT% (
    echo Timeout waiting for server. Starting Electron anyway...
    goto start_electron
)
timeout /t 1 /nobreak >nul
set /a WAITED+=1
goto wait_loop

:start_electron
REM 8. Start Electron App
echo Starting Electron App...
cd /d "%PROJECT_ROOT%"
call npm run electron

REM Cleanup: Kill Python server when Electron exits
echo Shutting down...
taskkill /f /im python.exe >nul 2>nul

endlocal
