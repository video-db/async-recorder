#!/usr/bin/env bash
set -e

# Directory of this script
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$DIR/.."
SERVER_DIR="$PROJECT_ROOT/server"
VENV_DIR="$SERVER_DIR/venv"
PYTHON_VERSION="3.12"

echo "🚀 Starting Async Recorder (Electron + Python)..."

# 1. Ensure uv is installed (handles both Python and packages)
if ! command -v uv &> /dev/null; then
    echo "⚡ Installing uv (Python + package manager)..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    # Add uv to PATH for current session
    export PATH="$HOME/.local/bin:$PATH"
fi

# 2. Ensure Python is available via uv
echo "🐍 Ensuring Python $PYTHON_VERSION is available..."
uv python install $PYTHON_VERSION --quiet 2>/dev/null || true

# 3. Setup Virtual Environment with uv
if [ ! -d "$VENV_DIR" ]; then
    echo "📦 Creating Python virtual environment..."
    uv venv "$VENV_DIR" --python $PYTHON_VERSION --quiet
fi

# Activate venv
source "$VENV_DIR/bin/activate"

# 4. Install pip into venv first (uv venvs don't include pip by default)
echo "📦 Setting up pip..."
uv pip install pip --quiet

# 5. Install all Python dependencies
echo "📦 Installing Python dependencies..."
"$VENV_DIR/bin/pip" install -r "$SERVER_DIR/requirements.txt" --quiet

# 6. Find Available Port
# Load API_PORT from .env if it exists
if [ -f "$PROJECT_ROOT/.env" ]; then
    ENV_PORT=$(grep "^API_PORT=" "$PROJECT_ROOT/.env" | cut -d'=' -f2)
    if [ ! -z "$ENV_PORT" ]; then
        API_PORT=$ENV_PORT
        echo "📍 Using Port from .env: $API_PORT"
    fi
fi

# Default if not set
: ${API_PORT:=8000}

while lsof -Pi :$API_PORT -sTCP:LISTEN -t >/dev/null 2>&1; do
    echo "⚠️  Port $API_PORT is busy, scanning next..."
    ((API_PORT++))
done
export API_PORT
echo "✅ Final backend port: $API_PORT"

# Define runtime file path
RUNTIME_FILE="$PROJECT_ROOT/runtime.json"

# Remove stale runtime config to ensure we wait for fresh one
rm -f "$RUNTIME_FILE"

# 7. Start Python Server in background
echo "⚡ Starting Python Backend (FastAPI) on port $API_PORT..."
python "$SERVER_DIR/run.py" &
SERVER_PID=$!

# Function to cleanup server on exit
cleanup() {
    echo ""
    echo "🛑 Shutting down..."
    kill $SERVER_PID 2>/dev/null || true
    exit
}

# Trap exit signals
trap cleanup SIGINT SIGTERM EXIT

# Wait for runtime.json to be written by the Python server
echo "⏳ Waiting for Python server to be ready..."

MAX_WAIT=60 # Maximum seconds to wait
WAITED=0
while [ $WAITED -lt $MAX_WAIT ]; do
    if [ -f "$RUNTIME_FILE" ]; then
        echo "✅ Runtime config updated. Server is ready."
        break
    fi
    sleep 1
    ((WAITED++))
done

if [ $WAITED -ge $MAX_WAIT ]; then
    echo "⚠️  Timeout waiting for runtime.json. Starting Electron anyway..."
fi

# 8. Start Electron App
echo "🖥️  Starting Electron App..."
cd "$PROJECT_ROOT"
npm run electron

# When Electron exits, the trap will cleanup the server
